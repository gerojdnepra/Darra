import { round } from "../lib/math";
import { TimedPriceSeries } from "../lib/rolling-window";
import type { BinanceAccountRiskSnapshot } from "../services/binance-account-stream";
import type { ScreenerRow } from "../types/messages";
import { CorrelationEngine } from "./correlation-engine";
import { ExpectedShortfallEngine } from "./es-engine";
import { PnlAttributionEngine } from "./pnl-attribution-engine";
import type {
  PortfolioAnalyticsGroupState,
  PortfolioAnalyticsState,
  PortfolioPositionInput
} from "./types";
import { VarEngine } from "./var-engine";

interface SymbolHistory {
  priceSeries: TimedPriceSeries;
  lastBucketTime: number | null;
  updatedAt: number;
}

const SAMPLE_INTERVAL_MS = 60_000;
const RETENTION_MS = 31 * 24 * 60 * 60 * 1000;
const RECOMPUTE_INTERVAL_MS = 30_000;
const STALE_SYMBOL_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_STRATEGY_KEY = "unassigned";
const DEFAULT_PORTFOLIO_KEY = "primary";

const emptyGroupState = (updatedAt: number): PortfolioAnalyticsGroupState => ({
  symbols: [],
  var: {
    windowDays: DEFAULT_WINDOW_DAYS,
    sampleSize: 0,
    var95: null,
    var99: null
  },
  expectedShortfall: {
    windowDays: DEFAULT_WINDOW_DAYS,
    sampleSize: 0,
    es95: null,
    es99: null
  },
  correlation: {
    symbols: [],
    sampleSize: 0,
    correlationMatrix: {},
    correlationHeatmap: {
      pairs: []
    }
  },
  pnl: {
    realized: 0,
    unrealized: 0,
    funding: 0,
    fees: 0,
    net: 0
  },
  updatedAt
});

const sideSign = (
  positionSide: "BOTH" | "LONG" | "SHORT",
  quantity: number
): number => {
  if (positionSide === "LONG") {
    return 1;
  }

  if (positionSide === "SHORT") {
    return -1;
  }

  return quantity >= 0 ? 1 : -1;
};

export class PortfolioAnalyticsEngine {
  private readonly histories = new Map<string, SymbolHistory>();
  private readonly varEngine = new VarEngine();
  private readonly expectedShortfallEngine = new ExpectedShortfallEngine();
  private readonly correlationEngine = new CorrelationEngine();
  private readonly pnlAttributionEngine = new PnlAttributionEngine();
  private cachedState: PortfolioAnalyticsState | null = null;
  private lastRecomputedAt = 0;
  private lastSignature = "";

  build(input: {
    rows: ScreenerRow[];
    account: BinanceAccountRiskSnapshot;
    generatedAt?: number;
  }): PortfolioAnalyticsState {
    const now = input.generatedAt ?? Date.now();
    const rowBySymbol = new Map(input.rows.map((row) => [row.symbol, row] as const));
    const positions = this.buildPositions(input.account, rowBySymbol);
    const activeSymbols = new Set(positions.map((position) => position.symbol));
    this.updateHistories(activeSymbols, positions, rowBySymbol, now);
    this.pruneHistories(activeSymbols, now);

    const signature = positions
      .map(
        (position) =>
          `${position.symbol}:${position.signedNotionalUsd.toFixed(2)}:${position.unrealizedPnlUsd.toFixed(2)}`
      )
      .join("|");

    if (
      this.cachedState &&
      signature === this.lastSignature &&
      now - this.lastRecomputedAt < RECOMPUTE_INTERVAL_MS
    ) {
      return this.cachedState;
    }

    const bySymbol = this.buildBySymbol(positions, now);
    const byStrategy = {
      [DEFAULT_STRATEGY_KEY]: this.buildGroupAnalytics(positions, now)
    };
    const byPortfolio = {
      [DEFAULT_PORTFOLIO_KEY]: this.buildGroupAnalytics(positions, now)
    };

    this.lastSignature = signature;
    this.lastRecomputedAt = now;
    this.cachedState = {
      updatedAt: now,
      bySymbol,
      byStrategy,
      byPortfolio
    };

    return this.cachedState;
  }

  private buildPositions(
    account: BinanceAccountRiskSnapshot,
    rowBySymbol: Map<string, ScreenerRow>
  ): PortfolioPositionInput[] {
    return account.positions
      .map((position) => {
        const row = rowBySymbol.get(position.symbol);
        const markPrice = row?.markPrice || position.markPrice || 0;
        const direction = sideSign(position.positionSide, position.quantity);
        const absoluteNotionalUsd = Math.abs(position.quantity) * markPrice;

        return {
          symbol: position.symbol,
          signedNotionalUsd: round(absoluteNotionalUsd * direction, 2),
          absoluteNotionalUsd: round(absoluteNotionalUsd, 2),
          unrealizedPnlUsd: round(position.unrealizedPnl, 2),
          strategyKey: DEFAULT_STRATEGY_KEY,
          portfolioKey: DEFAULT_PORTFOLIO_KEY
        };
      })
      .filter((position) => position.absoluteNotionalUsd > 0);
  }

  private updateHistories(
    activeSymbols: Set<string>,
    positions: PortfolioPositionInput[],
    rowBySymbol: Map<string, ScreenerRow>,
    now: number
  ): void {
    for (const position of positions) {
      if (!activeSymbols.has(position.symbol)) {
        continue;
      }

      const row = rowBySymbol.get(position.symbol);
      const price = row?.markPrice || row?.lastPrice || 0;
      if (!Number.isFinite(price) || price <= 0) {
        continue;
      }

      const bucketTime = Math.floor(now / SAMPLE_INTERVAL_MS) * SAMPLE_INTERVAL_MS;
      const existing = this.histories.get(position.symbol);
      const history =
        existing ??
        {
          priceSeries: new TimedPriceSeries(RETENTION_MS),
          lastBucketTime: null,
          updatedAt: now
        };

      if (history.lastBucketTime !== bucketTime) {
        history.priceSeries.push(bucketTime, price);
        history.lastBucketTime = bucketTime;
      }

      history.updatedAt = now;
      this.histories.set(position.symbol, history);
    }
  }

  private pruneHistories(activeSymbols: Set<string>, now: number): void {
    for (const [symbol, history] of this.histories) {
      if (activeSymbols.has(symbol)) {
        continue;
      }

      if (now - history.updatedAt > STALE_SYMBOL_TTL_MS) {
        this.histories.delete(symbol);
      }
    }
  }

  private buildBySymbol(
    positions: PortfolioPositionInput[],
    now: number
  ): Record<string, PortfolioAnalyticsGroupState> {
    const grouped = new Map<string, PortfolioPositionInput[]>();

    for (const position of positions) {
      const bucket = grouped.get(position.symbol);
      if (bucket) {
        bucket.push(position);
      } else {
        grouped.set(position.symbol, [position]);
      }
    }

    return Object.fromEntries(
      Array.from(grouped.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([symbol, groupPositions]) => [symbol, this.buildGroupAnalytics(groupPositions, now)])
    );
  }

  private buildGroupAnalytics(
    positions: PortfolioPositionInput[],
    now: number
  ): PortfolioAnalyticsGroupState {
    if (positions.length === 0) {
      return emptyGroupState(now);
    }

    const windowMs = DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const exposures = new Map<string, number>();

    for (const position of positions) {
      exposures.set(
        position.symbol,
        round((exposures.get(position.symbol) ?? 0) + position.signedNotionalUsd, 2)
      );
    }

    const returnInputs = Array.from(exposures.entries())
      .map(([symbol]) => ({
        symbol,
        returns: this.histories.get(symbol)?.priceSeries.returnSeries(windowMs) ?? []
      }))
      .filter((input) => input.returns.length > 0);

    const sampleSize =
      returnInputs.length > 0 ? Math.min(...returnInputs.map((input) => input.returns.length)) : 0;
    const normalizedReturns = new Map(
      returnInputs.map((input) => [input.symbol, input.returns.slice(-sampleSize)] as const)
    );
    const scenarioLosses: number[] = [];

    for (let index = 0; index < sampleSize; index += 1) {
      let scenarioPnl = 0;

      for (const [symbol, signedNotionalUsd] of exposures) {
        const returns = normalizedReturns.get(symbol);
        const scenarioReturn = returns?.[index] ?? 0;
        scenarioPnl += signedNotionalUsd * scenarioReturn;
      }

      scenarioLosses.push(round(-scenarioPnl, 2));
    }

    const varState = this.varEngine.compute(scenarioLosses, DEFAULT_WINDOW_DAYS);
    const expectedShortfall = this.expectedShortfallEngine.compute(
      scenarioLosses,
      DEFAULT_WINDOW_DAYS,
      varState.var95,
      varState.var99
    );
    const correlation = this.correlationEngine.compute(returnInputs);
    const pnl = this.pnlAttributionEngine.compute(positions);

    return {
      symbols: Array.from(exposures.keys()).sort(),
      var: varState,
      expectedShortfall,
      correlation,
      pnl,
      updatedAt: now
    };
  }
}
