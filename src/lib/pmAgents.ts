/**
 * Prediction Market Trading Agents
 *
 * Implements realistic trading behaviors for prediction markets:
 * - Noise Traders: Random uninformed trades (retail noise)
 * - Informed Traders: React to latent probability (insiders/analysts)
 * - Liquidity Providers: Passive market makers (provide bid/ask spread)
 *
 * Each agent type has distinct order flow characteristics that mirror
 * real prediction market dynamics on platforms like Polymarket, Metaculus, etc.
 */

import { Decimal } from "decimal.js";
import { SeededRNG, ScenarioConfig } from "./simulation";
import { OrderIntent, Outcome, Side, OrderType } from "./engine-common";

// ============================================================================
// Agent Configuration
// ============================================================================

/**
 * Agent behavior types
 */
export type AgentType =
  | "NOISE_TRADER"      // Random uninformed trades
  | "INFORMED_TRADER"   // Reacts to latent probability
  | "LIQUIDITY_PROVIDER"; // Passive market maker

/**
 * Individual agent configuration
 */
export interface AgentConfig {
  /** Agent type */
  type: AgentType;
  /** Agent ID (e.g., "trader-1") */
  agentId: string;
  /** Initial cash balance */
  initialCash: number;
  /** Initial YES shares (for bootstrapping LPs) */
  initialYesShares?: number;

  // Noise Trader Parameters
  /** Probability of placing an order when polled */
  noiseOrderProbability?: number;
  /** Order size range (min, max) */
  noiseOrderSizeRange?: [number, number];
  /** Bias towards YES or NO (-1 to 1) */
  noiseBias?: number; // -1 = always NO, 0 = neutral, 1 = always YES

  // Informed Trader Parameters
  /** How accurately they perceive the true probability (0-1) */
  informedAccuracy?: number; // 1 = perfect, 0 = random
  /** Confidence level affecting trade size (0-1) */
  informedConfidence?: number;
  /** Base order size multiplier */
  informedBaseSize?: number;

  // Liquidity Provider Parameters
  /** Number of price levels to quote */
  lpNumLevels?: number;
  /** Spread around fair price (e.g., 0.02 = 2%) */
  lpSpread?: number;
  /** Size per level */
  lpLevelSize?: number;
  /** How often to refresh quotes (orders) */
  lpRefreshRate?: number; // Probability of refreshing when polled
}

/**
 * PM Agent Scenario Configuration
 */
export interface PMAgentScenarioConfig {
  /** Base scenario config */
  base: ScenarioConfig;
  /** Agent configurations */
  agents: AgentConfig[];
  /** Latent (true) probability for the event */
  latentProbability: number; // 0-1, where 0 = definitely NO, 1 = definitely YES
  /** Probability drift per step (for time-varying latent probability) */
  probabilityDrift?: number;
  /** Probability of probability jump (shock) */
  probabilityJumpProbability?: number;
  /** Maximum jump size */
  probabilityJumpMax?: number;
}

// ============================================================================
// Agent State
// ============================================================================

/**
 * Runtime state for an agent
 */
export interface AgentState {
  config: AgentConfig;
  /** Current cash */
  cash: Decimal;
  /** Current YES shares */
  yesShares: Decimal;
  /** Current perception of probability (informed traders) */
  perceivedProbability: number;
  /** Last quote refresh time (LPs) */
  lastQuoteRefresh: number;
}

// ============================================================================
// PM Agent Order Generator
// ============================================================================

export class PMAgentOrderGenerator {
  private rng: SeededRNG;
  private config: PMAgentScenarioConfig;
  private agentStates: Map<string, AgentState>;
  private intentCounter: number = 0;
  private currentLatentProbability: number;

  constructor(config: PMAgentScenarioConfig) {
    this.config = config;
    this.rng = new SeededRNG(config.base.seed);
    this.currentLatentProbability = config.latentProbability;
    this.agentStates = new Map();

    // Initialize agent states
    for (const agentConfig of config.agents) {
      this.agentStates.set(agentConfig.agentId, {
        config: agentConfig,
        cash: new Decimal(agentConfig.initialCash),
        yesShares: new Decimal(agentConfig.initialYesShares ?? 0),
        perceivedProbability: this.initializePerceivedProbability(agentConfig),
        lastQuoteRefresh: 0,
      });
    }
  }

  private initializePerceivedProbability(agentConfig: AgentConfig): number {
    const accuracy = agentConfig.informedAccuracy ?? 0.5;
    const noise = (1 - accuracy) * (this.rng.random() * 2 - 1);
    return Math.max(0.01, Math.min(0.99, this.config.latentProbability + noise));
  }

  /**
   * Generate all order intents for the scenario
   */
  generate(): OrderIntent[] {
    const orders: OrderIntent[] = [];
    const numOrders = this.config.base.numOrders;
    const timeWindow = this.config.base.timeWindow;
    const arrivalRate = this.config.base.baseArrivalRate;

    let currentTime = 0;

    for (let i = 0; i < numOrders; i++) {
      // Update latent probability (with possible jumps)
      this.updateLatentProbability();

      // Select a random agent
      const agentId = this.selectRandomAgent();
      const agentState = this.agentStates.get(agentId)!;

      // Generate order(s) based on agent type
      const agentOrders = this.generateAgentOrders(agentState, currentTime);
      orders.push(...agentOrders);

      // Next order time with Poisson-like arrival
      currentTime += Math.floor(this.rng.randomExp(arrivalRate) * 1000);
      if (currentTime >= timeWindow) break;
    }

    return orders;
  }

  /**
   * Update the latent probability (with drift and occasional jumps)
   */
  private updateLatentProbability(): void {
    const drift = this.config.probabilityDrift ?? 0;
    const jumpProb = this.config.probabilityJumpProbability ?? 0.01;
    const jumpMax = this.config.probabilityJumpMax ?? 0.1;

    // Apply small drift
    if (drift > 0) {
      const driftAmount = (this.rng.random() * 2 - 1) * drift;
      this.currentLatentProbability += driftAmount;
    }

    // Apply occasional jumps
    if (this.rng.random() < jumpProb) {
      const jumpAmount = (this.rng.random() * 2 - 1) * jumpMax;
      this.currentLatentProbability += jumpAmount;
    }

    // Keep in valid range
    this.currentLatentProbability = Math.max(0.01, Math.min(0.99, this.currentLatentProbability));

    // Update informed traders' perceptions
    for (const [agentId, state] of this.agentStates) {
      if (state.config.type === "INFORMED_TRADER") {
        this.updateInformedPerception(state);
      }
    }
  }

  /**
   * Update an informed trader's perception of probability
   */
  private updateInformedPerception(state: AgentState): void {
    const accuracy = state.config.informedAccuracy ?? 0.7;
    const noiseStd = (1 - accuracy) * 0.2; // Standard deviation of noise
    const noise = this.rng.randomNormal(0, noiseStd);

    state.perceivedProbability = this.currentLatentProbability + noise;
    state.perceivedProbability = Math.max(0.01, Math.min(0.99, state.perceivedProbability));
  }

  /**
   * Select a random agent (weighted by their order probability)
   */
  private selectRandomAgent(): string {
    const agentIds = Array.from(this.agentStates.keys());

    // Weight by order probability (if defined)
    const weights = agentIds.map(id => {
      const state = this.agentStates.get(id)!;
      if (state.config.noiseOrderProbability !== undefined) {
        return state.config.noiseOrderProbability;
      }
      return 1.0;
    });

    // Weighted random selection
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    let random = this.rng.random() * totalWeight;

    for (let i = 0; i < agentIds.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return agentIds[i];
      }
    }

    return agentIds[agentIds.length - 1];
  }

  /**
   * Generate orders for a specific agent based on their type
   */
  private generateAgentOrders(state: AgentState, currentTime: number): OrderIntent[] {
    switch (state.config.type) {
      case "NOISE_TRADER":
        return this.generateNoiseTraderOrders(state, currentTime);
      case "INFORMED_TRADER":
        return this.generateInformedTraderOrders(state, currentTime);
      case "LIQUIDITY_PROVIDER":
        return this.generateLiquidityProviderOrders(state, currentTime);
      default:
        return [];
    }
  }

  // ==========================================================================
  // Noise Trader Behavior
  // ==========================================================================

  private generateNoiseTraderOrders(state: AgentState, currentTime: number): OrderIntent[] {
    const orderProb = state.config.noiseOrderProbability ?? 0.3;
    if (this.rng.random() > orderProb) {
      return [];
    }

    const [minSize, maxSize] = state.config.noiseOrderSizeRange ?? [1, 10];
    const bias = state.config.noiseBias ?? 0;

    // Determine side based on bias
    let side: Side;
    const randomBias = this.rng.random() * 2 - 1; // -1 to 1
    if (randomBias + bias > 0) {
      side = "BUY"; // Bias towards YES
    } else {
      side = "SELL"; // Bias towards NO
    }

    // Check if trader can sell
    if (side === "SELL" && state.yesShares.lte(0)) {
      side = "BUY"; // Flip to buy if no shares to sell
    }

    const qty = this.rng.randomFloat(minSize, maxSize);

    // Mostly market orders (noise traders are impatient)
    const orderType = this.rng.randomChoice<OrderType>(["MARKET", "MARKET", "LIMIT", "LIMIT"]);

    let price: number | undefined;
    if (orderType === "LIMIT") {
      // Random price around current midpoint
      const midPrice = 0.5; // Could use current market price
      const spread = 0.05;
      if (side === "BUY") {
        price = this.rng.randomFloat(midPrice - spread, midPrice);
      } else {
        price = this.rng.randomFloat(midPrice, midPrice + spread);
      }
      price = Math.max(0.01, Math.min(0.99, price));
    }

    return [this.createIntent(state.config.agentId, side, orderType, price, qty, currentTime)];
  }

  // ==========================================================================
  // Informed Trader Behavior
  // ==========================================================================

  private generateInformedTraderOrders(state: AgentState, currentTime: number): OrderIntent[] {
    const perceivedProb = state.perceivedProbability;
    const confidence = state.config.informedConfidence ?? 0.7;
    const baseSize = state.config.informedBaseSize ?? 10;

    // Decision threshold: only trade if confident enough
    const edge = Math.abs(perceivedProb - 0.5);
    if (edge < (1 - confidence) * 0.5) {
      return []; // Not confident enough to trade
    }

    // Determine side based on perceived probability
    let side: Side;
    if (perceivedProb > 0.5) {
      side = "BUY"; // Think YES is undervalued
    } else {
      side = "SELL"; // Think NO is undervalued (or YES overvalued)
    }

    // Check if can sell
    if (side === "SELL" && state.yesShares.lte(0)) {
      return [];
    }

    // Trade size proportional to edge and confidence
    const edgeMultiplier = edge * 2; // 0 to 1
    const qty = baseSize * (1 + edgeMultiplier * confidence) * this.rng.randomFloat(0.8, 1.2);

    // Informed traders use limit orders (want better prices)
    const orderType: OrderType = "LIMIT";

    // Set limit price based on perceived value
    let price: number;
    const midPrice = 0.5;

    if (side === "BUY") {
      // Willing to pay up to perceived probability, but want discount
      price = Math.min(perceivedProb * 0.98, midPrice - 0.01);
    } else {
      // Willing to sell at perceived probability, but want premium
      price = Math.max(perceivedProb * 1.02, midPrice + 0.01);
    }

    price = Math.max(0.01, Math.min(0.99, price));

    return [this.createIntent(state.config.agentId, side, orderType, price, qty, currentTime)];
  }

  // ==========================================================================
  // Liquidity Provider Behavior
  // ==========================================================================

  private generateLiquidityProviderOrders(state: AgentState, currentTime: number): OrderIntent[] {
    const refreshRate = state.config.lpRefreshRate ?? 0.1;

    // Only refresh quotes occasionally
    if (this.rng.random() > refreshRate) {
      return [];
    }

    state.lastQuoteRefresh = currentTime;

    const numLevels = state.config.lpNumLevels ?? 3;
    const spread = state.config.lpSpread ?? 0.04; // Total spread
    const levelSize = state.config.lpLevelSize ?? 20;

    const orders: OrderIntent[] = [];
    const midPrice = 0.5; // Could use current market price

    // Generate bid (buy) levels
    for (let i = 0; i < numLevels; i++) {
      const price = midPrice - (spread / 2) - (i * 0.01);
      if (price > 0.01) {
        orders.push(this.createIntent(
          state.config.agentId,
          "BUY",
          "LIMIT",
          price,
          levelSize,
          currentTime
        ));
      }
    }

    // Generate ask (sell) levels - check if LP has shares
    const hasShares = state.yesShares.gt(0);
    if (hasShares) {
      const availableShares = state.yesShares.toNumber();
      const totalAskSize = Math.min(levelSize * numLevels, availableShares);
      const sizePerLevel = totalAskSize / numLevels;

      for (let i = 0; i < numLevels; i++) {
        const price = midPrice + (spread / 2) + (i * 0.01);
        if (price < 0.99) {
          orders.push(this.createIntent(
            state.config.agentId,
            "SELL",
            "LIMIT",
            price,
            sizePerLevel,
            currentTime
          ));
        }
      }
    }

    return orders;
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private createIntent(
    traderId: string,
    side: Side,
    orderType: OrderType,
    price: number | undefined,
    qty: number,
    timestamp: number
  ): OrderIntent {
    this.intentCounter++;
    return {
      intentId: `intent-${this.intentCounter.toString().padStart(8, "0")}`,
      traderId,
      outcome: "YES", // PM agents trade YES shares
      side,
      orderType,
      price,
      qty,
      timestamp,
    };
  }

  /**
   * Get current agent states (for external inspection)
   */
  getAgentStates(): Map<string, AgentState> {
    return new Map(this.agentStates);
  }

  /**
   * Get current latent probability
   */
  getCurrentLatentProbability(): number {
    return this.currentLatentProbability;
  }
}

// ============================================================================
// Factory Functions for Common Scenarios
// ============================================================================

/**
 * Create a balanced market with mixed agent types
 */
export function createBalancedPMScenario(
  seed: number,
  numNoiseTraders: number = 10,
  numInformedTraders: number = 3,
  numLPs: number = 2,
  latentProbability: number = 0.5
): PMAgentScenarioConfig {
  const agents: AgentConfig[] = [];

  // Noise traders
  for (let i = 0; i < numNoiseTraders; i++) {
    agents.push({
      type: "NOISE_TRADER",
      agentId: `noise-${i + 1}`,
      initialCash: 10000,
      noiseOrderProbability: 0.2 + Math.random() * 0.3,
      noiseOrderSizeRange: [1, 20],
      noiseBias: (Math.random() * 2 - 1) * 0.3, // Slight bias
    });
  }

  // Informed traders
  for (let i = 0; i < numInformedTraders; i++) {
    agents.push({
      type: "INFORMED_TRADER",
      agentId: `informed-${i + 1}`,
      initialCash: 15000,
      informedAccuracy: 0.6 + Math.random() * 0.3, // 0.6-0.9 accuracy
      informedConfidence: 0.5 + Math.random() * 0.4, // 0.5-0.9 confidence
      informedBaseSize: 15 + Math.random() * 35, // 15-50 base size
    });
  }

  // Liquidity providers (bootstrapped with shares)
  for (let i = 0; i < numLPs; i++) {
    agents.push({
      type: "LIQUIDITY_PROVIDER",
      agentId: `lp-${i + 1}`,
      initialCash: 50000,
      initialYesShares: 500, // Bootstrap with shares to sell
      lpNumLevels: 3 + Math.floor(Math.random() * 3), // 3-5 levels
      lpSpread: 0.02 + Math.random() * 0.04, // 2-6% spread
      lpLevelSize: 50 + Math.random() * 100, // 50-150 per level
      lpRefreshRate: 0.05 + Math.random() * 0.1, // 5-15% refresh rate
    });
  }

  return {
    base: {
      type: "CUSTOM",
      seed,
      numTraders: agents.length,
      initialCash: 10000,
      numOrders: 1000,
      timeWindow: 60000, // 1 minute
      baseArrivalRate: 10, // 10 orders/sec average
    },
    agents,
    latentProbability,
    probabilityDrift: 0.001,
    probabilityJumpProbability: 0.02,
    probabilityJumpMax: 0.05,
  };
}

/**
 * Create a scenario with predominantly noise traders (retail-heavy)
 */
export function createRetailHeavyPMScenario(
  seed: number,
  numRetailTraders: number = 20,
  latentProbability: number = 0.5
): PMAgentScenarioConfig {
  const agents: AgentConfig[] = [];

  // Mostly noise traders with varying biases
  for (let i = 0; i < numRetailTraders; i++) {
    agents.push({
      type: "NOISE_TRADER",
      agentId: `retail-${i + 1}`,
      initialCash: 5000 + Math.random() * 10000,
      noiseOrderProbability: 0.3 + Math.random() * 0.4,
      noiseOrderSizeRange: [1, 10], // Smaller sizes for retail
      noiseBias: (Math.random() * 2 - 1) * 0.5, // Stronger biases
    });
  }

  // A few LPs for liquidity
  for (let i = 0; i < 2; i++) {
    agents.push({
      type: "LIQUIDITY_PROVIDER",
      agentId: `lp-${i + 1}`,
      initialCash: 100000,
      initialYesShares: 1000,
      lpNumLevels: 5,
      lpSpread: 0.03,
      lpLevelSize: 100,
      lpRefreshRate: 0.1,
    });
  }

  return {
    base: {
      type: "CUSTOM",
      seed,
      numTraders: agents.length,
      initialCash: 10000,
      numOrders: 2000,
      timeWindow: 60000,
      baseArrivalRate: 20,
    },
    agents,
    latentProbability,
    probabilityDrift: 0.002,
    probabilityJumpProbability: 0.05,
    probabilityJumpMax: 0.1,
  };
}

/**
 * Create a scenario with predominantly informed traders (insider-heavy)
 */
export function createInsiderHeavyPMScenario(
  seed: number,
  numInformedTraders: number = 8,
  latentProbability: number = 0.7
): PMAgentScenarioConfig {
  const agents: AgentConfig[] = [];

  // Informed traders with high accuracy
  for (let i = 0; i < numInformedTraders; i++) {
    agents.push({
      type: "INFORMED_TRADER",
      agentId: `insider-${i + 1}`,
      initialCash: 20000 + Math.random() * 30000,
      informedAccuracy: 0.8 + Math.random() * 0.15, // 0.8-0.95 accuracy
      informedConfidence: 0.7 + Math.random() * 0.25, // 0.7-0.95 confidence
      informedBaseSize: 25 + Math.random() * 75, // 25-100 base size
    });
  }

  // A few LPs and noise traders
  for (let i = 0; i < 2; i++) {
    agents.push({
      type: "LIQUIDITY_PROVIDER",
      agentId: `lp-${i + 1}`,
      initialCash: 150000,
      initialYesShares: 2000,
      lpNumLevels: 4,
      lpSpread: 0.025,
      lpLevelSize: 200,
      lpRefreshRate: 0.08,
    });
  }

  for (let i = 0; i < 5; i++) {
    agents.push({
      type: "NOISE_TRADER",
      agentId: `noise-${i + 1}`,
      initialCash: 5000,
      noiseOrderProbability: 0.2,
      noiseOrderSizeRange: [1, 5],
      noiseBias: Math.random() * 2 - 1,
    });
  }

  return {
    base: {
      type: "CUSTOM",
      seed,
      numTraders: agents.length,
      initialCash: 10000,
      numOrders: 500,
      timeWindow: 60000,
      baseArrivalRate: 5,
    },
    agents,
    latentProbability,
    probabilityDrift: 0.0005,
    probabilityJumpProbability: 0.01,
    probabilityJumpMax: 0.03,
  };
}
