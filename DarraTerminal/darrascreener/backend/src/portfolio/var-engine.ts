import { round } from "../lib/math";
import type { PortfolioVarState } from "./types";

const percentile = (values: number[], quantile: number): number | null => {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return sorted[index] ?? null;
};

export class VarEngine {
  compute(losses: number[], windowDays: number): PortfolioVarState {
    const var95 = percentile(losses, 0.95);
    const var99 = percentile(losses, 0.99);

    return {
      windowDays,
      sampleSize: losses.length,
      var95: var95 !== null ? round(var95, 2) : null,
      var99: var99 !== null ? round(var99, 2) : null
    };
  }
}
