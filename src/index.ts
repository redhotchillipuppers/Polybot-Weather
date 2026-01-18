import dotenv from 'dotenv';
import { Wallet } from 'ethers';
import { ClobClient } from '@polymarket/clob-client';
import { getLondonWeatherForecast } from './weather.js';

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

  // TODO: Query Polymarket markets
  // TODO: Calculate edge
  // TODO: Place trade if profitable
}

main().catch(console.error);