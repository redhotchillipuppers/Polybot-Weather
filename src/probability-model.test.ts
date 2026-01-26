/**
 * Tests and Examples for the Weather Probability Model
 *
 * Run with: npx tsx src/probability-model.test.ts
 */

import {
  getStandardDeviation,
  calculateBracketProbability,
  calculateHoursUntilResolution,
  calculateMarketProbability,
  analyzeEdge,
} from './probability-model.js';

// Test utilities
let passed = 0;
let failed = 0;

function assertApproxEqual(
  actual: number,
  expected: number,
  tolerance: number,
  description: string
): void {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    console.log(`✓ PASS: ${description}`);
    console.log(`  Expected: ~${expected}, Got: ${actual.toFixed(4)}`);
    passed++;
  } else {
    console.log(`✗ FAIL: ${description}`);
    console.log(`  Expected: ~${expected}, Got: ${actual.toFixed(4)}, Diff: ${diff.toFixed(4)}`);
    failed++;
  }
}

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

console.log('='.repeat(60));
console.log('Weather Probability Model - Unit Tests');
console.log('='.repeat(60));

// ============================================================
// Test 1: getStandardDeviation
// ============================================================
console.log('\n--- Test: getStandardDeviation ---\n');

assertEqual(getStandardDeviation(3), 0.7, '0-6 hours: sigma = 0.7');
assertEqual(getStandardDeviation(6), 0.7, '6 hours (boundary): sigma = 0.7');
assertEqual(getStandardDeviation(9), 1.0, '6-12 hours: sigma = 1.0');
assertEqual(getStandardDeviation(12), 1.0, '12 hours (boundary): sigma = 1.0');
assertEqual(getStandardDeviation(18), 1.5, '12-24 hours: sigma = 1.5');
assertEqual(getStandardDeviation(22), 1.5, '22 hours: sigma = 1.5');
assertEqual(getStandardDeviation(24), 1.5, '24 hours (boundary): sigma = 1.5');
assertEqual(getStandardDeviation(30), 2.0, '24-36 hours: sigma = 2.0');
assertEqual(getStandardDeviation(42), 2.5, '36-48 hours: sigma = 2.5');
assertEqual(getStandardDeviation(72), 3.0, '48+ hours: sigma = 3.0');
assertEqual(getStandardDeviation(-5), 0, 'Past event: sigma = 0');

// ============================================================
// Test 2: calculateBracketProbability - User Examples
// ============================================================
console.log('\n--- Test: calculateBracketProbability (User Examples) ---\n');

// Example 1: "9°C or higher" with forecast 8.2°C, 22 hours out → ~0.30
// At 22 hours, sigma = 1.5
// P(X >= 9) = 1 - Φ((9 - 8.2) / 1.5) = 1 - Φ(0.533) ≈ 0.297
const prob1 = calculateBracketProbability(8.2, 22, 9, null);
assertApproxEqual(prob1, 0.30, 0.02, '"9°C or higher" with forecast 8.2°C, 22h out');

// Example 2: "8°C" exact with forecast 8.2°C, 22 hours out → ~0.26
// P(7.5 < X <= 8.5) = Φ((8.5 - 8.2) / 1.5) - Φ((7.5 - 8.2) / 1.5)
// = Φ(0.2) - Φ(-0.467) ≈ 0.579 - 0.320 = 0.259
const prob2 = calculateBracketProbability(8.2, 22, 7.5, 8.5);
assertApproxEqual(prob2, 0.26, 0.02, '"8°C exact" with forecast 8.2°C, 22h out');

// Example 3: "3°C or below" with forecast 8.2°C, 22 hours out → ~0.00
// P(X <= 3) = Φ((3 - 8.2) / 1.5) = Φ(-3.467) ≈ 0.0003
const prob3 = calculateBracketProbability(8.2, 22, null, 3);
assertApproxEqual(prob3, 0.00, 0.01, '"3°C or below" with forecast 8.2°C, 22h out');

// ============================================================
// Test 3: calculateMarketProbability convenience function
// ============================================================
console.log('\n--- Test: calculateMarketProbability ---\n');

const marketProb1 = calculateMarketProbability(8.2, 22, 'or_higher', 9);
assertApproxEqual(marketProb1, 0.30, 0.02, 'Market: "9°C or higher"');

const marketProb2 = calculateMarketProbability(8.2, 22, 'exact', 8);
assertApproxEqual(marketProb2, 0.26, 0.02, 'Market: "exactly 8°C"');

const marketProb3 = calculateMarketProbability(8.2, 22, 'or_below', 3);
assertApproxEqual(marketProb3, 0.00, 0.01, 'Market: "3°C or below"');

// ============================================================
// Test 4: Edge Cases
// ============================================================
console.log('\n--- Test: Edge Cases ---\n');

// Past event (hours = -5, sigma = 0)
const pastProb = calculateBracketProbability(8.2, -5, 8, 9);
assertEqual(pastProb, 1, 'Past event with forecast 8.2 in range [8,9]');

const pastProbOutside = calculateBracketProbability(8.2, -5, 10, 12);
assertEqual(pastProbOutside, 0, 'Past event with forecast 8.2 outside range [10,12]');

// Very short term (3 hours, sigma = 0.7)
// P(8 < X <= 9) = Φ((9 - 8.2)/0.7) - Φ((8 - 8.2)/0.7)
// = Φ(1.143) - Φ(-0.286) ≈ 0.874 - 0.388 = 0.486
const shortTermProb = calculateBracketProbability(8.2, 3, 8, 9);
assertApproxEqual(
  shortTermProb,
  0.49,
  0.02,
  'Short term (3h): forecast 8.2 in [8,9]'
);

// Long term (72 hours, sigma = 3.0)
const longTermProb = calculateBracketProbability(8.2, 72, 9, null);
assertApproxEqual(
  longTermProb,
  0.39,
  0.02,
  'Long term (72h): "9°C or higher" with forecast 8.2'
);

// Invalid inputs
const invalidForecast = calculateBracketProbability(NaN, 22, 8, 9);
assertEqual(invalidForecast, 0, 'Invalid forecast (NaN) returns 0');

const invalidBracket = calculateBracketProbability(8.2, 22, 10, 5);
assertEqual(invalidBracket, 0, 'Invalid bracket (min > max) returns 0');

// ============================================================
// Test 5: calculateHoursUntilResolution
// ============================================================
console.log('\n--- Test: calculateHoursUntilResolution ---\n');

// Test with a date 24 hours from now
const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const hours24 = calculateHoursUntilResolution(futureDate);
assertApproxEqual(hours24, 24, 0.1, '24 hours in the future');

// Test with a date in the past
const pastDate = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
const hoursPast = calculateHoursUntilResolution(pastDate);
assertApproxEqual(hoursPast, -12, 0.1, '12 hours in the past (negative)');

// Test invalid date
const invalidHours = calculateHoursUntilResolution('not-a-date');
assertEqual(invalidHours, 0, 'Invalid date string returns 0');

const emptyHours = calculateHoursUntilResolution('');
assertEqual(emptyHours, 0, 'Empty string returns 0');

// ============================================================
// Test 6: analyzeEdge
// ============================================================
console.log('\n--- Test: analyzeEdge ---\n');

const buyEdge = analyzeEdge(0.30, 0.20);
assertEqual(buyEdge.signal, 'BUY', 'BUY signal when fair > market by > 5%');
assertApproxEqual(buyEdge.edge, 0.10, 0.001, 'Edge calculation: 0.30 - 0.20 = 0.10');

const sellEdge = analyzeEdge(0.20, 0.35);
assertEqual(sellEdge.signal, 'SELL', 'SELL signal when fair < market by > 5%');
assertApproxEqual(sellEdge.edge, -0.15, 0.001, 'Negative edge: 0.20 - 0.35 = -0.15');

const holdEdge = analyzeEdge(0.30, 0.28);
assertEqual(holdEdge.signal, 'HOLD', 'HOLD signal when edge < 5%');

// ============================================================
// Summary
// ============================================================
console.log('\n' + '='.repeat(60));
console.log(`Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

// ============================================================
// Practical Examples
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('Practical Examples for Weather Trading');
console.log('='.repeat(60));

console.log('\n--- Scenario: London Temperature Market ---');
console.log('Forecast: 8.2°C (high) for tomorrow');
console.log('Time until resolution: 22 hours');
console.log('Market question: "Will the high be 9°C or higher?"');
console.log('');

const fairProb = calculateMarketProbability(8.2, 22, 'or_higher', 9);
console.log(`Fair probability (model): ${(fairProb * 100).toFixed(1)}%`);

const marketPrice = 0.25; // Example market price
console.log(`Market price: ${(marketPrice * 100).toFixed(1)}%`);

const analysis = analyzeEdge(fairProb, marketPrice);
console.log(`Edge: ${(analysis.edge * 100).toFixed(1)}% (${analysis.edgePercent.toFixed(1)}% relative)`);
console.log(`Signal: ${analysis.signal}`);

console.log('\n--- Full Probability Distribution ---');
console.log('Forecast: 8.2°C, 22 hours out\n');

const outcomes = [
  { label: '5°C or below', type: 'or_below' as const, value: 5 },
  { label: '6°C', type: 'exact' as const, value: 6 },
  { label: '7°C', type: 'exact' as const, value: 7 },
  { label: '8°C', type: 'exact' as const, value: 8 },
  { label: '9°C', type: 'exact' as const, value: 9 },
  { label: '10°C', type: 'exact' as const, value: 10 },
  { label: '11°C or higher', type: 'or_higher' as const, value: 11 },
];

let total = 0;
for (const outcome of outcomes) {
  const prob = calculateMarketProbability(8.2, 22, outcome.type, outcome.value);
  total += prob;
  const bar = '█'.repeat(Math.round(prob * 50));
  console.log(`${outcome.label.padEnd(15)} ${(prob * 100).toFixed(1).padStart(5)}% ${bar}`);
}
console.log(`${'Total:'.padEnd(15)} ${(total * 100).toFixed(1).padStart(5)}%`);

if (failed > 0) {
  process.exit(1);
}
