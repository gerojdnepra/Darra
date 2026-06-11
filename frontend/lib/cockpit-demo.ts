import type {
  FundingSymbolState,
  LiquidationState,
  MarketFlowState,
  MiniCandleSeries,
  PositionCapacityState,
  PositionRiskOrchestratorState,
  ScreenerAlert,
  ScreenerRow
} from "./types";

export const cockpitDemoSymbol = "SOLUSDT";

const now = 1_760_000_000_000;
const price = 186.42;

export const cockpitDemoRow: ScreenerRow = {
  symbol: cockpitDemoSymbol,
  baseAsset: "SOL",
  lastPrice: price,
  markPrice: 186.51,
  bestBid: 186.48,
  bestAsk: 186.53,
  bestBidQty: 1520,
  bestAskQty: 1180,
  change24hPct: 4.82,
  quoteVolume24h: 1_240_000_000,
  volume24h: 6_640_000,
  momentum30sPct: 0.34,
  momentum2mPct: 1.18,
  buyRatio60s: 0.63,
  tradeNotional5s: 820_000,
  tradeNotional60s: 12_800_000,
  volumeImpulse: 2.45,
  spreadBps: 2.7,
  orderBookImbalance: 0.18,
  fundingRate: 0.00018,
  liquidation5m: 4_700_000,
  liquidationBias: "SHORTS_HIT",
  score: 82.4,
  bias: "LONG",
  riskScore: 38,
  riskLevel: "MEDIUM",
  risk: {
    liquidationDistance: {
      distanceToLongPct: 8.6,
      distanceToShortPct: 14.2,
      nearestDistancePct: 8.6,
      liquidationPressureIndex: 31,
      marginBufferUtilization: 0.22
    },
    var: {
      var95_5m: -0.42,
      var99_5m: -0.88,
      var95_1h: -1.4,
      var99_1h: -2.1,
      volatility5m: 0.38,
      volatility1h: 1.22,
      sampleSize5m: 48,
      sampleSize1h: 240
    },
    correlationRow: {
      strongestPositive: [
        { symbol: "ETHUSDT", correlation: 0.72 },
        { symbol: "AVAXUSDT", correlation: 0.66 }
      ],
      strongestNegative: [{ symbol: "BTC.D", correlation: -0.41 }]
    },
    funding: {
      fundingRate: 0.00018,
      basisUsd: 0.31,
      basisPct: 0.17,
      annualizedFundingPressureScore: 22
    },
    flow: {
      openInterestUsd: 2_890_000_000,
      openInterestDelta5mUsd: 18_400_000,
      openInterestDelta1hUsd: 62_000_000,
      cvd5mUsd: 7_200_000,
      cvd1hUsd: 21_000_000,
      liquidationNet5mUsd: 3_800_000,
      liquidationNet1hUsd: 9_600_000,
      flowPressureScore: 71,
      directionalBias: "LONG"
    },
    pnlAttribution: {
      momentumContribution: 1.8,
      flowContribution: 2.4,
      fundingCarry: -0.2,
      residual: 0.4,
      total: 4.4
    }
  },
  whyTrade: [
    { code: "score", label: "Score > 80", value: 82.4, weight: 0.35 },
    { code: "flow", label: "CVD and OI confirm", value: "+18.4M OI", weight: 0.28 },
    { code: "volume", label: "Volume impulse", value: "2.45x", weight: 0.22 }
  ],
  whyNotTrade: [
    { code: "funding", label: "Funding positive", value: "0.018%", severity: "info" },
    { code: "spread", label: "Spread acceptable", value: "2.7 bps", severity: "info" }
  ],
  tags: ["DEMO", "FLOW_CONFIRM", "CHART_FIRST"],
  isFocus: true,
  isWatchlist: true,
  isActiveTrade: false,
  activeTradeSource: "none",
  updatedAt: now
};

export const cockpitDemoFlow: MarketFlowState = {
  symbol: cockpitDemoSymbol,
  openInterest: {
    currentOI: 2_890_000_000,
    oiChange5m: 18_400_000,
    oiChange15m: 41_000_000,
    oiChange1h: 62_000_000
  },
  cvd: {
    value: 21_000_000,
    slope: 2.6,
    divergence: "bullish"
  }
};

export const cockpitDemoFunding: FundingSymbolState = {
  symbol: cockpitDemoSymbol,
  fundingRate: 0.00018,
  annualizedFunding: 19.7,
  basisPct: 0.17,
  premiumPct: 0.08,
  markPrice: 186.51,
  indexPrice: 186.2
};

export const cockpitDemoLiquidations: LiquidationState = {
  symbol: cockpitDemoSymbol,
  liquidations1m: 420_000,
  liquidations5m: 4_700_000,
  liquidations15m: 8_900_000,
  liquidations1h: 17_400_000,
  longLiquidations: 1_200_000,
  shortLiquidations: 7_700_000
};

export const cockpitDemoCapacity: PositionCapacityState = {
  symbol: cockpitDemoSymbol,
  bias: "LONG",
  capacityScore: 76,
  recommendedSizeMultiplier: 0.72,
  safeToAdd: true,
  reason: "Demo account risk is moderate and flow confirms the planned direction.",
  constraints: {
    accountRisk: 24,
    marginStress: 18,
    liquidationStress: 31,
    conflictPenalty: 6,
    governorPenalty: 4
  }
};

export const cockpitDemoPositionRisk: PositionRiskOrchestratorState = {
  accountRiskLoad: 34,
  riskBudgetLeft: 66,
  marginStress: {
    marginUsagePct: 18,
    maintenanceMarginRatio: 0.04,
    availableBalancePct: 82,
    stressLevel: "LOW"
  },
  liquidationStress: {
    minDistancePct: 8.6,
    avgDistancePct: 14.8,
    criticalPositions: 0,
    warningPositions: 1,
    stressLevel: "MEDIUM"
  },
  killSwitchState: "NORMAL",
  safeToAddPosition: true,
  globalRiskMultiplier: 0.72,
  positionCapacity: [cockpitDemoCapacity]
};

export const cockpitDemoCandles: MiniCandleSeries = {
  symbol: cockpitDemoSymbol,
  interval: "30s",
  candles: Array.from({ length: 44 }, (_, index) => {
    const wave = Math.sin(index / 4) * 0.7 + Math.cos(index / 7) * 0.35;
    const drift = index * 0.11;
    const close = 181.8 + drift + wave;
    const open = close - Math.sin(index / 3) * 0.28;
    const high = Math.max(open, close) + 0.42 + (index % 4) * 0.04;
    const low = Math.min(open, close) - 0.38 - (index % 3) * 0.04;
    const volume = 14_000 + index * 520 + Math.abs(Math.sin(index / 2)) * 9_000;

    return {
      timestamp: now - (43 - index) * 30_000,
      open: Number(open.toFixed(3)),
      high: Number(high.toFixed(3)),
      low: Number(low.toFixed(3)),
      close: Number(close.toFixed(3)),
      volume: Number(volume.toFixed(0)),
      buyVolume: Number((volume * 0.62).toFixed(0)),
      sellVolume: Number((volume * 0.38).toFixed(0))
    };
  })
};

export const cockpitDemoAlerts: ScreenerAlert[] = [
  {
    id: "demo-alert-sol-flow",
    symbol: cockpitDemoSymbol,
    kind: "tape",
    baseAsset: "SOL",
    bias: "LONG",
    reason: "Demo: CVD slope and open interest expansion confirm momentum.",
    severity: "high",
    notionalUsd: 4_700_000,
    quoteVolume24h: 1_240_000_000,
    alertPriority: "HIGH",
    rankScore: 91,
    tags: ["demo", "flow", "oi"],
    liveVisibility: "PRIMARY",
    noiseClass: "ACTIONABLE",
    createdAt: now
  }
];
