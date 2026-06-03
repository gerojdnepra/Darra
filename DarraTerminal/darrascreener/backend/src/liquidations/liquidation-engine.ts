import { round, safeNumber } from "../lib/math";
import type { ForceOrderEvent } from "../types/binance";
import type { LiquidationState } from "./types";

type WindowKey = "1m" | "5m" | "15m" | "1h";

interface LiquidationBucket {
  time: number;
  total: number;
  longs: number;
  shorts: number;
}

interface WindowSnapshot {
  total: number;
  longs: number;
  shorts: number;
}

interface SymbolBuffers {
  updatedAt: number;
  windows: Record<WindowKey, RollingLiquidationWindow>;
}

const WINDOW_MS: Record<WindowKey, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000
};

const WINDOW_KEYS: WindowKey[] = ["1m", "5m", "15m", "1h"];
const STALE_SYMBOL_TTL_MS = 2 * 3_600_000;

class RollingLiquidationWindow {
  private readonly buckets: LiquidationBucket[] = [];
  private head = 0;
  private total = 0;
  private longs = 0;
  private shorts = 0;

  constructor(private readonly windowMs: number) {}

  push(time: number, longs: number, shorts: number): void {
    const bucketTime = Math.floor(time / 1000) * 1000;
    const total = longs + shorts;
    const last = this.buckets[this.buckets.length - 1];

    if (last && last.time === bucketTime) {
      last.total += total;
      last.longs += longs;
      last.shorts += shorts;
    } else {
      this.buckets.push({ time: bucketTime, total, longs, shorts });
    }

    this.total += total;
    this.longs += longs;
    this.shorts += shorts;
    this.prune(bucketTime);
  }

  prune(now: number): void {
    const cutoff = now - this.windowMs;

    while (this.head < this.buckets.length) {
      const bucket = this.buckets[this.head];
      if (!bucket || bucket.time >= cutoff) {
        break;
      }

      this.total -= bucket.total;
      this.longs -= bucket.longs;
      this.shorts -= bucket.shorts;
      this.head += 1;
    }

    if (this.head > 64 && this.head * 2 >= this.buckets.length) {
      this.buckets.splice(0, this.head);
      this.head = 0;
    }
  }

  snapshot(): WindowSnapshot {
    return {
      total: round(Math.max(this.total, 0), 2),
      longs: round(Math.max(this.longs, 0), 2),
      shorts: round(Math.max(this.shorts, 0), 2)
    };
  }
}

export class LiquidationEngine {
  private readonly symbols = new Map<string, SymbolBuffers>();

  applyEvent(event: ForceOrderEvent): void {
    const symbol = event.o.s.trim().toUpperCase();
    if (!symbol) {
      return;
    }

    const executionPrice = safeNumber(event.o.ap) || safeNumber(event.o.p);
    const quantity = safeNumber(event.o.q);
    const notional = executionPrice * quantity;
    if (!Number.isFinite(notional) || notional <= 0) {
      return;
    }

    const eventTime = Number.isFinite(event.o.T) ? event.o.T : Date.now();
    const longs = event.o.S === "SELL" ? notional : 0;
    const shorts = event.o.S === "BUY" ? notional : 0;
    const existing = this.symbols.get(symbol);
    const entry =
      existing ??
      {
        updatedAt: eventTime,
        windows: {
          "1m": new RollingLiquidationWindow(WINDOW_MS["1m"]),
          "5m": new RollingLiquidationWindow(WINDOW_MS["5m"]),
          "15m": new RollingLiquidationWindow(WINDOW_MS["15m"]),
          "1h": new RollingLiquidationWindow(WINDOW_MS["1h"])
        }
      };

    entry.updatedAt = eventTime;

    for (const windowKey of WINDOW_KEYS) {
      entry.windows[windowKey].push(eventTime, longs, shorts);
    }

    this.symbols.set(symbol, entry);
  }

  snapshot(now = Date.now()): Record<string, LiquidationState> {
    const bySymbol: Record<string, LiquidationState> = {};

    for (const [symbol, entry] of this.symbols) {
      for (const windowKey of WINDOW_KEYS) {
        entry.windows[windowKey].prune(now);
      }

      if (now - entry.updatedAt > STALE_SYMBOL_TTL_MS) {
        this.symbols.delete(symbol);
        continue;
      }

      const oneMinute = entry.windows["1m"].snapshot();
      const fiveMinutes = entry.windows["5m"].snapshot();
      const fifteenMinutes = entry.windows["15m"].snapshot();
      const oneHour = entry.windows["1h"].snapshot();

      if (oneHour.total <= 0 && fifteenMinutes.total <= 0 && fiveMinutes.total <= 0 && oneMinute.total <= 0) {
        continue;
      }

      bySymbol[symbol] = {
        symbol,
        liquidations1m: oneMinute.total,
        liquidations5m: fiveMinutes.total,
        liquidations15m: fifteenMinutes.total,
        liquidations1h: oneHour.total,
        longLiquidations: oneHour.longs,
        shortLiquidations: oneHour.shorts
      };
    }

    return bySymbol;
  }
}
