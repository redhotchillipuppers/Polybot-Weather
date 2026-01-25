// Market monitoring script - collects weather forecasts and market odds over time
import dotenv from 'dotenv';
import { Wallet } from 'ethers';
import { ClobClient } from '@polymarket/clob-client';
import { getLondonWeatherForecast, getWeatherForDates } from './weather.js';
import { queryLondonTemperatureMarkets } from './polymarket.js';
import type { WeatherForecast, PolymarketMarket } from './types.js';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY!;
const HOST = 'https://clob.polymarket.com';
const CHAIN_ID = 137;

// Scheduling configuration
const MARKET_CHECK_MINUTES = [0, 20, 40]; // Run at :00, :20, :40
const WEATHER_CHECK_MINUTES = [0]; // Run on the hour only

// Data structure for logging
interface MarketSnapshot {
  marketId: string;
  question: string;
  temperatureValue: string | null; // Extracted temperature from question
  outcomes: string[];
  prices: number[];
  yesPrice: number | null;
  endDate: string;
}

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
  // Match patterns like "8°C or higher", "below 5°C", "7°C to 9°C"
  const tempMatch = question.match(/(\d+(?:\.\d+)?)\s*°?C/i);
  return tempMatch ? tempMatch[1] : null;
}

// Convert market to snapshot format
function marketToSnapshot(market: PolymarketMarket): MarketSnapshot {
  // Find YES price (typically first outcome or explicit "Yes")
  let yesPrice: number | null = null;
  const yesIndex = market.outcomes.findIndex(o =>
    o.toLowerCase() === 'yes' || o.toLowerCase().includes('yes')
  );
  if (yesIndex !== -1 && market.prices[yesIndex] !== undefined) {
    yesPrice = market.prices[yesIndex];
  } else if (market.prices.length > 0) {
    yesPrice = market.prices[0]; // Default to first price
  }

  return {
    marketId: market.id,
    question: market.question,
    temperatureValue: extractTemperatureFromQuestion(market.question),
    outcomes: market.outcomes,
    prices: market.prices,
    yesPrice,
    endDate: market.endDate,
  };
}

// Extract unique dates from markets (based on endDate)
function extractUniqueDatesFromMarkets(markets: PolymarketMarket[]): Date[] {
  const dateStrings = new Set<string>();

  for (const market of markets) {
    if (market.endDate) {
      // Parse the end date and normalize to just the date portion
      const endDate = new Date(market.endDate);
      const dateStr = endDate.toISOString().split('T')[0];
      dateStrings.add(dateStr);
    }
  }

  // Convert back to Date objects
  return Array.from(dateStrings).map(dateStr => new Date(dateStr));
}

// Read existing log entries from file
function readLogFile(): MonitoringEntry[] {
  const logPath = getLogFilePath();
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

// Append entry to log file
function appendToLog(entry: MonitoringEntry): void {
  const logPath = getLogFilePath();
  const entries = readLogFile();
  entries.push(entry);

  try {
    fs.writeFileSync(logPath, JSON.stringify(entries, null, 2), 'utf-8');
    console.log(`  Logged to: ${logPath}`);
  } catch (error) {
    console.error('Error writing to log file:', error);
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
      await this.callback();
      this.scheduleNext();
    }, delay);
  }
}

// Check market odds (runs every 15 minutes)
async function checkMarketOdds(): Promise<void> {
  const timestamp = formatTimestamp();
  console.log(`\n[$${timestamp}] Checking market odds...`);

  try {
    const markets = await queryLondonTemperatureMarkets();

    if (markets.length === 0) {
      console.log('  No London temperature markets found.');
    } else {
      console.log(`  Found ${markets.length} market(s):`);

      markets.forEach((market, index) => {
        const snapshot = marketToSnapshot(market);
        const yesPercentage = snapshot.yesPrice !== null
          ? (snapshot.yesPrice * 100).toFixed(1) + '%'
          : 'N/A';
        console.log(`    ${index + 1}. ${market.question}`);
        console.log(`       YES price: ${yesPercentage}`);
      });
    }

    // Log entry with current weather forecasts
    const entry: MonitoringEntry = {
      timestamp: new Date().toISOString(),
      entryType: 'market_check',
      weatherForecast: latestWeatherForecasts[0] ?? null,
      weatherForecasts: latestWeatherForecasts,
      markets: markets.map(marketToSnapshot),
    };

    appendToLog(entry);

  } catch (error) {
    console.error('  Error checking market odds:', error instanceof Error ? error.message : error);
  }
}

// Fetch weather forecast (runs every 60 minutes)
async function checkWeatherForecast(): Promise<void> {
  const timestamp = formatTimestamp();
  console.log(`\n[${timestamp}] Fetching weather forecasts...`);

  try {
    // First, fetch markets to know what dates we need weather for
    const markets = await queryLondonTemperatureMarkets();

    // Extract unique dates from market end dates
    const marketDates = extractUniqueDatesFromMarkets(markets);

    if (marketDates.length === 0) {
      console.log('  No market dates found, skipping weather fetch.');
      return;
    }

    console.log(`  Market dates found: ${marketDates.map(d => d.toISOString().split('T')[0]).join(', ')}`);

    // Fetch weather for each market date
    const forecasts = await getWeatherForDates(OPENWEATHER_API_KEY, marketDates);
    latestWeatherForecasts = forecasts;

    console.log(`  Fetched weather for ${forecasts.length} date(s):`);
    for (const forecast of forecasts) {
      console.log(`    ${forecast.date}: max ${forecast.maxTemperature}°C, min ${forecast.minTemperature}°C (${forecast.description})`);
    }

    const entry: MonitoringEntry = {
      timestamp: new Date().toISOString(),
      entryType: 'weather_check',
      weatherForecast: forecasts[0] ?? null,
      weatherForecasts: forecasts,
      markets: markets.map(marketToSnapshot),
    };

    appendToLog(entry);

  } catch (error) {
    console.error('  Error fetching weather forecast:', error instanceof Error ? error.message : error);
  }
}

// Initialize wallet and trading client
async function initializeClient(): Promise<ClobClient> {
  console.log('Initializing wallet and trading client...');

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
}

// Main monitoring function
async function startMonitoring(): Promise<void> {
  console.log('='.repeat(60));
  console.log('POLYMARKET WEATHER MONITORING');
  console.log('='.repeat(60));
  console.log(`Started at: ${formatTimestamp()}`);
  console.log(`Market checks at: :${MARKET_CHECK_MINUTES.join(', :')} past the hour`);
  console.log(`Weather checks at: :${WEATHER_CHECK_MINUTES.join(', :')} past the hour`);
  console.log(`Log file: ${getLogFilePath()}`);
  console.log('='.repeat(60));

  // Initialize trading client (for future trading functionality)
  let client: ClobClient | null = null;
  try {
    client = await initializeClient();
  } catch (error) {
    console.error('Warning: Failed to initialize trading client:', error instanceof Error ? error.message : error);
    console.log('Continuing with monitoring only (no trading capabilities)...');
  }

  // Initial data collection - fetch both weather and markets
  console.log('\nPerforming initial data collection...');
  await checkWeatherForecast();

  // Also do an explicit odds check on startup
  await checkMarketOdds();

  // Set up clock-aligned scheduling
  console.log('\nScheduling recurring checks...');
  const marketScheduler = new ClockAlignedScheduler(MARKET_CHECK_MINUTES, checkMarketOdds, 'market check');
  const weatherScheduler = new ClockAlignedScheduler(WEATHER_CHECK_MINUTES, checkWeatherForecast, 'weather check');

  marketScheduler.start();
  weatherScheduler.start();

  console.log('\nMonitoring started. Press Ctrl+C to stop.');

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
  console.error('Fatal error starting monitoring:', error);
  process.exit(1);
});
