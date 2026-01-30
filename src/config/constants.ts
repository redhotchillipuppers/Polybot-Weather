/**
 * Centralized configuration constants for Polybot-Weather
 *
 * This file contains all magic numbers and configuration values
 * to make the codebase easier to adapt for other use cases.
 */

// =============================================================================
// POLYMARKET / TRADING CONFIGURATION
// =============================================================================

/** Polymarket CLOB API host URL */
export const HOST = 'https://clob.polymarket.com';

/** Polygon chain ID for Polymarket */
export const CHAIN_ID = 137;

/** Polymarket Gamma API URL for market data */
export const GAMMA_API_URL = 'https://gamma-api.polymarket.com';

/** Number of days ahead to look for markets */
export const MARKET_LOOKAHEAD_DAYS = 3;

// =============================================================================
// SCHEDULING CONFIGURATION
// =============================================================================

/** Minutes past the hour to run market checks (every 10 minutes) */
export const MARKET_CHECK_MINUTES = [0, 10, 20, 30, 40, 50];

/** Minutes past the hour to run weather checks (every 10 minutes) */
export const WEATHER_CHECK_MINUTES = [0, 10, 20, 30, 40, 50];

// =============================================================================
// WEATHER API CONFIGURATION
// =============================================================================

/** OpenWeather API forecast endpoint */
export const OPENWEATHER_FORECAST_ENDPOINT = 'https://api.openweathermap.org/data/2.5/forecast';

/** London latitude coordinate */
export const LONDON_LAT = 51.5074;

/** London longitude coordinate */
export const LONDON_LON = -0.1278;

// =============================================================================
// TRADING THRESHOLDS
// =============================================================================

/** Price threshold for DECIDED_95 early close detection (95%) */
export const DECIDED_95_THRESHOLD = 0.95;

/** Number of consecutive checks above threshold required for DECIDED_95 */
export const DECIDED_95_STREAK_REQUIRED = 2;

/** Minimum edge threshold for trade signals (5%) */
export const EDGE_THRESHOLD = 0.05;

/** Number of consecutive cycles a candidate must remain best before entry */
export const CONFIRM_CYCLES = 3;

/** Max absolute distance between model temp and strike temp for entry */
export const ENTRY_MAX_PROXIMITY_C = 0.7;

/** Minimum positive edge required to enter a trade */
export const ENTRY_MIN_EDGE = 0.04;

/** Thesis stop: max absolute distance between model temp and entry strike temp */
export const STOP_MAX_PROXIMITY_C = 1.0;

/** Thesis stop: edge flip threshold (negative) */
export const STOP_EDGE_FLIP = 0.02;

/** Maximum stop-outs per date before blocking new entries */
export const MAX_STOPOUTS_PER_DATE = 2;

/** Minimum market liquidity required before entering trades (USD) */
export const MIN_TRADE_LIQUIDITY = 150;

/** Minimum market volume required before entering trades (USD) */
export const MIN_TRADE_VOLUME = 75;

/** Price tolerance for identifying initialization/default prices */
export const DEFAULT_PRICE_EPSILON = 0.002;

/** Default initialization price pairs to avoid trading */
export const DEFAULT_PRICE_PAIRS = [
  { yes: 0.495, no: 0.505 },
  { yes: 0.5, no: 0.5 },
] as const;
