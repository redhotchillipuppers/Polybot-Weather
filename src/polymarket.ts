// Polymarket API integration

import type { PolymarketMarket } from './types.js';

const GAMMA_API_URL = 'https://gamma-api.polymarket.com/markets';

export async function queryLondonTemperatureMarkets(): Promise<PolymarketMarket[]> {
  try {
    const response = await fetch(GAMMA_API_URL);

    if (!response.ok) {
      throw new Error(`Failed to fetch markets: ${response.statusText}`);
    }

    const markets = await response.json();

    // Filter for London temperature markets that close in the next 1-3 days
    const now = new Date();
    const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const filteredMarkets = markets.filter((market: any) => {
      const question = market.question?.toLowerCase() || '';
      const hasLondon = question.includes('london');
      const hasTemperature = question.includes('temperature') || question.includes('temp');

      if (!hasLondon || !hasTemperature) {
        return false;
      }

      // Check if market closes in the next 1-3 days
      const endDate = new Date(market.end_date_iso || market.endDate);
      return endDate >= oneDayFromNow && endDate <= threeDaysFromNow;
    });

    // Map to our PolymarketMarket interface
    return filteredMarkets.map((market: any) => ({
      id: market.id || market.condition_id,
      question: market.question,
      outcomes: market.outcomes || ['Yes', 'No'],
      prices: market.outcomePrices ? market.outcomePrices.split(',').map(Number) : [0, 0],
      endDate: market.end_date_iso || market.endDate
    }));
  } catch (error) {
    console.error('Error querying Polymarket markets:', error);
    throw error;
  }
}
