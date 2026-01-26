// Polymarket API integration

import type { PolymarketMarket } from './types.js';
import { fetchWithRetry, formatForLog, getErrorMessage } from './api-utils.js';

const GAMMA_API_URL = 'https://gamma-api.polymarket.com';

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

export async function queryLondonTemperatureMarkets(): Promise<PolymarketMarket[]> {
  try {
    let allMarkets: any[] = [];

    // Try fetching specific event by slug (correct path from docs: /events/slug/{slug})
    // Generate slugs dynamically for today and next few days
    const eventSlugs = generateUpcomingEventSlugs(3);

    console.log('Trying to fetch London temperature events by slug...');

    for (const slug of eventSlugs) {
      console.log(`  Trying slug: ${slug}`);
      try {
        const eventResponse = await fetchWithRetry(
          `${GAMMA_API_URL}/events/slug/${slug}`,
          undefined,
          { maxRetries: 2, retryOn429: true }
        );

        if (eventResponse && eventResponse.ok) {
          try {
            const eventData = await eventResponse.json();
            const eventTitle = formatForLog(eventData?.title, 'Unknown');
            console.log(`  ✓ Found event: "${eventTitle}"`);

            if (eventData?.markets && Array.isArray(eventData.markets)) {
              console.log(`    Markets in event: ${eventData.markets.length}`);
              allMarkets.push(...eventData.markets);
            }
          } catch (parseError) {
            console.log(`  ✗ Failed to parse event response: ${getErrorMessage(parseError)}`);
          }
        } else {
          const status = eventResponse?.status ?? 'no response';
          console.log(`  ✗ Event not found (${status})`);
        }
      } catch (fetchError) {
        console.log(`  ✗ Error fetching slug ${slug}: ${getErrorMessage(fetchError)}`);
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
          { maxRetries: 3, retryOn429: true }
        );

        if (eventsResponse && eventsResponse.ok) {
          try {
            const eventsData = await eventsResponse.json();
            const events = Array.isArray(eventsData) ? eventsData : (eventsData?.data || []);

            console.log(`Fetched ${events.length} events`);

            // Debug: show first few event titles to see what we're getting
            console.log('\nSample event titles:');
            events.slice(0, 5).forEach((e: any, i: number) => {
              const title = formatForLog(e?.title, 'No title');
              const closed = formatForLog(e?.closed, 'unknown');
              console.log(`  ${i + 1}. "${title}" (closed: ${closed})`);
            });

            // Filter for London temperature events
            const londonEvents = events.filter((e: any) => {
              const title = (e?.title || '').toLowerCase();
              return title.includes('london') && (title.includes('temperature') || title.includes('temp'));
            });

            console.log(`Found ${londonEvents.length} London temperature events`);

            if (londonEvents.length > 0) {
              console.log('\nLondon temperature events:');
              londonEvents.forEach((e: any, i: number) => {
                const title = formatForLog(e?.title, 'No title');
                const slug = formatForLog(e?.slug, 'no-slug');
                const marketCount = e?.markets?.length ?? 0;
                console.log(`  ${i + 1}. ${title} (slug: ${slug})`);
                console.log(`     Markets in event: ${marketCount}`);
              });

              // Extract all markets from these events
              londonEvents.forEach((event: any) => {
                if (event?.markets && Array.isArray(event.markets)) {
                  allMarkets.push(...event.markets);
                }
              });

              console.log(`\nTotal markets extracted from events: ${allMarkets.length}`);
            }
          } catch (parseError) {
            console.log(`  Failed to parse events response: ${getErrorMessage(parseError)}`);
          }
        } else {
          const status = eventsResponse?.status ?? 'no response';
          const statusText = eventsResponse?.statusText ?? 'unknown';
          console.log(`Events fetch failed: ${status} ${statusText}`);
        }
      } catch (fetchError) {
        console.log(`  Error fetching events: ${getErrorMessage(fetchError)}`);
      }
    }

    // If we didn't find any markets through events, fall back to direct market search
    if (allMarkets.length === 0) {
      console.log('\nNo markets found in events, trying direct market search...');
      try {
        const response = await fetchWithRetry(
          `${GAMMA_API_URL}/markets?limit=100&closed=false`,
          undefined,
          { maxRetries: 3, retryOn429: true }
        );

        if (!response) {
          console.log('  Failed to fetch markets after retries');
        } else if (!response.ok) {
          console.log(`  Failed to fetch markets: ${response.status} ${response.statusText}`);
        } else {
          try {
            const data = await response.json();
            const markets = Array.isArray(data) ? data : (data?.data || []);

            console.log(`Fetched ${markets.length} markets from fallback`);

            // Filter for London temperature
            allMarkets = markets.filter((m: any) => {
              const question = (m?.question || '').toLowerCase();
              return question.includes('london') && (question.includes('temperature') || question.includes('temp'));
            });

            console.log(`Found ${allMarkets.length} London temperature markets`);
          } catch (parseError) {
            console.log(`  Failed to parse markets response: ${getErrorMessage(parseError)}`);
          }
        }
      } catch (fetchError) {
        console.log(`  Error fetching markets: ${getErrorMessage(fetchError)}`);
      }
    }

    // Show the London temperature markets we found
    if (allMarkets.length > 0) {
      console.log('\nMarkets found:');
      allMarkets.forEach((m: any, i: number) => {
        const question = formatForLog(m?.question, 'No question');
        const endDate = formatForLog(m?.endDateIso || m?.end_date_iso || m?.endDate, 'No date');
        console.log(`  ${i + 1}. ${question}`);
        console.log(`     Closes: ${endDate}`);
      });
    }

    // Filter by date - markets closing in next 3 days
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const filteredMarkets = allMarkets.filter((market: any) => {
      if (!market) return false;
      const endDateStr = market.endDateIso || market.end_date_iso || market.endDate;
      if (!endDateStr) return false;

      try {
        const endDate = new Date(endDateStr);
        return !isNaN(endDate.getTime()) && endDate >= now && endDate <= threeDaysFromNow;
      } catch {
        return false;
      }
    });

    console.log(`\nAfter date filtering (next 3 days): ${filteredMarkets.length} markets`);

    // Map to our PolymarketMarket interface with null safety
    return filteredMarkets.map((market: any) => {
      // Parse outcomes - could be array, JSON string, or CSV string
      let outcomes: string[];
      if (Array.isArray(market?.outcomes)) {
        outcomes = market.outcomes.map((o: any) => String(o ?? 'Unknown'));
      } else if (typeof market?.outcomes === 'string') {
        // Try parsing as JSON first
        try {
          const parsed = JSON.parse(market.outcomes);
          outcomes = Array.isArray(parsed) ? parsed.map((o: any) => String(o ?? 'Unknown')) : [market.outcomes];
        } catch {
          // If not JSON, try comma-separated
          outcomes = market.outcomes.split(',').map((s: string) => s.trim() || 'Unknown');
        }
      } else if (market?.outcome_tokens && Array.isArray(market.outcome_tokens)) {
        outcomes = market.outcome_tokens.map((t: any) => String(t?.outcome ?? 'Unknown'));
      } else {
        outcomes = ['Yes', 'No'];
      }

      // Parse prices - could be array, JSON string, or CSV string
      let prices: number[];
      if (Array.isArray(market?.outcomePrices)) {
        prices = market.outcomePrices.map((p: any) => {
          const num = Number(p);
          return isNaN(num) ? 0 : num;
        });
      } else if (typeof market?.outcomePrices === 'string') {
        // Try parsing as JSON first
        try {
          const parsed = JSON.parse(market.outcomePrices);
          if (Array.isArray(parsed)) {
            prices = parsed.map((p: any) => {
              const num = Number(p);
              return isNaN(num) ? 0 : num;
            });
          } else {
            const num = Number(parsed);
            prices = [isNaN(num) ? 0 : num];
          }
        } catch {
          // If not JSON, try comma-separated
          prices = market.outcomePrices.split(',').map((s: string) => {
            const num = Number(s.trim());
            return isNaN(num) ? 0 : num;
          });
        }
      } else if (Array.isArray(market?.outcome_prices)) {
        prices = market.outcome_prices.map((p: any) => {
          const num = Number(p);
          return isNaN(num) ? 0 : num;
        });
      } else {
        prices = outcomes.map(() => 0);
      }

      // Extract volume and liquidity with fallbacks (API returns strings)
      const volumeRaw = market?.volume ?? market?.volumeNum ?? market?.total_volume ?? 0;
      const liquidityRaw = market?.liquidity ?? market?.liquidityNum ?? market?.total_liquidity ?? 0;
      const volume = Number(volumeRaw) || 0;
      const liquidity = Number(liquidityRaw) || 0;

      return {
        id: String(market?.id || market?.condition_id || market?.market_id || 'unknown'),
        question: String(market?.question || market?.title || market?.description || 'Unknown market'),
        outcomes,
        prices,
        endDate: String(market?.end_date_iso || market?.end_date || market?.endDate || market?.close_time || market?.closeTime || ''),
        volume,
        liquidity
      };
    });
  } catch (error) {
    console.error(`Error querying Polymarket markets: ${getErrorMessage(error)}`);
    return []; // Return empty array instead of throwing
  }
}
