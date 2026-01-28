/**
 * Tests for Settlement P&L calculations
 *
 * Run with: npx tsx src/settlement/settlement.test.ts
 */

import { calculateTradePnl } from '../polymarket.js';

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

function assertApproxEqual(
  actual: number | null,
  expected: number | null,
  tolerance: number,
  description: string
): void {
  if (actual === null && expected === null) {
    console.log(`✓ PASS: ${description}`);
    passed++;
    return;
  }
  if (actual === null || expected === null) {
    console.log(`✗ FAIL: ${description}`);
    console.log(`  Expected: ${expected}, Got: ${actual}`);
    failed++;
    return;
  }
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

console.log('='.repeat(60));
console.log('Settlement P&L Calculations - Unit Tests');
console.log('='.repeat(60));

// ============================================================
// Test 1: YES position - resolved YES (winning)
// ============================================================
console.log('\n--- Test: YES position resolved YES (winning) ---\n');

// Bought YES at 0.30, resolved YES: profit = 1 - 0.30 = 0.70
{
  const pnl = calculateTradePnl('YES', 'YES', 0.30, 0.70);
  assertApproxEqual(pnl, 0.70, 0.001, 'YES at 0.30, resolved YES = +0.70');
}

// Bought YES at 0.80, resolved YES: profit = 1 - 0.80 = 0.20
{
  const pnl = calculateTradePnl('YES', 'YES', 0.80, 0.20);
  assertApproxEqual(pnl, 0.20, 0.001, 'YES at 0.80, resolved YES = +0.20');
}

// Bought YES at 0.01, resolved YES: profit = 1 - 0.01 = 0.99
{
  const pnl = calculateTradePnl('YES', 'YES', 0.01, 0.99);
  assertApproxEqual(pnl, 0.99, 0.001, 'YES at 0.01, resolved YES = +0.99 (max profit)');
}

// ============================================================
// Test 2: YES position - resolved NO (losing)
// ============================================================
console.log('\n--- Test: YES position resolved NO (losing) ---\n');

// Bought YES at 0.30, resolved NO: loss = -0.30
{
  const pnl = calculateTradePnl('YES', 'NO', 0.30, 0.70);
  assertApproxEqual(pnl, -0.30, 0.001, 'YES at 0.30, resolved NO = -0.30');
}

// Bought YES at 0.80, resolved NO: loss = -0.80
{
  const pnl = calculateTradePnl('YES', 'NO', 0.80, 0.20);
  assertApproxEqual(pnl, -0.80, 0.001, 'YES at 0.80, resolved NO = -0.80');
}

// Bought YES at 0.99, resolved NO: loss = -0.99
{
  const pnl = calculateTradePnl('YES', 'NO', 0.99, 0.01);
  assertApproxEqual(pnl, -0.99, 0.001, 'YES at 0.99, resolved NO = -0.99 (max loss)');
}

// ============================================================
// Test 3: NO position - resolved NO (winning)
// ============================================================
console.log('\n--- Test: NO position resolved NO (winning) ---\n');

// Bought NO at 0.70, resolved NO: profit = 1 - 0.70 = 0.30
{
  const pnl = calculateTradePnl('NO', 'NO', 0.30, 0.70);
  assertApproxEqual(pnl, 0.30, 0.001, 'NO at 0.70, resolved NO = +0.30');
}

// Bought NO at 0.20, resolved NO: profit = 1 - 0.20 = 0.80
{
  const pnl = calculateTradePnl('NO', 'NO', 0.80, 0.20);
  assertApproxEqual(pnl, 0.80, 0.001, 'NO at 0.20, resolved NO = +0.80');
}

// Bought NO at 0.01, resolved NO: profit = 1 - 0.01 = 0.99
{
  const pnl = calculateTradePnl('NO', 'NO', 0.99, 0.01);
  assertApproxEqual(pnl, 0.99, 0.001, 'NO at 0.01, resolved NO = +0.99 (max profit)');
}

// ============================================================
// Test 4: NO position - resolved YES (losing)
// ============================================================
console.log('\n--- Test: NO position resolved YES (losing) ---\n');

// Bought NO at 0.70, resolved YES: loss = -0.70
{
  const pnl = calculateTradePnl('NO', 'YES', 0.30, 0.70);
  assertApproxEqual(pnl, -0.70, 0.001, 'NO at 0.70, resolved YES = -0.70');
}

// Bought NO at 0.20, resolved YES: loss = -0.20
{
  const pnl = calculateTradePnl('NO', 'YES', 0.80, 0.20);
  assertApproxEqual(pnl, -0.20, 0.001, 'NO at 0.20, resolved YES = -0.20');
}

// Bought NO at 0.99, resolved YES: loss = -0.99
{
  const pnl = calculateTradePnl('NO', 'YES', 0.01, 0.99);
  assertApproxEqual(pnl, -0.99, 0.001, 'NO at 0.99, resolved YES = -0.99 (max loss)');
}

// ============================================================
// Test 5: Edge cases - null inputs
// ============================================================
console.log('\n--- Test: Null input handling ---\n');

assertEqual(
  calculateTradePnl(null, 'YES', 0.30, 0.70),
  null,
  'Null entrySide returns null'
);

assertEqual(
  calculateTradePnl('YES', null, 0.30, 0.70),
  null,
  'Null resolvedOutcome returns null'
);

assertEqual(
  calculateTradePnl('YES', 'YES', null, 0.70),
  null,
  'Null entryYesPrice for YES position returns null'
);

assertEqual(
  calculateTradePnl('NO', 'NO', 0.30, null),
  null,
  'Null entryNoPrice for NO position returns null'
);

// ============================================================
// Test 6: Breakeven scenarios
// ============================================================
console.log('\n--- Test: Breakeven scenarios ---\n');

// At 50/50, profit and loss are equal in magnitude but opposite
{
  const winPnl = calculateTradePnl('YES', 'YES', 0.50, 0.50);
  const losePnl = calculateTradePnl('YES', 'NO', 0.50, 0.50);
  assertApproxEqual(winPnl, 0.50, 0.001, 'YES at 0.50, resolved YES = +0.50');
  assertApproxEqual(losePnl, -0.50, 0.001, 'YES at 0.50, resolved NO = -0.50');

  if (winPnl !== null && losePnl !== null) {
    assertApproxEqual(winPnl + losePnl, 0.0, 0.001, 'Win + Loss at 50/50 = 0 (fair odds)');
  }
}

// ============================================================
// Test 7: Realistic trading scenarios
// ============================================================
console.log('\n--- Test: Realistic trading scenarios ---\n');

// Scenario: Weather market, model predicts 70% chance of YES
// Bought YES at 0.55 (market underpriced), resolved YES
{
  const pnl = calculateTradePnl('YES', 'YES', 0.55, 0.45);
  assertApproxEqual(pnl, 0.45, 0.001, 'Underpriced YES at 0.55, resolved YES = +0.45');
}

// Scenario: Model predicts 30% YES but bought at 0.20, resolved NO
// Good trade even though we lost (expected value was positive)
{
  const pnl = calculateTradePnl('YES', 'NO', 0.20, 0.80);
  assertApproxEqual(pnl, -0.20, 0.001, 'YES at 0.20, resolved NO = -0.20');
}

// Scenario: Sold NO (bought YES) when market overpriced NO
// Bought YES at 0.15 when fair value was 0.25, resolved YES
{
  const pnl = calculateTradePnl('YES', 'YES', 0.15, 0.85);
  assertApproxEqual(pnl, 0.85, 0.001, 'YES at 0.15 (NO overpriced), resolved YES = +0.85');
}

// ============================================================
// Test 8: Symmetry verification
// ============================================================
console.log('\n--- Test: P&L symmetry ---\n');

// For any given prices, YES win + YES loss should equal NO win + NO loss = 1
{
  const entryYes = 0.35;
  const entryNo = 0.65;

  const yesWin = calculateTradePnl('YES', 'YES', entryYes, entryNo);
  const yesLose = calculateTradePnl('YES', 'NO', entryYes, entryNo);
  const noWin = calculateTradePnl('NO', 'NO', entryYes, entryNo);
  const noLose = calculateTradePnl('NO', 'YES', entryYes, entryNo);

  assertApproxEqual(yesWin, 0.65, 0.001, 'YES win at 0.35');
  assertApproxEqual(yesLose, -0.35, 0.001, 'YES lose at 0.35');
  assertApproxEqual(noWin, 0.35, 0.001, 'NO win at 0.65');
  assertApproxEqual(noLose, -0.65, 0.001, 'NO lose at 0.65');

  if (yesWin !== null && noLose !== null) {
    // YES winning means NO loses - these should sum to 0
    assertApproxEqual(yesWin + noLose, 0.0, 0.001, 'YES win + NO lose = 0 (zero-sum)');
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
