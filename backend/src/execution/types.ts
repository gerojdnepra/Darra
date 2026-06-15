import type { RegimeBias } from "../regime/types";

export type ExecutionTier = "A_TIER" | "B_TIER" | "IGNORE";
export type ExecutionCommandType = "LIVE" | "PAPER";
export type ExecutionResultStatus = "SUCCESS" | "FAILED" | "REJECTED";

export interface ExecutionCommand {
  type: ExecutionCommandType;
  intentId: string;
  decisionId: string | null;
  symbol: string;
  quantity: number;
  metadata: Readonly<Record<string, unknown>>;
}

export interface ExecutionResult {
  executionId: string;
  status: ExecutionResultStatus;
  lifecycleId: string | null;
  auditId: string | null;
}

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
