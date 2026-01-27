import dotenv from 'dotenv';
import { Wallet } from 'ethers';
import { ClobClient } from '@polymarket/clob-client';
import { getLondonWeatherForecast } from './weather.js';
import { queryLondonTemperatureMarkets } from './polymarket.js';
import { formatError, safeArray, safeNumber, safeString } from './api-utils.js';

// Load environment variables
dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY!;
const HOST = 'https://clob.polymarket.com';
const CHAIN_ID = 137;

// Main function
async function main() {
  console.log('Starting weather bot...');

  try {
    // Step 1: Create wallet
    const wallet = new Wallet(PRIVATE_KEY);
    console.log('Wallet address:', wallet.address);

    // Step 2: Create temp client to get API credentials
    const tempClient = new ClobClient(HOST, CHAIN_ID, wallet);
    const apiCreds = await tempClient.createOrDeriveApiKey();

    // Step 3: Create real trading client
    const signatureType = 0;
    const client = new ClobClient(
      HOST,
      CHAIN_ID,
      wallet,
      apiCreds,
      signatureType
    );

    console.log('Bot initialized successfully!');

    // Fetch weather forecast
    console.log('\nFetching London weather forecast...');
    try {
      const forecast = await getLondonWeatherForecast(OPENWEATHER_API_KEY);
      const date = safeString(forecast?.date, 'Unknown date');
      const maxTemp = safeNumber(forecast?.maxTemperature, 0);
      console.log(`Day after tomorrow (${date}): Predicted max temp ${maxTemp}°C`);
    } catch (error) {
      console.error(`Failed to fetch weather forecast: ${formatError(error)}`);
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
          const question = safeString(market?.question, 'Unknown market');
          const marketId = safeString(market?.id, 'unknown');
          const endDate = market?.endDate ? new Date(market.endDate).toLocaleString() : 'Unknown';
          const outcomes = safeArray(market?.outcomes);
          const prices = safeArray(market?.prices);

          console.log(`${index + 1}. ${question}`);
          console.log(`   Market ID: ${marketId}`);
          console.log(`   Closes: ${endDate}`);
          console.log(`   Current odds:`);

          outcomes.forEach((outcome, i) => {
            const price = safeNumber(prices[i], 0);
            const percentage = (price * 100).toFixed(1);
            console.log(`     ${safeString(outcome, 'Unknown')}: ${percentage}% (${price.toFixed(3)})`);
          });
          console.log('');
        });
      }
    } catch (error) {
      console.error(`Failed to query Polymarket markets: ${formatError(error)}`);
    }

    // TODO: Calculate edge
    // TODO: Place trade if profitable
  } catch (error) {
    console.error(`Fatal error in main: ${formatError(error)}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Unhandled error: ${formatError(error)}`);
  process.exit(1);
});
