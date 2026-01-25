// TypeScript interfaces for Elon Musk tweet monitoring

/**
 * Configuration for the Elon tweet monitoring bot
 */
export interface ElonTweetConfig {
  // Polymarket settings
  polymarketCheckMinutes: number[];   // Minutes past the hour to check Polymarket (e.g., [10, 30, 50])

  // X API settings
  xApiCheckTimes: string[];           // Times to check X API in HH:MM format (UTC)
  xApiBearerToken: string;            // X API Bearer Token
  elonUserId: string | null;          // Cached Elon Musk user ID (fetched once)

  // Market discovery settings
  marketSearchKeywords: string[];     // Keywords to search for markets
  marketMaxDaysAhead: number;         // How far ahead to look for markets (default: 10 days)

  // Data storage
  dataDirectory: string;              // Where to store JSON logs
}

/**
 * Elon Musk tweet market from Polymarket
 */
export interface ElonTweetMarket {
  id: string;
  conditionId: string;
  question: string;
  slug: string;

  // Date range for the market
  startDate: string;           // ISO date string for market period start
  endDate: string;             // ISO date string for market period end (resolution date)

  // Bracket information (e.g., "90-114", "400-419")
  brackets: TweetBracket[];

  // Market metadata
  active: boolean;
  closed: boolean;
  resolved: boolean;
  volume: number;
  liquidity: number;
}

/**
 * A single bracket/range option in an Elon tweet market
 */
export interface TweetBracket {
  tokenId: string;
  outcome: string;              // e.g., "90-114", "400-419", "115-139"
  minTweets: number | null;     // Parsed minimum tweets (null for "or fewer"/"or more")
  maxTweets: number | null;     // Parsed maximum tweets (null for "or fewer"/"or more")
  price: number;                // Current YES price (0-1)
  impliedProbability: number;   // Price as percentage
}

/**
 * X API user profile response
 */
export interface XUserProfile {
  id: string;
  name: string;
  username: string;
  publicMetrics: {
    followersCount: number;
    followingCount: number;
    tweetCount: number;
    listedCount: number;
  };
}

/**
 * A single tweet from X API
 */
export interface XTweet {
  id: string;
  text: string;
  createdAt: string;           // ISO date string
  publicMetrics: {
    retweetCount: number;
    replyCount: number;
    likeCount: number;
    quoteCount: number;
  } | null;
}

/**
 * Tweet count data for a specific time period
 */
export interface TweetCountData {
  startDate: string;           // ISO date string for period start
  endDate: string;             // ISO date string for period end
  tweetCount: number;          // Number of tweets in this period
  tweets: XTweet[];            // Actual tweets (for verification)
  fetchedAt: string;           // When this count was retrieved
}

/**
 * Snapshot of a market's state at a point in time
 */
export interface MarketSnapshot {
  marketId: string;
  question: string;
  slug: string;
  startDate: string;
  endDate: string;
  brackets: TweetBracket[];
  volume: number;
  liquidity: number;
  active: boolean;
}

/**
 * A divergence alert when actual tweets differ significantly from market odds
 */
export interface DivergenceAlert {
  marketId: string;
  timestamp: string;

  // Current state
  actualTweetCount: number;
  projectedFinalCount: number;  // Extrapolated based on current pace
  timeRemainingHours: number;

  // Market state
  mostLikelyBracket: TweetBracket;
  bracketForActualPace: TweetBracket | null;

  // Divergence details
  divergenceType: 'underpriced' | 'overpriced';
  divergenceDescription: string;
  confidenceLevel: 'low' | 'medium' | 'high';
}

/**
 * Log entry for monitoring data
 */
export interface MonitoringEntry {
  timestamp: string;
  entryType: 'polymarket_check' | 'x_api_check' | 'combined' | 'divergence_alert';
  source: 'polymarket' | 'x_api' | 'system';

  // Market data (present on polymarket_check and combined)
  markets: MarketSnapshot[] | null;

  // Tweet data (present on x_api_check and combined)
  tweetCounts: TweetCountData[] | null;

  // Divergence alerts (present on divergence_alert)
  alerts: DivergenceAlert[] | null;

  // Tracked markets summary
  activeMarketCount: number | null;

  // Error information if any
  error: string | null;
}

/**
 * Daily log file structure
 */
export interface DailyLog {
  date: string;                // YYYY-MM-DD
  entries: MonitoringEntry[];
}

/**
 * Tracked market state (for managing market lifecycle)
 */
export interface TrackedMarket {
  market: ElonTweetMarket;
  addedAt: string;             // When we started tracking
  lastUpdated: string;         // Last time we updated odds
  latestTweetCount: number | null;  // Latest known tweet count for this market's period
}

/**
 * X API rate limit info
 */
export interface XApiRateLimitInfo {
  remaining: number;
  limit: number;
  resetAt: string;
}
