import type { AllocationState } from "../allocation/types";
import type { ConflictState } from "../conflict/types";
import type { ExecutionState } from "../execution/types";
import type { FundingSymbolState } from "../funding/types";
import { clamp, round } from "../lib/math";
import type { LiquidationsDashboardPayload } from "../liquidations/types";
import type { MarketFlowState } from "../market-flow/types";
import type { RegimeState } from "../regime/types";
import type { RegimeLearningPayload } from "../regime-learning/types";
import type { RiskState } from "../risk/types";
import type { SignalIntelligenceState } from "../signal-intelligence/types";
import type {
  MarketMode,
  MetaRegimeGovernorState,
  OverrideState,
  TradePermission
} from "./types";

const TOP_SLICE = 8;
const CONFLICT_OVERRIDE_THRESHOLD = 0.6;
const SIGNAL_DECAY_OVERRIDE_THRESHOLD = 0.7;
const LIQUIDATION_STRESS_OVERRIDE_THRESHOLD = 70;

const average = (values: Array<number | null | undefined>, fallback: number): number => {
  const numericValues = values.filter((value): value is number => typeof value === "number");
  if (numericValues.length === 0) {
    return fallback;
  }

  return numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
};

const averageTop = <T>(
  values: T[],
  selector: (value: T) => number | null | undefined,
  fallback: number
): number => average(values.slice(0, TOP_SLICE).map(selector), fallback);

const computeAllocationConcentration = (allocations: AllocationState[]): number => {
  const weights = allocations
    .map((item) => Math.max(item.weight, 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (weights.length <= 1) {
    return weights.length === 1 ? 1 : 0.5;
  }

  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  if (totalWeight <= 0) {
    return 0.5;
  }

  const normalizedWeights = weights.map((value) => value / totalWeight);
  const hhi = normalizedWeights.reduce((sum, value) => sum + value * value, 0);
  const equalWeightHhi = 1 / normalizedWeights.length;

  return clamp((hhi - equalWeightHhi) / (1 - equalWeightHhi), 0, 1);
};

const computeFundingExtremeRatio = (funding: FundingSymbolState[], risk: RiskState): number => {
  if (funding.length === 0) {
    return risk.funding.extremeSymbols.length > 0 ? 1 : 0.5;
  }

  const extremeSymbols = new Set(risk.funding.extremeSymbols);
  const extremeCount = funding
    .slice(0, TOP_SLICE)
    .filter(
      (item) =>
        extremeSymbols.has(item.symbol) ||
        Math.abs(item.annualizedFunding) >= 0.6 ||
        Math.abs(item.basisPct) >= 2
    ).length;

  return clamp(extremeCount / Math.min(funding.length, TOP_SLICE), 0, 1);
};

const computeMarketFlowInstability = (marketFlow: MarketFlowState[], risk: RiskState): number => {
  if (marketFlow.length === 0) {
    return clamp(Math.abs(risk.flow.aggregatePressureScore) / 100, 0, 1);
  }

  const oiInstability = averageTop(
    marketFlow,
    (row) =>
      clamp(
        Math.abs(row.openInterest.oiChange5m) / 8 * 0.5 +
          Math.abs(row.openInterest.oiChange15m) / 12 * 0.3 +
          Math.abs(row.openInterest.oiChange1h) / 20 * 0.2,
        0,
        1
      ),
    0.5
  );
  const divergenceRatio = averageTop(
    marketFlow,
    (row) => (row.cvd.divergence === "none" ? 0 : 1),
    0.5
  );
  const aggregatePressure = clamp(Math.abs(risk.flow.aggregatePressureScore) / 100, 0, 1);

  return round(
    clamp(oiInstability * 0.55 + divergenceRatio * 0.25 + aggregatePressure * 0.2, 0, 1),
    4
  );
};

const computeFundingPressure = (funding: FundingSymbolState[], risk: RiskState): number => {
  const pressureScore = clamp(risk.funding.annualizedPressureScore / 100, 0, 1);
  const extremeRatio = computeFundingExtremeRatio(funding, risk);

  return round(clamp(pressureScore * 0.7 + extremeRatio * 0.3, 0, 1), 4);
};

const computeRiskStress = (risk: RiskState): number => {
  const aggregateRisk = clamp(risk.riskScore / 100, 0, 1);
  const liquidationStress = clamp(risk.liquidationDistance.averagePressureIndex / 100, 0, 1);
  const marginStress = clamp((risk.summary.marginUsagePct.value ?? 0) / 100, 0, 1);

  return round(
    clamp(aggregateRisk * 0.55 + liquidationStress * 0.25 + marginStress * 0.2, 0, 1),
    4
  );
};

const resolveTradePermission = (sts: number): TradePermission => {
  if (sts > 70) {
    return "ALLOWED";
  }

  if (sts >= 40) {
    return "REDUCED";
  }

  return "BLOCKED";
};

const resolveMarketMode = (sts: number): MarketMode => {
  if (sts > 75) {
    return "NORMAL";
  }

  if (sts >= 55) {
    return "RISK_OFF";
  }

  if (sts >= 30) {
    return "DEGRADED";
  }

  return "EXTREME_UNCERTAINTY";
};

const resolveOverrideMode = (
  conflictIndex: number,
  signalDecayPressure: number,
  risk: RiskState,
  liquidations: LiquidationsDashboardPayload | undefined
): OverrideState => {
  const liquidationSpikeDetected =
    risk.liquidationDistance.averagePressureIndex >= LIQUIDATION_STRESS_OVERRIDE_THRESHOLD ||
    (liquidations?.heatRanking ?? []).some(
      (entry) => entry.heat === "high" || entry.heat === "extreme"
    );

  return conflictIndex > CONFLICT_OVERRIDE_THRESHOLD &&
    signalDecayPressure > SIGNAL_DECAY_OVERRIDE_THRESHOLD &&
    liquidationSpikeDetected
    ? "FORCED_NEUTRAL"
    : "NONE";
};

export class MetaRegimeGovernorEngine {
  build(input: {
    generatedAt: number;
    signalIntelligence: SignalIntelligenceState[];
    regime: RegimeState[];
    regimeLearning: RegimeLearningPayload | null | undefined;
    execution: ExecutionState[];
    conflict: ConflictState[];
    allocation: AllocationState[];
    marketFlow: MarketFlowState[];
    funding: FundingSymbolState[];
    risk: RiskState;
    liquidations?: LiquidationsDashboardPayload;
  }): MetaRegimeGovernorState {
    const signalHealthScore = averageTop(input.signalIntelligence, (item) => item.shs, 50);
    const signalDecayPressure = averageTop(input.signalIntelligence, (item) => item.sdp, 0.5);
    const regimeConfidence = averageTop(input.regime, (item) => item.confidence, 50);
    const regimeLearningAccuracy = averageTop(
      input.regimeLearning?.symbols ?? [],
      (item) => item.accuracy,
      50
    );
    const regimeLearningStability = averageTop(
      input.regimeLearning?.symbols ?? [],
      (item) => item.stability,
      50
    );
    const executionScore = averageTop(input.execution, (item) => item.executionScore * 100, 50);
    const conflictIndex = averageTop(input.conflict, (item) => item.conflictIndex, 0.5);
    const allocationConcentration = computeAllocationConcentration(input.allocation);
    const riskStress = computeRiskStress(input.risk);
    const fundingPressure = computeFundingPressure(input.funding, input.risk);
    const fundingExtremeRatio = computeFundingExtremeRatio(input.funding, input.risk);
    const marketFlowInstability = computeMarketFlowInstability(input.marketFlow, input.risk);
    const liquidationStress = clamp(input.risk.liquidationDistance.averagePressureIndex, 0, 100);

    const regimeTrust = clamp(
      regimeConfidence / 100 * 0.75 +
        regimeLearningAccuracy / 100 * 0.1 +
        regimeLearningStability / 100 * 0.15,
      0,
      1
    );
    const signalTrust = clamp(signalHealthScore / 100, 0, 1);
    const inverseConflict = clamp(1 - conflictIndex, 0, 1);
    const allocationTrust = clamp(1 - allocationConcentration, 0, 1);
    const riskTrust = clamp(1 - riskStress, 0, 1);
    const fundingTrust = clamp(1 - fundingPressure, 0, 1);
    const marketFlowTrust = clamp(1 - marketFlowInstability, 0, 1);

    const sts = round(
      clamp(
        (
          signalTrust * 0.3 +
          regimeTrust * 0.15 +
          inverseConflict * 0.15 +
          allocationTrust * 0.1 +
          riskTrust * 0.15 +
          fundingTrust * 0.1 +
          marketFlowTrust * 0.05
        ) * 100,
        0,
        100
      ),
      2
    );

    const tradePermission = resolveTradePermission(sts);
    const marketMode = resolveMarketMode(sts);
    const overrideMode = resolveOverrideMode(
      conflictIndex,
      signalDecayPressure,
      input.risk,
      input.liquidations
    );
    const systemDampener = round(clamp(1 - sts / 100, 0, 1), 4);
    const overlayMultiplier = round(clamp(1 - systemDampener, 0, 1), 4);
    const leadRegimeBias = input.regime[0]?.bias ?? "NEUTRAL";
    const effectiveRegimeBias = overrideMode === "FORCED_NEUTRAL" ? "NEUTRAL" : leadRegimeBias;

    return {
      generatedAt: input.generatedAt,
      sts,
      tradePermission,
      marketMode,
      overrideMode,
      systemDampener,
      overlayMultiplier,
      diagnostics: {
        leadRegimeBias,
        effectiveRegimeBias,
        signalHealthScore: round(signalHealthScore, 2),
        signalDecayPressure: round(signalDecayPressure, 4),
        regimeConfidence: round(regimeConfidence, 2),
        regimeLearningAccuracy: round(regimeLearningAccuracy, 2),
        regimeLearningStability: round(regimeLearningStability, 2),
        executionScore: round(executionScore, 2),
        conflictIndex: round(conflictIndex, 4),
        allocationConcentration: round(allocationConcentration, 4),
        riskStress: round(riskStress, 4),
        fundingPressure: round(fundingPressure, 4),
        fundingExtremeRatio: round(fundingExtremeRatio, 4),
        marketFlowInstability: round(marketFlowInstability, 4),
        liquidationStress: round(liquidationStress, 2)
      },
      overlays: {
        execution: input.execution.map((item) => ({
          symbol: item.symbol,
          bias: item.bias,
          tier: item.tier,
          executionScore: item.executionScore,
          dampenedExecutionScore: round(item.executionScore * overlayMultiplier, 4),
          suggestedSizeMultiplier: item.suggestedSizeMultiplier,
          dampenedSuggestedSizeMultiplier: round(
            item.suggestedSizeMultiplier * overlayMultiplier,
            4
          )
        })),
        allocation: input.allocation.map((item) => ({
          symbol: item.symbol,
          tier: item.tier,
          weight: item.weight,
          dampenedWeight: round(item.weight * overlayMultiplier, 6),
          suggestedSize: item.suggestedSize,
          dampenedSuggestedSize: round(item.suggestedSize * overlayMultiplier, 4)
        }))
      }
    };
  }
}
