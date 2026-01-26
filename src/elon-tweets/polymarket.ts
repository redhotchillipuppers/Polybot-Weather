// Polymarket API integration for Elon Musk tweet markets

import type { ElonTweetMarket, TweetBracket, ElonTweetConfig, MarketSnapshot } from './types.js';
import { fetchWithRetry, formatForLog, getErrorMessage } from '../api-utils.js';

const GAMMA_API_URL = 'https://gamma-api.polymarket.com';

/**
 * Parse a tweet bracket string (e.g., "90-114", "400 or more", "89 or fewer")
 * Returns min/max tweet counts
 */
function parseBracketRange(outcome: string): { min: number | null; max: number | null } {
  const normalized = outcome.toLowerCase().trim();

  // Handle "X or fewer" pattern
  const orFewerMatch = normalized.match(/^(\d+)\s*(?:or\s*fewer|or\s*less|-?)$/i);
  if (orFewerMatch && orFewerMatch[1]) {
    return { min: null, max: parseInt(orFewerMatch[1], 10) };
  }

  // Handle "X or more" pattern
  const orMoreMatch = normalized.match(/^(\d+)\s*(?:or\s*more|\+?)$/i);
  if (orMoreMatch && orMoreMatch[1]) {
    return { min: parseInt(orMoreMatch[1], 10), max: null };
  }

  // Handle "X-Y" range pattern (e.g., "90-114", "115-139")
  const rangeMatch = normalized.match(/^(\d+)\s*[-–—to]\s*(\d+)$/);
  if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
    return {
      min: parseInt(rangeMatch[1], 10),
      max: parseInt(rangeMatch[2], 10)
    };
  }

  // Handle single number (rare but possible)
  const singleMatch = normalized.match(/^(\d+)$/);
  if (singleMatch && singleMatch[1]) {
    const num = parseInt(singleMatch[1], 10);
    return { min: num, max: num };
  }

  // Skip Yes/No outcomes silently (they're expected for binary markets)
  if (normalized === 'yes' || normalized === 'no') {
    return { min: null, max: null };
  }

  // Unknown format - only warn for unexpected patterns
  console.log(`  Warning: Could not parse bracket: "${outcome}"`);
  return { min: null, max: null };
}

/**
 * Extract date range from market question or metadata
 * Handles patterns like "Jan 25-26", "January 25 to February 1", etc.
 */
function extractDateRangeFromQuestion(question: string, endDate: string): { startDate: string; endDate: string } {
  // Default: use end date as both start and end (single day market)
  const defaultEndDate = new Date(endDate);
  const defaultDateStr = defaultEndDate.toISOString().split('T')[0] ?? endDate.split('T')[0] ?? endDate;
  const defaultResult = {
    startDate: defaultDateStr,
    endDate: defaultDateStr
  };

  // Try to extract date range from question
  // Pattern: "Jan 25-26" or "January 25-26"
  const shortRangeMatch = question.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\s*[-–—]\s*(\d{1,2})\b/i
  );

  if (shortRangeMatch && shortRangeMatch[1] && shortRangeMatch[2] && shortRangeMatch[3]) {
    const month = shortRangeMatch[1];
    const startDay = parseInt(shortRangeMatch[2], 10);
    const endDay = parseInt(shortRangeMatch[3], 10);

    const year = defaultEndDate.getFullYear();
    const monthIndex = getMonthIndex(month);

    if (monthIndex !== -1) {
      const start = new Date(Date.UTC(year, monthIndex, startDay));
      const end = new Date(Date.UTC(year, monthIndex, endDay));

      const startStr = start.toISOString().split('T')[0];
      const endStr = end.toISOString().split('T')[0];

      if (startStr && endStr) {
        return { startDate: startStr, endDate: endStr };
      }
    }
  }

  // Pattern: "January 25 to February 1"
  const longRangeMatch = question.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\s+(?:to|through|-)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\b/i
  );

  if (longRangeMatch && longRangeMatch[1] && longRangeMatch[2] && longRangeMatch[3] && longRangeMatch[4]) {
    const startMonth = longRangeMatch[1];
    const startDay = parseInt(longRangeMatch[2], 10);
    const endMonth = longRangeMatch[3];
    const endDay = parseInt(longRangeMatch[4], 10);

    const year = defaultEndDate.getFullYear();
    const startMonthIndex = getMonthIndex(startMonth);
    const endMonthIndex = getMonthIndex(endMonth);

    if (startMonthIndex !== -1 && endMonthIndex !== -1) {
      const start = new Date(Date.UTC(year, startMonthIndex, startDay));
      const end = new Date(Date.UTC(year, endMonthIndex, endDay));

      const startStr = start.toISOString().split('T')[0];
      const endStr = end.toISOString().split('T')[0];

      if (startStr && endStr) {
        return { startDate: startStr, endDate: endStr };
      }
    }
  }

  return defaultResult;
}

/**
 * Get month index from month name
 */
function getMonthIndex(month: string): number {
  const months: Record<string, number> = {
    'jan': 0, 'january': 0,
    'feb': 1, 'february': 1,
    'mar': 2, 'march': 2,
    'apr': 3, 'april': 3,
    'may': 4,
    'jun': 5, 'june': 5,
    'jul': 6, 'july': 6,
    'aug': 7, 'august': 7,
    'sep': 8, 'sept': 8, 'september': 8,
    'oct': 9, 'october': 9,
    'nov': 10, 'november': 10,
    'dec': 11, 'december': 11
  };

  return months[month.toLowerCase()] ?? -1;
}

/**
 * Check if a market is an Elon tweet count market
 */
function isElonTweetMarket(market: any): boolean {
  const question = (market.question || market.title || '').toLowerCase();
  const description = (market.description || '').toLowerCase();

  const combined = question + ' ' + description;

  // Must contain "elon" or "musk"
  const hasElon = combined.includes('elon') || combined.includes('musk');

  // Must contain tweet-related keywords
  const hasTweet = combined.includes('tweet') || combined.includes('post');

  // Must contain number/count indicators
  const hasCount = combined.includes('#') ||
                   combined.includes('number') ||
                   combined.includes('count') ||
                   combined.includes('how many') ||
                   /\d+\s*[-–—]\s*\d+/.test(combined);

  return hasElon && hasTweet && hasCount;
}

/**
 * Parse market data into ElonTweetMarket format
 */
function parseMarketData(market: any, eventData?: any): ElonTweetMarket | null {
  try {
    if (!market) {
      return null;
    }

    const question = String(market.question || market.title || '');
    const endDateStr = market.endDateIso || market.end_date_iso || market.endDate || market.close_time;

    if (!endDateStr) {
      const questionPreview = question.substring(0, 50) || 'Unknown';
      console.log(`  Skipping market without end date: ${questionPreview}...`);
      return null;
    }

    // Extract date range from question
    const { startDate, endDate } = extractDateRangeFromQuestion(question, endDateStr);

    // Parse outcomes into brackets with null safety
    let outcomes: string[] = [];
    if (Array.isArray(market.outcomes)) {
      outcomes = market.outcomes.map((o: any) => String(o ?? 'Unknown'));
    } else if (typeof market.outcomes === 'string') {
      try {
        const parsed = JSON.parse(market.outcomes);
        outcomes = Array.isArray(parsed) ? parsed.map((o: any) => String(o ?? 'Unknown')) : [market.outcomes];
      } catch {
        outcomes = market.outcomes.split(',').map((s: string) => (s?.trim() || 'Unknown'));
      }
    } else if (market.tokens && Array.isArray(market.tokens)) {
      outcomes = market.tokens.map((t: any) => String(t?.outcome ?? 'Unknown'));
    }

    // Parse prices with null safety
    let prices: number[] = [];
    if (Array.isArray(market.outcomePrices)) {
      prices = market.outcomePrices.map((p: any) => {
        const num = Number(p);
        return isNaN(num) ? 0 : num;
      });
    } else if (typeof market.outcomePrices === 'string') {
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
        prices = market.outcomePrices.split(',').map((s: string) => {
          const num = Number(s?.trim());
          return isNaN(num) ? 0 : num;
        });
      }
    } else if (Array.isArray(market.tokens)) {
      prices = market.tokens.map((t: any) => {
        const num = Number(t?.price);
        return isNaN(num) ? 0 : num;
      });
    }

    // Build brackets with null safety
    const brackets: TweetBracket[] = outcomes.map((outcome, index) => {
      const { min, max } = parseBracketRange(outcome);
      const price = prices[index] ?? 0;
      const validPrice = isNaN(price) ? 0 : price;

      return {
        tokenId: String(market.tokens?.[index]?.token_id || `${market.id || 'unknown'}-${index}`),
        outcome: String(outcome),
        minTweets: min,
        maxTweets: max,
        price: validPrice,
        impliedProbability: validPrice * 100
      };
    });

    const marketId = String(market.id || market.condition_id || market.market_id || 'unknown');

    return {
      id: marketId,
      conditionId: String(market.condition_id || market.conditionId || market.id || ''),
      question,
      slug: String(market.slug || eventData?.slug || ''),
      startDate,
      endDate,
      brackets,
      active: !market.closed,
      closed: !!market.closed,
      resolved: !!market.resolved,
      volume: market?.volume ?? market?.volumeNum ?? market?.total_volume ?? 0,
      liquidity: market?.liquidity ?? market?.liquidityNum ?? market?.total_liquidity ?? 0
    };
  } catch (error) {
    console.error(`  Error parsing market: ${getErrorMessage(error)}`);
    return null;
  }
}

/**
 * Query Polymarket for Elon Musk tweet markets
 */
export async function queryElonTweetMarkets(config: ElonTweetConfig): Promise<ElonTweetMarket[]> {
  const markets: ElonTweetMarket[] = [];
  const seenIds = new Set<string>();

  console.log('Searching for Elon Musk tweet markets...');

  try {
    // Strategy 1: Direct search with "elon musk tweets" query
    console.log('  Searching with query: "elon musk tweets"...');
    try {
      const searchResponse = await fetchWithRetry(
        `${GAMMA_API_URL}/events?limit=100&active=true&closed=false&title_contains=elon`,
        undefined,
        { maxRetries: 3, retryOn429: true }
      );

      if (searchResponse && searchResponse.ok) {
        try {
          const searchData = await searchResponse.json();
          const events = Array.isArray(searchData) ? searchData : (searchData?.data || []);
          console.log(`  Found ${events.length} events containing "elon"`);

          for (const event of events) {
            if (!event) continue;
            const title = (event.title || '').toLowerCase();
            // Check if it's a tweet count market
            if (title.includes('tweet') && (title.includes('#') || title.includes('number'))) {
              const eventTitle = formatForLog(event.title, 'Unknown');
              console.log(`  Found tweet market event: "${eventTitle}"`);

              if (event.markets && Array.isArray(event.markets)) {
                for (const market of event.markets) {
                  if (!market) continue;
                  const marketId = market.id || market.condition_id;
                  if (marketId && !seenIds.has(marketId)) {
                    seenIds.add(marketId);
                    const parsed = parseMarketData(market, event);
                    if (parsed) {
                      markets.push(parsed);
                      const questionPreview = parsed.question?.substring(0, 60) ?? 'No question';
                      console.log(`    Added bracket: ${questionPreview}...`);
                    }
                  }
                }
              }
            }
          }
        } catch (parseError) {
          console.log(`  Failed to parse search response: ${getErrorMessage(parseError)}`);
        }
      } else {
        const status = searchResponse?.status ?? 'no response';
        console.log(`  Search request failed: ${status}`);
      }
    } catch (searchError) {
      console.log(`  Error searching events: ${getErrorMessage(searchError)}`);
    }

    // Strategy 2: Try fetching specific event slugs based on known patterns
    console.log('  Trying known slug patterns...');
    const slugPatterns = generateElonTweetSlugs();

    for (const slug of slugPatterns) {
      try {
        const eventResponse = await fetchWithRetry(
          `${GAMMA_API_URL}/events/slug/${slug}`,
          undefined,
          { maxRetries: 1, retryOn429: true }
        );

        if (eventResponse && eventResponse.ok) {
          try {
            const event = await eventResponse.json();
            if (event) {
              const eventTitle = formatForLog(event.title, 'Unknown');
              console.log(`  Found event via slug: "${eventTitle}"`);

              if (event.markets && Array.isArray(event.markets)) {
                for (const market of event.markets) {
                  if (!market) continue;
                  const marketId = market.id || market.condition_id;
                  if (marketId && !seenIds.has(marketId)) {
                    seenIds.add(marketId);
                    const parsed = parseMarketData(market, event);
                    if (parsed) {
                      markets.push(parsed);
                      const questionPreview = parsed.question?.substring(0, 60) ?? 'No question';
                      console.log(`    Added bracket: ${questionPreview}...`);
                    }
                  }
                }
              }
            }
          } catch (parseError) {
            // Silent - slug response parsing failed
          }
        }
      } catch {
        // Slug not found or error, continue
      }
    }

    // Strategy 3: Search markets directly
    if (markets.length === 0) {
      console.log('  Trying direct market search...');

      try {
        const marketResponse = await fetchWithRetry(
          `${GAMMA_API_URL}/markets?limit=100&closed=false`,
          undefined,
          { maxRetries: 3, retryOn429: true }
        );

        if (marketResponse && marketResponse.ok) {
          try {
            const marketData = await marketResponse.json();
            const allMarkets = Array.isArray(marketData) ? marketData : (marketData?.data || []);

            for (const market of allMarkets) {
              if (!market) continue;
              const question = (market.question || market.title || '').toLowerCase();
              if (question.includes('elon') && question.includes('tweet')) {
                const marketId = market.id || market.condition_id;
                if (marketId && !seenIds.has(marketId)) {
                  seenIds.add(marketId);
                  const parsed = parseMarketData(market);
                  if (parsed) {
                    markets.push(parsed);
                    const questionPreview = parsed.question?.substring(0, 60) ?? 'No question';
                    console.log(`    Added market: ${questionPreview}...`);
                  }
                }
              }
            }
          } catch (parseError) {
            console.log(`  Failed to parse markets response: ${getErrorMessage(parseError)}`);
          }
        } else {
          const status = marketResponse?.status ?? 'no response';
          console.log(`  Markets request failed: ${status}`);
        }
      } catch (marketError) {
        console.log(`  Error fetching markets: ${getErrorMessage(marketError)}`);
      }
    }

    // Filter by date range (markets ending within maxDaysAhead)
    const now = new Date();
    const maxDaysAhead = config?.marketMaxDaysAhead ?? 7;
    const maxDate = new Date(now.getTime() + maxDaysAhead * 24 * 60 * 60 * 1000);

    const filteredMarkets = markets.filter(market => {
      if (!market?.endDate) return false;
      try {
        const endDate = new Date(market.endDate);
        return !isNaN(endDate.getTime()) && endDate >= now && endDate <= maxDate;
      } catch {
        return false;
      }
    });

    console.log(`\nTotal Elon tweet markets found: ${filteredMarkets.length}`);

    // Sort by end date (nearest first)
    filteredMarkets.sort((a, b) => {
      const dateA = new Date(a.endDate).getTime();
      const dateB = new Date(b.endDate).getTime();
      return (isNaN(dateA) ? 0 : dateA) - (isNaN(dateB) ? 0 : dateB);
    });

    return filteredMarkets;

  } catch (error) {
    console.error(`Error querying Elon tweet markets: ${getErrorMessage(error)}`);
    return []; // Return empty array instead of throwing
  }
}

/**
 * Generate potential slug patterns for Elon tweet markets
 */
function generateElonTweetSlugs(): string[] {
  const slugs: string[] = [];
  const now = new Date();

  // Generate slugs for the next 14 days worth of potential markets
  for (let startOffset = -7; startOffset <= 7; startOffset++) {
    for (let duration = 1; duration <= 7; duration++) {
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() + startOffset);

      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + duration);

      const startMonth = startDate.toLocaleString('en-US', { month: 'long' }).toLowerCase();
      const startDay = startDate.getDate();
      const endMonth = endDate.toLocaleString('en-US', { month: 'long' }).toLowerCase();
      const endDay = endDate.getDate();

      // Pattern: elon-musk-of-tweets-january-20-january-27
      if (startMonth === endMonth) {
        slugs.push(`elon-musk-of-tweets-${startMonth}-${startDay}-${startMonth}-${endDay}`);
        slugs.push(`elon-musk-tweets-${startMonth}-${startDay}-${startMonth}-${endDay}`);
      } else {
        slugs.push(`elon-musk-of-tweets-${startMonth}-${startDay}-${endMonth}-${endDay}`);
        slugs.push(`elon-musk-tweets-${startMonth}-${startDay}-${endMonth}-${endDay}`);
      }
    }
  }

  return slugs;
}

/**
 * Refresh market data for a specific market ID
 */
export async function refreshMarketData(marketId: string): Promise<ElonTweetMarket | null> {
  try {
    const response = await fetchWithRetry(
      `${GAMMA_API_URL}/markets/${marketId}`,
      undefined,
      { maxRetries: 2, retryOn429: true }
    );

    if (!response) {
      console.log(`  Failed to refresh market ${marketId}: no response after retries`);
      return null;
    }

    if (!response.ok) {
      console.log(`  Failed to refresh market ${marketId}: ${response.status}`);
      return null;
    }

    try {
      const market = await response.json();
      return parseMarketData(market);
    } catch (parseError) {
      console.log(`  Failed to parse market ${marketId} response: ${getErrorMessage(parseError)}`);
      return null;
    }

  } catch (error) {
    console.error(`  Error refreshing market ${marketId}: ${getErrorMessage(error)}`);
    return null;
  }
}

/**
 * Convert ElonTweetMarket to MarketSnapshot for logging
 */
export function marketToSnapshot(market: ElonTweetMarket): MarketSnapshot {
  return {
    marketId: market.id,
    question: market.question,
    slug: market.slug,
    startDate: market.startDate,
    endDate: market.endDate,
    brackets: market.brackets,
    volume: market.volume,
    liquidity: market.liquidity,
    active: market.active
  };
}

/**
 * Get a summary of market odds
 */
export function getMarketOddsSummary(market: ElonTweetMarket): string {
  const topBrackets = [...market.brackets]
    .sort((a, b) => b.price - a.price)
    .slice(0, 3);

  return topBrackets
    .map(b => `${b.outcome}: ${(b.impliedProbability).toFixed(1)}%`)
    .join(', ');
}
