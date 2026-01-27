// Market monitoring script - collects weather forecasts and market odds over time
import dotenv from 'dotenv';
import { Wallet } from 'ethers';
import { ClobClient } from '@polymarket/clob-client';
import { getLondonWeatherForecast, getWeatherForDates } from './weather.js';
import { queryLondonTemperatureMarkets } from './polymarket.js';
import type { WeatherForecast, PolymarketMarket, MarketSnapshot, ParsedMarketQuestion } from './types.js';
import { formatError, safeArray, safeNumber, safeString } from './api-utils.js';
import { calculateMarketProbability, calculateHoursUntilResolution, analyzeEdge } from './probability-model.js';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY!;
const HOST = 'https://clob.polymarket.com';
const CHAIN_ID = 137;

// Scheduling configuration
const MARKET_CHECK_MINUTES = [0, 10, 20, 30, 40, 50]; // Run every 10 minutes
const WEATHER_CHECK_MINUTES = [0, 10, 20, 30, 40, 50]; // Run every 10 minutes

// MarketSnapshot is imported from types.ts

interface MonitoringEntry {
  timestamp: string;
  entryType: 'market_check' | 'weather_check' | 'combined';
  weatherForecast: WeatherForecast | null;  // Deprecated: kept for backwards compatibility
  weatherForecasts: WeatherForecast[];       // Weather forecasts matching market dates
  markets: MarketSnapshot[];
}

// State to track latest weather forecasts (only updates hourly)
let latestWeatherForecasts: WeatherForecast[] = [];

// Get log file path for today
function getLogFilePath(): string {
  const today = new Date().toISOString().split('T')[0];
  return path.join(process.cwd(), `market_monitoring_${today}.json`);
}

// Extract temperature value from market question
function extractTemperatureFromQuestion(question: string): string | null {
  if (!question) return null;
  // Match patterns like "8°C or higher", "below 5°C", "7°C to 9°C"
  const tempMatch = question.match(/(\d+(?:\.\d+)?)\s*°?C/i);
  return tempMatch && tempMatch[1] ? tempMatch[1] : null;
}

// Parse market question to extract bracket type and value
// Note: Uses flexible regex to handle different Unicode degree symbols (°, º, etc.)
function parseMarketQuestion(question: string): ParsedMarketQuestion | null {
  if (!question) return null;

  try {
    // Pattern: "X°C or higher" - flexible degree symbol matching
    const orHigherMatch = question.match(/(\d+(?:\.\d+)?)[°º\s]*C\s+or\s+higher/i);
    if (orHigherMatch && orHigherMatch[1]) {
      return {
        bracketType: 'or_higher',
        bracketValue: parseFloat(orHigherMatch[1]),
      };
    }

    // Pattern: "X°C or below" - flexible degree symbol matching
    const orBelowMatch = question.match(/(\d+(?:\.\d+)?)[°º\s]*C\s+or\s+below/i);
    if (orBelowMatch && orBelowMatch[1]) {
      return {
        bracketType: 'or_below',
        bracketValue: parseFloat(orBelowMatch[1]),
      };
    }

    // Pattern: exact temperature "X°C" (without "or higher" or "or below")
    // Must match "be X°C on" to distinguish from other temperature mentions
    const exactMatch = question.match(/be\s+(\d+(?:\.\d+)?)[°º\s]*C\s+on/i);
    if (exactMatch && exactMatch[1]) {
      return {
        bracketType: 'exact',
        bracketValue: parseFloat(exactMatch[1]),
      };
    }

    return null;
  } catch (error) {
    console.warn(`Failed to parse market question: ${formatError(error)}`);
    return null;
  }
}

// Extract date from market question (e.g., "on January 27" -> "2026-01-27")
function extractDateFromQuestion(question: string): string | null {
  if (!question) return null;

  try {
    // Simplified: just look for "Month Day" pattern directly
    // This avoids issues with matching "on" from "London"
    const dateMatch = question.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})/i);

    if (dateMatch && dateMatch[1] && dateMatch[2]) {
      const monthName = dateMatch[1];
      const day = parseInt(dateMatch[2], 10);

      const months: Record<string, number> = {
        january: 0, february: 1, march: 2, april: 3,
        may: 4, june: 5, july: 6, august: 7,
        september: 8, october: 9, november: 10, december: 11,
      };

      const monthNum = months[monthName.toLowerCase()];
      if (monthNum === undefined || isNaN(day)) {
        return null;
      }

      // Assume current year, or next year if the date has passed
      const now = new Date();
      let year = now.getFullYear();
      const testDate = new Date(year, monthNum, day);

      if (testDate < now) {
        year += 1;
      }

      const monthStr = String(monthNum + 1).padStart(2, '0');
      const dayStr = String(day).padStart(2, '0');
      return `${year}-${monthStr}-${dayStr}`;
    }

    return null;
  } catch (error) {
    console.warn(`Failed to extract date from question: ${formatError(error)}`);
    return null;
  }
}

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

    return {
      marketId: safeString(market.id, 'unknown'),
      question,
      temperatureValue: extractTemperatureFromQuestion(question),
      outcomes: outcomes.map(o => safeString(o, 'Unknown')),
      prices,
      yesPrice,
      endDate: safeString(market.endDate, ''),
      volume: safeNumber(market.volume, 0),
      liquidity: safeNumber(market.liquidity, 0),
      modelProbability,
      edge,
      edgePercent,
      signal,
      forecastError,
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

// Read existing log entries from file
function readLogFile(): MonitoringEntry[] {
  const logPath = getLogFilePath();
  try {
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf-8');
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (error) {
    console.error(`Error reading log file, starting fresh: ${formatError(error)}`);
  }
  return [];
}

// Append entry to log file (silent unless error - path shown in startup banner)
function appendToLog(entry: MonitoringEntry): void {
  const logPath = getLogFilePath();

  try {
    const entries = readLogFile();
    entries.push(entry);
    fs.writeFileSync(logPath, JSON.stringify(entries, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Error writing to log file: ${formatError(error)}`);
  }
}

// Format timestamp for console output
function formatTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

// Calculate milliseconds until the next scheduled minute
function getDelayUntilNextMinute(scheduledMinutes: number[]): number {
  if (scheduledMinutes.length === 0) {
    throw new Error('scheduledMinutes must not be empty');
  }

  const now = new Date();
  const currentMinute = now.getMinutes();
  const currentSeconds = now.getSeconds();
  const currentMs = now.getMilliseconds();

  // Find the next scheduled minute
  const nextMinute = scheduledMinutes.find(m => m > currentMinute);

  if (nextMinute === undefined) {
    // Next scheduled time is in the next hour
    const firstMinute = scheduledMinutes[0]!;
    const minutesUntil = 60 - currentMinute + firstMinute;
    return (minutesUntil * 60 - currentSeconds) * 1000 - currentMs;
  }

  const minutesUntil = nextMinute - currentMinute;
  return (minutesUntil * 60 - currentSeconds) * 1000 - currentMs;
}

// Scheduler class to manage clock-aligned scheduling with graceful shutdown
class ClockAlignedScheduler {
  private timeout: NodeJS.Timeout | null = null;
  private cancelled = false;

  constructor(
    private scheduledMinutes: number[],
    private callback: () => Promise<void>,
    private name: string
  ) {}

  start(): void {
    this.cancelled = false;
    this.scheduleNext();
  }

  stop(): void {
    this.cancelled = true;
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  private scheduleNext(): void {
    if (this.cancelled) return;

    const delay = getDelayUntilNextMinute(this.scheduledMinutes);
    const nextTime = new Date(Date.now() + delay);
    console.log(`  Next ${this.name} scheduled for ${nextTime.toISOString().replace('T', ' ').substring(0, 19)}`);

    this.timeout = setTimeout(async () => {
      if (this.cancelled) return;
      try {
        await this.callback();
      } catch (error) {
        console.error(`Error in ${this.name} callback: ${formatError(error)}`);
      }
      this.scheduleNext();
    }, delay);
  }
}

// Track previous market count for change detection
let previousMarketCount = 0;

// Check market odds (runs every 10 minutes)
async function checkMarketOdds(isInitialRun: boolean = false): Promise<void> {
  const timestamp = formatTimestamp();
  console.log(`\n[${timestamp}] Market odds`);

  try {
    const markets = await queryLondonTemperatureMarkets();

    if (!markets || markets.length === 0) {
      console.log('  No London temperature markets found.');
      previousMarketCount = 0;
    } else {
      // Convert markets to snapshots first
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

      // Log entry with current weather forecasts
      const entry: MonitoringEntry = {
        timestamp: new Date().toISOString(),
        entryType: 'market_check',
        weatherForecast: latestWeatherForecasts[0] ?? null,
        weatherForecasts: safeArray(latestWeatherForecasts),
        markets: marketSnapshots,
      };

      appendToLog(entry);
    }

  } catch (error) {
    console.error(`  Error checking market odds: ${formatError(error)}`);
  }
}

// Fetch weather forecast (runs every 10 minutes)
async function checkWeatherForecast(isInitialRun: boolean = false): Promise<void> {
  const timestamp = formatTimestamp();
  console.log(`\n[${timestamp}] Weather update`);

  try {
    // First, fetch markets to know what dates we need weather for
    const markets = await queryLondonTemperatureMarkets();

    // Extract unique dates from market end dates
    const marketDates = extractUniqueDatesFromMarkets(markets);

    if (marketDates.length === 0) {
      console.log('  No market dates found, skipping weather fetch.');
      return;
    }

    // Store previous forecasts for comparison
    const previousForecasts = [...latestWeatherForecasts];

    // Fetch weather for each market date
    const forecasts = await getWeatherForDates(OPENWEATHER_API_KEY, marketDates);
    const newForecasts = safeArray(forecasts);

    // Check if temperatures are identical to last check
    if (areForecastsIdentical(previousForecasts, newForecasts)) {
      const dateList = marketDates.map(d => d.toISOString().split('T')[0]).join(', ');
      console.log(`  Weather for ${marketDates.length} date(s) unchanged (${dateList})`);
      return;
    }

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
          console.log(`    ${date}: max ${maxTemp}°C, min ${minTemp}°C`);
        }
      }
    }

    // Convert markets to snapshots, filtering out null results
    const marketSnapshots = safeArray(markets)
      .map(m => marketToSnapshot(m, latestWeatherForecasts))
      .filter((s): s is MarketSnapshot => s !== null);

    const entry: MonitoringEntry = {
      timestamp: new Date().toISOString(),
      entryType: 'weather_check',
      weatherForecast: latestWeatherForecasts[0] ?? null,
      weatherForecasts: latestWeatherForecasts,
      markets: marketSnapshots,
    };

    appendToLog(entry);

  } catch (error) {
    console.error(`  Error fetching weather forecast: ${formatError(error)}`);
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
  console.log('='.repeat(60));
  console.log('POLYMARKET WEATHER MONITORING');
  console.log('='.repeat(60));
  console.log(`Started at: ${formatTimestamp()}`);
  console.log(`Checks every 10 minutes at :${MARKET_CHECK_MINUTES.join(', :')} past the hour`);
  console.log(`Log file: ${getLogFilePath()}`);
  console.log('='.repeat(60));

  // Initialize trading client (for future trading functionality)
  console.log('\n--- Initialization ---');
  let client: ClobClient | null = null;
  try {
    client = await initializeClient();
  } catch (error) {
    console.error(`Warning: Failed to initialize trading client: ${formatError(error)}`);
    console.log('Continuing with monitoring only (no trading capabilities)...');
  }

  // Initial data collection - fetch both weather and markets
  console.log('\n--- Initial Data Collection ---');
  try {
    await checkWeatherForecast(true); // true = initial run, show full details
  } catch (error) {
    console.error(`Initial weather check failed: ${formatError(error)}`);
  }

  // Also do an explicit odds check on startup
  try {
    await checkMarketOdds(true); // true = initial run, show full market list
  } catch (error) {
    console.error(`Initial market check failed: ${formatError(error)}`);
  }

  // Set up clock-aligned scheduling
  console.log('\n--- Monitoring Loop ---');
  const marketScheduler = new ClockAlignedScheduler(MARKET_CHECK_MINUTES, () => checkMarketOdds(false), 'market check');
  const weatherScheduler = new ClockAlignedScheduler(WEATHER_CHECK_MINUTES, () => checkWeatherForecast(false), 'weather check');

  marketScheduler.start();
  weatherScheduler.start();

  console.log('Monitoring started. Press Ctrl+C to stop.');

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\nShutting down monitoring...');
    marketScheduler.stop();
    weatherScheduler.stop();
    console.log(`Final log file: ${getLogFilePath()}`);
    console.log('Goodbye!');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n\nReceived SIGTERM, shutting down...');
    marketScheduler.stop();
    weatherScheduler.stop();
    process.exit(0);
  });
}

// Run the monitoring
startMonitoring().catch((error) => {
  console.error(`Fatal error starting monitoring: ${formatError(error)}`);
  process.exit(1);
});
