// Market monitoring script - collects weather forecasts and market odds over time
import dotenv from 'dotenv';
import { Wallet } from 'ethers';
import { ClobClient } from '@polymarket/clob-client';
import { getLondonWeatherForecast, getWeatherForDates } from './weather.js';
import { queryLondonTemperatureMarkets } from './polymarket.js';
import type { WeatherForecast, PolymarketMarket } from './types.js';
import { getErrorMessage, formatForLog } from './api-utils.js';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const HOST = 'https://clob.polymarket.com';
const CHAIN_ID = 137;

// Intervals in milliseconds
const MARKET_CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes
const WEATHER_CHECK_INTERVAL = 60 * 60 * 1000; // 60 minutes

// Data structure for logging
interface MarketSnapshot {
  marketId: string;
  question: string;
  temperatureValue: string | null; // Extracted temperature from question
  outcomes: string[];
  prices: number[];
  yesPrice: number | null;
  endDate: string;
  volume: number;
  liquidity: number;
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
  return tempMatch && tempMatch[1] ? tempMatch[1] : null;
}

// Convert market to snapshot format with null safety
function marketToSnapshot(market: PolymarketMarket): MarketSnapshot {
  // Handle null/undefined market
  if (!market) {
    return {
      marketId: 'unknown',
      question: 'Unknown market',
      temperatureValue: null,
      outcomes: [],
      prices: [],
      yesPrice: null,
      endDate: '',
      volume: 0,
      liquidity: 0,
    };
  }

  const outcomes = market.outcomes ?? [];
  const prices = market.prices ?? [];

  // Find YES price (typically first outcome or explicit "Yes")
  let yesPrice: number | null = null;
  const yesIndex = outcomes.findIndex(o =>
    o?.toLowerCase() === 'yes' || o?.toLowerCase().includes('yes')
  );
  if (yesIndex !== -1 && prices[yesIndex] !== undefined) {
    const price = prices[yesIndex];
    yesPrice = typeof price === 'number' && !isNaN(price) ? price : null;
  } else if (prices.length > 0 && typeof prices[0] === 'number' && !isNaN(prices[0])) {
    yesPrice = prices[0]; // Default to first price
  }

  return {
    marketId: String(market.id ?? 'unknown'),
    question: String(market.question ?? 'Unknown market'),
    temperatureValue: extractTemperatureFromQuestion(market.question ?? ''),
    outcomes: outcomes.map(o => String(o ?? 'Unknown')),
    prices: prices.map(p => typeof p === 'number' && !isNaN(p) ? p : 0),
    yesPrice,
    endDate: String(market.endDate ?? ''),
    volume: typeof market.volume === 'number' && !isNaN(market.volume) ? market.volume : 0,
    liquidity: typeof market.liquidity === 'number' && !isNaN(market.liquidity) ? market.liquidity : 0,
  };
}

// Extract unique dates from markets (based on endDate)
function extractUniqueDatesFromMarkets(markets: PolymarketMarket[]): Date[] {
  const dateStrings = new Set<string>();

  for (const market of markets) {
    if (market?.endDate) {
      // Parse the end date and normalize to just the date portion
      const endDate = new Date(market.endDate);
      if (!isNaN(endDate.getTime())) {
        const dateStr = endDate.toISOString().split('T')[0] ?? '';
        if (dateStr) {
          dateStrings.add(dateStr);
        }
      }
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

// Check market odds (runs every 15 minutes)
async function checkMarketOdds(): Promise<void> {
  const timestamp = formatTimestamp();
  console.log(`\n[${timestamp}] Checking market odds...`);

  try {
    const markets = await queryLondonTemperatureMarkets();

    if (!markets || markets.length === 0) {
      console.log('  No London temperature markets found.');
    } else {
      console.log(`  Found ${markets.length} market(s):`);

      markets.forEach((market, index) => {
        if (!market) return;
        const snapshot = marketToSnapshot(market);
        const yesPercentage = snapshot.yesPrice !== null
          ? (snapshot.yesPrice * 100).toFixed(1) + '%'
          : 'N/A';
        const volumeStr = snapshot.volume > 0
          ? `$${snapshot.volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
          : 'N/A';
        const liquidityStr = snapshot.liquidity > 0
          ? `$${snapshot.liquidity.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
          : 'N/A';
        const question = formatForLog(market.question, 'Unknown market');
        console.log(`    ${index + 1}. ${question}`);
        console.log(`       YES price: ${yesPercentage} | Volume: ${volumeStr} | Liquidity: ${liquidityStr}`);
      });
    }

    // Log entry with current weather forecasts
    const entry: MonitoringEntry = {
      timestamp: new Date().toISOString(),
      entryType: 'market_check',
      weatherForecast: latestWeatherForecasts[0] ?? null,
      weatherForecasts: latestWeatherForecasts,
      markets: (markets ?? []).filter(m => m != null).map(marketToSnapshot),
    };

    appendToLog(entry);

  } catch (error) {
    console.error(`  Error checking market odds: ${getErrorMessage(error)}`);
  }
}

// Fetch weather forecast (runs every 60 minutes)
async function checkWeatherForecast(): Promise<void> {
  const timestamp = formatTimestamp();
  console.log(`\n[${timestamp}] Fetching weather forecasts...`);

  if (!OPENWEATHER_API_KEY) {
    console.error('  Cannot fetch weather: OPENWEATHER_API_KEY not set');
    return;
  }

  try {
    // First, fetch markets to know what dates we need weather for
    const markets = await queryLondonTemperatureMarkets();

    // Extract unique dates from market end dates
    const marketDates = extractUniqueDatesFromMarkets(markets ?? []);

    if (marketDates.length === 0) {
      console.log('  No market dates found, skipping weather fetch.');
      return;
    }

    console.log(`  Market dates found: ${marketDates.map(d => d.toISOString().split('T')[0] ?? 'unknown').join(', ')}`);

    // Fetch weather for each market date
    const forecasts = await getWeatherForDates(OPENWEATHER_API_KEY, marketDates);
    latestWeatherForecasts = forecasts ?? [];

    console.log(`  Fetched weather for ${forecasts.length} date(s):`);
    for (const forecast of forecasts) {
      if (!forecast) continue;
      const date = formatForLog(forecast.date, 'Unknown');
      const maxTemp = formatForLog(forecast.maxTemperature, 'N/A');
      const minTemp = formatForLog(forecast.minTemperature, 'N/A');
      const desc = formatForLog(forecast.description, 'No description');
      console.log(`    ${date}: max ${maxTemp}°C, min ${minTemp}°C (${desc})`);
    }

    const entry: MonitoringEntry = {
      timestamp: new Date().toISOString(),
      entryType: 'weather_check',
      weatherForecast: forecasts[0] ?? null,
      weatherForecasts: forecasts,
      markets: (markets ?? []).filter(m => m != null).map(marketToSnapshot),
    };

    appendToLog(entry);

  } catch (error) {
    console.error(`  Error fetching weather forecast: ${getErrorMessage(error)}`);
  }
}

// Initialize wallet and trading client
async function initializeClient(): Promise<ClobClient | null> {
  console.log('Initializing wallet and trading client...');

  if (!PRIVATE_KEY) {
    console.error('  Cannot initialize client: PRIVATE_KEY not set');
    return null;
  }

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
    console.error(`  Error initializing trading client: ${getErrorMessage(error)}`);
    return null;
  }
}

// Main monitoring function
async function startMonitoring(): Promise<void> {
  console.log('='.repeat(60));
  console.log('POLYMARKET WEATHER MONITORING');
  console.log('='.repeat(60));
  console.log(`Started at: ${formatTimestamp()}`);
  console.log(`Market check interval: ${MARKET_CHECK_INTERVAL / 60000} minutes`);
  console.log(`Weather check interval: ${WEATHER_CHECK_INTERVAL / 60000} minutes`);
  console.log(`Log file: ${getLogFilePath()}`);
  console.log('='.repeat(60));

  // Initialize trading client (for future trading functionality)
  const client = await initializeClient();
  if (!client) {
    console.log('Continuing with monitoring only (no trading capabilities)...');
  }

  // Initial data collection - fetch both weather and markets
  console.log('\nPerforming initial data collection...');
  await checkWeatherForecast();

  // Also do an explicit odds check on startup
  await checkMarketOdds();

  // Set up intervals
  const marketInterval = setInterval(async () => {
    await checkMarketOdds();
  }, MARKET_CHECK_INTERVAL);

  const weatherInterval = setInterval(async () => {
    await checkWeatherForecast();
  }, WEATHER_CHECK_INTERVAL);

  console.log('\nMonitoring started. Press Ctrl+C to stop.');
  console.log(`Next market check in ${MARKET_CHECK_INTERVAL / 60000} minutes`);
  console.log(`Next weather check in ${WEATHER_CHECK_INTERVAL / 60000} minutes`);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\nShutting down monitoring...');
    clearInterval(marketInterval);
    clearInterval(weatherInterval);
    console.log(`Final log file: ${getLogFilePath()}`);
    console.log('Goodbye!');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n\nReceived SIGTERM, shutting down...');
    clearInterval(marketInterval);
    clearInterval(weatherInterval);
    process.exit(0);
  });
}

// Run the monitoring
startMonitoring().catch((error) => {
  console.error(`Fatal error starting monitoring: ${getErrorMessage(error)}`);
  process.exit(1);
});
