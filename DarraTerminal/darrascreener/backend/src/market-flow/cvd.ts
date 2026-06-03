import { round, safeNumber } from "../lib/math";
import { TimedPriceSeries, TimedValueSeries } from "../lib/rolling-window";
import type { AggTradeEvent } from "../types/binance";
import type { CvdDivergence, CvdState } from "./types";

const CVD_RETENTION_MS = 2 * 60 * 60 * 1000;
const CVD_SLOPE_WINDOW_MS = 5 * 60 * 1000;
const STALE_SYMBOL_TTL_MS = 3 * 60 * 60 * 1000;

interface CvdEntry {
  currentValue: number;
  updatedAt: number;
  cvdSeries: TimedValueSeries;
  priceSeries: TimedPriceSeries;
}

const resolveDivergence = (priceDeltaPct: number, cvdDelta: number): CvdDivergence => {
  const priceUp = priceDeltaPct > 0;
  const priceDown = priceDeltaPct < 0;
  const cvdUp = cvdDelta > 0;
  const cvdDown = cvdDelta < 0;

  if (priceDown && cvdUp) {
    return "bullish";
  }

  if (priceUp && cvdDown) {
    return "bearish";
  }

  return "none";
};

export class CvdModule {
  private readonly entries = new Map<string, CvdEntry>();

  applyAggTrade(event: AggTradeEvent): void {
    const symbol = event.s.trim().toUpperCase();
    if (!symbol) {
      return;
    }

    const eventTime = Number.isFinite(event.E) ? event.E : Date.now();
    const price = safeNumber(event.p);
    const quantity = safeNumber(event.q);
    const notional = price * quantity;
    const delta = event.m ? -notional : notional;
    const existing = this.entries.get(symbol);
    const entry =
      existing ??
      {
        currentValue: 0,
        updatedAt: eventTime,
        cvdSeries: new TimedValueSeries(CVD_RETENTION_MS),
        priceSeries: new TimedPriceSeries(CVD_RETENTION_MS)
      };

    entry.currentValue += delta;
    entry.updatedAt = eventTime;
    entry.cvdSeries.push(eventTime, entry.currentValue);
    entry.priceSeries.push(eventTime, price);
    this.entries.set(symbol, entry);
  }

  build(symbol: string): CvdState {
    const entry = this.entries.get(symbol.trim().toUpperCase());
    if (!entry) {
      return {
        value: 0,
        slope: 0,
        divergence: "none"
      };
    }

    const cvdDeltaWindow = entry.cvdSeries.deltaAgo(CVD_SLOPE_WINDOW_MS);
    const slope = cvdDeltaWindow / (CVD_SLOPE_WINDOW_MS / 60_000);
    const priceDeltaPct = entry.priceSeries.deltaPctAgo(CVD_SLOPE_WINDOW_MS);

    return {
      value: round(entry.currentValue, 2),
      slope: round(slope, 2),
      divergence: resolveDivergence(priceDeltaPct, cvdDeltaWindow)
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
