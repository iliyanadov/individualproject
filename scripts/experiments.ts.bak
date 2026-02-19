/**
 * Experiment Scripts
 *
 * Standard experiment runs for comparing CLOB, LMSR, and Hybrid:
 * 1. LMSR vs CLOB under thin liquidity
 * 2. LMSR vs CLOB under thick liquidity
 * 3. All three under shock (with consistent jump magnitude + timing)
 * 4. Sensitivity sweeps (vary b, vary tick size, vary routing thresholds)
 */

import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { Decimal } from "decimal.js";
import { SimulationRunner, ScenarioConfig, ScenarioType, exportSimulationToCSV, exportSimulationToJSON } from "../src/lib/simulation";
import { createEngine, createHybridEngine, createHybridConfig } from "../src/lib/engine-adapters";
import { createHybridConfig as createHybridRouterConfig } from "../src/lib/hybrid-router";

// ============================================================================
// Configuration
// ============================================================================

const OUTPUT_DIR = "./experiments";

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ============================================================================
// Experiment 1: Thin Liquidity
// ============================================================================

export function runThinLiquidityComparison(): void {
  console.log("=== Experiment 1: Thin Liquidity Comparison ===\n");

  const baseConfig: ScenarioConfig = {
    type: "THIN_LIQUIDITY",
    seed: 42,
    numTraders: 20,
    initialCash: 10000,
    numOrders: 200,
    timeWindow: 10000, // 10 seconds
    baseArrivalRate: 50, // 50 orders/second -> thin
    orderSizeMin: 1,
    orderSizeMax: 5,
    priceSpread: 0.15, // Wide spread = thin
  };

  const engines = ["CLOB", "LMSR", "HYBRID"] as const;
  const results: any[] = [];

  for (const engineType of engines) {
    console.log(`Running ${engineType}...`);

    let config = { ...baseConfig };
    let engine: any;

    if (engineType === "HYBRID") {
      config = {
        ...baseConfig,
        ...createHybridRouterConfig({
          spreadThreshold: 0.10,
          depthThreshold: 5, // Lower threshold for thin market
          depthTicks: 3,
          b: 100,
          tickSize: 0.01,
        }),
      };
      engine = createHybridEngine(config);
    } else if (engineType === "CLOB") {
      config = {
        ...baseConfig,
        tickSize: 0.01,
      };
      engine = createEngine(engineType, config);
    } else {
      config = {
        ...baseConfig,
        liquidity: 100,
      };
      engine = createEngine(engineType, config);
    }

    const runner = new SimulationRunner(engine);
    const output = runner.runSync(config);
    results.push(output);

    console.log(`  Orders: ${output.intents.length}`);
    console.log(`  Filled: ${output.results.filter((r: any) => r.status === "FILLED").length}`);
    console.log(`  Avg Slippage: ${output.metrics.avgSlippage?.toString() ?? "N/A"}`);
    console.log(`  Fill Ratio: ${output.metrics.fillRatio?.toString()}`);
    console.log("");
  }

  // Save results
  const timestamp = Date.now();
  for (const output of results) {
    const filename = join(OUTPUT_DIR, `exp1-thin-${output.engineType}-${timestamp}.json`);
    writeFileSync(filename, exportSimulationToJSON(output));
  }

  // Save comparison CSV
  const comparisonCsv = generateComparisonCsv(results);
  writeFileSync(join(OUTPUT_DIR, `exp1-thin-comparison-${timestamp}.csv`), comparisonCsv);

  console.log("=== Experiment 1 Complete ===\n");
}

// ============================================================================
// Experiment 2: Thick Liquidity
// ============================================================================

export function runThickLiquidityComparison(): void {
  console.log("=== Experiment 2: Thick Liquidity Comparison ===\n");

  const baseConfig: ScenarioConfig = {
    type: "THICK_LIQUIDITY",
    seed: 42,
    numTraders: 50,
    initialCash: 10000,
    numOrders: 500,
    timeWindow: 10000, // 10 seconds
    baseArrivalRate: 200, // 200 orders/second -> thick
    orderSizeMin: 1,
    orderSizeMax: 50,
    priceSpread: 0.03, // Tight spread = thick
  };

  const engines = ["CLOB", "LMSR", "HYBRID"] as const;
  const results: any[] = [];

  for (const engineType of engines) {
    console.log(`Running ${engineType}...`);

    let config = { ...baseConfig };
    let engine: any;

    if (engineType === "HYBRID") {
      config = {
        ...baseConfig,
        ...createHybridRouterConfig({
          spreadThreshold: 0.05,
          depthThreshold: 20, // Higher threshold for thick market
          depthTicks: 3,
          b: 100,
          tickSize: 0.01,
        }),
      };
      engine = createHybridEngine(config);
    } else if (engineType === "CLOB") {
      config = {
        ...baseConfig,
        tickSize: 0.01,
      };
      engine = createEngine(engineType, config);
    } else {
      config = {
        ...baseConfig,
        liquidity: 100,
      };
      engine = createEngine(engineType, config);
    }

    const runner = new SimulationRunner(engine);
    const output = runner.runSync(config);
    results.push(output);

    console.log(`  Orders: ${output.intents.length}`);
    console.log(`  Filled: ${output.results.filter((r: any) => r.status === "FILLED").length}`);
    console.log(`  Avg Slippage: ${output.metrics.avgSlippage?.toString() ?? "N/A"}`);
    console.log(`  Fill Ratio: ${output.metrics.fillRatio?.toString()}`);
    console.log("");
  }

  // Save results
  const timestamp = Date.now();
  for (const output of results) {
    const filename = join(OUTPUT_DIR, `exp2-thick-${output.engineType}-${timestamp}.json`);
    writeFileSync(filename, exportSimulationToJSON(output));
  }

  // Save comparison CSV
  const comparisonCsv = generateComparisonCsv(results);
  writeFileSync(join(OUTPUT_DIR, `exp2-thick-comparison-${timestamp}.csv`), comparisonCsv);

  console.log("=== Experiment 2 Complete ===\n");
}

// ============================================================================
// Experiment 3: Shock Scenario
// ============================================================================

export function runShockComparison(): void {
  console.log("=== Experiment 3: Shock Scenario Comparison ===\n");

  const baseConfig: ScenarioConfig = {
    type: "SHOCK",
    seed: 42,
    numTraders: 30,
    initialCash: 10000,
    numOrders: 300,
    timeWindow: 10000,
    baseArrivalRate: 100,
    orderSizeMin: 1,
    orderSizeMax: 20,
    priceSpread: 0.05,
    shockTime: 5000, // Shock at 5 seconds
    shockMagnitude: 0.15, // 15 cent jump
    shockProbability: 0.3, // 30% chance per tick after shock time
  };

  const engines = ["CLOB", "LMSR", "HYBRID"] as const;
  const results: any[] = [];

  for (const engineType of engines) {
    console.log(`Running ${engineType}...`);

    let config = { ...baseConfig };
    let engine: any;

    if (engineType === "HYBRID") {
      config = {
        ...baseConfig,
        ...createHybridRouterConfig({
          spreadThreshold: 0.05,
          depthThreshold: 10,
          depthTicks: 3,
          b: 100,
          tickSize: 0.01,
        }),
      };
      engine = createHybridEngine(config);
    } else if (engineType === "CLOB") {
      config = {
        ...baseConfig,
        tickSize: 0.01,
      };
      engine = createEngine(engineType, config);
    } else {
      config = {
        ...baseConfig,
        liquidity: 100,
      };
      engine = createEngine(engineType, config);
    }

    const runner = new SimulationRunner(engine);
    const output = runner.runSync(config);
    results.push(output);

    console.log(`  Orders: ${output.intents.length}`);
    console.log(`  Filled: ${output.results.filter((r: any) => r.status === "FILLED").length}`);
    console.log(`  Price Movement: ${output.metrics.priceMovement?.toString() ?? "N/A"}`);
    console.log(`  Time-Weighted Slippage: ${output.metrics.twasSlippage?.toString() ?? "N/A"}`);
    console.log("");
  }

  // Save results
  const timestamp = Date.now();
  for (const output of results) {
    const filename = join(OUTPUT_DIR, `exp3-shock-${output.engineType}-${timestamp}.json`);
    writeFileSync(filename, exportSimulationToJSON(output));
  }

  // Save comparison CSV
  const comparisonCsv = generateComparisonCsv(results);
  writeFileSync(join(OUTPUT_DIR, `exp3-shock-comparison-${timestamp}.csv`), comparisonCsv);

  console.log("=== Experiment 3 Complete ===\n");
}

// ============================================================================
// Experiment 4: Sensitivity Sweep - b parameter (LMSR)
// ============================================================================

export function runSensitivitySweep_b(): void {
  console.log("=== Experiment 4a: Sensitivity Sweep - b parameter ===\n");

  const bValues = [10, 25, 50, 100, 200, 500];
  const timestamp = Date.now();

  for (const b of bValues) {
    console.log(`Running LMSR with b=${b}...`);

    const config: ScenarioConfig = {
      type: "THICK_LIQUIDITY",
      seed: 42,
      numTraders: 30,
      initialCash: 10000,
      numOrders: 200,
      timeWindow: 10000,
      baseArrivalRate: 100,
      orderSizeMin: 1,
      orderSizeMax: 20,
      priceSpread: 0.05,
    };

    const engine = createEngine("LMSR", { type: "LMSR", liquidity: b });
    const runner = new SimulationRunner(engine);
    const output = runner.runSync(config);

    // Save individual result
    const filename = join(OUTPUT_DIR, `exp4a-sweep-b-${b}-${timestamp}.json`);
    writeFileSync(filename, exportSimulationToJSON(output));

    console.log(`  Final Mid Price: ${output.metrics.finalMidPrice?.toString() ?? "N/A"}`);
    console.log("");
  }

  // Generate sweep summary
  const summaryFile = join(OUTPUT_DIR, `exp4a-sweep-b-summary-${timestamp}.csv`);
  // (Would need to load and process all files to generate summary)
  writeFileSync(summaryFile, "b_value,final_mid_price\n" + bValues.map(b => `${b},\n`).join(""));

  console.log("=== Experiment 4a Complete ===\n");
}

// ============================================================================
// Experiment 4b: Sensitivity Sweep - Tick Size (CLOB)
// ============================================================================

export function runSensitivitySweep_tickSize(): void {
  console.log("=== Experiment 4b: Sensitivity Sweep - Tick Size ===\n");

  const tickSizes = [0.001, 0.005, 0.01, 0.02, 0.05, 0.10];
  const timestamp = Date.now();

  for (const tickSize of tickSizes) {
    console.log(`Running CLOB with tickSize=${tickSize}...`);

    const config: ScenarioConfig = {
      type: "THICK_LIQUIDITY",
      seed: 42,
      numTraders: 30,
      initialCash: 10000,
      numOrders: 200,
      timeWindow: 10000,
      baseArrivalRate: 100,
      orderSizeMin: 1,
      orderSizeMax: 20,
      priceSpread: 0.05,
    };

    const engine = createEngine("CLOB", { type: "CLOB", tickSize });
    const runner = new SimulationRunner(engine);
    const output = runner.runSync(config);

    const filename = join(OUTPUT_DIR, `exp4b-sweep-tick-${tickSize}-${timestamp}.json`);
    writeFileSync(filename, exportSimulationToJSON(output));

    console.log(`  Avg Slippage: ${output.metrics.avgSlippage?.toString() ?? "N/A"}`);
    console.log(`  Spread: ${output.metrics.finalSpread?.toString() ?? "N/A"}`);
    console.log("");
  }

  console.log("=== Experiment 4b Complete ===\n");
}

// ============================================================================
// Experiment 4c: Sensitivity Sweep - Routing Thresholds (Hybrid)
// ============================================================================

export function runSensitivitySweep_routing(): void {
  console.log("=== Experiment 4c: Sensitivity Sweep - Routing Thresholds ===\n");

  const spreadThresholds = [0.01, 0.02, 0.05, 0.10, 0.20];
  const depthThresholds = [5, 10, 20, 50];
  const timestamp = Date.now();

  for (const spreadThresh of spreadThresholds) {
    for (const depthThresh of depthThresholds) {
      console.log(`Running Hybrid with spreadThresh=${spreadThresh}, depthThresh=${depthThresh}...`);

      const baseConfig: ScenarioConfig = {
        type: "THICK_LIQUIDITY",
        seed: 42,
        numTraders: 30,
        initialCash: 10000,
        numOrders: 200,
        timeWindow: 10000,
        baseArrivalRate: 100,
        orderSizeMin: 1,
        orderSizeMax: 20,
        priceSpread: 0.05,
      };

      const config: any = {
        ...baseConfig,
        ...createHybridRouterConfig({
          spreadThreshold: spreadThresh,
          depthThreshold: depthThresh,
          depthTicks: 3,
          b: 100,
          tickSize: 0.01,
        }),
      };

      const engine = createHybridEngine(config);
      const runner = new SimulationRunner(engine);
      const output = runner.runSync(config);

      const filename = join(OUTPUT_DIR, `exp4c-sweep-routing-${spreadThresh}-${depthThresh}-${timestamp}.json`);
      writeFileSync(filename, exportSimulationToJSON(output));

      const routingStats = (engine as any).getRoutingStats();
      console.log(`  CLOB Ratio: ${routingStats.clobRatio.toString()}`);
      console.log(`  Fill Ratio: ${output.metrics.fillRatio?.toString()}`);
      console.log("");
    }
  }

  console.log("=== Experiment 4c Complete ===\n");
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateComparisonCsv(results: any[]): string {
  const lines: string[] = [];

  // Header
  lines.push("engine_type,total_orders,filled_orders,fill_ratio,avg_slippage,avg_price_impact,final_mid_price");

  // Data rows
  for (const result of results) {
    const metrics = result.metrics;
    lines.push([
      result.engineType,
      result.intents.length,
      result.results.filter((r: any) => r.status === "FILLED").length,
      metrics.fillRatio?.toString() ?? "N/A",
      metrics.avgSlippage?.toString() ?? "N/A",
      metrics.avgPriceImpact?.toString() ?? "N/A",
      metrics.finalMidPrice?.toString() ?? "N/A",
    ].join(","));
  }

  return lines.join("\n");
}

// ============================================================================
// Run All Experiments
// ============================================================================

export function runAllExperiments(): void {
  console.log("\n╔════════════════════════════════════════════════════════╗");
  console.log("║     Running All CLOB/LMSR Comparison Experiments        ║");
  console.log("╚════════════════════════════════════════════════════════╝\n");

  runThinLiquidityComparison();
  runThickLiquidityComparison();
  runShockComparison();
  runSensitivitySweep_b();
  runSensitivitySweep_tickSize();
  runSensitivitySweep_routing();

  console.log("\n✅ All experiments complete!");
  console.log(`Results saved to: ${OUTPUT_DIR}`);
}

// Run if called directly
if (require.main === module) {
  runAllExperiments();
}
