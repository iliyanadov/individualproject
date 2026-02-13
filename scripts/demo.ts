/**
 * Demo run for Binary LMSR prediction market
 *
 * Initializes a market, executes a handful of trades,
 * and prints/exports a log with prices over time.
 */

import { lmsr, applyExecution, applySettlement, decimalToNumber } from "../src/lib/binaryLmsr";

// Initialize market with b=100 (reasonable default)
const market = lmsr.initMarket(100);

// Initialize traders with varying cash
const traders = [
  { id: "alice", cash: 1000 },
  { id: "bob", cash: 500 },
  { id: "carol", cash: 200 },
];

const ledger = lmsr.initLedger(100, traders);

console.log("=== Binary LMSR Prediction Market Demo ===");
console.log("Liquidity parameter b: 100");
console.log("Initial prices:", lmsr.getPrices(market));

// Execute trades
console.log("\n--- Executing Trades ---\n");

const t1 = lmsr.executeBuy(ledger, "alice", "YES", 10);
applyExecution(ledger, t1);
console.log("Trade 1: alice buys 10 YES");
console.log("  Payment:", decimalToNumber(t1.spend));
console.log("  Avg price:", decimalToNumber(t1.avgPrice));
console.log("  New prices:", lmsr.getPrices(t1.newState));

const t2 = lmsr.executeBuy(ledger, "bob", "NO", 5);
applyExecution(ledger, t2);
console.log("Trade 2: bob buys 5 NO");
console.log("  Payment:", decimalToNumber(t2.spend));
console.log("  Avg price:", decimalToNumber(t2.avgPrice));
console.log("  New prices:", lmsr.getPrices(t2.newState));

const t3 = lmsr.executeBuy(ledger, "alice", "YES", 20);
applyExecution(ledger, t3);
console.log("Trade 3: alice buys 20 YES");
console.log("  Payment:", decimalToNumber(t3.spend));
console.log("  Avg price:", decimalToNumber(t3.avgPrice));
console.log("  New prices:", lmsr.getPrices(t3.newState));

const t4 = lmsr.executeBuySpend(ledger, "carol", "YES", 50);
applyExecution(ledger, t4);
console.log("Trade 4: carol spends 50 on YES");
console.log("  Qty:", decimalToNumber(t4.qty));
console.log("  Spend:", decimalToNumber(t4.spend));
console.log("  Avg price:", decimalToNumber(t4.avgPrice));
console.log("  New prices:", lmsr.getPrices(t4.newState));

const t5 = lmsr.executeBuy(ledger, "bob", "NO", 3);
applyExecution(ledger, t5);
console.log("Trade 5: bob buys 3 NO");
console.log("  Payment:", decimalToNumber(t5.spend));
console.log("  Avg price:", decimalToNumber(t5.avgPrice));
console.log("  New prices:", lmsr.getPrices(t5.newState));

// Show final state
console.log("\n--- Final State ---\n");
console.log("Market:", ledger.market);
console.log("  qYes:", decimalToNumber(ledger.market.qYes));
console.log("  qNo:", decimalToNumber(ledger.market.qNo));
console.log("  Total collected:", decimalToNumber(ledger.market.totalCollected));

// Settle market (YES wins)
console.log("\n--- Settlement ---\n");
const settlement = lmsr.settle(ledger, "YES");
applySettlement(ledger, settlement);

console.log("Outcome:", settlement.outcome);
console.log("Total payout:", decimalToNumber(settlement.totalPayout));
console.log("MM Profit/Loss:", decimalToNumber(settlement.profitLoss));
console.log("\n========================\n");
