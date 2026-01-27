// File persistence utilities for monitoring, settlement, and position data

import * as fs from 'fs';
import * as path from 'path';
import { formatError } from '../api-utils.js';
import type { WeatherForecast, MarketSnapshot, PositionsFile, EarlyCloseReport } from '../types.js';

// File path constants
export const POSITIONS_FILE_PATH = path.join(process.cwd(), 'positions.json');
export const DAILY_REPORTS_FILE_PATH = path.join(process.cwd(), 'daily_reports.json');

// Monitoring entry for tracking weather and market data
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
// MONITORING LOG FUNCTIONS
// ============================================================

// Get log file path for today
export function getLogFilePath(): string {
  const today = new Date().toISOString().split('T')[0];
  return path.join(process.cwd(), `market_monitoring_${today}.json`);
}

// Read existing log entries from file
export function readLogFile(): MonitoringEntry[] {
  const logPath = getLogFilePath();
  try {
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf-8');
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (error) {
    console.error(`Error reading log file, starting fresh: ${formatError(error)}`);
  }
  return [];
}

// Append entry to log file (silent unless error - path shown in startup banner)
export function appendToLog(entry: MonitoringEntry): void {
  const logPath = getLogFilePath();

  try {
    const entries = readLogFile();
    entries.push(entry);
    fs.writeFileSync(logPath, JSON.stringify(entries, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Error writing to log file: ${formatError(error)}`);
  }
}

// ============================================================
// SETTLEMENT LOG FUNCTIONS
// ============================================================

// Get settlement log file path
export function getSettlementLogFilePath(): string {
  return path.join(process.cwd(), 'settlement_log.json');
}

// Read settlement log file
export function readSettlementLog(): SettlementEntry[] {
  const logPath = getSettlementLogFilePath();
  try {
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf-8');
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (error) {
    console.error(`Error reading settlement log: ${formatError(error)}`);
  }
  return [];
}

// Append settlement entry to log
export function appendToSettlementLog(entry: SettlementEntry): void {
  const logPath = getSettlementLogFilePath();

  try {
    const entries = readSettlementLog();
    entries.push(entry);
    fs.writeFileSync(logPath, JSON.stringify(entries, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Error writing to settlement log: ${formatError(error)}`);
  }
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
  try {
    if (fs.existsSync(POSITIONS_FILE_PATH)) {
      const content = fs.readFileSync(POSITIONS_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(content);
      // Validate structure
      if (parsed && typeof parsed === 'object') {
        return {
          positions: parsed.positions || {},
          decidedDates: parsed.decidedDates || {},
          reportedDates: Array.isArray(parsed.reportedDates) ? parsed.reportedDates : [],
        };
      }
    }
  } catch (error) {
    console.error(`Error reading positions file, starting fresh: ${formatError(error)}`);
  }
  return getEmptyPositionsFile();
}

// Save positions file
export function savePositionsFile(positionsData: PositionsFile): void {
  try {
    fs.writeFileSync(POSITIONS_FILE_PATH, JSON.stringify(positionsData, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Error writing positions file: ${formatError(error)}`);
  }
}

// ============================================================
// DAILY REPORTS FILE FUNCTIONS
// ============================================================

// Load daily reports file
export function loadDailyReports(): EarlyCloseReport[] {
  try {
    if (fs.existsSync(DAILY_REPORTS_FILE_PATH)) {
      const content = fs.readFileSync(DAILY_REPORTS_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (error) {
    console.error(`Error reading daily reports file, starting fresh: ${formatError(error)}`);
  }
  return [];
}

// Save daily reports file (append a new report)
export function appendDailyReport(report: EarlyCloseReport): void {
  try {
    const reports = loadDailyReports();
    reports.push(report);
    fs.writeFileSync(DAILY_REPORTS_FILE_PATH, JSON.stringify(reports, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Error writing daily reports file: ${formatError(error)}`);
  }
}
