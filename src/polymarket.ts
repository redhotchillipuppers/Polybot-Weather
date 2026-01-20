// Polymarket API integration

import type { PolymarketMarket } from './types.js';

const GAMMA_API_URL = 'https://gamma-api.polymarket.com';

export async function queryLondonTemperatureMarkets(): Promise<PolymarketMarket[]> {
  try {
    let allMarkets: any[] = [];

    // First, try to find events with London temperature
    console.log('Searching for London temperature events...');
    const eventsResponse = await fetch(`${GAMMA_API_URL}/events?limit=100&closed=false`);

    if (eventsResponse.ok) {
      const eventsData = await eventsResponse.json();
      const events = Array.isArray(eventsData) ? eventsData : (eventsData.data || []);

      console.log(`Fetched ${events.length} events`);

      // Filter for London temperature events
      const londonEvents = events.filter((e: any) => {
        const title = (e.title || '').toLowerCase();
        return title.includes('london') && (title.includes('temperature') || title.includes('temp'));
      });

      console.log(`Found ${londonEvents.length} London temperature events`);

      if (londonEvents.length > 0) {
        console.log('\nLondon temperature events:');
        londonEvents.forEach((e: any, i: number) => {
          console.log(`  ${i + 1}. ${e.title} (slug: ${e.slug})`);
          console.log(`     Markets in event: ${e.markets?.length || 0}`);
        });

        // Extract all markets from these events
        londonEvents.forEach((event: any) => {
          if (event.markets && Array.isArray(event.markets)) {
            allMarkets.push(...event.markets);
          }
        });

        console.log(`\nTotal markets extracted from events: ${allMarkets.length}`);
      }
    } else {
      console.log(`Events fetch failed: ${eventsResponse.status} ${eventsResponse.statusText}`);
    }

    // If we didn't find any markets through events, fall back to direct market search
    if (allMarkets.length === 0) {
      console.log('\nNo markets found in events, trying direct market search...');
      const response = await fetch(`${GAMMA_API_URL}/markets?limit=100&closed=false`);

      if (!response.ok) {
        throw new Error(`Failed to fetch markets: ${response.statusText}`);
      }

      const data = await response.json();
      const markets = Array.isArray(data) ? data : (data.data || []);

      console.log(`Fetched ${markets.length} markets from fallback`);

      // Filter for London temperature
      allMarkets = markets.filter((m: any) => {
        const question = (m.question || '').toLowerCase();
        return question.includes('london') && (question.includes('temperature') || question.includes('temp'));
      });

      console.log(`Found ${allMarkets.length} London temperature markets`);
    }

    // Show the London temperature markets we found
    if (allMarkets.length > 0) {
      console.log('\nMarkets found:');
      allMarkets.forEach((m: any, i: number) => {
        console.log(`  ${i + 1}. ${m.question}`);
        console.log(`     Closes: ${m.endDateIso || m.end_date_iso || m.endDate}`);
      });
    }

    // Filter by date - markets closing in next 3 days
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const filteredMarkets = allMarkets.filter((market: any) => {
      const endDateStr = market.endDateIso || market.end_date_iso || market.endDate;
      if (!endDateStr) return false;

      const endDate = new Date(endDateStr);
      return endDate >= now && endDate <= threeDaysFromNow;
    });

    console.log(`\nAfter date filtering (next 3 days): ${filteredMarkets.length} markets`);

    // Map to our PolymarketMarket interface
    return filteredMarkets.map((market: any) => {
      // Parse outcomes - could be array, JSON string, or CSV string
      let outcomes: string[];
      if (Array.isArray(market.outcomes)) {
        outcomes = market.outcomes;
      } else if (typeof market.outcomes === 'string') {
        // Try parsing as JSON first
        try {
          outcomes = JSON.parse(market.outcomes);
        } catch {
          // If not JSON, try comma-separated
          outcomes = market.outcomes.split(',');
        }
      } else if (market.outcome_tokens) {
        outcomes = market.outcome_tokens.map((t: any) => t.outcome);
      } else {
        outcomes = ['Yes', 'No'];
      }

      // Parse prices - could be array, JSON string, or CSV string
      let prices: number[];
      if (Array.isArray(market.outcomePrices)) {
        prices = market.outcomePrices.map(Number);
      } else if (typeof market.outcomePrices === 'string') {
        // Try parsing as JSON first
        try {
          const parsed = JSON.parse(market.outcomePrices);
          prices = Array.isArray(parsed) ? parsed.map(Number) : [Number(parsed)];
        } catch {
          // If not JSON, try comma-separated
          prices = market.outcomePrices.split(',').map(Number);
        }
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
