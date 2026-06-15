import { BinanceApiError, fetchOpenInterest } from "./binance-rest";
import type { OpenInterestState } from "../market-flow/types";

interface OpenInterestPollerOptions {
  restBase: string;
  timeoutMs: number;
  maxConcurrency: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  logThrottleMs: number;
  fetchSnapshot?: typeof fetchOpenInterest;
  onSnapshot: (symbol: string, openInterestContracts: number, timestamp: number) => void;
  onFailure: (symbol: string, reason: string, timestamp: number) => void;
  getState: (symbol: string, now?: number) => OpenInterestState;
}

interface SymbolPollState {
  consecutiveFailures: number;
  nextEligibleAt: number;
  lastLoggedAt: number | null;
}

export interface OpenInterestPollSummary {
  successCount: number;
  staleCount: number;
  unavailableCount: number;
  timeoutCount: number;
}

const RETRY_DELAY_MS = 150;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isTimeoutError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === "TimeoutError" || error.name === "AbortError"
    : error instanceof Error
      ? error.name === "TimeoutError" || error.name === "AbortError"
      : false;

const shouldRetryError = (error: unknown): boolean =>
  isTimeoutError(error) ||
  error instanceof TypeError ||
  (error instanceof BinanceApiError && error.status >= 500);

const toErrorReason = (error: unknown): string => {
  if (isTimeoutError(error)) {
    return "TIMEOUT";
  }

  if (error instanceof BinanceApiError) {
    return error.code !== undefined ? `BINANCE_${error.code}` : `HTTP_${error.status}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

export class OpenInterestPoller {
  private readonly fetchSnapshot: typeof fetchOpenInterest;
  private readonly symbolState = new Map<string, SymbolPollState>();

  constructor(private readonly options: OpenInterestPollerOptions) {
    this.fetchSnapshot = options.fetchSnapshot ?? fetchOpenInterest;
  }

  async poll(symbols: readonly string[]): Promise<OpenInterestPollSummary> {
    const normalizedSymbols = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()))].filter(
      Boolean
    );
    const now = Date.now();
    let successCount = 0;
    let timeoutCount = 0;
    let cursor = 0;
    const workerCount = Math.max(1, Math.min(this.options.maxConcurrency, normalizedSymbols.length));

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= normalizedSymbols.length) {
          return;
        }

        const symbol = normalizedSymbols[index];
        if (!symbol) {
          return;
        }
        const shouldAttempt = this.shouldPollSymbol(symbol, now);
        if (!shouldAttempt) {
          continue;
        }

        try {
          const snapshot = await this.fetchWithRetry(symbol);
          const timestamp = Number.isFinite(snapshot.time) ? snapshot.time : Date.now();
          const openInterestContracts = Number(snapshot.openInterest);
          this.options.onSnapshot(symbol, openInterestContracts, timestamp);
          this.symbolState.set(symbol, {
            consecutiveFailures: 0,
            nextEligibleAt: 0,
            lastLoggedAt: this.symbolState.get(symbol)?.lastLoggedAt ?? null
          });
          successCount += 1;
        } catch (error) {
          const reason = toErrorReason(error);
          if (reason === "TIMEOUT") {
            timeoutCount += 1;
          }
          this.recordFailure(symbol, reason, now);
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    const summary = normalizedSymbols.reduce<OpenInterestPollSummary>(
      (result, symbol) => {
        const state = this.options.getState(symbol, Date.now());
        if (state.status === "STALE") {
          result.staleCount += 1;
        } else if (state.status === "UNAVAILABLE") {
          result.unavailableCount += 1;
        }
        return result;
      },
      {
        successCount,
        staleCount: 0,
        unavailableCount: 0,
        timeoutCount
      }
    );

    console.info("OPEN_INTEREST_POLL_SUMMARY", {
      checkedAt: Date.now(),
      successCount: summary.successCount,
      staleCount: summary.staleCount,
      unavailableCount: summary.unavailableCount,
      timeoutCount: summary.timeoutCount,
      symbolCount: normalizedSymbols.length
    });

    return summary;
  }

  private shouldPollSymbol(symbol: string, now: number): boolean {
    const state = this.symbolState.get(symbol);
    return !state || state.nextEligibleAt <= now;
  }

  private async fetchWithRetry(symbol: string) {
    try {
      return await this.fetchSnapshot(this.options.restBase, symbol, {
        timeoutMs: this.options.timeoutMs
      });
    } catch (error) {
      if (!shouldRetryError(error)) {
        throw error;
      }

      await sleep(RETRY_DELAY_MS);
      return this.fetchSnapshot(this.options.restBase, symbol, {
        timeoutMs: this.options.timeoutMs
      });
    }
  }

  private recordFailure(symbol: string, reason: string, timestamp: number): void {
    const current = this.symbolState.get(symbol) ?? {
      consecutiveFailures: 0,
      nextEligibleAt: 0,
      lastLoggedAt: null
    };
    const consecutiveFailures = current.consecutiveFailures + 1;
    const backoffMs = Math.min(
      this.options.backoffMaxMs,
      this.options.backoffBaseMs * 2 ** Math.max(0, consecutiveFailures - 1)
    );
    const nextState: SymbolPollState = {
      consecutiveFailures,
      nextEligibleAt: timestamp + backoffMs,
      lastLoggedAt: current.lastLoggedAt
    };

    this.options.onFailure(symbol, reason, timestamp);

    if (
      nextState.lastLoggedAt === null ||
      timestamp - nextState.lastLoggedAt >= this.options.logThrottleMs
    ) {
      console.warn("OPEN_INTEREST_POLL_FAILURE", {
        symbol,
        reason,
        consecutiveFailures,
        backoffMs,
        nextEligibleAt: nextState.nextEligibleAt
      });
      nextState.lastLoggedAt = timestamp;
    }

    this.symbolState.set(symbol, nextState);
  }
}
