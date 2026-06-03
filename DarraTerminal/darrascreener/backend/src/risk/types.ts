export type RiskEngineMode = "live";
export type RiskEngineStatus = "disabled" | "syncing" | "live" | "stale";
export type RiskUpdateReason = "bootstrap" | "sync";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type FlowDirectionalBias = "LONG" | "SHORT" | "NEUTRAL";
export type PositionLiquidationRiskLevel = "critical" | "warning" | "safe";
export type RiskAlertCode =
  | "var_breach"
  | "liquidation_distance"
  | "correlation_spike"
  | "funding_extreme"
  | "flow_divergence";

export interface RiskMetricValue {
  value: number | null;
  updatedAt: number | null;
}

export interface RiskLimitValue {
  enabled: boolean;
  value: number | null;
}

export interface RiskAlertEntry {
  id: string;
  code: RiskAlertCode;
  severity: "info" | "high" | "critical";
  message: string;
  symbol: string | null;
  value: number | null;
  createdAt: number;
}

export interface RiskLiquidationDistancePayload {
  distanceToLongPct: number | null;
  distanceToShortPct: number | null;
  nearestDistancePct: number | null;
  liquidationPressureIndex: number;
  marginBufferUtilization: number | null;
}

export interface RiskVarPayload {
  var95_5m: number | null;
  var99_5m: number | null;
  var95_1h: number | null;
  var99_1h: number | null;
  volatility5m: number | null;
  volatility1h: number | null;
  sampleSize5m: number;
  sampleSize1h: number;
}

export interface RiskCorrelationValue {
  symbol: string;
  correlation: number;
}

export interface RiskCorrelationRowPayload {
  strongestPositive: RiskCorrelationValue[];
  strongestNegative: RiskCorrelationValue[];
}

export interface RiskFundingPayload {
  fundingRate: number;
  basisUsd: number;
  basisPct: number;
  annualizedFundingPressureScore: number;
}

export interface RiskFlowPayload {
  openInterestUsd: number | null;
  openInterestDelta5mUsd: number | null;
  openInterestDelta1hUsd: number | null;
  cvd5mUsd: number;
  cvd1hUsd: number;
  liquidationNet5mUsd: number;
  liquidationNet1hUsd: number;
  flowPressureScore: number;
  directionalBias: FlowDirectionalBias;
}

export interface RiskPnlAttributionPayload {
  momentumContribution: number;
  flowContribution: number;
  fundingCarry: number;
  residual: number;
  total: number;
}

export interface RiskSymbolPayload {
  liquidationDistance: RiskLiquidationDistancePayload;
  var: RiskVarPayload;
  correlationRow: RiskCorrelationRowPayload;
  funding: RiskFundingPayload;
  flow: RiskFlowPayload;
  pnlAttribution: RiskPnlAttributionPayload;
}

export interface RiskPositionState {
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: number;
  entryPrice: number;
  markPrice: number;
  notionalUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number | null;
  liquidationPrice: number | null;
  distancePct: number | null;
  distanceToLiquidationPct: number | null;
  initialMarginUsd: number;
  maintMarginUsd: number;
  openOrderMarginUsd: number;
  isolatedWalletUsd: number;
  quoteVolume24h: number | null;
  change24hPct: number | null;
  score: number | null;
  bias: "LONG" | "SHORT" | "NEUTRAL" | null;
  riskScore: number;
  portfolioRiskLevel: RiskLevel;
  riskLevel: PositionLiquidationRiskLevel;
  risk: RiskSymbolPayload;
  updatedAt: number;
}

export interface RiskCorrelationCluster {
  symbols: string[];
  averageCorrelation: number;
}

export interface RiskHeatmapCell {
  x: number;
  y: number;
  value: number;
}

export interface RiskState {
  generatedAt: number;
  status: RiskEngineStatus;
  mode: RiskEngineMode;
  account: {
    enabled: boolean;
    connected: boolean;
    credentialSource: "none" | "env" | "session";
    balanceAsset: string;
    lastSyncAt: number | null;
    positionCount: number;
    longCount: number;
    shortCount: number;
  };
  summary: {
    grossExposureUsd: RiskMetricValue;
    netExposureUsd: RiskMetricValue;
    longExposureUsd: RiskMetricValue;
    shortExposureUsd: RiskMetricValue;
    largestPositionUsd: RiskMetricValue;
    concentrationPct: RiskMetricValue;
    walletBalanceUsd: RiskMetricValue;
    availableBalanceUsd: RiskMetricValue;
    marginBalanceUsd: RiskMetricValue;
    unrealizedPnlUsd: RiskMetricValue;
    openRiskUsd: RiskMetricValue;
    marginUsagePct: RiskMetricValue;
  };
  limits: {
    maxPositionUsd: RiskLimitValue;
    maxLossPerTradeUsd: RiskLimitValue;
    maxDailyLossUsd: RiskLimitValue;
  };
  positions: RiskPositionState[];
  topRiskSymbols: Array<{
    symbol: string;
    riskScore: number;
    riskLevel: RiskLevel;
  }>;
  riskScore: number;
  riskLevel: RiskLevel;
  liquidationDistance: {
    averageNearestDistancePct: number | null;
    averagePressureIndex: number;
    averageMarginBufferUtilization: number | null;
    criticalSymbols: string[];
  };
  var: {
    method: "positions" | "focus_proxy";
    var95_5mUsd: number | null;
    var99_5mUsd: number | null;
    var95_1hUsd: number | null;
    var99_1hUsd: number | null;
    volatilityProxy: number | null;
    sampleSize: number;
    breach: boolean;
  };
  correlation: {
    symbols: string[];
    matrix: number[][];
    heatmap: RiskHeatmapCell[];
    maxAbsCorrelation: number;
    clusters: RiskCorrelationCluster[];
  };
  funding: {
    averageFundingRate: number;
    averageBasisPct: number;
    annualizedPressureScore: number;
    extremeSymbols: string[];
  };
  flow: {
    aggregatePressureScore: number;
    directionalBias: FlowDirectionalBias;
    totalOpenInterestDelta5mUsd: number;
    totalOpenInterestDelta1hUsd: number;
    totalCvd5mUsd: number;
    totalCvd1hUsd: number;
    totalLiquidationNet5mUsd: number;
    totalLiquidationNet1hUsd: number;
    leaders: Array<{
      symbol: string;
      flowPressureScore: number;
      directionalBias: FlowDirectionalBias;
    }>;
  };
  pnlAttribution: {
    momentumContribution: number;
    flowContribution: number;
    fundingCarry: number;
    residual: number;
    total: number;
  };
  alerts: RiskAlertEntry[];
}

export interface RiskSnapshotPayload {
  version: number;
  state: RiskState;
}

export interface RiskUpdatePayload {
  version: number;
  reason: RiskUpdateReason;
  state: RiskState;
}
