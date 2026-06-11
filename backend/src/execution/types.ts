import type { RegimeBias } from "../regime/types";

export type ExecutionTier = "A_TIER" | "B_TIER" | "IGNORE";

export interface ExecutionReasoning {
  regimeWeight: number;
  learningWeight: number;
  expectancyWeight: number;
}

export interface ExecutionState {
  symbol: string;
  bias: RegimeBias;
  executionScore: number;
  priorityScore: number;
  tier: ExecutionTier;
  suggestedSizeMultiplier: number;
  reasoning: ExecutionReasoning;
}
