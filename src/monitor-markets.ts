// Market monitoring script - collects weather forecasts and market odds over time
import { Wallet } from 'ethers';
import { ClobClient } from '@polymarket/clob-client';
import { getWeatherForDatesMulti } from './weather.js';
import { queryLondonTemperatureMarkets } from './polymarket.js';
import type { WeatherForecast, PolymarketMarket, MarketSnapshot } from './types.js';
import { formatError, safeArray, safeNumber, safeString } from './api-utils.js';
import { calculateMarketProbability, calculateHoursUntilResolution, analyzeEdge } from './probability-model.js';

// Import from new modules
import { parseMarketQuestion, extractDateFromQuestion, extractTemperatureFromQuestion } from './parsers/market-parser.js';
import { ClockAlignedScheduler } from './scheduler.js';
import {
  getLogFilePath,
  getSettlementLogFilePath,
  initializeLogs,
  appendMonitoringSnapshot,
  appendDecisionRecord,
} from './persistence/file-store.js';
import { getDecisionsLogPath } from './persistence/log-utils.js';
import { loadSettledMarketIds, getSettledMarketCount, runSettlementPass, formatTimestamp } from './settlement/settlement.js';
import { processPositionManagement, loadPositionsData, getPositionsFilePath, getDailyReportsFilePath } from './positions/position-manager.js';
import { getEnvConfig } from './config/env.js';
import {
  HOST,
  CHAIN_ID,
  MARKET_CHECK_MINUTES,
  MIN_TRADE_LIQUIDITY,
  MIN_TRADE_VOLUME,
  DEFAULT_PRICE_EPSILON,
  DEFAULT_PRICE_PAIRS,
} from './config/constants.js';

// Validate environment variables at startup (exits with clear error if missing)
const { PRIVATE_KEY, OPENWEATHER_API_KEY, TOMORROW_API_KEY } = getEnvConfig();

// State to track latest weather forecasts (only updates hourly)
let latestWeatherForecasts: WeatherForecast[] = [];

// Track previous market count for change detection
let previousMarketCount = 0;

// Find matching weather forecast for a given date string
function findForecastForDate(dateStr: string, forecasts: WeatherForecast[]): WeatherForecast | null {
  if (!dateStr || !forecasts || forecasts.length === 0) {
    return null;
  }

  // Try to match by date string (YYYY-MM-DD format)
  return forecasts.find(f => f.date === dateStr) ?? null;
}

// Convert market to snapshot format with null-safe handling
function marketToSnapshot(
  market: PolymarketMarket | null | undefined,
  weatherForecasts: WeatherForecast[] = []
): MarketSnapshot | null {
  if (!market) {
    return null;
  }

  try {
    const outcomes = safeArray(market.outcomes);
    const prices = safeArray(market.prices).map(p => safeNumber(p, 0));
    const question = safeString(market.question, 'Unknown market');
    const marketId = safeString(market.id, 'unknown');

    // Find YES price (typically first outcome or explicit "Yes")
    let yesPrice: number | null = null;
    const yesIndex = outcomes.findIndex(o =>
      typeof o === 'string' && (o.toLowerCase() === 'yes' || o.toLowerCase().includes('yes'))
    );
    if (yesIndex !== -1 && prices[yesIndex] !== undefined) {
      yesPrice = prices[yesIndex] ?? null;
    } else if (prices.length > 0) {
      yesPrice = prices[0] ?? null; // Default to first price
    }

    const noIndex = outcomes.findIndex(o =>
      typeof o === 'string' && (o.toLowerCase() === 'no' || o.toLowerCase().includes('no'))
    );
    const noPriceFromMarket = noIndex !== -1 && prices[noIndex] !== undefined
      ? prices[noIndex] ?? null
      : null;
    const derivedNoPrice = yesPrice !== null ? 1 - yesPrice : null;
    const noPrice = noPriceFromMarket ?? derivedNoPrice;

    // Calculate model probability and edge
    let modelProbability: number | null = null;
    let edge: number | null = null;
    let edgePercent: number | null = null;
    let signal: 'BUY' | 'SELL' | 'HOLD' | null = null;
    let forecastError: number | null = null;

    // Parse the market question to get bracket type and value
    const parsedQuestion = parseMarketQuestion(question);
    const marketDateStr = extractDateFromQuestion(question);

    if (parsedQuestion && marketDateStr) {
      // Find matching weather forecast for this market's date
      const forecast = findForecastForDate(marketDateStr, weatherForecasts);

      if (forecast) {
        // Calculate hours until resolution using endDate
        const endDate = safeString(market.endDate, '');
        const hoursUntilResolution = endDate ? calculateHoursUntilResolution(endDate) : 0;

        // Calculate model probability using the forecast max temperature
        modelProbability = calculateMarketProbability(
          forecast.maxTemperature,
          hoursUntilResolution,
          parsedQuestion.bracketType,
          parsedQuestion.bracketValue
        );

        // Calculate forecast error based on bracket type
        // Positive = harder to reach, Negative = easier to reach (for or_higher/or_below)
        const forecastMax = forecast.maxTemperature;
        const bracketValue = parsedQuestion.bracketValue;
        switch (parsedQuestion.bracketType) {
          case 'or_higher':
            // Positive = forecast below threshold (harder to reach)
            // Negative = forecast above threshold (easier to reach)
            forecastError = bracketValue - forecastMax;
            break;
          case 'or_below':
            // Positive = forecast above threshold (harder to reach)
            // Negative = forecast below threshold (easier to reach)
            forecastError = forecastMax - bracketValue;
            break;
          case 'exact':
            // Just the distance (direction doesn't matter for exact brackets)
            forecastError = Math.abs(bracketValue - forecastMax);
            break;
        }

        // Calculate edge if we have both model probability and market price
        if (modelProbability !== null && yesPrice !== null) {
          const edgeAnalysis = analyzeEdge(modelProbability, yesPrice);
          edge = edgeAnalysis.edge;
          edgePercent = edgeAnalysis.edgePercent;
          signal = edgeAnalysis.signal;
        }
      } else {
        console.warn(`  No weather forecast found for date: ${marketDateStr}`);
      }
    } else if (!parsedQuestion) {
      console.warn(`  Could not parse market question: ${question.substring(0, 50)}...`);
    }

    // Calculate minutes to close from endDate
    const endDateStr = safeString(market.endDate, '');
    let minutesToClose: number | null = null;
    if (endDateStr) {
      try {
        const endTime = new Date(endDateStr).getTime();
        if (!isNaN(endTime)) {
          const nowTime = Date.now();
          minutesToClose = Math.round((endTime - nowTime) / (1000 * 60));
        }
      } catch {
        // Leave as null if parsing fails
      }
    }

    // Compute executability fields
    const liquidity = safeNumber(market.liquidity, 0);
    const volume = safeNumber(market.volume, 0);
    const hasValidPrice = yesPrice !== null && yesPrice > 0;
    const meetsLiquidity = liquidity >= MIN_TRADE_LIQUIDITY;
    const meetsVolume = volume >= MIN_TRADE_VOLUME;
    const isDefaultPrice = yesPrice !== null && noPrice !== null
      ? DEFAULT_PRICE_PAIRS.some(pair =>
        Math.abs(yesPrice - pair.yes) <= DEFAULT_PRICE_EPSILON &&
        Math.abs(noPrice - pair.no) <= DEFAULT_PRICE_EPSILON
      ) || DEFAULT_PRICE_PAIRS.some(pair =>
        Math.abs(yesPrice - pair.no) <= DEFAULT_PRICE_EPSILON &&
        Math.abs(noPrice - pair.yes) <= DEFAULT_PRICE_EPSILON
      )
      : false;
    const isTradeable = hasValidPrice && meetsLiquidity && meetsVolume && !isDefaultPrice;
    const executed = signal !== null && signal !== 'HOLD' && isTradeable;

    if (signal !== null && signal !== 'HOLD' && !isTradeable) {
      const reasons: string[] = [];
      if (!hasValidPrice) {
        reasons.push('invalid price');
      }
      if (!meetsLiquidity) {
        reasons.push(`insufficient liquidity ($${liquidity.toFixed(2)} < $${MIN_TRADE_LIQUIDITY})`);
      }
      if (!meetsVolume) {
        reasons.push(`insufficient volume ($${volume.toFixed(2)} < $${MIN_TRADE_VOLUME})`);
      }
      if (isDefaultPrice) {
        reasons.push(`initialization price (${yesPrice?.toFixed(3)}/${noPrice?.toFixed(3)})`);
      }
      console.log(`  Skipping trade for ${marketId.substring(0, 8)}...: ${reasons.join(', ')}`);
    }

    // Entry fields - only set when executed === true
    // BUY → "YES", SELL → "NO"
    let entrySide: 'YES' | 'NO' | null = null;
    let entryYesPrice: number | null = null;
    let entryNoPrice: number | null = null;

    if (executed && yesPrice !== null) {
      entrySide = signal === 'BUY' ? 'YES' : 'NO';
      entryYesPrice = yesPrice;
      entryNoPrice = 1 - yesPrice;
    }

    return {
      marketId,
      question,
      temperatureValue: extractTemperatureFromQuestion(question),
      outcomes: outcomes.map(o => safeString(o, 'Unknown')),
      prices,
      yesPrice,
      endDate: endDateStr,
      minutesToClose,
      volume,
      liquidity,
      modelProbability,
      edge,
      edgePercent,
      signal,
      forecastError,
      isTradeable,
      executed,
      entrySide,
      entryYesPrice,
      entryNoPrice,
      resolvedOutcome: null,  // Set during settlement pass
      tradePnl: null,         // Calculated after settlement
    };
  } catch (error) {
    console.warn(`Failed to convert market to snapshot: ${formatError(error)}`);
    return null;
  }
}

// Extract unique dates from markets (based on endDate)
function extractUniqueDatesFromMarkets(markets: PolymarketMarket[]): Date[] {
  const dateStrings = new Set<string>();

  for (const market of safeArray(markets)) {
    if (market?.endDate) {
      try {
        // Parse the end date and normalize to just the date portion
        const endDate = new Date(market.endDate);
        if (!isNaN(endDate.getTime())) {
          const dateStr = endDate.toISOString().split('T')[0] ?? '';
          if (dateStr) {
            dateStrings.add(dateStr);
          }
        }
      } catch {
        // Skip invalid dates
      }
    }
  }

  // Convert back to Date objects
  return Array.from(dateStrings).map(dateStr => new Date(dateStr));
}

// Check if two sets of weather forecasts are identical (no change)
function areForecastsIdentical(
  oldForecasts: WeatherForecast[],
  newForecasts: WeatherForecast[]
): boolean {
  if (oldForecasts.length === 0 || oldForecasts.length !== newForecasts.length) {
    return false;
  }

  for (const newForecast of newForecasts) {
    const oldForecast = oldForecasts.find(f => f.date === newForecast.date);
    if (!oldForecast) {
      return false;
    }

    if (newForecast.maxTemperature !== oldForecast.maxTemperature ||
        newForecast.minTemperature !== oldForecast.minTemperature) {
      return false;
    }
  }

  return true;
}

// Get temperature changes between old and new forecasts
function getTemperatureChanges(
  oldForecasts: WeatherForecast[],
  newForecasts: WeatherForecast[]
): string[] {
  const changes: string[] = [];
  const timeStr = new Date().toTimeString().substring(0, 5); // HH:MM format

  for (const newForecast of newForecasts) {
    const oldForecast = oldForecasts.find(f => f.date === newForecast.date);
    if (oldForecast) {
      if (newForecast.maxTemperature !== oldForecast.maxTemperature) {
        changes.push(`${newForecast.date} max: ${oldForecast.maxTemperature} --> ${newForecast.maxTemperature} at ${timeStr}`);
      }
      if (newForecast.minTemperature !== oldForecast.minTemperature) {
        changes.push(`${newForecast.date} min: ${oldForecast.minTemperature} --> ${newForecast.minTemperature} at ${timeStr}`);
      }
    } else {
      // New date
      changes.push(`${newForecast.date}: max ${newForecast.maxTemperature}°C, min ${newForecast.minTemperature}°C (new)`);
    }
  }

  return changes;
}

// Combined market and weather check (runs every 10 minutes)
// Fetches markets once and uses the result for both weather and odds analysis
async function runScheduledCheck(isInitialRun: boolean = false): Promise<void> {
  const timestamp = formatTimestamp();
  console.log(`\n[${timestamp}] Scheduled check`);

  try {
    // Fetch markets ONCE - used for both weather dates and odds analysis
    const markets = await queryLondonTemperatureMarkets();

    if (!markets || markets.length === 0) {
      console.log('  No London temperature markets found.');
      previousMarketCount = 0;
      return;
    }

    // --- Weather Update ---
    // Extract unique dates from market end dates
    const marketDates = extractUniqueDatesFromMarkets(markets);

    if (marketDates.length > 0) {
      // Store previous forecasts for comparison
      const previousForecasts = [...latestWeatherForecasts];

      // Fetch weather for each market date
      const forecasts = await getWeatherForDatesMulti(
        {
          openWeather: OPENWEATHER_API_KEY,
          ...(TOMORROW_API_KEY ? { tomorrow: TOMORROW_API_KEY } : {}),
        },
        marketDates,
        'best_effort'
      );
      const newForecasts = safeArray(forecasts);

      // Check if temperatures changed
      if (!areForecastsIdentical(previousForecasts, newForecasts)) {
        // Update stored forecasts
        latestWeatherForecasts = newForecasts;

        // Show changes in compact format if we have previous data
        if (previousForecasts.length > 0 && !isInitialRun) {
          const changes = getTemperatureChanges(previousForecasts, newForecasts);
          for (const change of changes) {
            console.log(`  ${change}`);
          }
        } else {
          // First run - show consolidated weather info
          const dateList = latestWeatherForecasts.map(f => f.date).join(', ');
          console.log(`  Weather for ${latestWeatherForecasts.length} date(s): ${dateList}`);
          for (const forecast of latestWeatherForecasts) {
            if (forecast) {
              const date = safeString(forecast.date, 'Unknown date');
              const maxTemp = safeNumber(forecast.maxTemperature, 0);
              const minTemp = safeNumber(forecast.minTemperature, 0);
              let providerNote = '';
              if (forecast.providerTemps) {
                const providerDetails: string[] = [];
                if (forecast.providerTemps.openweather) {
                  providerDetails.push(
                    `openweather ${forecast.providerTemps.openweather.max}°C/${forecast.providerTemps.openweather.min}°C`
                  );
                }
                if (forecast.providerTemps.tomorrow) {
                  providerDetails.push(
                    `tomorrow ${forecast.providerTemps.tomorrow.max}°C/${forecast.providerTemps.tomorrow.min}°C`
                  );
                }
                if (providerDetails.length > 0) {
                  providerNote = ` (providers: ${providerDetails.join(', ')})`;
                }
              }
              console.log(`    ${date}: max ${maxTemp}°C, min ${minTemp}°C${providerNote}`);
            }
          }
        }
      } else {
        const dateList = marketDates.map(d => d.toISOString().split('T')[0]).join(', ');
        console.log(`  Weather for ${marketDates.length} date(s) unchanged (${dateList})`);
      }
    }

    // --- Market Odds Analysis ---
    // Convert markets to snapshots using current weather forecasts
    const marketSnapshots = safeArray(markets)
      .map(m => marketToSnapshot(m, latestWeatherForecasts))
      .filter((s): s is MarketSnapshot => s !== null);

    // Show full market questions only on initial run or if count changed
    const marketCountChanged = markets.length !== previousMarketCount;
    if (isInitialRun || marketCountChanged) {
      if (marketCountChanged && !isInitialRun) {
        console.log(`  Market count changed: ${previousMarketCount} → ${markets.length}`);
      }
      console.log(`  ${markets.length} market(s):`);
      marketSnapshots.forEach((snapshot, index) => {
        console.log(`    ${index + 1}. ${snapshot.question}`);
      });
      console.log('');
    }
    previousMarketCount = markets.length;

    // Always show the probability/edge table (compact format)
    marketSnapshots.forEach((snapshot, index) => {
      // Format market price
      const marketPct = snapshot.yesPrice !== null
        ? (snapshot.yesPrice * 100).toFixed(1) + '%'
        : 'N/A';

      // Format model probability
      const modelPct = snapshot.modelProbability !== null
        ? (snapshot.modelProbability * 100).toFixed(1) + '%'
        : 'N/A';

      // Format edge (only show if significant > 5%)
      let edgeStr = '';
      if (snapshot.edge !== null && Math.abs(snapshot.edge) > 0.05) {
        const edgeSign = snapshot.edge >= 0 ? '+' : '';
        edgeStr = ` Edge:${edgeSign}${(snapshot.edge * 100).toFixed(1)}%`;
      }

      // Format signal
      const signalStr = snapshot.signal && snapshot.signal !== 'HOLD' ? ` [${snapshot.signal}]` : '';

      // Extract short temp label from question (e.g., "8°C" from "Will the highest recorded temperature...")
      const tempMatch = snapshot.question.match(/(\d+(?:\.\d+)?)\s*[°º]?\s*C/i);
      const tempLabel = tempMatch ? `${tempMatch[1]}°C` : `#${index + 1}`;

      console.log(`  ${tempLabel}: Mkt ${marketPct} | Model ${modelPct}${edgeStr}${signalStr}`);
    });

    // Log monitoring snapshot (raw observation data) - returns snapshotId for correlation
    const snapshotId = appendMonitoringSnapshot(
      safeArray(latestWeatherForecasts),
      marketSnapshots
    );

    // Log decision record (model outputs) - returns decisionId for correlation
    const decisionId = appendDecisionRecord(
      snapshotId,
      marketSnapshots,
      (endDate: string) => {
        try {
          return endDate ? new Date(endDate).toISOString().split('T')[0] ?? null : null;
        } catch {
          return null;
        }
      }
    );

    // Process position management (create positions, check DECIDED_95, close positions)
    // Pass correlation IDs for tracing
    processPositionManagement(marketSnapshots, snapshotId, decisionId);

    // Run settlement check using the same market data
    await runSettlementPass(marketSnapshots);

  } catch (error) {
    console.error(`  Error in scheduled check: ${formatError(error)}`);
  }
}

// Initialize wallet and trading client
async function initializeClient(): Promise<ClobClient> {
  console.log('Initializing wallet and trading client...');

  try {
    // Create wallet
    const wallet = new Wallet(PRIVATE_KEY);
    console.log('  Wallet address:', wallet.address);

    // Create temp client to get API credentials
    const tempClient = new ClobClient(HOST, CHAIN_ID, wallet);
    const apiCreds = await tempClient.createOrDeriveApiKey();

    // Create real trading client
    const signatureType = 0;
    const client = new ClobClient(
      HOST,
      CHAIN_ID,
      wallet,
      apiCreds,
      signatureType
    );

    console.log('  Trading client initialized successfully!');
    return client;
  } catch (error) {
    console.error(`Failed to initialize trading client: ${formatError(error)}`);
    throw error;
  }
}

// Main monitoring function
async function startMonitoring(): Promise<void> {
  // Initialize log directories before anything else
  initializeLogs();

  console.log('='.repeat(60));
  console.log('POLYMARKET WEATHER MONITORING');
  console.log('='.repeat(60));
  console.log(`Started at: ${formatTimestamp()}`);
  console.log(`Scheduled checks every 10 minutes at :${MARKET_CHECK_MINUTES.join(', :')} past the hour`);
  console.log('');
  console.log('Log files:');
  console.log(`  Monitoring: ${getLogFilePath()}`);
  console.log(`  Decisions:  ${getDecisionsLogPath()}`);
  console.log(`  Settlement: ${getSettlementLogFilePath()}`);
  console.log(`  Positions:  ${getPositionsFilePath()}`);
  console.log(`  Reports:    ${getDailyReportsFilePath()}`);
  console.log('='.repeat(60));

  // Load already settled markets to avoid duplicate processing
  loadSettledMarketIds();
  console.log(`Loaded ${getSettledMarketCount()} previously settled market(s).`);

  // Load positions data for early closing system
  loadPositionsData();

  // Initialize trading client (for future trading functionality)
  console.log('\n--- Initialization ---');
  let client: ClobClient | null = null;
  try {
    client = await initializeClient();
  } catch (error) {
    console.error(`Warning: Failed to initialize trading client: ${formatError(error)}`);
    console.log('Continuing with monitoring only (no trading capabilities)...');
  }

  // Initial data collection - fetch markets and weather together
  console.log('\n--- Initial Data Collection ---');
  try {
    await runScheduledCheck(true); // true = initial run, show full details
  } catch (error) {
    console.error(`Initial check failed: ${formatError(error)}`);
  }

  // Set up clock-aligned scheduling (single scheduler for combined check)
  console.log('\n--- Monitoring Loop ---');
  const scheduler = new ClockAlignedScheduler(MARKET_CHECK_MINUTES, () => runScheduledCheck(false), 'scheduled check');

  scheduler.start();

  console.log('Monitoring started. Press Ctrl+C to stop.');

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\nShutting down monitoring...');
    scheduler.stop();
    console.log(`Final log file: ${getLogFilePath()}`);
    console.log(`Settlement log: ${getSettlementLogFilePath()}`);
    console.log('Goodbye!');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n\nReceived SIGTERM, shutting down...');
    scheduler.stop();
    process.exit(0);
  });
}

// Run the monitoring
startMonitoring().catch((error) => {
  console.error(`Fatal error starting monitoring: ${formatError(error)}`);
  process.exit(1);
});
