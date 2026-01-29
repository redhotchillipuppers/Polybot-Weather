// Position management for tracking and closing trading positions

import type {
  MarketSnapshot,
  Position,
  PositionsFile,
  ClosedPositionDetail,
  EarlyCloseReport,
  SkipReason,
  CandidateSelection,
  CandidateState,
  StopExitInfo,
  WeatherForecast,
} from '../types.js';
import { loadPositionsFile, savePositionsFile as persistPositionsFile, appendDailyReport, POSITIONS_FILE_PATH, DAILY_REPORTS_FILE_PATH } from '../persistence/file-store.js';
import { checkDecided95, extractDateKeyFromEndDate } from './decided-95.js';
import type { LadderStats } from '../ladder-coherence.js';
import { parseMarketQuestion } from '../parsers/market-parser.js';
import { calculateHoursUntilResolution, calculateMarketProbability } from '../probability-model.js';
import { STOP_EDGE_FLIP, STOP_MAX_PROXIMITY_C } from '../config/constants.js';

// In-memory positions state
let positionsData: PositionsFile = {
  positions: {},
  decidedDates: {},
  candidateState: {},
  stoppedOutDates: {},
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

// Check if a dateKey already has an open position
function hasOpenPositionForDateKey(dateKey: string): boolean {
  for (const position of Object.values(positionsData.positions)) {
    if (position.dateKey === dateKey && position.isOpen) {
      return true;
    }
  }
  return false;
}

export function canEnter(dateKey: string): boolean {
  const decidedInfo = positionsData.decidedDates[dateKey];
  if (decidedInfo?.decidedAt) {
    return false;
  }
  if (positionsData.stoppedOutDates[dateKey]) {
    return false;
  }
  if (hasOpenPositionForDateKey(dateKey)) {
    return false;
  }
  return true;
}

export function updateCandidateState(
  dateKey: string,
  bestCandidateKey: string | null,
  bestScore: number | null
): CandidateState {
  const now = new Date().toISOString();
  let state = positionsData.candidateState[dateKey];
  if (!state) {
    state = {
      bestCandidateKey: null,
      bestScore: null,
      bestStreakCount: 0,
      bestSince: null,
    };
  }

  if (!bestCandidateKey) {
    state.bestCandidateKey = null;
    state.bestScore = null;
    state.bestStreakCount = 0;
    state.bestSince = null;
  } else if (state.bestCandidateKey === bestCandidateKey) {
    state.bestStreakCount += 1;
    state.bestScore = bestScore;
  } else {
    state.bestCandidateKey = bestCandidateKey;
    state.bestScore = bestScore;
    state.bestStreakCount = 1;
    state.bestSince = now;
  }

  positionsData.candidateState[dateKey] = state;
  savePositionsFile();
  return state;
}

export function recordEntry(
  dateKey: string,
  candidate: CandidateSelection,
  snapshotId?: string,
  decisionId?: string
): void {
  const now = new Date().toISOString();
  const decidedInfo = positionsData.decidedDates[dateKey] ?? {
    streakCount: 0,
    decidedAt: null,
    decided95At: null,
    triggerMarketId: null,
    triggerQuestion: null,
    triggerYesPrice: null,
    triggerSide: null,
    triggerNoPrice: null,
  };

  decidedInfo.decidedAt = now;
  decidedInfo.triggerMarketId = candidate.marketId;
  decidedInfo.triggerQuestion = candidate.question;
  decidedInfo.triggerYesPrice = candidate.yesPrice;
  decidedInfo.triggerSide = candidate.side;
  decidedInfo.triggerNoPrice = candidate.noPrice;
  positionsData.decidedDates[dateKey] = decidedInfo;

  const position: Position = {
    marketId: candidate.marketId,
    dateKey,
    question: candidate.question,
    entrySide: candidate.side,
    size: 1,
    entryYesPrice: candidate.yesPrice ?? 0,
    entryNoPrice: candidate.noPrice ?? 0,
    entryStrikeTempC: candidate.strikeTempC,
    entryBracketType: candidate.bracketType,
    openedAt: now,
    modelProbability: candidate.modelProbability,
    edge: candidate.edge,
    isOpen: true,
    closedAt: null,
    exitYesPrice: null,
    exitNoPrice: null,
    closeReason: null,
    realizedPnl: null,
    snapshotId,
    decisionId,
  };

  positionsData.positions[candidate.marketId] = position;
  savePositionsFile();

  const tempLabel = `${candidate.strikeTempC}°C`;
  console.log(`[Position] Opened ${candidate.side} position on market ${candidate.marketId.substring(0, 8)}... (${tempLabel})`);
}

// Create a position for an executed trade (if not already exists)
// Returns skipReason if position was blocked, null if created or skipped normally
export function createPositionIfNeeded(
  snapshot: MarketSnapshot,
  snapshotId?: string,
  decisionId?: string,
  ladderStats?: Map<string, LadderStats>
): SkipReason {
  // Only create for executed trades
  if (!snapshot.executed || !snapshot.entrySide || snapshot.entryYesPrice === null || snapshot.entryNoPrice === null) {
    return null;
  }

  const dateKey = extractDateKeyFromEndDate(snapshot.endDate);
  if (!dateKey) {
    console.warn(`[Position] Could not extract dateKey from endDate: ${snapshot.endDate}`);
    return null;
  }

  // Check if position already exists for this specific market and is open
  const existingPosition = positionsData.positions[snapshot.marketId];
  if (existingPosition && existingPosition.isOpen) {
    // Position already exists and is open, skip
    return null;
  }

  // Step 3 execution constraint: Check ladder coherence
  if (ladderStats) {
    const stats = ladderStats.get(dateKey);
    if (stats && !stats.ladderCoherent) {
      console.log(`[Position] Blocked execution for ${snapshot.marketId.substring(0, 8)}...: skipReason=LADDER_INCOHERENT`);
      return 'LADDER_INCOHERENT';
    }
  }

  // Step 3 execution constraint: Check if any open position exists with same dateKey
  if (hasOpenPositionForDateKey(dateKey)) {
    console.log(`[Position] Blocked execution for ${snapshot.marketId.substring(0, 8)}...: skipReason=DATEKEY_ALREADY_HAS_POSITION`);
    return 'DATEKEY_ALREADY_HAS_POSITION';
  }

  // Create new position with correlation IDs
  const parsedQuestion = parseMarketQuestion(snapshot.question);
  const position: Position = {
    marketId: snapshot.marketId,
    dateKey,
    question: snapshot.question,
    entrySide: snapshot.entrySide,
    size: 1, // Constant for now
    entryYesPrice: snapshot.entryYesPrice,
    entryNoPrice: snapshot.entryNoPrice,
    entryStrikeTempC: parsedQuestion?.bracketValue ?? null,
    entryBracketType: parsedQuestion?.bracketType ?? null,
    openedAt: new Date().toISOString(),
    modelProbability: snapshot.modelProbability,
    edge: snapshot.edge,
    isOpen: true,
    closedAt: null,
    exitYesPrice: null,
    exitNoPrice: null,
    closeReason: null,
    realizedPnl: null,
    snapshotId,  // Correlation to monitoring snapshot
    decisionId,  // Correlation to decision record
  };

  positionsData.positions[snapshot.marketId] = position;
  savePositionsFile();

  // Extract short label for logging
  const tempMatch = snapshot.question.match(/(\d+(?:\.\d+)?[°º\s]*C(?:\s+or\s+(?:higher|below))?)/i);
  const tempLabel = tempMatch ? tempMatch[1] : snapshot.marketId.substring(0, 8);
  console.log(`[Position] Opened ${snapshot.entrySide} position on market ${snapshot.marketId.substring(0, 8)}... (${tempLabel})`);
  return null;
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
    decidedAt: dateInfo?.decided95At ?? dateInfo?.decidedAt ?? now,
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
export function processPositionManagement(
  marketSnapshots: MarketSnapshot[],
  weatherForecasts: WeatherForecast[],
  ladderStats?: Map<string, LadderStats>
): StopExitInfo[] {
  const stopExits: StopExitInfo[] = [];
  const forecastMap = new Map<string, WeatherForecast>();
  for (const forecast of weatherForecasts) {
    forecastMap.set(forecast.date, forecast);
  }

  const now = new Date().toISOString();
  let positionsUpdated = false;

  for (const position of Object.values(positionsData.positions)) {
    if (!position.isOpen) continue;

    const forecast = forecastMap.get(position.dateKey);
    if (!forecast) continue;

    const snapshot = marketSnapshots.find(s => s.marketId === position.marketId);
    if (!snapshot) continue;

    const parsed = parseMarketQuestion(position.question);
    if (!parsed) continue;

    const modelTempC = forecast.maxTemperature;
    const proximityAbsC = Math.abs(modelTempC - parsed.bracketValue);
    const hoursUntilResolution = snapshot.endDate
      ? calculateHoursUntilResolution(snapshot.endDate)
      : 0;
    const modelProbability = calculateMarketProbability(
      modelTempC,
      hoursUntilResolution,
      parsed.bracketType,
      parsed.bracketValue
    );

    const yesPrice = snapshot.yesPrice;
    const noPrice = snapshot.noPrice ?? (yesPrice !== null ? 1 - yesPrice : null);

    if (yesPrice === null || noPrice === null) continue;

    const edgeNow = position.entrySide === 'YES'
      ? modelProbability - yesPrice
      : (1 - modelProbability) - noPrice;

    let closeReason: StopExitInfo['closeReason'] | null = null;
    if (proximityAbsC > STOP_MAX_PROXIMITY_C) {
      closeReason = 'STOP_PROXIMITY';
    } else if (edgeNow < -STOP_EDGE_FLIP) {
      closeReason = 'STOP_EDGE_FLIP';
    }

    if (!closeReason) {
      continue;
    }

    const realizedPnl = position.entrySide === 'YES'
      ? (yesPrice - position.entryYesPrice) * position.size
      : (noPrice - position.entryNoPrice) * position.size;

    position.isOpen = false;
    position.closedAt = now;
    position.exitYesPrice = yesPrice;
    position.exitNoPrice = noPrice;
    position.closeReason = closeReason;
    position.realizedPnl = realizedPnl;
    positionsData.stoppedOutDates[position.dateKey] = true;
    positionsUpdated = true;

    stopExits.push({
      dateKey: position.dateKey,
      marketId: position.marketId,
      closeReason,
      modelTempC,
      proximityAbsC,
      edgeNow,
      yesPrice,
      noPrice,
    });

    console.log(`[Position] STOP_EXIT ${closeReason} for ${position.marketId.substring(0, 8)}... (date ${position.dateKey})`);
  }

  if (positionsUpdated) {
    savePositionsFile();
  }

  // Step 2: Check for DECIDED_95 conditions
  const triggeredDates = checkDecided95(marketSnapshots, positionsData, savePositionsFile);

  // Step 3: Close positions and generate reports for triggered dates
  for (const { dateKey, triggerMarket } of triggeredDates) {
    if (!hasOpenPositionForDateKey(dateKey)) {
      continue;
    }
    closePositionsForDate(dateKey, triggerMarket, marketSnapshots);
  }

  return stopExits;
}

// Load positions data on startup
export function loadPositionsData(): void {
  positionsData = loadPositionsFile();
  const openPositionCount = Object.values(positionsData.positions).filter(p => p.isOpen).length;
  const decidedDateCount = Object.values(positionsData.decidedDates).filter(d => d.decidedAt !== null).length;
  console.log(`Loaded ${openPositionCount} open position(s), ${decidedDateCount} decided date(s), ${positionsData.reportedDates.length} reported date(s).`);
}
