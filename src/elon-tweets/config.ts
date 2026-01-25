// Configuration for Elon Musk tweet monitoring bot

import type { ElonTweetConfig } from './types.js';
import * as fs from 'fs';
import * as path from 'path';

// Default configuration values
const DEFAULT_CONFIG: ElonTweetConfig = {
  // Polymarket checks every 10 minutes
  polymarketCheckIntervalMs: 10 * 60 * 1000,

  // X API checks 3 times daily (morning, afternoon, evening UTC)
  xApiCheckTimes: ['09:00', '15:00', '21:00'],

  // X API Bearer Token (must be set via environment)
  xApiBearerToken: '',

  // Elon's user ID will be fetched and cached on first run
  elonUserId: null,

  // Keywords to identify Elon tweet markets
  marketSearchKeywords: [
    'elon musk',
    'tweets',
    '# tweets',
    'number of tweets',
    'tweet count'
  ],

  // Look for markets up to 10 days ahead
  marketMaxDaysAhead: 10,

  // Data directory (relative to project root)
  dataDirectory: './elon_tweets_data'
};

// File path for persisted config (stores cached user ID, etc.)
const CONFIG_FILE_NAME = 'elon_tweets_config.json';

/**
 * Load configuration from environment and persisted file
 */
export function loadConfig(): ElonTweetConfig {
  const config = { ...DEFAULT_CONFIG };

  // Load from environment variables
  if (process.env.X_API_BEARER_TOKEN) {
    config.xApiBearerToken = process.env.X_API_BEARER_TOKEN;
  }

  if (process.env.ELON_POLYMARKET_CHECK_INTERVAL) {
    const interval = parseInt(process.env.ELON_POLYMARKET_CHECK_INTERVAL, 10);
    if (!isNaN(interval) && interval > 0) {
      config.polymarketCheckIntervalMs = interval * 60 * 1000; // Convert minutes to ms
    }
  }

  if (process.env.ELON_X_API_CHECK_TIMES) {
    // Format: "09:00,15:00,21:00"
    config.xApiCheckTimes = process.env.ELON_X_API_CHECK_TIMES.split(',').map(t => t.trim());
  }

  if (process.env.ELON_DATA_DIRECTORY) {
    config.dataDirectory = process.env.ELON_DATA_DIRECTORY;
  }

  // Load persisted config (cached user ID, etc.)
  const persistedConfig = loadPersistedConfig();
  if (persistedConfig.elonUserId) {
    config.elonUserId = persistedConfig.elonUserId;
  }

  return config;
}

/**
 * Load persisted configuration from file
 */
function loadPersistedConfig(): Partial<ElonTweetConfig> {
  const configPath = path.join(process.cwd(), CONFIG_FILE_NAME);

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('Error loading persisted config:', error);
  }

  return {};
}

/**
 * Save configuration to persistent file
 */
export function savePersistedConfig(updates: Partial<ElonTweetConfig>): void {
  const configPath = path.join(process.cwd(), CONFIG_FILE_NAME);
  const existing = loadPersistedConfig();
  const merged = { ...existing, ...updates };

  try {
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf-8');
    console.log(`  Config saved to: ${configPath}`);
  } catch (error) {
    console.error('Error saving persisted config:', error);
  }
}

/**
 * Ensure data directory exists
 */
export function ensureDataDirectory(config: ElonTweetConfig): void {
  const dataDir = path.resolve(process.cwd(), config.dataDirectory);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`  Created data directory: ${dataDir}`);
  }
}

/**
 * Get the log file path for a specific date
 */
export function getLogFilePath(config: ElonTweetConfig, date?: Date): string {
  const targetDate = date || new Date();
  const dateStr = targetDate.toISOString().split('T')[0];
  const dataDir = path.resolve(process.cwd(), config.dataDirectory);
  return path.join(dataDir, `elon_tweets_${dateStr}.json`);
}

/**
 * Check if current time matches any X API check time
 * Returns true if within 1 minute of a scheduled check time
 */
export function isXApiCheckTime(config: ElonTweetConfig): boolean {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const currentMinute = now.getUTCMinutes();

  for (const timeStr of config.xApiCheckTimes) {
    const parts = timeStr.split(':');
    const hourStr = parts[0] ?? '0';
    const minuteStr = parts[1] ?? '0';
    const checkHour = parseInt(hourStr, 10);
    const checkMinute = parseInt(minuteStr, 10);

    // Allow 1-minute window for the check
    if (currentHour === checkHour && Math.abs(currentMinute - checkMinute) <= 1) {
      return true;
    }
  }

  return false;
}

/**
 * Get next scheduled X API check time
 */
export function getNextXApiCheckTime(config: ElonTweetConfig): Date {
  const now = new Date();
  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  // Convert check times to minutes since midnight
  const checkMinutes = config.xApiCheckTimes.map(timeStr => {
    const parts = timeStr.split(':');
    const hourStr = parts[0] ?? '0';
    const minuteStr = parts[1] ?? '0';
    return parseInt(hourStr, 10) * 60 + parseInt(minuteStr, 10);
  }).sort((a, b) => a - b);

  // Find next check time
  let nextCheckMinutes = checkMinutes.find(m => m > currentMinutes);

  // If no check time today, use first check time tomorrow
  const nextDate = new Date(now);
  if (nextCheckMinutes === undefined) {
    nextCheckMinutes = checkMinutes[0] ?? 540; // Default to 09:00 (540 minutes)
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  }

  nextDate.setUTCHours(Math.floor(nextCheckMinutes / 60));
  nextDate.setUTCMinutes(nextCheckMinutes % 60);
  nextDate.setUTCSeconds(0);
  nextDate.setUTCMilliseconds(0);

  return nextDate;
}

/**
 * Validate configuration
 */
export function validateConfig(config: ElonTweetConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.xApiBearerToken) {
    errors.push('X_API_BEARER_TOKEN environment variable is required');
  }

  if (config.polymarketCheckIntervalMs < 60000) {
    errors.push('Polymarket check interval must be at least 1 minute');
  }

  if (config.xApiCheckTimes.length === 0) {
    errors.push('At least one X API check time must be configured');
  }

  // Validate time format
  for (const time of config.xApiCheckTimes) {
    if (!/^\d{2}:\d{2}$/.test(time)) {
      errors.push(`Invalid X API check time format: ${time} (expected HH:MM)`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Print current configuration
 */
export function printConfig(config: ElonTweetConfig): void {
  console.log('\nConfiguration:');
  console.log(`  Polymarket check interval: ${config.polymarketCheckIntervalMs / 60000} minutes`);
  console.log(`  X API check times (UTC): ${config.xApiCheckTimes.join(', ')}`);
  console.log(`  X API Bearer Token: ${config.xApiBearerToken ? '***configured***' : 'NOT SET'}`);
  console.log(`  Elon User ID: ${config.elonUserId || 'Will be fetched on first run'}`);
  console.log(`  Market search keywords: ${config.marketSearchKeywords.slice(0, 3).join(', ')}...`);
  console.log(`  Market max days ahead: ${config.marketMaxDaysAhead}`);
  console.log(`  Data directory: ${config.dataDirectory}`);
}
