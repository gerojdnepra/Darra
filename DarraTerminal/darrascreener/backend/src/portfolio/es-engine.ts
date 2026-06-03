import { round } from "../lib/math";
import type { PortfolioExpectedShortfallState } from "./types";

const average = (values: number[]): number | null => {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export class ExpectedShortfallEngine {
  compute(
    losses: number[],
    windowDays: number,
    var95: number | null,
    var99: number | null
  ): PortfolioExpectedShortfallState {
    const es95 =
      var95 === null ? null : average(losses.filter((loss) => Number.isFinite(loss) && loss >= var95));
    const es99 =
      var99 === null ? null : average(losses.filter((loss) => Number.isFinite(loss) && loss >= var99));

    return {
      windowDays,
      sampleSize: losses.length,
      es95: es95 !== null ? round(es95, 2) : null,
      es99: es99 !== null ? round(es99, 2) : null
    };
  }
}
