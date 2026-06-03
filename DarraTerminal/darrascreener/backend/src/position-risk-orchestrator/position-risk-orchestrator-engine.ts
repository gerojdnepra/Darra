import { clamp, round } from "../lib/math";
import type { AllocationState } from "../allocation/types";
import type { ConflictState } from "../conflict/types";
import type { ExecutionState } from "../execution/types";
import type { MetaRegimeGovernorState } from "../meta-regime-governor/types";
import type { RegimePredictionState } from "../regime-prediction/types";
import type { RiskPositionState, RiskState } from "../risk/types";
import type { BinanceAccountRiskSnapshot } from "../services/binance-account-stream";
import type { SignalIntelligenceState } from "../signal-intelligence/types";
import type { Bias, ScreenerRow } from "../types/messages";
import type {
  PositionRiskCapacityItem,
  PositionRiskKillSwitchState,
  PositionRiskOrchestratorState,
  PositionRiskStressLevel
} from "./types";

interface PositionRiskOrchestratorInput {
  generatedAt: number;
  account: BinanceAccountRiskSnapshot;
  risk: RiskState;
  execution: ExecutionState[];
  allocation: AllocationState[];
  conflict: ConflictState[];
  signalIntelligence: SignalIntelligenceState[];
  metaRegimeGovernor: MetaRegimeGovernorState;
  regimePrediction: RegimePredictionState;
  rows: ScreenerRow[];
}

const toPct = (value: number | null | undefined, total: number | null | undefined): number => {
  if (
    value === null ||
    value === undefined ||
    total === null ||
    total === undefined ||
    !Number.isFinite(value) ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    return 0;
  }

  return round((value / total) * 100, 2);
};

const normalizeBias = (value: string | null | undefined): Bias =>
  value === "LONG" || value === "SHORT" ? value : "NEUTRAL";

const average = (values: Array<number | null | undefined>): number | null => {
  const numericValues = values.filter((value): value is number => typeof value === "number");
  if (numericValues.length === 0) {
    return null;
  }

  return numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
};

const resolveStressLevel = (score: number): PositionRiskStressLevel => {
  if (score >= 85) {
    return "EXTREME";
  }
  if (score >= 65) {
    return "HIGH";
  }
  if (score >= 35) {
    return "MEDIUM";
  }
  return "LOW";
};

const resolveLiquidationScore = (position: RiskPositionState): number => {
  const distancePct = position.distancePct;
  const riskLevelPenalty =
    position.riskLevel === "critical" ? 100 : position.riskLevel === "warning" ? 65 : 20;

  if (distancePct === null || !Number.isFinite(distancePct)) {
    return riskLevelPenalty;
  }

  const distancePenalty =
    distancePct <= 1.5
      ? 100
      : distancePct <= 3
        ? 88
        : distancePct <= 5
          ? 72
          : distancePct <= 8
            ? 50
            : distancePct <= 12
              ? 30
              : 12;

  return round(clamp(distancePenalty * 0.7 + riskLevelPenalty * 0.3, 0, 100), 2);
};

const resolveKillSwitchState = (input: {
  accountRiskLoad: number;
  criticalPositions: number;
  warningPositions: number;
  marginStressLevel: PositionRiskStressLevel;
  liquidationStressLevel: PositionRiskStressLevel;
  tradePermission: MetaRegimeGovernorState["tradePermission"];
  marketMode: MetaRegimeGovernorState["marketMode"];
}): PositionRiskKillSwitchState => {
  if (
    input.tradePermission === "BLOCKED" ||
    input.marketMode === "EXTREME_UNCERTAINTY" ||
    input.accountRiskLoad >= 92 ||
    input.criticalPositions >= 2
  ) {
    return "EMERGENCY";
  }

  if (
    input.accountRiskLoad >= 82 ||
    input.marginStressLevel === "EXTREME" ||
    input.liquidationStressLevel === "EXTREME"
  ) {
    return "REDUCE_RISK";
  }

  if (
    input.accountRiskLoad >= 68 ||
    input.tradePermission === "REDUCED" ||
    input.criticalPositions >= 1
  ) {
    return "STOP_ADDING";
  }

  if (
    input.accountRiskLoad >= 45 ||
    input.warningPositions >= 2 ||
    input.marginStressLevel === "HIGH" ||
    input.liquidationStressLevel === "HIGH"
  ) {
    return "CAUTION";
  }

  return "NORMAL";
};

const resolveGlobalRiskMultiplier = (
  killSwitchState: PositionRiskKillSwitchState,
  overlayMultiplier: number,
  riskBudgetLeft: number
): number => {
  const killSwitchMultiplier =
    killSwitchState === "EMERGENCY"
      ? 0
      : killSwitchState === "REDUCE_RISK"
        ? 0.2
        : killSwitchState === "STOP_ADDING"
          ? 0
          : killSwitchState === "CAUTION"
            ? 0.5
            : 1;

  const budgetMultiplier = clamp(riskBudgetLeft / 100, 0, 1);
  return round(clamp(killSwitchMultiplier * clamp(overlayMultiplier, 0, 1) * budgetMultiplier, 0, 1), 4);
};

const buildCapacityReason = (input: {
  safeToAdd: boolean;
  capacityScore: number;
  conflictPenalty: number;
  governorPenalty: number;
  liquidationStress: number;
  symbol: string;
}): string => {
  if (!input.safeToAdd) {
    if (input.governorPenalty >= 70) {
      return `${input.symbol}: governor overlay is suppressing new risk.`;
    }
    if (input.liquidationStress >= 70) {
      return `${input.symbol}: liquidation stress is too high for fresh exposure.`;
    }
    if (input.conflictPenalty >= 55) {
      return `${input.symbol}: signal conflict penalty is too high.`;
    }
    return `${input.symbol}: account risk budget is nearly exhausted.`;
  }

  if (input.capacityScore >= 75) {
    return `${input.symbol}: best relative capacity candidate right now.`;
  }
  if (input.capacityScore >= 55) {
    return `${input.symbol}: acceptable only with reduced sizing.`;
  }
  return `${input.symbol}: keep sizing small and monitor stress closely.`;
};

export class PositionRiskOrchestratorEngine {
  build(input: PositionRiskOrchestratorInput): PositionRiskOrchestratorState {
    const walletBalanceUsd =
      input.account.balances.walletBalanceUsd ?? input.risk.summary.walletBalanceUsd.value ?? 0;
    const availableBalanceUsd =
      input.account.balances.availableBalanceUsd ?? input.risk.summary.availableBalanceUsd.value ?? 0;
    const marginBalanceUsd =
      input.account.balances.marginBalanceUsd ?? input.risk.summary.marginBalanceUsd.value ?? 0;
    const totalInitialMarginUsd =
      input.account.balances.totalInitialMarginUsd ??
      round(input.risk.positions.reduce((sum, position) => sum + position.initialMarginUsd, 0), 2);
    const totalMaintMarginUsd =
      input.account.balances.totalMaintMarginUsd ??
      round(input.risk.positions.reduce((sum, position) => sum + position.maintMarginUsd, 0), 2);
    const totalUnrealizedPnlUsd =
      input.account.balances.totalUnrealizedPnlUsd ?? input.risk.summary.unrealizedPnlUsd.value ?? 0;

    const marginUsagePct = round(
      input.risk.summary.marginUsagePct.value ?? toPct(totalInitialMarginUsd, marginBalanceUsd),
      2
    );
    const maintenanceMarginRatio = round(toPct(totalMaintMarginUsd, marginBalanceUsd), 2);
    const availableBalancePct = round(toPct(availableBalanceUsd, marginBalanceUsd), 2);

    const marginUsageScore = clamp((marginUsagePct / 100) * 100, 0, 100);
    const maintenancePressureScore = clamp((maintenanceMarginRatio / 12) * 100, 0, 100);
    const availableBalanceDepletionScore = clamp(100 - availableBalancePct, 0, 100);
    const drawdownPressureScore =
      totalUnrealizedPnlUsd < 0
        ? clamp((Math.abs(totalUnrealizedPnlUsd) / Math.max(walletBalanceUsd || marginBalanceUsd || 1, 1)) * 100, 0, 100)
        : 0;
    const governorPenaltyScore = round(clamp(input.metaRegimeGovernor.systemDampener * 100, 0, 100), 2);

    const minDistancePct =
      input.risk.positions.length > 0
        ? input.risk.positions.reduce<number | null>((closest, position) => {
            if (position.distancePct === null || !Number.isFinite(position.distancePct)) {
              return closest;
            }
            if (closest === null) {
              return position.distancePct;
            }
            return Math.min(closest, position.distancePct);
          }, null)
        : null;
    const avgDistancePct = average(input.risk.positions.map((position) => position.distancePct));
    const criticalPositions = input.risk.positions.filter((position) => position.riskLevel === "critical").length;
    const warningPositions = input.risk.positions.filter((position) => position.riskLevel === "warning").length;

    const positionLiquidationScores = input.risk.positions.map(resolveLiquidationScore);
    const averageLiquidationScore = average(positionLiquidationScores) ?? 0;
    const liquidationStressScore = round(
      clamp(
        averageLiquidationScore +
          criticalPositions * 12 +
          warningPositions * 4,
        0,
        100
      ),
      2
    );

    const marginStressScore = round(
      clamp(
        marginUsageScore * 0.5 +
          maintenancePressureScore * 0.3 +
          availableBalanceDepletionScore * 0.2,
        0,
        100
      ),
      2
    );

    const accountRiskLoad = round(
      clamp(
        marginUsageScore * 0.25 +
          maintenancePressureScore * 0.2 +
          availableBalanceDepletionScore * 0.1 +
          liquidationStressScore * 0.2 +
          drawdownPressureScore * 0.1 +
          governorPenaltyScore * 0.15,
        0,
        100
      ),
      2
    );
    const riskBudgetLeft = round(clamp(100 - accountRiskLoad, 0, 100), 2);

    const marginStressLevel = resolveStressLevel(marginStressScore);
    const liquidationStressLevel = resolveStressLevel(liquidationStressScore);

    const killSwitchState = resolveKillSwitchState({
      accountRiskLoad,
      criticalPositions,
      warningPositions,
      marginStressLevel,
      liquidationStressLevel,
      tradePermission: input.metaRegimeGovernor.tradePermission,
      marketMode: input.metaRegimeGovernor.marketMode
    });
    const safeToAddPosition =
      killSwitchState === "NORMAL" || killSwitchState === "CAUTION";
    const globalRiskMultiplier = resolveGlobalRiskMultiplier(
      killSwitchState,
      input.metaRegimeGovernor.overlayMultiplier,
      riskBudgetLeft
    );

    const executionBySymbol = new Map(input.execution.map((item) => [item.symbol, item] as const));
    const allocationBySymbol = new Map(input.allocation.map((item) => [item.symbol, item] as const));
    const conflictBySymbol = new Map(input.conflict.map((item) => [item.symbol, item] as const));
    const signalBySymbol = new Map(
      input.signalIntelligence.map((item) => [item.symbol, item] as const)
    );
    const openPositionSymbols = new Set(input.risk.positions.map((position) => position.symbol));

    const positionCapacity: PositionRiskCapacityItem[] = input.rows
      .filter((row) => !openPositionSymbols.has(row.symbol))
      .slice(0, 24)
      .map((row) => {
        const execution = executionBySymbol.get(row.symbol);
        const allocation = allocationBySymbol.get(row.symbol);
        const conflict = conflictBySymbol.get(row.symbol);
        const signal = signalBySymbol.get(row.symbol);

        const symbolLiquidationStress = clamp(
          row.risk.liquidationDistance.nearestDistancePct === null
            ? 35
            : 100 - clamp(row.risk.liquidationDistance.nearestDistancePct * 7.5, 0, 100),
          0,
          100
        );
        const conflictPenalty = round(clamp((conflict?.conflictIndex ?? 0.5) * 100, 0, 100), 2);
        const governorPenalty = round(clamp((1 - input.metaRegimeGovernor.overlayMultiplier) * 100, 0, 100), 2);

        const baseQualityScore = clamp(
          (execution?.executionScore ?? 0) * 35 +
            (allocation?.weight ?? 0) * 35 +
            ((signal?.adjustedSystemConfidence ?? 0) / 100) * 20 +
            (100 - row.riskScore) * 0.1,
          0,
          100
        );

        const capacityScore = round(
          clamp(
            baseQualityScore * 0.45 +
              riskBudgetLeft * 0.2 +
              (100 - marginStressScore) * 0.15 +
              (100 - symbolLiquidationStress) * 0.1 +
              (100 - conflictPenalty) * 0.05 +
              (100 - governorPenalty) * 0.05,
            0,
            100
          ),
          2
        );

        const recommendedSizeMultiplier = round(
          clamp(
            globalRiskMultiplier *
              clamp(capacityScore / 100, 0, 1) *
              clamp((execution?.suggestedSizeMultiplier ?? 0.5), 0, 1),
            0,
            1
          ),
          4
        );

        const safeSymbolToAdd =
          safeToAddPosition &&
          capacityScore >= 45 &&
          symbolLiquidationStress < 70 &&
          conflictPenalty < 65 &&
          governorPenalty < 85;

        return {
          symbol: row.symbol,
          bias: normalizeBias(execution?.bias ?? row.bias),
          capacityScore,
          recommendedSizeMultiplier,
          safeToAdd: safeSymbolToAdd,
          reason: buildCapacityReason({
            safeToAdd: safeSymbolToAdd,
            capacityScore,
            conflictPenalty,
            governorPenalty,
            liquidationStress: symbolLiquidationStress,
            symbol: row.symbol
          }),
          constraints: {
            accountRisk: accountRiskLoad,
            marginStress: marginStressScore,
            liquidationStress: round(symbolLiquidationStress, 2),
            conflictPenalty,
            governorPenalty
          }
        };
      })
      .sort((left, right) => {
        return (
          Number(right.safeToAdd) - Number(left.safeToAdd) ||
          right.capacityScore - left.capacityScore ||
          right.recommendedSizeMultiplier - left.recommendedSizeMultiplier ||
          left.symbol.localeCompare(right.symbol)
        );
      })
      .slice(0, 12);

    return {
      accountRiskLoad,
      riskBudgetLeft,
      marginStress: {
        marginUsagePct,
        maintenanceMarginRatio,
        availableBalancePct,
        stressLevel: marginStressLevel
      },
      liquidationStress: {
        minDistancePct: minDistancePct !== null ? round(minDistancePct, 3) : null,
        avgDistancePct: avgDistancePct !== null ? round(avgDistancePct, 3) : null,
        criticalPositions,
        warningPositions,
        stressLevel: liquidationStressLevel
      },
      killSwitchState,
      safeToAddPosition,
      globalRiskMultiplier,
      positionCapacity
    };
  }
}
