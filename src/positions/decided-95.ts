// DECIDED_95 early position closing detection logic

import type { MarketSnapshot, PositionsFile } from '../types.js';

// DECIDED_95 threshold constants
export const DECIDED_95_THRESHOLD = 0.95;
export const DECIDED_95_STREAK_REQUIRED = 2;

// Extract dateKey (YYYY-MM-DD) from endDate string
export function extractDateKeyFromEndDate(endDate: string): string | null {
  if (!endDate) return null;
  try {
    const date = new Date(endDate);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0] ?? null;
  } catch {
    return null;
  }
}

// Check if a market question is for "exact temperature" (contains "be X°C on")
export function isExactTemperatureMarket(question: string): boolean {
  if (!question) return false;
  // Match "be X°C on" pattern - this identifies exact temperature markets
  // Must NOT contain "or higher" or "or below"
  const hasExactPattern = /be\s+\d+(?:\.\d+)?[°º\s]*C\s+on/i.test(question);
  const hasOrHigher = /or\s+higher/i.test(question);
  const hasOrBelow = /or\s+below/i.test(question);
  return hasExactPattern && !hasOrHigher && !hasOrBelow;
}

// Check for DECIDED_95 condition per date
// Returns the dateKey and trigger market info if a date just became DECIDED_95
export function checkDecided95(
  marketSnapshots: MarketSnapshot[],
  positionsData: PositionsFile,
  savePositionsFile: () => void
): Array<{ dateKey: string; triggerMarket: MarketSnapshot }> {
  const triggeredDates: Array<{ dateKey: string; triggerMarket: MarketSnapshot }> = [];

  // Group markets by dateKey (only tradeable exact temperature markets)
  const marketsByDate = new Map<string, MarketSnapshot[]>();

  for (const snapshot of marketSnapshots) {
    // Only consider tradeable markets
    if (!snapshot.isTradeable) continue;

    // Only consider exact temperature markets
    if (!isExactTemperatureMarket(snapshot.question)) continue;

    const dateKey = extractDateKeyFromEndDate(snapshot.endDate);
    if (!dateKey) continue;

    const markets = marketsByDate.get(dateKey) || [];
    markets.push(snapshot);
    marketsByDate.set(dateKey, markets);
  }

  const now = new Date().toISOString();

  // Check each date
  for (const [dateKey, markets] of marketsByDate) {
    // Skip if already reported
    if (positionsData.reportedDates.includes(dateKey)) continue;

    // Find max yesPrice among all markets for this date
    let maxYesPrice = 0;
    let triggerMarket: MarketSnapshot | null = null;

    for (const market of markets) {
      if (market.yesPrice !== null && market.yesPrice > maxYesPrice) {
        maxYesPrice = market.yesPrice;
        triggerMarket = market;
      }
    }

    // Get or initialize streak info for this date
    let dateInfo = positionsData.decidedDates[dateKey];
    if (!dateInfo) {
      dateInfo = {
        streakCount: 0,
        decidedAt: null,
        triggerMarketId: null,
        triggerQuestion: null,
        triggerYesPrice: null,
      };
      positionsData.decidedDates[dateKey] = dateInfo;
    }

    // Check if above threshold
    if (maxYesPrice >= DECIDED_95_THRESHOLD && triggerMarket) {
      // Increment streak
      dateInfo.streakCount += 1;

      // Check if streak requirement met (and not already decided)
      if (dateInfo.streakCount >= DECIDED_95_STREAK_REQUIRED && dateInfo.decidedAt === null) {
        // Mark as decided
        dateInfo.decidedAt = now;
        dateInfo.triggerMarketId = triggerMarket.marketId;
        dateInfo.triggerQuestion = triggerMarket.question;
        dateInfo.triggerYesPrice = maxYesPrice;

        triggeredDates.push({ dateKey, triggerMarket });
      }
    } else {
      // Reset streak if below threshold
      dateInfo.streakCount = 0;
    }
  }

  // Save updated streak data
  if (marketsByDate.size > 0) {
    savePositionsFile();
  }

  return triggeredDates;
}
