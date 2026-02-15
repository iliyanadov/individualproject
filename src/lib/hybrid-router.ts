/**
 * Hybrid Router
 *
 * Routes orders between CLOB and LMSR based on market conditions:
 * - Use CLOB when there's sufficient liquidity (spread ≤ threshold AND depth ≥ threshold)
 * - Use LMSR otherwise (guaranteed execution)
 *
 * Logs routing decisions for analysis and debugging.
 */

import { Decimal } from "decimal.js";
import {
  UnifiedEngine,
  OrderIntent,
  ExecutionResult,
  MarketStateSnapshot,
  Side,
  EngineConfig,
} from "./engine-common";
import {
  CLOBEngineAdapter,
  createEngine,
} from "./engine-adapters";

/**
 * Routing decision
 */
export interface RoutingDecision {
  intentId: string;
  timestamp: number;
  engineUsed: "CLOB" | "LMSR";
  spread: Decimal | null;
  depth: Decimal | null;
  spreadThreshold: Decimal;
  depthThreshold: Decimal;
  reason: string;
}

/**
 * Hybrid engine configuration
 */
export interface HybridConfig extends EngineConfig {
  type: "HYBRID";
  /** CLOB engine config */
  clobConfig: EngineConfig;
  /** LMSR engine config */
  lmsrConfig: EngineConfig;
  /** Spread threshold for routing to CLOB */
  spreadThreshold: number;
  /** Depth threshold (number of ticks) for routing to CLOB */
  depthThreshold: number;
  /** Number of ticks to check for depth */
  depthTicks: number;
}

/**
 * Hybrid Router Engine
 *
 * Routes orders to CLOB or LMSR based on market conditions.
 * Implements UnifiedEngine interface for compatibility with simulation runner.
 */
export class HybridRouterEngine implements UnifiedEngine {
  readonly engineType = "HYBRID";
  readonly config: HybridConfig;

  private clobEngine: CLOBEngineAdapter;
  private lmsrEngine: ReturnType<typeof createEngine>;
  private logs: any[] = [];

  constructor(config: HybridConfig) {
    this.config = config;
    this.clobEngine = new CLOBEngineAdapter(config.clobConfig);
    this.lmsrEngine = createEngine("LMSR", config.lmsrConfig);
  }

  initialize(): void {
    this.clobEngine.initialize();
    this.lmsrEngine.initialize();
    this.logs = [];
  }

  addTrader(traderId: string, cash: number): void {
    this.clobEngine.addTrader(traderId, cash);
    this.lmsrEngine.addTrader(traderId, cash);
  }

  processOrder(intent: OrderIntent): ExecutionResult {
    const decision = this.makeRoutingDecision(intent);
    this.logRoutingDecision(decision);

    // Route to appropriate engine
    const engine = decision.engineUsed === "CLOB" ? this.clobEngine : this.lmsrEngine;
    const result = engine.processOrder(intent);

    // Add routing info to result
    return {
      ...result,
      engineType: `HYBRID-${decision.engineUsed}`,
    };
  }

  getMarketState(): MarketStateSnapshot {
    // Return combined state from both engines
    const clobState = this.clobEngine.getMarketState();
    const lmsrState = this.lmsrEngine.getMarketState();

    return {
      ...clobState,
      ...lmsrState,
    };
  }

  getTraderState(traderId: string) {
    const clobState = this.clobEngine.getTraderState(traderId);
    const lmsrState = this.lmsrEngine.getTraderState(traderId);

    // Prefer CLOB state (has open orders)
    return clobState ?? lmsrState ?? null;
  }

  getAllTraderStates() {
    const clobTraders = this.clobEngine.getAllTraderStates();
    const lmsrTraders = this.lmsrEngine.getAllTraderStates();

    // Merge trader states
    const merged = new Map();
    for (const [id, state] of clobTraders) {
      merged.set(id, state);
    }
    for (const [id, state] of lmsrTraders) {
      if (!merged.has(id)) {
        merged.set(id, state);
      } else {
        // Merge stats from LMSR
        const existing = merged.get(id)!;
        merged.set(id, {
          ...existing,
          totalTrades: existing.totalTrades + state.totalTrades,
          totalVolume: existing.totalVolume.plus(state.totalVolume),
          totalValue: existing.totalValue.plus(state.totalValue),
        });
      }
    }

    return merged;
  }

  reset(): void {
    this.initialize();
  }

  getMidPrice(): Decimal | null {
    // Prefer CLOB mid price
    return this.clobEngine.getMidPrice() ?? this.lmsrEngine.getMidPrice();
  }

  getBestBid(): Decimal | null {
    return this.clobEngine.getBestBid();
  }

  getBestAsk(): Decimal | null {
    return this.clobEngine.getBestAsk();
  }

  getSpread(): Decimal | null {
    return this.clobEngine.getSpread();
  }

  getDepth(side: Side, ticks: number): Decimal {
    return this.clobEngine.getDepth(side, ticks);
  }

  cancelOrder(orderId: string): ExecutionResult | null {
    // Try CLOB first (LMSR doesn't support cancel)
    return this.clobEngine.cancelOrder(orderId);
  }

  getLogs(): any[] {
    return this.logs;
  }

  clearLogs(): void {
    this.logs = [];
  }

  // -------------------------------------------------------------------------
  // Private Methods
  // -------------------------------------------------------------------------

  private makeRoutingDecision(intent: OrderIntent): RoutingDecision {
    const clobState = this.clobEngine.getMarketState();
    const spread = clobState.spread ?? new Decimal(Infinity);
    const spreadThreshold = new Decimal(this.config.spreadThreshold);

    // Calculate depth at configured ticks
    const side = intent.side === "BUY" ? "SELL" : "BUY"; // Opposite side
    const depth = this.clobEngine.getDepth(side, this.config.depthTicks);
    const depthThreshold = new Decimal(this.config.depthThreshold);

    const useClob = spread.lte(spreadThreshold) && depth.gte(depthThreshold);

    return {
      intentId: intent.intentId,
      timestamp: intent.timestamp,
      engineUsed: useClob ? "CLOB" : "LMSR",
      spread: spread,
      depth: depth,
      spreadThreshold,
      depthThreshold,
      reason: this.buildReason(useClob, spread, depth, spreadThreshold, depthThreshold),
    };
  }

  private buildReason(
    useClob: boolean,
    spread: Decimal,
    depth: Decimal,
    spreadThreshold: Decimal,
    depthThreshold: Decimal
  ): string {
    const parts: string[] = [];

    if (useClob) {
      parts.push("CLOB selected");
      if (spread.lte(spreadThreshold)) {
        parts.push(`spread ${spread.toFixed(4)} ≤ ${spreadThreshold.toFixed(4)}`);
      }
      if (depth.gte(depthThreshold)) {
        parts.push(`depth ${depth} ≥ ${depthThreshold}`);
      }
    } else {
      parts.push("LMSR selected");
      if (spread.gt(spreadThreshold)) {
        parts.push(`spread ${spread.toFixed(4)} > ${spreadThreshold.toFixed(4)}`);
      }
      if (depth.lt(depthThreshold)) {
        parts.push(`depth ${depth} < ${depthThreshold}`);
      }
    }

    return parts.join("; ");
  }

  private logRoutingDecision(decision: RoutingDecision): void {
    this.logs.push({
      type: "ROUTING_DECISION",
      timestamp: decision.timestamp,
      engineType: this.engineType,
      data: decision,
    });
  }

  /**
   * Get all routing decisions made
   */
  getRoutingDecisions(): RoutingDecision[] {
    return this.logs
      .filter((l: any) => l.type === "ROUTING_DECISION")
      .map((l: any) => l.data);
  }

  /**
   * Get routing statistics
   */
  getRoutingStats(): { clobCount: number; lmsrCount: number; clobRatio: Decimal } {
    const decisions = this.getRoutingDecisions();
    const clobCount = decisions.filter(d => d.engineUsed === "CLOB").length;
    const lmsrCount = decisions.filter(d => d.engineUsed === "LMSR").length;
    const total = clobCount + lmsrCount;
    const clobRatio = total > 0 ? new Decimal(clobCount).div(total) : new Decimal(0);

    return { clobCount, lmsrCount, clobRatio };
  }
}

// ============================================================================
// Export factory function
// ============================================================================

export function createHybridEngine(config: HybridConfig): HybridRouterEngine {
  return new HybridRouterEngine(config);
}

export function createHybridConfig(params: {
  spreadThreshold?: number;
  depthThreshold?: number;
  depthTicks?: number;
  b?: number;
  tickSize?: number;
}): HybridConfig {
  return {
    type: "HYBRID",
    spreadThreshold: params.spreadThreshold ?? 0.05,
    depthThreshold: params.depthThreshold ?? 10,
    depthTicks: params.depthTicks ?? 3,
    clobConfig: {
      type: "CLOB",
      tickSize: params.tickSize ?? 0.01,
    },
    lmsrConfig: {
      type: "LMSR",
      liquidity: params.b ?? 100,
    },
  };
}
