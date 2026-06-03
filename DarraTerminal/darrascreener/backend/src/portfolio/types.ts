export interface PortfolioVarState {
  windowDays: number;
  sampleSize: number;
  var95: number | null;
  var99: number | null;
}

export interface PortfolioExpectedShortfallState {
  windowDays: number;
  sampleSize: number;
  es95: number | null;
  es99: number | null;
}

export interface PortfolioCorrelationHeatmapPair {
  symbolA: string;
  symbolB: string;
  correlation: number;
  intensity: number;
}

export interface PortfolioCorrelationState {
  symbols: string[];
  sampleSize: number;
  correlationMatrix: Record<string, Record<string, number>>;
  correlationHeatmap: {
    pairs: PortfolioCorrelationHeatmapPair[];
  };
}

export interface PortfolioPnlState {
  realized: number;
  unrealized: number;
  funding: number;
  fees: number;
  net: number;
}

export interface PortfolioAnalyticsGroupState {
  symbols: string[];
  var: PortfolioVarState;
  expectedShortfall: PortfolioExpectedShortfallState;
  correlation: PortfolioCorrelationState;
  pnl: PortfolioPnlState;
  updatedAt: number;
}

export interface PortfolioAnalyticsState {
  updatedAt: number;
  bySymbol: Record<string, PortfolioAnalyticsGroupState>;
  byStrategy: Record<string, PortfolioAnalyticsGroupState>;
  byPortfolio: Record<string, PortfolioAnalyticsGroupState>;
}

export interface PortfolioPositionInput {
  symbol: string;
  signedNotionalUsd: number;
  absoluteNotionalUsd: number;
  unrealizedPnlUsd: number;
  strategyKey: string;
  portfolioKey: string;
}
