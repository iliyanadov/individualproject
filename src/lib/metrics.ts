/**
 * Metrics Module
 *
 * Defines and computes standard metrics for comparing order book mechanisms:
 * - Slippage: difference between expected/reference price and executed price
 * - Price impact: mid-price movement attributable to order interaction
 * - Fill ratio: executed volume / submitted volume
 * - Spread/depth time series (CLOB) and quoted price time series (LMSR)
 * - Realized LMSR loss: profit/loss from settlement
 */

import { Decimal } from "decimal.js";
import {
  ExecutionResult,
  OrderIntent,
  MarketStateSnapshot,
  FillInfo,
  Side,
  Outcome,
  calcMidPrice,
  calcSlippage,
  calcPriceImpact,
} from "./engine-common";

// ============================================================================
// Metric Types
// ============================================================================

/**
 * Individual order metrics
 */
export interface OrderMetrics {
  intentId: string;
  timestamp: number;
  traderId: string;
  side: Side;
  orderType: string;
  qty: Decimal;
  filledQty: Decimal;
  fillRatio: Decimal;
  avgFillPrice: Decimal;
  referencePrice: Decimal | null;
  slippage: Decimal | null;
  slippageBps: number | null;
  priceImpact: Decimal | null;
  priceImpactBps: number | null;
  numFills: number;
}

/**
 * Aggregated simulation metrics
 */
export interface AggregatedMetrics {
  // Order counts
  totalOrders: number;
  buyOrders: number;
  sellOrders: number;
  limitOrders: number;
  marketOrders: number;

  // Fill statistics
  filledOrders: number;
  partialFilledOrders: number;
  rejectedOrders: number;
  cancelledOrders: number;

  // Volume statistics
  totalSubmittedQty: Decimal;
  totalFilledQty: Decimal;
  totalSubmittedValue: Decimal;
  totalFilledValue: Decimal;
  fillRatio: Decimal;
  avgOrderSize: Decimal;
  avgFillSize: Decimal;

  // Slippage statistics
  avgSlippage: Decimal;
  avgBuySlippage: Decimal;
  avgSellSlippage: Decimal;
  stdSlippage: Decimal;
  maxSlippage: Decimal;
  minSlippage: Decimal;
  worstBuySlippage: Decimal;
  worstSellSlippage: Decimal;
  bestBuySlippage: Decimal;
  bestSellSlippage: Decimal;

  // Price impact statistics
  avgPriceImpact: Decimal;
  avgBuyPriceImpact: Decimal;
  avgSellPriceImpact: Decimal;
  stdPriceImpact: Decimal;
  maxPriceImpact: Decimal;
  totalPriceImpact: Decimal;

  // Time series data (for charts)
  midPriceSeries: { timestamp: number; value: Decimal }[];
  spreadSeries: { timestamp: number; value: Decimal }[];
  bidDepthSeries: { timestamp: number; value: Decimal }[];
  askDepthSeries: { timestamp: number; value: Decimal }[];
  priceYesSeries: { timestamp: number; value: Decimal }[];
  priceNoSeries: { timestamp: number; value: Decimal }[];

  // Per-trader statistics
  volumePerTrader: Map<string, Decimal>;
  tradesPerTrader: Map<string, number>;
  slippagePerTrader: Map<string, Decimal>;

  // Final state
  finalMidPrice?: Decimal;
  finalSpread?: Decimal;
  finalYesPrice?: Decimal;
  finalNoPrice?: Decimal;

  // Price movement
  priceMovement?: Decimal;
}

// ============================================================================
// Metrics Calculator
// ============================================================================

export class MetricsCalculator {
  private midPriceSeries: { timestamp: number; value: Decimal }[] = [];
  private spreadSeries: { timestamp: number; value: Decimal }[] = [];
  private bidDepthSeries: { timestamp: number; value: Decimal }[] = [];
  private askDepthSeries: { timestamp: number; value: Decimal }[] = [];
  private priceYesSeries: { timestamp: number; value: Decimal }[] = [];
  private priceNoSeries: { timestamp: number; value: Decimal }[] = [];

  /**
   * Add a market state snapshot to time series
   */
  addSnapshot(snapshot: MarketStateSnapshot): void {
    const timestamp = snapshot.timestamp;

    if (snapshot.midPrice !== undefined) {
      this.midPriceSeries.push({ timestamp, value: snapshot.midPrice });
    }

    if (snapshot.spread !== undefined) {
      this.spreadSeries.push({ timestamp, value: snapshot.spread });
    }

    if (snapshot.bidDepth !== undefined) {
      this.bidDepthSeries.push({ timestamp, value: snapshot.bidDepth });
    }

    if (snapshot.askDepth !== undefined) {
      this.askDepthSeries.push({ timestamp, value: snapshot.askDepth });
    }

    if (snapshot.priceYes !== undefined) {
      this.priceYesSeries.push({ timestamp, value: snapshot.priceYes });
    }

    if (snapshot.priceNo !== undefined) {
      this.priceNoSeries.push({ timestamp, value: snapshot.priceNo });
    }
  }

  /**
   * Calculate metrics for a single order
   */
  calculateOrderMetrics(
    intent: OrderIntent,
    result: ExecutionResult,
    stateBefore: MarketStateSnapshot
  ): OrderMetrics {
    const qty = new Decimal(intent.qty ?? 0);
    const filledQty = result.filledQty;
    const fillRatio = qty.gt(0) ? filledQty.div(qty) : new Decimal(0);

    // Reference price is mid-price at submission time
    let referencePrice: Decimal | null = null;
    if (stateBefore.midPrice !== undefined) {
      referencePrice = stateBefore.midPrice;
    } else if (stateBefore.priceYes !== undefined) {
      // For LMSR, use YES price as reference (BUY) or NO price (SELL)
      referencePrice = intent.side === "BUY"
        ? stateBefore.priceYes ?? null
        : stateBefore.priceNo ?? null;
    }

    const avgFillPrice = result.avgFillPrice;

    // Calculate slippage
    let slippage: Decimal | null = null;
    let slippageBps: number | null = null;
    if (referencePrice !== null && avgFillPrice !== null) {
      slippage = calcSlippage(referencePrice, avgFillPrice, intent.side);
      slippageBps = slippage.div(referencePrice).times(10000).toNumber();
    }

    // Calculate price impact
    let priceImpact: Decimal | null = null;
    let priceImpactBps: number | null = null;
    const priceBefore = stateBefore.midPrice ?? stateBefore.priceYes;
    const priceAfter = result.marketState.midPrice ?? result.marketState.priceYes;

    if (priceBefore !== undefined && priceAfter !== undefined) {
      priceImpact = calcPriceImpact(priceBefore, priceAfter, intent.side);
      priceImpactBps = priceImpact.div(priceBefore).times(10000).toNumber();
    }

    return {
      intentId: intent.intentId,
      timestamp: intent.timestamp,
      traderId: intent.traderId,
      side: intent.side,
      orderType: intent.orderType,
      qty,
      filledQty,
      fillRatio,
      avgFillPrice,
      referencePrice,
      slippage,
      slippageBps,
      priceImpact,
      priceImpactBps,
      numFills: result.fills.length,
    };
  }

  /**
   * Calculate aggregated metrics from all results
   */
  calculateAggregatedMetrics(
    intents: OrderIntent[],
    results: ExecutionResult[],
    snapshots: MarketStateSnapshot[],
    orderMetrics: OrderMetrics[]
  ): AggregatedMetrics {
    // Order counts
    const totalOrders = intents.length;
    const buyOrders = intents.filter(i => i.side === "BUY").length;
    const sellOrders = intents.filter(i => i.side === "SELL").length;
    const limitOrders = intents.filter(i => i.orderType === "LIMIT").length;
    const marketOrders = intents.filter(i => i.orderType === "MARKET").length;

    // Fill statistics
    const filledOrders = results.filter(r => r.status === "FILLED").length;
    const partialFilledOrders = results.filter(r => r.status === "PARTIALLY_FILLED").length;
    const rejectedOrders = results.filter(r => r.status === "REJECTED").length;
    const cancelledOrders = results.filter(r => r.status === "CANCELLED").length;

    // Volume statistics
    let totalSubmittedQty = new Decimal(0);
    let totalFilledQty = new Decimal(0);
    let totalSubmittedValue = new Decimal(0);
    let totalFilledValue = new Decimal(0);

    for (let i = 0; i < intents.length; i++) {
      const qty = new Decimal(intents[i].qty ?? 0);
      totalSubmittedQty = totalSubmittedQty.plus(qty);
    }

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      totalFilledQty = totalFilledQty.plus(result.filledQty);
      totalFilledValue = totalFilledValue.plus(result.filledQty.times(result.avgFillPrice));
    }

    const fillRatio = totalSubmittedQty.gt(0)
      ? totalFilledQty.div(totalSubmittedQty)
      : new Decimal(0);

    const avgOrderSize = totalOrders > 0
      ? totalSubmittedQty.div(totalOrders)
      : new Decimal(0);

    const avgFillSize = totalOrders > 0
      ? totalFilledQty.div(totalOrders)
      : new Decimal(0);

    // Slippage statistics
    const slippages = orderMetrics
      .map(m => m.slippage)
      .filter((s): s is Decimal => s !== null);

    const avgSlippage = this.mean(slippages) ?? new Decimal(0);
    const buySlippages = orderMetrics
      .filter(m => m.side === "BUY")
      .map(m => m.slippage)
      .filter((s): s is Decimal => s !== null);
    const sellSlippages = orderMetrics
      .filter(m => m.side === "SELL")
      .map(m => m.slippage)
      .filter((s): s is Decimal => s !== null);

    const avgBuySlippage = this.mean(buySlippages) ?? new Decimal(0);
    const avgSellSlippage = this.mean(sellSlippages) ?? new Decimal(0);
    const stdSlippage = this.stdDev(slippages) ?? new Decimal(0);
    const maxSlippage = this.max(slippages) ?? new Decimal(0);
    const minSlippage = this.min(slippages) ?? new Decimal(0);

    // Best/worst slippage per side (for buyers, lower/negative is better)
    const buySlippagesOnly = buySlippages.filter((s): s is Decimal => s !== null);
    const sellSlippagesOnly = sellSlippages.filter((s): s is Decimal => s !== null);

    const worstBuySlippage = this.max(buySlippagesOnly) ?? new Decimal(0);
    const worstSellSlippage = this.max(sellSlippagesOnly) ?? new Decimal(0);
    const bestBuySlippage = this.min(buySlippagesOnly) ?? new Decimal(0);
    const bestSellSlippage = this.min(sellSlippagesOnly) ?? new Decimal(0);

    // Price impact statistics
    const priceImpacts = orderMetrics
      .map(m => m.priceImpact)
      .filter((p): p is Decimal => p !== null)
      .map(p => p.abs()); // Use absolute value for aggregation

    const avgPriceImpact = this.mean(priceImpacts) ?? new Decimal(0);
    const buyPriceImpacts = orderMetrics
      .filter(m => m.side === "BUY")
      .map(m => m.priceImpact)
      .filter((p): p is Decimal => p !== null)
      .map(p => p!.abs());
    const sellPriceImpacts = orderMetrics
      .filter(m => m.side === "SELL")
      .map(m => m.priceImpact)
      .filter((p): p is Decimal => p !== null)
      .map(p => p!.abs());

    const avgBuyPriceImpact = this.mean(buyPriceImpacts) ?? new Decimal(0);
    const avgSellPriceImpact = this.mean(sellPriceImpacts) ?? new Decimal(0);
    const stdPriceImpact = this.stdDev(priceImpacts) ?? new Decimal(0);
    const maxPriceImpact = this.max(priceImpacts) ?? new Decimal(0);
    const totalPriceImpact = priceImpacts.reduce((sum, p) => sum.plus(p), new Decimal(0));

    // Per-trader statistics
    const volumePerTrader = new Map<string, Decimal>();
    const tradesPerTrader = new Map<string, number>();
    const slippagePerTrader = new Map<string, Decimal>();

    for (const [traderId, qty] of Object.entries(
      this.groupByTrader(orderMetrics, "filledQty")
    )) {
      volumePerTrader.set(traderId, qty);
    }

    for (const [traderId, count] of Object.entries(
      this.groupByTrader(orderMetrics, "numFills")
    )) {
      tradesPerTrader.set(traderId, count as unknown as number);
    }

    for (const [traderId, slippages] of Object.entries(
      this.groupByTrader(orderMetrics, "slippage")
    )) {
      const traderSlippages = slippages.filter((s): s is Decimal => s !== null);
      const avg = this.mean(traderSlippages) ?? new Decimal(0);
      slippagePerTrader.set(traderId, avg);
    }

    // Final state
    const lastSnapshot = snapshots[snapshots.length - 1];
    const finalMidPrice = lastSnapshot?.midPrice;
    const finalSpread = lastSnapshot?.spread;
    const finalYesPrice = lastSnapshot?.priceYes;
    const finalNoPrice = lastSnapshot?.priceNo;
    const firstSnapshot = snapshots[0];
    const initialMidPrice = firstSnapshot?.midPrice;
    const initialYesPrice = firstSnapshot?.priceYes;

    const priceMovement = finalMidPrice && initialMidPrice
      ? finalMidPrice.minus(initialMidPrice)
      : finalYesPrice && initialYesPrice
      ? finalYesPrice.minus(initialYesPrice)
      : undefined;

    return {
      totalOrders,
      buyOrders,
      sellOrders,
      limitOrders,
      marketOrders,
      filledOrders,
      partialFilledOrders,
      rejectedOrders,
      cancelledOrders,
      totalSubmittedQty,
      totalFilledQty,
      totalSubmittedValue,
      totalFilledValue,
      fillRatio,
      avgOrderSize,
      avgFillSize,
      avgSlippage,
      avgBuySlippage,
      avgSellSlippage,
      stdSlippage,
      maxSlippage,
      minSlippage,
      worstBuySlippage,
      worstSellSlippage,
      bestBuySlippage,
      bestSellSlippage,
      avgPriceImpact,
      avgBuyPriceImpact,
      avgSellPriceImpact,
      stdPriceImpact,
      maxPriceImpact,
      totalPriceImpact,
      midPriceSeries: this.midPriceSeries,
      spreadSeries: this.spreadSeries,
      bidDepthSeries: this.bidDepthSeries,
      askDepthSeries: this.askDepthSeries,
      priceYesSeries: this.priceYesSeries,
      priceNoSeries: this.priceNoSeries,
      volumePerTrader,
      tradesPerTrader,
      slippagePerTrader,
      finalMidPrice,
      finalSpread,
      finalYesPrice,
      finalNoPrice,
      priceMovement,
    };
  }

  /**
   * Clear all time series data
   */
  clear(): void {
    this.midPriceSeries = [];
    this.spreadSeries = [];
    this.bidDepthSeries = [];
    this.askDepthSeries = [];
    this.priceYesSeries = [];
    this.priceNoSeries = [];
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private mean(values: (Decimal | null)[]): Decimal | null {
    const valid = values.filter((v): v is Decimal => v !== null);
    if (valid.length === 0) return null;
    const sum = valid.reduce((s, v) => s.plus(v), new Decimal(0));
    return sum.div(valid.length);
  }

  private stdDev(values: (Decimal | null)[]): Decimal | null {
    const valid = values.filter((v): v is Decimal => v !== null);
    if (valid.length < 2) return null;
    const avg = this.mean(valid)!;
    const variance = valid.reduce((sum, v) => {
      const diff = v.minus(avg);
      return sum.plus(diff.times(diff));
    }, new Decimal(0)).div(valid.length);
    return new Decimal(Math.sqrt(variance.toNumber()));
  }

  private min(values: (Decimal | null)[]): Decimal | null {
    const valid = values.filter((v): v is Decimal => v !== null);
    if (valid.length === 0) return null;
    return valid.reduce((min, v) => v.lt(min) ? v : min, valid[0]);
  }

  private max(values: (Decimal | null)[]): Decimal | null {
    const valid = values.filter((v): v is Decimal => v !== null);
    if (valid.length === 0) return null;
    return valid.reduce((max, v) => v.gt(max) ? v : max, valid[0]);
  }

  private groupByTrader<T extends keyof OrderMetrics>(
    metrics: OrderMetrics[],
    key: T
  ): Record<string, OrderMetrics[T][]> {
    const result: Record<string, OrderMetrics[T][]> = {};
    for (const m of metrics) {
      const traderId = m.traderId;
      if (!result[traderId]) {
        result[traderId] = [];
      }
      result[traderId].push(m[key]);
    }
    return result;
  }
}

// ============================================================================
// LMSR-Specific Metrics
// ============================================================================

/**
 * Realized LMSR loss/profit calculation
 * Based on settlement outcome and trader positions
 */
export interface LMSRSettlementMetrics {
  outcome: Outcome;
  totalPayout: Decimal;
  totalCollected: Decimal;
  profitLoss: Decimal;
  worstCaseLoss: Decimal;
  profitLossRatio: Decimal;
}

export function calculateLMSRSettlementMetrics(
  qYes: Decimal,
  qNo: Decimal,
  totalCollected: Decimal,
  b: Decimal,
  outcome: Outcome
): LMSRSettlementMetrics {
  const totalPayout = outcome === "YES" ? qYes : qNo;
  const profitLoss = totalCollected.minus(totalPayout);
  const worstCaseLoss = b.times(Math.LN2);
  const profitLossRatio = worstCaseLoss.gt(0)
    ? profitLoss.div(worstCaseLoss)
    : new Decimal(0);

  return {
    outcome,
    totalPayout,
    totalCollected,
    profitLoss,
    worstCaseLoss,
    profitLossRatio,
  };
}
