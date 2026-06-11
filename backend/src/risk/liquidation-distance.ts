import { round } from "../lib/math";

export type PositionLiquidationRiskLevel = "critical" | "warning" | "safe";

export interface PositionLiquidationDistanceSnapshot {
  distancePct: number | null;
  riskLevel: PositionLiquidationRiskLevel;
  liquidationPressureIndex: number;
  marginBufferUtilization: number | null;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const computeLiquidationDistancePct = (
  side: "LONG" | "SHORT",
  markPrice: number,
  liquidationPrice: number | null
): number | null => {
  if (!Number.isFinite(markPrice) || markPrice <= 0) {
    return null;
  }

  if (liquidationPrice === null || !Number.isFinite(liquidationPrice) || liquidationPrice <= 0) {
    return null;
  }

  const distancePct =
    side === "LONG"
      ? ((markPrice - liquidationPrice) / markPrice) * 100
      : ((liquidationPrice - markPrice) / markPrice) * 100;

  return round(distancePct, 2);
};

export const classifyLiquidationRiskLevel = (
  distancePct: number | null
): PositionLiquidationRiskLevel => {
  if (distancePct === null || !Number.isFinite(distancePct)) {
    return "safe";
  }

  if (distancePct <= 3) {
    return "critical";
  }

  if (distancePct < 7) {
    return "warning";
  }

  return "safe";
};

export const computePositionLiquidationDistance = (
  side: "LONG" | "SHORT",
  markPrice: number,
  liquidationPrice: number | null
): PositionLiquidationDistanceSnapshot => {
  const distancePct = computeLiquidationDistancePct(side, markPrice, liquidationPrice);
  const riskLevel = classifyLiquidationRiskLevel(distancePct);
  const liquidationPressureIndex =
    distancePct === null ? 0 : round(clamp(100 - distancePct * 3.5, 0, 100), 2);

  return {
    distancePct,
    riskLevel,
    liquidationPressureIndex,
    marginBufferUtilization:
      distancePct === null ? null : round(clamp(liquidationPressureIndex * 0.88, 0, 100), 2)
  };
};
