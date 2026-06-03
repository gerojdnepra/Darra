import type { AllocationTier } from "../allocation/types";
import type { ExecutionTier } from "../execution/types";
import type { RegimeBias } from "../regime/types";

export type TradePermission = "ALLOWED" | "REDUCED" | "BLOCKED";
export type MarketMode = "NORMAL" | "RISK_OFF" | "DEGRADED" | "EXTREME_UNCERTAINTY";
export type OverrideState = "NONE" | "FORCED_NEUTRAL";

export interface MetaRegimeGovernorExecutionOverlay {
  symbol: string;
  bias: RegimeBias;
  tier: ExecutionTier;
  executionScore: number;
  dampenedExecutionScore: number;
  suggestedSizeMultiplier: number;
  dampenedSuggestedSizeMultiplier: number;
}

export interface MetaRegimeGovernorAllocationOverlay {
  symbol: string;
  tier: AllocationTier;
  weight: number;
  dampenedWeight: number;
  suggestedSize: number;
  dampenedSuggestedSize: number;
}

export interface MetaRegimeGovernorDiagnostics {
  leadRegimeBias: RegimeBias;
  effectiveRegimeBias: RegimeBias;
  signalHealthScore: number;
  signalDecayPressure: number;
  regimeConfidence: number;
  regimeLearningAccuracy: number;
  regimeLearningStability: number;
  executionScore: number;
  conflictIndex: number;
  allocationConcentration: number;
  riskStress: number;
  fundingPressure: number;
  fundingExtremeRatio: number;
  marketFlowInstability: number;
  liquidationStress: number;
}

export interface MetaRegimeGovernorState {
  generatedAt: number;
  sts: number;
  tradePermission: TradePermission;
  marketMode: MarketMode;
  overrideMode: OverrideState;
  systemDampener: number;
  overlayMultiplier: number;
  diagnostics: MetaRegimeGovernorDiagnostics;
  overlays: {
    execution: MetaRegimeGovernorExecutionOverlay[];
    allocation: MetaRegimeGovernorAllocationOverlay[];
  };
}
