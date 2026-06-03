import { round, safeNumber } from "../lib/math";
import { TimedValueSeries } from "../lib/rolling-window";
import type { OpenInterestState } from "./types";

const OI_RETENTION_MS = 2 * 60 * 60 * 1000;
const STALE_SYMBOL_TTL_MS = 3 * 60 * 60 * 1000;

interface OpenInterestEntry {
  currentOI: number;
  updatedAt: number;
  series: TimedValueSeries;
}

export class OpenInterestModule {
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
        currentOI: 0,
        updatedAt,
        series: new TimedValueSeries(OI_RETENTION_MS)
      };

    entry.currentOI = currentOI;
    entry.updatedAt = updatedAt;
    entry.series.push(updatedAt, currentOI);
    this.entries.set(normalizedSymbol, entry);
  }

  build(symbol: string): OpenInterestState {
    const entry = this.entries.get(symbol.trim().toUpperCase());
    if (!entry) {
      return {
        currentOI: 0,
        oiChange5m: 0,
        oiChange15m: 0,
        oiChange1h: 0
      };
    }

    return {
      currentOI: round(entry.currentOI, 4),
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

      if (now - entry.updatedAt > STALE_SYMBOL_TTL_MS) {
        this.entries.delete(symbol);
      }
    }
  }
}
