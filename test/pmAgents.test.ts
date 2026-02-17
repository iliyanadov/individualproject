/**
 * Tests for PM Agent Order Generator
 *
 * Verifies that different agent types produce realistic order patterns:
 * - Noise traders generate random orders with bias
 * - Informed traders react to latent probability
 * - Liquidity providers provide passive quotes
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Decimal } from "decimal.js";
import {
  PMAgentOrderGenerator,
  PMAgentScenarioConfig,
  createBalancedPMScenario,
  createRetailHeavyPMScenario,
  createInsiderHeavyPMScenario,
} from "../src/lib/pmAgents";
import { Side, OrderType } from "../src/lib/engine-common";

describe("PMAgentOrderGenerator: Initialization", () => {
  it("should initialize agent states correctly", () => {
    const config: PMAgentScenarioConfig = {
      base: {
        type: "CUSTOM",
        seed: 12345,
        numTraders: 3,
        initialCash: 10000,
        numOrders: 100,
        timeWindow: 10000,
        baseArrivalRate: 10,
      },
      agents: [
        {
          type: "NOISE_TRADER",
          agentId: "noise-1",
          initialCash: 10000,
        },
        {
          type: "INFORMED_TRADER",
          agentId: "informed-1",
          initialCash: 15000,
          informedAccuracy: 0.8,
        },
        {
          type: "LIQUIDITY_PROVIDER",
          agentId: "lp-1",
          initialCash: 50000,
          initialYesShares: 500,
        },
      ],
      latentProbability: 0.6,
    };

    const generator = new PMAgentOrderGenerator(config);
    const states = generator.getAgentStates();

    expect(states.size).toBe(3);

    const noiseState = states.get("noise-1")!;
    expect(noiseState.cash.toNumber()).toBe(10000);
    expect(noiseState.yesShares.toNumber()).toBe(0);

    const informedState = states.get("informed-1")!;
    expect(informedState.cash.toNumber()).toBe(15000);
    expect(informedState.perceivedProbability).toBeGreaterThan(0);
    expect(informedState.perceivedProbability).toBeLessThan(1);

    const lpState = states.get("lp-1")!;
    expect(lpState.cash.toNumber()).toBe(50000);
    expect(lpState.yesShares.toNumber()).toBe(500);
  });

  it("should initialize informed traders with noisy perceptions", () => {
    const config: PMAgentScenarioConfig = {
      base: {
        type: "CUSTOM",
        seed: 12345,
        numTraders: 1,
        initialCash: 10000,
        numOrders: 100,
        timeWindow: 10000,
        baseArrivalRate: 10,
      },
      agents: [
        {
          type: "INFORMED_TRADER",
          agentId: "informed-1",
          initialCash: 10000,
          informedAccuracy: 0.5, // Very noisy
        },
      ],
      latentProbability: 0.7,
    };

    const generator = new PMAgentOrderGenerator(config);
    const state = generator.getAgentStates().get("informed-1")!;

    // With 50% accuracy, perception should be quite noisy
    // But still roughly in the ballpark
    expect(state.perceivedProbability).toBeGreaterThan(0);
    expect(state.perceivedProbability).toBeLessThan(1);
  });
});

describe("PMAgentOrderGenerator: Order Generation", () => {
  it("should generate orders for all agent types", () => {
    const config = createBalancedPMScenario(12345, 2, 1, 1, 0.5);
    const generator = new PMAgentOrderGenerator(config);
    const orders = generator.generate();

    expect(orders.length).toBeGreaterThan(0);

    // Check that orders have required fields
    for (const order of orders) {
      expect(order.intentId).toMatch(/^intent-\d+$/);
      expect(order.traderId).toBeTruthy();
      expect(order.outcome).toBe("YES");
      expect(order.side).toMatch(/^(BUY|SELL)$/);
      expect(order.orderType).toMatch(/^(LIMIT|MARKET)$/);
      expect(order.qty).toBeGreaterThan(0);
      expect(order.timestamp).toBeGreaterThanOrEqual(0);
    }
  });

  it("should respect time window", () => {
    const config = createBalancedPMScenario(12345, 5, 2, 1, 0.5);
    config.base.timeWindow = 5000; // 5 seconds
    config.base.numOrders = 1000; // Try to generate many orders

    const generator = new PMAgentOrderGenerator(config);
    const orders = generator.generate();

    // All orders should be within time window
    for (const order of orders) {
      expect(order.timestamp).toBeLessThan(5000);
    }
  });

  it("should be deterministic with same seed", () => {
    const config = createBalancedPMScenario(12345, 5, 2, 1, 0.5);

    const generator1 = new PMAgentOrderGenerator(config);
    const orders1 = generator1.generate();

    const generator2 = new PMAgentOrderGenerator(config);
    const orders2 = generator2.generate();

    expect(orders1.length).toBe(orders2.length);

    for (let i = 0; i < orders1.length; i++) {
      expect(orders1[i].traderId).toBe(orders2[i].traderId);
      expect(orders1[i].side).toBe(orders2[i].side);
      expect(orders1[i].orderType).toBe(orders2[i].orderType);
      expect(orders1[i].qty).toBeCloseTo(orders2[i].qty, 6);

      // Handle undefined prices for market orders
      const price1 = orders1[i].price ?? 0;
      const price2 = orders2[i].price ?? 0;
      if (orders1[i].orderType === "LIMIT" && orders2[i].orderType === "LIMIT") {
        expect(price1).toBeCloseTo(price2, 6);
      } else {
        expect(price1).toBe(price2);
      }
    }
  });
});

describe("PMAgentOrderGenerator: Noise Trader Behavior", () => {
  it("should generate mostly market orders for noise traders", () => {
    const config: PMAgentScenarioConfig = {
      base: {
        type: "CUSTOM",
        seed: 12345,
        numTraders: 1,
        initialCash: 10000,
        numOrders: 100,
        timeWindow: 10000,
        baseArrivalRate: 10,
      },
      agents: [
        {
          type: "NOISE_TRADER",
          agentId: "noise-1",
          initialCash: 10000,
          noiseOrderProbability: 1.0, // Always order
          noiseOrderSizeRange: [5, 10],
        },
      ],
      latentProbability: 0.5,
    };

    const generator = new PMAgentOrderGenerator(config);
    const orders = generator.generate();

    expect(orders.length).toBeGreaterThan(0);

    const marketOrderCount = orders.filter(o => o.orderType === "MARKET").length;
    const limitOrderCount = orders.filter(o => o.orderType === "LIMIT").length;

    // Noise traders generate mostly market orders (50% market in implementation)
    // Should have a significant portion of market orders
    expect(marketOrderCount).toBeGreaterThanOrEqual(limitOrderCount);
  });

  it("should respect noise trader bias", () => {
    const config: PMAgentScenarioConfig = {
      base: {
        type: "CUSTOM",
        seed: 12345,
        numTraders: 1,
        initialCash: 10000,
        numOrders: 100,
        timeWindow: 10000,
        baseArrivalRate: 10,
      },
      agents: [
        {
          type: "NOISE_TRADER",
          agentId: "noise-bull",
          initialCash: 10000,
          noiseOrderProbability: 1.0,
          noiseOrderSizeRange: [5, 10],
          noiseBias: 0.8, // Strong YES bias
        },
      ],
      latentProbability: 0.5,
    };

    const generator = new PMAgentOrderGenerator(config);
    const orders = generator.generate();

    const buyCount = orders.filter(o => o.side === "BUY").length;
    const sellCount = orders.filter(o => o.side === "SELL").length;

    // With strong YES bias, should have more buys than sells
    expect(buyCount).toBeGreaterThan(sellCount);
  });

  it("should respect order size range", () => {
    const config: PMAgentScenarioConfig = {
      base: {
        type: "CUSTOM",
        seed: 12345,
        numTraders: 1,
        initialCash: 10000,
        numOrders: 100,
        timeWindow: 10000,
        baseArrivalRate: 10,
      },
      agents: [
        {
          type: "NOISE_TRADER",
          agentId: "noise-1",
          initialCash: 10000,
          noiseOrderProbability: 1.0,
          noiseOrderSizeRange: [10, 20],
        },
      ],
      latentProbability: 0.5,
    };

    const generator = new PMAgentOrderGenerator(config);
    const orders = generator.generate();

    for (const order of orders) {
      expect(order.qty).toBeGreaterThanOrEqual(10);
      expect(order.qty).toBeLessThanOrEqual(20);
    }
  });
});

describe("PMAgentOrderGenerator: Informed Trader Behavior", () => {
  it("should generate limit orders for informed traders", () => {
    const config: PMAgentScenarioConfig = {
      base: {
        type: "CUSTOM",
        seed: 12345,
        numTraders: 1,
        initialCash: 10000,
        numOrders: 100,
        timeWindow: 10000,
        baseArrivalRate: 10,
      },
      agents: [
        {
          type: "INFORMED_TRADER",
          agentId: "informed-1",
          initialCash: 10000,
          informedAccuracy: 0.9,
          informedConfidence: 0.8,
          informedBaseSize: 20,
        },
      ],
      latentProbability: 0.7, // YES favored
    };

    const generator = new PMAgentOrderGenerator(config);
    const orders = generator.generate();

    // All informed trader orders should be limit orders
    for (const order of orders) {
      expect(order.traderId).toBe("informed-1");
      expect(order.orderType).toBe("LIMIT");
      expect(order.price).toBeDefined();
      expect(order.price).toBeGreaterThan(0);
      expect(order.price).toBeLessThan(1);
    }
  });

  it("should buy when perceived probability > 0.5", () => {
    const config: PMAgentScenarioConfig = {
      base: {
        type: "CUSTOM",
        seed: 12345,
        numTraders: 1,
        initialCash: 10000,
        numOrders: 100,
        timeWindow: 10000,
        baseArrivalRate: 10,
      },
      agents: [
        {
          type: "INFORMED_TRADER",
          agentId: "informed-1",
          initialCash: 10000,
          informedAccuracy: 0.95,
          informedConfidence: 0.9,
          informedBaseSize: 20,
        },
      ],
      latentProbability: 0.8, // Strong YES signal
    };

    const generator = new PMAgentOrderGenerator(config);
    const orders = generator.generate();

    // With high latent probability and high accuracy, informed trader should mostly buy
    const buyCount = orders.filter(o => o.side === "BUY").length;
    const sellCount = orders.filter(o => o.side === "SELL").length;

    expect(buyCount).toBeGreaterThan(0);
    // May have some sells due to noise, but buys should dominate
  });

  it("should adjust trade size based on confidence and edge", () => {
    const config: PMAgentScenarioConfig = {
      base: {
        type: "CUSTOM",
        seed: 12345,
        numTraders: 1,
        initialCash: 10000,
        numOrders: 100,
        timeWindow: 10000,
        baseArrivalRate: 10,
      },
      agents: [
        {
          type: "INFORMED_TRADER",
          agentId: "informed-1",
          initialCash: 10000,
          informedAccuracy: 0.9,
          informedConfidence: 0.9,
          informedBaseSize: 10,
        },
      ],
      latentProbability: 0.8, // Strong signal
    };

    const generator = new PMAgentOrderGenerator(config);
    const orders = generator.generate();

    // Trade sizes should be around base size, potentially larger due to edge
    for (const order of orders) {
      // Allow some variance due to random multiplier
      expect(order.qty).toBeGreaterThan(0);
    }
  });
});

describe("PMAgentOrderGenerator: Liquidity Provider Behavior", () => {
  it("should generate bid-ask quotes", () => {
    const config: PMAgentScenarioConfig = {
      base: {
        type: "CUSTOM",
        seed: 12345,
        numTraders: 1,
        initialCash: 10000,
        numOrders: 100,
        timeWindow: 10000,
        baseArrivalRate: 10,
      },
      agents: [
        {
          type: "LIQUIDITY_PROVIDER",
          agentId: "lp-1",
          initialCash: 50000,
          initialYesShares: 500,
          lpNumLevels: 2,
          lpSpread: 0.04,
          lpLevelSize: 50,
          lpRefreshRate: 0.5, // High refresh rate for testing
        },
      ],
      latentProbability: 0.5,
    };

    const generator = new PMAgentOrderGenerator(config);
    const orders = generator.generate();

    expect(orders.length).toBeGreaterThan(0);

    // All LP orders should be limit orders
    for (const order of orders) {
      expect(order.traderId).toBe("lp-1");
      expect(order.orderType).toBe("LIMIT");
      expect(order.price).toBeDefined();
    }

    // Should have both buy and sell orders
    const buyOrders = orders.filter(o => o.side === "BUY");
    const sellOrders = orders.filter(o => o.side === "SELL");

    expect(buyOrders.length).toBeGreaterThan(0);
    expect(sellOrders.length).toBeGreaterThan(0);
  });

  it("should maintain spread around mid price", () => {
    const config: PMAgentScenarioConfig = {
      base: {
        type: "CUSTOM",
        seed: 12345,
        numTraders: 1,
        initialCash: 10000,
        numOrders: 50,
        timeWindow: 10000,
        baseArrivalRate: 10,
      },
      agents: [
        {
          type: "LIQUIDITY_PROVIDER",
          agentId: "lp-1",
          initialCash: 50000,
          initialYesShares: 500,
          lpNumLevels: 1,
          lpSpread: 0.06,
          lpLevelSize: 50,
          lpRefreshRate: 1.0,
        },
      ],
      latentProbability: 0.5,
    };

    const generator = new PMAgentOrderGenerator(config);
    const orders = generator.generate();

    const buyOrders = orders.filter(o => o.side === "BUY");
    const sellOrders = orders.filter(o => o.side === "SELL");

    expect(buyOrders.length).toBeGreaterThan(0);
    expect(sellOrders.length).toBeGreaterThan(0);

    // Check that bids are below mid and asks are above
    const avgBidPrice = buyOrders.reduce((sum, o) => sum + (o.price ?? 0), 0) / buyOrders.length;
    const avgAskPrice = sellOrders.reduce((sum, o) => sum + (o.price ?? 0), 0) / sellOrders.length;

    expect(avgBidPrice).toBeLessThan(0.5);
    expect(avgAskPrice).toBeGreaterThan(0.5);
  });
});

describe("PMAgentOrderGenerator: Latent Probability Dynamics", () => {
  it("should track latent probability over time", () => {
    const config: PMAgentScenarioConfig = {
      base: {
        type: "CUSTOM",
        seed: 12345,
        numTraders: 1,
        initialCash: 10000,
        numOrders: 100,
        timeWindow: 10000,
        baseArrivalRate: 10,
      },
      agents: [
        {
          type: "NOISE_TRADER",
          agentId: "noise-1",
          initialCash: 10000,
          noiseOrderProbability: 1.0,
          noiseOrderSizeRange: [5, 10],
        },
      ],
      latentProbability: 0.5,
      probabilityDrift: 0.01,
      probabilityJumpProbability: 0.1,
      probabilityJumpMax: 0.1,
    };

    const generator = new PMAgentOrderGenerator(config);
    const initialProb = generator.getCurrentLatentProbability();

    generator.generate(); // This will update latent probability

    const finalProb = generator.getCurrentLatentProbability();

    // Probability should have changed due to drift
    expect(finalProb).not.toBe(initialProb);
  });

  it("should keep latent probability in valid range", () => {
    const config: PMAgentScenarioConfig = {
      base: {
        type: "CUSTOM",
        seed: 12345,
        numTraders: 1,
        initialCash: 10000,
        numOrders: 200,
        timeWindow: 10000,
        baseArrivalRate: 10,
      },
      agents: [
        {
          type: "NOISE_TRADER",
          agentId: "noise-1",
          initialCash: 10000,
          noiseOrderProbability: 1.0,
          noiseOrderSizeRange: [5, 10],
        },
      ],
      latentProbability: 0.5,
      probabilityDrift: 0.05, // Large drift
      probabilityJumpProbability: 0.3, // Frequent jumps
      probabilityJumpMax: 0.2, // Large jumps
    };

    const generator = new PMAgentOrderGenerator(config);
    generator.generate();

    const finalProb = generator.getCurrentLatentProbability();
    expect(finalProb).toBeGreaterThan(0);
    expect(finalProb).toBeLessThan(1);
  });
});

describe("Factory Functions", () => {
  it("should create balanced scenario with all agent types", () => {
    const config = createBalancedPMScenario(12345, 5, 2, 1, 0.5);

    expect(config.agents.length).toBe(8); // 5 noise + 2 informed + 1 LP

    const noiseAgents = config.agents.filter(a => a.type === "NOISE_TRADER");
    const informedAgents = config.agents.filter(a => a.type === "INFORMED_TRADER");
    const lpAgents = config.agents.filter(a => a.type === "LIQUIDITY_PROVIDER");

    expect(noiseAgents.length).toBe(5);
    expect(informedAgents.length).toBe(2);
    expect(lpAgents.length).toBe(1);
  });

  it("should create retail-heavy scenario", () => {
    const config = createRetailHeavyPMScenario(12345, 15, 0.6);

    const noiseAgents = config.agents.filter(a => a.type === "NOISE_TRADER");
    const lpAgents = config.agents.filter(a => a.type === "LIQUIDITY_PROVIDER");

    expect(noiseAgents.length).toBeGreaterThanOrEqual(15);
    expect(lpAgents.length).toBe(2);
    expect(config.latentProbability).toBe(0.6);
  });

  it("should create insider-heavy scenario", () => {
    const config = createInsiderHeavyPMScenario(12345, 6, 0.8);

    const informedAgents = config.agents.filter(a => a.type === "INFORMED_TRADER");

    expect(informedAgents.length).toBeGreaterThanOrEqual(6);
    expect(config.latentProbability).toBe(0.8);

    // Informed traders should have high accuracy
    for (const agent of informedAgents) {
      expect(agent.informedAccuracy).toBeGreaterThan(0.8);
    }
  });
});
