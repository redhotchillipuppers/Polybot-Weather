// Polymarket API integration for Elon Musk tweet markets

import type { ElonTweetMarket, TweetBracket, ElonTweetConfig, MarketSnapshot } from './types.js';

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

  // Unknown format
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
    const question = market.question || market.title || '';
    const endDateStr = market.endDateIso || market.end_date_iso || market.endDate || market.close_time;

    if (!endDateStr) {
      console.log(`  Skipping market without end date: ${question.substring(0, 50)}...`);
      return null;
    }

    // Extract date range from question
    const { startDate, endDate } = extractDateRangeFromQuestion(question, endDateStr);

    // Parse outcomes into brackets
    let outcomes: string[] = [];
    if (Array.isArray(market.outcomes)) {
      outcomes = market.outcomes;
    } else if (typeof market.outcomes === 'string') {
      try {
        outcomes = JSON.parse(market.outcomes);
      } catch {
        outcomes = market.outcomes.split(',').map((s: string) => s.trim());
      }
    } else if (market.tokens && Array.isArray(market.tokens)) {
      outcomes = market.tokens.map((t: any) => t.outcome);
    }

    // Parse prices
    let prices: number[] = [];
    if (Array.isArray(market.outcomePrices)) {
      prices = market.outcomePrices.map(Number);
    } else if (typeof market.outcomePrices === 'string') {
      try {
        const parsed = JSON.parse(market.outcomePrices);
        prices = Array.isArray(parsed) ? parsed.map(Number) : [Number(parsed)];
      } catch {
        prices = market.outcomePrices.split(',').map(Number);
      }
    } else if (Array.isArray(market.tokens)) {
      prices = market.tokens.map((t: any) => Number(t.price) || 0);
    }

    // Build brackets
    const brackets: TweetBracket[] = outcomes.map((outcome, index) => {
      const { min, max } = parseBracketRange(outcome);
      const price = prices[index] || 0;

      return {
        tokenId: market.tokens?.[index]?.token_id || `${market.id}-${index}`,
        outcome,
        minTweets: min,
        maxTweets: max,
        price,
        impliedProbability: price * 100
      };
    });

    return {
      id: market.id || market.condition_id || market.market_id,
      conditionId: market.condition_id || market.conditionId || market.id,
      question,
      slug: market.slug || eventData?.slug || '',
      startDate,
      endDate,
      brackets,
      active: !market.closed,
      closed: !!market.closed,
      resolved: !!market.resolved,
      volume: Number(market.volume) || Number(market.volumeNum) || 0,
      liquidity: Number(market.liquidity) || 0
    };
  } catch (error) {
    console.error('  Error parsing market:', error);
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
    const searchResponse = await fetch(
      `${GAMMA_API_URL}/events?limit=100&active=true&closed=false&title_contains=elon`
    );

    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      const events = Array.isArray(searchData) ? searchData : (searchData.data || []);
      console.log(`  Found ${events.length} events containing "elon"`);

      for (const event of events) {
        const title = (event.title || '').toLowerCase();
        // Check if it's a tweet count market
        if (title.includes('tweet') && (title.includes('#') || title.includes('number'))) {
          console.log(`  Found tweet market event: "${event.title}"`);

          if (event.markets && Array.isArray(event.markets)) {
            for (const market of event.markets) {
              const marketId = market.id || market.condition_id;
              if (marketId && !seenIds.has(marketId)) {
                seenIds.add(marketId);
                const parsed = parseMarketData(market, event);
                if (parsed) {
                  markets.push(parsed);
                  console.log(`    Added bracket: ${parsed.question.substring(0, 60)}...`);
                }
              }
            }
          }
        }
      }
    }

    // Strategy 2: Try fetching specific event slugs based on known patterns
    console.log('  Trying known slug patterns...');
    const slugPatterns = generateElonTweetSlugs();

    for (const slug of slugPatterns) {
      try {
        const eventResponse = await fetch(`${GAMMA_API_URL}/events/slug/${slug}`);
        if (eventResponse.ok) {
          const event = await eventResponse.json();
          console.log(`  Found event via slug: "${event.title}"`);

          if (event.markets && Array.isArray(event.markets)) {
            for (const market of event.markets) {
              const marketId = market.id || market.condition_id;
              if (marketId && !seenIds.has(marketId)) {
                seenIds.add(marketId);
                const parsed = parseMarketData(market, event);
                if (parsed) {
                  markets.push(parsed);
                  console.log(`    Added bracket: ${parsed.question.substring(0, 60)}...`);
                }
              }
            }
          }
        }
      } catch {
        // Slug not found, continue
      }
    }

    // Strategy 3: Search markets directly
    if (markets.length === 0) {
      console.log('  Trying direct market search...');
      const queries = ['elon tweets', 'elon musk tweets', 'musk tweets'];

      for (const query of queries) {
        const marketResponse = await fetch(
          `${GAMMA_API_URL}/markets?limit=100&closed=false`
        );

        if (marketResponse.ok) {
          const marketData = await marketResponse.json();
          const allMarkets = Array.isArray(marketData) ? marketData : (marketData.data || []);

          for (const market of allMarkets) {
            const question = (market.question || market.title || '').toLowerCase();
            if (question.includes('elon') && question.includes('tweet')) {
              const marketId = market.id || market.condition_id;
              if (marketId && !seenIds.has(marketId)) {
                seenIds.add(marketId);
                const parsed = parseMarketData(market);
                if (parsed) {
                  markets.push(parsed);
                  console.log(`    Added market: ${parsed.question.substring(0, 60)}...`);
                }
              }
            }
          }
        }
      }
    }

    // Filter by date range (markets ending within maxDaysAhead)
    const now = new Date();
    const maxDate = new Date(now.getTime() + config.marketMaxDaysAhead * 24 * 60 * 60 * 1000);

    const filteredMarkets = markets.filter(market => {
      const endDate = new Date(market.endDate);
      return endDate >= now && endDate <= maxDate;
    });

    console.log(`\nTotal Elon tweet markets found: ${filteredMarkets.length}`);

    // Sort by end date (nearest first)
    filteredMarkets.sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());

    return filteredMarkets;

  } catch (error) {
    console.error('Error querying Elon tweet markets:', error);
    throw error;
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
    const response = await fetch(`${GAMMA_API_URL}/markets/${marketId}`);

    if (!response.ok) {
      console.log(`  Failed to refresh market ${marketId}: ${response.status}`);
      return null;
    }

    const market = await response.json();
    return parseMarketData(market);

  } catch (error) {
    console.error(`Error refreshing market ${marketId}:`, error);
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
