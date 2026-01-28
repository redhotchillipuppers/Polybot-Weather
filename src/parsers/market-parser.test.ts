/**
 * Tests for Market Question Parsing utilities
 *
 * Run with: npx tsx src/parsers/market-parser.test.ts
 */

import {
  extractTemperatureFromQuestion,
  parseMarketQuestion,
  extractDateFromQuestion,
} from './market-parser.js';

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
console.log('Market Question Parsing - Unit Tests');
console.log('='.repeat(60));

// ============================================================
// Test 1: extractTemperatureFromQuestion
// ============================================================
console.log('\n--- Test: extractTemperatureFromQuestion ---\n');

assertEqual(
  extractTemperatureFromQuestion('Will the high temperature be 8°C or higher?'),
  '8',
  'Extract 8 from "8°C or higher"'
);

assertEqual(
  extractTemperatureFromQuestion('Will the high be 12°C on January 28?'),
  '12',
  'Extract 12 from "12°C on January 28"'
);

assertEqual(
  extractTemperatureFromQuestion('Will it be below 5°C?'),
  '5',
  'Extract 5 from "below 5°C"'
);

assertEqual(
  extractTemperatureFromQuestion('Temperature of 8.5°C expected'),
  '8.5',
  'Extract decimal temperature 8.5'
);

assertEqual(
  extractTemperatureFromQuestion('No temperature mentioned here'),
  null,
  'Return null when no temperature found'
);

assertEqual(
  extractTemperatureFromQuestion(''),
  null,
  'Return null for empty string'
);

// ============================================================
// Test 2: parseMarketQuestion - "or higher" bracket
// ============================================================
console.log('\n--- Test: parseMarketQuestion - "or higher" ---\n');

assertDeepEqual(
  parseMarketQuestion('Will the high temperature be 9°C or higher on January 28?'),
  { bracketType: 'or_higher', bracketValue: 9 },
  'Parse "9°C or higher"'
);

assertDeepEqual(
  parseMarketQuestion('Will it be 12°C or higher tomorrow?'),
  { bracketType: 'or_higher', bracketValue: 12 },
  'Parse "12°C or higher"'
);

assertDeepEqual(
  parseMarketQuestion('Temperature 8.5°C or higher'),
  { bracketType: 'or_higher', bracketValue: 8.5 },
  'Parse decimal "8.5°C or higher"'
);

// Test with different degree symbol (º instead of °)
assertDeepEqual(
  parseMarketQuestion('Will it be 10ºC or higher?'),
  { bracketType: 'or_higher', bracketValue: 10 },
  'Parse with alternate degree symbol (º)'
);

// ============================================================
// Test 3: parseMarketQuestion - "or below" bracket
// ============================================================
console.log('\n--- Test: parseMarketQuestion - "or below" ---\n');

assertDeepEqual(
  parseMarketQuestion('Will the temperature be 5°C or below?'),
  { bracketType: 'or_below', bracketValue: 5 },
  'Parse "5°C or below"'
);

assertDeepEqual(
  parseMarketQuestion('High of 3°C or below expected'),
  { bracketType: 'or_below', bracketValue: 3 },
  'Parse "3°C or below"'
);

assertDeepEqual(
  parseMarketQuestion('Temperature 0°C or below'),
  { bracketType: 'or_below', bracketValue: 0 },
  'Parse "0°C or below" (freezing point)'
);

// ============================================================
// Test 4: parseMarketQuestion - exact temperature
// ============================================================
console.log('\n--- Test: parseMarketQuestion - exact temperature ---\n');

assertDeepEqual(
  parseMarketQuestion('Will the high temperature in London be 8°C on January 28?'),
  { bracketType: 'exact', bracketValue: 8 },
  'Parse exact "be 8°C on"'
);

assertDeepEqual(
  parseMarketQuestion('Will the temperature be 12°C on February 1?'),
  { bracketType: 'exact', bracketValue: 12 },
  'Parse exact "be 12°C on"'
);

assertDeepEqual(
  parseMarketQuestion('High will be 7.5°C on March 15'),
  { bracketType: 'exact', bracketValue: 7.5 },
  'Parse exact decimal "be 7.5°C on"'
);

// ============================================================
// Test 5: parseMarketQuestion - edge cases
// ============================================================
console.log('\n--- Test: parseMarketQuestion - edge cases ---\n');

assertEqual(
  parseMarketQuestion('Will it rain tomorrow?'),
  null,
  'Return null for non-temperature question'
);

assertEqual(
  parseMarketQuestion(''),
  null,
  'Return null for empty string'
);

assertEqual(
  parseMarketQuestion('Temperature mentioned but no pattern: 8°C'),
  null,
  'Return null when no recognized pattern'
);

// ============================================================
// Test 6: extractDateFromQuestion
// ============================================================
console.log('\n--- Test: extractDateFromQuestion ---\n');

// Note: These tests assume current year is 2026 based on the codebase context
// The function returns current year if date hasn't passed, next year if it has

{
  const result = extractDateFromQuestion('Will it be 8°C on January 28?');
  // Result should be either 2026-01-28 or 2027-01-28 depending on current date
  const isValid = result === '2026-01-28' || result === '2027-01-28';
  if (isValid) {
    console.log(`✓ PASS: Extract date from "January 28"`);
    console.log(`  Got: ${result}`);
    passed++;
  } else {
    console.log(`✗ FAIL: Extract date from "January 28"`);
    console.log(`  Expected: 2026-01-28 or 2027-01-28, Got: ${result}`);
    failed++;
  }
}

{
  const result = extractDateFromQuestion('High on February 15');
  const isValid = result === '2026-02-15' || result === '2027-02-15';
  if (isValid) {
    console.log(`✓ PASS: Extract date from "February 15"`);
    console.log(`  Got: ${result}`);
    passed++;
  } else {
    console.log(`✗ FAIL: Extract date from "February 15"`);
    console.log(`  Expected: 2026-02-15 or 2027-02-15, Got: ${result}`);
    failed++;
  }
}

{
  const result = extractDateFromQuestion('Temperature on December 31');
  const isValid = result === '2026-12-31' || result === '2027-12-31';
  if (isValid) {
    console.log(`✓ PASS: Extract date from "December 31"`);
    console.log(`  Got: ${result}`);
    passed++;
  } else {
    console.log(`✗ FAIL: Extract date from "December 31"`);
    console.log(`  Expected: 2026-12-31 or 2027-12-31, Got: ${result}`);
    failed++;
  }
}

assertEqual(
  extractDateFromQuestion('No date in this question'),
  null,
  'Return null when no date found'
);

assertEqual(
  extractDateFromQuestion(''),
  null,
  'Return null for empty string'
);

// Test single-digit day
{
  const result = extractDateFromQuestion('Temperature on March 5');
  const isValid = result === '2026-03-05' || result === '2027-03-05';
  if (isValid) {
    console.log(`✓ PASS: Extract single-digit day "March 5"`);
    console.log(`  Got: ${result}`);
    passed++;
  } else {
    console.log(`✗ FAIL: Extract single-digit day "March 5"`);
    console.log(`  Expected: 2026-03-05 or 2027-03-05, Got: ${result}`);
    failed++;
  }
}

// ============================================================
// Test 7: Real Polymarket question formats
// ============================================================
console.log('\n--- Test: Real Polymarket question formats ---\n');

// Exact temperature format
assertDeepEqual(
  parseMarketQuestion('Will the high temperature in London be 8°C on January 28?'),
  { bracketType: 'exact', bracketValue: 8 },
  'Real format: exact temperature'
);

// Or higher format
assertDeepEqual(
  parseMarketQuestion('Will the high temperature in London be 9°C or higher on January 28?'),
  { bracketType: 'or_higher', bracketValue: 9 },
  'Real format: or higher'
);

// Or below format
assertDeepEqual(
  parseMarketQuestion('Will the high temperature in London be 5°C or below on January 28?'),
  { bracketType: 'or_below', bracketValue: 5 },
  'Real format: or below'
);

// ============================================================
// Test 8: Month name variations
// ============================================================
console.log('\n--- Test: All month names ---\n');

const months = [
  { name: 'January', num: '01' },
  { name: 'February', num: '02' },
  { name: 'March', num: '03' },
  { name: 'April', num: '04' },
  { name: 'May', num: '05' },
  { name: 'June', num: '06' },
  { name: 'July', num: '07' },
  { name: 'August', num: '08' },
  { name: 'September', num: '09' },
  { name: 'October', num: '10' },
  { name: 'November', num: '11' },
  { name: 'December', num: '12' },
];

for (const month of months) {
  const result = extractDateFromQuestion(`Temperature on ${month.name} 15`);
  if (result !== null && result.includes(`-${month.num}-15`)) {
    console.log(`✓ PASS: ${month.name} extracts correctly`);
    passed++;
  } else {
    console.log(`✗ FAIL: ${month.name} extraction`);
    console.log(`  Expected: *-${month.num}-15, Got: ${result}`);
    failed++;
  }
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
