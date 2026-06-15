import assert from "node:assert/strict";
import { MarketFlowEngine } from "../market-flow/market-flow-engine";
import { OpenInterestPoller } from "../services/open-interest-poller";
import type { RestOpenInterest } from "../types/binance";

const staleAfterMs = 1_000;

async function main(): Promise<void> {
  const originalDateNow = Date.now;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  let fakeNow = 10_000;
  const infoLogs: Array<{ label: string; detail: unknown }> = [];
  const warnLogs: Array<{ label: string; detail: unknown }> = [];
  const callCount = new Map<string, number>();
  const deferredResolvers = new Map<string, () => void>();

  Date.now = () => fakeNow;
  console.info = (...args: unknown[]) => {
    infoLogs.push({ label: String(args[0] ?? ""), detail: args[1] });
  };
  console.warn = (...args: unknown[]) => {
    warnLogs.push({ label: String(args[0] ?? ""), detail: args[1] });
  };

  const marketFlowEngine = new MarketFlowEngine({
    openInterestStaleAfterMs: staleAfterMs
  });

  const fetchSnapshot = async (
    _restBase: string,
    symbol: string
  ): Promise<RestOpenInterest> => {
    const nextCount = (callCount.get(symbol) ?? 0) + 1;
    callCount.set(symbol, nextCount);

    if (symbol === "BTCUSDT") {
      if (nextCount > 1) {
        throw new DOMException("Timed out", "TimeoutError");
      }
      return {
        symbol,
        openInterest: "123.45",
        time: fakeNow
      };
    }

    if (symbol === "ETHUSDT") {
      throw new DOMException("Timed out", "TimeoutError");
    }

    if (symbol === "SOLUSDT") {
      throw new DOMException("Timed out", "TimeoutError");
    }

    if (symbol === "SLOWUSDT") {
      await new Promise<void>((resolve) => {
        deferredResolvers.set(symbol, resolve);
      });
      return {
        symbol,
        openInterest: "456.78",
        time: fakeNow
      };
    }

    return {
      symbol,
      openInterest: "0",
      time: fakeNow
    };
  };

  const poller = new OpenInterestPoller({
    restBase: "https://testnet.binancefuture.com",
    timeoutMs: 25,
    maxConcurrency: 2,
    backoffBaseMs: 1_000,
    backoffMaxMs: 8_000,
    logThrottleMs: 5_000,
    fetchSnapshot,
    onSnapshot: (symbol, openInterestContracts, timestamp) => {
      marketFlowEngine.applyOpenInterest(symbol, openInterestContracts, timestamp);
    },
    onFailure: (symbol, reason, timestamp) => {
      marketFlowEngine.markOpenInterestFailure(symbol, reason, timestamp);
    },
    getState: (symbol, now) => marketFlowEngine.buildOpenInterestState(symbol, now)
  });

  try {
    await poller.poll(["BTCUSDT"]);
    const freshState = marketFlowEngine.buildOpenInterestState("BTCUSDT", fakeNow);
    assert.equal(freshState.status, "FRESH");
    assert.equal(freshState.value, 123.45);
    assert.equal(freshState.errorReason, null);

    fakeNow += staleAfterMs + 250;
    await poller.poll(["BTCUSDT", "ETHUSDT"]);
    const staleState = marketFlowEngine.buildOpenInterestState("BTCUSDT", fakeNow);
    assert.equal(staleState.status, "STALE");
    assert.equal(staleState.value, 123.45);

    const unavailableState = marketFlowEngine.buildOpenInterestState("ETHUSDT", fakeNow);
    assert.equal(unavailableState.status, "UNAVAILABLE");
    assert.equal(unavailableState.value, null);
    assert.equal(unavailableState.errorReason, "TIMEOUT");

    const timeoutCallsAfterFirstPoll = callCount.get("ETHUSDT") ?? 0;
    assert.equal(timeoutCallsAfterFirstPoll, 2, "Timeout path should retry once safely.");

    const warnCountBeforeImmediateRetry = warnLogs.filter(
      (entry) => entry.label === "OPEN_INTEREST_POLL_FAILURE"
    ).length;
    await poller.poll(["ETHUSDT"]);
    assert.equal(
      callCount.get("ETHUSDT"),
      timeoutCallsAfterFirstPoll,
      "Backoff should skip immediate retry storms for the same symbol."
    );
    assert.equal(
      warnLogs.filter((entry) => entry.label === "OPEN_INTEREST_POLL_FAILURE").length,
      warnCountBeforeImmediateRetry,
      "Throttled logging should avoid emitting another per-symbol warning during backoff."
    );

    fakeNow += 6_000;
    await poller.poll(["ETHUSDT", "SOLUSDT"]);
    assert.equal(callCount.get("ETHUSDT"), 4);
    assert.equal(callCount.get("SOLUSDT"), 2);
    assert.ok(
      warnLogs.filter((entry) => entry.label === "OPEN_INTEREST_POLL_FAILURE").length >=
        warnCountBeforeImmediateRetry + 1,
      "A later failure after the throttle window should remain observable."
    );

    const slowPoll = poller.poll(["SLOWUSDT"]);
    const frameBuildBeforeResolution = marketFlowEngine.build(["SLOWUSDT"]);
    assert.equal(
      frameBuildBeforeResolution[0]?.openInterest.status,
      "UNAVAILABLE",
      "Frame building should continue while a slow open-interest request is still pending."
    );
    deferredResolvers.get("SLOWUSDT")?.();
    await slowPoll;

    assert.ok(
      infoLogs.some((entry) => entry.label === "OPEN_INTEREST_POLL_SUMMARY"),
      "Polling should emit OPEN_INTEREST_POLL_SUMMARY."
    );

    console.log("open interest polling checks passed", {
      checkedAt: originalDateNow(),
      warnLogCount: warnLogs.length,
      infoLogLabels: infoLogs.map((entry) => entry.label),
      callCount: Object.fromEntries(callCount)
    });
  } finally {
    Date.now = originalDateNow;
    console.info = originalInfo;
    console.warn = originalWarn;
  }
}

main().catch((error) => {
  console.error("open interest polling checks failed", error);
  process.exitCode = 1;
});
