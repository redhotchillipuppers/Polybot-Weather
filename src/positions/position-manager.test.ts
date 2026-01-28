/**
 * Tests for Position Management P&L calculations
 *
 * Run with: npx tsx src/positions/position-manager.test.ts
 */

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

console.log('='.repeat(60));
console.log('Position Manager P&L Calculations - Unit Tests');
console.log('='.repeat(60));

// ============================================================
// Mark-to-Market P&L Calculation Logic
// From position-manager.ts closePositionsForDate()
// ============================================================

/**
 * Calculate realized P&L using mark-to-market pricing
 * This mirrors the logic in closePositionsForDate()
 */
function calculateMarkToMarketPnl(
  entrySide: 'YES' | 'NO',
  entryYesPrice: number,
  entryNoPrice: number,
  exitYesPrice: number,
  size: number
): number {
  const exitNoPrice = 1 - exitYesPrice;

  if (entrySide === 'YES') {
    return (exitYesPrice - entryYesPrice) * size;
  } else {
    return (exitNoPrice - entryNoPrice) * size;
  }
}

// ============================================================
// Test 1: YES position P&L calculations
// ============================================================
console.log('\n--- Test: YES Position P&L ---\n');

// Profitable YES trade: bought at 0.30, exit at 0.95
{
  const pnl = calculateMarkToMarketPnl('YES', 0.30, 0.70, 0.95, 1);
  assertApproxEqual(pnl, 0.65, 0.001, 'YES bought at 0.30, exit at 0.95 = +0.65');
}

// Losing YES trade: bought at 0.80, exit at 0.50
{
  const pnl = calculateMarkToMarketPnl('YES', 0.80, 0.20, 0.50, 1);
  assertApproxEqual(pnl, -0.30, 0.001, 'YES bought at 0.80, exit at 0.50 = -0.30');
}

// Breakeven YES trade: bought at 0.50, exit at 0.50
{
  const pnl = calculateMarkToMarketPnl('YES', 0.50, 0.50, 0.50, 1);
  assertApproxEqual(pnl, 0.00, 0.001, 'YES bought at 0.50, exit at 0.50 = 0.00');
}

// YES with size multiplier
{
  const pnl = calculateMarkToMarketPnl('YES', 0.30, 0.70, 0.95, 10);
  assertApproxEqual(pnl, 6.50, 0.001, 'YES bought at 0.30, exit at 0.95, size=10 = +6.50');
}

// ============================================================
// Test 2: NO position P&L calculations
// ============================================================
console.log('\n--- Test: NO Position P&L ---\n');

// Profitable NO trade: bought at 0.30, YES drops to 0.05 (NO rises to 0.95)
{
  const pnl = calculateMarkToMarketPnl('NO', 0.70, 0.30, 0.05, 1);
  assertApproxEqual(pnl, 0.65, 0.001, 'NO bought at 0.30, exit at 0.95 (YES=0.05) = +0.65');
}

// Losing NO trade: bought NO at 0.70, YES rises to 0.95 (NO drops to 0.05)
{
  const pnl = calculateMarkToMarketPnl('NO', 0.30, 0.70, 0.95, 1);
  assertApproxEqual(pnl, -0.65, 0.001, 'NO bought at 0.70, exit at 0.05 (YES=0.95) = -0.65');
}

// Breakeven NO trade
{
  const pnl = calculateMarkToMarketPnl('NO', 0.50, 0.50, 0.50, 1);
  assertApproxEqual(pnl, 0.00, 0.001, 'NO bought at 0.50, exit at 0.50 = 0.00');
}

// NO with size multiplier
{
  const pnl = calculateMarkToMarketPnl('NO', 0.70, 0.30, 0.05, 5);
  assertApproxEqual(pnl, 3.25, 0.001, 'NO bought at 0.30, exit at 0.95, size=5 = +3.25');
}

// ============================================================
// Test 3: Edge cases
// ============================================================
console.log('\n--- Test: Edge Cases ---\n');

// Entry at extreme prices
{
  const pnl = calculateMarkToMarketPnl('YES', 0.01, 0.99, 0.95, 1);
  assertApproxEqual(pnl, 0.94, 0.001, 'YES bought at 0.01, exit at 0.95 = +0.94');
}

{
  const pnl = calculateMarkToMarketPnl('YES', 0.99, 0.01, 0.95, 1);
  assertApproxEqual(pnl, -0.04, 0.001, 'YES bought at 0.99, exit at 0.95 = -0.04');
}

// Zero size (edge case)
{
  const pnl = calculateMarkToMarketPnl('YES', 0.30, 0.70, 0.95, 0);
  assertApproxEqual(pnl, 0.00, 0.001, 'Size=0 always returns 0 P&L');
}

// ============================================================
// Test 4: DECIDED_95 typical scenarios
// ============================================================
console.log('\n--- Test: DECIDED_95 Typical Scenarios ---\n');

// Typical winning scenario: Model correctly predicted, market confirmed
// Bought YES at 0.25, DECIDED_95 triggers at 0.95
{
  const pnl = calculateMarkToMarketPnl('YES', 0.25, 0.75, 0.95, 1);
  assertApproxEqual(pnl, 0.70, 0.001, 'Winning YES: bought at 0.25, DECIDED_95 at 0.95');
}

// Typical losing scenario: Bought wrong side
// Bought NO at 0.75, but YES went to 0.95
{
  const pnl = calculateMarkToMarketPnl('NO', 0.25, 0.75, 0.95, 1);
  assertApproxEqual(pnl, -0.70, 0.001, 'Losing NO: bought at 0.75, DECIDED_95 at YES=0.95');
}

// Small edge trade
// Bought YES at 0.88, DECIDED_95 at 0.95
{
  const pnl = calculateMarkToMarketPnl('YES', 0.88, 0.12, 0.95, 1);
  assertApproxEqual(pnl, 0.07, 0.001, 'Small edge YES: bought at 0.88, DECIDED_95 at 0.95');
}

// ============================================================
// Test 5: Verify entry price consistency (YES + NO = 1)
// ============================================================
console.log('\n--- Test: Entry Price Consistency ---\n');

// This validates that YES and NO prices sum to 1
{
  const entryYes = 0.35;
  const entryNo = 0.65;
  assertEqual(entryYes + entryNo, 1.0, 'Entry prices sum to 1.0');

  const exitYes = 0.95;
  const exitNo = 1 - exitYes;
  assertEqual(exitYes + exitNo, 1.0, 'Exit prices sum to 1.0');

  // If we had bought both YES and NO at entry, total P&L should be 0
  const yesPnl = calculateMarkToMarketPnl('YES', entryYes, entryNo, exitYes, 1);
  const noPnl = calculateMarkToMarketPnl('NO', entryYes, entryNo, exitYes, 1);
  assertApproxEqual(yesPnl + noPnl, 0.0, 0.001, 'Buying both YES and NO yields 0 net P&L');
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
