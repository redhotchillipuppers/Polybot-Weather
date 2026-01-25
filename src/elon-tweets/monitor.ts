// Elon Musk Tweet Monitoring Bot
// Monitors Polymarket tweet count markets and tracks actual tweet counts via X API

import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

import {
  loadConfig,
  ensureDataDirectory,
  getLogFilePath,
  isXApiCheckTime,
  isPolymarketCheckTime,
  getNextXApiCheckTime,
  validateConfig,
  printConfig
} from './config.js';

import {
  queryElonTweetMarkets,
  marketToSnapshot,
  getMarketOddsSummary
} from './polymarket.js';

import {
  ensureElonUserId,
  getTweetCountsForMarkets,
  testXApiConnection
} from './x-api.js';

import type {
  ElonTweetConfig,
  ElonTweetMarket,
  TweetCountData,
  TrackedMarket,
  MonitoringEntry,
  DivergenceAlert
} from './types.js';

// Load environment variables
dotenv.config();

// State
let config: ElonTweetConfig;
let trackedMarkets: Map<string, TrackedMarket> = new Map();
let latestTweetCounts: Map<string, TweetCountData> = new Map(); // keyed by "startDate-endDate"
let lastXApiCheck: Date | null = null;
let lastPolymarketCheck: Date | null = null;

// ============================================================================
// Logging Functions
// ============================================================================

/**
 * Read existing log entries from today's file
 */
function readLogFile(): MonitoringEntry[] {
  const logPath = getLogFilePath(config);
  try {
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('Error reading log file, starting fresh:', error);
  }
  return [];
}

/**
 * Append entry to log file
 */
function appendToLog(entry: MonitoringEntry): void {
  const logPath = getLogFilePath(config);
  const entries = readLogFile();
  entries.push(entry);

  try {
    fs.writeFileSync(logPath, JSON.stringify(entries, null, 2), 'utf-8');
    console.log(`  Logged to: ${path.basename(logPath)}`);
  } catch (error) {
    console.error('Error writing to log file:', error);
  }
}

/**
 * Format timestamp for console output
 */
function formatTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

// ============================================================================
// Market Management
// ============================================================================

/**
 * Update tracked markets - add new ones, remove expired/resolved
 */
async function updateTrackedMarkets(): Promise<void> {
  const now = new Date();
  const currentMarkets = await queryElonTweetMarkets(config);

  // Track which markets we've seen
  const seenIds = new Set<string>();

  for (const market of currentMarkets) {
    seenIds.add(market.id);

    if (trackedMarkets.has(market.id)) {
      // Update existing market
      const tracked = trackedMarkets.get(market.id)!;
      tracked.market = market;
      tracked.lastUpdated = now.toISOString();
    } else {
      // New market discovered
      console.log(`  + New market discovered: ${market.question.substring(0, 60)}...`);
      trackedMarkets.set(market.id, {
        market,
        addedAt: now.toISOString(),
        lastUpdated: now.toISOString(),
        latestTweetCount: null
      });
    }
  }

  // Remove markets that are no longer active
  for (const [id, tracked] of trackedMarkets) {
    if (!seenIds.has(id)) {
      const reason = tracked.market.resolved ? 'resolved' :
                     tracked.market.closed ? 'closed' : 'expired';
      console.log(`  - Removing ${reason} market: ${tracked.market.question.substring(0, 50)}...`);
      trackedMarkets.delete(id);
    }
  }
}

// ============================================================================
// Divergence Detection
// ============================================================================

/**
 * Check for divergences between actual tweet pace and market odds
 */
function checkForDivergences(): DivergenceAlert[] {
  const alerts: DivergenceAlert[] = [];
  const now = new Date();

  for (const [marketId, tracked] of trackedMarkets) {
    const market = tracked.market;

    // Get tweet count for this market's date range
    const rangeKey = `${market.startDate}-${market.endDate}`;
    const tweetData = latestTweetCounts.get(rangeKey);

    if (!tweetData) continue;

    const startDate = new Date(market.startDate);
    const endDate = new Date(market.endDate);
    endDate.setUTCHours(23, 59, 59, 999);

    // Calculate time progress
    const totalDuration = endDate.getTime() - startDate.getTime();
    const elapsed = now.getTime() - startDate.getTime();
    const timeProgress = Math.min(1, Math.max(0, elapsed / totalDuration));

    if (timeProgress <= 0 || timeProgress >= 1) continue;

    // Project final count based on current pace
    const actualCount = tweetData.tweetCount;
    const projectedFinal = Math.round(actualCount / timeProgress);
    const hoursRemaining = (endDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    // Find which bracket the projected count falls into
    let projectedBracket = market.brackets.find(b => {
      if (b.minTweets !== null && b.maxTweets !== null) {
        return projectedFinal >= b.minTweets && projectedFinal <= b.maxTweets;
      } else if (b.minTweets !== null) {
        return projectedFinal >= b.minTweets;
      } else if (b.maxTweets !== null) {
        return projectedFinal <= b.maxTweets;
      }
      return false;
    });

    // Find the bracket with highest probability
    const mostLikelyBracket = [...market.brackets].sort((a, b) => b.price - a.price)[0];

    // Check for divergence
    if (projectedBracket && mostLikelyBracket && projectedBracket.tokenId !== mostLikelyBracket.tokenId) {
      // Calculate confidence based on time progress
      const confidence: 'low' | 'medium' | 'high' =
        timeProgress < 0.3 ? 'low' :
        timeProgress < 0.6 ? 'medium' : 'high';

      // Determine divergence type
      const projectedBracketPrice = projectedBracket.price;
      const divergenceType = projectedBracketPrice < 0.5 ? 'underpriced' : 'overpriced';

      alerts.push({
        marketId,
        timestamp: now.toISOString(),
        actualTweetCount: actualCount,
        projectedFinalCount: projectedFinal,
        timeRemainingHours: hoursRemaining,
        mostLikelyBracket,
        bracketForActualPace: projectedBracket,
        divergenceType,
        divergenceDescription: `Actual pace suggests ${projectedBracket.outcome} (${(projectedBracketPrice * 100).toFixed(1)}% odds) but market favors ${mostLikelyBracket.outcome} (${(mostLikelyBracket.price * 100).toFixed(1)}% odds)`,
        confidenceLevel: confidence
      });
    }
  }

  return alerts;
}

// ============================================================================
// Check Functions
// ============================================================================

/**
 * Check Polymarket odds (runs every 10 minutes by default)
 */
async function checkPolymarketOdds(): Promise<void> {
  const timestamp = formatTimestamp();
  console.log(`\n[${timestamp}] Checking Polymarket odds...`);

  try {
    // Update tracked markets (discover new, remove expired)
    await updateTrackedMarkets();

    if (trackedMarkets.size === 0) {
      console.log('  No active Elon tweet markets found.');

      // Log entry even with no markets
      const entry: MonitoringEntry = {
        timestamp: new Date().toISOString(),
        entryType: 'polymarket_check',
        source: 'polymarket',
        markets: [],
        tweetCounts: null,
        alerts: null,
        activeMarketCount: 0,
        error: null
      };
      appendToLog(entry);
      return;
    }

    // Group markets by date range (event)
    const eventGroups = new Map<string, typeof trackedMarkets extends Map<string, infer V> ? V[] : never>();

    for (const [id, tracked] of trackedMarkets) {
      const key = `${tracked.market.startDate} to ${tracked.market.endDate}`;
      if (!eventGroups.has(key)) {
        eventGroups.set(key, []);
      }
      eventGroups.get(key)!.push(tracked);
    }

    console.log(`  Tracking ${trackedMarkets.size} bracket(s) across ${eventGroups.size} event(s):`);

    const marketSnapshots = [];

    for (const [dateRange, markets] of eventGroups) {
      // Calculate total volume for event
      const totalVolume = markets.reduce((sum, m) => sum + m.market.volume, 0);

      // Get all brackets with prices, sorted by YES price descending
      const brackets = markets
        .map(m => {
          // Extract bracket range from question (e.g., "90-114" from "Will Elon Musk post 90-114 tweets...")
          const match = m.market.question.match(/(\d+[-–]\d+|\d+\+|<\d+)/);
          const bracketName = match ? match[1] : 'unknown';
          // Get YES price from brackets
          const yesBracket = m.market.brackets.find(b => b.outcome.toLowerCase() === 'yes');
          const yesPrice = yesBracket ? yesBracket.price * 100 : 0;
          return { name: bracketName, price: yesPrice, market: m.market };
        })
        .sort((a, b) => b.price - a.price);

      // Display event summary
      console.log(`\n    Event: ${dateRange}`);
      console.log(`      Total volume: $${totalVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      console.log(`      Brackets (${brackets.length}):`);

      // Show top 5 brackets with highest odds, then summarize rest
      const topBrackets = brackets.slice(0, 5);
      const restBrackets = brackets.slice(5);

      for (const b of topBrackets) {
        console.log(`        ${b.name}: ${b.price.toFixed(1)}%`);
      }

      if (restBrackets.length > 0) {
        const restWithOdds = restBrackets.filter(b => b.price >= 1);
        if (restWithOdds.length > 0) {
          console.log(`        ... and ${restBrackets.length} more (${restWithOdds.length} with >1% odds)`);
        } else {
          console.log(`        ... and ${restBrackets.length} more (all <1% odds)`);
        }
      }

      // Add all to snapshots
      for (const m of markets) {
        marketSnapshots.push(marketToSnapshot(m.market));
      }
    }

    // Log entry
    const entry: MonitoringEntry = {
      timestamp: new Date().toISOString(),
      entryType: 'polymarket_check',
      source: 'polymarket',
      markets: marketSnapshots,
      tweetCounts: null,
      alerts: null,
      activeMarketCount: trackedMarkets.size,
      error: null
    };
    appendToLog(entry);

  } catch (error) {
    console.error('  Error checking Polymarket odds:', error instanceof Error ? error.message : error);

    // Log error
    const entry: MonitoringEntry = {
      timestamp: new Date().toISOString(),
      entryType: 'polymarket_check',
      source: 'polymarket',
      markets: null,
      tweetCounts: null,
      alerts: null,
      activeMarketCount: null,
      error: error instanceof Error ? error.message : String(error)
    };
    appendToLog(entry);
  }
}

/**
 * Check X API for tweet counts (runs 2-3 times daily)
 */
async function checkXApiTweetCounts(): Promise<void> {
  const timestamp = formatTimestamp();
  console.log(`\n[${timestamp}] Checking X API for tweet counts...`);

  if (!config.xApiBearerToken) {
    console.log('  Skipping X API check: Bearer token not configured');
    return;
  }

  try {
    // Ensure we have Elon's user ID
    await ensureElonUserId(config);

    // Get unique date ranges from tracked markets
    const dateRanges: Array<{ startDate: string; endDate: string }> = [];
    const seenRanges = new Set<string>();

    for (const [id, tracked] of trackedMarkets) {
      const key = `${tracked.market.startDate}-${tracked.market.endDate}`;
      if (!seenRanges.has(key)) {
        seenRanges.add(key);
        dateRanges.push({
          startDate: tracked.market.startDate,
          endDate: tracked.market.endDate
        });
      }
    }

    if (dateRanges.length === 0) {
      console.log('  No market date ranges to check.');
      return;
    }

    console.log(`  Checking ${dateRanges.length} date range(s)...`);

    // Fetch tweet counts
    const tweetCounts = await getTweetCountsForMarkets(config, dateRanges);

    // Update state
    for (const countData of tweetCounts) {
      const key = `${countData.startDate}-${countData.endDate}`;
      latestTweetCounts.set(key, countData);

      console.log(`\n    Range: ${countData.startDate} to ${countData.endDate}`);
      console.log(`      Tweet count: ${countData.tweetCount}`);
    }

    // Update tracked markets with latest counts
    for (const [id, tracked] of trackedMarkets) {
      const key = `${tracked.market.startDate}-${tracked.market.endDate}`;
      const countData = latestTweetCounts.get(key);
      if (countData) {
        tracked.latestTweetCount = countData.tweetCount;
      }
    }

    lastXApiCheck = new Date();

    // Check for divergences
    const alerts = checkForDivergences();
    if (alerts.length > 0) {
      console.log(`\n  DIVERGENCE ALERTS (${alerts.length}):`);
      for (const alert of alerts) {
        console.log(`    [${alert.confidenceLevel.toUpperCase()}] ${alert.divergenceDescription}`);
      }
    }

    // Log entry
    const entry: MonitoringEntry = {
      timestamp: new Date().toISOString(),
      entryType: 'x_api_check',
      source: 'x_api',
      tweetCounts,
      markets: Array.from(trackedMarkets.values()).map(t => marketToSnapshot(t.market)),
      alerts: alerts.length > 0 ? alerts : null,
      activeMarketCount: trackedMarkets.size,
      error: null
    };
    appendToLog(entry);

  } catch (error) {
    console.error('  Error checking X API:', error instanceof Error ? error.message : error);

    // Log error
    const entry: MonitoringEntry = {
      timestamp: new Date().toISOString(),
      entryType: 'x_api_check',
      source: 'x_api',
      markets: null,
      tweetCounts: null,
      alerts: null,
      activeMarketCount: null,
      error: error instanceof Error ? error.message : String(error)
    };
    appendToLog(entry);
  }
}

// ============================================================================
// Main Loop
// ============================================================================

/**
 * Main monitoring loop
 */
async function startMonitoring(): Promise<void> {
  console.log('='.repeat(70));
  console.log('ELON MUSK TWEET MONITORING BOT');
  console.log('='.repeat(70));
  console.log(`Started at: ${formatTimestamp()}`);

  // Load and validate configuration
  config = loadConfig();
  printConfig(config);

  const validation = validateConfig(config);
  if (!validation.valid) {
    console.error('\nConfiguration errors:');
    validation.errors.forEach(e => console.error(`  - ${e}`));

    if (!config.xApiBearerToken) {
      console.log('\nNote: Bot will run without X API checks (Polymarket monitoring only)');
      console.log('Set X_API_BEARER_TOKEN environment variable to enable tweet tracking.');
    }
  }

  // Ensure data directory exists
  ensureDataDirectory(config);

  console.log(`\nLog file: ${getLogFilePath(config)}`);
  console.log('='.repeat(70));

  // Test X API connection if configured
  if (config.xApiBearerToken) {
    console.log('\nTesting X API connection...');
    const connected = await testXApiConnection(config.xApiBearerToken);
    if (!connected) {
      console.log('Warning: X API connection failed. Tweet counts will not be tracked.');
    }
  }

  // Initial data collection
  console.log('\nPerforming initial data collection...');
  await checkPolymarketOdds();

  // Also check X API on startup if we have markets and a token
  if (config.xApiBearerToken && trackedMarkets.size > 0) {
    await checkXApiTweetCounts();
  }

  // Set up Polymarket check (checks every minute if it's time)
  const polymarketCheckInterval = setInterval(async () => {
    if (isPolymarketCheckTime(config)) {
      // Avoid checking twice in the same minute
      if (lastPolymarketCheck) {
        const timeSinceLastCheck = Date.now() - lastPolymarketCheck.getTime();
        if (timeSinceLastCheck < 60 * 1000) {
          return; // Skip if checked within last minute
        }
      }

      lastPolymarketCheck = new Date();
      await checkPolymarketOdds();
    }
  }, 60 * 1000); // Check every minute if it's time

  // Set up X API check interval (checks every minute if it's time)
  const xApiCheckInterval = setInterval(async () => {
    if (config.xApiBearerToken && isXApiCheckTime(config)) {
      // Avoid checking twice in the same minute
      if (lastXApiCheck) {
        const timeSinceLastCheck = Date.now() - lastXApiCheck.getTime();
        if (timeSinceLastCheck < 2 * 60 * 1000) {
          return; // Skip if checked within last 2 minutes
        }
      }

      if (trackedMarkets.size > 0) {
        await checkXApiTweetCounts();
      }
    }
  }, 60 * 1000); // Check every minute if it's time

  // Print schedule info
  const nextXApiCheck = getNextXApiCheckTime(config);
  console.log('\nMonitoring started. Press Ctrl+C to stop.');
  console.log(`Polymarket checks at :${config.polymarketCheckMinutes.join(', :')} past each hour (UTC)`);
  console.log(`Next X API check at: ${nextXApiCheck.toISOString()}`);
  console.log(`X API check times (UTC): ${config.xApiCheckTimes.join(', ')}`);

  // Handle graceful shutdown
  const shutdown = () => {
    console.log('\n\nShutting down monitoring...');
    clearInterval(polymarketCheckInterval);
    clearInterval(xApiCheckInterval);
    console.log(`Final log file: ${getLogFilePath(config)}`);
    console.log('Goodbye!');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ============================================================================
// Entry Point
// ============================================================================

startMonitoring().catch((error) => {
  console.error('Fatal error starting monitoring:', error);
  process.exit(1);
});
