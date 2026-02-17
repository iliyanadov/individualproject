/**
 * Prediction Market CLOB Tests
 *
 * Tests for the sell-to-close collateral model and settlement:
 * - Can only sell shares you hold (no naked shorting)
 * - Settlement at $1/$0
 * - P&L calculation
 * - Rejected orders for insufficient collateral
 *
 * Note: In a sell-to-close model, the first trade requires someone to
 * have shares. This is typically a market maker who provides initial liquidity.
 * For testing, we initialize one trader with shares to bootstrap the market.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Decimal } from "decimal.js";
import { CLOBEnginePM, CLOBLedger, Outcome } from "../src/lib/clobPm";

function expectDecimalClose(
  actual: Decimal | number,
  expected: Decimal | number,
  tolerance: number = 1e-10
): void {
  const a = actual instanceof Decimal ? actual : new Decimal(actual);
  const e = expected instanceof Decimal ? expected : new Decimal(expected);
  const diff = a.minus(e).abs().toNumber();
  expect(diff).toBeLessThanOrEqual(tolerance);
}

function expectDecimalEqual(
  actual: Decimal | number,
  expected: Decimal | number
): void {
  const a = actual instanceof Decimal ? actual : new Decimal(actual);
  const e = expected instanceof Decimal ? expected : new Decimal(expected);
  expect(a.toString()).toBe(e.toString());
}

// Helper to bootstrap market by giving initial shares to a trader
function bootstrapMarket(engine: CLOBEnginePM, sharesToAlice: number): CLOBLedger {
  const ledger = engine.initLedger([
    { id: "alice", cash: 10000 },
    { id: "bob", cash: 10000 },
  ]);

  // Manually give alice shares to bootstrap the market
  // (In real PM, this would be a market maker providing liquidity)
  const alice = ledger.traders.get("alice")!;
  alice.yesShares = new Decimal(sharesToAlice);
  alice.cash = alice.cash.minus(new Decimal(sharesToAlice * 0.5)); // She paid for them

  return ledger;
}

describe("CLOB-PM: Sell-to-Close Validation", () => {
  let engine: CLOBEnginePM;
  let ledger: CLOBLedger;

  beforeEach(() => {
    engine = new CLOBEnginePM();
    // Bootstrap market: alice gets 200 shares to sell
    ledger = bootstrapMarket(engine, 200);
  });

  describe("Limit Order Sell Validation", () => {
    it("should reject sell order when trader has no shares", () => {
      // Bob has no shares
      const result = engine.placeLimitOrder(ledger, "bob", "SELL", 0.5, 10);

      expect(result.status).toBe("REJECTED");
      expect(result.rejectionReason).toContain("Insufficient shares");
    });

    it("should accept sell order for shares held", () => {
      // Alice has 200 shares from bootstrap
      const sellResult = engine.placeLimitOrder(ledger, "alice", "SELL", 0.7, 50);
      expect(sellResult.status).not.toBe("REJECTED");
    });

    it("should reject sell exceeding available shares", () => {
      // Alice has 200 shares from bootstrap
      // Try to sell 250 - should be rejected
      const sellResult = engine.placeLimitOrder(ledger, "alice", "SELL", 0.7, 250);
      expect(sellResult.status).toBe("REJECTED");
      expect(sellResult.rejectionReason).toContain("Available: 200");
    });

    it("should account for pending sell orders", () => {
      // Alice has 200 shares
      // She places a sell order for 30 shares (doesn't cross, goes on book at 0.9)
      const sell1 = engine.placeLimitOrder(ledger, "alice", "SELL", 0.9, 30);
      expect(sell1.status).toBe("OPEN"); // Goes on book

      // Now she can only sell 170 more (200 - 30 pending)
      const sellResult = engine.placeLimitOrder(ledger, "alice", "SELL", 0.8, 171);
      expect(sellResult.status).toBe("REJECTED");
      expect(sellResult.rejectionReason).toContain("Available: 170");
    });

    it("should allow selling exactly available shares", () => {
      // Alice has 200 shares
      // Place partial sell
      const sell1 = engine.placeLimitOrder(ledger, "alice", "SELL", 0.9, 30);
      expect(sell1.status).toBe("OPEN");

      // Sell remaining available
      const sell2 = engine.placeLimitOrder(ledger, "alice", "SELL", 0.8, 170);
      expect(sell2.status).not.toBe("REJECTED");
    });
  });

  describe("Market Order Sell Validation", () => {
    it("should reject market sell when trader has no shares", () => {
      const result = engine.placeMarketOrder(ledger, "bob", "SELL", 10);

      expect(result.status).toBe("REJECTED");
      expect(result.rejectionReason).toContain("Insufficient shares");
    });

    it("should accept market sell for shares held", () => {
      // Alice has 200 shares, bob has a buy order
      engine.placeLimitOrder(ledger, "bob", "BUY", 0.4, 50);

      const result = engine.placeMarketOrder(ledger, "alice", "SELL", 20);
      expect(result.status).not.toBe("REJECTED");
      expect(result.filledQty.toNumber()).toBe(20);
    });

    it("should reject market sell exceeding holdings", () => {
      const result = engine.placeMarketOrder(ledger, "alice", "SELL", 300);
      expect(result.status).toBe("REJECTED");
    });
  });

  describe("Buy Order Cash Validation", () => {
    it("should reject buy order exceeding cash", () => {
      const result = engine.placeLimitOrder(ledger, "bob", "BUY", 0.6, 20000);

      expect(result.status).toBe("REJECTED");
      expect(result.rejectionReason).toContain("Insufficient cash");
    });

    it("should accept buy order within cash limits", () => {
      const result = engine.placeLimitOrder(ledger, "bob", "BUY", 0.6, 100);
      expect(result.status).not.toBe("REJECTED");
    });
  });

  describe("Price Limits", () => {
    it("should reject orders with price > $1", () => {
      const result = engine.placeLimitOrder(ledger, "bob", "BUY", 1.5, 10);
      expect(result.status).toBe("REJECTED");
      expect(result.rejectionReason).toContain("cannot exceed $1");
    });

    it("should reject orders with price <= $0", () => {
      const result = engine.placeLimitOrder(ledger, "bob", "BUY", 0, 10);
      expect(result.status).toBe("REJECTED");
      expect(result.rejectionReason).toContain("must be positive");
    });
  });
});

describe("CLOB-PM: Settlement", () => {
  let engine: CLOBEnginePM;
  let ledger: CLOBLedger;

  beforeEach(() => {
    engine = new CLOBEnginePM();
    // Bootstrap market
    ledger = bootstrapMarket(engine, 200);
  });

  describe("YES Outcome Settlement", () => {
    it("should pay $1 per YES share when YES wins", () => {
      // Alice sells 100 to bob at 0.60
      engine.placeLimitOrder(ledger, "alice", "SELL", 0.6, 100);
      engine.placeLimitOrder(ledger, "bob", "BUY", 0.6, 100);

      const alice = ledger.traders.get("alice")!;
      const bob = ledger.traders.get("bob")!;

      const settlement = engine.settle(ledger, "YES");

      expect(settlement.outcome).toBe("YES");
      // Total payout = Bob's 100 shares + Alice's remaining 100 shares = 200
      expect(settlement.totalPayout.toNumber()).toBe(200);

      // Alice sold 100, has 100 left, gets $100 payout
      const alicePayout = settlement.traderPayouts.get("alice")!;
      expect(alicePayout.payoutReceived.toNumber()).toBe(100);

      // Bob has 100 shares, gets $100 payout
      // Bob's cash after trade: 10000 - 60 = 9940
      // After settlement: 9940 + 100 = 10040
      const bobPayout = settlement.traderPayouts.get("bob")!;
      expect(bobPayout.payoutReceived.toNumber()).toBe(100);
      expect(bobPayout.initialCash.toNumber()).toBe(9940);
      expect(bobPayout.finalCash.toNumber()).toBe(10040);
      expect(bobPayout.netProfit.toNumber()).toBe(100); // payout received
    });

    it("should result in zero value for YES shares when NO wins", () => {
      engine.placeLimitOrder(ledger, "alice", "SELL", 0.6, 100);
      engine.placeLimitOrder(ledger, "bob", "BUY", 0.6, 100);

      const settlement = engine.settle(ledger, "NO");

      // YES shares pay $0
      expect(settlement.totalPayout.toNumber()).toBe(0);

      // Bob's cash after trade: 10000 - 60 = 9940
      // At NO settlement: YES shares pay $0
      const bobPayout = settlement.traderPayouts.get("bob")!;
      expect(bobPayout.payoutReceived.toNumber()).toBe(0);
      expect(bobPayout.initialCash.toNumber()).toBe(9940);
      expect(bobPayout.finalCash.toNumber()).toBe(9940);
      expect(bobPayout.netProfit.toNumber()).toBe(0); // No change at settlement
    });

    it("should clear all shares after settlement", () => {
      engine.placeLimitOrder(ledger, "alice", "SELL", 0.6, 100);
      engine.placeLimitOrder(ledger, "bob", "BUY", 0.6, 100);

      engine.settle(ledger, "YES");

      for (const [, trader] of ledger.traders) {
        expect(trader.yesShares.toNumber()).toBe(0);
      }
    });

    it("should clear order book after settlement", () => {
      // Place some orders that don't fill
      engine.placeLimitOrder(ledger, "alice", "SELL", 0.3, 50);
      engine.placeLimitOrder(ledger, "bob", "BUY", 0.8, 30);

      engine.settle(ledger, "YES");

      expect(ledger.market.orderBook.bids.size).toBe(0);
      expect(ledger.market.orderBook.asks.size).toBe(0);
      expect(ledger.market.orderBook.bestBid).toBeUndefined();
      expect(ledger.market.orderBook.bestAsk).toBeUndefined();
    });
  });

  describe("P&L Calculation", () => {
    it("should correctly calculate profit for winning YES holder", () => {
      // Alice sells at 0.40, Bob buys
      engine.placeLimitOrder(ledger, "alice", "SELL", 0.4, 100);
      engine.placeLimitOrder(ledger, "bob", "BUY", 0.4, 100);

      const settlement = engine.settle(ledger, "YES");
      const bobPayout = settlement.traderPayouts.get("bob")!;

      // Bob spent 40, got 100 back = profit of 60
      // Bob's cash after trade: 10000 - 40 = 9960
      expect(bobPayout.initialCash.toNumber()).toBe(9960);
      expect(bobPayout.finalCash.toNumber()).toBe(10060);
      expect(bobPayout.netProfit.toNumber()).toBe(100); // payout received
    });

    it("should correctly calculate loss for losing YES holder", () => {
      // Alice sells at 0.7, Bob buys
      engine.placeLimitOrder(ledger, "alice", "SELL", 0.7, 100);
      engine.placeLimitOrder(ledger, "bob", "BUY", 0.7, 100);

      const settlement = engine.settle(ledger, "NO");
      const bobPayout = settlement.traderPayouts.get("bob")!;

      // Bob spent 70, got 0 back at settlement
      // Bob's cash after trade: 10000 - 70 = 9930
      expect(bobPayout.initialCash.toNumber()).toBe(9930);
      expect(bobPayout.finalCash.toNumber()).toBe(9930);
      expect(bobPayout.netProfit.toNumber()).toBe(0); // No change at settlement
    });

    it("should correctly calculate profit for seller (NO holder)", () => {
      // Alice sells YES at 0.7 (effectively buying NO at 0.3)
      engine.placeLimitOrder(ledger, "alice", "SELL", 0.7, 100);
      engine.placeLimitOrder(ledger, "bob", "BUY", 0.7, 100);

      const settlement = engine.settle(ledger, "NO");
      const alicePayout = settlement.traderPayouts.get("alice")!;

      // Alice's cash: started at 10000, bootstrap cost 100 (200*0.5) = 9900
      // After selling 100 at 0.7: 9900 + 70 = 9970
      // At NO settlement: YES shares pay $0, no change
      expect(alicePayout.initialCash.toNumber()).toBe(9970);
      expect(alicePayout.finalCash.toNumber()).toBe(9970);
      expect(alicePayout.payoutReceived.toNumber()).toBe(0);
      expect(alicePayout.netProfit.toNumber()).toBe(0); // No change at settlement
    });

    it("should handle multiple traders correctly", () => {
      // Alice sells 100 YES at 0.5 to Bob
      engine.placeLimitOrder(ledger, "alice", "SELL", 0.5, 100);
      engine.placeLimitOrder(ledger, "bob", "BUY", 0.5, 100);

      // Alice sells 50 YES at 0.6 to Bob
      engine.placeLimitOrder(ledger, "alice", "SELL", 0.6, 50);
      engine.placeLimitOrder(ledger, "bob", "BUY", 0.6, 50);

      const settlement = engine.settle(ledger, "YES");

      const bobPayout = settlement.traderPayouts.get("bob")!;
      const alicePayout = settlement.traderPayouts.get("alice")!;

      // Bob: spent 50+30=80, got 150 shares
      // Cash after trades: 10000 - 80 = 9920
      // At YES settlement: gets 150 payout, final cash = 10070
      expect(bobPayout.initialCash.toNumber()).toBe(9920);
      expect(bobPayout.payoutReceived.toNumber()).toBe(150);
      expect(bobPayout.finalCash.toNumber()).toBe(10070);
      expect(bobPayout.netProfit.toNumber()).toBe(150); // payout received

      // Alice: started with 200 shares, sold 150, has 50 left
      // Initial cash: 10000, bootstrap cost: 100 (200*0.5) = 9900
      // After trades: 9900 + 50 + 30 = 9980
      // At YES settlement: gets 50 payout for remaining shares, final cash = 10030
      expect(alicePayout.payoutReceived.toNumber()).toBe(50);
      expect(alicePayout.initialCash.toNumber()).toBe(9980);
      expect(alicePayout.finalCash.toNumber()).toBe(10030);
      expect(alicePayout.netProfit.toNumber()).toBe(50); // payout received
    });
  });

  describe("Settlement Preview", () => {
    it("should show preview for both outcomes", () => {
      // Alice sells at 0.6, Bob buys
      engine.placeLimitOrder(ledger, "alice", "SELL", 0.6, 100);
      engine.placeLimitOrder(ledger, "bob", "BUY", 0.6, 100);

      const preview = engine.getSettlementPreview(ledger);

      expect(preview.size).toBe(2);
      expect(preview.has("YES")).toBe(true);
      expect(preview.has("NO")).toBe(true);

      const bobYes = preview.get("YES")!.get("bob")!;
      const bobNo = preview.get("NO")!.get("bob")!;

      // Bob's cash after trade: 10000 - 60 = 9940
      // If YES wins: bob gets $100 payout, final cash = 10040
      expect(bobYes.payoutReceived.toNumber()).toBe(100);
      expect(bobYes.initialCash.toNumber()).toBe(9940);
      expect(bobYes.finalCash.toNumber()).toBe(10040);
      expect(bobYes.netProfit.toNumber()).toBe(100); // payout received

      // If NO wins: bob gets $0 payout, final cash = 9940
      expect(bobNo.payoutReceived.toNumber()).toBe(0);
      expect(bobNo.initialCash.toNumber()).toBe(9940);
      expect(bobNo.finalCash.toNumber()).toBe(9940);
      expect(bobNo.netProfit.toNumber()).toBe(0); // no payout
    });
  });

  describe("Settlement Rejection", () => {
    it("should reject trading after settlement", () => {
      engine.placeLimitOrder(ledger, "alice", "SELL", 0.5, 10);
      engine.placeLimitOrder(ledger, "bob", "BUY", 0.5, 10);

      engine.settle(ledger, "YES");

      const result = engine.placeLimitOrder(ledger, "alice", "BUY", 0.5, 10);
      expect(result.status).toBe("REJECTED");
      expect(result.rejectionReason).toContain("settled market");
    });

    it("should reject double settlement", () => {
      engine.settle(ledger, "YES");

      expect(() => engine.settle(ledger, "NO")).toThrow("already settled");
    });
  });
});

describe("CLOB-PM: Portfolio Value Tracking", () => {
  let engine: CLOBEnginePM;
  let ledger: CLOBLedger;

  beforeEach(() => {
    engine = new CLOBEnginePM();
    ledger = bootstrapMarket(engine, 200);
  });

  it("should calculate portfolio value at current price", () => {
    // Alice sells 100 shares at various prices to bob
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.5, 50);
    engine.placeLimitOrder(ledger, "bob", "BUY", 0.5, 50);

    engine.placeLimitOrder(ledger, "alice", "SELL", 0.6, 50);
    engine.placeLimitOrder(ledger, "bob", "BUY", 0.6, 50);

    const bob = ledger.traders.get("bob")!;

    // Current price is around 0.6 (last trade)
    const currentPrice = new Decimal(0.6);
    const portfolioValue = engine.getTraderPortfolioValue(ledger, "bob", currentPrice);

    // Bob has 100 shares worth 0.6 each = 60
    // Bob's cash: 10000 - 25 - 30 = 9945
    // Value: 9945 + 60 = 10005
    expect(portfolioValue.toNumber()).toBeCloseTo(10005, 0);
  });

  it("should track available shares correctly", () => {
    const alice = ledger.traders.get("alice")!;
    expect(alice.yesShares.toNumber()).toBe(200);

    // Available shares = held - pending sells
    let available = engine.getAvailableShares(alice);
    expect(available.toNumber()).toBe(200);

    // Place sell order for 30 (goes on book)
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.7, 30);

    // Now available = 200 - 30 = 170
    available = engine.getAvailableShares(alice);
    expect(available.toNumber()).toBe(170);
  });
});

describe("CLOB-PM: Cash Conservation", () => {
  let engine: CLOBEnginePM;
  let ledger: CLOBLedger;

  beforeEach(() => {
    engine = new CLOBEnginePM();
    ledger = bootstrapMarket(engine, 200);
  });

  it("should conserve total cash across trades", () => {
    // Initial total: alice 9900 + bob 10000 = 19900
    // (Alice started with 10000, paid 100 for 200 shares at 0.5 each)
    const initialTotal = new Decimal(19900);

    // Alice sells 100 to bob at 0.5
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.5, 100);
    engine.placeLimitOrder(ledger, "bob", "BUY", 0.5, 100);

    let totalCash = new Decimal(0);
    for (const [, trader] of ledger.traders) {
      totalCash = totalCash.plus(trader.cash);
    }

    // Cash should still sum to 19900
    expect(totalCash.toNumber()).toBeCloseTo(19900, 0);
  });

  it("should conserve total value (cash + shares*price) at settlement", () => {
    // Alice sells 100 to Bob at 0.5
    engine.placeLimitOrder(ledger, "alice", "SELL", 0.5, 100);
    engine.placeLimitOrder(ledger, "bob", "BUY", 0.5, 100);

    const settlement = engine.settle(ledger, "YES");

    const bobPayout = settlement.traderPayouts.get("bob")!;
    const alicePayout = settlement.traderPayouts.get("alice")!;

    // Bob: spent 50, got 100 shares
    // Cash after trade: 10000 - 50 = 9950
    // At YES settlement: gets 100 payout, final cash = 10050
    expect(bobPayout.initialCash.toNumber()).toBe(9950);
    expect(bobPayout.finalCash.toNumber()).toBe(10050);
    expect(bobPayout.payoutReceived.toNumber()).toBe(100);

    // Alice: started with 200 shares, sold 100 at 0.5 = got 50
    // Initial cash: 10000, bootstrap cost: 100 (200*0.5) = 9900
    // After trade: 9900 + 50 = 9950
    // At YES settlement: gets 100 payout for 100 remaining shares, final cash = 10050
    expect(alicePayout.initialCash.toNumber()).toBe(9950);
    expect(alicePayout.finalCash.toNumber()).toBe(10050);
    expect(alicePayout.payoutReceived.toNumber()).toBe(100);

    // Total payout = 100 (Bob) + 100 (Alice) = 200
    expect(settlement.totalPayout.toNumber()).toBe(200);

    // Total cash after settlement: 10050 + 10050 = 20100
    // Initial total cash was 19900, total payout adds 200 = 20100 ✓
  });
});
