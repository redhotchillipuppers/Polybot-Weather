// Settlement processing for executed trades

import type { MarketSnapshot, DailyPnlSummary } from '../types.js';
import { fetchResolvedOutcome, calculateTradePnl } from '../polymarket.js';
import { readLogFile, readSettlementLog, appendToSettlementLog, type SettlementEntry } from '../persistence/file-store.js';

// Track settled market IDs to avoid duplicate processing
const settledMarketIds = new Set<string>();

// Format timestamp for console output
export function formatTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

// Load already settled markets on startup
export function loadSettledMarketIds(): void {
  const settlements = readSettlementLog();
  for (const entry of settlements) {
    settledMarketIds.add(entry.marketId);
  }
}

// Get count of settled markets (for logging)
export function getSettledMarketCount(): number {
  return settledMarketIds.size;
}

// Check if a market has been settled
export function isMarketSettled(marketId: string): boolean {
  return settledMarketIds.has(marketId);
}

// Process settlement for executed trades after market close
export async function processSettlement(snapshot: MarketSnapshot): Promise<MarketSnapshot> {
  // Only process executed trades that haven't been settled yet
  if (!snapshot.executed || !snapshot.entrySide) {
    return snapshot;
  }

  // Skip if already settled
  if (settledMarketIds.has(snapshot.marketId)) {
    return snapshot;
  }

  // Check if market has closed (endDate has passed)
  if (snapshot.endDate) {
    const endTime = new Date(snapshot.endDate).getTime();
    if (isNaN(endTime) || endTime > Date.now()) {
      // Market hasn't closed yet
      return snapshot;
    }
  }

  // Fetch resolved outcome
  const resolvedOutcome = await fetchResolvedOutcome(snapshot.marketId);
  if (!resolvedOutcome) {
    // Market not yet resolved
    return snapshot;
  }

  // Calculate P&L
  const tradePnl = calculateTradePnl(
    snapshot.entrySide,
    resolvedOutcome,
    snapshot.entryYesPrice,
    snapshot.entryNoPrice
  );

  // Update snapshot with settlement data
  const settledSnapshot: MarketSnapshot = {
    ...snapshot,
    resolvedOutcome,
    tradePnl,
  };

  // Log settlement
  if (tradePnl !== null && snapshot.entryYesPrice !== null && snapshot.entryNoPrice !== null) {
    const settlementEntry: SettlementEntry = {
      timestamp: new Date().toISOString(),
      marketId: snapshot.marketId,
      question: snapshot.question,
      endDate: snapshot.endDate,
      entrySide: snapshot.entrySide,
      entryYesPrice: snapshot.entryYesPrice,
      entryNoPrice: snapshot.entryNoPrice,
      resolvedOutcome,
      tradePnl,
    };
    appendToSettlementLog(settlementEntry);
    settledMarketIds.add(snapshot.marketId);

    const pnlSign = tradePnl >= 0 ? '+' : '';
    console.log(`  SETTLED: ${snapshot.marketId.substring(0, 8)}... → ${resolvedOutcome} | P&L: ${pnlSign}${tradePnl.toFixed(4)}`);
  }

  return settledSnapshot;
}

// Aggregate daily P&L from settlement log
export function aggregateDailyPnl(): DailyPnlSummary[] {
  const settlements = readSettlementLog();
  const dailyMap = new Map<string, DailyPnlSummary>();

  for (const entry of settlements) {
    // Use endDate as settlement date
    const dateStr = entry.endDate ? entry.endDate.split('T')[0] : 'unknown';
    if (!dateStr || dateStr === 'unknown') continue;

    let daily = dailyMap.get(dateStr);
    if (!daily) {
      daily = {
        date: dateStr,
        trades: 0,
        dailyPnl: 0,
        settledMarkets: [],
      };
      dailyMap.set(dateStr, daily);
    }

    daily.trades += 1;
    daily.dailyPnl += entry.tradePnl;
    daily.settledMarkets.push({
      marketId: entry.marketId,
      entrySide: entry.entrySide,
      resolvedOutcome: entry.resolvedOutcome,
      tradePnl: entry.tradePnl,
    });
  }

  // Sort by date
  return Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// Run settlement pass for all executed trades
// If currentSnapshots is provided, uses those (from current market check) to avoid duplicate API calls
// Otherwise falls back to reading from log files (used for initial pass on startup)
export async function runSettlementPass(currentSnapshots?: MarketSnapshot[]): Promise<void> {
  const timestamp = formatTimestamp();
  console.log(`\n[${timestamp}] Settlement pass`);

  const executedTrades = new Map<string, MarketSnapshot>();

  // If current snapshots provided, use them first (reuses data from market check)
  if (currentSnapshots && currentSnapshots.length > 0) {
    for (const snapshot of currentSnapshots) {
      if (snapshot.executed && snapshot.entrySide && !settledMarketIds.has(snapshot.marketId)) {
        executedTrades.set(snapshot.marketId, snapshot);
      }
    }
  }

  // Also check log entries for any executed trades not in current snapshots
  // (e.g., trades from markets that are no longer active but need settlement)
  const entries = readLogFile();
  for (const entry of entries) {
    for (const snapshot of entry.markets) {
      if (snapshot.executed && snapshot.entrySide && !settledMarketIds.has(snapshot.marketId)) {
        // Only add if not already in the map (current snapshots take priority)
        if (!executedTrades.has(snapshot.marketId)) {
          executedTrades.set(snapshot.marketId, snapshot);
        }
      }
    }
  }

  if (executedTrades.size === 0) {
    console.log('  No unsettled executed trades found.');
    return;
  }

  console.log(`  Checking ${executedTrades.size} unsettled trade(s)...`);

  let settledCount = 0;
  for (const [_marketId, snapshot] of executedTrades) {
    const settledSnapshot = await processSettlement(snapshot);
    if (settledSnapshot.resolvedOutcome) {
      settledCount++;
    }
  }

  if (settledCount === 0) {
    console.log('  No markets resolved yet.');
  } else {
    // Show daily P&L summary
    const dailySummaries = aggregateDailyPnl();
    if (dailySummaries.length > 0) {
      console.log('\n  Daily P&L Summary:');
      for (const summary of dailySummaries) {
        const pnlSign = summary.dailyPnl >= 0 ? '+' : '';
        console.log(`    ${summary.date}: ${summary.trades} trade(s), P&L: ${pnlSign}${summary.dailyPnl.toFixed(4)}`);
      }

      const totalPnl = dailySummaries.reduce((sum, s) => sum + s.dailyPnl, 0);
      const totalTrades = dailySummaries.reduce((sum, s) => sum + s.trades, 0);
      const totalSign = totalPnl >= 0 ? '+' : '';
      console.log(`    ─────────────────────────────`);
      console.log(`    Total: ${totalTrades} trade(s), P&L: ${totalSign}${totalPnl.toFixed(4)}`);
    }
  }
}
