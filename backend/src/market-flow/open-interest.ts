import { round, safeNumber } from "../lib/math";
import { TimedValueSeries } from "../lib/rolling-window";
import type { OpenInterestState } from "./types";

const OI_RETENTION_MS = 2 * 60 * 60 * 1000;
const STALE_SYMBOL_TTL_MS = 3 * 60 * 60 * 1000;

interface OpenInterestEntry {
  currentOI: number | null;
  updatedAt: number | null;
  series: TimedValueSeries;
  lastErrorReason: string | null;
  lastFailureAt: number | null;
}

export class OpenInterestModule {
  constructor(private readonly staleAfterMs: number) {}

  private readonly entries = new Map<string, OpenInterestEntry>();

  applySnapshot(symbol: string, openInterest: number, timestamp: number): void {
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!normalizedSymbol) {
      return;
    }

    const currentOI = safeNumber(openInterest);
    const updatedAt = Number.isFinite(timestamp) ? timestamp : Date.now();
    const existing = this.entries.get(normalizedSymbol);
    const entry =
      existing ??
      {
        currentOI: null,
        updatedAt,
        series: new TimedValueSeries(OI_RETENTION_MS),
        lastErrorReason: null,
        lastFailureAt: null
      };

    entry.currentOI = currentOI;
    entry.updatedAt = updatedAt;
    entry.series.push(updatedAt, currentOI);
    entry.lastErrorReason = null;
    entry.lastFailureAt = null;
    this.entries.set(normalizedSymbol, entry);
  }

  recordFailure(symbol: string, reason: string, timestamp = Date.now()): void {
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!normalizedSymbol) {
      return;
    }

    const existing = this.entries.get(normalizedSymbol);
    if (!existing) {
      this.entries.set(normalizedSymbol, {
        currentOI: null,
        updatedAt: null,
        series: new TimedValueSeries(OI_RETENTION_MS),
        lastErrorReason: reason,
        lastFailureAt: timestamp
      });
      return;
    }

    existing.lastErrorReason = reason;
    existing.lastFailureAt = timestamp;
  }

  build(symbol: string, now = Date.now()): OpenInterestState {
    const entry = this.entries.get(symbol.trim().toUpperCase());
    if (!entry) {
      return {
        value: null,
        currentOI: null,
        updatedAt: null,
        status: "UNAVAILABLE",
        errorReason: null,
        ageMs: null,
        oiChange5m: 0,
        oiChange15m: 0,
        oiChange1h: 0
      };
    }

    if (entry.currentOI === null || entry.updatedAt === null) {
      return {
        value: null,
        currentOI: null,
        updatedAt: null,
        status: "UNAVAILABLE",
        errorReason: entry.lastErrorReason,
        ageMs: null,
        oiChange5m: 0,
        oiChange15m: 0,
        oiChange1h: 0
      };
    }

    const ageMs = Math.max(0, now - entry.updatedAt);
    const status = ageMs > this.staleAfterMs ? "STALE" : "FRESH";
    const errorReason =
      entry.lastFailureAt !== null && entry.lastFailureAt >= entry.updatedAt
        ? entry.lastErrorReason
        : null;

    return {
      value: round(entry.currentOI, 4),
      currentOI: round(entry.currentOI, 4),
      updatedAt: entry.updatedAt,
      status,
      errorReason,
      ageMs,
      oiChange5m: round(entry.series.deltaPctAgo(5 * 60 * 1000), 4),
      oiChange15m: round(entry.series.deltaPctAgo(15 * 60 * 1000), 4),
      oiChange1h: round(entry.series.deltaPctAgo(60 * 60 * 1000), 4)
    };
  }

  prune(activeSymbols: ReadonlySet<string>, now = Date.now()): void {
    for (const [symbol, entry] of this.entries) {
      if (activeSymbols.has(symbol)) {
        continue;
      }

      const lastTouchedAt = entry.updatedAt ?? entry.lastFailureAt ?? 0;
      if (now - lastTouchedAt > STALE_SYMBOL_TTL_MS) {
        this.entries.delete(symbol);
      }
    }
  }
}
