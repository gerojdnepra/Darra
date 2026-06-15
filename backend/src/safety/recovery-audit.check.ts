import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  OrderAckMessage,
  OrderStatePayload,
  OrderValidationPayload,
  UnifiedSignalEvent
} from "../types/messages";
import type { RestFuturesOrder, RestPositionRiskV3 } from "../types/binance";

const riskLimits = {
  maxPositionSize: { enabled: false, value: null },
  maxAccountExposure: { enabled: false, value: null },
  maxLeverage: { enabled: false, value: null },
  maxDailyLoss: { enabled: false, value: null }
} satisfies OrderValidationPayload["riskLimits"];

const validation = {
  accepted: true,
  paperMode: true,
  checks: [],
  normalizedQuantity: 1,
  normalizedPrice: 101,
  notional: 101,
  riskLimits
} satisfies OrderValidationPayload;

const buildUnifiedSignal = (id: string, symbol: string, createdAt: number): UnifiedSignalEvent => ({
  id,
  source: "alert",
  sourceId: `${id}-source`,
  symbol,
  kind: "alert",
  title: `${symbol} signal`,
  description: "Recovery audit check unified signal.",
  severity: "info",
  createdAt,
  mergeKey: `${symbol}:recovery-audit`,
  rawRef: {
    collection: "alerts",
    id: `${id}-raw`
  }
});

const buildOrder = (input: {
  orderId: string;
  intentId: string | null;
  symbol: string;
  status: OrderStatePayload["status"];
  dryRun: boolean;
  clientOrderId?: string;
  exchangeOrderId?: string | null;
  createdAt: number;
}): OrderStatePayload => ({
  orderId: input.orderId,
  intentId: input.intentId,
  symbol: input.symbol,
  side: "BUY",
  orderType: "MARKET",
  quantity: 1,
  price: 101,
  stopPrice: null,
  stopLossPrice: null,
  takeProfitPrice: null,
  status: input.status,
  clientOrderId: input.clientOrderId ?? `${input.orderId}-client`,
  exchangeOrderId: input.exchangeOrderId ?? `${input.orderId}-exchange`,
  sourceWindowId: "recovery-audit-check",
  parentOrderId: null,
  protectiveKind: null,
  dryRun: input.dryRun,
  reduceOnly: false,
  executedQty: input.status === "FILLED" ? 1 : 0,
  avgPrice: input.status === "FILLED" ? 101 : null,
  lastFilledQty: input.status === "FILLED" ? 1 : null,
  realizedPnl: null,
  commission: null,
  commissionAsset: null,
  lastExecutionType: input.status === "FILLED" ? "TRADE" : null,
  lastTradeTime: input.status === "FILLED" ? input.createdAt + 1 : null,
  rejectReason: null,
  createdAt: input.createdAt,
  updatedAt: input.createdAt + 1,
  lastEventSource: input.dryRun ? "paper_engine" : "binance_stream"
});

const buildAck = (intentId: string, order: OrderStatePayload, generatedAt: number): OrderAckMessage => ({
  type: "order_ack",
  generatedAt,
  payload: {
    intentId,
    duplicate: false,
    order,
    validation,
    message: "Recovery audit check order acknowledged."
  }
});

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to acquire recovery audit check server port.");
  }

  return address.port;
}

async function main(): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-audit-"));
  const sqlitePath = path.join(tempRoot, "fixture.sqlite");
  process.env.SCALPSTATION_SQLITE_PATH = sqlitePath;

  const requestPaths: string[] = [];
  const exchangeOnlyOrder: RestFuturesOrder = {
    orderId: 991337,
    symbol: "XRPUSDT",
    status: "NEW",
    clientOrderId: "exchange-only-client",
    price: "0.52",
    avgPrice: "0",
    origQty: "25",
    executedQty: "0",
    type: "LIMIT",
    side: "SELL",
    reduceOnly: false
  };
  const unmatchedPosition: RestPositionRiskV3 = {
    symbol: "SOLUSDT",
    positionSide: "BOTH",
    positionAmt: "2.5",
    entryPrice: "150",
    breakEvenPrice: "150",
    markPrice: "151",
    unRealizedProfit: "2.5",
    liquidationPrice: "0",
    isolatedMargin: "0",
    notional: "377.5",
    marginAsset: "USDT",
    isolatedWallet: "0",
    initialMargin: "10",
    maintMargin: "1",
    positionInitialMargin: "10",
    openOrderInitialMargin: "0",
    adl: 0,
    bidNotional: "0",
    askNotional: "0",
    updateTime: 1_700_300_000_000
  };
  const server = http.createServer((request, response) => {
    const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
    requestPaths.push(parsed.pathname);
    response.setHeader("Content-Type", "application/json");

    if (parsed.pathname === "/fapi/v1/time") {
      response.end(JSON.stringify({ serverTime: Date.now() }));
      return;
    }

    if (parsed.pathname === "/fapi/v1/openOrders") {
      response.end(JSON.stringify([exchangeOnlyOrder]));
      return;
    }

    if (parsed.pathname === "/fapi/v3/positionRisk") {
      response.end(JSON.stringify([unmatchedPosition]));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ code: -1, msg: "not found" }));
  });

  const port = await listen(server);
  const restBase = `http://127.0.0.1:${port}`;

  const warnMessages: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnMessages.push(args.map((value) => String(value)).join(" "));
    originalWarn(...args);
  };

  const { closeSqlite, getSqlite } = await import("../storage/sqlite");
  const { orderRepository } = await import("../storage/order-repository");
  const { recoveryAuditRepository } = await import("../storage/recovery-audit-repository");
  const { positionLifecycleRepository } = await import("../storage/position-lifecycle-repository");
  const { unifiedSignalRepository } = await import("../storage/unified-signal-repository");
  const { chainIntegrityService } = await import("../storage/chain-integrity-service");
  const { reconstructDecisionChain } = await import("../storage/decision-chain-repository");
  const { LifecycleManager } = await import("../execution/lifecycle-manager");
  const { BinanceOrderService } = await import("../services/binance-order-service");
  const { decisionContextFixtureFactory } = await import(
    "../decision/decision-context-fixture-factory"
  );

  try {
    const serviceMessages: Array<{ type: string; payload?: unknown }> = [];
    const service = new BinanceOrderService(restBase, {
      defaultPaperMode: true,
      liveModeEnabled: true,
      liveTradingEnabled: false,
      apiKey: "recovery-audit-key",
      apiSecret: "recovery-audit-secret",
      restBase,
      skipStartupRecovery: true,
      onMessage: (message) => {
        serviceMessages.push(message);
      }
    });

    const startedAt = 1_700_300_000_000;
    const localActiveOrder = buildOrder({
      orderId: "local-active-order",
      intentId: "local-active-intent",
      symbol: "BTCUSDT",
      status: "NEW",
      dryRun: false,
      clientOrderId: "local-active-client",
      exchangeOrderId: "local-active-exchange",
      createdAt: startedAt
    });
    orderRepository.upsertOrderState(localActiveOrder);

    const orphanLifecycleManager = new LifecycleManager(() => {});
    orphanLifecycleManager.createOrOpenPositionLifecycle({
      order: buildOrder({
        orderId: "orphan-lifecycle-order",
        intentId: "orphan-lifecycle-intent",
        symbol: "ETHUSDT",
        status: "FILLED",
        dryRun: true,
        createdAt: startedAt
      }),
      timestamp: startedAt,
      decisionContextId: null,
      unifiedSignalId: null
    });
    const orphanLifecycle =
      positionLifecycleRepository.getPositionLifecycleByOrderIntentId("orphan-lifecycle-intent");
    assert.ok(orphanLifecycle, "Expected orphan recovery lifecycle fixture to be created.");

    await service.runLivePositionLifecycleRecoveryAudit();
    await service.runLivePositionLifecycleRecoveryAudit();

    const db = getSqlite();
    const invalidOrderAuditRefs = db
      .prepare(
        `
          SELECT COUNT(*)
          FROM order_audit_events audit
          LEFT JOIN orders parent ON parent.id = audit.order_id
          WHERE parent.id IS NULL
        `
      )
      .pluck()
      .get() as number;
    const syntheticRecoveryInOrderAudit = db
      .prepare(
        `
          SELECT COUNT(*)
          FROM order_audit_events
          WHERE event_type IN (
            'LIVE_RECOVERY_LIFECYCLE_ORPHAN_NO_POSITION',
            'LIVE_RECOVERY_LIFECYCLE_POSITION_CLOSED',
            'LIVE_RECOVERY_EXCHANGE_ORDER_NO_LOCAL_ORDER',
            'LIVE_RECOVERY_POSITION_NO_LIFECYCLE',
            'LIVE_RECOVERY_ERROR'
          )
        `
      )
      .pluck()
      .get() as number;
    const fkViolations = db.prepare("PRAGMA foreign_key_check").all() as Array<Record<string, unknown>>;
    const orderNoExchangeOrderCount = db
      .prepare(
        `
          SELECT COUNT(*)
          FROM order_audit_events
          WHERE event_type = 'LIVE_RECOVERY_ORDER_NO_EXCHANGE_ORDER'
        `
      )
      .pluck()
      .get() as number;
    const summaryCount = db
      .prepare(
        `
          SELECT COUNT(*)
          FROM order_audit_events
          WHERE event_type = 'LIVE_RECOVERY_SUMMARY'
        `
      )
      .pluck()
      .get() as number;

    const recoveryEvents = recoveryAuditRepository.listRecentRecoveryAuditEvents(20);
    const recoveryEventCounts = recoveryEvents.reduce<Record<string, number>>((counts, event) => {
      counts[event.eventType] = (counts[event.eventType] ?? 0) + 1;
      return counts;
    }, {});

    assert.ok(requestPaths.includes("/fapi/v1/openOrders"));
    assert.ok(requestPaths.includes("/fapi/v3/positionRisk"));
    assert.equal(invalidOrderAuditRefs, 0, "Expected no orphan order_audit_events rows.");
    assert.equal(
      syntheticRecoveryInOrderAudit,
      0,
      "Synthetic recovery-only markers must not be written into order_audit_events."
    );
    assert.equal(fkViolations.length, 0, "Expected PRAGMA foreign_key_check to remain clean.");
    assert.equal(
      warnMessages.some((message) => message.includes("SQLITE_CONSTRAINT_FOREIGNKEY")),
      false,
      "Recovery pass must not emit SQLITE_CONSTRAINT_FOREIGNKEY warnings."
    );
    assert.equal(orderNoExchangeOrderCount, 1, "Order-linked recovery marker should persist once.");
    assert.ok(summaryCount >= 2, "Recovery summary should persist for each recovery pass.");
    assert.ok(
      recoveryEventCounts["LIVE_RECOVERY_LIFECYCLE_ORPHAN_NO_POSITION"] === 1,
      "Expected lifecycle orphan recovery marker to persist in recovery_audit_events."
    );
    assert.ok(
      recoveryEventCounts["LIVE_RECOVERY_EXCHANGE_ORDER_NO_LOCAL_ORDER"] === 1,
      "Expected exchange-order orphan marker to persist in recovery_audit_events."
    );
    assert.ok(
      recoveryEventCounts["LIVE_RECOVERY_POSITION_NO_LIFECYCLE"] === 1,
      "Expected position-no-lifecycle marker to persist in recovery_audit_events."
    );

    const lifecycleManager = new LifecycleManager(() => {});
    const signalCreatedAt = startedAt + 1_000;
    const signalId = `recovery-fixture-signal-${randomUUID()}`;
    const decisionId = `recovery-fixture-decision-${randomUUID()}`;
    const intentId = `recovery-fixture-intent-${randomUUID()}`;
    const completeOrder = buildOrder({
      orderId: `recovery-fixture-order-${randomUUID()}`,
      intentId,
      symbol: "ADAUSDT",
      status: "FILLED",
      dryRun: true,
      createdAt: signalCreatedAt + 10
    });

    unifiedSignalRepository.upsertUnifiedSignal(
      buildUnifiedSignal(signalId, "ADAUSDT", signalCreatedAt)
    );
    decisionContextFixtureFactory.createFinalContext({
      id: decisionId,
      unifiedSignalId: signalId,
      symbol: "ADAUSDT",
      decision: "ENTER",
      decisionReason: "Recovery audit integrity fixture.",
      orderIntentId: intentId,
      source: "system",
      status: "linked_to_order",
      createdAt: signalCreatedAt + 20
    });
    orderRepository.upsertOrderState(completeOrder);
    orderRepository.saveIntentResponse({
      intentId,
      createdAt: signalCreatedAt + 30,
      sourceWindowId: completeOrder.sourceWindowId,
      orderId: completeOrder.orderId,
      responseType: "order_ack",
      dryRun: completeOrder.dryRun,
      response: buildAck(intentId, completeOrder, signalCreatedAt + 31)
    });
    lifecycleManager.createOrOpenPositionLifecycle({
      order: completeOrder,
      timestamp: signalCreatedAt + 40,
      decisionContextId: decisionId,
      unifiedSignalId: signalId
    });
    const createdLifecycle = positionLifecycleRepository.getPositionLifecycleByOrderIntentId(intentId);
    assert.ok(createdLifecycle, "Expected integrity fixture lifecycle to be created.");
    const closedLifecycle = lifecycleManager.closeLiveRecoveryLifecycle({
      lifecycle: createdLifecycle!,
      timestamp: signalCreatedAt + 50,
      payload: {
        fixture: "recovery-audit-check"
      }
    });
    const reviewId =
      reconstructDecisionChain({ positionLifecycleId: closedLifecycle.id }).decisionReview?.id ?? null;
    assert.ok(reviewId, "Expected integrity fixture review to be created.");

    const integrityRecord = chainIntegrityService.checkChain({
      positionLifecycleId: closedLifecycle.id,
      reviewId,
      source: "recovery_audit_check"
    });
    assert.equal(
      integrityRecord.status,
      "COMPLETE",
      "Decision-chain integrity should remain COMPLETE after recovery audit persistence."
    );

    console.log("recovery audit checks passed", {
      sqlitePath,
      orderAuditMarkers: {
        orderNoExchangeOrderCount,
        summaryCount
      },
      recoveryAuditMarkers: recoveryEvents.map((event) => ({
        eventType: event.eventType,
        fingerprint: event.fingerprint,
        symbol: event.symbol,
        orderId: event.orderId,
        lifecycleId: event.lifecycleId
      })),
      emittedMessages: serviceMessages.length,
      checkedAt: Date.now()
    });
  } finally {
    console.warn = originalWarn;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeSqlite();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("recovery audit checks failed", error);
  process.exitCode = 1;
});
