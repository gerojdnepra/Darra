import assert from "node:assert/strict";
import http from "node:http";
import {
  __resetBinanceTimeSyncForTests,
  getBinanceRecvWindowMs,
  getBinanceSignedTimestamp
} from "../services/binance-time-sync";
import {
  BinanceApiError,
  fetchPositionRiskSnapshot,
  placeFuturesOrder
} from "../services/binance-rest";

type Mode = "timestamp-offset" | "recvwindow-retry" | "submit-no-retry";

interface RequestRecord {
  method: string;
  pathname: string;
  timestamp: number | null;
  recvWindow: number | null;
}

const apiKey = "time-sync-check-key";
const apiSecret = "time-sync-check-secret";

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind Binance time sync check server.");
  }

  return address.port;
}

async function main(): Promise<void> {
  const originalDateNow = Date.now;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const infoLogs: Array<{ label: string; detail: string }> = [];
  const warnLogs: Array<{ label: string; detail: string }> = [];
  let fakeNow = 0;
  let mode: Mode = "timestamp-offset";
  let serverTimes: number[] = [];
  let positionRiskFailuresRemaining = 0;
  let orderSubmitFailuresRemaining = 0;
  const requests: RequestRecord[] = [];

  Date.now = () => fakeNow;
  console.info = (...args: unknown[]) => {
    infoLogs.push({
      label: String(args[0] ?? ""),
      detail: args.slice(1).map((value) => JSON.stringify(value)).join(" ")
    });
  };
  console.warn = (...args: unknown[]) => {
    warnLogs.push({
      label: String(args[0] ?? ""),
      detail: args.slice(1).map((value) => JSON.stringify(value)).join(" ")
    });
  };

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const timestamp = url.searchParams.get("timestamp");
    const recvWindow = url.searchParams.get("recvWindow");

    requests.push({
      method: request.method ?? "GET",
      pathname: url.pathname,
      timestamp: timestamp === null ? null : Number(timestamp),
      recvWindow: recvWindow === null ? null : Number(recvWindow)
    });

    response.setHeader("Content-Type", "application/json");

    if (url.pathname === "/fapi/v1/time") {
      const serverTime = serverTimes.shift();
      response.end(JSON.stringify({ serverTime }));
      return;
    }

    if (url.pathname === "/fapi/v3/positionRisk") {
      if (mode === "recvwindow-retry" && positionRiskFailuresRemaining > 0) {
        positionRiskFailuresRemaining -= 1;
        response.statusCode = 400;
        response.end(
          JSON.stringify({
            code: -1021,
            msg: "Timestamp for this request is outside of the recvWindow."
          })
        );
        return;
      }

      response.end(JSON.stringify([]));
      return;
    }

    if (url.pathname === "/fapi/v1/order" && request.method === "POST") {
      if (mode === "submit-no-retry" && orderSubmitFailuresRemaining > 0) {
        orderSubmitFailuresRemaining -= 1;
        response.statusCode = 400;
        response.end(
          JSON.stringify({
            code: -1021,
            msg: "Timestamp for this request is outside of the recvWindow."
          })
        );
        return;
      }

      response.end(
        JSON.stringify({
          orderId: 12345,
          symbol: "BTCUSDT",
          status: "NEW",
          clientOrderId: "time-sync-check-order",
          price: "0",
          avgPrice: "0",
          origQty: "1",
          executedQty: "0",
          type: "MARKET",
          side: "BUY",
          reduceOnly: false
        })
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ code: -1, msg: "not found" }));
  });

  const port = await listen(server);
  const restBase = `http://127.0.0.1:${port}`;

  try {
    __resetBinanceTimeSyncForTests();

    mode = "timestamp-offset";
    fakeNow = 1_000_000;
    serverTimes = [1_000_750];
    const signedTimestamp = await getBinanceSignedTimestamp(restBase);
    assert.equal(signedTimestamp, 1_000_750, "Signed timestamp should apply Binance offset.");

    fakeNow = 1_000_800;
    await fetchPositionRiskSnapshot(restBase, apiKey, apiSecret);
    const offsetRequest = requests.find((entry) => entry.pathname === "/fapi/v3/positionRisk");
    assert.ok(offsetRequest, "Expected position risk request for offset validation.");
    assert.equal(
      offsetRequest.timestamp,
      1_001_550,
      "Signed REST requests should use Date.now() plus the Binance offset."
    );
    assert.equal(
      offsetRequest.recvWindow,
      getBinanceRecvWindowMs(),
      "Signed REST requests should use the shared recvWindow."
    );

    __resetBinanceTimeSyncForTests();
    requests.length = 0;
    mode = "recvwindow-retry";
    fakeNow = 2_000_000;
    serverTimes = [2_000_100, 2_000_400];
    positionRiskFailuresRemaining = 1;
    const retryResult = await fetchPositionRiskSnapshot(restBase, apiKey, apiSecret);
    assert.deepEqual(retryResult, [], "Idempotent position risk request should succeed after one resync.");
    assert.equal(
      requests.filter((entry) => entry.pathname === "/fapi/v3/positionRisk").length,
      2,
      "Idempotent signed request should retry once after recvWindow resync."
    );
    assert.equal(
      requests.filter((entry) => entry.pathname === "/fapi/v1/time").length,
      2,
      "RecvWindow error should force an immediate Binance time resync."
    );
    assert.ok(
      warnLogs.some((entry) => entry.label === "BINANCE_RECV_WINDOW_RESYNC"),
      "RecvWindow recovery should emit BINANCE_RECV_WINDOW_RESYNC."
    );

    __resetBinanceTimeSyncForTests();
    requests.length = 0;
    mode = "submit-no-retry";
    fakeNow = 3_000_000;
    serverTimes = [3_000_100, 3_000_600];
    orderSubmitFailuresRemaining = 1;
    await assert.rejects(
      () =>
        placeFuturesOrder(restBase, apiKey, apiSecret, {
          symbol: "BTCUSDT",
          side: "BUY",
          type: "MARKET",
          quantity: 1,
          newClientOrderId: "time-sync-check-order"
        }),
      (error: unknown) =>
        error instanceof BinanceApiError &&
        error.code === -1021 &&
        /recvWindow/i.test(error.message)
    );
    assert.equal(
      requests.filter((entry) => entry.pathname === "/fapi/v1/order").length,
      1,
      "Non-idempotent order submit must not retry after recvWindow drift."
    );
    assert.equal(
      requests.filter((entry) => entry.pathname === "/fapi/v1/time").length,
      2,
      "Non-idempotent submit should still force a time resync for later requests."
    );
    assert.ok(
      infoLogs.some((entry) => entry.label === "BINANCE_TIME_SYNC_OK"),
      "Successful syncs should emit BINANCE_TIME_SYNC_OK."
    );

    console.log("binance time sync checks passed", {
      checkedAt: originalDateNow(),
      restBase,
      observedLogs: {
        info: infoLogs.map((entry) => entry.label),
        warn: warnLogs.map((entry) => entry.label)
      }
    });
  } finally {
    __resetBinanceTimeSyncForTests();
    Date.now = originalDateNow;
    console.info = originalInfo;
    console.warn = originalWarn;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

main().catch((error) => {
  console.error("binance time sync checks failed", error);
  process.exitCode = 1;
});
