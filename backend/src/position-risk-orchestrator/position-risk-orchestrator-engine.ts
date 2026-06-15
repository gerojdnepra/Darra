import { clamp, round } from "../lib/math";
import type { AllocationState } from "../allocation/types";
import type { ConflictState } from "../conflict/types";
import type { ExecutionState } from "../execution/types";
import type { MetaRegimeGovernorState } from "../meta-regime-governor/types";
import type { RegimePredictionState } from "../regime-prediction/types";
import { evaluateRiskAuthorityAccount } from "../risk/risk-authority";
import type { RiskState } from "../risk/types";
import type { BinanceAccountRiskSnapshot } from "../services/binance-account-stream";
import type { SignalIntelligenceState } from "../signal-intelligence/types";
import type { Bias, ScreenerRow } from "../types/messages";
import type {
  PositionRiskCapacityItem,
  PositionRiskOrchestratorState
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

const normalizeBias = (value: string | null | undefined): Bias =>
  value === "LONG" || value === "SHORT" ? value : "NEUTRAL";

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
    const authority = evaluateRiskAuthorityAccount({
      generatedAt: input.generatedAt,
      risk: input.risk,
      walletBalanceUsd: input.account.balances.walletBalanceUsd,
      availableBalanceUsd: input.account.balances.availableBalanceUsd,
      marginBalanceUsd: input.account.balances.marginBalanceUsd,
      totalInitialMarginUsd: input.account.balances.totalInitialMarginUsd,
      totalMaintMarginUsd: input.account.balances.totalMaintMarginUsd,
      totalUnrealizedPnlUsd: input.account.balances.totalUnrealizedPnlUsd,
      tradePermission: input.metaRegimeGovernor.tradePermission,
      marketMode: input.metaRegimeGovernor.marketMode,
      systemDampener: input.metaRegimeGovernor.systemDampener,
      overlayMultiplier: input.metaRegimeGovernor.overlayMultiplier
    });
    const accountRiskLoad = authority.accountRiskLoad;
    const riskBudgetLeft = authority.riskBudgetLeft;
    const marginStressScore = authority.marginSafety.marginStressScore;
    const safeToAddPosition = authority.canAddPosition;
    const globalRiskMultiplier = authority.maxExposure.globalRiskMultiplier;

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
        marginUsagePct: authority.marginSafety.marginUsagePct,
        maintenanceMarginRatio: authority.marginSafety.maintenanceMarginRatio,
        availableBalancePct: authority.marginSafety.availableBalancePct,
        stressLevel: authority.marginSafety.marginStressLevel
      },
      liquidationStress: {
        minDistancePct: authority.liquidationSafety.minDistancePct,
        avgDistancePct: authority.liquidationSafety.avgDistancePct,
        criticalPositions: authority.liquidationSafety.criticalPositions,
        warningPositions: authority.liquidationSafety.warningPositions,
        stressLevel: authority.liquidationSafety.liquidationStressLevel
      },
      killSwitchState: authority.killSwitch,
      safeToAddPosition,
      globalRiskMultiplier,
      positionCapacity
    };
  }
}
