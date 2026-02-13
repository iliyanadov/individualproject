/**
 * Demo run for CLOB (Central Limit Order Book) prediction market
 *
 * Initializes a market, executes a handful of trades,
 * and prints/exports a log showing order book matching and market data.
 */

import { CLOBEngine, CLOBLogger, CLOBLedger, OrderBook } from "../src/lib/clob";

// Initialize logger and engine
const logger = new CLOBLogger();
const engine = new CLOBEngine(logger);

// Initialize traders with varying cash
const ledger = engine.initLedger([
  { id: "alice", cash: 10000 },
  { id: "bob", cash: 10000 },
  { id: "carol", cash: 10000 },
  { id: "dave", cash: 10000 },
]);

console.log("=== CLOB (Central Limit Order Book) Demo ===\n");

// Helper to display order book state
function displayOrderBook(): void {
  const book = ledger.market.orderBook;
  const bestBid = engine.getBestBid(book);
  const bestAsk = engine.getBestAsk(book);
  const spread = engine.getSpread(book);
  const midPrice = engine.getMidPrice(book);

  console.log("--- Order Book State ---");
  console.log(`Best Bid: ${bestBid ? bestBid.toString() : "None"}`);
  console.log(`Best Ask: ${bestAsk ? bestAsk.toString() : "None"}`);
  console.log(`Spread: ${spread ? spread.toString() : "None"}`);
  console.log(`Mid-Price: ${midPrice ? midPrice.toString() : "None"}`);

  // Show bid levels
  console.log("\nBid Levels:");
  let bidLevel = book.bestBid;
  let bidCount = 0;
  while (bidLevel && bidCount < 5) {
    const orders = engine.getOrdersAtPrice(book, "BUY", bidLevel.price);
    console.log(`  Price: ${bidLevel.price.toString()}, Total Qty: ${bidLevel.totalQty.toString()}, Orders: ${orders.length}`);
    for (const order of orders) {
      console.log(`    - ${order.traderId}: ${order.qty.toString()}`);
    }
    bidLevel = bidLevel.next;
    bidCount++;
  }

  // Show ask levels
  console.log("\nAsk Levels:");
  let askLevel = book.bestAsk;
  let askCount = 0;
  while (askLevel && askCount < 5) {
    const orders = engine.getOrdersAtPrice(book, "SELL", askLevel.price);
    console.log(`  Price: ${askLevel.price.toString()}, Total Qty: ${askLevel.totalQty.toString()}, Orders: ${orders.length}`);
    for (const order of orders) {
      console.log(`    - ${order.traderId}: ${order.qty.toString()}`);
    }
    askLevel = askLevel.next;
    askCount++;
  }
  console.log("");
}

// Helper to display trader state
function displayTraders(): void {
  console.log("--- Trader State ---");
  for (const [id, trader] of ledger.traders) {
    console.log(`${id}:`);
    console.log(`  Cash: ${trader.cash.toString()}`);
    console.log(`  YES Shares: ${trader.yesShares.toString()}`);
    console.log(`  NO Shares: ${trader.noShares.toString()}`);
    console.log(`  Open Orders: ${trader.openOrders.size}`);
  }
  console.log("");
}

// Initial state
console.log("Initial State:");
displayOrderBook();

// Place some limit orders to build the book
console.log("--- Placing Limit Orders ---\n");

// Alice places sell at 0.55
console.log("Alice places SELL limit order: price=0.55, qty=10");
const r1 = engine.placeLimitOrder(ledger, "alice", "SELL", 0.55, 10);
console.log(`  Order ID: ${r1.orderId}, Status: ${r1.status}, Filled: ${r1.filledQty.toString()}`);

// Bob places sell at 0.50 (better price for buyers)
console.log("\nBob places SELL limit order: price=0.50, qty=8");
const r2 = engine.placeLimitOrder(ledger, "bob", "SELL", 0.50, 8);
console.log(`  Order ID: ${r2.orderId}, Status: ${r2.status}, Filled: ${r2.filledQty.toString()}`);

// Carol places sell at 0.60
console.log("\nCarol places SELL limit order: price=0.60, qty=5");
const r3 = engine.placeLimitOrder(ledger, "carol", "SELL", 0.60, 5);
console.log(`  Order ID: ${r3.orderId}, Status: ${r3.status}, Filled: ${r3.filledQty.toString()}`);

// Dave places buy at 0.45 (below market, won't cross)
console.log("\nDave places BUY limit order: price=0.45, qty=15");
const r4 = engine.placeLimitOrder(ledger, "dave", "BUY", 0.45, 15);
console.log(`  Order ID: ${r4.orderId}, Status: ${r4.status}, Filled: ${r4.filledQty.toString()}`);

displayOrderBook();

// Place marketable limit orders (cross the spread)
console.log("--- Executing Marketable Orders ---\n");

// Alice places buy at 0.52 (crosses with Bob's 0.50 ask)
console.log("Alice places BUY limit order: price=0.52, qty=5");
const r5 = engine.placeLimitOrder(ledger, "alice", "BUY", 0.52, 5);
console.log(`  Order ID: ${r5.orderId}, Status: ${r5.status}, Filled: ${r5.filledQty.toString()}`);
console.log(`  Trades: ${r5.trades.length}`);
if (r5.trades.length > 0) {
  for (const t of r5.trades) {
    console.log(`    - Trade at ${t.price.toString()}, qty=${t.qty.toString()}`);
  }
}

displayOrderBook();
displayTraders();

// Place market order
console.log("--- Executing Market Order ---\n");

console.log("Carol places MARKET BUY order: qty=12");
const r6 = engine.placeMarketOrder(ledger, "carol", "BUY", 12);
console.log(`  Status: ${r6.status}, Filled: ${r6.filledQty.toString()}, Remaining: ${r6.remainingQty.toString()}`);
console.log(`  Trades: ${r6.trades.length}`);
if (r6.trades.length > 0) {
  for (const t of r6.trades) {
    console.log(`    - Trade at ${t.price.toString()}, qty=${t.qty.toString()}`);
  }
}

displayOrderBook();
displayTraders();

// Show market data
console.log("--- Market Data ---\n");
logger.logMarketData(ledger.market.orderBook);
const logs = logger.getLogs();
const marketDataLog = logs.filter(l => l.type === "MARKET_DATA").pop();
if (marketDataLog && marketDataLog.type === "MARKET_DATA") {
  console.log(`Best Bid: ${marketDataLog.data.bestBid?.toString() || "None"}`);
  console.log(`Best Ask: ${marketDataLog.data.bestAsk?.toString() || "None"}`);
  console.log(`Spread: ${marketDataLog.data.spread?.toString() || "None"}`);
  console.log(`Mid-Price: ${marketDataLog.data.midPrice?.toString() || "None"}`);
}
console.log("");

// Show depth
console.log("--- Depth within 3 ticks ---\n");
const book = ledger.market.orderBook;
const bidDepth = engine.getDepth(book, "BUY", 3);
const askDepth = engine.getDepth(book, "SELL", 3);
console.log(`Bid Depth (3 ticks): ${bidDepth.toString()}`);
console.log(`Ask Depth (3 ticks): ${askDepth.toString()}`);
console.log("");

// Cancel an order
console.log("--- Cancelling Order ---\n");

// Get one of Dave's orders
const daveOrders = engine.getOpenOrders(ledger, "dave");
if (daveOrders.length > 0) {
  const orderId = daveOrders[0].orderId;
  console.log(`Cancelling Dave's order: ${orderId}`);
  engine.cancelOrder(ledger, orderId);
  displayOrderBook();
}

// Show final trader state
console.log("--- Final Trader State ---\n");
displayTraders();

// Export logs
console.log("--- Logs ---\n");
console.log(`Total log entries: ${logger.getLogs().length}`);
console.log("\nLog types breakdown:");
const logTypes = new Map<string, number>();
for (const log of logger.getLogs()) {
  logTypes.set(log.type, (logTypes.get(log.type) || 0) + 1);
}
for (const [type, count] of logTypes) {
  console.log(`  ${type}: ${count}`);
}

console.log("\n========================\n");
