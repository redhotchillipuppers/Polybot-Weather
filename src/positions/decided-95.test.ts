/**
 * Tests for DECIDED_95 early position closing detection logic
 *
 * Run with: npx tsx src/positions/decided-95.test.ts
 */

import {
  extractDateKeyFromEndDate,
  isExactTemperatureMarket,
  checkDecided95,
} from './decided-95.js';
import type { MarketSnapshot, PositionsFile } from '../types.js';

// Test utilities
let passed = 0;
let failed = 0;

function assertEqual<T>(actual: T, expected: T, description: string): void {
  if (actual === expected) {
    console.log(`✓ PASS: ${description}`);
    passed++;
  } else {
    console.log(`✗ FAIL: ${description}`);
    console.log(`  Expected: ${expected}, Got: ${actual}`);
    failed++;
  }
}

function assertDeepEqual<T>(actual: T, expected: T, description: string): void {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr === expectedStr) {
    console.log(`✓ PASS: ${description}`);
    passed++;
  } else {
    console.log(`✗ FAIL: ${description}`);
    console.log(`  Expected: ${expectedStr}`);
    console.log(`  Got: ${actualStr}`);
    failed++;
  }
}

console.log('='.repeat(60));
console.log('DECIDED_95 Detection Logic - Unit Tests');
console.log('='.repeat(60));

// ============================================================
// Test 1: extractDateKeyFromEndDate
// ============================================================
console.log('\n--- Test: extractDateKeyFromEndDate ---\n');

assertEqual(
  extractDateKeyFromEndDate('2026-01-28T12:00:00.000Z'),
  '2026-01-28',
  'ISO date string extracts YYYY-MM-DD'
);

assertEqual(
  extractDateKeyFromEndDate('2026-02-15T23:59:59.999Z'),
  '2026-02-15',
  'End of day timestamp extracts correct date'
);

assertEqual(
  extractDateKeyFromEndDate(''),
  null,
  'Empty string returns null'
);

assertEqual(
  extractDateKeyFromEndDate('not-a-date'),
  null,
  'Invalid date string returns null'
);

assertEqual(
  extractDateKeyFromEndDate('2026-12-31'),
  '2026-12-31',
  'Date-only string (no time) extracts correctly'
);

// ============================================================
// Test 2: isExactTemperatureMarket
// ============================================================
console.log('\n--- Test: isExactTemperatureMarket ---\n');

assertEqual(
  isExactTemperatureMarket('Will the high temperature in London be 8°C on January 28?'),
  true,
  'Exact temperature question (8°C) returns true'
);

assertEqual(
  isExactTemperatureMarket('Will the high temperature in London be 12°C on January 28?'),
  true,
  'Exact temperature question (12°C) returns true'
);

assertEqual(
  isExactTemperatureMarket('Will the high temperature be 9°C or higher on January 28?'),
  false,
  '"or higher" question returns false'
);

assertEqual(
  isExactTemperatureMarket('Will the high temperature be 5°C or below on January 28?'),
  false,
  '"or below" question returns false'
);

assertEqual(
  isExactTemperatureMarket('Will it rain in London?'),
  false,
  'Non-temperature question returns false'
);

assertEqual(
  isExactTemperatureMarket(''),
  false,
  'Empty string returns false'
);

assertEqual(
  isExactTemperatureMarket('The temperature reached 8°C yesterday'),
  false,
  'Statement without "be X°C on" pattern returns false'
);

// ============================================================
// Test 3: checkDecided95 - Basic triggering
// ============================================================
console.log('\n--- Test: checkDecided95 - Basic triggering ---\n');

// Helper to create mock market snapshots
function createMockSnapshot(overrides: Partial<MarketSnapshot>): MarketSnapshot {
  return {
    marketId: 'test-market-1',
    question: 'Will the high temperature in London be 8°C on January 28?',
    temperatureValue: '8',
    outcomes: ['Yes', 'No'],
    prices: [0.95, 0.05],
    yesPrice: 0.95,
    noPrice: 0.05,
    endDate: '2026-01-28T23:59:00.000Z',
    minutesToClose: 60,
    volume: 1000,
    liquidity: 500,
    modelProbability: 0.90,
    edge: 0.05,
    edgePercent: 5.26,
    signal: 'HOLD',
    forecastError: null,
    isTradeable: true,
    executed: false,
    entrySide: null,
    entryYesPrice: null,
    entryNoPrice: null,
    resolvedOutcome: null,
    tradePnl: null,
    ...overrides,
  };
}

// Helper to create fresh positions data
function createFreshPositionsData(): PositionsFile {
  return {
    positions: {},
    decidedDates: {},
    candidateState: {},
    stoppedOutDates: {},
    reportedDates: [],
  };
}

// Test: First check at 95% starts streak
{
  const positionsData = createFreshPositionsData();
  let saveCount = 0;
  const savePositionsFile = () => { saveCount++; };

  const snapshots = [
    createMockSnapshot({ yesPrice: 0.95 }),
  ];

  const triggered = checkDecided95(snapshots, positionsData, savePositionsFile);

  assertEqual(triggered.length, 0, 'First check at 95% does not trigger (streak=1)');
  assertEqual(positionsData.decidedDates['2026-01-28']?.streakCount, 1, 'Streak count is 1 after first check');
  assertEqual(saveCount, 1, 'Save was called once');
}

// Test: Second consecutive check at 95% triggers DECIDED_95
{
  const positionsData = createFreshPositionsData();
  positionsData.decidedDates['2026-01-28'] = {
    streakCount: 1,
    decidedAt: null,
    triggerMarketId: null,
    triggerQuestion: null,
    triggerYesPrice: null,
    triggerSide: null,
    triggerNoPrice: null,
  };
  let saveCount = 0;
  const savePositionsFile = () => { saveCount++; };

  const snapshots = [
    createMockSnapshot({ yesPrice: 0.96 }),
  ];

  const triggered = checkDecided95(snapshots, positionsData, savePositionsFile);

  assertEqual(triggered.length, 1, 'Second consecutive check at 95% triggers');
  assertEqual(triggered[0]?.dateKey, '2026-01-28', 'Triggered date key is correct');
  assertEqual(positionsData.decidedDates['2026-01-28']?.streakCount, 2, 'Streak count is 2');
  assertEqual(positionsData.decidedDates['2026-01-28']?.decidedAt !== null, true, 'decidedAt is set');
}

// Test: Price below threshold resets streak
{
  const positionsData = createFreshPositionsData();
  positionsData.decidedDates['2026-01-28'] = {
    streakCount: 1,
    decidedAt: null,
    triggerMarketId: null,
    triggerQuestion: null,
    triggerYesPrice: null,
    triggerSide: null,
    triggerNoPrice: null,
  };
  const savePositionsFile = () => {};

  const snapshots = [
    createMockSnapshot({ yesPrice: 0.90 }),  // Below 95%
  ];

  const triggered = checkDecided95(snapshots, positionsData, savePositionsFile);

  assertEqual(triggered.length, 0, 'Below threshold does not trigger');
  assertEqual(positionsData.decidedDates['2026-01-28']?.streakCount, 0, 'Streak reset to 0');
}

// Test: Non-tradeable markets are ignored
{
  const positionsData = createFreshPositionsData();
  const savePositionsFile = () => {};

  const snapshots = [
    createMockSnapshot({ yesPrice: 0.95, isTradeable: false }),
  ];

  const triggered = checkDecided95(snapshots, positionsData, savePositionsFile);

  assertEqual(triggered.length, 0, 'Non-tradeable market does not affect streak');
  assertEqual(positionsData.decidedDates['2026-01-28'], undefined, 'No streak data created for non-tradeable');
}

// Test: "or higher" markets are ignored
{
  const positionsData = createFreshPositionsData();
  const savePositionsFile = () => {};

  const snapshots = [
    createMockSnapshot({
      question: 'Will it be 9°C or higher on January 28?',
      yesPrice: 0.95,
    }),
  ];

  const triggered = checkDecided95(snapshots, positionsData, savePositionsFile);

  assertEqual(triggered.length, 0, '"or higher" market is ignored');
}

// Test: Already reported dates are skipped
{
  const positionsData = createFreshPositionsData();
  positionsData.reportedDates = ['2026-01-28'];
  positionsData.decidedDates['2026-01-28'] = {
    streakCount: 1,
    decidedAt: null,
    triggerMarketId: null,
    triggerQuestion: null,
    triggerYesPrice: null,
    triggerSide: null,
    triggerNoPrice: null,
  };
  const savePositionsFile = () => {};

  const snapshots = [
    createMockSnapshot({ yesPrice: 0.95 }),
  ];

  const triggered = checkDecided95(snapshots, positionsData, savePositionsFile);

  assertEqual(triggered.length, 0, 'Already reported date is skipped');
}

// Test: Multiple markets for same date - highest price triggers
{
  const positionsData = createFreshPositionsData();
  positionsData.decidedDates['2026-01-28'] = {
    streakCount: 1,
    decidedAt: null,
    triggerMarketId: null,
    triggerQuestion: null,
    triggerYesPrice: null,
    triggerSide: null,
    triggerNoPrice: null,
  };
  const savePositionsFile = () => {};

  const snapshots = [
    createMockSnapshot({ marketId: 'market-1', yesPrice: 0.80 }),  // Below threshold
    createMockSnapshot({ marketId: 'market-2', yesPrice: 0.97 }),  // Highest - triggers
    createMockSnapshot({ marketId: 'market-3', yesPrice: 0.90 }),  // Below threshold
  ];

  const triggered = checkDecided95(snapshots, positionsData, savePositionsFile);

  assertEqual(triggered.length, 1, 'One date triggered');
  assertEqual(triggered[0]?.triggerMarket.marketId, 'market-2', 'Highest price market is the trigger');
  assertEqual(positionsData.decidedDates['2026-01-28']?.triggerYesPrice, 0.97, 'Trigger price recorded');
}

// ============================================================
// Summary
// ============================================================
console.log('\n' + '='.repeat(60));
console.log(`Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  process.exit(1);
}
