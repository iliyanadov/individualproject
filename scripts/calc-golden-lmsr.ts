import { BinaryLMSR } from "../src/lib/binaryLmsr";

const lmsr = new BinaryLMSR();

// Golden snapshot: single_yes_trade
console.log("=== single_yes_trade ===");
const ledger1 = lmsr.initLedger(100, [
  { id: "alice", cash: 10000 },
  { id: "bob", cash: 10000 },
]);
const result1 = lmsr.executeBuy(ledger1, "alice", "YES", 50);
const prices1 = lmsr.getPrices(result1.newState);
console.log("qYes:", result1.newState.qYes.toString());
console.log("qNo:", result1.newState.qNo.toString());
console.log("totalCollected:", result1.newState.totalCollected.toString());
console.log("pYES:", prices1.pYES.toString());
console.log("pNO:", prices1.pNO.toString());
console.log("alice.cash:", result1.newTraderAccount.cash.toString());
console.log("alice.yesShares:", result1.newTraderAccount.yesShares.toString());
console.log("alice.noShares:", result1.newTraderAccount.noShares.toString());

// Golden snapshot: single_no_trade
console.log("\n=== single_no_trade ===");
const ledger2 = lmsr.initLedger(100, [
  { id: "alice", cash: 10000 },
  { id: "bob", cash: 10000 },
]);
const result2 = lmsr.executeBuy(ledger2, "bob", "NO", 30);
const prices2 = lmsr.getPrices(result2.newState);
console.log("qYes:", result2.newState.qYes.toString());
console.log("qNo:", result2.newState.qNo.toString());
console.log("totalCollected:", result2.newState.totalCollected.toString());
console.log("pYES:", prices2.pYES.toString());
console.log("pNO:", prices2.pNO.toString());
console.log("bob.cash:", result2.newTraderAccount.cash.toString());
console.log("bob.yesShares:", result2.newTraderAccount.yesShares.toString());
console.log("bob.noShares:", result2.newTraderAccount.noShares.toString());

// Golden snapshot: balanced_trades
console.log("\n=== balanced_trades ===");
const ledger3 = lmsr.initLedger(100, [
  { id: "alice", cash: 10000 },
  { id: "bob", cash: 10000 },
]);
const result3a = lmsr.executeBuy(ledger3, "alice", "YES", 50);
const result3 = lmsr.executeBuy({ ...ledger3, market: result3a.newState, traders: result3.ledger!.traders }, "bob", "NO", 50);
const prices3 = lmsr.getPrices(result3.newState);
console.log("qYes:", result3.newState.qYes.toString());
console.log("qNo:", result3.newState.qNo.toString());
console.log("totalCollected:", result3.newState.totalCollected.toString());
console.log("pYES:", prices3.pYES.toString());

// Golden snapshot: multiple_small_trades
console.log("\n=== multiple_small_trades ===");
const ledger4 = lmsr.initLedger(100, [
  { id: "alice", cash: 10000 },
  { id: "bob", cash: 10000 },
]);
const result4a = lmsr.executeBuy(ledger4, "alice", "YES", 10);
const result4b = lmsr.executeBuy({ ...ledger4, market: result4a.newState, traders: new Map([...ledger4.traders].map(([k, v]) => k === "alice" ? [k, result4a.newTraderAccount] : [k, v])) }, "alice", "YES", 15);
const result4c = lmsr.executeBuy({ ...ledger4, market: result4b.newState, traders: new Map([...ledger4.traders].map(([k, v]) => k === "alice" ? [k, result4b.newTraderAccount] : [k, v])) }, "bob", "NO", 20);
const result4d = lmsr.executeBuy({ ...ledger4, market: result4c.newState, traders: (() => {
  const m = new Map(ledger4.traders);
  m.set("bob", result4c.newTraderAccount);
  return m;
})()) }, "alice", "NO", 5);
console.log("qYes:", result4d.newState.qYes.toString());
console.log("qNo:", result4d.newState.qNo.toString());
console.log("alice.cash:", result4d.newTraderAccount.cash.toString());
console.log("alice.yesShares:", result4d.newTraderAccount.yesShares.toString());
console.log("alice.noShares:", result4d.newTraderAccount.noShares.toString());

// Golden snapshot: bullish_shift
console.log("\n=== bullish_shift ===");
const ledger5 = lmsr.initLedger(100, [
  { id: "alice", cash: 10000 },
  { id: "bob", cash: 10000 },
]);
const result5a = lmsr.executeBuy(ledger5, "alice", "YES", 100);
const result5b = lmsr.executeBuy({ ...ledger5, market: result5a.newState, traders: new Map([...ledger5.traders].map(([k, v]) => k === "alice" ? [k, result5a.newTraderAccount] : [k, v])) }, "alice", "YES", 50);
const result5c = lmsr.executeBuy({ ...ledger5, market: result5b.newState, traders: new Map([...ledger5.traders].map(([k, v]) => k === "alice" ? [k, result5b.newTraderAccount] : [k, v])) }, "bob", "YES", 30);
const prices5 = lmsr.getPrices(result5c.newState);
console.log("qYes:", result5c.newState.qYes.toString());
console.log("qNo:", result5c.newState.qNo.toString());
console.log("totalCollected:", result5c.newState.totalCollected.toString());
console.log("pYES:", prices5.pYES.toString());
console.log("pNO:", prices5.pNO.toString());
console.log("alice.cash:", result5c.newTraderAccount.cash.toString());
console.log("alice.yesShares:", result5c.newTraderAccount.yesShares.toString());
console.log("bob.cash:", result5c.newTraderAccount.cash.toString());
console.log("bob.yesShares:", result5c.newTraderAccount.yesShares.toString());

// Trade ID test
console.log("\n=== Trade IDs ===");
const ledger6 = lmsr.initLedger(100, [{ id: "alice", cash: 10000 }]);
const r1 = lmsr.executeBuy(ledger6, "alice", "YES", 10);
console.log("Trade ID 1:", r1.tradeId);
const r2 = lmsr.executeBuy({ ...ledger6, market: r1.newState, traders: new Map([["alice", r1.newTraderAccount]]) }, "alice", "YES", 10);
console.log("Trade ID 2:", r2.tradeId);
