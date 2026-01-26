import dotenv from 'dotenv';
import { Wallet } from 'ethers';
import { ClobClient } from '@polymarket/clob-client';
import { getLondonWeatherForecast } from './weather.js';
import { queryLondonTemperatureMarkets } from './polymarket.js';
import { getErrorMessage, formatForLog } from './api-utils.js';

// Load environment variables
dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const HOST = 'https://clob.polymarket.com';
const CHAIN_ID = 137;

// Main function
async function main() {
  console.log('Starting weather bot...');

  // Validate environment variables
  if (!PRIVATE_KEY) {
    console.error('Error: PRIVATE_KEY environment variable is not set');
    process.exit(1);
  }

  if (!OPENWEATHER_API_KEY) {
    console.error('Error: OPENWEATHER_API_KEY environment variable is not set');
    process.exit(1);
  }

  // Step 1: Create wallet
  let wallet: Wallet;
  try {
    wallet = new Wallet(PRIVATE_KEY);
    console.log('Wallet address:', wallet.address);
  } catch (error) {
    console.error(`Failed to create wallet: ${getErrorMessage(error)}`);
    process.exit(1);
  }

  // Step 2: Create temp client to get API credentials
  let client: ClobClient | null = null;
  try {
    const tempClient = new ClobClient(HOST, CHAIN_ID, wallet);
    const apiCreds = await tempClient.createOrDeriveApiKey();

    // Step 3: Create real trading client
    const signatureType = 0;
    client = new ClobClient(
      HOST,
      CHAIN_ID,
      wallet,
      apiCreds,
      signatureType
    );

    console.log('Bot initialized successfully!');
  } catch (error) {
    console.error(`Warning: Failed to initialize trading client: ${getErrorMessage(error)}`);
    console.log('Continuing without trading capabilities...');
  }

  // Fetch weather forecast
  console.log('\nFetching London weather forecast...');
  try {
    const forecast = await getLondonWeatherForecast(OPENWEATHER_API_KEY);
    if (forecast) {
      const date = formatForLog(forecast.date, 'Unknown date');
      const maxTemp = formatForLog(forecast.maxTemperature, 'N/A');
      console.log(`Day after tomorrow (${date}): Predicted max temp ${maxTemp}°C`);
    } else {
      console.log('Could not fetch weather forecast');
    }
  } catch (error) {
    console.error(`Failed to fetch weather forecast: ${getErrorMessage(error)}`);
  }

  // Query Polymarket markets
  console.log('\nQuerying Polymarket for London temperature markets...');
  try {
    const markets = await queryLondonTemperatureMarkets();

    if (!markets || markets.length === 0) {
      console.log('No London temperature markets found closing in the next 3 days.');
    } else {
      console.log(`Found ${markets.length} market(s):\n`);

      markets.forEach((market, index) => {
        const question = formatForLog(market?.question, 'Unknown market');
        const marketId = formatForLog(market?.id, 'Unknown ID');
        const endDate = market?.endDate ? new Date(market.endDate).toLocaleString() : 'Unknown';

        console.log(`${index + 1}. ${question}`);
        console.log(`   Market ID: ${marketId}`);
        console.log(`   Closes: ${endDate}`);
        console.log(`   Current odds:`);

        if (market?.outcomes && market?.prices) {
          market.outcomes.forEach((outcome, i) => {
            const price = market.prices[i] ?? 0;
            const percentage = (price * 100).toFixed(1);
            const outcomeStr = formatForLog(outcome, 'Unknown');
            console.log(`     ${outcomeStr}: ${percentage}% (${price.toFixed(3)})`);
          });
        } else {
          console.log(`     No odds data available`);
        }
        console.log('');
      });
    }
  } catch (error) {
    console.error(`Failed to query Polymarket markets: ${getErrorMessage(error)}`);
  }

  // TODO: Calculate edge
  // TODO: Place trade if profitable
}

main().catch((error) => {
  console.error(`Fatal error: ${getErrorMessage(error)}`);
  process.exit(1);
});