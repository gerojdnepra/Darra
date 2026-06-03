import { clamp, round } from "../lib/math";
import type { FundingSymbolState } from "../funding/types";
import type { LiquidationsDashboardPayload } from "../liquidations/types";
import type { MarketFlowState } from "../market-flow/types";
import type { ScreenerRow } from "../types/messages";
import type { RegimeBias, RegimeComponents, RegimeState, RegimeWeights } from "./types";

const DEFAULT_WEIGHTS: RegimeWeights = {
  risk: 0.25,
  funding: 0.2,
  flow: 0.35,
  liquidations: 0.2
};

const classifyBias = (finalScore: number): RegimeBias => {
  if (finalScore > 0.25) {
    return "LONG";
  }

  if (finalScore < -0.25) {
    return "SHORT";
  }

  return "NEUTRAL";
};

const normalizeRiskScore = (row: ScreenerRow | undefined): number => {
  if (!row) {
    return 0;
  }

  const nearestDistancePct = row.risk.liquidationDistance.nearestDistancePct;

  if (typeof nearestDistancePct === "number") {
    if (nearestDistancePct <= 3) {
      return -1;
    }

    if (nearestDistancePct <= 7) {
      return 0;
    }

    return 1;
  }

  if (row.riskLevel === "CRITICAL") {
    return -1;
  }

  if (row.riskLevel === "HIGH") {
    return -0.5;
  }

  if (row.riskLevel === "MEDIUM") {
    return 0;
  }

  return 1;
};

const normalizeFundingScore = (funding: FundingSymbolState | undefined): number => {
  if (!funding) {
    return 0;
  }

  const rateComponent = clamp(-funding.fundingRate / 0.001, -1, 1);
  const premiumComponent = clamp(-((funding.basisPct + funding.premiumPct) / 2) / 2, -1, 1);

  return round(clamp(rateComponent * 0.65 + premiumComponent * 0.35, -1, 1), 4);
};

const normalizeFlowScore = (marketFlow: MarketFlowState | undefined): number => {
  if (!marketFlow) {
    return 0;
  }

  const oiComposite =
    marketFlow.openInterest.oiChange5m * 0.5 +
    marketFlow.openInterest.oiChange15m * 0.3 +
    marketFlow.openInterest.oiChange1h * 0.2;
  const oiDirection = oiComposite > 0.15 ? 1 : oiComposite < -0.15 ? -1 : 0;
  const cvdDirection =
    marketFlow.cvd.divergence === "bullish"
      ? 1
      : marketFlow.cvd.divergence === "bearish"
        ? -1
        : marketFlow.cvd.slope > 0
          ? 0.5
          : marketFlow.cvd.slope < 0
            ? -0.5
            : 0;

  if (oiDirection > 0 && cvdDirection > 0) {
    return 1;
  }

  if (oiDirection > 0 && cvdDirection < 0) {
    return -1;
  }

  if (oiDirection < 0 && cvdDirection > 0) {
    return 0.35;
  }

  if (oiDirection < 0 && cvdDirection < 0) {
    return -0.35;
  }

  if (oiDirection === 0) {
    return round(cvdDirection * 0.5, 4);
  }

  return round(oiDirection * 0.25, 4);
};

const normalizeLiquidationScore = (
  liquidations: LiquidationsDashboardPayload["bySymbol"][string] | undefined
): number => {
  if (!liquidations) {
    return 0;
  }

  const total = liquidations.longLiquidations + liquidations.shortLiquidations;
  if (total <= 0) {
    return 0;
  }

  const skew = (liquidations.shortLiquidations - liquidations.longLiquidations) / total;
  const intensity = clamp(total / 250_000, 0.1, 1);
  return round(clamp(skew * intensity, -1, 1), 4);
};

export class UnifiedRegimeEngine {
  constructor(private readonly weights: RegimeWeights = DEFAULT_WEIGHTS) {}

  build(input: {
    rows: ScreenerRow[];
    funding: FundingSymbolState[];
    marketFlow: MarketFlowState[];
    liquidations?: LiquidationsDashboardPayload;
  }): RegimeState[] {
    const rowBySymbol = new Map(input.rows.map((row) => [row.symbol, row] as const));
    const fundingBySymbol = new Map(input.funding.map((row) => [row.symbol, row] as const));
    const marketFlowBySymbol = new Map(input.marketFlow.map((row) => [row.symbol, row] as const));
    const liquidationBySymbol = input.liquidations?.bySymbol ?? {};

    return input.rows
      .map((row) => {
        const components: RegimeComponents = {
          riskScore: normalizeRiskScore(rowBySymbol.get(row.symbol)),
          fundingScore: normalizeFundingScore(fundingBySymbol.get(row.symbol)),
          flowScore: normalizeFlowScore(marketFlowBySymbol.get(row.symbol)),
          liquidationScore: normalizeLiquidationScore(liquidationBySymbol[row.symbol])
        };
        const finalScore = round(
          components.riskScore * this.weights.risk +
            components.fundingScore * this.weights.funding +
            components.flowScore * this.weights.flow +
            components.liquidationScore * this.weights.liquidations,
          4
        );
        const confidence = round(
          clamp(
            ((Math.abs(components.riskScore) +
              Math.abs(components.fundingScore) +
              Math.abs(components.flowScore) +
              Math.abs(components.liquidationScore)) /
              4) *
              100,
            0,
            100
          ),
          2
        );

        return {
          symbol: row.symbol,
          bias: classifyBias(finalScore),
          finalScore,
          confidence,
          components
        };
      })
      .sort(
        (left, right) =>
          Math.abs(right.finalScore) - Math.abs(left.finalScore) ||
          right.confidence - left.confidence ||
          left.symbol.localeCompare(right.symbol)
      );
  }
}
