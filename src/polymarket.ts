// Polymarket API integration

import type { PolymarketMarket } from './types.js';

const GAMMA_API_URL = 'https://gamma-api.polymarket.com/markets';

export async function queryLondonTemperatureMarkets(): Promise<PolymarketMarket[]> {
  try {
    // Add query parameters to search for London temperature markets and increase limit
    const searchParams = new URLSearchParams({
      limit: '100',
      offset: '0',
      closed: 'false',
    });
    const response = await fetch(`${GAMMA_API_URL}?${searchParams}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch markets: ${response.statusText}`);
    }

    const data = await response.json();

    // Handle paginated response - API might return {data: [...]} or plain array
    const markets = Array.isArray(data) ? data : (data.data || []);
    console.log(`Fetched ${markets.length} total markets from Polymarket`);

    // Debug: show sample market structure
    if (markets.length > 0) {
      console.log('Sample market fields:', Object.keys(markets[0]));
    }

    // Filter for London temperature markets
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const filteredMarkets = markets.filter((market: any) => {
      // Try different field names for the question text
      const question = (market.question || market.title || market.description || '').toLowerCase();
      const hasLondon = question.includes('london');
      const hasTemperature = question.includes('temperature') || question.includes('temp');

      if (!hasLondon || !hasTemperature) {
        return false;
      }

      // Try different field names for end date
      const endDateStr = market.end_date_iso || market.end_date || market.endDate ||
                         market.close_time || market.closeTime;

      if (!endDateStr) {
        console.log(`Market "${market.question}" has no end date field`);
        return false;
      }

      const endDate = new Date(endDateStr);
      const inRange = endDate >= now && endDate <= threeDaysFromNow;

      console.log(`Market: "${market.question || market.title}" - Closes: ${endDate.toISOString()} - In range: ${inRange}`);

      return inRange;
    });

    console.log(`Found ${filteredMarkets.length} London temperature markets closing in next 3 days`);

    // Map to our PolymarketMarket interface
    return filteredMarkets.map((market: any) => ({
      id: market.id || market.condition_id || market.market_id,
      question: market.question || market.title || market.description,
      outcomes: market.outcomes || market.outcome_tokens?.map((t: any) => t.outcome) || ['Yes', 'No'],
      prices: market.outcomePrices
        ? market.outcomePrices.split(',').map(Number)
        : market.outcome_prices || [0, 0],
      endDate: market.end_date_iso || market.end_date || market.endDate || market.close_time || market.closeTime
    }));
  } catch (error) {
    console.error('Error querying Polymarket markets:', error);
    throw error;
  }
}
