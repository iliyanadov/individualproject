import { BinaryLMSR } from "../src/lib/binaryLmsr";

const lmsr = new BinaryLMSR();

// single_no_trade
console.log("=== single_no_trade ===");
const ledger2 = lmsr.initLedger(100, [
  { id: "alice", cash: 10000 },
  { id: "bob", cash: 10000 },
]);
const result2 = lmsr.executeBuy(ledger2, "bob", "NO", 30);
ledger2.market = result2.newState;
ledger2.traders.set("bob", result2.newTraderAccount);
const prices2 = lmsr.getPrices(result2.newState);
console.log("qYes:", result2.newState.qYes.toString());
console.log("qNo:", result2.newState.qNo.toString());
console.log("totalCollected:", result2.newState.totalCollected.toString());
console.log("pYES:", prices2.pYES.toString());
console.log("pNO:", prices2.pNO.toString());
console.log("bob.cash:", ledger2.traders.get("bob")!.cash.toString());

// balanced_trades
console.log("\n=== balanced_trades ===");
const lmsr3 = new BinaryLMSR();
const ledger3 = lmsr3.initLedger(100, [
  { id: "alice", cash: 10000 },
  { id: "bob", cash: 10000 },
]);
const result3a = lmsr3.executeBuy(ledger3, "alice", "YES", 50);
ledger3.market = result3a.newState;
ledger3.traders.set("alice", result3a.newTraderAccount);
const result3b = lmsr3.executeBuy(ledger3, "bob", "NO", 50);
ledger3.market = result3b.newState;
ledger3.traders.set("bob", result3b.newTraderAccount);
const prices3 = lmsr3.getPrices(ledger3.market);
console.log("qYes:", ledger3.market.qYes.toString());
console.log("qNo:", ledger3.market.qNo.toString());
console.log("totalCollected:", ledger3.market.totalCollected.toString());
console.log("pYES:", prices3.pYES.toString());
console.log("pNO:", prices3.pNO.toString());
console.log("alice.cash:", ledger3.traders.get("alice")!.cash.toString());
console.log("bob.cash:", ledger3.traders.get("bob")!.cash.toString());

// multiple_small_trades
console.log("\n=== multiple_small_trades ===");
const lmsr4 = new BinaryLMSR();
const ledger4 = lmsr4.initLedger(100, [
  { id: "alice", cash: 10000 },
  { id: "bob", cash: 10000 },
]);
const result4a = lmsr4.executeBuy(ledger4, "alice", "YES", 10);
ledger4.market = result4a.newState;
ledger4.traders.set("alice", result4a.newTraderAccount);
const result4b = lmsr4.executeBuy(ledger4, "alice", "YES", 15);
ledger4.market = result4b.newState;
ledger4.traders.set("alice", result4b.newTraderAccount);
const result4c = lmsr4.executeBuy(ledger4, "bob", "NO", 20);
ledger4.market = result4c.newState;
ledger4.traders.set("bob", result4c.newTraderAccount);
const result4d = lmsr4.executeBuy(ledger4, "alice", "NO", 5);
ledger4.market = result4d.newState;
ledger4.traders.set("alice", result4d.newTraderAccount);
const prices4 = lmsr4.getPrices(ledger4.market);
console.log("qYes:", ledger4.market.qYes.toString());
console.log("qNo:", ledger4.market.qNo.toString());
console.log("totalCollected:", ledger4.market.totalCollected.toString());
console.log("pYES:", prices4.pYES.toString());
console.log("pNO:", prices4.pNO.toString());
console.log("alice.cash:", ledger4.traders.get("alice")!.cash.toString());
console.log("bob.cash:", ledger4.traders.get("bob")!.cash.toString());

// bullish_shift
console.log("\n=== bullish_shift ===");
const lmsr5 = new BinaryLMSR();
const ledger5 = lmsr5.initLedger(100, [
  { id: "alice", cash: 10000 },
  { id: "bob", cash: 10000 },
]);
const result5a = lmsr5.executeBuy(ledger5, "alice", "YES", 100);
ledger5.market = result5a.newState;
ledger5.traders.set("alice", result5a.newTraderAccount);
const result5b = lmsr5.executeBuy(ledger5, "alice", "YES", 50);
ledger5.market = result5b.newState;
ledger5.traders.set("alice", result5b.newTraderAccount);
const result5c = lmsr5.executeBuy(ledger5, "bob", "YES", 30);
ledger5.market = result5c.newState;
ledger5.traders.set("bob", result5c.newTraderAccount);
const prices5 = lmsr5.getPrices(ledger5.market);
console.log("qYes:", ledger5.market.qYes.toString());
console.log("qNo:", ledger5.market.qNo.toString());
console.log("totalCollected:", ledger5.market.totalCollected.toString());
console.log("pYES:", prices5.pYES.toString());
console.log("pNO:", prices5.pNO.toString());
console.log("alice.cash:", ledger5.traders.get("alice")!.cash.toString());
console.log("bob.cash:", ledger5.traders.get("bob")!.cash.toString());
