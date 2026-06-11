import { round } from "../lib/math";
import { LiquidationEngine } from "./liquidation-engine";
import type {
  LiquidationHeat,
  LiquidationHeatEntry,
  LiquidationsDashboardPayload,
  LiquidationState
} from "./types";

const ONE_MINUTE_WEIGHT = 1;
const FIVE_MINUTES_WEIGHT = 0.8;
const FIFTEEN_MINUTES_WEIGHT = 0.5;
const ONE_HOUR_WEIGHT = 0.3;

const classifyHeat = (value: number): LiquidationHeat => {
  if (value >= 1_000_000) {
    return "extreme";
  }

  if (value >= 250_000) {
    return "high";
  }

  if (value >= 50_000) {
    return "medium";
  }

  return "low";
};

const computeWeightedValue = (state: LiquidationState): number =>
  round(
    state.liquidations1m * ONE_MINUTE_WEIGHT +
      state.liquidations5m * FIVE_MINUTES_WEIGHT +
      state.liquidations15m * FIFTEEN_MINUTES_WEIGHT +
      state.liquidations1h * ONE_HOUR_WEIGHT,
    2
  );

export class LiquidationAggregator {
  constructor(private readonly engine: LiquidationEngine) {}

  build(now = Date.now()): LiquidationsDashboardPayload {
    const bySymbol = this.engine.snapshot(now);
    const heatRanking: LiquidationHeatEntry[] = Object.values(bySymbol)
      .map((state) => ({
        symbol: state.symbol,
        value: computeWeightedValue(state),
        heat: classifyHeat(computeWeightedValue(state))
      }))
      .filter((entry) => entry.value > 0)
      .sort((left, right) => right.value - left.value || left.symbol.localeCompare(right.symbol));

    return {
      bySymbol,
      topLiquidationSymbols: heatRanking.map((entry) => entry.symbol),
      heatRanking
    };
  }
}
