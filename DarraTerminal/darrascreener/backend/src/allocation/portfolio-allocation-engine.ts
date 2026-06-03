import { clamp, round } from "../lib/math";
import type { ConflictState } from "../conflict/types";
import type { ExecutionState } from "../execution/types";
import type { RegimeState } from "../regime/types";
import type { RegimeLearningPayload, RegimeLearningState } from "../regime-learning/types";
import type { AllocationState } from "./types";

const RISK_BUDGET = 1;

const resolveTier = (weight: number): AllocationState["tier"] => {
  if (weight >= 0.2) {
    return "A";
  }

  if (weight >= 0.08) {
    return "B";
  }

  return "C";
};

export class PortfolioAllocationEngine {
  build(input: {
    execution: ExecutionState[];
    regime: RegimeState[];
    regimeLearning: RegimeLearningPayload | null | undefined;
    conflict: ConflictState[];
  }): AllocationState[] {
    const regimeBySymbol = new Map<string, RegimeState>(
      input.regime.map((item) => [item.symbol, item] as const)
    );
    const learningBySymbol = new Map<string, RegimeLearningState>(
      (input.regimeLearning?.symbols ?? []).map((item) => [item.symbol, item] as const)
    );
    const conflictBySymbol = new Map<string, ConflictState>(
      input.conflict.map((item) => [item.symbol, item] as const)
    );

    const candidates = input.execution
      .map((execution) => {
        const regime = regimeBySymbol.get(execution.symbol);
        const learning = learningBySymbol.get(execution.symbol);
        const conflict = conflictBySymbol.get(execution.symbol);
        const executionWeight = clamp(execution.executionScore, 0, 1.5);
        const confidenceWeight = clamp((regime?.confidence ?? 0) / 100, 0, 1);
        const expectancyWeight = clamp((learning?.expectancy ?? 0) + 1, 0, 2) / 2;
        const stabilityWeight = clamp((learning?.stability ?? 0) / 100, 0, 1);
        const consensusWeight = clamp(conflict?.consensusScore ?? 0, 0, 1);
        const allocationScore = round(
          clamp(
            executionWeight *
              confidenceWeight *
              expectancyWeight *
              stabilityWeight *
              consensusWeight,
            0,
            1
          ),
          6
        );

        return {
          symbol: execution.symbol,
          allocationScore,
          reasoning: {
            execution: round(executionWeight, 4),
            confidence: round(confidenceWeight, 4),
            expectancy: round(expectancyWeight, 4),
            consensus: round(consensusWeight, 4)
          }
        };
      })
      .filter((item) => item.allocationScore > 0);

    const total = candidates.reduce((sum, item) => sum + item.allocationScore, 0);

    return candidates
      .map((item) => {
        const weight = total > 0 ? item.allocationScore / total : 0;
        const suggestedSize = weight * RISK_BUDGET;

        return {
          symbol: item.symbol,
          allocationScore: round(item.allocationScore, 6),
          weight: round(weight, 6),
          suggestedSize: round(suggestedSize, 6),
          tier: resolveTier(weight),
          reasoning: item.reasoning
        };
      })
      .sort((left, right) => {
        return (
          right.weight - left.weight ||
          right.allocationScore - left.allocationScore ||
          left.symbol.localeCompare(right.symbol)
        );
      });
  }
}
