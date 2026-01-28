// File persistence utilities for monitoring, settlement, and position data

import type { WeatherForecast, MarketSnapshot, PositionsFile, EarlyCloseReport, MonitoringSnapshot, DecisionRecord, MarketObservation, MarketDecision } from '../types.js';
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
  weatherForecast: WeatherForecast | null;  // Deprecated: kept for backwards compatibility
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
    endDate: snapshot.endDate,
    minutesToClose: snapshot.minutesToClose,
    volume: snapshot.volume,
    liquidity: snapshot.liquidity,
    isTradeable: snapshot.isTradeable,
  };
}

/**
 * Convert MarketSnapshot to MarketDecision (model outputs only)
 */
export function toMarketDecision(snapshot: MarketSnapshot, dateKey: string): MarketDecision {
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
  markets: MarketSnapshot[]
): string {
  const snapshotId = generateId();
  const snapshot: MonitoringSnapshot = {
    snapshotId,
    timestamp: new Date().toISOString(),
    entryType: 'market_check',
    weatherForecasts,
    markets: markets.map(toMarketObservation),
  };

  appendJsonl(getMonitoringLogPath(), snapshot);
  return snapshotId;
}

/**
 * Create and append a decision record (model outputs)
 * Returns the decisionId for correlation
 */
export function appendDecisionRecord(
  snapshotId: string,
  markets: MarketSnapshot[],
  dateKeyExtractor: (endDate: string) => string | null
): string {
  const decisionId = generateId();
  const decisions: MarketDecision[] = [];

  for (const market of markets) {
    const dateKey = dateKeyExtractor(market.endDate);
    if (dateKey) {
      decisions.push(toMarketDecision(market, dateKey));
    }
  }

  const record: DecisionRecord = {
    decisionId,
    snapshotId,
    timestamp: new Date().toISOString(),
    decisions,
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
        resolvedOutcome: null,
        tradePnl: null,
      };
    });

    entries.push({
      timestamp: snapshot.timestamp,
      entryType: snapshot.entryType === 'market_check' ? 'combined' : snapshot.entryType,
      weatherForecast: snapshot.weatherForecasts[0] ?? null,
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
    reportedDates: [],
  };
}

// Load positions file
export function loadPositionsFile(): PositionsFile {
  const data = readJson<PositionsFile | null>(getPositionsPath(), null);
  if (data && typeof data === 'object') {
    return {
      positions: data.positions || {},
      decidedDates: data.decidedDates || {},
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
