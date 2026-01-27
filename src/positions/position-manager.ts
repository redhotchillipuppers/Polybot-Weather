// Position management for tracking and closing trading positions

import type { MarketSnapshot, Position, PositionsFile, ClosedPositionDetail, EarlyCloseReport } from '../types.js';
import { loadPositionsFile, savePositionsFile as persistPositionsFile, appendDailyReport, POSITIONS_FILE_PATH, DAILY_REPORTS_FILE_PATH } from '../persistence/file-store.js';
import { checkDecided95, extractDateKeyFromEndDate } from './decided-95.js';

// In-memory positions state
let positionsData: PositionsFile = {
  positions: {},
  decidedDates: {},
  reportedDates: [],
};

// Get file paths for logging
export function getPositionsFilePath(): string {
  return POSITIONS_FILE_PATH;
}

export function getDailyReportsFilePath(): string {
  return DAILY_REPORTS_FILE_PATH;
}

// Save current positions data to file
function savePositionsFile(): void {
  persistPositionsFile(positionsData);
}

// Create a position for an executed trade (if not already exists)
export function createPositionIfNeeded(snapshot: MarketSnapshot): void {
  // Only create for executed trades
  if (!snapshot.executed || !snapshot.entrySide || snapshot.entryYesPrice === null || snapshot.entryNoPrice === null) {
    return;
  }

  const dateKey = extractDateKeyFromEndDate(snapshot.endDate);
  if (!dateKey) {
    console.warn(`[Position] Could not extract dateKey from endDate: ${snapshot.endDate}`);
    return;
  }

  // Check if position already exists and is open
  const existingPosition = positionsData.positions[snapshot.marketId];
  if (existingPosition && existingPosition.isOpen) {
    // Position already exists and is open, skip
    return;
  }

  // Create new position
  const position: Position = {
    marketId: snapshot.marketId,
    dateKey,
    question: snapshot.question,
    entrySide: snapshot.entrySide,
    size: 1, // Constant for now
    entryYesPrice: snapshot.entryYesPrice,
    entryNoPrice: snapshot.entryNoPrice,
    openedAt: new Date().toISOString(),
    isOpen: true,
    closedAt: null,
    exitYesPrice: null,
    exitNoPrice: null,
    closeReason: null,
    realizedPnl: null,
  };

  positionsData.positions[snapshot.marketId] = position;
  savePositionsFile();

  // Extract short label for logging
  const tempMatch = snapshot.question.match(/(\d+(?:\.\d+)?[°º\s]*C(?:\s+or\s+(?:higher|below))?)/i);
  const tempLabel = tempMatch ? tempMatch[1] : snapshot.marketId.substring(0, 8);
  console.log(`[Position] Opened ${snapshot.entrySide} position on market ${snapshot.marketId.substring(0, 8)}... (${tempLabel})`);
}

// Close all open positions for a date and generate report
export function closePositionsForDate(
  dateKey: string,
  triggerMarket: MarketSnapshot,
  currentMarketSnapshots: MarketSnapshot[]
): void {
  // Skip if already reported
  if (positionsData.reportedDates.includes(dateKey)) {
    return;
  }

  const now = new Date().toISOString();
  const closedPositionDetails: ClosedPositionDetail[] = [];
  let totalRealizedPnl = 0;
  const breakdownByEntrySide = {
    YES: { count: 0, totalPnl: 0 },
    NO: { count: 0, totalPnl: 0 },
  };

  // Find all open positions for this dateKey
  const positionsToClose: Position[] = [];
  for (const marketId of Object.keys(positionsData.positions)) {
    const position = positionsData.positions[marketId];
    if (position && position.dateKey === dateKey && position.isOpen) {
      positionsToClose.push(position);
    }
  }

  // Close each position
  for (const position of positionsToClose) {
    // Find current market snapshot for exit price
    const currentSnapshot = currentMarketSnapshots.find(s => s.marketId === position.marketId);
    const exitYesPrice = currentSnapshot?.yesPrice ?? triggerMarket.yesPrice ?? 0.95;
    const exitNoPrice = 1 - exitYesPrice;

    // Calculate P&L using mark-to-market
    let realizedPnl: number;
    if (position.entrySide === 'YES') {
      realizedPnl = (exitYesPrice - position.entryYesPrice) * position.size;
    } else {
      realizedPnl = (exitNoPrice - position.entryNoPrice) * position.size;
    }

    // Update position
    position.isOpen = false;
    position.closedAt = now;
    position.exitYesPrice = exitYesPrice;
    position.exitNoPrice = exitNoPrice;
    position.closeReason = 'DECIDED_95';
    position.realizedPnl = realizedPnl;

    // Track for report
    closedPositionDetails.push({
      marketId: position.marketId,
      question: position.question,
      entrySide: position.entrySide,
      entryYesPrice: position.entryYesPrice,
      entryNoPrice: position.entryNoPrice,
      exitYesPrice,
      exitNoPrice,
      realizedPnl,
      openedAt: position.openedAt,
      closedAt: now,
    });

    totalRealizedPnl += realizedPnl;
    breakdownByEntrySide[position.entrySide].count += 1;
    breakdownByEntrySide[position.entrySide].totalPnl += realizedPnl;
  }

  // Get decided date info
  const dateInfo = positionsData.decidedDates[dateKey];

  // Generate report
  const report: EarlyCloseReport = {
    dateKey,
    decidedAt: dateInfo?.decidedAt ?? now,
    decidedMarketId: dateInfo?.triggerMarketId ?? triggerMarket.marketId,
    decidedQuestion: dateInfo?.triggerQuestion ?? triggerMarket.question,
    decidedYesPrice: dateInfo?.triggerYesPrice ?? (triggerMarket.yesPrice ?? 0.95),
    numberOfPositionsClosed: positionsToClose.length,
    totalRealizedPnl,
    breakdownByEntrySide,
    closedPositions: closedPositionDetails,
  };

  // Save report
  appendDailyReport(report);

  // Mark date as reported
  positionsData.reportedDates.push(dateKey);
  savePositionsFile();

  // Log to terminal
  const pnlSign = totalRealizedPnl >= 0 ? '+' : '';
  console.log(`[Position] Date ${dateKey} DECIDED_95 (streak: ${dateInfo?.streakCount ?? 2}) - closing ${positionsToClose.length} position(s)`);
  console.log(`[Position] Closed ${positionsToClose.length} position(s) for ${dateKey}: Total P&L: ${pnlSign}$${totalRealizedPnl.toFixed(2)}`);
}

// Process all position management for a market check
export function processPositionManagement(marketSnapshots: MarketSnapshot[]): void {
  // Step 1: Create positions for executed trades
  for (const snapshot of marketSnapshots) {
    if (snapshot.executed) {
      createPositionIfNeeded(snapshot);
    }
  }

  // Step 2: Check for DECIDED_95 conditions
  const triggeredDates = checkDecided95(marketSnapshots, positionsData, savePositionsFile);

  // Step 3: Close positions and generate reports for triggered dates
  for (const { dateKey, triggerMarket } of triggeredDates) {
    closePositionsForDate(dateKey, triggerMarket, marketSnapshots);
  }
}

// Load positions data on startup
export function loadPositionsData(): void {
  positionsData = loadPositionsFile();
  const openPositionCount = Object.values(positionsData.positions).filter(p => p.isOpen).length;
  const decidedDateCount = Object.values(positionsData.decidedDates).filter(d => d.decidedAt !== null).length;
  console.log(`Loaded ${openPositionCount} open position(s), ${decidedDateCount} decided date(s), ${positionsData.reportedDates.length} reported date(s).`);
}
