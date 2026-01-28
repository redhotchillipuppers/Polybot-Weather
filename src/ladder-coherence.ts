// Ladder coherence validation for temperature market groups
// Ensures price ladders are internally consistent before trading

import type { MarketSnapshot } from './types.js';
import { extractDateKeyFromEndDate } from './positions/decided-95.js';

// Ladder statistics for a single date
export interface LadderStats {
  dateKey: string;
  marketCount: number;
  ladderYesSum: number;
  ladderMeanYes: number;
  ladderStdYes: number;
  ladderMaxGap: number;
  ladderCoherent: boolean;
}

// In-memory storage of ladder stats keyed by dateKey
const ladderStatsCache: Map<string, LadderStats> = new Map();

/**
 * Compute standard deviation of an array of numbers
 */
function computeStdDev(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const squaredDiffs = values.map(v => (v - mean) ** 2);
  const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Compute max gap between sorted temperature values
 */
function computeMaxGap(temperatureValues: number[]): number {
  if (temperatureValues.length < 2) return 0;
  const sorted = [...temperatureValues].sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i]! - sorted[i - 1]!;
    if (gap > maxGap) {
      maxGap = gap;
    }
  }
  return maxGap;
}

/**
 * Extract temperature value as number from market snapshot
 */
function extractTemperatureNumber(snapshot: MarketSnapshot): number | null {
  if (!snapshot.temperatureValue) return null;
  // Extract numeric value from strings like "8°C" or "8"
  const match = snapshot.temperatureValue.match(/(\d+(?:\.\d+)?)/);
  if (match && match[1]) {
    return parseFloat(match[1]);
  }
  return null;
}

/**
 * Compute ladder coherence for markets grouped by dateKey
 * Returns a map of dateKey -> LadderStats
 */
export function computeLadderCoherence(marketSnapshots: MarketSnapshot[]): Map<string, LadderStats> {
  // Group markets by dateKey
  const marketsByDate = new Map<string, MarketSnapshot[]>();

  for (const snapshot of marketSnapshots) {
    const dateKey = extractDateKeyFromEndDate(snapshot.endDate);
    if (!dateKey) continue;

    const markets = marketsByDate.get(dateKey) || [];
    markets.push(snapshot);
    marketsByDate.set(dateKey, markets);
  }

  // Compute stats for each date
  const results = new Map<string, LadderStats>();

  for (const [dateKey, markets] of marketsByDate) {
    // Extract yes prices (filter out nulls)
    const yesPrices = markets
      .map(m => m.yesPrice)
      .filter((p): p is number => p !== null);

    // Extract temperature values
    const temperatureValues = markets
      .map(m => extractTemperatureNumber(m))
      .filter((t): t is number => t !== null);

    // Compute statistics
    const ladderYesSum = yesPrices.reduce((sum, p) => sum + p, 0);
    const ladderMeanYes = yesPrices.length > 0 ? ladderYesSum / yesPrices.length : 0;
    const ladderStdYes = computeStdDev(yesPrices, ladderMeanYes);
    const ladderMaxGap = computeMaxGap(temperatureValues);

    // Coherence check:
    // ladderYesSum >= 0.75 && ladderYesSum <= 1.25
    // !(ladderMeanYes > 0.4 && ladderStdYes < 0.05)  -- avoid uniform high prices
    // ladderMaxGap <= 1  -- no gaps larger than 1 degree
    const ladderCoherent =
      ladderYesSum >= 0.75 &&
      ladderYesSum <= 1.25 &&
      !(ladderMeanYes > 0.4 && ladderStdYes < 0.05) &&
      ladderMaxGap <= 1;

    const stats: LadderStats = {
      dateKey,
      marketCount: markets.length,
      ladderYesSum,
      ladderMeanYes,
      ladderStdYes,
      ladderMaxGap,
      ladderCoherent,
    };

    results.set(dateKey, stats);

    // Update cache
    ladderStatsCache.set(dateKey, stats);
  }

  return results;
}

/**
 * Get cached ladder stats for a specific dateKey
 */
export function getLadderStats(dateKey: string): LadderStats | null {
  return ladderStatsCache.get(dateKey) ?? null;
}

/**
 * Check if a dateKey's ladder is coherent (returns false if not found)
 */
export function isLadderCoherent(dateKey: string): boolean {
  const stats = ladderStatsCache.get(dateKey);
  return stats?.ladderCoherent ?? false;
}

/**
 * Clear the ladder stats cache (for testing)
 */
export function clearLadderStatsCache(): void {
  ladderStatsCache.clear();
}
