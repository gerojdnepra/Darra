import { randomUUID } from "node:crypto";
import { alertRankingEngine } from "../alert-ranking/alert-ranking-engine";
import { config } from "../config";
import { doNotTradeEngine } from "../do-not-trade/do-not-trade-engine";
import { opportunityScoreEngine } from "../opportunity/opportunity-score-engine";
import { positionSizingEngine } from "../risk/position-sizing-engine";
import { getCachedExchangeFilterMap } from "../services/binance-exchange-filters";
import { setupClassifierEngine } from "../setup-classifier/setup-classifier-engine";
import { signalOutcomeTracker } from "./signal-outcome-tracker";
import { SignalRepository } from "./signal-repository";

const DEFAULT_COOLDOWN_MS = 30_000;
const MAX_QUEUE_SIZE = 5_000;
const FLUSH_BATCH_SIZE = 100;
const QUEUE_WARNING_THRESHOLD = 0.8;

export interface SignalEventWriterInput {
  id?: string;
  symbol: string;
  type: string;
  severity?: string | null;
  source: string;
  price?: number | null;
  score?: number | null;
  payload: unknown;
  features?: unknown;
  createdAt?: number;
}

export interface PersistenceQueueMetrics {
  queueSize: number;
  queueCapacity: number;
  queueUsageRatio: number;
  droppedEventsCount: number;
  lastDroppedEventAt: number | null;
  lastFlushAt: number | null;
  flushErrorsCount: number;
  lastFlushErrorMessage: string | null;
  lastFlushErrorAt: number | null;
}

const normalizeSymbol = (symbol: string): string => symbol.trim().toUpperCase();

const normalizeKeyPart = (value: string | null | undefined, fallback: string): string => {
  const normalized = value?.trim().toLowerCase();
  return normalized || fallback;
};

export class SignalEventWriter {
  private readonly lastWriteAtByKey = new Map<string, number>();
  private readonly recordedSignalIds = new Set<string>();
  private readonly queue: SignalEventWriterInput[] = [];
  private latestMarketRows: Array<{ symbol: string; markPrice?: number; lastPrice?: number }> | null = null;
  private flushScheduled = false;
  private flushing = false;
  private droppedEventsCount = 0;
  private lastDroppedEventAt: number | null = null;
  private lastFlushAt: number | null = null;
  private flushErrorsCount = 0;
  private lastFlushErrorMessage: string | null = null;
  private lastFlushErrorAt: number | null = null;
  private queueWarningActive = false;
  private droppedEventsWarningEmitted = false;

  constructor(
    private readonly repository = new SignalRepository(),
    private readonly cooldownMs = DEFAULT_COOLDOWN_MS
  ) {}

  recordSignal(input: SignalEventWriterInput): string | null {
    const symbol = normalizeSymbol(input.symbol);
    const now = input.createdAt ?? Date.now();

    if (!symbol || !input.type.trim() || !input.source.trim() || !Number.isFinite(now)) {
      return null;
    }

    if (input.id && this.recordedSignalIds.has(input.id)) {
      return null;
    }

    const dedupeKey = [
      normalizeKeyPart(input.source, "unknown"),
      normalizeKeyPart(input.type, "unknown"),
      symbol,
      normalizeKeyPart(input.severity, "none")
    ].join(":");
    const lastWriteAt = this.lastWriteAtByKey.get(dedupeKey) ?? 0;

    if (now - lastWriteAt < this.cooldownMs) {
      return null;
    }

    const signalId = input.id ?? randomUUID();
    this.lastWriteAtByKey.set(dedupeKey, now);
    this.recordedSignalIds.add(signalId);

    if (this.queue.length >= MAX_QUEUE_SIZE) {
      this.queue.shift();
      this.droppedEventsCount += 1;
      this.lastDroppedEventAt = Date.now();
      this.warnIfDroppedEvents();
    }

    this.queue.push({
      ...input,
      id: signalId,
      symbol,
      createdAt: now
    });
    this.warnIfQueuePressure();
    this.scheduleFlush();
    return signalId;
  }

  observeMarketRows(rows: Array<{ symbol: string; markPrice?: number; lastPrice?: number }>): void {
    this.latestMarketRows = rows.map((row) => ({
      symbol: row.symbol,
      ...(row.markPrice === undefined ? {} : { markPrice: row.markPrice }),
      ...(row.lastPrice === undefined ? {} : { lastPrice: row.lastPrice })
    }));
    this.scheduleFlush();
  }

  getMetrics(): PersistenceQueueMetrics {
    return {
      queueSize: this.queue.length,
      queueCapacity: MAX_QUEUE_SIZE,
      queueUsageRatio: Number((this.queue.length / MAX_QUEUE_SIZE).toFixed(4)),
      droppedEventsCount: this.droppedEventsCount,
      lastDroppedEventAt: this.lastDroppedEventAt,
      lastFlushAt: this.lastFlushAt,
      flushErrorsCount: this.flushErrorsCount,
      lastFlushErrorMessage: this.lastFlushErrorMessage,
      lastFlushErrorAt: this.lastFlushErrorAt
    };
  }

  flush(): void {
    while (this.queue.length > 0 || this.latestMarketRows) {
      const previousQueueSize = this.queue.length;
      const hadMarketRows = Boolean(this.latestMarketRows);

      this.flushQueue();

      if (
        this.flushing ||
        (this.queue.length === previousQueueSize && Boolean(this.latestMarketRows) === hadMarketRows)
      ) {
        break;
      }
    }
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) {
      return;
    }

    this.flushScheduled = true;
    setImmediate(() => {
      this.flushScheduled = false;
      this.flushQueue();
    });
  }

  private flushQueue(): void {
    if (this.flushing) {
      this.scheduleFlush();
      return;
    }

    this.flushing = true;

    try {
      let processed = 0;

      while (this.queue.length > 0 && processed < FLUSH_BATCH_SIZE) {
        const next = this.queue.shift();
        if (next) {
          this.persistSignal(next);
          processed += 1;
        }
      }

      if (this.latestMarketRows) {
        const rows = this.latestMarketRows;
        this.latestMarketRows = null;
        signalOutcomeTracker.observeMarketRows(rows);
      }
    } catch (error) {
      this.recordFlushError(error);
      console.warn("Could not flush persistence queue", error);
    } finally {
      this.lastFlushAt = Date.now();
      this.flushing = false;
      this.warnIfQueuePressure();
    }

    if (this.queue.length > 0 || this.latestMarketRows) {
      this.scheduleFlush();
    }
  }

  private warnIfQueuePressure(): void {
    const usageRatio = this.queue.length / MAX_QUEUE_SIZE;

    if (usageRatio >= QUEUE_WARNING_THRESHOLD) {
      if (!this.queueWarningActive) {
        this.queueWarningActive = true;
        console.warn(
          `Persistence queue is above 80% capacity (${this.queue.length}/${MAX_QUEUE_SIZE}).`
        );
      }
      return;
    }

    if (usageRatio < QUEUE_WARNING_THRESHOLD * 0.75) {
      this.queueWarningActive = false;
    }
  }

  private warnIfDroppedEvents(): void {
    if (this.droppedEventsWarningEmitted) {
      return;
    }

    this.droppedEventsWarningEmitted = true;
    console.warn("Persistence queue dropped events because it reached capacity.");
  }

  private persistSignal(input: SignalEventWriterInput): void {
    const symbol = normalizeSymbol(input.symbol);
    const now = input.createdAt ?? Date.now();

    try {
      const setupClassification = setupClassifierEngine.classify({
        symbol,
        type: input.type,
        severity: input.severity ?? null,
        source: input.source,
        price: input.price ?? null,
        score: input.score ?? null,
        payload: input.payload,
        features: input.features
      });
      const opportunityScore = opportunityScoreEngine.evaluate({
        symbol,
        type: input.type,
        severity: input.severity ?? null,
        source: input.source,
        price: input.price ?? null,
        score: input.score ?? null,
        payload: input.payload,
        features: input.features,
        setupClassification
      });
      const positionSizing = positionSizingEngine.evaluate({
        symbol,
        direction: setupClassification.direction,
        entryPrice: input.price ?? null,
        defaultEquityUsdt: config.positionSizingDefaultEquityUsdt,
        opportunityScore,
        setupClassification,
        payload: input.payload,
        features: input.features,
        risk: typeof input.features === "object" && input.features !== null
          ? (input.features as Record<string, unknown>).risk
          : null,
        exchangeFilters: getCachedExchangeFilterMap(config.binanceRestBase)
      });
      const doNotTrade = doNotTradeEngine.evaluate({
        symbol,
        direction: setupClassification.direction,
        setupClassification,
        opportunityScore,
        positionSizing,
        payload: input.payload,
        features: input.features,
        risk: typeof input.features === "object" && input.features !== null
          ? (input.features as Record<string, unknown>).risk
          : null
      });
      const alertRanking = alertRankingEngine.rank({
        symbol,
        type: input.type,
        severity: input.severity ?? null,
        source: input.source,
        score: input.score ?? null,
        payload: input.payload,
        features: input.features,
        setupClassification,
        opportunityScore,
        positionSizing,
        doNotTrade
      });
      const payload = {
        ...(typeof input.payload === "object" && input.payload !== null ? input.payload : { value: input.payload }),
        setupClassification,
        opportunityScore,
        positionSizing,
        doNotTrade,
        alertRanking
      };
      const features =
        input.features === undefined
          ? {
              setupType: setupClassification.setupType,
              setupConfidence: setupClassification.confidence,
              setupDirection: setupClassification.direction,
              setupReasons: setupClassification.reasons,
              opportunityVerdict: opportunityScore.verdict,
              opportunityScore: opportunityScore.score,
              opportunityConfidence: opportunityScore.confidence,
              opportunityRiskLevel: opportunityScore.riskLevel,
              recommendedNotional: positionSizing.recommendedNotional,
              recommendedQty: positionSizing.recommendedQty,
              normalizedQty: positionSizing.normalizedQty,
              rawQty: positionSizing.rawQty,
              suggestedLeverage: positionSizing.suggestedLeverage,
              riskPerTradePct: positionSizing.riskPerTradePct,
              stopDistancePct: positionSizing.stopDistancePct,
              dntAllowed: doNotTrade.allowed,
              dntSeverity: doNotTrade.severity,
              dntAction: doNotTrade.action,
              dntReasons: doNotTrade.reasons,
              dntBlockers: doNotTrade.blockers,
              alertPriority: alertRanking.priority,
              alertRankScore: alertRanking.rankScore,
              alertSuppress: alertRanking.suppress,
              alertReasons: alertRanking.reasons
            }
          : {
              ...(typeof input.features === "object" && input.features !== null
                ? input.features
                : { value: input.features }),
              setupType: setupClassification.setupType,
              setupConfidence: setupClassification.confidence,
              setupDirection: setupClassification.direction,
              setupReasons: setupClassification.reasons,
              opportunityVerdict: opportunityScore.verdict,
              opportunityScore: opportunityScore.score,
              opportunityConfidence: opportunityScore.confidence,
              opportunityRiskLevel: opportunityScore.riskLevel,
              recommendedNotional: positionSizing.recommendedNotional,
              recommendedQty: positionSizing.recommendedQty,
              normalizedQty: positionSizing.normalizedQty,
              rawQty: positionSizing.rawQty,
              suggestedLeverage: positionSizing.suggestedLeverage,
              riskPerTradePct: positionSizing.riskPerTradePct,
              stopDistancePct: positionSizing.stopDistancePct,
              dntAllowed: doNotTrade.allowed,
              dntSeverity: doNotTrade.severity,
              dntAction: doNotTrade.action,
              dntReasons: doNotTrade.reasons,
              dntBlockers: doNotTrade.blockers,
              alertPriority: alertRanking.priority,
              alertRankScore: alertRanking.rankScore,
              alertSuppress: alertRanking.suppress,
              alertReasons: alertRanking.reasons
            };
      const signal = this.repository.createSignal({
        id: input.id ?? randomUUID(),
        symbol,
        createdAt: now,
        type: input.type,
        severity: input.severity ?? null,
        source: input.source,
        price: input.price ?? null,
        score: input.score ?? null,
        setupType: setupClassification.setupType,
        setupConfidence: setupClassification.confidence,
        setupDirection: setupClassification.direction,
        opportunityVerdict: opportunityScore.verdict,
        opportunityScore: opportunityScore.score,
        opportunityConfidence: opportunityScore.confidence,
        opportunityRiskLevel: opportunityScore.riskLevel,
        positionSizing,
        doNotTrade,
        alertRanking,
        payload
      });

      this.repository.addSignalFeatures({
        signalId: signal.id,
        createdAt: now,
        symbol,
        features
      });

      signalOutcomeTracker.trackSignal({
        signalId: signal.id,
        symbol,
        startPrice: signal.price,
        createdAt: signal.createdAt,
        payload
      });

    } catch (error) {
      this.recordFlushError(error);
      console.warn("Could not persist signal event to SQLite", error);
    }
  }

  private recordFlushError(error: unknown): void {
    this.flushErrorsCount += 1;
    this.lastFlushErrorAt = Date.now();
    this.lastFlushErrorMessage = error instanceof Error ? error.message : String(error);
  }
}

export const signalEventWriter = new SignalEventWriter();
