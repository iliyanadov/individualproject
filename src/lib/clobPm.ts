/**
 * CLOB (Central Limit Order Book) Engine - Prediction Market Version
 *
 * This is a prediction-market-specific CLOB that enforces:
 * - Sell-to-close only (no naked shorting)
 * - Full collateralization at $1 per share
 * - Settlement with $1/$0 payouts
 * - Proper P&L tracking
 *
 * Based on Polymarket-style mechanics:
 * - YES shares represent a claim that pays $1 if YES wins, $0 if NO wins
 * - Traders can only sell shares they already hold
 * - Settlement converts winning shares to $1, losing shares to $0
 */

import { Decimal } from "decimal.js";

Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -28,
  toExpPos: 28,
});

// ============================================================================
// Core Types
// ============================================================================

export type Side = "BUY" | "SELL";
export type Outcome = "YES" | "NO";

export type OrderStatus = "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED" | "REJECTED";
export type OrderType = "LIMIT" | "MARKET" | "CANCEL";

export interface PriceLevel {
  price: Decimal;
  side: Side;
  totalQty: Decimal;
  orders: LimitOrder[];
  prev?: PriceLevel;
  next?: PriceLevel;
}

export interface LimitOrder {
  orderId: string;
  traderId: string;
  side: Side;
  price: Decimal;
  qty: Decimal;
  originalQty: Decimal;
  timestamp: number;
  status: OrderStatus;
}

export interface MarketOrder {
  orderId: string;
  traderId: string;
  side: Side;
  qty: Decimal;
  timestamp: number;
  status: OrderStatus;
}

export interface Trade {
  tradeId: string;
  askOrderId: string;
  bidOrderId: string;
  price: Decimal;
  qty: Decimal;
  bidTraderId: string;
  askTraderId: string;
  timestamp: string;
}

export interface OrderResult {
  orderId: string;
  status: OrderStatus;
  trades: Trade[];
  filledQty: Decimal;
  remainingQty: Decimal;
  avgFillPrice: Decimal;
  timestamp: string;
  rejectionReason?: string;
}

export interface OrderBook {
  bids: Map<string, PriceLevel>;
  asks: Map<string, PriceLevel>;
  bestBid?: PriceLevel;
  bestAsk?: PriceLevel;
}

export interface CLOBMarketState {
  orderBook: OrderBook;
  lastTradePrice?: Decimal;
  tradeIdCounter: number;
  orderIdCounter: number;
  settled: boolean;
  outcome?: Outcome;
}

export interface TraderAccount {
  traderId: string;
  cash: Decimal;
  yesShares: Decimal;
  // In prediction markets, we only track YES shares explicitly
  // NO shares are implied: holding $X cash + $Y in YES shares is equivalent to having ($X - $Y) exposure to NO
  openOrders: Set<string>;
  // Track pending sell orders to prevent overselling
  pendingSellQty: Decimal;
}

export interface CLOBLedger {
  market: CLOBMarketState;
  traders: Map<string, TraderAccount>;
}

export interface SettlementResult {
  outcome: Outcome;
  totalPayout: Decimal;
  totalCollected: Decimal;
  profitLoss: Decimal;
  traderPayouts: Map<string, TraderPayout>;
  timestamp: string;
}

export interface TraderPayout {
  traderId: string;
  initialCash: Decimal;
  initialYesShares: Decimal;
  finalCash: Decimal;
  finalYesShares: Decimal;
  payoutReceived: Decimal;
  netProfit: Decimal;
}

export type CLOBLogEntry =
  | { type: "ORDER_PLACED"; data: { order: LimitOrder | MarketOrder; timestamp: string } }
  | { type: "ORDER_CANCELLED"; data: { orderId: string; timestamp: string } }
  | { type: "ORDER_REJECTED"; data: { orderId: string; reason: string; timestamp: string } }
  | { type: "TRADE"; data: Trade }
  | { type: "SETTLEMENT"; data: SettlementResult }
  | { type: "BOOK_SNAPSHOT"; data: { bids: PriceLevelSnapshot[]; asks: PriceLevelSnapshot[]; timestamp: string } }
  | { type: "MARKET_DATA"; data: { bestBid?: Decimal; bestAsk?: Decimal; spread?: Decimal; midPrice?: Decimal; timestamp: string } };

export interface PriceLevelSnapshot {
  price: Decimal;
  totalQty: Decimal;
  orderCount: number;
}

// ============================================================================
// CLOB Logger
// ============================================================================

export class CLOBLogger {
  private logs: CLOBLogEntry[] = [];

  logOrderPlaced(order: LimitOrder | MarketOrder): void {
    const timestamp = new Date().toISOString();
    this.logs.push({ type: "ORDER_PLACED", data: { order, timestamp } });
  }

  logOrderRejected(orderId: string, reason: string): void {
    const timestamp = new Date().toISOString();
    this.logs.push({ type: "ORDER_REJECTED", data: { orderId, reason, timestamp } });
  }

  logOrderCancelled(orderId: string): void {
    const timestamp = new Date().toISOString();
    this.logs.push({ type: "ORDER_CANCELLED", data: { orderId, timestamp } });
  }

  logTrade(trade: Trade): void {
    this.logs.push({ type: "TRADE", data: trade });
  }

  logSettlement(result: SettlementResult): void {
    this.logs.push({ type: "SETTLEMENT", data: result });
  }

  logBookSnapshot(book: OrderBook): void {
    const timestamp = new Date().toISOString();
    const bids = this._snapshotLevels(book.bids, book.bestBid);
    const asks = this._snapshotLevels(book.asks, book.bestAsk);
    this.logs.push({ type: "BOOK_SNAPSHOT", data: { bids, asks, timestamp } });
  }

  logMarketData(book: OrderBook): void {
    const timestamp = new Date().toISOString();
    const bestBid = book.bestBid?.price;
    const bestAsk = book.bestAsk?.price;
    let spread: Decimal | undefined;
    let midPrice: Decimal | undefined;

    if (bestBid && bestAsk) {
      spread = bestAsk.minus(bestBid);
      midPrice = bestBid.plus(bestAsk).div(2);
    }

    this.logs.push({
      type: "MARKET_DATA",
      data: { bestBid, bestAsk, spread, midPrice, timestamp },
    });
  }

  private _snapshotLevels(
    levels: Map<string, PriceLevel>,
    start?: PriceLevel
  ): PriceLevelSnapshot[] {
    const snapshots: PriceLevelSnapshot[] = [];
    let current = start;
    while (current) {
      snapshots.push({
        price: current.price,
        totalQty: current.totalQty,
        orderCount: current.orders.length,
      });
      current = current.next;
    }
    return snapshots;
  }

  getLogs(): readonly CLOBLogEntry[] {
    return this.logs;
  }

  exportJson(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  clear(): void {
    this.logs = [];
  }
}

// ============================================================================
// CLOB Engine - Prediction Market Version
// ============================================================================

export class CLOBEnginePM {
  private orderIdCounter: number = 0;
  private tradeIdCounter: number = 0;
  private readonly logger: CLOBLogger;
  private readonly ZERO: Decimal;
  private readonly ONE: Decimal;

  constructor(logger?: CLOBLogger) {
    this.logger = logger ?? new CLOBLogger();
    this.ZERO = new Decimal(0);
    this.ONE = new Decimal(1);
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  initMarket(): CLOBMarketState {
    return {
      orderBook: {
        bids: new Map(),
        asks: new Map(),
      },
      tradeIdCounter: 0,
      orderIdCounter: 0,
      settled: false,
    };
  }

  initTrader(traderId: string, initialCash: number | Decimal): TraderAccount {
    return {
      traderId,
      cash: initialCash instanceof Decimal ? initialCash : new Decimal(initialCash),
      yesShares: new Decimal(0),
      openOrders: new Set(),
      pendingSellQty: new Decimal(0),
    };
  }

  initLedger(traders: Array<{ id: string; cash: number | Decimal }>): CLOBLedger {
    const market = this.initMarket();
    const traderMap = new Map<string, TraderAccount>();
    for (const t of traders) {
      traderMap.set(t.id, this.initTrader(t.id, t.cash));
    }
    return { market, traders: traderMap };
  }

  // -------------------------------------------------------------------------
  // Market Data
  // -------------------------------------------------------------------------

  getBestBid(book: OrderBook): Decimal | undefined {
    return book.bestBid?.price;
  }

  getBestAsk(book: OrderBook): Decimal | undefined {
    return book.bestAsk?.price;
  }

  getSpread(book: OrderBook): Decimal | undefined {
    const bestBid = this.getBestBid(book);
    const bestAsk = this.getBestAsk(book);
    if (bestBid && bestAsk) {
      return bestAsk.minus(bestBid);
    }
    return undefined;
  }

  getMidPrice(book: OrderBook): Decimal | undefined {
    const bestBid = this.getBestBid(book);
    const bestAsk = this.getBestAsk(book);
    if (bestBid && bestAsk) {
      return bestBid.plus(bestAsk).div(2);
    }
    return undefined;
  }

  getDepth(book: OrderBook, side: Side, ticks: number): Decimal {
    let start = side === "BUY" ? book.bestBid : book.bestAsk;
    let totalDepth = new Decimal(0);
    let count = 0;

    while (start && count < ticks) {
      totalDepth = totalDepth.plus(start.totalQty);
      start = start.next;
      count++;
    }

    return totalDepth;
  }

  getOrdersAtPrice(book: OrderBook, side: Side, price: Decimal): LimitOrder[] {
    const levels = side === "BUY" ? book.bids : book.asks;
    const priceKey = price.toString();
    const level = levels.get(priceKey);
    return level ? [...level.orders] : [];
  }

  /**
   * Get the total value of a trader's position at current prices
   * For YES shares: value = yesShares * currentYESPrice
   * Total portfolio value = cash + yesShares * currentYESPrice
   */
  getTraderPortfolioValue(ledger: CLOBLedger, traderId: string, yesPrice: Decimal): Decimal {
    const trader = ledger.traders.get(traderId);
    if (!trader) return this.ZERO;

    const shareValue = trader.yesShares.times(yesPrice);
    return trader.cash.plus(shareValue);
  }

  /**
   * Get a trader's available YES shares for selling
   * Accounts for both held shares and pending sell orders
   */
  getAvailableShares(trader: TraderAccount): Decimal {
    // Available = held - pending sells
    // Can't go below zero
    const available = trader.yesShares.minus(trader.pendingSellQty);
    return available.lt(this.ZERO) ? this.ZERO : available;
  }

  // -------------------------------------------------------------------------
  // Order Operations
  // -------------------------------------------------------------------------

  placeLimitOrder(
    ledger: CLOBLedger,
    traderId: string,
    side: Side,
    price: number | Decimal,
    qty: number | Decimal
  ): OrderResult {
    if (ledger.market.settled) {
      return this._rejectOrder(
        this._generateOrderId(ledger.market),
        "Cannot trade in settled market"
      );
    }

    const trader = ledger.traders.get(traderId);
    if (!trader) {
      return this._rejectOrder(
        this._generateOrderId(ledger.market),
        `Trader ${traderId} not found`
      );
    }

    const priceD = price instanceof Decimal ? price : new Decimal(price);
    const qtyD = qty instanceof Decimal ? qty : new Decimal(qty);

    if (qtyD.lte(0)) {
      return this._rejectOrder(
        this._generateOrderId(ledger.market),
        "Quantity must be positive"
      );
    }

    if (priceD.lte(0)) {
      return this._rejectOrder(
        this._generateOrderId(ledger.market),
        "Price must be positive"
      );
    }

    if (priceD.gt(this.ONE)) {
      return this._rejectOrder(
        this._generateOrderId(ledger.market),
        "Price cannot exceed $1 (max payout)"
      );
    }

    // ===== SELL-TO-CLOSE VALIDATION =====
    if (side === "SELL") {
      const availableShares = this.getAvailableShares(trader);
      if (qtyD.gt(availableShares)) {
        return this._rejectOrder(
          this._generateOrderId(ledger.market),
          `Insufficient shares for sell. Available: ${availableShares.toString()}, Requested: ${qtyD.toString()}`
        );
      }
    }
    // ===== END SELL-TO-CLOSE VALIDATION =====

    // Check cash sufficiency for BUY orders
    if (side === "BUY") {
      const maxCost = priceD.times(qtyD);
      if (maxCost.gt(trader.cash)) {
        return this._rejectOrder(
          this._generateOrderId(ledger.market),
          `Insufficient cash for buy. Need: ${maxCost.toString()}, Have: ${trader.cash.toString()}`
        );
      }
    }

    const orderId = this._generateOrderId(ledger.market);
    const timestamp = Date.now();

    const order: LimitOrder = {
      orderId,
      traderId,
      side,
      price: priceD,
      qty: qtyD,
      originalQty: qtyD,
      timestamp,
      status: "OPEN",
    };

    this.logger.logOrderPlaced(order);

    let result: OrderResult;
    if (side === "BUY") {
      result = this._matchLimitBuy(ledger, order, traderId);
    } else {
      result = this._matchLimitSell(ledger, order, traderId);
    }

    return result;
  }

  placeMarketOrder(
    ledger: CLOBLedger,
    traderId: string,
    side: Side,
    qty: number | Decimal
  ): OrderResult {
    if (ledger.market.settled) {
      return this._rejectOrder(
        `MKT-${Date.now()}`,
        "Cannot trade in settled market"
      );
    }

    const trader = ledger.traders.get(traderId);
    if (!trader) {
      return this._rejectOrder(
        `MKT-${Date.now()}`,
        `Trader ${traderId} not found`
      );
    }

    const qtyD = qty instanceof Decimal ? qty : new Decimal(qty);

    if (qtyD.lte(0)) {
      return this._rejectOrder(
        `MKT-${Date.now()}`,
        "Quantity must be positive"
      );
    }

    // ===== SELL-TO-CLOSE VALIDATION =====
    if (side === "SELL") {
      const availableShares = this.getAvailableShares(trader);
      if (qtyD.gt(availableShares)) {
        return this._rejectOrder(
          `MKT-${Date.now()}`,
          `Insufficient shares for market sell. Available: ${availableShares.toString()}, Requested: ${qtyD.toString()}`
        );
      }
    }
    // ===== END SELL-TO-CLOSE VALIDATION =====

    const orderId = `MKT-${Date.now()}`;
    const timestamp = Date.now();

    const order: MarketOrder = {
      orderId,
      traderId,
      side,
      qty: qtyD,
      timestamp,
      status: "OPEN",
    };

    this.logger.logOrderPlaced(order);

    let result: OrderResult;
    if (side === "BUY") {
      result = this._matchMarketBuy(ledger, qtyD, traderId);
    } else {
      result = this._matchMarketSell(ledger, qtyD, traderId);
    }

    return result;
  }

  cancelOrder(ledger: CLOBLedger, orderId: string): OrderResult {
    if (ledger.market.settled) {
      return {
        orderId,
        status: "CANCELLED",
        trades: [],
        filledQty: new Decimal(0),
        remainingQty: new Decimal(0),
        avgFillPrice: new Decimal(0),
        timestamp: new Date().toISOString(),
        rejectionReason: "Cannot cancel in settled market",
      };
    }

    const book = ledger.market.orderBook;
    const removedOrder = this._removeFromBook(book, orderId);

    if (!removedOrder) {
      return {
        orderId,
        status: "CANCELLED",
        trades: [],
        filledQty: new Decimal(0),
        remainingQty: new Decimal(0),
        avgFillPrice: new Decimal(0),
        timestamp: new Date().toISOString(),
      };
    }

    const trader = ledger.traders.get(removedOrder.traderId);
    if (trader) {
      trader.openOrders.delete(orderId);

      // Update pending sell qty if this was a sell order
      if (removedOrder.side === "SELL") {
        const remainingQty = removedOrder.qty;
        trader.pendingSellQty = trader.pendingSellQty.minus(remainingQty);
        if (trader.pendingSellQty.lt(this.ZERO)) {
          trader.pendingSellQty = this.ZERO;
        }
      }
    }

    this.logger.logOrderCancelled(orderId);

    return {
      orderId,
      status: "CANCELLED",
      trades: [],
      filledQty: removedOrder.originalQty.minus(removedOrder.qty),
      remainingQty: removedOrder.qty,
      avgFillPrice: new Decimal(0),
      timestamp: new Date().toISOString(),
    };
  }

  getOpenOrders(ledger: CLOBLedger, traderId: string): LimitOrder[] {
    const trader = ledger.traders.get(traderId);
    if (!trader) {
      return [];
    }

    const orders: LimitOrder[] = [];
    const book = ledger.market.orderBook;

    for (const orderId of trader.openOrders) {
      // Search in bids
      for (const [, level] of book.bids) {
        for (const order of level.orders) {
          if (order.orderId === orderId) {
            orders.push(order);
            break;
          }
        }
      }
      // Search in asks
      for (const [, level] of book.asks) {
        for (const order of level.orders) {
          if (order.orderId === orderId) {
            orders.push(order);
            break;
          }
        }
      }
    }

    return orders;
  }

  // -------------------------------------------------------------------------
  // Settlement
  // -------------------------------------------------------------------------

  /**
   * Settle the market to an outcome (YES or NO).
   *
   * Settlement mechanics:
   * - YES outcome: Each YES share pays $1, NO shares pay $0
   * - NO outcome: Each YES share pays $0 ( traders who held only cash or sold keep their cash)
   *
   * The profit/loss is calculated as:
   * - For YES wins: (finalCash + yesShares) - initialCash
   * - For NO wins: finalCash - initialCash (YES shares become worthless)
   */
  settle(ledger: CLOBLedger, outcome: Outcome): SettlementResult {
    if (ledger.market.settled) {
      throw new Error("Market already settled");
    }

    const timestamp = new Date().toISOString();
    const traderPayouts = new Map<string, TraderPayout>();

    let totalPayout = new Decimal(0);
    let initialTotalCash = new Decimal(0);

    // Process each trader's settlement
    for (const [traderId, trader] of ledger.traders) {
      // Record initial state
      const initialCash = trader.cash;
      const initialYesShares = trader.yesShares;
      initialTotalCash = initialTotalCash.plus(initialCash);

      let payoutReceived = new Decimal(0);

      if (outcome === "YES") {
        // YES wins: each YES share pays $1
        payoutReceived = trader.yesShares;
        trader.cash = trader.cash.plus(trader.yesShares);
        totalPayout = totalPayout.plus(trader.yesShares);
      } // If NO wins, YES shares pay $0 - nothing to do

      // Shares are "consumed" in settlement
      trader.yesShares = new Decimal(0);
      trader.pendingSellQty = new Decimal(0);

      // Clear all open orders
      trader.openOrders.clear();

      const finalCash = trader.cash;
      const finalYesShares = new Decimal(0);
      const netProfit = finalCash.minus(initialCash);

      traderPayouts.set(traderId, {
        traderId,
        initialCash,
        initialYesShares,
        finalCash,
        finalYesShares,
        payoutReceived,
        netProfit,
      });
    }

    // Clear the order book
    ledger.market.orderBook.bids.clear();
    ledger.market.orderBook.asks.clear();
    ledger.market.orderBook.bestBid = undefined;
    ledger.market.orderBook.bestAsk = undefined;

    // Mark market as settled
    ledger.market.settled = true;
    ledger.market.outcome = outcome;

    // Calculate total collected (cash that left traders via trades, not including initial cash)
    // This is essentially: initial total cash across all traders - final total cash
    const finalTotalCash = Array.from(ledger.traders.values())
      .reduce((sum, t) => sum.plus(t.cash), new Decimal(0));

    // Total collected is the "fees" or "slippage" that the market maker/operator retained
    const totalCollected = initialTotalCash.minus(finalTotalCash).plus(totalPayout);

    // Operator P&L: If YES won, operator pays out totalPayout, keeps totalCollected
    // Profit/loss from operator perspective
    const profitLoss = totalCollected.minus(totalPayout);

    const result: SettlementResult = {
      outcome,
      totalPayout,
      totalCollected,
      profitLoss,
      traderPayouts,
      timestamp,
    };

    this.logger.logSettlement(result);

    return result;
  }

  /**
   * Get settlement preview without actually settling
   * Shows what each trader would receive for each outcome
   */
  getSettlementPreview(ledger: CLOBLedger): Map<Outcome, Map<string, TraderPayout>> {
    const preview = new Map<Outcome, Map<string, TraderPayout>>();

    for (const outcome of ["YES", "NO"] as Outcome[]) {
      const traderResults = new Map<string, TraderPayout>();

      for (const [traderId, trader] of ledger.traders) {
        const initialCash = trader.cash;
        const initialYesShares = trader.yesShares;

        let payoutReceived = new Decimal(0);
        let finalCash: Decimal;
        let netProfit: Decimal;

        if (outcome === "YES") {
          payoutReceived = trader.yesShares;
          finalCash = trader.cash.plus(trader.yesShares);
        } else {
          payoutReceived = new Decimal(0);
          finalCash = trader.cash; // YES shares worthless
        }

        netProfit = finalCash.minus(initialCash);

        traderResults.set(traderId, {
          traderId,
          initialCash,
          initialYesShares,
          finalCash,
          finalYesShares: new Decimal(0),
          payoutReceived,
          netProfit,
        });
      }

      preview.set(outcome, traderResults);
    }

    return preview;
  }

  // -------------------------------------------------------------------------
  // Private Matching Engine
  // -------------------------------------------------------------------------

  private _matchLimitBuy(ledger: CLOBLedger, order: LimitOrder, incomingTraderId: string): OrderResult {
    const book = ledger.market.orderBook;
    const trades: Trade[] = [];
    let remainingQty = order.qty;
    let totalFillPrice = new Decimal(0);
    let filledQty = new Decimal(0);
    const trader = ledger.traders.get(incomingTraderId)!;

    // Check if order is marketable (crosses the spread)
    const bestAsk = this.getBestAsk(book);
    if (bestAsk && order.price.gte(bestAsk)) {
      const crossResult = this._crossSpread(ledger, "BUY", remainingQty, incomingTraderId, order.price);
      trades.push(...crossResult.trades);

      for (const t of trades) {
        filledQty = filledQty.plus(t.qty);
        totalFillPrice = totalFillPrice.plus(t.price.times(t.qty));
      }

      remainingQty = crossResult.remainingQty;
    }

    // Determine final status
    let status: OrderStatus;
    if (remainingQty.eq(0)) {
      status = "FILLED";
    } else if (filledQty.gt(0)) {
      status = "PARTIALLY_FILLED";
    } else {
      status = "OPEN";
    }

    // If any quantity remains, add to book
    if (remainingQty.gt(0)) {
      const restingOrder: LimitOrder = {
        ...order,
        qty: remainingQty,
        status,
      };
      this._addToBook(book, restingOrder);
      trader.openOrders.add(order.orderId);
    }

    const avgFillPrice = filledQty.gt(0) ? totalFillPrice.div(filledQty) : new Decimal(0);

    return {
      orderId: order.orderId,
      status,
      trades,
      filledQty,
      remainingQty,
      avgFillPrice,
      timestamp: new Date().toISOString(),
    };
  }

  private _matchLimitSell(ledger: CLOBLedger, order: LimitOrder, incomingTraderId: string): OrderResult {
    const book = ledger.market.orderBook;
    const trades: Trade[] = [];
    let remainingQty = order.qty;
    let totalFillPrice = new Decimal(0);
    let filledQty = new Decimal(0);
    const trader = ledger.traders.get(incomingTraderId)!;

    // Check if order is marketable (crosses the spread)
    const bestBid = this.getBestBid(book);
    if (bestBid && order.price.lte(bestBid)) {
      const crossResult = this._crossSpread(ledger, "SELL", remainingQty, incomingTraderId, order.price);
      trades.push(...crossResult.trades);

      for (const t of trades) {
        filledQty = filledQty.plus(t.qty);
        totalFillPrice = totalFillPrice.plus(t.price.times(t.qty));
      }

      remainingQty = crossResult.remainingQty;
    }

    // Determine final status
    let status: OrderStatus;
    if (remainingQty.eq(0)) {
      status = "FILLED";
    } else if (filledQty.gt(0)) {
      status = "PARTIALLY_FILLED";
    } else {
      status = "OPEN";
    }

    // If any quantity remains, add to book
    if (remainingQty.gt(0)) {
      const restingOrder: LimitOrder = {
        ...order,
        qty: remainingQty,
        status,
      };
      this._addToBook(book, restingOrder);
      trader.openOrders.add(order.orderId);

      // Track pending sell qty
      trader.pendingSellQty = trader.pendingSellQty.plus(remainingQty);
    }

    const avgFillPrice = filledQty.gt(0) ? totalFillPrice.div(filledQty) : new Decimal(0);

    return {
      orderId: order.orderId,
      status,
      trades,
      filledQty,
      remainingQty,
      avgFillPrice,
      timestamp: new Date().toISOString(),
    };
  }

  private _matchMarketBuy(ledger: CLOBLedger, qty: Decimal, incomingTraderId: string): OrderResult {
    const book = ledger.market.orderBook;
    const trades: Trade[] = [];
    let remainingQty = qty;
    let totalFillPrice = new Decimal(0);
    let filledQty = new Decimal(0);

    // Check if there are any asks
    if (book.bestAsk) {
      // For market buy, use unlimited price
      const crossResult = this._crossSpread(ledger, "BUY", remainingQty, incomingTraderId, this.ONE);
      trades.push(...crossResult.trades);

      for (const t of trades) {
        filledQty = filledQty.plus(t.qty);
        totalFillPrice = totalFillPrice.plus(t.price.times(t.qty));
      }

      remainingQty = crossResult.remainingQty;
    }

    const status = remainingQty.eq(0) ? "FILLED" : "PARTIALLY_FILLED";
    const avgFillPrice = filledQty.gt(0) ? totalFillPrice.div(filledQty) : new Decimal(0);

    const orderId = `MKT-${Date.now()}`;

    return {
      orderId,
      status,
      trades,
      filledQty,
      remainingQty,
      avgFillPrice,
      timestamp: new Date().toISOString(),
    };
  }

  private _matchMarketSell(ledger: CLOBLedger, qty: Decimal, incomingTraderId: string): OrderResult {
    const book = ledger.market.orderBook;
    const trades: Trade[] = [];
    let remainingQty = qty;
    let totalFillPrice = new Decimal(0);
    let filledQty = new Decimal(0);

    // Check if there are any bids
    if (book.bestBid) {
      // For market sell, use $0 minimum price
      const crossResult = this._crossSpread(ledger, "SELL", remainingQty, incomingTraderId, this.ZERO);
      trades.push(...crossResult.trades);

      for (const t of trades) {
        filledQty = filledQty.plus(t.qty);
        totalFillPrice = totalFillPrice.plus(t.price.times(t.qty));
      }

      remainingQty = crossResult.remainingQty;
    }

    const status = remainingQty.eq(0) ? "FILLED" : "PARTIALLY_FILLED";
    const avgFillPrice = filledQty.gt(0) ? totalFillPrice.div(filledQty) : new Decimal(0);

    const orderId = `MKT-${Date.now()}`;

    return {
      orderId,
      status,
      trades,
      filledQty,
      remainingQty,
      avgFillPrice,
      timestamp: new Date().toISOString(),
    };
  }

  private _crossSpread(
    ledger: CLOBLedger,
    side: Side,
    qty: Decimal,
    incomingTraderId: string,
    limitPrice: Decimal
  ): { trades: Trade[]; remainingQty: Decimal } {
    const trades: Trade[] = [];
    let remainingQty = qty;

    if (side === "BUY") {
      let askLevel = ledger.market.orderBook.bestAsk;
      while (askLevel && remainingQty.gt(0) && askLevel.price.lte(limitPrice)) {
        let takenFromLevel = new Decimal(0);

        for (const askOrder of askLevel.orders) {
          if (remainingQty.lte(0)) break;

          const qtyToTakeFromOrder = Decimal.min(remainingQty, askOrder.qty);
          if (qtyToTakeFromOrder.gt(0)) {
            const trade = this._createTrade(ledger, askOrder, qtyToTakeFromOrder, askLevel.price, incomingTraderId, "BUY");
            trades.push(trade);
            this.logger.logTrade(trade);

            // Update ask order (seller)
            askOrder.qty = askOrder.qty.minus(qtyToTakeFromOrder);
            if (askOrder.qty.eq(0)) {
              askOrder.status = "FILLED";
              const askTrader = ledger.traders.get(askOrder.traderId);
              if (askTrader) {
                askTrader.openOrders.delete(askOrder.orderId);
                // Reduce pending sell qty
                askTrader.pendingSellQty = askTrader.pendingSellQty.minus(qtyToTakeFromOrder);
                if (askTrader.pendingSellQty.lt(this.ZERO)) {
                  askTrader.pendingSellQty = this.ZERO;
                }
              }
            } else {
              askOrder.status = "PARTIALLY_FILLED";
            }

            // Update seller's account
            const askTrader = ledger.traders.get(askOrder.traderId);
            if (askTrader) {
              askTrader.cash = askTrader.cash.plus(qtyToTakeFromOrder.times(askLevel.price));
              askTrader.yesShares = askTrader.yesShares.minus(qtyToTakeFromOrder);
            }

            // Update buyer's account
            const incomingTrader = ledger.traders.get(incomingTraderId);
            if (incomingTrader) {
              incomingTrader.yesShares = incomingTrader.yesShares.plus(qtyToTakeFromOrder);
              incomingTrader.cash = incomingTrader.cash.minus(qtyToTakeFromOrder.times(askLevel.price));
            }

            remainingQty = remainingQty.minus(qtyToTakeFromOrder);
            takenFromLevel = takenFromLevel.plus(qtyToTakeFromOrder);
          }
        }

        askLevel.totalQty = askLevel.totalQty.minus(takenFromLevel);
        askLevel.orders = askLevel.orders.filter(o => o.qty.gt(0));

        if (askLevel.totalQty.lte(0) || askLevel.orders.length === 0) {
          const priceKey = askLevel.price.toString();
          ledger.market.orderBook.asks.delete(priceKey);
          ledger.market.orderBook.bestAsk = askLevel.next;
          if (askLevel.next) {
            askLevel.next.prev = undefined;
          }
        }

        askLevel = ledger.market.orderBook.bestAsk;
      }
    } else {
      // SELL side - crossing against bids
      let bidLevel = ledger.market.orderBook.bestBid;
      while (bidLevel && remainingQty.gt(0) && bidLevel.price.gte(limitPrice)) {
        let takenFromLevel = new Decimal(0);

        for (const bidOrder of bidLevel.orders) {
          if (remainingQty.lte(0)) break;

          const qtyToTakeFromOrder = Decimal.min(remainingQty, bidOrder.qty);
          if (qtyToTakeFromOrder.gt(0)) {
            const trade = this._createTrade(ledger, bidOrder, qtyToTakeFromOrder, bidLevel.price, incomingTraderId, "SELL");
            trades.push(trade);
            this.logger.logTrade(trade);

            // Update bid order (buyer)
            bidOrder.qty = bidOrder.qty.minus(qtyToTakeFromOrder);
            if (bidOrder.qty.eq(0)) {
              bidOrder.status = "FILLED";
              const bidTrader = ledger.traders.get(bidOrder.traderId);
              if (bidTrader) {
                bidTrader.openOrders.delete(bidOrder.orderId);
              }
            } else {
              bidOrder.status = "PARTIALLY_FILLED";
            }

            // Update buyer's account
            const bidTrader = ledger.traders.get(bidOrder.traderId);
            if (bidTrader) {
              // Buyer gets cash back (since they're not receiving the shares)
              bidTrader.cash = bidTrader.cash.plus(qtyToTakeFromOrder.times(bidLevel.price));
              bidTrader.yesShares = bidTrader.yesShares.minus(qtyToTakeFromOrder);
            }

            // Update seller's account
            const incomingTrader = ledger.traders.get(incomingTraderId);
            if (incomingTrader) {
              incomingTrader.cash = incomingTrader.cash.plus(qtyToTakeFromOrder.times(bidLevel.price));
              incomingTrader.yesShares = incomingTrader.yesShares.minus(qtyToTakeFromOrder);
            }

            remainingQty = remainingQty.minus(qtyToTakeFromOrder);
            takenFromLevel = takenFromLevel.plus(qtyToTakeFromOrder);
          }
        }

        bidLevel.totalQty = bidLevel.totalQty.minus(takenFromLevel);
        bidLevel.orders = bidLevel.orders.filter(o => o.qty.gt(0));

        if (bidLevel.totalQty.lte(0) || bidLevel.orders.length === 0) {
          const priceKey = bidLevel.price.toString();
          ledger.market.orderBook.bids.delete(priceKey);
          ledger.market.orderBook.bestBid = bidLevel.next;
          if (bidLevel.next) {
            bidLevel.next.prev = undefined;
          }
        }

        bidLevel = ledger.market.orderBook.bestBid;
      }
    }

    if (trades.length > 0) {
      const lastTrade = trades[trades.length - 1];
      ledger.market.lastTradePrice = lastTrade.price;
    }

    return { trades, remainingQty };
  }

  private _createTrade(
    ledger: CLOBLedger,
    restingOrder: LimitOrder,
    qty: Decimal,
    price: Decimal,
    incomingTraderId: string,
    incomingSide: Side
  ): Trade {
    ledger.market.tradeIdCounter++;
    const tradeId = `TRD-${ledger.market.tradeIdCounter.toString().padStart(8, "0")}`;
    const timestamp = new Date().toISOString();

    if (incomingSide === "BUY") {
      return {
        tradeId,
        askOrderId: restingOrder.orderId,
        bidOrderId: incomingTraderId,
        price,
        qty,
        bidTraderId: incomingTraderId,
        askTraderId: restingOrder.traderId,
        timestamp,
      };
    } else {
      return {
        tradeId,
        askOrderId: incomingTraderId,
        bidOrderId: restingOrder.orderId,
        price,
        qty,
        bidTraderId: restingOrder.traderId,
        askTraderId: incomingTraderId,
        timestamp,
      };
    }
  }

  private _rejectOrder(orderId: string, reason: string): OrderResult {
    this.logger.logOrderRejected(orderId, reason);
    return {
      orderId,
      status: "REJECTED",
      trades: [],
      filledQty: new Decimal(0),
      remainingQty: new Decimal(0),
      avgFillPrice: new Decimal(0),
      timestamp: new Date().toISOString(),
      rejectionReason: reason,
    };
  }

  private _addToBook(book: OrderBook, order: LimitOrder): void {
    const levels = order.side === "BUY" ? book.bids : book.asks;
    const priceKey = order.price.toString();

    let level = levels.get(priceKey);
    if (!level) {
      level = {
        price: order.price,
        side: order.side,
        totalQty: new Decimal(0),
        orders: [],
      };
      levels.set(priceKey, level);
      this._insertLevelInOrder(book, level);
    }

    level.orders.push(order);
    level.totalQty = level.totalQty.plus(order.qty);
  }

  private _removeFromBook(book: OrderBook, orderId: string): LimitOrder | undefined {
    for (const [priceKey, level] of book.bids) {
      const orderIndex = level.orders.findIndex(o => o.orderId === orderId);
      if (orderIndex !== -1) {
        const order = level.orders[orderIndex];
        level.orders.splice(orderIndex, 1);
        level.totalQty = level.totalQty.minus(order.qty);

        if (level.orders.length === 0) {
          book.bids.delete(priceKey);
          this._updatePriceLevelPointers(book);
        }

        return order;
      }
    }

    for (const [priceKey, level] of book.asks) {
      const orderIndex = level.orders.findIndex(o => o.orderId === orderId);
      if (orderIndex !== -1) {
        const order = level.orders[orderIndex];
        level.orders.splice(orderIndex, 1);
        level.totalQty = level.totalQty.minus(order.qty);

        if (level.orders.length === 0) {
          book.asks.delete(priceKey);
          this._updatePriceLevelPointers(book);
        }

        return order;
      }
    }

    return undefined;
  }

  private _insertLevelInOrder(book: OrderBook, newLevel: PriceLevel): void {
    if (newLevel.side === "BUY") {
      let current = book.bestBid;
      let prev: PriceLevel | undefined;

      while (current && current.price.gt(newLevel.price)) {
        prev = current;
        current = current.next;
      }

      if (prev) {
        newLevel.next = prev.next;
        newLevel.prev = prev;
        prev.next = newLevel;
        if (newLevel.next) {
          newLevel.next.prev = newLevel;
        }
      } else {
        newLevel.next = book.bestBid;
        if (book.bestBid) {
          book.bestBid.prev = newLevel;
        }
        book.bestBid = newLevel;
      }
    } else {
      let current = book.bestAsk;
      let prev: PriceLevel | undefined;

      while (current && current.price.lt(newLevel.price)) {
        prev = current;
        current = current.next;
      }

      if (prev) {
        newLevel.next = prev.next;
        newLevel.prev = prev;
        prev.next = newLevel;
        if (newLevel.next) {
          newLevel.next.prev = newLevel;
        }
      } else {
        newLevel.next = book.bestAsk;
        if (book.bestAsk) {
          book.bestAsk.prev = newLevel;
        }
        book.bestAsk = newLevel;
      }
    }

    this._updatePriceLevelPointers(book);
  }

  private _updatePriceLevelPointers(book: OrderBook): void {
    if (book.bids.size > 0) {
      const bidPrices = Array.from(book.bids.keys()).map(p => new Decimal(p));
      bidPrices.sort((a, b) => b.minus(a).toNumber());
      const bestBidPrice = bidPrices[0].toString();
      book.bestBid = book.bids.get(bestBidPrice);
      this._rebuildLinkedList(book, "BUY");
    } else {
      book.bestBid = undefined;
    }

    if (book.asks.size > 0) {
      const askPrices = Array.from(book.asks.keys()).map(p => new Decimal(p));
      askPrices.sort((a, b) => a.minus(b).toNumber());
      const bestAskPrice = askPrices[0].toString();
      book.bestAsk = book.asks.get(bestAskPrice);
      this._rebuildLinkedList(book, "SELL");
    } else {
      book.bestAsk = undefined;
    }
  }

  private _rebuildLinkedList(book: OrderBook, side: Side): void {
    const levels = side === "BUY" ? book.bids : book.asks;

    if (side === "BUY") {
      const prices = Array.from(levels.keys()).map(p => new Decimal(p));
      prices.sort((a, b) => b.minus(a).toNumber());

      let prev: PriceLevel | undefined;
      for (const price of prices) {
        const level = levels.get(price.toString())!;
        level.prev = prev;
        level.next = undefined;
        if (prev) {
          prev.next = level;
        }
        prev = level;
      }
    } else {
      const prices = Array.from(levels.keys()).map(p => new Decimal(p));
      prices.sort((a, b) => a.minus(b).toNumber());

      let prev: PriceLevel | undefined;
      for (const price of prices) {
        const level = levels.get(price.toString())!;
        level.prev = prev;
        level.next = undefined;
        if (prev) {
          prev.next = level;
        }
        prev = level;
      }
    }
  }

  private _generateOrderId(market: CLOBMarketState): string {
    market.orderIdCounter++;
    return `ORD-${market.orderIdCounter.toString().padStart(8, "0")}`;
  }

  getLogger(): CLOBLogger {
    return this.logger;
  }
}

// Default export for convenience
export const clobPM = new CLOBEnginePM();
