// Log utility functions for file operations and directory management

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { formatError } from '../api-utils.js';

// Base logs directory
export const LOGS_BASE_DIR = path.join(process.cwd(), 'logs');

// Log subdirectories
export const LOG_DIRS = {
  monitoring: path.join(LOGS_BASE_DIR, 'monitoring'),
  decisions: path.join(LOGS_BASE_DIR, 'decisions'),
  trading: path.join(LOGS_BASE_DIR, 'trading'),
  reports: path.join(LOGS_BASE_DIR, 'reports'),
} as const;

/**
 * Ensure a directory exists, creating it recursively if needed
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Ensure a directory exists (async version)
 */
export async function ensureDirAsync(dirPath: string): Promise<void> {
  try {
    await fsPromises.access(dirPath);
  } catch {
    await fsPromises.mkdir(dirPath, { recursive: true });
  }
}

/**
 * Initialize all log directories at startup
 */
export function initializeLogDirectories(): void {
  ensureDir(LOGS_BASE_DIR);
  ensureDir(LOG_DIRS.monitoring);
  ensureDir(LOG_DIRS.decisions);
  ensureDir(LOG_DIRS.trading);
  ensureDir(LOG_DIRS.reports);
}

/**
 * Get UTC date key in YYYY-MM-DD format
 */
export function getUtcDateKey(date: Date = new Date()): string {
  return date.toISOString().split('T')[0] ?? '';
}

/**
 * Generate a UUID v4 for correlation IDs
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Append a JSON object to a JSONL file (one JSON object per line)
 * Ensures proper newline termination
 */
export function appendJsonl<T>(filePath: string, obj: T): void {
  try {
    // Ensure the parent directory exists
    const dirPath = path.dirname(filePath);
    ensureDir(dirPath);

    // Serialize to JSON and ensure newline termination
    const line = JSON.stringify(obj) + '\n';
    fs.appendFileSync(filePath, line, 'utf-8');
  } catch (error) {
    console.error(`Error appending to JSONL file ${filePath}: ${formatError(error)}`);
  }
}

/**
 * Append a JSON object to a JSONL file (async version)
 */
export async function appendJsonlAsync<T>(filePath: string, obj: T): Promise<void> {
  try {
    // Ensure the parent directory exists
    const dirPath = path.dirname(filePath);
    await ensureDirAsync(dirPath);

    // Serialize to JSON and ensure newline termination
    const line = JSON.stringify(obj) + '\n';
    await fsPromises.appendFile(filePath, line, 'utf-8');
  } catch (error) {
    console.error(`Error appending to JSONL file ${filePath}: ${formatError(error)}`);
  }
}

/**
 * Read all lines from a JSONL file and parse each as JSON
 * Returns an array of parsed objects
 */
export function readJsonl<T>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((line: string) => line.trim().length > 0);

    const results: T[] = [];
    for (const line of lines) {
      try {
        results.push(JSON.parse(line) as T);
      } catch {
        // Skip malformed lines
        console.warn(`Skipping malformed JSONL line in ${filePath}`);
      }
    }

    return results;
  } catch (error) {
    console.error(`Error reading JSONL file ${filePath}: ${formatError(error)}`);
    return [];
  }
}

/**
 * Read a JSON file and return the parsed content
 * Returns the default value if the file doesn't exist or is invalid
 */
export function readJson<T>(filePath: string, defaultValue: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    return parsed as T;
  } catch (error) {
    console.error(`Error reading JSON file ${filePath}: ${formatError(error)}`);
    return defaultValue;
  }
}

/**
 * Read a JSON file (async version)
 */
export async function readJsonAsync<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    const content = await fsPromises.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    return parsed as T;
  } catch (error) {
    // Check for ENOENT (file not found) error
    const errorWithCode = error as { code?: string };
    if (errorWithCode.code === 'ENOENT') {
      return defaultValue;
    }
    console.error(`Error reading JSON file ${filePath}: ${formatError(error)}`);
    return defaultValue;
  }
}

/**
 * Write JSON to a file atomically (write to temp file then rename)
 * This prevents corruption if the process is interrupted during write
 */
export function writeJsonAtomic<T>(filePath: string, obj: T): void {
  try {
    // Ensure the parent directory exists
    const dirPath = path.dirname(filePath);
    ensureDir(dirPath);

    // Write to a temporary file first
    const tempPath = filePath + '.tmp';
    const content = JSON.stringify(obj, null, 2);
    fs.writeFileSync(tempPath, content, 'utf-8');

    // Rename temp file to target (atomic on most filesystems)
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    console.error(`Error writing JSON file ${filePath}: ${formatError(error)}`);
  }
}

/**
 * Write JSON to a file atomically (async version)
 */
export async function writeJsonAtomicAsync<T>(filePath: string, obj: T): Promise<void> {
  try {
    // Ensure the parent directory exists
    const dirPath = path.dirname(filePath);
    await ensureDirAsync(dirPath);

    // Write to a temporary file first
    const tempPath = filePath + '.tmp';
    const content = JSON.stringify(obj, null, 2);
    await fsPromises.writeFile(tempPath, content, 'utf-8');

    // Rename temp file to target (atomic on most filesystems)
    await fsPromises.rename(tempPath, filePath);
  } catch (error) {
    console.error(`Error writing JSON file ${filePath}: ${formatError(error)}`);
  }
}

/**
 * Get the monitoring log file path for a specific date
 */
export function getMonitoringLogPath(date: Date = new Date()): string {
  const dateKey = getUtcDateKey(date);
  return path.join(LOG_DIRS.monitoring, `monitoring_${dateKey}.jsonl`);
}

/**
 * Get the decisions log file path for a specific date
 */
export function getDecisionsLogPath(date: Date = new Date()): string {
  const dateKey = getUtcDateKey(date);
  return path.join(LOG_DIRS.decisions, `decisions_${dateKey}.jsonl`);
}

/**
 * Get the positions file path
 */
export function getPositionsPath(): string {
  return path.join(LOG_DIRS.trading, 'positions.json');
}

/**
 * Get the settlement log file path
 */
export function getSettlementLogPath(): string {
  return path.join(LOG_DIRS.trading, 'settlement_log.json');
}

/**
 * Get the daily reports file path
 */
export function getDailyReportsPath(): string {
  return path.join(LOG_DIRS.reports, 'daily_reports.json');
}
