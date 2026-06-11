import { randomUUID } from "node:crypto";
import { clamp, round, safeNumber } from "../lib/math";
import {
  TimedFlowBuffer,
  TimedLiquidationBuffer,
  TimedPriceSeries,
  TimedValueSeries
} from "../lib/rolling-window";
import type {
  AggTradeEvent,
  AllMarketTickerEvent,
  BookTickerEvent,
  ForceOrderEvent,
  KlineEvent,
  MarkPriceEvent,
  RestTicker24h
} from "../types/binance";
import type {
  AccountStreamStatus,
  ActiveTradeSource,
  BackendPhase,
  BackendSettings,
  Bias,
  ScreenerAlert,
  MiniCandle,
  MiniCandleSeries,
  ScreenerOverview,
  ScreenerRow,
  UnifiedSignalEvent,
  VolumeMilestoneEvent
} from "../types/messages";
import type {
  FlowDirectionalBias,
  RiskCorrelationCluster,
  RiskCorrelationRowPayload,
  RiskFundingPayload,
  RiskLevel,
  RiskLiquidationDistancePayload,
  RiskPnlAttributionPayload,
  RiskState,
  RiskSymbolPayload,
  RiskVarPayload
} from "../risk/types";
import type { StreamHealth } from "./binance-stream";
import type { UniverseSymbol } from "./binance-rest";
import type { LiquiditySnapshotItem } from "./reviving-coin-detector";
import type { AlertPriority, AlertRankingResult } from "../alert-ranking/alert-ranking-engine";

interface SymbolState extends UniverseSymbol {
  lastPrice: number;
  markPrice: number;
  indexPrice: number;
  fundingRate: number;
  openInterestUsd: number | null;
  nextFundingTime: number;
  change24hPct: number;
  quoteVolume24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  bestBid: number | null;
  bestAsk: number | null;
  bestBidQty: number | null;
  bestAskQty: number | null;
  lastUpdateTime: number;
  priceSeries: TimedPriceSeries;
  tradeFlow: TimedFlowBuffer;
  liquidations: TimedLiquidationBuffer;
  openInterestSeries: TimedValueSeries;
  miniCandles: MiniCandle[];
  klineCandles: MiniCandle[];
}

interface FrameOptions {
  settings: BackendSettings;
  watchlist: Set<string>;
  manualActiveTrades: Set<string>;
  accountActiveTrades: Set<string>;
  phase: BackendPhase;
  phaseMessage: string;
  streamHealth: {
    market: StreamHealth;
    public: StreamHealth;
  };
  accountStream: AccountStreamStatus;
}

interface CorrelationContext {
  symbols: string[];
  matrix: number[][];
  rowPayloads: Map<string, RiskCorrelationRowPayload>;
  clusters: RiskCorrelationCluster[];
  maxAbsCorrelation: number;
}

export interface ScreenerMarketRiskSnapshot {
  symbols: string[];
  matrix: number[][];
  heatmap: Array<{ x: number; y: number; value: number }>;
  clusters: RiskCorrelationCluster[];
  maxAbsCorrelation: number;
}

const CORE_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const ROLLING_RETENTION_MS = 3_600_000;
const MINI_CANDLE_INTERVAL: MiniCandleSeries["interval"] = "15s";
const MINI_CANDLE_INTERVAL_MS = 15_000;
const MINI_CANDLE_MAX_POINTS = 120;
const CORRELATION_MIN_OBSERVATIONS = 20;
const CORRELATION_SPIKE_THRESHOLD = 0.85;
const MAX_CORRELATION_SYMBOLS = 30;
const VOLUME_THRESHOLD_LEVELS = [
  ...Array.from({ length: 10 }, (_, index) => (index + 1) * 1_000_000),
  ...Array.from({ length: 9 }, (_, index) => (index + 2) * 10_000_000)
];

export interface RawAssemblyDiagnostics {
  rawRowsBuildMs?: number;
  rawTradeFlowMs?: number;
  rawLiquidationsMs?: number;
  rawReturnSeriesMs?: number;
  rawVarMs?: number;
  rawTagsMs?: number;
  rawPerSymbolOtherMs?: number;
  rawRowsSortMs?: number;
  rawCorrelationMs?: number;
  rawRiskScoreApplyMs?: number;
  rawOverviewMs?: number;
  rawAlertsMs?: number;
  rawMilestonesMs?: number;
}

type BaseFrame = Omit<import("../types/messages").ScreenerFrame, "risk" | "funding" | "fundingSorted"> & {
  rawAssemblyDiagnostics?: RawAssemblyDiagnostics;
};

const ACTIONABLE_ALERT_PRIORITIES: AlertPriority[] = ["CRITICAL", "HIGH", "MEDIUM"];

const normalizeAlertPriority = (priority: ScreenerAlert["alertPriority"]): AlertPriority | null => {
  if (
    priority === "CRITICAL" ||
    priority === "HIGH" ||
    priority === "MEDIUM" ||
    priority === "LOW" ||
    priority === "IGNORE"
  ) {
    return priority;
  }

  return null;
};

const withAlertRankingContract = (
  alert: ScreenerAlert,
  ranking?: AlertRankingResult | null
): ScreenerAlert => {
  const rankScore = ranking?.rankScore ?? alert.rankScore ?? alert.alertRankScore;
  const suppress = ranking?.suppress ?? alert.suppress ?? alert.alertSuppress;
  const priority = ranking?.priority ?? normalizeAlertPriority(alert.alertPriority);
  const normalizedAlert: ScreenerAlert = { ...alert };

  if (typeof rankScore === "number" && Number.isFinite(rankScore)) {
    normalizedAlert.rankScore = rankScore;
    normalizedAlert.alertRankScore = normalizedAlert.alertRankScore ?? rankScore;
  }

  if (typeof suppress === "boolean") {
    normalizedAlert.suppress = suppress;
    normalizedAlert.alertSuppress = normalizedAlert.alertSuppress ?? suppress;
  }

  if (ranking?.priority) {
    normalizedAlert.alertPriority = normalizedAlert.alertPriority ?? ranking.priority;
  }

  if (Array.isArray(ranking?.tags)) {
    normalizedAlert.tags = ranking.tags;
  } else if (Array.isArray(alert.tags)) {
    normalizedAlert.tags = alert.tags;
  }

  const ttlSec = ranking?.ttlSec ?? alert.ttlSec;
  if (typeof ttlSec === "number" && Number.isFinite(ttlSec)) {
    normalizedAlert.ttlSec = ttlSec;
  }

  const suppressReason = ranking?.suppressReason ?? alert.suppressReason;
  if (typeof suppressReason === "string" && suppressReason.trim()) {
    normalizedAlert.suppressReason = suppressReason;
  }

  if (normalizedAlert.suppress === true) {
    normalizedAlert.liveVisibility = "HIDDEN";
    normalizedAlert.noiseClass = "NOISE";
  } else if (priority && ACTIONABLE_ALERT_PRIORITIES.includes(priority)) {
    normalizedAlert.liveVisibility = "PRIMARY";
    normalizedAlert.noiseClass = "ACTIONABLE";
  } else {
    normalizedAlert.liveVisibility = "REVIEW";
    normalizedAlert.noiseClass = "CONTEXT";
  }

  return normalizedAlert;
};

export const buildUnifiedSignalFromAlert = (alert: ScreenerAlert): UnifiedSignalEvent => {
  const priority = typeof alert.alertPriority === "string" && alert.alertPriority.trim()
    ? alert.alertPriority
    : undefined;
  const rankScore = typeof alert.rankScore === "number" && Number.isFinite(alert.rankScore)
    ? alert.rankScore
    : typeof alert.alertRankScore === "number" && Number.isFinite(alert.alertRankScore)
      ? alert.alertRankScore
      : undefined;
  const suppress = typeof alert.suppress === "boolean"
    ? alert.suppress
    : typeof alert.alertSuppress === "boolean"
      ? alert.alertSuppress
      : undefined;
  const ttlSec = typeof alert.ttlSec === "number" && Number.isFinite(alert.ttlSec)
    ? alert.ttlSec
    : undefined;
  const title = alert.reason.trim() || alert.kind || alert.symbol;

  return {
    id: `alert:${alert.id}`,
    source: "alert",
    sourceId: alert.id,
    symbol: alert.symbol,
    ...(alert.kind ? { kind: alert.kind } : {}),
    bias: alert.bias,
    title,
    description: alert.reason,
    severity: alert.severity,
    ...(priority ? { priority } : {}),
    ...(rankScore !== undefined ? { rankScore } : {}),
    ...(suppress !== undefined ? { suppress } : {}),
    ...(alert.suppressReason ? { suppressReason: alert.suppressReason } : {}),
    ...(ttlSec !== undefined ? { ttlSec, expiresAt: alert.createdAt + ttlSec * 1000 } : {}),
    ...(Array.isArray(alert.tags) ? { tags: alert.tags } : {}),
    ...(alert.liveVisibility ? { liveVisibility: alert.liveVisibility } : {}),
    ...(alert.noiseClass ? { noiseClass: alert.noiseClass } : {}),
    createdAt: alert.createdAt,
    mergeKey: [alert.symbol.trim().toUpperCase(), alert.kind ?? "unknown", alert.bias ?? "unknown"].join("|"),
    rawRef: {
      collection: "alerts",
      id: alert.id
    }
  };
};

export class ScreenerEngine {
  private readonly symbols = new Map<string, SymbolState>();
  private readonly alerts: ScreenerAlert[] = [];
  private readonly volumeMilestones: VolumeMilestoneEvent[] = [];
  private readonly volumeThresholdMilestones: VolumeMilestoneEvent[] = [];
  private readonly volumeMilestoneActiveSymbols = new Set<string>();
  private readonly volumeThresholdLastSeenQuoteVolumeBySymbol = new Map<string, number>();
  private readonly lastAlertByKey = new Map<string, number>();
  private readonly alertListeners = new Set<(alert: ScreenerAlert) => void>();
  private latestMarketRiskSnapshot: ScreenerMarketRiskSnapshot = {
    symbols: [],
    matrix: [],
    heatmap: [],
    clusters: [],
    maxAbsCorrelation: 0
  };

  bootstrap(universe: UniverseSymbol[], tickers: RestTicker24h[]): void {
    for (const item of universe) {
      this.symbols.set(item.symbol, {
        ...item,
        lastPrice: 0,
        markPrice: 0,
        indexPrice: 0,
        fundingRate: 0,
        openInterestUsd: null,
        nextFundingTime: 0,
        change24hPct: 0,
        quoteVolume24h: 0,
        volume24h: 0,
        high24h: 0,
        low24h: 0,
        bestBid: null,
        bestAsk: null,
        bestBidQty: null,
        bestAskQty: null,
        lastUpdateTime: 0,
        priceSeries: new TimedPriceSeries(ROLLING_RETENTION_MS),
        tradeFlow: new TimedFlowBuffer(ROLLING_RETENTION_MS),
        liquidations: new TimedLiquidationBuffer(ROLLING_RETENTION_MS),
        openInterestSeries: new TimedValueSeries(ROLLING_RETENTION_MS),
        miniCandles: [],
        klineCandles: []
      });
    }

    const now = Date.now();

    for (const ticker of tickers) {
      const state = this.symbols.get(ticker.symbol);
      if (!state) {
        continue;
      }

      state.lastPrice = safeNumber(ticker.lastPrice);
      state.change24hPct = safeNumber(ticker.priceChangePercent);
      state.quoteVolume24h = safeNumber(ticker.quoteVolume);
      state.volume24h = safeNumber(ticker.volume);
      state.high24h = safeNumber(ticker.highPrice);
      state.low24h = safeNumber(ticker.lowPrice);
      state.lastUpdateTime = now;

      if (state.lastPrice > 0) {
        state.priceSeries.push(now, state.lastPrice);
      }
    }
  }

  getUniverseSize(): number {
    return this.symbols.size;
  }

  hasSymbol(symbol: string): boolean {
    return this.symbols.has(symbol.trim().toUpperCase());
  }

  getLiquiditySnapshot(): LiquiditySnapshotItem[] {
    return Array.from(this.symbols.values()).map((state) => ({
      symbol: state.symbol,
      baseAsset: state.baseAsset,
      quoteAsset: state.quoteAsset,
      lastPrice: state.lastPrice || state.markPrice || state.indexPrice || 0,
      change24hPct: state.change24hPct,
      quoteVolume24h: state.quoteVolume24h,
      volume24h: state.volume24h,
      updatedAt: state.lastUpdateTime
    }));
  }

  getLatestMarketRiskSnapshot(): ScreenerMarketRiskSnapshot {
    return this.latestMarketRiskSnapshot;
  }

  onAlert(listener: (alert: ScreenerAlert) => void): () => void {
    this.alertListeners.add(listener);
    return () => {
      this.alertListeners.delete(listener);
    };
  }

  pushExternalAlert(
    key: string,
    alert: ScreenerAlert,
    now = Date.now(),
    ranking?: AlertRankingResult | null
  ): boolean {
    return this.pushAlertIfCooldown(key, alert, now, ranking);
  }

  applyTickerBatch(events: AllMarketTickerEvent[]): void {
    for (const event of events) {
      const state = this.symbols.get(event.s);
      if (!state) {
        continue;
      }

      state.lastPrice = safeNumber(event.c);
      state.change24hPct = safeNumber(event.P);
      state.quoteVolume24h = safeNumber(event.q);
      state.volume24h = safeNumber(event.v);
      state.high24h = safeNumber(event.h);
      state.low24h = safeNumber(event.l);
      state.lastUpdateTime = event.E;

      if (state.lastPrice > 0) {
        state.priceSeries.push(event.E, state.lastPrice);
      }
    }
  }

  applyMarkPriceBatch(events: MarkPriceEvent[]): void {
    for (const event of events) {
      const state = this.symbols.get(event.s);
      if (!state) {
        continue;
      }

      state.markPrice = safeNumber(event.p);
      state.indexPrice = safeNumber(event.i);
      state.fundingRate = safeNumber(event.r);
      state.nextFundingTime = event.T;
      state.lastUpdateTime = event.E;

      const price = state.markPrice || state.lastPrice;
      if (price > 0) {
        state.priceSeries.push(event.E, price);
      }
    }
  }

  applyAggTrade(event: AggTradeEvent): void {
    const state = this.symbols.get(event.s);
    if (!state) {
      return;
    }

    const price = safeNumber(event.p);
    const quantity = safeNumber(event.q);
    const notional = price * quantity;
    const aggressiveBuy = event.m ? 0 : notional;
    const aggressiveSell = event.m ? notional : 0;

    state.tradeFlow.push(event.E, aggressiveBuy, aggressiveSell);
    state.lastPrice = price || state.lastPrice;
    state.lastUpdateTime = event.E;

    if (price > 0) {
      state.priceSeries.push(event.E, price);
      this.updateMiniCandles(state, event.E, price, notional, aggressiveBuy, aggressiveSell);
    }
  }

  applyBookTicker(event: BookTickerEvent): void {
    const state = this.symbols.get(event.s);
    if (!state) {
      return;
    }

    state.bestBid = safeNumber(event.b);
    state.bestAsk = safeNumber(event.a);
    state.bestBidQty = safeNumber(event.B);
    state.bestAskQty = safeNumber(event.A);
    state.lastUpdateTime = event.E ?? event.T ?? Date.now();
  }

  applyLiquidation(event: ForceOrderEvent): void {
    const state = this.symbols.get(event.o.s);
    if (!state) {
      return;
    }

    const executionPrice = safeNumber(event.o.ap) || safeNumber(event.o.p);
    const quantity = safeNumber(event.o.q);
    const notional = executionPrice * quantity;
    const longsHit = event.o.S === "SELL" ? notional : 0;
    const shortsHit = event.o.S === "BUY" ? notional : 0;

    state.liquidations.push(event.o.T, longsHit, shortsHit);
    state.lastUpdateTime = event.E;
  }

  applyKline(event: KlineEvent): void {
    const state = this.symbols.get(event.s);
    if (!state) {
      return;
    }

    const k = event.k;
    const open = safeNumber(k.o);
    const high = safeNumber(k.h);
    const low = safeNumber(k.l);
    const close = safeNumber(k.c);
    const volume = safeNumber(k.q);
    const timestamp = k.t;

    if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume <= 0) {
      return;
    }

    const candle: MiniCandle = {
      timestamp,
      open,
      high,
      low,
      close,
      volume
    };

    const last = state.klineCandles[state.klineCandles.length - 1];
    if (last?.timestamp === timestamp) {
      Object.assign(last, candle);
    } else {
      state.klineCandles.push(candle);
    }

    if (state.klineCandles.length > MINI_CANDLE_MAX_POINTS) {
      state.klineCandles.splice(0, state.klineCandles.length - MINI_CANDLE_MAX_POINTS);
    }

    state.lastPrice = close || state.lastPrice;
    state.lastUpdateTime = event.E;

    if (close > 0) {
      state.priceSeries.push(event.E, close);
    }
  }

  applyOpenInterest(symbol: string, openInterestContracts: number, time = Date.now()): void {
    const state = this.symbols.get(symbol);
    if (!state || !Number.isFinite(openInterestContracts)) {
      return;
    }

    const referencePrice = state.markPrice || state.lastPrice || state.indexPrice || 0;
    const openInterestUsd = referencePrice > 0 ? openInterestContracts * referencePrice : 0;

    state.openInterestUsd = openInterestUsd;
    state.openInterestSeries.push(time, openInterestUsd);
    state.lastUpdateTime = Math.max(state.lastUpdateTime, time);
  }

  computeDesiredFocusSymbols(settings: BackendSettings, pinnedSymbols: Set<string>): string[] {
    const baseline = Array.from(this.symbols.values())
      .map((state) => ({
        symbol: state.symbol,
        score: this.focusRank(state)
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(settings.focusUniverseSize, 5))
      .map((item) => item.symbol);

    const ordered = [...CORE_SYMBOLS, ...Array.from(pinnedSymbols), ...baseline]
      .filter((symbol, index, array) => Boolean(this.symbols.get(symbol)) && array.indexOf(symbol) === index)
      .slice(0, Math.max(settings.focusUniverseSize, CORE_SYMBOLS.length));

    return ordered;
  }

  buildMiniCandleSeries(symbols: string[]): MiniCandleSeries[] {
    const uniqueSymbols = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];

    const series: MiniCandleSeries[] = [];

    for (const symbol of uniqueSymbols) {
      const state = this.symbols.get(symbol);
      if (!state) {
        continue;
      }

      const useKline = state.klineCandles.length > 0;
      const candles = useKline
        ? state.klineCandles.slice(-MINI_CANDLE_MAX_POINTS)
        : state.miniCandles.slice(-MINI_CANDLE_MAX_POINTS);

      if (candles.length === 0) {
        continue;
      }

      series.push({
        symbol,
        interval: MINI_CANDLE_INTERVAL,
        candles,
        source: useKline ? "kline" : "aggTradeSynthetic"
      });
    }

    return series;
  }

  private updateMiniCandles(
    state: SymbolState,
    timestamp: number,
    price: number,
    volume: number,
    buyVolume: number,
    sellVolume: number
  ): void {
    if (price <= 0 || volume <= 0) {
      return;
    }

    const candleTimestamp = Math.floor(timestamp / MINI_CANDLE_INTERVAL_MS) * MINI_CANDLE_INTERVAL_MS;
    const last = state.miniCandles[state.miniCandles.length - 1];

    if (last?.timestamp === candleTimestamp) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
      last.volume = round(last.volume + volume, 2);
      last.buyVolume = round((last.buyVolume ?? 0) + buyVolume, 2);
      last.sellVolume = round((last.sellVolume ?? 0) + sellVolume, 2);
    } else {
      state.miniCandles.push({
        timestamp: candleTimestamp,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: round(volume, 2),
        buyVolume: round(buyVolume, 2),
        sellVolume: round(sellVolume, 2)
      });
    }

    if (state.miniCandles.length > MINI_CANDLE_MAX_POINTS) {
      state.miniCandles.splice(0, state.miniCandles.length - MINI_CANDLE_MAX_POINTS);
    }
  }

  buildFrame(options: FrameOptions): BaseFrame {
    const rawAssemblyDiagnostics: RawAssemblyDiagnostics = {};
    const pinnedSymbols = new Set([
      ...options.watchlist,
      ...options.manualActiveTrades,
      ...options.accountActiveTrades
    ]);
    const focusSymbols = this.computeDesiredFocusSymbols(options.settings, pinnedSymbols);
    const focusSet = new Set(focusSymbols);
    const now = Date.now();

    const rowsBuildStartedAt = Date.now();
    const baseRows = Array.from(this.symbols.values()).map((state) =>
      this.buildRow(
        state,
        focusSet,
        options.watchlist,
        options.manualActiveTrades,
        options.accountActiveTrades,
        rawAssemblyDiagnostics
      )
    );
    rawAssemblyDiagnostics.rawRowsBuildMs = Date.now() - rowsBuildStartedAt;

    const baseRowsSortStartedAt = Date.now();
    baseRows.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.quoteVolume24h - left.quoteVolume24h;
    });
    rawAssemblyDiagnostics.rawRowsSortMs = Date.now() - baseRowsSortStartedAt;

    const correlationStartedAt = Date.now();
    const correlationContext = this.buildCorrelationContext(baseRows, focusSymbols);
    this.latestMarketRiskSnapshot = {
      symbols: correlationContext.symbols,
      matrix: correlationContext.matrix,
      heatmap: correlationContext.matrix.flatMap((row, rowIndex) =>
        row.map((value, columnIndex) => ({
          x: columnIndex,
          y: rowIndex,
          value
        }))
      ),
      clusters: correlationContext.clusters,
      maxAbsCorrelation: correlationContext.maxAbsCorrelation
    };
    rawAssemblyDiagnostics.rawCorrelationMs = Date.now() - correlationStartedAt;

    const riskScoreApplyStartedAt = Date.now();
    const rows = baseRows
      .map((row) => this.applyCorrelationToRow(row, correlationContext))
      .map((row) => this.applyRiskScoreToRow(row))
      .map((row) => this.applyWhyTradeToRow(row));
    rawAssemblyDiagnostics.rawRiskScoreApplyMs = Date.now() - riskScoreApplyStartedAt;

    const rowsSortStartedAt = Date.now();
    rows.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.quoteVolume24h - left.quoteVolume24h;
    });
    rawAssemblyDiagnostics.rawRowsSortMs += Date.now() - rowsSortStartedAt;

    const milestonesStartedAt = Date.now();
    this.maybeGenerateVolumeMilestones(rows, options.settings, now);
    this.maybeGenerateVolumeThresholdMilestones(rows, now);
    rawAssemblyDiagnostics.rawMilestonesMs = Date.now() - milestonesStartedAt;

    const alertsStartedAt = Date.now();
    this.maybeGenerateAlerts(rows, now);
    rawAssemblyDiagnostics.rawAlertsMs = Date.now() - alertsStartedAt;

    const overviewStartedAt = Date.now();
    const overview = this.buildOverview(rows, focusSet);
    rawAssemblyDiagnostics.rawOverviewMs = Date.now() - overviewStartedAt;
    const alerts = this.alerts.slice(0, 50);

    return {
      type: "frame",
      generatedAt: now,
      settings: options.settings,
      status: {
        phase: options.phase,
        message: options.phaseMessage,
        universeSize: this.symbols.size,
        focusSymbols,
        marketStream: options.streamHealth.market,
        publicStream: options.streamHealth.public,
        accountStream: options.accountStream
      },
      overview,
      rows,
      alerts,
      unifiedSignals: alerts.map(buildUnifiedSignalFromAlert),
      volumeMilestones: this.volumeMilestones.slice(0, 50),
      volumeThresholdMilestones: this.volumeThresholdMilestones.slice(0, 100),
      rawAssemblyDiagnostics
    };
  }

  private buildOverview(rows: ScreenerRow[], focusSet: Set<string>): ScreenerOverview {
    const advancingCount = rows.filter((row) => row.change24hPct >= 0).length;
    const decliningCount = rows.length - advancingCount;
    const focusRows = rows.filter((row) => focusSet.has(row.symbol));
    const marketPulse = round(
      focusRows.reduce((sum, row) => sum + (row.bias === "LONG" ? 1 : row.bias === "SHORT" ? -1 : 0), 0),
      2
    );

    const topLongSymbol = rows.find((row) => row.bias === "LONG")?.symbol ?? null;
    const topShortSymbol = rows.find((row) => row.bias === "SHORT")?.symbol ?? null;
    const hotLiquidationsUsd = rows
      .slice(0, 20)
      .reduce((sum, row) => sum + row.liquidation5m, 0);

    let dominantRegime: ScreenerOverview["dominantRegime"] = "balanced";
    if (marketPulse >= 6) {
      dominantRegime = "risk-on";
    } else if (marketPulse <= -6) {
      dominantRegime = "risk-off";
    }

    return {
      advancingCount,
      decliningCount,
      focusSymbols: focusSet.size,
      trackedSymbols: rows.length,
      hotLiquidationsUsd,
      topLongSymbol,
      topShortSymbol,
      dominantRegime,
      marketPulse
    };
  }

  private buildRow(
    state: SymbolState,
    focusSet: Set<string>,
    watchlist: Set<string>,
    manualActiveTrades: Set<string>,
    accountActiveTrades: Set<string>,
    diagnostics?: RawAssemblyDiagnostics
  ): ScreenerRow {
    const rowBuildStartedAt = Date.now();
    let rawTradeFlowMs = 0;
    let rawLiquidationsMs = 0;
    let rawReturnSeriesMs = 0;
    let rawVarMs = 0;
    let rawTagsMs = 0;
    const price = state.lastPrice || state.markPrice || state.indexPrice || 0;
    const momentum30sPct = round(state.priceSeries.deltaPctAgo(30_000), 3);
    const momentum2mPct = round(state.priceSeries.deltaPctAgo(120_000), 3);

    const tradeFlowStartedAt = Date.now();
    const flow5s = state.tradeFlow.sumWindow(5_000);
    const flow60s = state.tradeFlow.sumWindow(60_000);
    const flow5m = state.tradeFlow.sumWindow(300_000);
    const flow1h = state.tradeFlow.sumWindow(3_600_000);
    rawTradeFlowMs = Date.now() - tradeFlowStartedAt;

    const liquidationsStartedAt = Date.now();
    const liq5m = state.liquidations.sumWindow(300_000);
    const liq1h = state.liquidations.sumWindow(3_600_000);
    rawLiquidationsMs = Date.now() - liquidationsStartedAt;

    const tradeNotional5s = flow5s.buy + flow5s.sell;
    const tradeNotional60s = flow60s.buy + flow60s.sell;
    const previousFourMinuteAverage = Math.max(
      (flow5m.buy + flow5m.sell - tradeNotional60s) / 4,
      1
    );
    const volumeImpulse = round(tradeNotional60s / previousFourMinuteAverage, 2);
    const buyRatio60s = tradeNotional60s > 0 ? round(flow60s.buy / tradeNotional60s, 3) : 0.5;

    const spreadBps =
      state.bestBid && state.bestAsk && price > 0
        ? round(((state.bestAsk - state.bestBid) / price) * 10_000, 2)
        : null;

    const orderBookImbalance =
      state.bestBidQty && state.bestAskQty && state.bestBidQty + state.bestAskQty > 0
        ? round(
            (state.bestBidQty - state.bestAskQty) / (state.bestBidQty + state.bestAskQty),
            3
          )
        : null;

    const liquidation5m = round(liq5m.longsHit + liq5m.shortsHit, 2);
    const liquidationSkew = clamp((liq5m.shortsHit - liq5m.longsHit) / 120_000, -12, 12);

    const rawBiasScore =
      clamp(momentum30sPct * 18, -24, 24) +
      clamp(momentum2mPct * 10, -18, 18) +
      clamp((buyRatio60s - 0.5) * 90, -14, 14) +
      clamp((volumeImpulse - 1) * 6, -12, 18) +
      clamp((orderBookImbalance ?? 0) * 18, -10, 10) +
      clamp(state.change24hPct / 3, -10, 10) +
      liquidationSkew -
      clamp((spreadBps ?? 0) * 0.8, 0, 15);

    const score = round(clamp(50 + rawBiasScore, 0, 100), 2);

    let bias: Bias = "NEUTRAL";
    if (rawBiasScore >= 9) {
      bias = "LONG";
    } else if (rawBiasScore <= -9) {
      bias = "SHORT";
    }

    let liquidationBias: ScreenerRow["liquidationBias"] = "BALANCED";
    if (liq5m.longsHit > liq5m.shortsHit * 1.15) {
      liquidationBias = "LONGS_HIT";
    } else if (liq5m.shortsHit > liq5m.longsHit * 1.15) {
      liquidationBias = "SHORTS_HIT";
    }

    const tagsStartedAt = Date.now();
    const tags: string[] = [];
    const isManualActiveTrade = manualActiveTrades.has(state.symbol);
    const isAccountActiveTrade = accountActiveTrades.has(state.symbol);
    const isActiveTrade = isManualActiveTrade || isAccountActiveTrade;
    let activeTradeSource: ActiveTradeSource = "none";

    if (isManualActiveTrade && isAccountActiveTrade) {
      activeTradeSource = "both";
    } else if (isAccountActiveTrade) {
      activeTradeSource = "account";
    } else if (isManualActiveTrade) {
      activeTradeSource = "manual";
    }

    if (focusSet.has(state.symbol)) {
      tags.push("FOCUS");
    }
    if (isActiveTrade) {
      tags.push("TRADE");
    }
    if (watchlist.has(state.symbol)) {
      tags.push("WATCH");
    }
    if (volumeImpulse >= 1.8) {
      tags.push("VOL SPIKE");
    }
    if (buyRatio60s >= 0.58 && momentum30sPct > 0.25) {
      tags.push("BID TAPE");
    }
    if (buyRatio60s <= 0.42 && momentum30sPct < -0.25) {
      tags.push("OFFER TAPE");
    }
    if ((spreadBps ?? 0) >= 6) {
      tags.push("WIDE");
    }
    if (liquidation5m >= 250_000) {
      tags.push("LIQ SWEEP");
    }
    if (Math.abs(state.fundingRate) >= 0.0008) {
      tags.push("FUNDING");
    }
    rawTagsMs = Date.now() - tagsStartedAt;

    const returnSeriesStartedAt = Date.now();
    const returns5m = state.priceSeries.returnSeries(300_000);
    const returns1h = state.priceSeries.returnSeries(3_600_000);
    rawReturnSeriesMs = Date.now() - returnSeriesStartedAt;

    const basisUsd = round((state.markPrice || price) - state.indexPrice, 6);
    const basisPct = state.indexPrice > 0 ? round((basisUsd / state.indexPrice) * 100, 4) : 0;
    const annualizedFundingPressureScore = round(
      clamp(Math.abs(state.fundingRate * 3 * 365 * 100) + Math.abs(basisPct) * 12, 0, 100),
      2
    );
    const cvd5mUsd = round(flow5m.buy - flow5m.sell, 2);
    const cvd1hUsd = round(flow1h.buy - flow1h.sell, 2);
    const liquidationNet5mUsd = round(liq5m.shortsHit - liq5m.longsHit, 2);
    const liquidationNet1hUsd = round(liq1h.shortsHit - liq1h.longsHit, 2);
    const openInterestUsd = state.openInterestUsd !== null ? round(state.openInterestUsd, 2) : null;
    const openInterestDelta5mUsd =
      openInterestUsd !== null ? round(state.openInterestSeries.deltaAgo(300_000), 2) : null;
    const openInterestDelta1hUsd =
      openInterestUsd !== null ? round(state.openInterestSeries.deltaAgo(3_600_000), 2) : null;
    const flowPressureScore = round(
      clamp(
        (openInterestDelta5mUsd ?? 0) / Math.max(state.quoteVolume24h, 1) * 240 +
          cvd5mUsd / Math.max(state.quoteVolume24h, 1) * 120 +
          liquidationNet5mUsd / Math.max(state.quoteVolume24h, 1) * 240 +
          momentum30sPct * 4,
        -100,
        100
      ),
      2
    );
    let directionalBias: FlowDirectionalBias = "NEUTRAL";
    if (flowPressureScore >= 12) {
      directionalBias = "LONG";
    } else if (flowPressureScore <= -12) {
      directionalBias = "SHORT";
    }

    const volatility1hStartedAt = Date.now();
    const volatility1hPct = round(this.computeVolatilityPct(returns1h), 3);
    rawVarMs += Date.now() - volatility1hStartedAt;

    const baseStressBufferPct = Math.max(volatility1hPct * 2.4, 0.75);
    const downsideStressPct = round(
      clamp(
        baseStressBufferPct +
          Math.max(-momentum2mPct, 0) * 0.65 +
          Math.max(liq5m.longsHit - liq5m.shortsHit, 0) / Math.max(state.quoteVolume24h, 1) * 600 +
          Math.max(-flowPressureScore, 0) * 0.08,
        0.25,
        35
      ),
      3
    );
    const upsideStressPct = round(
      clamp(
        baseStressBufferPct +
          Math.max(momentum2mPct, 0) * 0.65 +
          Math.max(liq5m.shortsHit - liq5m.longsHit, 0) / Math.max(state.quoteVolume24h, 1) * 600 +
          Math.max(flowPressureScore, 0) * 0.08,
        0.25,
        35
      ),
      3
    );
    const nearestDistancePct = Math.min(downsideStressPct, upsideStressPct);
    const liquidationPressureIndex = round(clamp(100 - nearestDistancePct * 3.5, 0, 100), 2);
    const marginBufferUtilization = round(clamp(liquidationPressureIndex * 0.88, 0, 100), 2);

    const varPayloadStartedAt = Date.now();
    const sortedReturns5m =
      returns5m.length >= 10 ? [...returns5m].sort((left, right) => left - right) : [];
    const sortedReturns1h =
      returns1h.length >= 10 ? [...returns1h].sort((left, right) => left - right) : [];
    const varPayload: RiskVarPayload = {
      var95_5m: this.computeVarPctFromSorted(sortedReturns5m, 0.95),
      var99_5m: this.computeVarPctFromSorted(sortedReturns5m, 0.99),
      var95_1h: this.computeVarPctFromSorted(sortedReturns1h, 0.95),
      var99_1h: this.computeVarPctFromSorted(sortedReturns1h, 0.99),
      volatility5m: round(this.computeVolatilityPct(returns5m), 3),
      volatility1h: volatility1hPct,
      sampleSize5m: returns5m.length,
      sampleSize1h: returns1h.length
    };
    rawVarMs += Date.now() - varPayloadStartedAt;

    const fundingPayload: RiskFundingPayload = {
      fundingRate: round(state.fundingRate, 6),
      basisUsd,
      basisPct,
      annualizedFundingPressureScore
    };

    const flowPayload = {
      openInterestUsd,
      openInterestDelta5mUsd,
      openInterestDelta1hUsd,
      cvd5mUsd,
      cvd1hUsd,
      liquidationNet5mUsd,
      liquidationNet1hUsd,
      flowPressureScore,
      directionalBias
    };

    const liquidationDistancePayload: RiskLiquidationDistancePayload = {
      distanceToLongPct: downsideStressPct,
      distanceToShortPct: upsideStressPct,
      nearestDistancePct,
      liquidationPressureIndex,
      marginBufferUtilization
    };

    const targetAttributionTotal = round(clamp((score - 50) * 2, -100, 100), 2);
    const momentumContribution = round(momentum2mPct * 1.8 + momentum30sPct * 1.2, 2);
    const flowContribution = round(flowPressureScore * 0.34, 2);
    const fundingCarry = round(
      (bias === "LONG" ? -1 : bias === "SHORT" ? 1 : -0.5) *
        annualizedFundingPressureScore *
        0.08,
      2
    );
    const residual = round(
      targetAttributionTotal - momentumContribution - flowContribution - fundingCarry,
      2
    );
    const pnlAttributionPayload: RiskPnlAttributionPayload = {
      momentumContribution,
      flowContribution,
      fundingCarry,
      residual,
      total: targetAttributionTotal
    };

    const riskPayload: RiskSymbolPayload = {
      liquidationDistance: liquidationDistancePayload,
      var: varPayload,
      correlationRow: {
        strongestPositive: [],
        strongestNegative: []
      },
      funding: fundingPayload,
      flow: flowPayload,
      pnlAttribution: pnlAttributionPayload
    };

    const row: ScreenerRow = {
      symbol: state.symbol,
      baseAsset: state.baseAsset,
      lastPrice: round(price, 6),
      markPrice: round(state.markPrice || price, 6),
      bestBid: state.bestBid !== null ? round(state.bestBid, 6) : null,
      bestAsk: state.bestAsk !== null ? round(state.bestAsk, 6) : null,
      bestBidQty: state.bestBidQty !== null ? round(state.bestBidQty, 4) : null,
      bestAskQty: state.bestAskQty !== null ? round(state.bestAskQty, 4) : null,
      change24hPct: round(state.change24hPct, 3),
      quoteVolume24h: round(state.quoteVolume24h, 2),
      volume24h: round(state.volume24h, 2),
      momentum30sPct,
      momentum2mPct,
      buyRatio60s,
      tradeNotional5s: round(tradeNotional5s, 2),
      tradeNotional60s: round(tradeNotional60s, 2),
      volumeImpulse,
      spreadBps,
      orderBookImbalance,
      fundingRate: round(state.fundingRate, 5),
      liquidation5m,
      liquidationBias,
      score,
      bias,
      riskScore: 0,
      riskLevel: "LOW",
      risk: riskPayload,
      tags,
      isFocus: focusSet.has(state.symbol),
      isWatchlist: watchlist.has(state.symbol),
      isActiveTrade,
      activeTradeSource,
      updatedAt: state.lastUpdateTime
    };

    if (diagnostics) {
      const knownBucketMs =
        rawTradeFlowMs + rawLiquidationsMs + rawReturnSeriesMs + rawVarMs + rawTagsMs;
      diagnostics.rawTradeFlowMs = (diagnostics.rawTradeFlowMs ?? 0) + rawTradeFlowMs;
      diagnostics.rawLiquidationsMs = (diagnostics.rawLiquidationsMs ?? 0) + rawLiquidationsMs;
      diagnostics.rawReturnSeriesMs = (diagnostics.rawReturnSeriesMs ?? 0) + rawReturnSeriesMs;
      diagnostics.rawVarMs = (diagnostics.rawVarMs ?? 0) + rawVarMs;
      diagnostics.rawTagsMs = (diagnostics.rawTagsMs ?? 0) + rawTagsMs;
      diagnostics.rawPerSymbolOtherMs =
        (diagnostics.rawPerSymbolOtherMs ?? 0) +
        Math.max(Date.now() - rowBuildStartedAt - knownBucketMs, 0);
    }

    return row;
  }

  private computeVarPctFromSorted(sortedReturns: number[], confidence: 0.95 | 0.99): number | null {
    if (sortedReturns.length < 10) {
      return null;
    }

    const tailProbability = 1 - confidence;
    const index = Math.min(
      sortedReturns.length - 1,
      Math.max(0, Math.floor(sortedReturns.length * tailProbability))
    );
    const tailReturn = Math.abs(sortedReturns[index] ?? 0) * 100;
    return round(tailReturn, 3);
  }

  private computeVolatilityPct(returns: number[]): number {
    if (returns.length < 2) {
      return 0;
    }

    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance =
      returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(returns.length - 1, 1);

    return Math.sqrt(Math.max(variance, 0)) * 100;
  }

  private computePearson(left: number[], right: number[]): number {
    const sampleSize = Math.min(left.length, right.length);
    if (sampleSize < CORRELATION_MIN_OBSERVATIONS) {
      return 0;
    }

    const leftSlice = left.slice(-sampleSize);
    const rightSlice = right.slice(-sampleSize);
    const leftMean = leftSlice.reduce((sum, value) => sum + value, 0) / sampleSize;
    const rightMean = rightSlice.reduce((sum, value) => sum + value, 0) / sampleSize;

    let covariance = 0;
    let leftVariance = 0;
    let rightVariance = 0;

    for (let index = 0; index < sampleSize; index += 1) {
      const leftDelta = (leftSlice[index] ?? 0) - leftMean;
      const rightDelta = (rightSlice[index] ?? 0) - rightMean;
      covariance += leftDelta * rightDelta;
      leftVariance += leftDelta * leftDelta;
      rightVariance += rightDelta * rightDelta;
    }

    if (leftVariance <= 0 || rightVariance <= 0) {
      return 0;
    }

    return round(
      clamp(covariance / Math.sqrt(leftVariance * rightVariance), -1, 1),
      4
    );
  }

  private buildCorrelationContext(rows: ScreenerRow[], focusSymbols: string[]): CorrelationContext {
    const rankedSymbols = focusSymbols
      .map((symbol) => {
        const row = rows.find((item) => item.symbol === symbol);
        const state = this.symbols.get(symbol);
        return {
          symbol,
          row,
          returns: state?.priceSeries.returnSeries(3_600_000) ?? []
        };
      })
      .filter(
        (item) =>
          item.row &&
          item.returns.length >= CORRELATION_MIN_OBSERVATIONS
      )
      .sort((left, right) => (right.row?.quoteVolume24h ?? 0) - (left.row?.quoteVolume24h ?? 0))
      .slice(0, MAX_CORRELATION_SYMBOLS);

    const symbols = rankedSymbols.map((item) => item.symbol);
    const matrix = symbols.map(() => symbols.map(() => 0));
    const rowPayloads = new Map<string, RiskCorrelationRowPayload>();
    let maxAbsCorrelation = 0;

    for (let rowIndex = 0; rowIndex < symbols.length; rowIndex += 1) {
      matrix[rowIndex]![rowIndex] = 1;
      const strongestPositive: Array<{ symbol: string; correlation: number }> = [];
      const strongestNegative: Array<{ symbol: string; correlation: number }> = [];

      for (let columnIndex = rowIndex + 1; columnIndex < symbols.length; columnIndex += 1) {
        const left = rankedSymbols[rowIndex];
        const right = rankedSymbols[columnIndex];
        const correlation = this.computePearson(left?.returns ?? [], right?.returns ?? []);
        matrix[rowIndex]![columnIndex] = correlation;
        matrix[columnIndex]![rowIndex] = correlation;
        maxAbsCorrelation = Math.max(maxAbsCorrelation, Math.abs(correlation));
      }

      for (let columnIndex = 0; columnIndex < symbols.length; columnIndex += 1) {
        if (columnIndex === rowIndex) {
          continue;
        }

        const correlation = matrix[rowIndex]![columnIndex] ?? 0;
        const symbol = symbols[columnIndex]!;

        if (correlation >= 0) {
          strongestPositive.push({ symbol, correlation });
        } else {
          strongestNegative.push({ symbol, correlation });
        }
      }

      strongestPositive.sort((left, right) => right.correlation - left.correlation);
      strongestNegative.sort((left, right) => left.correlation - right.correlation);
      rowPayloads.set(symbols[rowIndex]!, {
        strongestPositive: strongestPositive.slice(0, 3).map((item) => ({
          symbol: item.symbol,
          correlation: round(item.correlation, 4)
        })),
        strongestNegative: strongestNegative.slice(0, 3).map((item) => ({
          symbol: item.symbol,
          correlation: round(item.correlation, 4)
        }))
      });
    }

    return {
      symbols,
      matrix,
      rowPayloads,
      clusters: this.buildCorrelationClusters(symbols, matrix),
      maxAbsCorrelation: round(maxAbsCorrelation, 4)
    };
  }

  private buildCorrelationClusters(symbols: string[], matrix: number[][]): RiskCorrelationCluster[] {
    const visited = new Set<number>();
    const clusters: RiskCorrelationCluster[] = [];

    for (let startIndex = 0; startIndex < symbols.length; startIndex += 1) {
      if (visited.has(startIndex)) {
        continue;
      }

      const queue = [startIndex];
      const clusterIndices: number[] = [];

      while (queue.length > 0) {
        const index = queue.shift();
        if (index === undefined || visited.has(index)) {
          continue;
        }

        visited.add(index);
        clusterIndices.push(index);

        for (let nextIndex = 0; nextIndex < symbols.length; nextIndex += 1) {
          if (
            nextIndex !== index &&
            !visited.has(nextIndex) &&
            Math.abs(matrix[index]?.[nextIndex] ?? 0) >= CORRELATION_SPIKE_THRESHOLD
          ) {
            queue.push(nextIndex);
          }
        }
      }

      if (clusterIndices.length < 2) {
        continue;
      }

      const clusterSymbols = clusterIndices.map((index) => symbols[index]!);
      let correlationSum = 0;
      let pairCount = 0;

      for (let rowIndex = 0; rowIndex < clusterIndices.length; rowIndex += 1) {
        for (let columnIndex = rowIndex + 1; columnIndex < clusterIndices.length; columnIndex += 1) {
          correlationSum += Math.abs(
            matrix[clusterIndices[rowIndex]!]![clusterIndices[columnIndex]!] ?? 0
          );
          pairCount += 1;
        }
      }

      clusters.push({
        symbols: clusterSymbols,
        averageCorrelation: pairCount > 0 ? round(correlationSum / pairCount, 4) : 0
      });
    }

    return clusters.sort((left, right) => right.averageCorrelation - left.averageCorrelation);
  }

  private applyCorrelationToRow(row: ScreenerRow, context: CorrelationContext): ScreenerRow {
    const nextCorrelationRow =
      context.rowPayloads.get(row.symbol) ?? {
        strongestPositive: [],
        strongestNegative: []
      };

    return {
      ...row,
      risk: {
        ...row.risk,
        correlationRow: nextCorrelationRow
      }
    };
  }

  private applyRiskScoreToRow(row: ScreenerRow): ScreenerRow {
    const correlationStrength = Math.max(
      Math.abs(row.risk.correlationRow.strongestPositive[0]?.correlation ?? 0),
      Math.abs(row.risk.correlationRow.strongestNegative[0]?.correlation ?? 0)
    );
    const varRisk =
      ((row.risk.var.var99_5m ?? row.risk.var.var95_5m ?? 0) * 4 +
        (row.risk.var.var99_1h ?? row.risk.var.var95_1h ?? 0) * 2);
    const riskScore = round(
      clamp(
        row.risk.liquidationDistance.liquidationPressureIndex * 0.3 +
          varRisk * 0.18 +
          correlationStrength * 100 * 0.16 +
          row.risk.funding.annualizedFundingPressureScore * 0.12 +
          Math.abs(row.risk.flow.flowPressureScore) * 0.16 +
          (row.spreadBps ?? 0) * 0.8 +
          Math.abs(row.momentum30sPct) * 0.8,
        0,
        100
      ),
      2
    );

    let riskLevel: RiskLevel = "LOW";
    if (riskScore >= 75) {
      riskLevel = "CRITICAL";
    } else if (riskScore >= 55) {
      riskLevel = "HIGH";
    } else if (riskScore >= 30) {
      riskLevel = "MEDIUM";
    }

    return {
      ...row,
      riskScore,
      riskLevel
    };
  }

  private applyWhyTradeToRow(row: ScreenerRow): ScreenerRow {
    const whyTrade: NonNullable<ScreenerRow["whyTrade"]> = [];
    const whyNotTrade: NonNullable<ScreenerRow["whyNotTrade"]> = [];
    const supportsLong = row.bias === "LONG";
    const supportsShort = row.bias === "SHORT";
    const flowSupportsBias =
      (supportsLong && row.risk.flow.directionalBias === "LONG") ||
      (supportsShort && row.risk.flow.directionalBias === "SHORT");
    const liquidationSupportsBias =
      (supportsLong && row.liquidationBias === "SHORTS_HIT") ||
      (supportsShort && row.liquidationBias === "LONGS_HIT");
    const momentumAgainstBias =
      (supportsLong && row.momentum2mPct < -0.15) ||
      (supportsShort && row.momentum2mPct > 0.15);
    const fundingPressure = row.risk.funding.annualizedFundingPressureScore;
    const nearestLiquidationDistance = row.risk.liquidationDistance.nearestDistancePct;
    const spreadBps = row.spreadBps ?? 0;

    if (row.volumeImpulse >= 1.8) {
      whyTrade.push({
        code: "volume_impulse",
        label: "Volume impulse is elevated",
        value: row.volumeImpulse,
        weight: Math.min(row.volumeImpulse * 10, 40)
      });
    }

    if (row.quoteVolume24h >= 100_000_000) {
      whyTrade.push({
        code: "quote_volume_high",
        label: "24h quote volume is high",
        value: row.quoteVolume24h,
        weight: 18
      });
    }

    if (
      (supportsLong && row.momentum2mPct > 0.35) ||
      (supportsShort && row.momentum2mPct < -0.35)
    ) {
      whyTrade.push({
        code: "momentum_with_bias",
        label: "Short-term momentum supports bias",
        value: row.momentum2mPct,
        weight: Math.min(Math.abs(row.momentum2mPct) * 8, 28)
      });
    }

    if (row.score >= 70) {
      whyTrade.push({
        code: "strong_score",
        label: "Screener score is strong",
        value: row.score,
        weight: Math.min(row.score - 50, 35)
      });
    }

    if (flowSupportsBias) {
      whyTrade.push({
        code: "flow_supports_bias",
        label: "Market flow supports direction",
        value: row.risk.flow.flowPressureScore,
        weight: Math.min(Math.abs(row.risk.flow.flowPressureScore), 30)
      });
    }

    if (liquidationSupportsBias && row.liquidation5m >= 250_000) {
      whyTrade.push({
        code: "liquidation_supports_bias",
        label: "Liquidation pressure supports direction",
        value: row.liquidation5m,
        weight: 22
      });
    }

    if (spreadBps > 12) {
      whyNotTrade.push({
        code: "spread_too_wide",
        label: "Spread is too wide for clean execution",
        value: spreadBps,
        severity: "critical"
      });
    } else if (spreadBps > 6) {
      whyNotTrade.push({
        code: "spread_elevated",
        label: "Spread is elevated",
        value: spreadBps,
        severity: "warning"
      });
    }

    if (row.riskLevel === "CRITICAL" || row.riskLevel === "HIGH") {
      whyNotTrade.push({
        code: "risk_level_high",
        label: "Risk level is high",
        value: row.riskLevel,
        severity: row.riskLevel === "CRITICAL" ? "critical" : "warning"
      });
    }

    if (fundingPressure >= 35) {
      whyNotTrade.push({
        code: "funding_crowded",
        label: "Funding pressure is crowded",
        value: fundingPressure,
        severity: fundingPressure >= 55 ? "critical" : "warning"
      });
    }

    if (nearestLiquidationDistance !== null && nearestLiquidationDistance <= 2) {
      whyNotTrade.push({
        code: "liquidation_distance_small",
        label: "Liquidation distance is small",
        value: nearestLiquidationDistance,
        severity: nearestLiquidationDistance <= 1 ? "critical" : "warning"
      });
    }

    if (momentumAgainstBias) {
      whyNotTrade.push({
        code: "momentum_against_bias",
        label: "Momentum is moving against bias",
        value: row.momentum2mPct,
        severity: "warning"
      });
    }

    if (row.score < 45) {
      whyNotTrade.push({
        code: "score_low",
        label: "Screener score is weak",
        value: row.score,
        severity: "info"
      });
    }

    return {
      ...row,
      whyTrade: whyTrade
        .sort((left, right) => (right.weight ?? 0) - (left.weight ?? 0))
        .slice(0, 5),
      whyNotTrade: whyNotTrade.slice(0, 5)
    };
  }

  private maybeGenerateAlerts(rows: ScreenerRow[], now: number): void {
    const candidates = rows
      .filter(
        (row) =>
          (row.volumeImpulse >= 2.2 && row.tradeNotional60s >= 300_000) ||
          row.liquidation5m >= 400_000
      )
      .sort((left, right) => {
        const leftActivity = Math.max(left.tradeNotional60s * left.volumeImpulse, left.liquidation5m);
        const rightActivity = Math.max(right.tradeNotional60s * right.volumeImpulse, right.liquidation5m);

        if (rightActivity !== leftActivity) {
          return rightActivity - leftActivity;
        }

        return Math.abs(right.momentum30sPct) - Math.abs(left.momentum30sPct);
      })
      .slice(0, 60);

    for (const row of candidates) {
      const tapeAlertBias = this.deriveTapeAlertBias(row);
      const shouldEmitTapeAlert =
        row.volumeImpulse >= 2.2 &&
        row.tradeNotional60s >= 300_000 &&
        tapeAlertBias !== null;

      const liquidationAlertBias = this.deriveLiquidationAlertBias(row);
      const shouldEmitLiquidationAlert =
        row.liquidation5m >= 400_000 &&
        liquidationAlertBias !== null;

      if (shouldEmitTapeAlert && tapeAlertBias) {
        this.pushAlertIfCooldown(
          `${row.symbol}:tape:${tapeAlertBias}`,
          {
            id: randomUUID(),
            symbol: row.symbol,
            kind: "tape",
            bias: tapeAlertBias,
            reason: `tape acceleration ${tapeAlertBias.toLowerCase()} with ${round(
              row.volumeImpulse,
              2
            )}x minute impulse`,
            severity: row.volumeImpulse >= 3 ? "critical" : "high",
            notionalUsd: row.tradeNotional60s,
            createdAt: now
          },
          now
        );
      }

      if (shouldEmitLiquidationAlert && liquidationAlertBias) {
        this.pushAlertIfCooldown(
          `${row.symbol}:liq:${row.liquidationBias}`,
          {
            id: randomUUID(),
            symbol: row.symbol,
            kind: "liquidation",
            bias: liquidationAlertBias,
            reason: `liquidation sweep ${row.liquidationBias.toLowerCase().replace("_", " ")}`,
            severity: row.liquidation5m >= 1_000_000 ? "critical" : "high",
            notionalUsd: row.liquidation5m,
            createdAt: now
          },
          now
        );
      }
    }
  }

  private maybeGenerateVolumeMilestones(
    rows: ScreenerRow[],
    settings: BackendSettings,
    now: number
  ): void {
    const milestoneSettings = settings.volumeMilestones;
    const threshold = milestoneSettings?.minQuoteVolume24h ?? 100_000_000;

    if (!milestoneSettings?.enabled || threshold <= 0) {
      return;
    }

    for (const row of rows) {
      const isAboveThreshold = row.quoteVolume24h >= threshold;
      const wasAboveThreshold = this.volumeMilestoneActiveSymbols.has(row.symbol);

      if (!isAboveThreshold) {
        if (wasAboveThreshold) {
          this.volumeMilestoneActiveSymbols.delete(row.symbol);
          this.pushVolumeMilestoneEvent(row, threshold, "below", now);
        }

        continue;
      }

      if (wasAboveThreshold) {
        continue;
      }

      this.volumeMilestoneActiveSymbols.add(row.symbol);
      this.pushVolumeMilestoneEvent(row, threshold, "above", now);
    }

    this.volumeMilestones.splice(150);
  }

  private pushVolumeMilestoneEvent(
    row: ScreenerRow,
    threshold: number,
    direction: VolumeMilestoneEvent["direction"],
    now: number
  ): void {
    const quoteAsset = row.symbol.startsWith(row.baseAsset)
      ? row.symbol.slice(row.baseAsset.length)
      : "";

    this.volumeMilestones.unshift({
      id: `${row.symbol}:volume:${direction}:${now}`,
      symbol: row.symbol,
      baseAsset: row.baseAsset,
      quoteAsset,
      direction,
      quoteVolume24h: row.quoteVolume24h,
      thresholdQuoteVolume24h: threshold,
      change24hPct: row.change24hPct,
      lastPrice: row.lastPrice,
      detectedAt: now
    });
  }

  private maybeGenerateVolumeThresholdMilestones(rows: ScreenerRow[], now: number): void {
    for (const row of rows) {
      const previousQuoteVolume = this.volumeThresholdLastSeenQuoteVolumeBySymbol.get(row.symbol);
      const currentQuoteVolume = row.quoteVolume24h;

      this.volumeThresholdLastSeenQuoteVolumeBySymbol.set(row.symbol, currentQuoteVolume);

      if (previousQuoteVolume === undefined || previousQuoteVolume === currentQuoteVolume) {
        continue;
      }

      const crossedAboveThresholds = VOLUME_THRESHOLD_LEVELS.filter(
        (threshold) => previousQuoteVolume < threshold && currentQuoteVolume >= threshold
      ).sort((left, right) => left - right);

      for (const threshold of crossedAboveThresholds) {
        this.pushVolumeThresholdMilestoneEvent(row, threshold, "above", now);
      }

      const crossedBelowThresholds = VOLUME_THRESHOLD_LEVELS.filter(
        (threshold) => previousQuoteVolume >= threshold && currentQuoteVolume < threshold
      ).sort((left, right) => left - right);

      for (const threshold of crossedBelowThresholds) {
        this.pushVolumeThresholdMilestoneEvent(row, threshold, "below", now);
      }
    }

    this.volumeThresholdMilestones.splice(300);
  }

  private pushVolumeThresholdMilestoneEvent(
    row: ScreenerRow,
    threshold: number,
    direction: VolumeMilestoneEvent["direction"],
    now: number
  ): void {
    const quoteAsset = row.symbol.startsWith(row.baseAsset)
      ? row.symbol.slice(row.baseAsset.length)
      : "";

    this.volumeThresholdMilestones.unshift({
      id: `${row.symbol}:volume-threshold:${threshold}:${direction}:${now}`,
      symbol: row.symbol,
      baseAsset: row.baseAsset,
      quoteAsset,
      direction,
      quoteVolume24h: row.quoteVolume24h,
      thresholdQuoteVolume24h: threshold,
      change24hPct: row.change24hPct,
      lastPrice: row.lastPrice,
      detectedAt: now
    });
  }

  private deriveTapeAlertBias(row: ScreenerRow): "LONG" | "SHORT" | null {
    if (row.momentum30sPct >= 0.4 && row.buyRatio60s >= 0.5) {
      return "LONG";
    }

    if (row.momentum30sPct <= -0.4 && row.buyRatio60s <= 0.5) {
      return "SHORT";
    }

    return null;
  }

  private deriveLiquidationAlertBias(row: ScreenerRow): "LONG" | "SHORT" | null {
    if (row.liquidationBias === "SHORTS_HIT") {
      return "LONG";
    }

    if (row.liquidationBias === "LONGS_HIT") {
      return "SHORT";
    }

    return null;
  }

  private pushAlertIfCooldown(
    key: string,
    alert: ScreenerAlert,
    now: number,
    ranking?: AlertRankingResult | null
  ): boolean {
    const lastAt = this.lastAlertByKey.get(key) ?? 0;
    if (now - lastAt < 90_000) {
      return false;
    }

    const normalizedAlert = withAlertRankingContract(alert, ranking);

    this.lastAlertByKey.set(key, now);
    this.alerts.unshift(normalizedAlert);
    this.alerts.splice(150);
    this.emitAlert(normalizedAlert);
    return true;
  }

  private emitAlert(alert: ScreenerAlert): void {
    for (const listener of this.alertListeners) {
      try {
        listener(alert);
      } catch {
        // Alert listeners are observers and should not interrupt frame generation.
      }
    }
  }

  private focusRank(state: SymbolState): number {
    const price = state.lastPrice || state.markPrice || state.indexPrice;
    const momentum = Math.abs(state.priceSeries.deltaPctAgo(120_000));
    const flow = state.tradeFlow.sumWindow(60_000);
    const liq = state.liquidations.sumWindow(300_000);

    return (
      state.quoteVolume24h * (1 + Math.abs(state.change24hPct) / 100) +
      (flow.buy + flow.sell) * 4 +
      (liq.longsHit + liq.shortsHit) * 8 +
      price * momentum * 100
    );
  }
}
