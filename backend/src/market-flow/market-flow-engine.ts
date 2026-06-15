import type { AggTradeEvent } from "../types/binance";
import { CvdModule } from "./cvd";
import { OpenInterestModule } from "./open-interest";
import type { MarketFlowState } from "./types";

export class MarketFlowEngine {
  private readonly openInterest: OpenInterestModule;
  private readonly cvd = new CvdModule();

  constructor(input?: { openInterestStaleAfterMs?: number }) {
    this.openInterest = new OpenInterestModule(input?.openInterestStaleAfterMs ?? 90_000);
  }

  applyOpenInterest(symbol: string, openInterest: number, timestamp: number): void {
    this.openInterest.applySnapshot(symbol, openInterest, timestamp);
  }

  markOpenInterestFailure(symbol: string, reason: string, timestamp = Date.now()): void {
    this.openInterest.recordFailure(symbol, reason, timestamp);
  }

  buildOpenInterestState(symbol: string, now = Date.now()) {
    return this.openInterest.build(symbol, now);
  }

  applyAggTrade(event: AggTradeEvent): void {
    this.cvd.applyAggTrade(event);
  }

  build(symbols: readonly string[] = []): MarketFlowState[] {
    const normalizedSymbols = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()))].filter(Boolean);
    const activeSymbols = new Set(normalizedSymbols);
    this.openInterest.prune(activeSymbols);
    this.cvd.prune(activeSymbols);

    return normalizedSymbols.map((symbol) => ({
      symbol,
      openInterest: this.openInterest.build(symbol),
      cvd: this.cvd.build(symbol)
    }));
  }
}
