// Polymarket API integration

import type { PolymarketMarket } from './types.js';

const GAMMA_API_URL = 'https://gamma-api.polymarket.com/markets';

export async function queryLondonTemperatureMarkets(): Promise<PolymarketMarket[]> {
  try {
    // Start simple - just get a few weather markets
    const searchParams = new URLSearchParams({
      limit: '5',
      closed: 'false',
    });
    const response = await fetch(`${GAMMA_API_URL}?${searchParams}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch markets: ${response.statusText}`);
    }

    const data = await response.json();
    const markets = Array.isArray(data) ? data : (data.data || []);

    console.log(`Fetched ${markets.length} total markets from Polymarket`);

    // Debug: show all markets with their categories
    markets.forEach((m: any, i: number) => {
      console.log(`${i + 1}. [${m.category || 'NO CATEGORY'}] ${m.question}`);
      console.log(`   Outcomes type: ${typeof m.outcomes}, value: ${JSON.stringify(m.outcomes)}`);
    });

    // For now, just return all markets to see what we get
    const filteredMarkets = markets;

    // Map to our PolymarketMarket interface
    return filteredMarkets.map((market: any) => {
      // Parse outcomes - could be array or string
      let outcomes: string[];
      if (Array.isArray(market.outcomes)) {
        outcomes = market.outcomes;
      } else if (typeof market.outcomes === 'string') {
        outcomes = market.outcomes.split(',');
      } else if (market.outcome_tokens) {
        outcomes = market.outcome_tokens.map((t: any) => t.outcome);
      } else {
        outcomes = ['Yes', 'No'];
      }

      // Parse prices - could be string or array
      let prices: number[];
      if (Array.isArray(market.outcomePrices)) {
        prices = market.outcomePrices.map(Number);
      } else if (typeof market.outcomePrices === 'string') {
        prices = market.outcomePrices.split(',').map(Number);
      } else if (Array.isArray(market.outcome_prices)) {
        prices = market.outcome_prices.map(Number);
      } else {
        prices = outcomes.map(() => 0);
      }

      return {
        id: market.id || market.condition_id || market.market_id,
        question: market.question || market.title || market.description,
        outcomes,
        prices,
        endDate: market.end_date_iso || market.end_date || market.endDate || market.close_time || market.closeTime
      };
    });
  } catch (error) {
    console.error('Error querying Polymarket markets:', error);
    throw error;
  }
}
