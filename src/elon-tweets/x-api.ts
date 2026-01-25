// X (Twitter) API integration for fetching Elon Musk's tweets

import type { XUserProfile, XTweet, TweetCountData, XApiRateLimitInfo, ElonTweetConfig } from './types.js';
import { savePersistedConfig } from './config.js';

const X_API_BASE_URL = 'https://api.x.com/2';

// Elon Musk's username (constant)
const ELON_USERNAME = 'elonmusk';

/**
 * Make an authenticated request to X API
 */
async function xApiFetch(
  endpoint: string,
  bearerToken: string,
  params?: Record<string, string>
): Promise<{ data: any; rateLimit: XApiRateLimitInfo | null }> {
  const url = new URL(`${X_API_BASE_URL}${endpoint}`);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });
  }

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${bearerToken}`,
      'Content-Type': 'application/json'
    }
  });

  // Extract rate limit info from headers
  const rateLimit: XApiRateLimitInfo | null = response.headers.get('x-rate-limit-remaining')
    ? {
        remaining: parseInt(response.headers.get('x-rate-limit-remaining') || '0', 10),
        limit: parseInt(response.headers.get('x-rate-limit-limit') || '0', 10),
        resetAt: new Date(
          parseInt(response.headers.get('x-rate-limit-reset') || '0', 10) * 1000
        ).toISOString()
      }
    : null;

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`X API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  return { data, rateLimit };
}

/**
 * Fetch Elon Musk's user profile and ID
 * This should be called once and the ID cached
 */
export async function fetchElonUserId(bearerToken: string): Promise<XUserProfile> {
  console.log('  Fetching Elon Musk user ID from X API...');

  const { data, rateLimit } = await xApiFetch(
    `/users/by/username/${ELON_USERNAME}`,
    bearerToken,
    { 'user.fields': 'public_metrics' }
  );

  if (rateLimit) {
    console.log(`  X API rate limit: ${rateLimit.remaining}/${rateLimit.limit} remaining`);
  }

  if (!data.data) {
    throw new Error('User not found in X API response');
  }

  const user = data.data;
  const profile: XUserProfile = {
    id: user.id,
    name: user.name,
    username: user.username,
    publicMetrics: {
      followersCount: user.public_metrics?.followers_count || 0,
      followingCount: user.public_metrics?.following_count || 0,
      tweetCount: user.public_metrics?.tweet_count || 0,
      listedCount: user.public_metrics?.listed_count || 0
    }
  };

  console.log(`  Found user: @${profile.username} (ID: ${profile.id})`);
  console.log(`  Total tweets: ${profile.publicMetrics.tweetCount.toLocaleString()}`);

  return profile;
}

/**
 * Ensure we have Elon's user ID, fetching if necessary
 */
export async function ensureElonUserId(config: ElonTweetConfig): Promise<string> {
  if (config.elonUserId) {
    return config.elonUserId;
  }

  const profile = await fetchElonUserId(config.xApiBearerToken);

  // Cache the user ID for future runs
  config.elonUserId = profile.id;
  savePersistedConfig({ elonUserId: profile.id });

  return profile.id;
}

/**
 * Fetch tweets from Elon within a specific date range
 * Note: X API free tier has limited access - this handles pagination and rate limits
 */
export async function fetchTweetsInDateRange(
  bearerToken: string,
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<XTweet[]> {
  const tweets: XTweet[] = [];
  let paginationToken: string | undefined;
  let pageCount = 0;
  const maxPages = 10; // Limit to avoid rate limit issues on free tier

  // Format dates for X API (ISO 8601 format)
  const startTime = startDate.toISOString();
  const endTime = endDate.toISOString();

  console.log(`  Fetching tweets from ${startTime} to ${endTime}...`);

  do {
    const params: Record<string, string> = {
      'start_time': startTime,
      'end_time': endTime,
      'max_results': '100',
      'tweet.fields': 'created_at,public_metrics'
    };

    if (paginationToken) {
      params['pagination_token'] = paginationToken;
    }

    try {
      const { data, rateLimit } = await xApiFetch(
        `/users/${userId}/tweets`,
        bearerToken,
        params
      );

      if (rateLimit) {
        console.log(`  Rate limit: ${rateLimit.remaining}/${rateLimit.limit} remaining`);

        // If we're running low on rate limit, stop early
        if (rateLimit.remaining < 2) {
          console.log(`  Warning: Rate limit nearly exhausted, stopping pagination`);
          break;
        }
      }

      if (data.data && Array.isArray(data.data)) {
        for (const tweet of data.data) {
          tweets.push({
            id: tweet.id,
            text: tweet.text,
            createdAt: tweet.created_at,
            publicMetrics: tweet.public_metrics
              ? {
                  retweetCount: tweet.public_metrics.retweet_count || 0,
                  replyCount: tweet.public_metrics.reply_count || 0,
                  likeCount: tweet.public_metrics.like_count || 0,
                  quoteCount: tweet.public_metrics.quote_count || 0
                }
              : null
          });
        }
      }

      paginationToken = data.meta?.next_token;
      pageCount++;

      // Small delay between pages to be nice to the API
      if (paginationToken) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

    } catch (error) {
      // Check if rate limited
      if (error instanceof Error && error.message.includes('429')) {
        console.log(`  Rate limited - stopping pagination with ${tweets.length} tweets`);
        break;
      }
      throw error;
    }

  } while (paginationToken && pageCount < maxPages);

  console.log(`  Fetched ${tweets.length} tweets across ${pageCount} page(s)`);

  return tweets;
}

/**
 * Get tweet count data for a specific market's date range
 */
export async function getTweetCountForMarket(
  config: ElonTweetConfig,
  marketStartDate: string,
  marketEndDate: string
): Promise<TweetCountData> {
  const userId = await ensureElonUserId(config);

  // Parse dates
  const startDate = new Date(marketStartDate);
  const endDate = new Date(marketEndDate);

  // Ensure end date includes the full day
  endDate.setUTCHours(23, 59, 59, 999);

  const tweets = await fetchTweetsInDateRange(
    config.xApiBearerToken,
    userId,
    startDate,
    endDate
  );

  return {
    startDate: marketStartDate,
    endDate: marketEndDate,
    tweetCount: tweets.length,
    tweets,
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Get tweet counts for multiple market date ranges
 * Combines overlapping ranges to minimize API calls
 */
export async function getTweetCountsForMarkets(
  config: ElonTweetConfig,
  dateRanges: Array<{ startDate: string; endDate: string }>
): Promise<TweetCountData[]> {
  if (dateRanges.length === 0) {
    return [];
  }

  const userId = await ensureElonUserId(config);
  const results: TweetCountData[] = [];

  // Find the overall date range to fetch all tweets at once
  const allStarts = dateRanges.map(r => new Date(r.startDate).getTime());
  const allEnds = dateRanges.map(r => new Date(r.endDate).getTime());
  const minStart = new Date(Math.min(...allStarts));
  const maxEnd = new Date(Math.max(...allEnds));
  maxEnd.setUTCHours(23, 59, 59, 999);

  console.log(`  Fetching all tweets from ${minStart.toISOString()} to ${maxEnd.toISOString()}...`);

  // Fetch all tweets in the combined range
  const allTweets = await fetchTweetsInDateRange(
    config.xApiBearerToken,
    userId,
    minStart,
    maxEnd
  );

  // Now filter tweets for each individual market range
  for (const range of dateRanges) {
    const rangeStart = new Date(range.startDate).getTime();
    const rangeEnd = new Date(range.endDate);
    rangeEnd.setUTCHours(23, 59, 59, 999);
    const rangeEndTime = rangeEnd.getTime();

    const tweetsInRange = allTweets.filter(tweet => {
      const tweetTime = new Date(tweet.createdAt).getTime();
      return tweetTime >= rangeStart && tweetTime <= rangeEndTime;
    });

    results.push({
      startDate: range.startDate,
      endDate: range.endDate,
      tweetCount: tweetsInRange.length,
      tweets: tweetsInRange,
      fetchedAt: new Date().toISOString()
    });

    console.log(`  Range ${range.startDate} to ${range.endDate}: ${tweetsInRange.length} tweets`);
  }

  return results;
}

/**
 * Quick check if X API is accessible and token is valid
 */
export async function testXApiConnection(bearerToken: string): Promise<boolean> {
  try {
    await fetchElonUserId(bearerToken);
    return true;
  } catch (error) {
    console.error('  X API connection test failed:', error instanceof Error ? error.message : error);
    return false;
  }
}
