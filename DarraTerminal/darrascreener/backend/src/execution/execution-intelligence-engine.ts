import { clamp, round } from "../lib/math";
import type { RegimeState } from "../regime/types";
import type { RegimeLearningPayload, RegimeLearningState } from "../regime-learning/types";
import type { ScreenerRow } from "../types/messages";
import type { ExecutionState } from "./types";

const HIGH_VOLATILITY_THRESHOLD = 3;
const LOW_VOLATILITY_THRESHOLD = 1;

const resolveVolatilityAdjustment = (row: ScreenerRow | undefined): number => {
  const volatility1h = row?.risk.var.volatility1h;
  if (!Number.isFinite(volatility1h)) {
    return 1;
  }

  if ((volatility1h ?? 0) >= HIGH_VOLATILITY_THRESHOLD) {
    return 0.8;
  }

  if ((volatility1h ?? 0) <= LOW_VOLATILITY_THRESHOLD) {
    return 1.1;
  }

  return 1;
};

const resolveRiskAdjustment = (row: ScreenerRow | undefined): number => {
  const nearestDistancePct = row?.risk.liquidationDistance.nearestDistancePct;
  if (Number.isFinite(nearestDistancePct)) {
    if ((nearestDistancePct ?? 0) <= 3) {
      return 0.4;
    }

    if ((nearestDistancePct ?? 0) <= 7) {
      return 0.7;
    }

    return 1;
  }

  if (row?.riskLevel === "CRITICAL") {
    return 0.4;
  }

  if (row?.riskLevel === "HIGH") {
    return 0.7;
  }

  if (row?.riskLevel === "MEDIUM") {
    return 0.85;
  }

  return 1;
};

const resolveTier = (executionScore: number): ExecutionState["tier"] => {
  if (executionScore > 0.7) {
    return "A_TIER";
  }

  if (executionScore > 0.4) {
    return "B_TIER";
  }

  return "IGNORE";
};

export class ExecutionIntelligenceEngine {
  build(input: {
    regime: RegimeState[];
    regimeLearning: RegimeLearningPayload | null | undefined;
    rows: ScreenerRow[];
  }): ExecutionState[] {
    const learningBySymbol = new Map<string, RegimeLearningState>(
      (input.regimeLearning?.symbols ?? []).map((item) => [item.symbol, item])
    );
    const rowBySymbol = new Map<string, ScreenerRow>(
      input.rows.map((row) => [row.symbol, row] as const)
    );

    return input.regime
      .map((regime) => {
        const learning = learningBySymbol.get(regime.symbol);
        const row = rowBySymbol.get(regime.symbol);
        const regimeWeight = clamp(Math.abs(regime.finalScore), 0, 1);
        const learningWeight = clamp(
          ((learning?.confidence ?? regime.confidence) / 100) *
            clamp((learning?.stability ?? 0) / 100, 0, 1),
          0,
          1
        );
        const expectancyWeight = clamp((learning?.expectancy ?? 0) + 1, 0, 2);
        const volatilityAdjustment = resolveVolatilityAdjustment(row);
        const riskAdjustment = resolveRiskAdjustment(row);
        const executionScore = round(
          clamp(regimeWeight * learningWeight * expectancyWeight, 0, 1.5),
          4
        );
        const priorityScore = round(
          clamp(executionScore * volatilityAdjustment, 0, 1.65),
          4
        );
        const suggestedSizeMultiplier = round(
          clamp(
            ((learning?.confidence ?? regime.confidence) / 100) *
              clamp(expectancyWeight / 2, 0, 1) *
              riskAdjustment,
            0,
            1
          ),
          4
        );

        return {
          symbol: regime.symbol,
          bias: regime.bias,
          executionScore,
          priorityScore,
          tier: resolveTier(executionScore),
          suggestedSizeMultiplier,
          reasoning: {
            regimeWeight: round(regimeWeight, 4),
            learningWeight: round(learningWeight, 4),
            expectancyWeight: round(expectancyWeight, 4)
          }
        };
      })
      .sort((left, right) => {
        return (
          right.priorityScore - left.priorityScore ||
          right.executionScore - left.executionScore ||
          left.symbol.localeCompare(right.symbol)
        );
      });
  }
}
