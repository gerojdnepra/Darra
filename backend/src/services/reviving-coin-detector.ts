import { randomUUID } from "node:crypto";
import { round } from "../lib/math";
import { fetchDailyQuoteVolumes } from "./binance-rest";
import type { MarketEventStore, RevivingCoinEventRecord } from "./market-event-store";
import type {
  RevivingCoinAlertSettings,
  ScreenerAlert
} from "../types/messages";

export interface LiquiditySnapshotItem {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  lastPrice: number;
  change24hPct: number;
  quoteVolume24h: number;
  volume24h: number;
  updatedAt: number;
}

export interface RevivingCoinDetection {
  alert: ScreenerAlert;
  alertKey: string;
  event: RevivingCoinEventRecord;
}

interface AverageLiquidityCacheEntry {
  averageDailyQuoteVolume: number | null;
  fetchedAt: number;
  lookbackDays: number;
}

const AVERAGE_LIQUIDITY_CACHE_TTL_MS = 6 * 60 * 60_000;

export class RevivingCoinDetector {
  private readonly averageLiquidityCache = new Map<string, AverageLiquidityCacheEntry>();
  private lastScanAt = 0;
  private scanInFlight = false;

  constructor(
    private readonly restBase: string,
    private readonly marketEventStore: MarketEventStore
  ) {}

  async scanIfDue(
    snapshot: LiquiditySnapshotItem[],
    settings: RevivingCoinAlertSettings,
    force = false
  ): Promise<RevivingCoinDetection[]> {
    const now = Date.now();
    const intervalMs = Math.max(settings.scanIntervalMinutes, 1) * 60_000;

    if (!settings.enabled || this.scanInFlight) {
      return [];
    }

    if (!force && now - this.lastScanAt < intervalMs) {
      return [];
    }

    this.scanInFlight = true;
    this.lastScanAt = now;

    try {
      return await this.scan(snapshot, settings, now);
    } finally {
      this.scanInFlight = false;
    }
  }

  private async scan(
    snapshot: LiquiditySnapshotItem[],
    settings: RevivingCoinAlertSettings,
    now: number
  ): Promise<RevivingCoinDetection[]> {
    const detections: RevivingCoinDetection[] = [];
    const cooldownSince = now - settings.alertCooldownHours * 60 * 60_000;
    const candidates = snapshot
      .filter((item) => item.quoteVolume24h >= settings.minCurrentQuoteVolume24h)
      .sort((left, right) => right.quoteVolume24h - left.quoteVolume24h);

    for (const item of candidates) {
      if (this.marketEventStore.hasRevivingEventSince(item.symbol, cooldownSince)) {
        continue;
      }

      const detection = await this.evaluateCandidate(item, settings, now);

      if (detection) {
        detections.push(detection);
      }
    }

    return detections;
  }

  private async evaluateCandidate(
    item: LiquiditySnapshotItem,
    settings: RevivingCoinAlertSettings,
    now: number
  ): Promise<RevivingCoinDetection | null> {
    const useAverageVolume = settings.useAverageVolumeCriterion;
    const useNoSignals = settings.useNoSignalCriterion;

    if (!useAverageVolume && !useNoSignals) {
      return null;
    }

    const averageDailyQuoteVolume = useAverageVolume
      ? await this.getAverageDailyQuoteVolume(item.symbol, settings.liquidityLookbackDays)
      : null;
    const lowAverageVolume =
      useAverageVolume &&
      averageDailyQuoteVolume !== null &&
      averageDailyQuoteVolume < settings.maxAverageDailyQuoteVolume;
    const noRecentSignals =
      useNoSignals &&
      !this.marketEventStore.hasSignalSince(
        item.symbol,
        now - settings.noSignalLookbackDays * 24 * 60 * 60_000
      );
    const activeCriteria = [
      ...(useAverageVolume ? [lowAverageVolume] : []),
      ...(useNoSignals ? [noRecentSignals] : [])
    ];
    const deadCoin = settings.requireAllDeadCriteria
      ? activeCriteria.every(Boolean)
      : activeCriteria.some(Boolean);

    if (!deadCoin) {
      return null;
    }

    const alertId = randomUUID();
    const eventId = randomUUID();
    const volumeChangePct =
      averageDailyQuoteVolume !== null && averageDailyQuoteVolume > 0
        ? round(((item.quoteVolume24h - averageDailyQuoteVolume) / averageDailyQuoteVolume) * 100, 2)
        : null;
    const averageLabel =
      averageDailyQuoteVolume !== null
        ? `${round(averageDailyQuoteVolume / 1_000_000, 2)}M`
        : "unknown";
    const changeLabel = volumeChangePct !== null ? `, ${volumeChangePct}% above average` : "";
    const reason = `reviving coin: 24h volume ${round(
      item.quoteVolume24h / 1_000_000,
      2
    )}M vs ${settings.liquidityLookbackDays}d avg ${averageLabel}${changeLabel}`;

    const alert: ScreenerAlert = {
      id: alertId,
      symbol: item.symbol,
      baseAsset: item.baseAsset,
      kind: "reviving_coin",
      bias: item.change24hPct >= 0 ? "LONG" : "NEUTRAL",
      reason,
      severity: "critical",
      notionalUsd: round(item.quoteVolume24h, 2),
      quoteVolume24h: round(item.quoteVolume24h, 2),
      averageDailyQuoteVolume:
        averageDailyQuoteVolume !== null ? round(averageDailyQuoteVolume, 2) : null,
      volumeChangePct,
      createdAt: now
    };
    const event: RevivingCoinEventRecord = {
      id: eventId,
      alertId,
      symbol: item.symbol,
      baseAsset: item.baseAsset,
      quoteVolume24h: alert.quoteVolume24h ?? alert.notionalUsd,
      averageDailyQuoteVolume: alert.averageDailyQuoteVolume ?? null,
      volumeChangePct,
      liquidityLookbackDays: settings.liquidityLookbackDays,
      noSignalLookbackDays: settings.noSignalLookbackDays,
      detectedAt: now,
      criteria: {
        lowAverageVolume,
        noRecentSignals,
        requireAllDeadCriteria: settings.requireAllDeadCriteria
      },
      settingsSnapshot: { ...settings }
    };

    return {
      alert,
      alertKey: `${item.symbol}:reviving_coin`,
      event
    };
  }

  private async getAverageDailyQuoteVolume(
    symbol: string,
    lookbackDays: number
  ): Promise<number | null> {
    const cacheKey = `${symbol}:${lookbackDays}`;
    const cached = this.averageLiquidityCache.get(cacheKey);
    const now = Date.now();

    if (
      cached &&
      cached.lookbackDays === lookbackDays &&
      now - cached.fetchedAt < AVERAGE_LIQUIDITY_CACHE_TTL_MS
    ) {
      return cached.averageDailyQuoteVolume;
    }

    try {
      const points = await fetchDailyQuoteVolumes(this.restBase, symbol, lookbackDays);
      const completedPoints = points.slice(-lookbackDays);
      const quoteVolumes = completedPoints
        .map((point) => point.quoteVolume)
        .filter((value) => Number.isFinite(value) && value > 0);
      const averageDailyQuoteVolume =
        quoteVolumes.length > 0
          ? quoteVolumes.reduce((sum, value) => sum + value, 0) / quoteVolumes.length
          : null;

      this.averageLiquidityCache.set(cacheKey, {
        averageDailyQuoteVolume,
        fetchedAt: now,
        lookbackDays
      });

      return averageDailyQuoteVolume;
    } catch (error) {
      console.warn(`Could not load ${lookbackDays}d liquidity for ${symbol}`, error);
      return cached?.averageDailyQuoteVolume ?? null;
    }
  }
}
