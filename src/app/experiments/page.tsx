"use client";

import { useState } from "react";
import { Decimal } from "decimal.js";
import {
  SimulationRunner,
  ScenarioConfig,
  ScenarioType,
  SimulationOutput,
  exportSimulationToCSV,
  exportSimulationToJSON,
} from "@/lib/simulation";
import {
  createEngine,
  createHybridEngine,
  createHybridConfig,
} from "@/lib/engine-adapters";

type ChartDataPoint = {
  timestamp: number;
  midPrice: number | null;
  spread: number | null;
  bidDepth: number | null;
  askDepth: number | null;
  slippage: number | null;
  priceImpact: number | null;
};

export default function ExperimentsPage() {
  // Scenario config state
  const [scenarioType, setScenarioType] = useState<ScenarioType>("THIN_LIQUIDITY");
  const [seed, setSeed] = useState(42);
  const [numTraders, setNumTraders] = useState(20);
  const [initialCash, setInitialCash] = useState(10000);
  const [numOrders, setNumOrders] = useState(200);
  const [timeWindow, setTimeWindow] = useState(10000);
  const [baseArrivalRate, setBaseArrivalRate] = useState(10);
  const [orderSizeMin, setOrderSizeMin] = useState(1);
  const [orderSizeMax, setOrderSizeMax] = useState(20);
  const [priceSpread, setPriceSpread] = useState(0.10);

  // Engine config
  const [engineType, setEngineType] = useState<"CLOB" | "LMSR" | "HYBRID">("CLOB");
  const [tickSize, setTickSize] = useState(0.01);
  const [bParam, setBParam] = useState(100);
  const [spreadThreshold, setSpreadThreshold] = useState(0.05);
  const [depthThreshold, setDepthThreshold] = useState(10);
  const [depthTicks, setDepthTicks] = useState(3);

  // Simulation output
  const [output, setOutput] = useState<SimulationOutput | null>(null);
  const [running, setRunning] = useState(false);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);

  // Build scenario config
  const buildScenarioConfig = (): ScenarioConfig => {
    const config: ScenarioConfig = {
      type: scenarioType,
      seed,
      numTraders,
      initialCash,
      numOrders,
      timeWindow,
      baseArrivalRate,
      orderSizeMin,
      orderSizeMax,
      priceSpread,
    };

    // Add shock parameters if needed
    if (scenarioType === "SHOCK") {
      config.shockTime = 5000;
      config.shockMagnitude = 0.15;
      config.shockProbability = 0.3;
    }

    return config;
  };

  // Run simulation
  const runSimulation = () => {
    setRunning(true);
    setChartData([]);

    setTimeout(() => {
      try {
        const scenario = buildScenarioConfig();

        let engine: any;
        if (engineType === "HYBRID") {
          const hybridConfig = createHybridConfig({
            spreadThreshold,
            depthThreshold,
            depthTicks,
            b: bParam,
            tickSize,
          });
          engine = createHybridEngine(hybridConfig);
        } else if (engineType === "CLOB") {
          engine = createEngine("CLOB", { type: "CLOB", tickSize });
        } else {
          engine = createEngine("LMSR", { type: "LMSR", liquidity: bParam });
        }

        const runner = new SimulationRunner(engine);
        const simOutput = runner.runSync(scenario);

        setOutput(simOutput);

        // Extract chart data
        const data: ChartDataPoint[] = simOutput.snapshots.map(s => ({
          timestamp: s.timestamp,
          midPrice: s.midPrice?.toNumber() ?? null,
          spread: s.spread?.toNumber() ?? null,
          bidDepth: s.bidDepth?.toNumber() ?? null,
          askDepth: s.askDepth?.toNumber() ?? null,
          slippage: null, // Would need to compute from results
          priceImpact: null,
        }));
        setChartData(data);
      } catch (error) {
        console.error("Simulation error:", error);
      } finally {
        setRunning(false);
      }
    }, 100);
  };

  // Export data
  const exportData = () => {
    if (!output) return;

    if (output) {
      // JSON export
      const json = exportSimulationToJSON(output);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `simulation-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const exportCSV = () => {
    if (!output) return;
    const csv = exportSimulationToCSV(output);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `simulation-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Quick presets
  const loadPreset = (preset: "thin" | "thick" | "shock") => {
    switch (preset) {
      case "thin":
        setScenarioType("THIN_LIQUIDITY");
        setNumTraders(20);
        setNumOrders(200);
        setBaseArrivalRate(10);
        setOrderSizeMin(1);
        setOrderSizeMax(5);
        setPriceSpread(0.15);
        break;
      case "thick":
        setScenarioType("THICK_LIQUIDITY");
        setNumTraders(50);
        setNumOrders(500);
        setBaseArrivalRate(20);
        setOrderSizeMin(1);
        setOrderSizeMax(50);
        setPriceSpread(0.02);
        break;
      case "shock":
        setScenarioType("SHOCK");
        setNumTraders(30);
        setNumOrders(300);
        setBaseArrivalRate(10);
        setOrderSizeMin(1);
        setOrderSizeMax(20);
        setPriceSpread(0.05);
        break;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">
          Prediction Market Experiment Runner
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Scenario Config */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">
              Scenario Configuration
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Scenario Type
                </label>
                <select
                  value={scenarioType}
                  onChange={(e) => setScenarioType(e.target.value as ScenarioType)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="THIN_LIQUIDITY">Thin Liquidity</option>
                  <option value="THICK_LIQUIDITY">Thick Liquidity</option>
                  <option value="SHOCK">Shock Scenario</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Seed
                  </label>
                  <input
                    type="number"
                    value={seed}
                    onChange={(e) => setSeed(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Traders
                  </label>
                  <input
                    type="number"
                    value={numTraders}
                    onChange={(e) => setNumTraders(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Orders
                  </label>
                  <input
                    type="number"
                    value={numOrders}
                    onChange={(e) => setNumOrders(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Initial Cash
                  </label>
                  <input
                    type="number"
                    value={initialCash}
                    onChange={(e) => setInitialCash(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Arrival Rate
                  </label>
                  <input
                    type="number"
                    value={baseArrivalRate}
                    onChange={(e) => setBaseArrivalRate(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Price Spread
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={priceSpread}
                    onChange={(e) => setPriceSpread(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Order Size Range
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={orderSizeMin}
                    onChange={(e) => setOrderSizeMin(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="Min"
                  />
                  <input
                    type="number"
                    value={orderSizeMax}
                    onChange={(e) => setOrderSizeMax(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="Max"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => loadPreset("thin")}
                  className="px-4 py-2 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 mr-2"
                >
                  Load Thin Preset
                </button>
                <button
                  onClick={() => loadPreset("thick")}
                  className="px-4 py-2 bg-green-100 text-green-700 rounded-md hover:bg-green-200 mr-2"
                >
                  Load Thick Preset
                </button>
                <button
                  onClick={() => loadPreset("shock")}
                  className="px-4 py-2 bg-orange-100 text-orange-700 rounded-md hover:bg-orange-200"
                >
                  Load Shock Preset
                </button>
              </div>
            </div>
          </div>

          {/* Engine Config */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">
              Engine Configuration
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Engine Type
                </label>
                <select
                  value={engineType}
                  onChange={(e) => setEngineType(e.target.value as "CLOB" | "LMSR" | "HYBRID")}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="CLOB">CLOB (Order Book)</option>
                  <option value="LMSR">LMSR (Market Scoring Rule)</option>
                  <option value="HYBRID">Hybrid Router</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    LMSR b
                  </label>
                  <input
                    type="number"
                    value={bParam}
                    onChange={(e) => setBParam(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    CLOB Tick Size
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    value={tickSize}
                    onChange={(e) => setTickSize(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              {engineType === "HYBRID" && (
                <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Hybrid Router Parameters
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Spread Threshold
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={spreadThreshold}
                        onChange={(e) => setSpreadThreshold(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Depth Threshold
                      </label>
                      <input
                        type="number"
                        value={depthThreshold}
                        onChange={(e) => setDepthThreshold(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Depth Ticks
                    </label>
                    <input
                      type="number"
                      value={depthTicks}
                      onChange={(e) => setDepthTicks(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Run Button & Output */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">
              Run Simulation
            </h2>

            <button
              onClick={runSimulation}
              disabled={running}
              className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium mb-4"
            >
              {running ? "Running..." : "Run Simulation"}
            </button>

            {output && (
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-800 dark:text-white">
                  Results
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="bg-gray-100 dark:bg-gray-700 p-3 rounded">
                    <span className="text-gray-600 dark:text-gray-400">Total Orders</span>
                    <span className="ml-2 font-semibold text-gray-900 dark:text-white">
                      {output.metrics.totalOrders}
                    </span>
                  </div>
                  <div className="bg-gray-100 dark:bg-gray-700 p-3 rounded">
                    <span className="text-gray-600 dark:text-gray-400">Filled Orders</span>
                    <span className="ml-2 font-semibold text-gray-900 dark:text-white">
                      {output.metrics.filledOrders}
                    </span>
                  </div>
                  <div className="bg-gray-100 dark:bg-gray-700 p-3 rounded">
                    <span className="text-gray-600 dark:text-gray-400">Fill Ratio</span>
                    <span className="ml-2 font-semibold text-gray-900 dark:text-white">
                      {(output.metrics.fillRatio * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="bg-gray-100 dark:bg-gray-700 p-3 rounded">
                    <span className="text-gray-600 dark:text-gray-400">Avg Slippage</span>
                    <span className="ml-2 font-semibold text-gray-900 dark:text-white">
                      {output.metrics.avgSlippage?.toFixed(6) ?? "N/A"}
                    </span>
                  </div>
                </div>

                <h3 className="text-lg font-medium text-gray-800 dark:text-white mt-6">
                  Charts
                </h3>
                <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                  <div className="h-64">
                    <svg className="w-full h-full">
                      {chartData.map((point, i) => {
                        const midPrice = point.midPrice;
                        return (
                          <circle
                            key={i}
                            cx={`${(i / chartData.length) * 100}%`}
                            cy={`${100 - ((midPrice ?? 0.5) * 100)}%`}
                            r="2"
                            fill="#3B82F6"
                          />
                        );
                      })}
                    </svg>
                    {chartData.length === 0 && (
                      <div className="flex items-center justify-center h-full text-gray-400">
                        No data
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-4 mt-4">
                  <button
                    onClick={exportData}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium"
                  >
                    Export JSON
                  </button>
                  <button
                    onClick={exportCSV}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
                  >
                    Export CSV
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
