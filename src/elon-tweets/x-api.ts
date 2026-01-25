// X (Twitter) API integration for fetching Elon Musk's tweets

import type { XUserProfile, XTweet, TweetCountData, XApiRateLimitInfo, ElonTweetConfig } from './types.js';
import { savePersistedConfig } from './config.js';
import { formatForLog, getErrorMessage } from '../api-utils.js';

const X_API_BASE_URL = 'https://api.x.com/2';

// Elon Musk's username (constant)
const ELON_USERNAME = 'elonmusk';

// Retry configuration for X API
const X_API_RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 2000,
  maxDelayMs: 60000,
};

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoffDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number
): number {
  const exponentialDelay = initialDelayMs * Math.pow(2, attempt);
  const jitter = exponentialDelay * Math.random() * 0.25;
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Make an authenticated request to X API with retry logic for rate limits
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

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= X_API_RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
          'Content-Type': 'application/json'
        }
      });

      // Extract rate limit info from headers safely
      const rateLimitRemaining = response.headers.get('x-rate-limit-remaining');
      const rateLimitLimit = response.headers.get('x-rate-limit-limit');
      const rateLimitReset = response.headers.get('x-rate-limit-reset');

      const rateLimit: XApiRateLimitInfo | null = rateLimitRemaining
        ? {
            remaining: parseInt(rateLimitRemaining || '0', 10),
            limit: parseInt(rateLimitLimit || '0', 10),
            resetAt: new Date(
              parseInt(rateLimitReset || '0', 10) * 1000
            ).toISOString()
          }
        : null;

      // Handle 429 rate limit with retry
      if (response.status === 429) {
        if (attempt < X_API_RETRY_CONFIG.maxRetries) {
          // Check Retry-After header first
          const retryAfter = response.headers.get('Retry-After');
          let delayMs: number;

          if (retryAfter) {
            const retryAfterSeconds = parseInt(retryAfter, 10);
            if (!isNaN(retryAfterSeconds)) {
              delayMs = retryAfterSeconds * 1000;
            } else {
              delayMs = calculateBackoffDelay(attempt, X_API_RETRY_CONFIG.initialDelayMs, X_API_RETRY_CONFIG.maxDelayMs);
            }
          } else if (rateLimit?.resetAt) {
            // Use rate limit reset time
            const resetTime = new Date(rateLimit.resetAt).getTime();
            delayMs = Math.max(1000, resetTime - Date.now());
          } else {
            delayMs = calculateBackoffDelay(attempt, X_API_RETRY_CONFIG.initialDelayMs, X_API_RETRY_CONFIG.maxDelayMs);
          }

          console.log(`  X API rate limited (429), retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${X_API_RETRY_CONFIG.maxRetries})...`);
          await sleep(delayMs);
          continue;
        }
      }

      // Handle other server errors with retry
      if (response.status >= 500 && response.status < 600 && attempt < X_API_RETRY_CONFIG.maxRetries) {
        const delayMs = calculateBackoffDelay(attempt, X_API_RETRY_CONFIG.initialDelayMs, X_API_RETRY_CONFIG.maxDelayMs);
        console.log(`  X API server error (${response.status}), retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${X_API_RETRY_CONFIG.maxRetries})...`);
        await sleep(delayMs);
        continue;
      }

      if (!response.ok) {
        let errorBody = '';
        try {
          errorBody = await response.text();
        } catch {
          errorBody = 'Could not read error body';
        }
        throw new Error(`X API error (${response.status}): ${errorBody}`);
      }

      let data: any;
      try {
        data = await response.json();
      } catch (parseError) {
        throw new Error(`X API response parse error: ${getErrorMessage(parseError)}`);
      }

      return { data, rateLimit };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Network errors - retry with backoff
      if (attempt < X_API_RETRY_CONFIG.maxRetries) {
        const delayMs = calculateBackoffDelay(attempt, X_API_RETRY_CONFIG.initialDelayMs, X_API_RETRY_CONFIG.maxDelayMs);
        console.log(`  X API request failed (${lastError.message}), retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${X_API_RETRY_CONFIG.maxRetries})...`);
        await sleep(delayMs);
        continue;
      }
    }
  }

  // All retries exhausted
  throw lastError ?? new Error('X API request failed after all retries');
}

/**
 * Fetch Elon Musk's user profile and ID
 * This should be called once and the ID cached
 */
export async function fetchElonUserId(bearerToken: string): Promise<XUserProfile | null> {
  console.log('  Fetching Elon Musk user ID from X API...');

  try {
    const { data, rateLimit } = await xApiFetch(
      `/users/by/username/${ELON_USERNAME}`,
      bearerToken,
      { 'user.fields': 'public_metrics' }
    );

    if (rateLimit) {
      const remaining = formatForLog(rateLimit.remaining, '?');
      const limit = formatForLog(rateLimit.limit, '?');
      console.log(`  X API rate limit: ${remaining}/${limit} remaining`);
    }

    if (!data?.data) {
      console.error('  User not found in X API response');
      return null;
    }

    const user = data.data;
    const profile: XUserProfile = {
      id: String(user.id ?? ''),
      name: String(user.name ?? 'Unknown'),
      username: String(user.username ?? ELON_USERNAME),
      publicMetrics: {
        followersCount: Number(user.public_metrics?.followers_count) || 0,
        followingCount: Number(user.public_metrics?.following_count) || 0,
        tweetCount: Number(user.public_metrics?.tweet_count) || 0,
        listedCount: Number(user.public_metrics?.listed_count) || 0
      }
    };

    if (!profile.id) {
      console.error('  User ID is empty in X API response');
      return null;
    }

    console.log(`  Found user: @${profile.username} (ID: ${profile.id})`);
    console.log(`  Total tweets: ${profile.publicMetrics.tweetCount.toLocaleString()}`);

    return profile;
  } catch (error) {
    console.error(`  Error fetching Elon user ID: ${getErrorMessage(error)}`);
    return null;
  }
}

/**
 * Ensure we have Elon's user ID, fetching if necessary
 */
export async function ensureElonUserId(config: ElonTweetConfig): Promise<string | null> {
  if (config.elonUserId) {
    return config.elonUserId;
  }

  const profile = await fetchElonUserId(config.xApiBearerToken);

  if (!profile || !profile.id) {
    console.error('  Failed to fetch Elon user ID');
    return null;
  }

  // Cache the user ID for future runs
  config.elonUserId = profile.id;
  try {
    savePersistedConfig({ elonUserId: profile.id });
  } catch (error) {
    console.error(`  Warning: Failed to save persisted config: ${getErrorMessage(error)}`);
  }

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
        const remaining = formatForLog(rateLimit.remaining, '?');
        const limit = formatForLog(rateLimit.limit, '?');
        console.log(`  Rate limit: ${remaining}/${limit} remaining`);

        // If we're running low on rate limit, stop early
        if (typeof rateLimit.remaining === 'number' && rateLimit.remaining < 2) {
          console.log(`  Warning: Rate limit nearly exhausted, stopping pagination`);
          break;
        }
      }

      if (data?.data && Array.isArray(data.data)) {
        for (const tweet of data.data) {
          if (!tweet) continue;

          tweets.push({
            id: String(tweet.id ?? ''),
            text: String(tweet.text ?? ''),
            createdAt: String(tweet.created_at ?? new Date().toISOString()),
            publicMetrics: tweet.public_metrics
              ? {
                  retweetCount: Number(tweet.public_metrics.retweet_count) || 0,
                  replyCount: Number(tweet.public_metrics.reply_count) || 0,
                  likeCount: Number(tweet.public_metrics.like_count) || 0,
                  quoteCount: Number(tweet.public_metrics.quote_count) || 0
                }
              : null
          });
        }
      }

      paginationToken = data?.meta?.next_token;
      pageCount++;

      // Small delay between pages to be nice to the API
      if (paginationToken) {
        await sleep(500);
      }

    } catch (error) {
      // Check if rate limited - the retry logic in xApiFetch will have already tried
      if (error instanceof Error && error.message.includes('429')) {
        console.log(`  Rate limited after retries - stopping pagination with ${tweets.length} tweets`);
        break;
      }
      // Log the error but don't crash - return what we have
      console.error(`  Error fetching tweets page ${pageCount + 1}: ${getErrorMessage(error)}`);
      break;
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
): Promise<TweetCountData | null> {
  try {
    const userId = await ensureElonUserId(config);

    if (!userId) {
      console.error('  Cannot fetch tweet count: No user ID available');
      return null;
    }

    // Parse dates
    const startDate = new Date(marketStartDate);
    const endDate = new Date(marketEndDate);

    // Validate dates
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      console.error(`  Invalid date range: ${marketStartDate} to ${marketEndDate}`);
      return null;
    }

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
  } catch (error) {
    console.error(`  Error getting tweet count for market: ${getErrorMessage(error)}`);
    return null;
  }
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

  try {
    const userId = await ensureElonUserId(config);

    if (!userId) {
      console.error('  Cannot fetch tweet counts: No user ID available');
      return [];
    }

    const results: TweetCountData[] = [];

    // Find the overall date range to fetch all tweets at once
    // Filter out invalid dates first
    const validRanges = dateRanges.filter(r => {
      const start = new Date(r.startDate);
      const end = new Date(r.endDate);
      return !isNaN(start.getTime()) && !isNaN(end.getTime());
    });

    if (validRanges.length === 0) {
      console.error('  No valid date ranges provided');
      return [];
    }

    const allStarts = validRanges.map(r => new Date(r.startDate).getTime());
    const allEnds = validRanges.map(r => new Date(r.endDate).getTime());
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
    for (const range of validRanges) {
      try {
        const rangeStart = new Date(range.startDate).getTime();
        const rangeEnd = new Date(range.endDate);
        rangeEnd.setUTCHours(23, 59, 59, 999);
        const rangeEndTime = rangeEnd.getTime();

        const tweetsInRange = allTweets.filter(tweet => {
          if (!tweet?.createdAt) return false;
          const tweetTime = new Date(tweet.createdAt).getTime();
          return !isNaN(tweetTime) && tweetTime >= rangeStart && tweetTime <= rangeEndTime;
        });

        results.push({
          startDate: range.startDate,
          endDate: range.endDate,
          tweetCount: tweetsInRange.length,
          tweets: tweetsInRange,
          fetchedAt: new Date().toISOString()
        });

        console.log(`  Range ${range.startDate} to ${range.endDate}: ${tweetsInRange.length} tweets`);
      } catch (rangeError) {
        console.error(`  Error processing range ${range.startDate} to ${range.endDate}: ${getErrorMessage(rangeError)}`);
      }
    }

    return results;
  } catch (error) {
    console.error(`  Error getting tweet counts for markets: ${getErrorMessage(error)}`);
    return [];
  }
}

/**
 * Quick check if X API is accessible and token is valid
 */
export async function testXApiConnection(bearerToken: string): Promise<boolean> {
  try {
    const profile = await fetchElonUserId(bearerToken);
    if (profile) {
      console.log('  X API connection test successful');
      return true;
    }
    console.error('  X API connection test failed: Could not fetch user profile');
    return false;
  } catch (error) {
    console.error(`  X API connection test failed: ${getErrorMessage(error)}`);
    return false;
  }
}
