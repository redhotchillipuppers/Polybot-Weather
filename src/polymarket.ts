// Polymarket API integration

import type { PolymarketMarket } from './types.js';

const GAMMA_API_URL = 'https://gamma-api.polymarket.com/markets';

export async function queryLondonTemperatureMarkets(): Promise<PolymarketMarket[]> {
  try {
    // Fetch more markets with potential filtering
    const allMarkets: any[] = [];

    // Try multiple offsets to get more markets (fetch up to 500 markets)
    for (let offset = 0; offset < 500; offset += 100) {
      const searchParams = new URLSearchParams({
        limit: '100',
        offset: offset.toString(),
        closed: 'false',
      });
      const response = await fetch(`${GAMMA_API_URL}?${searchParams}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch markets: ${response.statusText}`);
      }

      const data = await response.json();
      const batch = Array.isArray(data) ? data : (data.data || []);

      if (batch.length === 0) {
        break; // No more markets available
      }

      allMarkets.push(...batch);
      console.log(`Fetched batch ${offset / 100 + 1}: ${batch.length} markets (total: ${allMarkets.length})`);

      // If we got fewer than 100, we've reached the end
      if (batch.length < 100) {
        break;
      }
    }

    console.log(`Fetched ${allMarkets.length} total markets from Polymarket`);

    // Debug: show sample market structure
    if (allMarkets.length > 0) {
      console.log('Sample market fields:', Object.keys(allMarkets[0]));
    }

    const markets = allMarkets;

    // Filter for London temperature markets
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    // Debug: count how many markets match each keyword
    const londonMarkets = markets.filter((m: any) =>
      (m.question || m.title || '').toLowerCase().includes('london')
    );
    const tempMarkets = markets.filter((m: any) => {
      const q = (m.question || m.title || '').toLowerCase();
      return q.includes('temperature') || q.includes('temp');
    });

    console.log(`Markets with "london": ${londonMarkets.length}`);
    console.log(`Markets with "temperature" or "temp": ${tempMarkets.length}`);

    // Show first few London markets for debugging
    if (londonMarkets.length > 0) {
      console.log('\nSample London markets:');
      londonMarkets.slice(0, 3).forEach((m: any) => {
        console.log(`  - ${m.question}`);
      });
    }

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
