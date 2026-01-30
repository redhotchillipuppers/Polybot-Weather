// File persistence utilities for monitoring, settlement, and position data

import type {
  WeatherForecast,
  MarketSnapshot,
  PositionsFile,
  EarlyCloseReport,
  MonitoringSnapshot,
  DecisionRecord,
  MarketObservation,
  MarketDecision,
  SkipReason,
  CandidateSelection,
  DecisionActionRecord,
} from '../types.js';
import type { LadderStats } from '../ladder-coherence.js';
import {
  initializeLogDirectories,
  getMonitoringLogPath,
  getDecisionsLogPath,
  getPositionsPath,
  getSettlementLogPath,
  getDailyReportsPath,
  appendJsonl,
  readJsonl,
  readJson,
  writeJsonAtomic,
  generateId,
  getUtcDateKey,
} from './log-utils.js';

// ============================================================
// FILE PATH EXPORTS (for display in startup banner)
// ============================================================

export function getLogFilePath(): string {
  return getMonitoringLogPath();
}

export function getSettlementLogFilePath(): string {
  return getSettlementLogPath();
}

export const POSITIONS_FILE_PATH = getPositionsPath();
export const DAILY_REPORTS_FILE_PATH = getDailyReportsPath();

// ============================================================
// LEGACY TYPES (kept for backward compatibility with existing code)
// ============================================================

// Monitoring entry for tracking weather and market data (legacy format)
export interface MonitoringEntry {
  timestamp: string;
  entryType: 'market_check' | 'weather_check' | 'combined';
  weatherForecasts: WeatherForecast[];       // Weather forecasts matching market dates
  markets: MarketSnapshot[];
}

// Settlement entry for tracking settled trades
export interface SettlementEntry {
  timestamp: string;
  marketId: string;
  question: string;
  endDate: string;
  entrySide: 'YES' | 'NO';
  entryYesPrice: number;
  entryNoPrice: number;
  resolvedOutcome: 'YES' | 'NO';
  tradePnl: number;
}

// ============================================================
// INITIALIZATION
// ============================================================

// Initialize log directories (call at startup)
export function initializeLogs(): void {
  initializeLogDirectories();
}

// ============================================================
// NEW SPLIT LOGGING FUNCTIONS (JSONL format)
// ============================================================

/**
 * Convert MarketSnapshot to MarketObservation (raw data only, no signals)
 */
export function toMarketObservation(snapshot: MarketSnapshot): MarketObservation {
  return {
    marketId: snapshot.marketId,
    question: snapshot.question,
    temperatureValue: snapshot.temperatureValue,
    outcomes: snapshot.outcomes,
    prices: snapshot.prices,
    yesPrice: snapshot.yesPrice,
    noPrice: snapshot.noPrice,
    endDate: snapshot.endDate,
    minutesToClose: snapshot.minutesToClose,
    volume: snapshot.volume,
    liquidity: snapshot.liquidity,
    isTradeable: snapshot.isTradeable,
  };
}

/**
 * Convert MarketSnapshot to MarketDecision (model outputs only)
 * If skipReason is provided, forces signal to HOLD and edge to 0
 */
export function toMarketDecision(
  snapshot: MarketSnapshot,
  dateKey: string,
  skipReason: SkipReason = null
): MarketDecision {
  // Apply gating if skipReason is set
  if (skipReason) {
    return {
      marketId: snapshot.marketId,
      dateKey,
      modelProbability: snapshot.modelProbability,
      edge: 0,
      edgePercent: 0,
      signal: 'HOLD',
      forecastError: snapshot.forecastError,
      executed: false,
      entrySide: null,
      entryYesPrice: null,
      entryNoPrice: null,
      skipReason,
    };
  }

  return {
    marketId: snapshot.marketId,
    dateKey,
    modelProbability: snapshot.modelProbability,
    edge: snapshot.edge,
    edgePercent: snapshot.edgePercent,
    signal: snapshot.signal,
    forecastError: snapshot.forecastError,
    executed: snapshot.executed,
    entrySide: snapshot.entrySide,
    entryYesPrice: snapshot.entryYesPrice,
    entryNoPrice: snapshot.entryNoPrice,
  };
}

/**
 * Create and append a monitoring snapshot (raw observation data)
 * Returns the snapshotId for correlation
 */
export function appendMonitoringSnapshot(
  weatherForecasts: WeatherForecast[],
  markets: MarketSnapshot[],
  modelTempsByDate: { [dateKey: string]: number } = {},
  bestCandidatesByDate: CandidateSelection[] = []
): string {
  const snapshotId = generateId();
  const snapshot: MonitoringSnapshot = {
    snapshotId,
    timestamp: new Date().toISOString(),
    entryType: 'market_check',
    weatherForecasts,
    markets: markets.map(toMarketObservation),
    modelTempsByDate,
    bestCandidatesByDate,
  };

  appendJsonl(getMonitoringLogPath(), snapshot);
  return snapshotId;
}

/**
 * Create and append a decision record (model outputs)
 * Returns the decisionId for correlation
 * Applies ladder coherence gating when ladderStats is provided
 */
export function appendDecisionRecord(
  snapshotId: string,
  markets: MarketSnapshot[],
  dateKeyExtractor: (endDate: string) => string | null,
  ladderStats?: Map<string, LadderStats>,
  options?: {
    bestCandidatesByDate?: CandidateSelection[];
    actions?: DecisionActionRecord[];
    decisionId?: string;
  }
): string {
  const decisionId = options?.decisionId ?? generateId();
  const decisions: MarketDecision[] = [];

  for (const market of markets) {
    const dateKey = dateKeyExtractor(market.endDate);
    if (dateKey) {
      // Check ladder coherence for this dateKey
      let skipReason: SkipReason = null;
      if (ladderStats) {
        const stats = ladderStats.get(dateKey);
        if (stats && !stats.ladderCoherent) {
          skipReason = 'LADDER_INCOHERENT';
        }
      }
      decisions.push(toMarketDecision(market, dateKey, skipReason));
    }
  }

  const record: DecisionRecord = {
    decisionId,
    snapshotId,
    timestamp: new Date().toISOString(),
    decisions,
    bestCandidatesByDate: options?.bestCandidatesByDate ?? [],
    actions: options?.actions ?? [],
  };

  appendJsonl(getDecisionsLogPath(), record);
  return decisionId;
}

/**
 * Read monitoring snapshots for today
 */
export function readMonitoringSnapshots(date: Date = new Date()): MonitoringSnapshot[] {
  return readJsonl<MonitoringSnapshot>(getMonitoringLogPath(date));
}

/**
 * Read decision records for today
 */
export function readDecisionRecords(date: Date = new Date()): DecisionRecord[] {
  return readJsonl<DecisionRecord>(getDecisionsLogPath(date));
}

// ============================================================
// LEGACY MONITORING LOG FUNCTIONS (for backward compatibility)
// ============================================================

// Read existing log entries from file (legacy format)
export function readLogFile(): MonitoringEntry[] {
  // Read from new JSONL format and convert to legacy format
  const snapshots = readMonitoringSnapshots();
  const decisions = readDecisionRecords();

  // Build a map of decisions by snapshotId for quick lookup
  const decisionMap = new Map<string, DecisionRecord>();
  for (const decision of decisions) {
    decisionMap.set(decision.snapshotId, decision);
  }

  // Convert to legacy format
  const entries: MonitoringEntry[] = [];
  for (const snapshot of snapshots) {
    const decision = decisionMap.get(snapshot.snapshotId);

    // Reconstruct MarketSnapshot from observation + decision
    const markets: MarketSnapshot[] = snapshot.markets.map(obs => {
      // Find matching decision
      const marketDecision = decision?.decisions.find(d => d.marketId === obs.marketId);

      return {
        ...obs,
        modelProbability: marketDecision?.modelProbability ?? null,
        edge: marketDecision?.edge ?? null,
        edgePercent: marketDecision?.edgePercent ?? null,
        signal: marketDecision?.signal ?? null,
        forecastError: marketDecision?.forecastError ?? null,
        executed: marketDecision?.executed ?? false,
        entrySide: marketDecision?.entrySide ?? null,
        entryYesPrice: marketDecision?.entryYesPrice ?? null,
        entryNoPrice: marketDecision?.entryNoPrice ?? null,
        noPrice: obs.noPrice ?? null,
        resolvedOutcome: null,
        tradePnl: null,
      };
    });

    entries.push({
      timestamp: snapshot.timestamp,
      entryType: snapshot.entryType === 'market_check' ? 'combined' : snapshot.entryType,
      weatherForecasts: snapshot.weatherForecasts,
      markets,
    });
  }

  return entries;
}

// Append entry to log file (legacy - now writes to split logs)
export function appendToLog(entry: MonitoringEntry): void {
  // Write to new split log format
  const dummyExtractor = (endDate: string): string | null => {
    try {
      return endDate ? getUtcDateKey(new Date(endDate)) : null;
    } catch {
      return null;
    }
  };

  const snapshotId = appendMonitoringSnapshot(entry.weatherForecasts, entry.markets);
  appendDecisionRecord(snapshotId, entry.markets, dummyExtractor);
}

// ============================================================
// SETTLEMENT LOG FUNCTIONS
// ============================================================

// Read settlement log file
export function readSettlementLog(): SettlementEntry[] {
  return readJson<SettlementEntry[]>(getSettlementLogPath(), []);
}

// Append settlement entry to log
export function appendToSettlementLog(entry: SettlementEntry): void {
  const entries = readSettlementLog();
  entries.push(entry);
  writeJsonAtomic(getSettlementLogPath(), entries);
}

// ============================================================
// POSITIONS FILE FUNCTIONS
// ============================================================

// Get default empty positions file structure
export function getEmptyPositionsFile(): PositionsFile {
  return {
    positions: {},
    decidedDates: {},
    candidateState: {},
    stoppedOutDates: {},
    reportedDates: [],
  };
}

// Load positions file
export function loadPositionsFile(): PositionsFile {
  const data = readJson<PositionsFile | null>(getPositionsPath(), null);
  if (data && typeof data === 'object') {
    const decidedDates = data.decidedDates || {};
    const normalizedDecidedDates: PositionsFile['decidedDates'] = {};
    for (const [dateKey, info] of Object.entries(decidedDates)) {
      normalizedDecidedDates[dateKey] = {
        streakCount: info?.streakCount ?? 0,
        decidedAt: info?.decidedAt ?? null,
        decided95At: info?.decided95At ?? null,
        triggerMarketId: info?.triggerMarketId ?? null,
        triggerQuestion: info?.triggerQuestion ?? null,
        triggerYesPrice: info?.triggerYesPrice ?? null,
        triggerSide: info?.triggerSide ?? null,
        triggerNoPrice: info?.triggerNoPrice ?? null,
      };
    }

    const candidateState = data.candidateState || {};
    const normalizedCandidateState: PositionsFile['candidateState'] = {};
    for (const [dateKey, info] of Object.entries(candidateState)) {
      normalizedCandidateState[dateKey] = {
        bestCandidateKey: info?.bestCandidateKey ?? null,
        bestScore: info?.bestScore ?? null,
        bestStreakCount: info?.bestStreakCount ?? 0,
        bestSince: info?.bestSince ?? null,
      };
    }

    // Normalize stoppedOutDates: convert legacy boolean values to numbers
    const stoppedOutDates = data.stoppedOutDates || {};
    const normalizedStoppedOutDates: PositionsFile['stoppedOutDates'] = {};
    for (const [dateKey, value] of Object.entries(stoppedOutDates)) {
      if (typeof value === 'boolean') {
        // Legacy boolean: true means was locked, treat as max stopouts
        normalizedStoppedOutDates[dateKey] = value ? 2 : 0;
      } else if (typeof value === 'number') {
        normalizedStoppedOutDates[dateKey] = value;
      } else {
        normalizedStoppedOutDates[dateKey] = 0;
      }
    }

    return {
      positions: data.positions || {},
      decidedDates: normalizedDecidedDates,
      candidateState: normalizedCandidateState,
      stoppedOutDates: normalizedStoppedOutDates,
      reportedDates: Array.isArray(data.reportedDates) ? data.reportedDates : [],
    };
  }
  return getEmptyPositionsFile();
}

// Save positions file
export function savePositionsFile(positionsData: PositionsFile): void {
  writeJsonAtomic(getPositionsPath(), positionsData);
}

// ============================================================
// DAILY REPORTS FILE FUNCTIONS
// ============================================================

// Load daily reports file
export function loadDailyReports(): EarlyCloseReport[] {
  return readJson<EarlyCloseReport[]>(getDailyReportsPath(), []);
}

// Save daily reports file (append a new report)
export function appendDailyReport(report: EarlyCloseReport): void {
  const reports = loadDailyReports();
  reports.push(report);
  writeJsonAtomic(getDailyReportsPath(), reports);
}
