/**
 * Weather Probability Model for Polymarket Temperature Markets
 *
 * This module implements a statistical model to calculate fair value probabilities
 * for temperature prediction markets. The model assumes forecast errors follow a
 * normal (Gaussian) distribution centered on the forecast temperature.
 *
 * Statistical Basis:
 * - Forecast errors are modeled as normally distributed: Actual ~ N(forecast, sigma^2)
 * - Standard deviation (sigma) increases with forecast horizon, based on OpenWeather
 *   accuracy data and meteorological research
 * - Probabilities are calculated using the cumulative distribution function (CDF)
 *   of the normal distribution
 *
 * Mathematical Formulas:
 * - P(X <= a) = Phi((a - mu) / sigma) where Phi is the standard normal CDF
 * - P(a < X <= b) = Phi((b - mu) / sigma) - Phi((a - mu) / sigma)
 * - P(X > a) = 1 - Phi((a - mu) / sigma)
 *
 * Reference: OpenWeather forecast accuracy documentation and WMO forecast verification guidelines
 */

// Type declaration for jstat library (no @types/jstat available)
declare module 'jstat' {
  const jstat: {
    normal: {
      cdf: (x: number, mean: number, stdDev: number) => number;
      pdf: (x: number, mean: number, stdDev: number) => number;
      inv: (p: number, mean: number, stdDev: number) => number;
    };
  };
  export default jstat;
}

import jstat from 'jstat';
import { EDGE_THRESHOLD, TIME_COMPRESSION_REF_HOURS } from './config/constants.js';

/**
 * Forecast error standard deviation by time horizon (in degrees Celsius)
 *
 * These values are based on OpenWeather's published accuracy data and
 * meteorological research on numerical weather prediction model performance.
 * Forecast uncertainty increases with time due to chaotic dynamics in
 * atmospheric systems.
 */
const FORECAST_ERROR_SIGMA: Array<{ maxHours: number; sigma: number }> = [
  { maxHours: 6, sigma: 0.7 },    // 0-6 hours: Very short-term, high accuracy
  { maxHours: 12, sigma: 1.0 },   // 6-12 hours: Short-term forecast
  { maxHours: 24, sigma: 1.5 },   // 12-24 hours: Day-ahead forecast
  { maxHours: 36, sigma: 2.0 },   // 24-36 hours: Extended day-ahead
  { maxHours: 48, sigma: 2.5 },   // 36-48 hours: Two-day forecast
  { maxHours: Infinity, sigma: 3.0 }, // 48+ hours: Extended range forecast
];

/**
 * Gets the forecast error standard deviation based on hours until market resolution.
 *
 * The standard deviation represents the expected uncertainty in the temperature
 * forecast. Longer forecast horizons have larger uncertainty because small errors
 * in initial conditions compound over time (butterfly effect).
 *
 * @param hoursUntilResolution - Number of hours from now until the market resolves
 * @returns Standard deviation in degrees Celsius
 *
 * @example
 * // Near-term forecast (6 hours out)
 * getStandardDeviation(5);  // Returns 0.7
 *
 * @example
 * // Day-ahead forecast (22 hours out)
 * getStandardDeviation(22); // Returns 1.5
 *
 * @example
 * // Extended forecast (3 days out)
 * getStandardDeviation(72); // Returns 3.0
 */
export function getStandardDeviation(hoursUntilResolution: number): number {
  // Handle edge cases
  if (hoursUntilResolution < 0) {
    // Past events have no forecast uncertainty (outcome is known)
    return 0;
  }

  // Find the appropriate sigma based on time horizon
  for (const { maxHours, sigma } of FORECAST_ERROR_SIGMA) {
    if (hoursUntilResolution <= maxHours) {
      return sigma;
    }
  }

  // Fallback to maximum uncertainty (should not reach here due to Infinity)
  return FORECAST_ERROR_SIGMA[FORECAST_ERROR_SIGMA.length - 1]?.sigma ?? 3.0;
}

/**
 * Calculates the probability that actual temperature falls within a given bracket.
 *
 * This function computes P(bracketMin < T <= bracketMax) where T is the actual
 * temperature modeled as a normal random variable with:
 * - Mean (mu) = forecastTemp
 * - Standard deviation (sigma) = getStandardDeviation(hoursUntilResolution)
 *
 * Special bracket handling:
 * - bracketMin = null: Interpreted as "X or below" → uses -Infinity
 * - bracketMax = null: Interpreted as "X or higher" → uses +Infinity
 * - For exact temperatures like "8C", interpret as [7.5, 8.5) range
 *   (the caller should provide bracketMin = 7.5, bracketMax = 8.5)
 *
 * @param forecastTemp - The forecasted temperature in degrees Celsius
 * @param hoursUntilResolution - Hours from now until market resolution
 * @param bracketMin - Lower bound of temperature bracket (null for no lower bound)
 * @param bracketMax - Upper bound of temperature bracket (null for no upper bound)
 * @returns Probability as a decimal between 0 and 1
 *
 * @example
 * // "9C or higher" with forecast 8.2C, 22 hours out
 * // Bracket: [8.5, +Infinity) since "9C or higher" means >= 8.5C
 * calculateBracketProbability(8.2, 22, 8.5, null);
 * // Returns approximately 0.42
 *
 * @example
 * // "8C" exact with forecast 8.2C, 22 hours out
 * // Bracket: [7.5, 8.5) representing temperatures that round to 8
 * calculateBracketProbability(8.2, 22, 7.5, 8.5);
 * // Returns approximately 0.26
 *
 * @example
 * // "3C or below" with forecast 8.2C, 22 hours out
 * // Bracket: (-Infinity, 3.5] since "3C or below" means <= 3.5C
 * calculateBracketProbability(8.2, 22, null, 3.5);
 * // Returns approximately 0.001
 */
export function calculateBracketProbability(
  forecastTemp: number,
  hoursUntilResolution: number,
  bracketMin: number | null,
  bracketMax: number | null
): number {
  // Validate inputs
  if (!Number.isFinite(forecastTemp)) {
    console.warn(`Invalid forecast temperature: ${forecastTemp}, returning 0`);
    return 0;
  }

  // Get the appropriate standard deviation for this time horizon
  const sigma = getStandardDeviation(hoursUntilResolution);

  // Handle edge case: if sigma is 0 (past event), return deterministic result
  if (sigma === 0) {
    const min = bracketMin ?? -Infinity;
    const max = bracketMax ?? Infinity;
    return forecastTemp > min && forecastTemp <= max ? 1 : 0;
  }

  // Convert null bounds to infinity
  const lowerBound = bracketMin ?? -Infinity;
  const upperBound = bracketMax ?? Infinity;

  // Validate bracket bounds
  if (lowerBound >= upperBound) {
    console.warn(`Invalid bracket: min (${lowerBound}) >= max (${upperBound}), returning 0`);
    return 0;
  }

  // Calculate probability using normal CDF
  // P(lower < X <= upper) = CDF(upper) - CDF(lower)
  const cdfUpper = upperBound === Infinity ? 1 : jstat.normal.cdf(upperBound, forecastTemp, sigma);
  const cdfLower = lowerBound === -Infinity ? 0 : jstat.normal.cdf(lowerBound, forecastTemp, sigma);

  const probability = cdfUpper - cdfLower;

  // Clamp to [0, 1] to handle any floating point errors
  return Math.max(0, Math.min(1, probability));
}

/**
 * Calculates the number of hours from now until a given ISO date string.
 *
 * This function handles timezone conversion properly by parsing the date as UTC
 * and comparing it to the current UTC time. The result can be negative if the
 * end date is in the past.
 *
 * @param endDate - ISO 8601 date string (e.g., "2026-01-27T12:00:00Z")
 * @returns Number of hours until the specified time (can be negative for past dates)
 *
 * @example
 * // If current time is 2026-01-27T10:00:00Z
 * calculateHoursUntilResolution("2026-01-27T12:00:00Z");
 * // Returns 2
 *
 * @example
 * // If current time is 2026-01-27T14:00:00Z
 * calculateHoursUntilResolution("2026-01-27T12:00:00Z");
 * // Returns -2 (past date)
 */
export function calculateHoursUntilResolution(endDate: string): number {
  // Validate input
  if (!endDate || typeof endDate !== 'string') {
    console.warn(`Invalid end date: ${endDate}, returning 0`);
    return 0;
  }

  try {
    const endTime = new Date(endDate).getTime();

    // Check for invalid date
    if (Number.isNaN(endTime)) {
      console.warn(`Could not parse date: ${endDate}, returning 0`);
      return 0;
    }

    const nowTime = Date.now();
    const hoursUntil = (endTime - nowTime) / (1000 * 60 * 60);

    return hoursUntil;
  } catch (error) {
    console.warn(`Error calculating hours until resolution: ${error}`);
    return 0;
  }
}

/**
 * Calculates time compression factor based on hours to settlement.
 *
 * As settlement approaches, forecast uncertainty collapses faster than market prices update.
 * This creates exploitable edge, but only when time-compressed. Early entries bleed value
 * waiting for convergence.
 *
 * The compression factor scales edge linearly with proximity to settlement:
 * - At 24h out → 1.0 (full edge preserved)
 * - At 48h out → 0.5 (half edge - trade with 15% raw edge behaves like 7.5%)
 * - At 96h out → 0.25 (quarter edge)
 * - Below 24h → capped at 1.0 (no bonus for being closer)
 *
 * @param hoursToSettlement - Hours from now until market settlement
 * @returns Time compression factor between 0 and 1
 *
 * @example
 * calculateTimeCompression(24);  // Returns 1.0
 * calculateTimeCompression(48);  // Returns 0.5
 * calculateTimeCompression(12);  // Returns 1.0 (capped)
 */
export function calculateTimeCompression(hoursToSettlement: number): number {
  if (hoursToSettlement <= 0) {
    return 1; // At or past settlement, use full edge
  }
  return Math.min(TIME_COMPRESSION_REF_HOURS / hoursToSettlement, 1);
}

/**
 * Convenience function to calculate probability for common market bracket types.
 *
 * Market questions typically follow patterns like:
 * - "Will temperature be 9C or higher?" → type: 'or_higher', value: 9
 * - "Will temperature be 3C or below?" → type: 'or_below', value: 3
 * - "Will temperature be exactly 8C?" → type: 'exact', value: 8
 *
 * For exact temperatures, we interpret "exactly 8C" as the range [7.5, 8.5),
 * representing all temperatures that would round to 8C.
 *
 * @param forecastTemp - The forecasted temperature in degrees Celsius
 * @param hoursUntilResolution - Hours from now until market resolution
 * @param bracketType - Type of bracket: 'or_higher', 'or_below', or 'exact'
 * @param bracketValue - The temperature value in the market question
 * @returns Probability as a decimal between 0 and 1
 *
 * @example
 * // "9C or higher" with forecast 8.2C, 22 hours out
 * calculateMarketProbability(8.2, 22, 'or_higher', 9);
 * // Returns approximately 0.30
 *
 * @example
 * // "8C" exact with forecast 8.2C, 22 hours out
 * calculateMarketProbability(8.2, 22, 'exact', 8);
 * // Returns approximately 0.26
 */
export function calculateMarketProbability(
  forecastTemp: number,
  hoursUntilResolution: number,
  bracketType: 'or_higher' | 'or_below' | 'exact',
  bracketValue: number
): number {
  switch (bracketType) {
    case 'or_higher':
      // "X or higher" means actual temp >= X, which rounds to X or above
      // For "9C or higher", we want P(temp > 8.5) to seamlessly connect
      // with the "8C exact" bucket [7.5, 8.5)
      // Using bracketValue - 0.5 ensures complete coverage with no gaps
      return calculateBracketProbability(
        forecastTemp,
        hoursUntilResolution,
        bracketValue - 0.5,
        null
      );

    case 'or_below':
      // "X or below" means actual temp <= X, which rounds to X or below
      // For "5C or below", we want P(temp <= 5.5) to seamlessly connect
      // with the "6C exact" bucket (5.5, 6.5]
      // Using bracketValue + 0.5 ensures complete coverage with no gaps
      return calculateBracketProbability(
        forecastTemp,
        hoursUntilResolution,
        null,
        bracketValue + 0.5
      );

    case 'exact':
      // "Exactly X" means temperatures that would round to X
      // For "8C", this is the range [7.5, 8.5)
      return calculateBracketProbability(
        forecastTemp,
        hoursUntilResolution,
        bracketValue - 0.5,
        bracketValue + 0.5
      );

    default:
      console.warn(`Unknown bracket type: ${bracketType as string}, returning 0`);
      return 0;
  }
}

/**
 * Analyzes the edge (expected value) of a market position.
 *
 * The edge is the difference between our calculated fair probability and the
 * market's implied probability (price). A positive edge means the market is
 * underpricing the outcome relative to our model.
 *
 * When hoursToSettlement is provided, time compression is applied to filter out
 * early, weak trades. The effective edge is used for signal determination:
 * - At 24h out → effectiveEdge = rawEdge * 1.0
 * - At 48h out → effectiveEdge = rawEdge * 0.5 (15% raw edge → 7.5% effective)
 * - At 96h out → effectiveEdge = rawEdge * 0.25
 *
 * @param fairProbability - Our calculated probability (0-1)
 * @param marketPrice - The market price / implied probability (0-1)
 * @param hoursToSettlement - Optional hours until market settlement for time compression
 * @returns Object with edge analysis including effective edge when time compression applied
 *
 * @example
 * // Fair value is 0.30, market price is 0.25, 48 hours out
 * analyzeEdge(0.30, 0.25, 48);
 * // Returns { edge: 0.05, effectiveEdge: 0.025, timeCompression: 0.5, signal: 'HOLD' }
 */
export function analyzeEdge(
  fairProbability: number,
  marketPrice: number,
  hoursToSettlement?: number
): {
  edge: number;
  edgePercent: number;
  signal: 'BUY' | 'SELL' | 'HOLD';
  effectiveEdge?: number;
  timeCompression?: number;
} {
  const edge = fairProbability - marketPrice;
  const edgePercent = marketPrice > 0 ? (edge / marketPrice) * 100 : 0;

  // Calculate time compression if hours provided
  let effectiveEdge = edge;
  let timeCompression: number | undefined;
  if (hoursToSettlement !== undefined) {
    timeCompression = calculateTimeCompression(hoursToSettlement);
    effectiveEdge = edge * timeCompression;
  }

  // Determine signal based on effective edge magnitude (time-compressed)
  let signal: 'BUY' | 'SELL' | 'HOLD';
  if (effectiveEdge > EDGE_THRESHOLD) {
    signal = 'BUY'; // Market underpricing - buy YES
  } else if (effectiveEdge < -EDGE_THRESHOLD) {
    signal = 'SELL'; // Market overpricing - buy NO / sell YES
  } else {
    signal = 'HOLD'; // Edge too small to trade
  }

  const result: {
    edge: number;
    edgePercent: number;
    signal: 'BUY' | 'SELL' | 'HOLD';
    effectiveEdge?: number;
    timeCompression?: number;
  } = {
    edge: Math.round(edge * 10000) / 10000, // Round to 4 decimal places
    edgePercent: Math.round(edgePercent * 100) / 100, // Round to 2 decimal places
    signal,
  };

  // Include time compression info if it was applied
  if (hoursToSettlement !== undefined) {
    result.effectiveEdge = Math.round(effectiveEdge * 10000) / 10000;
    result.timeCompression = Math.round(timeCompression! * 10000) / 10000;
  }

  return result;
}
