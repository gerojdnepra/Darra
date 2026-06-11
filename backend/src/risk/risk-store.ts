import type { RiskState, RiskUpdateReason } from "./types";

type RiskStoreListener = (state: RiskState, reason: RiskUpdateReason) => void;

const createMetricValue = () => ({
  value: null,
  updatedAt: null
});

export const createDefaultRiskState = (): RiskState => ({
  generatedAt: Date.now(),
  status: "disabled",
  mode: "live",
  account: {
    enabled: false,
    connected: false,
    credentialSource: "none",
    balanceAsset: "USDT",
    lastSyncAt: null,
    positionCount: 0,
    longCount: 0,
    shortCount: 0
  },
  summary: {
    grossExposureUsd: createMetricValue(),
    netExposureUsd: createMetricValue(),
    longExposureUsd: createMetricValue(),
    shortExposureUsd: createMetricValue(),
    largestPositionUsd: createMetricValue(),
    concentrationPct: createMetricValue(),
    walletBalanceUsd: createMetricValue(),
    availableBalanceUsd: createMetricValue(),
    marginBalanceUsd: createMetricValue(),
    unrealizedPnlUsd: createMetricValue(),
    openRiskUsd: createMetricValue(),
    marginUsagePct: createMetricValue()
  },
  limits: {
    maxPositionUsd: {
      enabled: false,
      value: null
    },
    maxLossPerTradeUsd: {
      enabled: false,
      value: null
    },
    maxDailyLossUsd: {
      enabled: false,
      value: null
    }
  },
  positions: [],
  topRiskSymbols: [],
  riskScore: 0,
  riskLevel: "LOW",
  liquidationDistance: {
    averageNearestDistancePct: null,
    averagePressureIndex: 0,
    averageMarginBufferUtilization: null,
    criticalSymbols: []
  },
  var: {
    method: "focus_proxy",
    var95_5mUsd: null,
    var99_5mUsd: null,
    var95_1hUsd: null,
    var99_1hUsd: null,
    volatilityProxy: null,
    sampleSize: 0,
    breach: false
  },
  correlation: {
    symbols: [],
    matrix: [],
    heatmap: [],
    maxAbsCorrelation: 0,
    clusters: []
  },
  funding: {
    averageFundingRate: 0,
    averageBasisPct: 0,
    annualizedPressureScore: 0,
    extremeSymbols: []
  },
  flow: {
    aggregatePressureScore: 0,
    directionalBias: "NEUTRAL",
    totalOpenInterestDelta5mUsd: 0,
    totalOpenInterestDelta1hUsd: 0,
    totalCvd5mUsd: 0,
    totalCvd1hUsd: 0,
    totalLiquidationNet5mUsd: 0,
    totalLiquidationNet1hUsd: 0,
    leaders: []
  },
  pnlAttribution: {
    momentumContribution: 0,
    flowContribution: 0,
    fundingCarry: 0,
    residual: 0,
    total: 0
  },
  alerts: []
});

export class RiskStore {
  private state: RiskState;

  private listeners = new Set<RiskStoreListener>();

  constructor(initialState: RiskState = createDefaultRiskState()) {
    this.state = initialState;
  }

  getState(): RiskState {
    return this.state;
  }

  setState(nextState: RiskState, reason: RiskUpdateReason): void {
    this.state = nextState;

    for (const listener of this.listeners) {
      listener(this.state, reason);
    }
  }

  subscribe(listener: RiskStoreListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }
}
