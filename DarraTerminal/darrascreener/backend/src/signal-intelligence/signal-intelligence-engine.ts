import { clamp, round } from "../lib/math";
import type { AllocationState } from "../allocation/types";
import type { ConflictState } from "../conflict/types";
import type { ExecutionState } from "../execution/types";
import type { FundingSymbolState } from "../funding/types";
import type { LiquidationsDashboardPayload } from "../liquidations/types";
import type { MarketFlowState } from "../market-flow/types";
import type { RegimeState } from "../regime/types";
import type { RegimeLearningPayload, RegimeLearningState } from "../regime-learning/types";
import type { ScreenerRow } from "../types/messages";
import type { SignalIntelligenceState } from "./types";

const sign = (value: number): number => {
  if (value > 0.05) {
    return 1;
  }

  if (value < -0.05) {
    return -1;
  }

  return 0;
};

const resolveFlowConsistency = (flow: MarketFlowState | undefined): number => {
  if (!flow) {
    return 0.5;
  }

  const oiDirection = sign(flow.openInterest.oiChange5m);
  const cvdDirection =
    flow.cvd.divergence === "bullish"
      ? 1
      : flow.cvd.divergence === "bearish"
        ? -1
        : sign(flow.cvd.slope);

  if (oiDirection === 0 && cvdDirection === 0) {
    return 0.55;
  }

  if (oiDirection !== 0 && oiDirection === cvdDirection) {
    return flow.cvd.divergence === "none" ? 0.9 : 1;
  }

  if (oiDirection === 0 || cvdDirection === 0) {
    return 0.45;
  }

  return 0.15;
};

const resolveFundingStability = (funding: FundingSymbolState | undefined): number => {
  if (!funding) {
    return 0.5;
  }

  const fundingPressure = clamp(Math.abs(funding.annualizedFunding) / 120, 0, 1);
  const basisPressure = clamp(Math.abs(funding.basisPct) / 4, 0, 1);
  return round(clamp(1 - fundingPressure * 0.65 - basisPressure * 0.35, 0, 1), 4);
};

const resolveLiquidationNoise = (
  row: ScreenerRow | undefined,
  liquidations: LiquidationsDashboardPayload | undefined,
  symbol: string
): number => {
  const state = liquidations?.bySymbol[symbol];
  if (!row && !state) {
    return 0.5;
  }

  const weightedLiq =
    (state?.liquidations1m ?? 0) * 1 +
    (state?.liquidations5m ?? 0) * 0.8 +
    (state?.liquidations15m ?? 0) * 0.5 +
    (state?.liquidations1h ?? 0) * 0.3;
  const ratio =
    weightedLiq > 0
      ? weightedLiq / Math.max(row?.quoteVolume24h ?? weightedLiq, 1)
      : Math.abs(row?.liquidation5m ?? 0) / Math.max(row?.quoteVolume24h ?? 1, 1);

  return round(clamp(ratio * 50, 0, 1), 4);
};

const resolveOiInstability = (flow: MarketFlowState | undefined): number => {
  if (!flow) {
    return 0.5;
  }

  return round(
    clamp(
      Math.abs(flow.openInterest.oiChange5m) / 8 * 0.5 +
        Math.abs(flow.openInterest.oiChange15m) / 12 * 0.3 +
        Math.abs(flow.openInterest.oiChange1h) / 20 * 0.2,
      0,
      1
    ),
    4
  );
};

const resolveExecutionConsistency = (
  execution: ExecutionState | undefined,
  allocation: AllocationState | undefined
): number => {
  if (!execution && !allocation) {
    return 0.5;
  }

  const scoreComponent = clamp(execution?.executionScore ?? 0, 0, 1);
  const sizeComponent = clamp(execution?.suggestedSizeMultiplier ?? 0, 0, 1);
  const allocationComponent = clamp((allocation?.weight ?? 0) * 5, 0, 1);

  return round(
    clamp(scoreComponent * 0.45 + sizeComponent * 0.25 + allocationComponent * 0.3, 0, 1),
    4
  );
};

const resolveMarketState = (shs: number): SignalIntelligenceState["marketState"] => {
  if (shs > 75) {
    return "STABLE_TREND";
  }

  if (shs > 50) {
    return "TRANSITIONAL";
  }

  if (shs > 25) {
    return "CHOP";
  }

  return "DISORDER";
};

export class SignalIntelligenceEngine {
  build(input: {
    rows: ScreenerRow[];
    funding: FundingSymbolState[];
    marketFlow: MarketFlowState[];
    liquidations?: LiquidationsDashboardPayload;
    regime: RegimeState[];
    regimeLearning: RegimeLearningPayload | null | undefined;
    execution: ExecutionState[];
    conflict: ConflictState[];
    allocation: AllocationState[];
  }): SignalIntelligenceState[] {
    const rowBySymbol = new Map(input.rows.map((row) => [row.symbol, row] as const));
    const fundingBySymbol = new Map(input.funding.map((row) => [row.symbol, row] as const));
    const flowBySymbol = new Map(input.marketFlow.map((row) => [row.symbol, row] as const));
    const learningBySymbol = new Map<string, RegimeLearningState>(
      (input.regimeLearning?.symbols ?? []).map((row) => [row.symbol, row] as const)
    );
    const executionBySymbol = new Map(input.execution.map((row) => [row.symbol, row] as const));
    const conflictBySymbol = new Map(input.conflict.map((row) => [row.symbol, row] as const));
    const allocationBySymbol = new Map(input.allocation.map((row) => [row.symbol, row] as const));

    return input.regime
      .map((regime) => {
        const row = rowBySymbol.get(regime.symbol);
        const funding = fundingBySymbol.get(regime.symbol);
        const flow = flowBySymbol.get(regime.symbol);
        const learning = learningBySymbol.get(regime.symbol);
        const execution = executionBySymbol.get(regime.symbol);
        const conflict = conflictBySymbol.get(regime.symbol);
        const allocation = allocationBySymbol.get(regime.symbol);

        const regimeConfidence = clamp(regime.confidence / 100, 0, 1);
        const learningStability = clamp((learning?.stability ?? 0) / 100, 0, 1);
        const inverseConflict = clamp(1 - (conflict?.conflictIndex ?? 0.5), 0, 1);
        const flowConsistency = resolveFlowConsistency(flow);
        const fundingStability = resolveFundingStability(funding);
        const executionConsistency = resolveExecutionConsistency(execution, allocation);
        const liquidationNoise = resolveLiquidationNoise(row, input.liquidations, regime.symbol);
        const divergencePressure =
          flow?.cvd.divergence === "none" ? 0.15 : flow?.cvd.divergence ? 0.85 : 0.5;
        const fundingExtreme = round(clamp(1 - fundingStability, 0, 1), 4);
        const oiInstability = resolveOiInstability(flow);
        const flipPressure = round(clamp(1 - learningStability, 0, 1), 4);

        const ssi = round(
          clamp(
            regimeConfidence * 0.2 +
              learningStability * 0.3 +
              inverseConflict * 0.2 +
              flowConsistency * 0.15 +
              fundingStability * 0.15,
            0,
            1
          ),
          4
        );
        const mrs = round(
          clamp(
            regimeConfidence * 0.25 +
              clamp(conflict?.consensusScore ?? 0.5, 0, 1) * 0.2 +
              executionConsistency * 0.25 +
              clamp(1 - liquidationNoise, 0, 1) * 0.15 +
              fundingStability * 0.15,
            0,
            1
          ),
          4
        );
        const sdp = round(
          clamp(
            liquidationNoise * 0.25 +
              divergencePressure * 0.25 +
              fundingExtreme * 0.2 +
              oiInstability * 0.15 +
              flipPressure * 0.15,
            0,
            1
          ),
          4
        );
        const shs = round(clamp((ssi * 0.4 + mrs * 0.4 + (1 - sdp) * 0.2) * 100, 0, 100), 2);

        return {
          symbol: regime.symbol,
          ssi,
          mrs,
          sdp,
          shs,
          marketState: resolveMarketState(shs),
          adjustedSystemConfidence: round(clamp(regime.confidence * (shs / 100), 0, 100), 2)
        };
      })
      .sort((left, right) => {
        return (
          right.shs - left.shs ||
          right.mrs - left.mrs ||
          left.sdp - right.sdp ||
          left.symbol.localeCompare(right.symbol)
        );
      });
  }
}
