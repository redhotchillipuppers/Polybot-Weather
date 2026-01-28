// Polymarket API integration

import type { PolymarketMarket, MarketSnapshot } from './types.js';
import { fetchWithRetry, formatError, safeArray, safeNumber, safeString, safeJsonParse } from './api-utils.js';
import { GAMMA_API_URL, MARKET_LOOKAHEAD_DAYS } from './config/constants.js';

// Retry options for Polymarket API
const POLYMARKET_RETRY_OPTIONS = {
  maxRetries: 3,
  initialDelayMs: 1000,
};

// Generate event slugs for upcoming days
function generateUpcomingEventSlugs(daysAhead: number = MARKET_LOOKAHEAD_DAYS): string[] {
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
    const eventSlugs = generateUpcomingEventSlugs(MARKET_LOOKAHEAD_DAYS);

    // Track summary stats for consolidated logging
    let eventsFound = 0;
    let totalMarketsFromSlugs = 0;

    for (const slug of eventSlugs) {
      try {
        const eventResponse = await fetchWithRetry(
          `${GAMMA_API_URL}/events/slug/${slug}`,
          undefined,
          POLYMARKET_RETRY_OPTIONS
        );

        if (eventResponse.ok) {
          const eventData = await eventResponse.json();
          eventsFound++;

          const markets = safeArray(eventData?.markets);
          if (markets.length > 0) {
            totalMarketsFromSlugs += markets.length;
            allMarkets.push(...markets);
          }
        }
        // Silent on 404s - expected for dates without markets
      } catch (error) {
        // Only log actual errors, not 404s
        console.warn(`  Error fetching slug ${slug}: ${formatError(error)}`);
      }
    }

    // Single summary line for slug fetch results
    if (eventsFound > 0) {
      console.log(`Found ${eventsFound} event(s) (${totalMarketsFromSlugs} markets total)`);
    }

    // If no luck with slugs, fall back to searching events
    if (allMarkets.length === 0) {
      console.log('Falling back to event search...');

      try {
        const eventsResponse = await fetchWithRetry(
          `${GAMMA_API_URL}/events?limit=200`,
          undefined,
          POLYMARKET_RETRY_OPTIONS
        );

        if (eventsResponse.ok) {
          const eventsData = await eventsResponse.json();
          const events = Array.isArray(eventsData) ? eventsData : safeArray(eventsData?.data);

          // Filter for London temperature events
          const londonEvents = events.filter((e: any) => {
            const title = safeString(e?.title, '').toLowerCase();
            return title.includes('london') && (title.includes('temperature') || title.includes('temp'));
          });

          if (londonEvents.length > 0) {
            // Extract all markets from these events
            let marketCount = 0;
            londonEvents.forEach((event: any) => {
              const markets = safeArray(event?.markets);
              marketCount += markets.length;
              allMarkets.push(...markets);
            });

            console.log(`Found ${londonEvents.length} event(s) (${marketCount} markets total)`);
          }
        } else {
          console.error(`Events fetch failed: ${eventsResponse.status} ${eventsResponse.statusText}`);
        }
      } catch (error) {
        console.error(`Error searching events: ${formatError(error)}`);
      }
    }

    // If we didn't find any markets through events, fall back to direct market search
    if (allMarkets.length === 0) {
      console.log('Falling back to direct market search...');

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

        // Filter for London temperature
        allMarkets = markets.filter((m: any) => {
          const question = safeString(m?.question, '').toLowerCase();
          return question.includes('london') && (question.includes('temperature') || question.includes('temp'));
        });

        if (allMarkets.length > 0) {
          console.log(`Found ${allMarkets.length} London temperature market(s)`);
        }
      } catch (error) {
        console.error(`Error in direct market search: ${formatError(error)}`);
      }
    }

    // Filter by date - markets closing in next N days
    const now = new Date();
    const lookaheadDate = new Date(now.getTime() + MARKET_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

    const filteredMarkets = allMarkets.filter((market: any) => {
      const endDateStr = market?.endDateIso || market?.end_date_iso || market?.endDate;
      if (!endDateStr) return false;

      try {
        const endDate = new Date(endDateStr);
        return endDate >= now && endDate <= lookaheadDate;
      } catch {
        return false;
      }
    });

    // Show consolidated filtering info - extract unique dates
    if (filteredMarkets.length > 0 && filteredMarkets.length !== allMarkets.length) {
      const uniqueDates = new Set<string>();
      filteredMarkets.forEach((m: any) => {
        const endDateStr = m?.endDateIso || m?.end_date_iso || m?.endDate;
        if (endDateStr) {
          const dateOnly = endDateStr.split('T')[0];
          if (dateOnly) uniqueDates.add(dateOnly);
        }
      });
      const dateList = Array.from(uniqueDates).sort().join(', ');
      console.log(`Filtered to ${filteredMarkets.length} markets for dates: ${dateList}`);
    }

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
        ),
        volume: safeNumber(market?.volume ?? market?.volumeNum ?? market?.total_volume, 0),
        liquidity: safeNumber(market?.liquidity ?? market?.liquidityNum ?? market?.total_liquidity, 0),
      };
    });
  } catch (error) {
    console.error(`Error querying Polymarket markets: ${formatError(error)}`);
    // Return empty array instead of throwing - graceful degradation
    return [];
  }
}

// Fetch resolved outcome for a market by ID
// Returns 'YES' or 'NO' if resolved, null if not yet resolved or error
export async function fetchResolvedOutcome(marketId: string): Promise<'YES' | 'NO' | null> {
  if (!marketId || marketId === 'unknown') {
    return null;
  }

  try {
    const response = await fetchWithRetry(
      `${GAMMA_API_URL}/markets/${marketId}`,
      undefined,
      POLYMARKET_RETRY_OPTIONS
    );

    if (!response.ok) {
      console.warn(`Failed to fetch market ${marketId}: ${response.status}`);
      return null;
    }

    const market = await response.json();

    // Check if market is resolved
    // Polymarket uses various fields to indicate resolution
    const resolved = market?.resolved || market?.is_resolved || market?.active === false;
    if (!resolved) {
      return null;
    }

    // Get the winning outcome
    // Different API formats use different field names
    const winningOutcome = market?.winningOutcome ||
                          market?.winning_outcome ||
                          market?.resolution ||
                          market?.resolutionOutcome;

    if (winningOutcome) {
      const outcome = safeString(winningOutcome, '').toUpperCase();
      if (outcome === 'YES' || outcome === '1' || outcome === 'TRUE') {
        return 'YES';
      }
      if (outcome === 'NO' || outcome === '0' || outcome === 'FALSE') {
        return 'NO';
      }
    }

    // Alternative: check outcome prices (1.0 = winner, 0.0 = loser)
    const outcomePrices = market?.outcomePrices || market?.outcome_prices;
    if (outcomePrices) {
      const prices = typeof outcomePrices === 'string'
        ? safeJsonParse<number[]>(outcomePrices, [])
        : safeArray(outcomePrices);

      if (prices.length >= 2) {
        const yesPrice = safeNumber(prices[0], 0);
        const noPrice = safeNumber(prices[1], 0);
        if (yesPrice >= 0.99) return 'YES';
        if (noPrice >= 0.99) return 'NO';
      }
    }

    return null;
  } catch (error) {
    console.warn(`Error fetching resolved outcome for ${marketId}: ${formatError(error)}`);
    return null;
  }
}

// Calculate trade P&L based on entry side and resolved outcome
// Assumes stake = 1 unit per trade
export function calculateTradePnl(
  entrySide: 'YES' | 'NO' | null,
  resolvedOutcome: 'YES' | 'NO' | null,
  entryYesPrice: number | null,
  entryNoPrice: number | null
): number | null {
  if (!entrySide || !resolvedOutcome) {
    return null;
  }

  if (entrySide === 'YES') {
    if (entryYesPrice === null) return null;
    // If resolved YES: profit = (1 - entryYesPrice)
    // If resolved NO: loss = -entryYesPrice
    return resolvedOutcome === 'YES'
      ? (1 - entryYesPrice)
      : (-entryYesPrice);
  } else {
    // entrySide === 'NO'
    if (entryNoPrice === null) return null;
    // If resolved NO: profit = (1 - entryNoPrice)
    // If resolved YES: loss = -entryNoPrice
    return resolvedOutcome === 'NO'
      ? (1 - entryNoPrice)
      : (-entryNoPrice);
  }
}
