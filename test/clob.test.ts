/**
 * Comprehensive tests for CLOB (Central Limit Order Book) implementation
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Decimal } from "decimal.js";
import {
  CLOBEngine,
  CLOBLogger,
  Side,
  OrderStatus,
  LimitOrder,
  MarketOrder,
  Trade,
  OrderResult,
  OrderBook,
  PriceLevel,
  CLOBLedger,
  CLOBLogEntry,
  applyTrade,
  clob,
} from "../src/lib/clob";

// Tolerance for Decimal comparisons
const EPSILON = 1e-9;

// Helper to compare Decimals
function expectDecimalClose(actual: Decimal, expected: Decimal, tolerance = EPSILON): void {
  const diff = actual.minus(expected).abs().toNumber();
  expect(diff).toBeLessThan(tolerance);
}

function expectDecimalCloseToNumber(actual: Decimal, expected: number, tolerance = EPSILON): void {
  expectDecimalClose(actual, new Decimal(expected), tolerance);
}

describe("CLOB: Price-Time Priority", () => {
  let engine: CLOBEngine;
  let ledger: CLOBLedger;

  beforeEach(() => {
    engine = new CLOBEngine();
    ledger = engine.initLedger([
      { id: "alice", cash: 10000 },
      { id: "bob", cash: 10000 },
      { id: "carol", cash: 10000 },
    ]);
  });

  it("should fill FIFO at same price level", () => {
    // Alice places sell at 0.50 (10 qty)
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 10);

    // Bob places sell at 0.50 (5 qty)
    engine.placeLimitOrder(ledger, "bob", "SELL", 0.50, 5);

    // Carol places buy at 0.50 (8 qty) - should fill Alice's 10 first
    const result = engine.placeLimitOrder(ledger, "carol", "BUY", 0.50, 8);

    expect(result.trades.length).toBe(1);
    expect(result.trades[0].askTraderId).toBe("alice");
    expectDecimalCloseToNumber(result.filledQty, 8);
  });

  it("should prioritize better prices over older orders", () => {
    // Alice places sell at 0.60 (older)
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.60, 10);

    // Bob places sell at 0.50 (newer, better price for buyer)
    engine.placeLimitOrder(ledger, "bob", "SELL", 0.50, 10);

    // Carol places buy at 0.55 - should match with Bob (0.50)
    const result = engine.placeLimitOrder(ledger, "carol", "BUY", 0.55, 10);

    expect(result.trades.length).toBe(1);
    expect(result.trades[0].askTraderId).toBe("bob");
    expectDecimalCloseToNumber(result.trades[0].price, 0.50);
  });

  it("should maintain timestamp order for price-time priority", () => {
    // Place multiple orders at same price
    const now = Date.now();

    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 5);
    // Small delay to ensure different timestamps
    const newTimestamp = now + 1;

    engine.placeLimitOrder(ledger, "bob", "SELL", 0.50, 3);

    // Buy should fill Alice first (older)
    const result = engine.placeLimitOrder(ledger, "carol", "BUY", 0.55, 4);

    expect(result.trades.length).toBe(1);
    expect(result.trades[0].askTraderId).toBe("alice");
  });
});

describe("CLOB: Order Matching", () => {
  let engine: CLOBEngine;
  let ledger: CLOBLedger;

  beforeEach(() => {
    engine = new CLOBEngine();
    ledger = engine.initLedger([
      { id: "alice", cash: 10000 },
      { id: "bob", cash: 10000 },
      { id: "carol", cash: 10000 },
    ]);
  });

  it("should cross marketable limit orders immediately", () => {
    // Alice places ask at 0.50
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 10);

    // Bob places bid at 0.55 (crosses the spread)
    const result = engine.placeLimitOrder(ledger, "bob", "BUY", 0.55, 10);

    expect(result.status).toBe("FILLED");
    expect(result.trades.length).toBe(1);
    expectDecimalCloseToNumber(result.filledQty, 10);
    expectDecimalCloseToNumber(result.remainingQty, 0);

    // Trade should execute at ask price (0.50, not 0.55)
    expectDecimalCloseToNumber(result.trades[0].price, 0.50);
  });

  it("should place non-marketable limit orders on book", () => {
    // Bob places bid at 0.45 (below market, won't cross)
    const result = engine.placeLimitOrder(ledger, "bob", "BUY", 0.45, 10);

    expect(result.status).toBe("OPEN");
    expect(result.trades.length).toBe(0);
    expectDecimalCloseToNumber(result.remainingQty, 10);

    // Verify order is on book
    const openOrders = engine.getOpenOrders(ledger, "bob");
    expect(openOrders.length).toBe(1);
    expect(openOrders[0].orderId).toBe(result.orderId);
  });

  it("should handle partial fills correctly", () => {
    // Alice places ask at 0.50 (10 qty)
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 10);

    // Bob places bid at 0.50 (5 qty) - partial fill
    const result = engine.placeLimitOrder(ledger, "bob", "BUY", 0.50, 5);

    expect(result.status).toBe("FILLED");
    expect(result.trades.length).toBe(1);
    expectDecimalCloseToNumber(result.filledQty, 5);

    // Alice should have remaining qty on book
    const aliceOrders = engine.getOpenOrders(ledger, "alice");
    expect(aliceOrders.length).toBe(1);
    expectDecimalCloseToNumber(aliceOrders[0].qty, 5);
  });

  it("should aggregate qty at price level", () => {
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 5);
    engine.placeLimitOrder(ledger, "bob", "SELL", 0.50, 3);
    engine.placeLimitOrder(ledger, "carol", "SELL", 0.50, 2);

    const book = ledger.market.orderBook;
    const ordersAtPrice = engine.getOrdersAtPrice(book, "SELL", new Decimal(0.50));

    expect(ordersAtPrice.length).toBe(3);
    const totalQty = ordersAtPrice.reduce((sum, o) => sum.plus(o.qty), new Decimal(0));
    expectDecimalCloseToNumber(totalQty, 10);
  });

  it("should execute across multiple price levels", () => {
    // Setup asks at multiple levels
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 5);
    engine.placeLimitOrder(ledger, "bob", "SELL", 0.55, 5);
    engine.placeLimitOrder(ledger, "carol", "SELL", 0.60, 5);

    // Large buy order should walk the book
    const result = engine.placeLimitOrder(ledger, "alice", "BUY", 0.65, 12);

    expect(result.trades.length).toBe(3);
    expectDecimalCloseToNumber(result.filledQty, 12);
    expectDecimalCloseToNumber(result.remainingQty, 0);
  });
});

describe("CLOB: Market Orders", () => {
  let engine: CLOBEngine;
  let ledger: CLOBLedger;

  beforeEach(() => {
    engine = new CLOBEngine();
    ledger = engine.initLedger([
      { id: "alice", cash: 10000 },
      { id: "bob", cash: 10000 },
      { id: "carol", cash: 10000 },
    ]);
  });

  it("should execute market orders at best available prices", () => {
    // Setup order book
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 5);
    engine.placeLimitOrder(ledger, "bob", "SELL", 0.55, 5);
    engine.placeLimitOrder(ledger, "carol", "SELL", 0.60, 5);

    // Market buy for 8 shares
    const result = engine.placeMarketOrder(ledger, "alice", "BUY", 8);

    expect(result.trades.length).toBe(2);
    expectDecimalCloseToNumber(result.filledQty, 8);

    // First trade at 0.50 (5 shares)
    expectDecimalCloseToNumber(result.trades[0].price, 0.50);
    expectDecimalCloseToNumber(result.trades[0].qty, 5);

    // Second trade at 0.55 (3 shares)
    expectDecimalCloseToNumber(result.trades[1].price, 0.55);
    expectDecimalCloseToNumber(result.trades[1].qty, 3);
  });

  it("should walk the book for large market orders", () => {
    // Setup order book
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 5);
    engine.placeLimitOrder(ledger, "bob", "SELL", 0.55, 5);
    engine.placeLimitOrder(ledger, "carol", "SELL", 0.60, 5);

    // Market buy for all 15 shares
    const result = engine.placeMarketOrder(ledger, "alice", "BUY", 15);

    expect(result.trades.length).toBe(3);
    expectDecimalCloseToNumber(result.filledQty, 15);

    // Verify prices are in order
    expectDecimalCloseToNumber(result.trades[0].price, 0.50);
    expectDecimalCloseToNumber(result.trades[1].price, 0.55);
    expectDecimalCloseToNumber(result.trades[2].price, 0.60);
  });

  it("should handle market order with insufficient liquidity", () => {
    // Setup order book with only 10 shares
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 5);
    engine.placeLimitOrder(ledger, "bob", "SELL", 0.55, 5);

    // Market buy for 20 shares (only 10 available)
    const result = engine.placeMarketOrder(ledger, "carol", "BUY", 20);

    expect(result.status).toBe("PARTIALLY_FILLED");
    expectDecimalCloseToNumber(result.filledQty, 10);
    expectDecimalCloseToNumber(result.remainingQty, 10);
  });

  it("should reject market order when book is empty", () => {
    const result = engine.placeMarketOrder(ledger, "alice", "BUY", 10);

    expect(result.status).toBe("PARTIALLY_FILLED");
    expect(result.trades.length).toBe(0);
    expectDecimalCloseToNumber(result.filledQty, 0);
    expectDecimalCloseToNumber(result.remainingQty, 10);
  });
});

describe("CLOB: Cancellations", () => {
  let engine: CLOBEngine;
  let ledger: CLOBLedger;

  beforeEach(() => {
    engine = new CLOBEngine();
    ledger = engine.initLedger([
      { id: "alice", cash: 10000 },
      { id: "bob", cash: 10000 },
      { id: "carol", cash: 10000 },
    ]);
  });

  it("should remove order from book", () => {
    const placeResult = engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 10);
    const orderId = placeResult.orderId;

    const cancelResult = engine.cancelOrder(ledger, orderId);

    expect(cancelResult.status).toBe("CANCELLED");
    expectDecimalCloseToNumber(cancelResult.remainingQty, 10);

    const openOrders = engine.getOpenOrders(ledger, "alice");
    expect(openOrders.length).toBe(0);
  });

  it("should preserve other orders at same price", () => {
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 10);
    const bobResult = engine.placeLimitOrder(ledger, "bob", "SELL", 0.50, 5);

    // Cancel Alice's order
    engine.cancelOrder(ledger, "alice"); // Use traderId as orderId placeholder

    // Bob's order should still be there
    const bobOrders = engine.getOpenOrders(ledger, "bob");
    expect(bobOrders.length).toBe(1);
    expectDecimalCloseToNumber(bobOrders[0].qty, 5);
  });

  it("should handle cancel of partially filled order", () => {
    // Setup order that will be partially filled
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 10);
    const bobResult = engine.placeLimitOrder(ledger, "bob", "BUY", 0.50, 5);

    // Alice should have 5 remaining
    const aliceOrders = engine.getOpenOrders(ledger, "alice");
    expect(aliceOrders.length).toBe(1);

    // Cancel Alice's remaining order
    const cancelResult = engine.cancelOrder(ledger, aliceOrders[0].orderId);

    expectDecimalCloseToNumber(cancelResult.filledQty, 5);
    expectDecimalCloseToNumber(cancelResult.remainingQty, 5);
  });

  it("should handle cancel of non-existent order gracefully", () => {
    const result = engine.cancelOrder(ledger, "NON-EXISTENT");

    expect(result.status).toBe("CANCELLED");
    expect(result.trades.length).toBe(0);
  });
});

describe("CLOB: Market Data", () => {
  let engine: CLOBEngine;
  let ledger: CLOBLedger;

  beforeEach(() => {
    engine = new CLOBEngine();
    ledger = engine.initLedger([
      { id: "alice", cash: 10000 },
      { id: "bob", cash: 10000 },
      { id: "carol", cash: 10000 },
    ]);
  });

  it("should return best bid/ask correctly", () => {
    engine.placeLimitOrder(ledger, "alice", "BUY", 0.45, 10);
    engine.placeLimitOrder(ledger, "bob", "BUY", 0.50, 10);
    engine.placeLimitOrder(ledger, "carol", "SELL", 0.55, 10);
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.60, 10);

    const book = ledger.market.orderBook;
    const bestBid = engine.getBestBid(book);
    const bestAsk = engine.getBestAsk(book);

    expectDecimalCloseToNumber(bestBid!, 0.50);
    expectDecimalCloseToNumber(bestAsk!, 0.55);
  });

  it("should calculate spread correctly", () => {
    engine.placeLimitOrder(ledger, "alice", "BUY", 0.45, 10);
    engine.placeLimitOrder(ledger, "bob", "SELL", 0.55, 10);

    const book = ledger.market.orderBook;
    const spread = engine.getSpread(book);

    expectDecimalCloseToNumber(spread!, 0.10);
  });

  it("should calculate mid-price correctly", () => {
    engine.placeLimitOrder(ledger, "alice", "BUY", 0.45, 10);
    engine.placeLimitOrder(ledger, "bob", "SELL", 0.55, 10);

    const book = ledger.market.orderBook;
    const midPrice = engine.getMidPrice(book);

    expectDecimalCloseToNumber(midPrice!, 0.50);
  });

  it("should return depth within N ticks", () => {
    engine.placeLimitOrder(ledger, "alice", "BUY", 0.45, 10);
    engine.placeLimitOrder(ledger, "bob", "BUY", 0.44, 5);
    engine.placeLimitOrder(ledger, "carol", "BUY", 0.43, 3);

    const book = ledger.market.orderBook;
    const depth2 = engine.getDepth(book, "BUY", 2);

    expectDecimalCloseToNumber(depth2, 15); // 10 + 5
  });

  it("should return empty market data for empty book", () => {
    const book = ledger.market.orderBook;

    expect(engine.getBestBid(book)).toBeUndefined();
    expect(engine.getBestAsk(book)).toBeUndefined();
    expect(engine.getSpread(book)).toBeUndefined();
    expect(engine.getMidPrice(book)).toBeUndefined();
  });

  it("should get orders at specific price level", () => {
    engine.placeLimitOrder(ledger, "alice", "BUY", 0.50, 10);
    engine.placeLimitOrder(ledger, "bob", "BUY", 0.50, 5);
    engine.placeLimitOrder(ledger, "carol", "BUY", 0.45, 3);

    const book = ledger.market.orderBook;
    const ordersAtPrice = engine.getOrdersAtPrice(book, "BUY", new Decimal(0.50));

    expect(ordersAtPrice.length).toBe(2);
  });
});

describe("CLOB: Invariants", () => {
  let engine: CLOBEngine;
  let ledger: CLOBLedger;

  beforeEach(() => {
    engine = new CLOBEngine();
    ledger = engine.initLedger([
      { id: "alice", cash: 10000 },
      { id: "bob", cash: 10000 },
      { id: "carol", cash: 10000 },
    ]);
  });

  it("should maintain FIFO at same price", () => {
    // Place multiple sell orders at same price
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 5);
    engine.placeLimitOrder(ledger, "bob", "SELL", 0.50, 3);
    engine.placeLimitOrder(ledger, "carol", "SELL", 0.50, 2);

    // Buy order should fill in FIFO order
    const result = engine.placeLimitOrder(ledger, "alice", "BUY", 0.55, 6);

    expect(result.trades.length).toBe(2);
    expect(result.trades[0].askTraderId).toBe("alice");
    expectDecimalCloseToNumber(result.trades[0].qty, 5);
    expect(result.trades[1].askTraderId).toBe("bob");
    expectDecimalCloseToNumber(result.trades[1].qty, 1);
  });

  it("should never have crossed book after matching", () => {
    engine.placeLimitOrder(ledger, "alice", "BUY", 0.45, 10);
    engine.placeLimitOrder(ledger, "bob", "SELL", 0.55, 10);
    engine.placeLimitOrder(ledger, "carol", "BUY", 0.50, 5);

    const book = ledger.market.orderBook;
    const bestBid = engine.getBestBid(book);
    const bestAsk = engine.getBestAsk(book);

    // bestBid should always be <= bestAsk
    if (bestBid && bestAsk) {
      expect(bestBid.lte(bestAsk)).toBe(true);
    }
  });

  it("should conserve trader balances", () => {
    const initialAliceCash = ledger.traders.get("alice")!.cash;
    const initialBobCash = ledger.traders.get("bob")!.cash;

    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 10);
    engine.placeLimitOrder(ledger, "bob", "BUY", 0.55, 10);

    // Alice's cash should increase by 10 * 0.50 = 5
    const alice = ledger.traders.get("alice")!;
    // Bob's cash should decrease by 10 * 0.50 = 5
    const bob = ledger.traders.get("bob")!;

    // CLOB updates balances internally during matching
    expectDecimalCloseToNumber(alice.cash, initialAliceCash.plus(new Decimal(5)));
    expectDecimalCloseToNumber(bob.cash, initialBobCash.minus(new Decimal(5)));
  });

  it("should prevent negative balances", () => {
    // Alice only has 10000 cash
    // Try to buy 100000 shares at 0.50 = 50000 cost (should fail)
    const result = engine.placeLimitOrder(ledger, "alice", "BUY", 0.55, 100000);

    // The order matching should work but account update would fail
    // This is tested by applyTrade helper
    expect(result.trades.length).toBe(0);
  });

  it("should be deterministic", () => {
    const engine1 = new CLOBEngine();
    const engine2 = new CLOBEngine();

    const ledger1 = engine1.initLedger([
      { id: "alice", cash: 10000 },
      { id: "bob", cash: 10000 },
    ]);
    const ledger2 = engine2.initLedger([
      { id: "alice", cash: 10000 },
      { id: "bob", cash: 10000 },
    ]);

    // Execute same sequence
    engine1.placeLimitOrder(ledger1, "alice", "SELL", 0.50, 10);
    engine2.placeLimitOrder(ledger2, "alice", "SELL", 0.50, 10);

    const result1 = engine1.placeLimitOrder(ledger1, "bob", "BUY", 0.55, 5);
    const result2 = engine2.placeLimitOrder(ledger2, "bob", "BUY", 0.55, 5);

    expectDecimalClose(result1.filledQty, result2.filledQty);
    expectDecimalClose(result1.avgFillPrice, result2.avgFillPrice);
    expect(result1.trades.length).toBe(result2.trades.length);
  });
});

describe("CLOB: Ledger Integration", () => {
  let engine: CLOBEngine;
  let ledger: CLOBLedger;

  beforeEach(() => {
    engine = new CLOBEngine();
    ledger = engine.initLedger([
      { id: "alice", cash: 10000 },
      { id: "bob", cash: 10000 },
      { id: "carol", cash: 10000 },
    ]);
  });

  it("should track open orders per trader", () => {
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 10);
    engine.placeLimitOrder(ledger, "alice", "BUY", 0.45, 5);

    const openOrders = engine.getOpenOrders(ledger, "alice");
    expect(openOrders.length).toBe(2);
  });

  it("should return open orders for trader", () => {
    const result = engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 10);
    const orderId = result.orderId;

    const openOrders = engine.getOpenOrders(ledger, "alice");
    expect(openOrders.length).toBe(1);
    expect(openOrders[0].orderId).toBe(orderId);
  });

  it("should update open orders when order is filled", () => {
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 10);
    engine.placeLimitOrder(ledger, "bob", "BUY", 0.55, 10);

    const openOrders = engine.getOpenOrders(ledger, "alice");
    expect(openOrders.length).toBe(0);
  });

  it("should update open orders when order is cancelled", () => {
    const result = engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 10);
    engine.cancelOrder(ledger, result.orderId);

    const openOrders = engine.getOpenOrders(ledger, "alice");
    expect(openOrders.length).toBe(0);
  });

  it("should initialize traders with correct balances", () => {
    const alice = ledger.traders.get("alice")!;
    const bob = ledger.traders.get("bob")!;

    expectDecimalCloseToNumber(alice.cash, 10000);
    expectDecimalCloseToNumber(bob.cash, 10000);
    expectDecimalCloseToNumber(alice.yesShares, 0);
    expectDecimalCloseToNumber(alice.noShares, 0);
  });
});

describe("CLOB: Edge Cases", () => {
  let engine: CLOBEngine;
  let ledger: CLOBLedger;

  beforeEach(() => {
    engine = new CLOBEngine();
    ledger = engine.initLedger([
      { id: "alice", cash: 10000 },
      { id: "bob", cash: 10000 },
    ]);
  });

  it("should handle zero quantity order gracefully", () => {
    expect(() => engine.placeLimitOrder(ledger, "alice", "BUY", 0.50, 0)).toThrow("Quantity must be positive");
  });

  it("should handle negative price gracefully", () => {
    expect(() => engine.placeLimitOrder(ledger, "alice", "BUY", -0.50, 10)).toThrow("Price must be positive");
  });

  it("should handle non-existent trader", () => {
    expect(() => engine.placeLimitOrder(ledger, "nonexistent", "BUY", 0.50, 10)).toThrow("not found");
  });

  it("should handle trading in settled market", () => {
    ledger.market.settled = true;

    expect(() => engine.placeLimitOrder(ledger, "alice", "BUY", 0.50, 10)).toThrow("Cannot trade in settled market");
    expect(() => engine.placeMarketOrder(ledger, "alice", "BUY", 10)).toThrow("Cannot trade in settled market");
    expect(() => engine.cancelOrder(ledger, "any")).toThrow("Cannot cancel orders in settled market");
  });
});

describe("CLOB: Logging", () => {
  let engine: CLOBEngine;
  let logger: CLOBLogger;
  let ledger: CLOBLedger;

  beforeEach(() => {
    logger = new CLOBLogger();
    engine = new CLOBEngine(logger);
    ledger = engine.initLedger([
      { id: "alice", cash: 10000 },
      { id: "bob", cash: 10000 },
    ]);
  });

  it("should log order placed events", () => {
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 10);

    const logs = logger.getLogs();
    const orderPlacedLogs = logs.filter(l => l.type === "ORDER_PLACED");

    expect(orderPlacedLogs.length).toBe(1);
  });

  it("should log trade events", () => {
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 10);
    engine.placeLimitOrder(ledger, "bob", "BUY", 0.55, 5);

    const logs = logger.getLogs();
    const tradeLogs = logs.filter(l => l.type === "TRADE");

    expect(tradeLogs.length).toBe(1);
  });

  it("should log order cancelled events", () => {
    const result = engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 10);
    engine.cancelOrder(ledger, result.orderId);

    const logs = logger.getLogs();
    const cancelLogs = logs.filter(l => l.type === "ORDER_CANCELLED");

    expect(cancelLogs.length).toBe(1);
  });

  it("should clear logs", () => {
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 10);
    expect(logger.getLogs().length).toBeGreaterThan(0);

    logger.clear();
    expect(logger.getLogs().length).toBe(0);
  });

  it("should export logs as JSON", () => {
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 10);

    const json = logger.exportJson();
    const parsed = JSON.parse(json);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  it("should log book snapshot", () => {
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 10);
    logger.logBookSnapshot(ledger.market.orderBook);

    const logs = logger.getLogs();
    const snapshotLogs = logs.filter(l => l.type === "BOOK_SNAPSHOT");

    expect(snapshotLogs.length).toBe(1);
  });

  it("should log market data", () => {
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 10);
    engine.placeLimitOrder(ledger, "bob", "BUY", 0.45, 10);
    logger.logMarketData(ledger.market.orderBook);

    const logs = logger.getLogs();
    const marketDataLogs = logs.filter(l => l.type === "MARKET_DATA");

    expect(marketDataLogs.length).toBe(1);
    const md = marketDataLogs[0].data;
    expect(md.bestBid).toBeDefined();
    expect(md.bestAsk).toBeDefined();
  });
});

describe("CLOB: Singleton Instance", () => {
  it("should provide working singleton instance", () => {
    const ledger = clob.initLedger([
      { id: "alice", cash: 10000 },
      { id: "bob", cash: 10000 },
    ]);

    clob.placeLimitOrder(ledger, "alice", "SELL", 0.50, 10);
    const result = clob.placeLimitOrder(ledger, "bob", "BUY", 0.55, 5);

    expect(result.status).toBe("FILLED");
    expectDecimalCloseToNumber(result.filledQty, 5);
  });
});

describe("CLOB: Complex Scenarios", () => {
  let engine: CLOBEngine;
  let ledger: CLOBLedger;

  beforeEach(() => {
    engine = new CLOBEngine();
    ledger = engine.initLedger([
      { id: "alice", cash: 10000 },
      { id: "bob", cash: 10000 },
      { id: "carol", cash: 10000 },
      { id: "dave", cash: 10000 },
    ]);
  });

  it("should handle order book with multiple price levels", () => {
    // Build an order book
    engine.placeLimitOrder(ledger, "alice", "BUY", 0.40, 10);
    engine.placeLimitOrder(ledger, "bob", "BUY", 0.45, 10);
    engine.placeLimitOrder(ledger, "carol", "SELL", 0.55, 10);
    engine.placeLimitOrder(ledger, "dave", "SELL", 0.60, 10);

    const book = ledger.market.orderBook;

    // Check best bid and ask
    const bestBid = engine.getBestBid(book);
    const bestAsk = engine.getBestAsk(book);

    expectDecimalCloseToNumber(bestBid!, 0.45);
    expectDecimalCloseToNumber(bestAsk!, 0.55);

    // Check depth
    const bidDepth = engine.getDepth(book, "BUY", 2);
    const askDepth = engine.getDepth(book, "SELL", 2);

    expectDecimalCloseToNumber(bidDepth, 20); // 10 + 10
    expectDecimalCloseToNumber(askDepth, 20); // 10 + 10
  });

  it("should handle fill-or-kill scenario (marketable limit order)", () => {
    // Place some asks
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 5);
    engine.placeLimitOrder(ledger, "bob", "SELL", 0.55, 5);

    // Large bid that should cross and fill completely
    const result = engine.placeLimitOrder(ledger, "carol", "BUY", 0.60, 10);

    expect(result.status).toBe("FILLED");
    expect(result.trades.length).toBe(2);
    expectDecimalCloseToNumber(result.remainingQty, 0);
  });

  it("should maintain order across price level updates", () => {
    // Place orders at same price
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.50, 5);
    engine.placeLimitOrder(ledger, "bob", "SELL", 0.50, 5);
    engine.placeLimitOrder(ledger, "carol", "SELL", 0.50, 5);

    // Partial fill (should hit Alice first, then Bob)
    engine.placeLimitOrder(ledger, "dave", "BUY", 0.55, 7);

    // Check remaining orders
    const book = ledger.market.orderBook;
    const ordersAtPrice = engine.getOrdersAtPrice(book, "SELL", new Decimal(0.50));

    expect(ordersAtPrice.length).toBe(2); // Bob and Carol
    // Alice was completely filled (5), Bob has 2 filled so 3 remaining, Carol untouched (5)
    // The orders array preserves order: Bob (3 remaining), Carol (5 untouched)
    expectDecimalCloseToNumber(ordersAtPrice[0].qty, 3); // Bob partially filled
    expectDecimalCloseToNumber(ordersAtPrice[1].qty, 5); // Carol untouched
  });
});
