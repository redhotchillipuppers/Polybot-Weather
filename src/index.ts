import dotenv from 'dotenv';
import { Wallet } from 'ethers';
import { ClobClient } from '@polymarket/clob-client';
import { fetchLondonWeatherForecast } from './weather.js';
import { findLondonTemperatureMarkets } from './polymarket.js';
import { calculateEdge, generateTradeOrder } from './strategy.js';

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

  // Main trading loop
  while (true) {
    try {
      console.log('\n--- Starting new trading cycle ---');

      // Step 4: Fetch weather forecast
      console.log('Fetching London weather forecast...');
      const forecast = await fetchLondonWeatherForecast(OPENWEATHER_API_KEY);
      console.log(`Forecast: ${forecast.maxTemp}°C max temp on ${forecast.date}`);

      // Step 5: Query Polymarket markets
      console.log('Searching for London temperature markets...');
      const markets = await findLondonTemperatureMarkets(client);
      console.log(`Found ${markets.length} relevant markets`);

      // Step 6: Calculate edge for each market
      for (const market of markets) {
        console.log(`\nAnalyzing market: ${market.question}`);
        const edge = calculateEdge(forecast, market);
        console.log(`Edge: ${(edge.expectedValue * 100).toFixed(2)}%, Recommendation: ${edge.recommendation}`);

        // Step 7: Place trade if profitable
        const tradeOrder = generateTradeOrder(edge);
        if (tradeOrder) {
          console.log(`Placing ${tradeOrder.side} order: ${tradeOrder.size} @ ${tradeOrder.price}`);
          // TODO: Execute trade via client.postOrder()
        }
      }

      // Wait before next cycle (e.g., 1 hour)
      console.log('\n--- Cycle complete. Waiting for next run ---');
      await new Promise(resolve => setTimeout(resolve, 60 * 60 * 1000));

    } catch (error) {
      console.error('Error in trading cycle:', error);
      // Wait 5 minutes before retrying on error
      await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
    }
  }
}

main().catch(console.error);