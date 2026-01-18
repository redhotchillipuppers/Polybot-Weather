import dotenv from 'dotenv';
import { Wallet } from 'ethers';
import { ClobClient } from '@polymarket/clob-client';
import { getLondonWeatherForecast } from './weather.js';
import { queryLondonTemperatureMarkets } from './polymarket.js';

// Load environment variables
dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY!;
const HOST = 'https://clob.polymarket.com';
const CHAIN_ID = 137;

// Main function
async function main() {
  console.log('Starting weather bot...');

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
    console.log(`Day after tomorrow (${forecast.date}): Predicted max temp ${forecast.maxTemperature}°C`);
  } catch (error) {
    console.error('Failed to fetch weather forecast:', error);
  }

  // Query Polymarket markets
  console.log('\nQuerying Polymarket for London temperature markets...');
  try {
    const markets = await queryLondonTemperatureMarkets();

    if (markets.length === 0) {
      console.log('No London temperature markets found closing in the next 1-3 days.');
    } else {
      console.log(`Found ${markets.length} market(s):\n`);

      markets.forEach((market, index) => {
        console.log(`${index + 1}. ${market.question}`);
        console.log(`   Market ID: ${market.id}`);
        console.log(`   Closes: ${new Date(market.endDate).toLocaleString()}`);
        console.log(`   Current odds:`);
        market.outcomes.forEach((outcome, i) => {
          const price = market.prices[i];
          const percentage = (price * 100).toFixed(1);
          console.log(`     ${outcome}: ${percentage}% (${price.toFixed(3)})`);
        });
        console.log('');
      });
    }
  } catch (error) {
    console.error('Failed to query Polymarket markets:', error);
  }

  // TODO: Calculate edge
  // TODO: Place trade if profitable
}

main().catch(console.error);