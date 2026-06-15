import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";

type SectionStatus = "PASS" | "FAIL";

interface SmokeSection {
  name: string;
  status: SectionStatus;
  detail: Record<string, unknown>;
  blocker: string | null;
}

interface ReceivedServerMessage {
  type?: string;
  generatedAt?: number;
  payload?: Record<string, unknown>;
  frame?: Record<string, unknown>;
}

interface WaitForMessageOptions {
  timeoutMs?: number;
  afterIndex?: number;
}

interface FrontendPreflightState {
  ticketKey: string | null;
  requestId: string | null;
  response: {
    requestId: string;
    preflightId: string;
    preflightNonce: string;
    ticketKey: string;
    symbol: string;
    side: "BUY" | "SELL";
    validation: {
      accepted: boolean;
      paperMode: boolean;
      checks: unknown[];
      normalizedQuantity: number;
      normalizedPrice: number | null;
      notional: number | null;
      riskLimits: {
        maxPositionSize: { enabled: boolean; value: number | null };
        maxAccountExposure: { enabled: boolean; value: number | null };
        maxLeverage: { enabled: boolean; value: number | null };
        maxDailyLoss: { enabled: boolean; value: number | null };
      };
    };
    safeToAdd: {
      symbol: string;
      direction: "long" | "short" | "unknown";
      side: "BUY" | "SELL" | null;
      status: "ALLOW" | "WAIT" | "STALE" | "BLOCK";
      allowed: boolean;
      generatedAt: number;
      staleAfterMs: number;
      checks: unknown[];
      blockers: string[];
      warnings: string[];
      constraints: string[];
      reasons: string[];
      source: {
        sizing: boolean;
        orderSafety: boolean;
        doNotTrade: boolean;
      };
    } | null;
    generatedAt: number;
    staleAfterMs: number;
    expiresAt: number;
  } | null;
  loading: boolean;
  stale: boolean;
  unavailableReason: string | null;
  requestedAt: number | null;
  receivedAt: number | null;
}

const fakeRestBase = "https://offline.binance.local";
const fakeWsBase = "wss://offline-stream.binance.local";
const wsPath = "/ws";
const symbol = "BTCUSDT";
let restoreFetch: (() => void) | null = null;

const addSection = (
  sections: SmokeSection[],
  name: string,
  status: SectionStatus,
  detail: Record<string, unknown>,
  blocker: string | null = null
): void => {
  sections.push({ name, status, detail, blocker });
};

const getFreePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not resolve an ephemeral port.")));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });

const wait = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const readRows = (message: ReceivedServerMessage): unknown[] => {
  if (message.type === "snapshot") {
    return Array.isArray(message.frame?.rows) ? message.frame.rows : [];
  }

  if (message.type === "frame") {
    const frameMessage = message as ReceivedServerMessage & {
      rows?: unknown[];
    };
    return Array.isArray(frameMessage.rows) ? frameMessage.rows : [];
  }

  return [];
};

const isAcceptedPreflight = (message: ReceivedServerMessage): boolean =>
  message.payload?.validation !== null &&
  typeof message.payload?.validation === "object" &&
  (message.payload.validation as { accepted?: boolean }).accepted === true;

class WsHarnessClient {
  private readonly messages: ReceivedServerMessage[] = [];
  private readonly ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.on("message", (buffer) => {
      try {
        this.messages.push(JSON.parse(buffer.toString("utf8")) as ReceivedServerMessage);
      } catch {
        this.messages.push({ type: "parse_error" });
      }
    });
  }

  static async connect(url: string): Promise<WsHarnessClient> {
    const socket = new WebSocket(url);
    const client = new WsHarnessClient(socket);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`WebSocket open timed out for ${url}.`));
      }, 10_000);

      socket.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    return client;
  }

  send(payload: unknown): void {
    this.ws.send(JSON.stringify(payload));
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  async waitFor(
    predicate: (message: ReceivedServerMessage) => boolean,
    options?: WaitForMessageOptions
  ): Promise<ReceivedServerMessage> {
    const timeoutMs = options?.timeoutMs ?? 10_000;
    const afterIndex = options?.afterIndex ?? 0;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const existing = this.messages.slice(afterIndex).find(predicate);
      if (existing) {
        return existing;
      }

      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for expected WebSocket message.");
      }

      await wait(25);
    }
  }

  async close(): Promise<void> {
    if (
      this.ws.readyState === WebSocket.CLOSED ||
      this.ws.readyState === WebSocket.CLOSING
    ) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.ws.once("close", () => resolve());
      this.ws.close();
    });
  }
}

const patchOfflineRuntime = (): void => {
  const streamModule = require("../services/binance-stream") as {
    BinanceStreamManager: {
      prototype: {
        start: (initialFocusSymbols: string[]) => void;
        stop: () => void;
        updateFocusSymbols: (nextFocusSymbols: string[]) => void;
      };
    };
  };
  const revivingModule = require("../services/reviving-coin-detector") as {
    RevivingCoinDetector: {
      prototype: {
        scanIfDue: () => Promise<unknown[]>;
      };
    };
  };

  const originalFetch = globalThis.fetch.bind(globalThis);
  restoreFetch = () => {
    globalThis.fetch = originalFetch;
  };
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (!url.startsWith(fakeRestBase)) {
      return originalFetch(input, init);
    }

    const { pathname, searchParams } = new URL(url);

    if (pathname === "/fapi/v1/exchangeInfo") {
      return Response.json({
        symbols: [
          {
            symbol,
            pair: symbol,
            status: "TRADING",
            contractType: "PERPETUAL",
            quoteAsset: "USDT",
            baseAsset: "BTC",
            pricePrecision: 2,
            quantityPrecision: 3,
            filters: [
              {
                filterType: "PRICE_FILTER",
                tickSize: "0.1"
              },
              {
                filterType: "LOT_SIZE",
                stepSize: "0.001",
                minQty: "0.001",
                maxQty: "100.000"
              },
              {
                filterType: "MARKET_LOT_SIZE",
                stepSize: "0.001",
                minQty: "0.001",
                maxQty: "100.000"
              },
              {
                filterType: "MIN_NOTIONAL",
                notional: "5"
              }
            ]
          }
        ]
      });
    }

    if (pathname === "/fapi/v1/ticker/24hr") {
      return Response.json([
        {
          symbol,
          priceChangePercent: "1.25",
          lastPrice: "65000.0",
          volume: "1000.0",
          quoteVolume: "65000000.0",
          highPrice: "65500.0",
          lowPrice: "64000.0"
        }
      ]);
    }

    if (pathname === "/fapi/v1/openInterest") {
      return Response.json({
        openInterest: "0",
        symbol: searchParams.get("symbol") ?? symbol,
        time: Date.now()
      });
    }

    if (pathname === "/fapi/v1/time") {
      return Response.json({
        serverTime: Date.now()
      });
    }

    if (pathname === "/fapi/v1/klines") {
      const now = Date.now();
      return Response.json([
        [now - 86_400_000, "0", "0", "0", "0", "0", now, "1000000"]
      ]);
    }

    throw new Error(`Unhandled offline Binance REST request in release smoke: ${pathname}`);
  };

  streamModule.BinanceStreamManager.prototype.start = function patchedStart(
    initialFocusSymbols: string[]
  ): void {
    const self = this as unknown as {
      focusSymbols?: string[];
      disposed?: boolean;
    };
    self.disposed = false;
    self.focusSymbols = initialFocusSymbols;
  };
  streamModule.BinanceStreamManager.prototype.stop = function patchedStop(): void {
    const self = this as unknown as {
      disposed?: boolean;
      focusSymbols?: string[];
    };
    self.disposed = true;
    self.focusSymbols = [];
  };
  streamModule.BinanceStreamManager.prototype.updateFocusSymbols = function patchedUpdate(
    nextFocusSymbols: string[]
  ): void {
    const self = this as unknown as {
      focusSymbols?: string[];
    };
    self.focusSymbols = nextFocusSymbols;
  };

  revivingModule.RevivingCoinDetector.prototype.scanIfDue = async function patchedScanIfDue() {
    return [];
  };
};

const seedOfflineExchangeFilters = (): void => {
  const exchangeFiltersModule = require("../services/binance-exchange-filters") as {
    setExchangeFiltersFromExchangeInfo: (
      restBase: string,
      exchangeInfo: {
        symbols: Array<{
          symbol: string;
          pair: string;
          status: string;
          contractType: string;
          quoteAsset: string;
          baseAsset: string;
          pricePrecision: number;
          quantityPrecision: number;
          filters: Array<Record<string, string>>;
        }>;
      }
    ) => void;
  };

  exchangeFiltersModule.setExchangeFiltersFromExchangeInfo(fakeRestBase, {
    symbols: [
      {
        symbol,
        pair: symbol,
        status: "TRADING",
        contractType: "PERPETUAL",
        quoteAsset: "USDT",
        baseAsset: "BTC",
        pricePrecision: 2,
        quantityPrecision: 3,
        filters: [
          {
            filterType: "PRICE_FILTER",
            tickSize: "0.1"
          },
          {
            filterType: "MARKET_LOT_SIZE",
            stepSize: "0.001",
            minQty: "0.001",
            maxQty: "100.000"
          },
          {
            filterType: "MIN_NOTIONAL",
            notional: "5"
          }
        ]
      }
    ]
  });
};

const loadFrontendPreflightHelper = async (): Promise<{
  applyOrderPreflightInvalidation: (
    currentState: FrontendPreflightState | null,
    invalidation: {
      preflightId: string;
      requestId?: string | null;
      ticketKey?: string | null;
      status: "USED" | "EXPIRED" | "INVALIDATED";
      reason: string;
      occurredAt: number;
    }
  ) => { matched: boolean; nextState: FrontendPreflightState | null };
}> => {
  const workspaceRoot = path.resolve(__dirname, "..", "..", "..");
  const helperUrl = pathToFileURL(
    path.join(workspaceRoot, "frontend", "lib", "order-preflight-state.ts")
  ).href;

  return (await import(helperUrl)) as {
    applyOrderPreflightInvalidation: (
      currentState: FrontendPreflightState | null,
      invalidation: {
        preflightId: string;
        requestId?: string | null;
        ticketKey?: string | null;
        status: "USED" | "EXPIRED" | "INVALIDATED";
        reason: string;
        occurredAt: number;
      }
    ) => { matched: boolean; nextState: FrontendPreflightState | null };
  };
};

const isFrontendEquivalentConfirmReady = (state: FrontendPreflightState | null): boolean =>
  Boolean(
    state?.response &&
      state.loading === false &&
      state.stale === false &&
      state.response.safeToAdd?.status === "ALLOW" &&
      state.response.preflightId &&
      state.response.preflightNonce
  );

const buildFrontendStateFromPreflight = (
  payload: FrontendPreflightState["response"]
): FrontendPreflightState => ({
  ticketKey: payload?.ticketKey ?? null,
  requestId: payload?.requestId ?? null,
  response: payload,
  loading: false,
  stale: false,
  unavailableReason: null,
  requestedAt: payload?.generatedAt ?? null,
  receivedAt: payload?.generatedAt ?? null
});

const buildConfirmReadyFrontendStateFromPreflight = (
  payload: FrontendPreflightState["response"]
): FrontendPreflightState => {
  if (!payload) {
    throw new Error("Cannot build confirm-ready frontend state without preflight payload.");
  }

  return buildFrontendStateFromPreflight({
    ...payload,
    safeToAdd: payload.safeToAdd
      ? {
          ...payload.safeToAdd,
          status: "ALLOW",
          allowed: true
        }
      : {
          symbol: payload.symbol,
          direction: payload.side === "BUY" ? "long" : "short",
          side: payload.side,
          status: "ALLOW",
          allowed: true,
          generatedAt: payload.generatedAt,
          staleAfterMs: payload.staleAfterMs,
          checks: [],
          blockers: [],
          warnings: [],
          constraints: [],
          reasons: [],
          source: {
            sizing: true,
            orderSafety: true,
            doNotTrade: false
          }
        }
  });
};

async function main(): Promise<void> {
  const sections: SmokeSection[] = [];
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "release-smoke-"));
  const sqlitePath = path.join(tempRoot, "release-smoke.sqlite");
  const dataDir = path.join(tempRoot, "data");
  const port = await getFreePort();

  process.env.SCALPSTATION_SQLITE_PATH = sqlitePath;
  process.env.SCALPSTATION_DATA_DIR = dataDir;
  process.env.SCALPSTATION_MARKET_EVENT_STORE_PATH = path.join(tempRoot, "market-events.jsonl");
  process.env.BACKEND_HOST = "127.0.0.1";
  process.env.BACKEND_PORT = String(port);
  process.env.BACKEND_WS_PATH = wsPath;
  process.env.BINANCE_REST_BASE = fakeRestBase;
  process.env.BINANCE_WS_BASE = fakeWsBase;
  process.env.BINANCE_ORDER_PAPER_MODE = "true";
  process.env.BINANCE_ORDER_LIVE_MODE_ENABLED = "false";
  process.env.LIVE_TRADING_ENABLED = "false";
  process.env.ORDER_CONTROL_AUTH_REQUIRED = "true";
  process.env.LIVE_TRADING_REQUIRES_TESTNET = "true";
  process.env.LIVE_TRADING_REQUIRE_TYPED_CONFIRM = "true";
  process.env.BINANCE_FUTURES_TESTNET = "false";
  process.env.BINANCE_API_KEY = "";
  process.env.BINANCE_API_SECRET = "";
  process.env.ALLOW_REMOTE_ENV_BINANCE_ACCOUNT_ACCESS = "false";

  patchOfflineRuntime();
  seedOfflineExchangeFilters();

  const backendModule = await import("../index");
  const { orderPreflightRepository } = await import("../storage/order-preflight-repository");
  const { decisionChainIntegrityRepository } = await import(
    "../storage/decision-chain-integrity-repository"
  );
  const { LifecycleManager } = await import("../execution/lifecycle-manager");
  const { unifiedSignalRepository } = await import("../storage/unified-signal-repository");
  const { orderRepository } = await import("../storage/order-repository");
  const { decisionContextFixtureFactory } = await import(
    "../decision/decision-context-fixture-factory"
  );
  const { positionLifecycleRepository } = await import("../storage/position-lifecycle-repository");
  const frontendHelper = await loadFrontendPreflightHelper();

  let client: WsHarnessClient | null = null;
  let reconnectClient: WsHarnessClient | null = null;

  try {
    await backendModule.startScalpStationBackend();
    addSection(sections, "Backend runtime startup", "PASS", {
      sqlitePath,
      port,
      localOnly: true,
      liveTradingEnabled: false,
      usedRealWebSocketServer: true
    });

    client = await WsHarnessClient.connect(`ws://127.0.0.1:${port}${wsPath}`);
    client.send({
      type: "hello",
      payload: {
        capabilities: ["compact_frame_transport_v1"],
        activeOrderPreflightIds: []
      }
    });
    client.send({
      type: "request_snapshot",
      payload: {
        reason: "initial_connect",
        activeOrderPreflightIds: []
      }
    });

    const liveSafety = await client.waitFor(
      (message) => message.type === "live_safety_state"
    );
    assert.equal(liveSafety.type, "live_safety_state");
    assert.equal(liveSafety.payload?.mode, "DISABLED");
    assert.equal(liveSafety.payload?.ready, false);
    addSection(sections, "Safety mode remains disabled", "PASS", {
      mode: liveSafety.payload?.mode,
      ready: liveSafety.payload?.ready,
      killSwitchActive: liveSafety.payload?.killSwitchActive ?? null
    });

    await client.waitFor((message) => {
      const rows = readRows(message);
      return rows.some(
        (row: unknown) =>
          typeof row === "object" &&
          row !== null &&
          "symbol" in row &&
          (row as { symbol?: string }).symbol === symbol
      );
    });

    const requestId = "release-smoke-preflight";
    const beforePreflightIndex = client.getMessageCount();
    client.send({
      type: "request_order_preflight",
      payload: {
        requestId,
        ticketKey: `${symbol}|BUY|MARKET|0.01|paper`,
        symbol,
        side: "BUY",
        type: "MARKET",
        quantity: 0.01,
        paperMode: true,
        mode: "PAPER",
        createdAt: Date.now()
      }
    });

    const preflight = await client.waitFor(
      (message) => message.type === "order_preflight" && message.payload?.requestId === requestId,
      { afterIndex: beforePreflightIndex }
    );
    const persisted = await client.waitFor(
      (message) =>
        message.type === "order_preflight_persisted" && message.payload?.requestId === requestId,
      { afterIndex: beforePreflightIndex }
    );

    assert.equal(preflight.type, "order_preflight");
    assert.equal(persisted.type, "order_preflight_persisted");
    assert.equal(preflight.payload?.symbol, symbol);
    assert.equal(isAcceptedPreflight(preflight), true);
    assert.equal(persisted.payload?.status, "ACTIVE");

    const preflightId = String(preflight.payload?.preflightId);
    const preflightRecord = orderPreflightRepository.getById(preflightId);
    assert.ok(preflightRecord, "Expected persisted preflight record.");
    assert.equal(preflightRecord?.status, "ACTIVE");

    addSection(sections, "WebSocket preflight persistence", "PASS", {
      requestId,
      preflightId,
      persistedStatus: persisted.payload?.status,
      repositoryStatus: preflightRecord?.status,
      accepted: isAcceptedPreflight(preflight)
    });

    await client.close();
    client = null;

    reconnectClient = await WsHarnessClient.connect(`ws://127.0.0.1:${port}${wsPath}`);
    const reconnectMessageIndex = reconnectClient.getMessageCount();
    reconnectClient.send({
      type: "hello",
      payload: {
        capabilities: ["compact_frame_transport_v1"],
        activeOrderPreflightIds: [preflightId]
      }
    });
    reconnectClient.send({
      type: "request_snapshot",
      payload: {
        reason: "initial_connect",
        activeOrderPreflightIds: [preflightId]
      }
    });

    const invalidation = await reconnectClient.waitFor(
      (message) =>
        message.type === "order_preflight_invalidated" &&
        message.payload?.preflightId === preflightId,
      { afterIndex: reconnectMessageIndex }
    );

    assert.equal(invalidation.type, "order_preflight_invalidated");
    assert.equal(invalidation.payload?.status, "INVALIDATED");

    const invalidatedRecord = orderPreflightRepository.getById(preflightId);
    assert.ok(invalidatedRecord, "Expected invalidated preflight to remain persisted.");
    assert.equal(invalidatedRecord?.status, "INVALIDATED");

    addSection(sections, "Reconnect invalidates old preflight", "PASS", {
      preflightId,
      invalidationStatus: invalidation.payload?.status,
      repositoryStatus: invalidatedRecord?.status,
      reason: invalidation.payload?.reason
    });

    const frontendBefore = buildConfirmReadyFrontendStateFromPreflight(
      preflight.payload as FrontendPreflightState["response"]
    );
    const frontendAfter = frontendHelper.applyOrderPreflightInvalidation(frontendBefore, {
      preflightId,
      requestId: String(invalidation.payload?.requestId ?? requestId),
      ticketKey: String(invalidation.payload?.ticketKey ?? preflight.payload?.ticketKey),
      status: "INVALIDATED",
      reason: String(invalidation.payload?.reason ?? "invalidated"),
      occurredAt: Number(invalidation.payload?.occurredAt ?? Date.now())
    });

    assert.equal(isFrontendEquivalentConfirmReady(frontendBefore), true);
    assert.equal(frontendAfter.matched, true);
    assert.equal(frontendAfter.nextState?.stale, true);
    assert.equal(frontendAfter.nextState?.loading, false);
    assert.equal(isFrontendEquivalentConfirmReady(frontendAfter.nextState), false);

    addSection(sections, "Frontend-equivalent confirm clear", "PASS", {
      confirmReadyBefore: isFrontendEquivalentConfirmReady(frontendBefore),
      confirmReadyAfter: isFrontendEquivalentConfirmReady(frontendAfter.nextState),
      staleAfter: frontendAfter.nextState?.stale ?? null,
      loadingAfter: frontendAfter.nextState?.loading ?? null
    });

    const lifecycleManager = new LifecycleManager(() => {});
    const createdAt = 1_700_200_000_000;
    const signalId = "release-smoke-signal";
    const decisionId = "release-smoke-decision";
    const intentId = "release-smoke-intent";
    const orderId = "release-smoke-order";

    unifiedSignalRepository.upsertUnifiedSignal({
      id: signalId,
      source: "alert",
      sourceId: "release-smoke-source",
      symbol,
      kind: "alert",
      title: "Release smoke signal",
      description: "Fixture chain for release smoke.",
      severity: "info",
      createdAt,
      mergeKey: `${symbol}:release-smoke`,
      rawRef: {
        collection: "alerts",
        id: "release-smoke-raw"
      }
    });
    decisionContextFixtureFactory.createFinalContext({
      id: decisionId,
      unifiedSignalId: signalId,
      symbol,
      decision: "ENTER",
      decisionReason: "Release smoke fixture decision.",
      orderIntentId: intentId,
      source: "system",
      status: "linked_to_order",
      createdAt: createdAt + 1
    });
    orderRepository.upsertOrderState({
      orderId,
      intentId,
      symbol,
      side: "BUY",
      orderType: "MARKET",
      quantity: 0.01,
      price: 65000,
      stopPrice: null,
      stopLossPrice: null,
      takeProfitPrice: null,
      status: "FILLED",
      clientOrderId: "release-smoke-client",
      exchangeOrderId: "release-smoke-exchange",
      sourceWindowId: "release-smoke",
      parentOrderId: null,
      protectiveKind: null,
      dryRun: true,
      reduceOnly: false,
      executedQty: 0.01,
      avgPrice: 65000,
      lastFilledQty: 0.01,
      realizedPnl: null,
      commission: null,
      commissionAsset: null,
      lastExecutionType: "TRADE",
      lastTradeTime: createdAt + 2,
      rejectReason: null,
      createdAt,
      updatedAt: createdAt + 2,
      lastEventSource: "paper_engine"
    });
    orderRepository.saveIntentResponse({
      intentId,
      createdAt: createdAt + 2,
      sourceWindowId: "release-smoke",
      orderId,
      responseType: "order_ack",
      dryRun: true,
      response: {
        type: "order_ack",
        generatedAt: createdAt + 2,
        payload: {
          intentId,
          duplicate: false,
          order: orderRepository.getOrderByOrderId(orderId) ?? {
            orderId,
            intentId,
            symbol,
            side: "BUY",
            orderType: "MARKET",
            quantity: 0.01,
            price: 65000,
            stopPrice: null,
            stopLossPrice: null,
            takeProfitPrice: null,
            status: "FILLED",
            clientOrderId: "release-smoke-client",
            exchangeOrderId: "release-smoke-exchange",
            sourceWindowId: "release-smoke",
            parentOrderId: null,
            protectiveKind: null,
            dryRun: true,
            reduceOnly: false,
            executedQty: 0.01,
            avgPrice: 65000,
            lastFilledQty: 0.01,
            realizedPnl: null,
            commission: null,
            commissionAsset: null,
            lastExecutionType: "TRADE",
            lastTradeTime: createdAt + 2,
            rejectReason: null,
            createdAt,
            updatedAt: createdAt + 2,
            lastEventSource: "paper_engine"
          },
          validation: {
            accepted: true,
            paperMode: true,
            checks: [],
            normalizedQuantity: 0.01,
            normalizedPrice: 65000,
            notional: 650,
            riskLimits: {
              maxPositionSize: { enabled: false, value: null },
              maxAccountExposure: { enabled: false, value: null },
              maxLeverage: { enabled: false, value: null },
              maxDailyLoss: { enabled: false, value: null }
            }
          },
          message: "Release smoke fixture order acknowledged."
        }
      }
    });
    lifecycleManager.createOrOpenPositionLifecycle({
      order: orderRepository.getOrderByOrderId(orderId)!,
      timestamp: createdAt + 3,
      decisionContextId: decisionId,
      unifiedSignalId: signalId
    });

    const createdLifecycle = positionLifecycleRepository.getPositionLifecycleByOrderIntentId(intentId);
    assert.ok(createdLifecycle, "Expected release smoke lifecycle to be created.");
    lifecycleManager.closeLiveRecoveryLifecycle({
      lifecycle: createdLifecycle!,
      timestamp: createdAt + 4,
      payload: {
        releaseSmoke: true
      }
    });

    const lifecycleRecords = decisionChainIntegrityRepository
      .listRecentRecords(20)
      .filter((record) => record.lifecycleId === createdLifecycle?.id)
      .sort((left, right) => left.checkedAt - right.checkedAt);

    assert.ok(lifecycleRecords.some((record) => record.status === "DEGRADED"));
    const latestLifecycleRecord = lifecycleRecords[lifecycleRecords.length - 1] ?? null;
    assert.ok(latestLifecycleRecord, "Expected release smoke lifecycle integrity records.");
    assert.equal(latestLifecycleRecord?.status, "COMPLETE");

    addSection(sections, "Latest chain integrity wins over transient degraded", "PASS", {
      lifecycleId: createdLifecycle?.id ?? null,
      statuses: lifecycleRecords.map((record) => ({
        source: record.source,
        status: record.status,
        missingLinks: record.missingLinks
      })),
      latestStatus: latestLifecycleRecord?.status ?? null
    });
  } finally {
    if (client) {
      await client.close().catch(() => undefined);
    }
    if (reconnectClient) {
      await reconnectClient.close().catch(() => undefined);
    }
    await backendModule.stopScalpStationBackend().catch(() => undefined);
    restoreFetch?.();
    restoreFetch = null;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const overall = sections.every((section) => section.status === "PASS") ? "PASS" : "FAIL";
  const firstBlocker = sections.find((section) => section.status === "FAIL")?.blocker ?? null;

  console.log("## Release Smoke Integration Harness");
  console.log(`Overall: ${overall}`);
  if (firstBlocker) {
    console.log(`First blocker: ${firstBlocker}`);
  }
  console.log(
    JSON.stringify(
      {
        localOnly: true,
        realWebSocketFlow: true,
        liveOrdersSubmitted: false,
        liveTradingEnabled: false,
        checksPerformed: sections.map((section) => section.name)
      },
      null,
      2
    )
  );
  console.log("");

  for (const section of sections) {
    console.log(`### ${section.name}: ${section.status}`);
    if (section.blocker) {
      console.log(`Blocker: ${section.blocker}`);
    }
    console.log(JSON.stringify(section.detail, null, 2));
    console.log("");
  }

  assert.equal(overall, "PASS");
}

main().catch((error) => {
  console.error("release smoke failed", {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  process.exitCode = 1;
});
