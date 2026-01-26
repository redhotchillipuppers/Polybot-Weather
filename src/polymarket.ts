// Polymarket API integration

import type { PolymarketMarket } from './types.js';
import { fetchWithRetry, formatError, safeArray, safeNumber, safeString, safeJsonParse } from './api-utils.js';

const GAMMA_API_URL = 'https://gamma-api.polymarket.com';

// Retry options for Polymarket API
const POLYMARKET_RETRY_OPTIONS = {
  maxRetries: 3,
  initialDelayMs: 1000,
};

// Generate event slugs for upcoming days
function generateUpcomingEventSlugs(daysAhead: number = 3): string[] {
  const slugs: string[] = [];
  const months = ['january', 'february', 'march', 'april', 'may', 'june',
                  'july', 'august', 'september', 'october', 'november', 'december'];

  for (let i = 0; i <= daysAhead; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    const month = months[date.getMonth()];
    const day = date.getDate();
    slugs.push(`highest-temperature-in-london-on-${month}-${day}`);
  }

  return slugs;
}

// Parse outcomes from various formats (array, JSON string, or CSV string)
function parseOutcomes(market: any): string[] {
  try {
    if (Array.isArray(market.outcomes)) {
      return market.outcomes;
    }
    if (typeof market.outcomes === 'string') {
      const parsed = safeJsonParse<string[]>(market.outcomes, []);
      if (parsed.length > 0) return parsed;
      // If not JSON, try comma-separated
      return market.outcomes.split(',').map((s: string) => s.trim());
    }
    if (market.outcome_tokens) {
      return safeArray(market.outcome_tokens).map((t: any) => safeString(t?.outcome, 'Unknown'));
    }
  } catch (error) {
    console.warn(`Failed to parse outcomes: ${formatError(error)}`);
  }
  return ['Yes', 'No'];
}

// Parse prices from various formats (array, JSON string, or CSV string)
function parsePrices(market: any, outcomeCount: number): number[] {
  try {
    if (Array.isArray(market.outcomePrices)) {
      return market.outcomePrices.map((p: any) => safeNumber(p, 0));
    }
    if (typeof market.outcomePrices === 'string') {
      const parsed = safeJsonParse<any>(market.outcomePrices, null);
      if (parsed !== null) {
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        return arr.map((p: any) => safeNumber(p, 0));
      }
      // If not JSON, try comma-separated
      return market.outcomePrices.split(',').map((p: string) => safeNumber(p.trim(), 0));
    }
    if (Array.isArray(market.outcome_prices)) {
      return market.outcome_prices.map((p: any) => safeNumber(p, 0));
    }
  } catch (error) {
    console.warn(`Failed to parse prices: ${formatError(error)}`);
  }
  return Array(outcomeCount).fill(0);
}

export async function queryLondonTemperatureMarkets(): Promise<PolymarketMarket[]> {
  let allMarkets: any[] = [];

  try {
    // Try fetching specific event by slug (correct path from docs: /events/slug/{slug})
    // Generate slugs dynamically for today and next few days
    const eventSlugs = generateUpcomingEventSlugs(3);

    console.log('Trying to fetch London temperature events by slug...');

    for (const slug of eventSlugs) {
      try {
        console.log(`  Trying slug: ${slug}`);
        const eventResponse = await fetchWithRetry(
          `${GAMMA_API_URL}/events/slug/${slug}`,
          undefined,
          POLYMARKET_RETRY_OPTIONS
        );

        if (eventResponse.ok) {
          const eventData = await eventResponse.json();
          const title = safeString(eventData?.title, 'Unknown event');
          console.log(`  ✓ Found event: "${title}"`);

          const markets = safeArray(eventData?.markets);
          if (markets.length > 0) {
            console.log(`    Markets in event: ${markets.length}`);
            allMarkets.push(...markets);
          }
        } else {
          console.log(`  ✗ Event not found (${eventResponse.status})`);
        }
      } catch (error) {
        // Log individual slug failures but continue with others
        console.warn(`  ✗ Error fetching slug ${slug}: ${formatError(error)}`);
      }
    }

    console.log(`\nTotal markets found via slugs: ${allMarkets.length}`);

    // If no luck with slugs, fall back to searching events
    if (allMarkets.length === 0) {
      console.log('\nFalling back to event search...');

      try {
        const eventsResponse = await fetchWithRetry(
          `${GAMMA_API_URL}/events?limit=200`,
          undefined,
          POLYMARKET_RETRY_OPTIONS
        );

        if (eventsResponse.ok) {
          const eventsData = await eventsResponse.json();
          const events = Array.isArray(eventsData) ? eventsData : safeArray(eventsData?.data);

          console.log(`Fetched ${events.length} events`);

          // Debug: show first few event titles to see what we're getting
          console.log('\nSample event titles:');
          events.slice(0, 5).forEach((e: any, i: number) => {
            const title = safeString(e?.title, 'No title');
            const closed = e?.closed ?? 'unknown';
            console.log(`  ${i + 1}. "${title}" (closed: ${closed})`);
          });

          // Filter for London temperature events
          const londonEvents = events.filter((e: any) => {
            const title = safeString(e?.title, '').toLowerCase();
            return title.includes('london') && (title.includes('temperature') || title.includes('temp'));
          });

          console.log(`Found ${londonEvents.length} London temperature events`);

          if (londonEvents.length > 0) {
            console.log('\nLondon temperature events:');
            londonEvents.forEach((e: any, i: number) => {
              const title = safeString(e?.title, 'No title');
              const slug = safeString(e?.slug, 'no-slug');
              const marketCount = safeArray(e?.markets).length;
              console.log(`  ${i + 1}. ${title} (slug: ${slug})`);
              console.log(`     Markets in event: ${marketCount}`);
            });

            // Extract all markets from these events
            londonEvents.forEach((event: any) => {
              const markets = safeArray(event?.markets);
              allMarkets.push(...markets);
            });

            console.log(`\nTotal markets extracted from events: ${allMarkets.length}`);
          }
        } else {
          console.log(`Events fetch failed: ${eventsResponse.status} ${eventsResponse.statusText}`);
        }
      } catch (error) {
        console.error(`Error searching events: ${formatError(error)}`);
      }
    }

    // If we didn't find any markets through events, fall back to direct market search
    if (allMarkets.length === 0) {
      console.log('\nNo markets found in events, trying direct market search...');

      try {
        const response = await fetchWithRetry(
          `${GAMMA_API_URL}/markets?limit=100&closed=false`,
          undefined,
          POLYMARKET_RETRY_OPTIONS
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch markets: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const markets = Array.isArray(data) ? data : safeArray(data?.data);

        console.log(`Fetched ${markets.length} markets from fallback`);

        // Filter for London temperature
        allMarkets = markets.filter((m: any) => {
          const question = safeString(m?.question, '').toLowerCase();
          return question.includes('london') && (question.includes('temperature') || question.includes('temp'));
        });

        console.log(`Found ${allMarkets.length} London temperature markets`);
      } catch (error) {
        console.error(`Error in direct market search: ${formatError(error)}`);
      }
    }

    // Show the London temperature markets we found
    if (allMarkets.length > 0) {
      console.log('\nMarkets found:');
      allMarkets.forEach((m: any, i: number) => {
        const question = safeString(m?.question, 'No question');
        const endDate = m?.endDateIso || m?.end_date_iso || m?.endDate || 'Unknown';
        console.log(`  ${i + 1}. ${question}`);
        console.log(`     Closes: ${endDate}`);
      });
    }

    // Filter by date - markets closing in next 3 days
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const filteredMarkets = allMarkets.filter((market: any) => {
      const endDateStr = market?.endDateIso || market?.end_date_iso || market?.endDate;
      if (!endDateStr) return false;

      try {
        const endDate = new Date(endDateStr);
        return endDate >= now && endDate <= threeDaysFromNow;
      } catch {
        return false;
      }
    });

    console.log(`\nAfter date filtering (next 3 days): ${filteredMarkets.length} markets`);

    // Map to our PolymarketMarket interface with safe accessors
    return filteredMarkets.map((market: any) => {
      const outcomes = parseOutcomes(market);
      const prices = parsePrices(market, outcomes.length);

      return {
        id: safeString(market?.id || market?.condition_id || market?.market_id, 'unknown'),
        question: safeString(market?.question || market?.title || market?.description, 'Unknown market'),
        outcomes,
        prices,
        endDate: safeString(
          market?.end_date_iso || market?.end_date || market?.endDate || market?.close_time || market?.closeTime,
          ''
        )
      };
    });
  } catch (error) {
    console.error(`Error querying Polymarket markets: ${formatError(error)}`);
    // Return empty array instead of throwing - graceful degradation
    return [];
  }
}
