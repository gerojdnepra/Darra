import type { Bias } from "../types/messages";

export type PositionRiskStressLevel = "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
export type PositionRiskKillSwitchState =
  | "NORMAL"
  | "CAUTION"
  | "STOP_ADDING"
  | "REDUCE_RISK"
  | "EMERGENCY";

export interface PositionRiskMarginStress {
  marginUsagePct: number;
  maintenanceMarginRatio: number;
  availableBalancePct: number;
  stressLevel: PositionRiskStressLevel;
}

export interface PositionRiskLiquidationStress {
  minDistancePct: number | null;
  avgDistancePct: number | null;
  criticalPositions: number;
  warningPositions: number;
  stressLevel: PositionRiskStressLevel;
}

export interface PositionRiskCapacityConstraints {
  accountRisk: number;
  marginStress: number;
  liquidationStress: number;
  conflictPenalty: number;
  governorPenalty: number;
}

export interface PositionRiskCapacityItem {
  symbol: string;
  bias: Bias;
  capacityScore: number;
  recommendedSizeMultiplier: number;
  safeToAdd: boolean;
  reason: string;
  constraints: PositionRiskCapacityConstraints;
}

export interface PositionRiskOrchestratorState {
  accountRiskLoad: number;
  riskBudgetLeft: number;
  marginStress: PositionRiskMarginStress;
  liquidationStress: PositionRiskLiquidationStress;
  killSwitchState: PositionRiskKillSwitchState;
  safeToAddPosition: boolean;
  globalRiskMultiplier: number;
  positionCapacity: PositionRiskCapacityItem[];
}
