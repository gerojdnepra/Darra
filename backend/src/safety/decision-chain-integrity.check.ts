import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  OrderAckMessage,
  OrderStatePayload,
  OrderValidationPayload,
  UnifiedSignalEvent
} from "../types/messages";

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
  description: "Fixture unified signal.",
  severity: "info",
  createdAt,
  mergeKey: `${symbol}:fixture`,
  rawRef: {
    collection: "alerts",
    id: `${id}-raw`
  }
});

const buildOrder = (input: {
  orderId: string;
  intentId: string;
  symbol: string;
  quantity: number;
  createdAt: number;
}): OrderStatePayload => ({
  orderId: input.orderId,
  intentId: input.intentId,
  symbol: input.symbol,
  side: "BUY",
  orderType: "MARKET",
  quantity: input.quantity,
  price: 101,
  stopPrice: null,
  stopLossPrice: null,
  takeProfitPrice: null,
  status: "FILLED",
  clientOrderId: `${input.orderId}-client`,
  exchangeOrderId: `${input.orderId}-exchange`,
  sourceWindowId: "fixture-window",
  parentOrderId: null,
  protectiveKind: null,
  dryRun: true,
  reduceOnly: false,
  executedQty: input.quantity,
  avgPrice: 101,
  lastFilledQty: input.quantity,
  realizedPnl: null,
  commission: null,
  commissionAsset: null,
  lastExecutionType: "TRADE",
  lastTradeTime: input.createdAt + 1,
  rejectReason: null,
  createdAt: input.createdAt,
  updatedAt: input.createdAt + 2,
  lastEventSource: "paper_engine"
});

const buildAck = (intentId: string, order: OrderStatePayload, generatedAt: number): OrderAckMessage => ({
  type: "order_ack",
  generatedAt,
  payload: {
    intentId,
    duplicate: false,
    order,
    validation,
    message: "Fixture order acknowledged."
  }
});

async function main(): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "decision-chain-integrity-"));
  const sqlitePath = path.join(tempRoot, "fixture.sqlite");
  process.env.SCALPSTATION_SQLITE_PATH = sqlitePath;

  const { closeSqlite } = await import("../storage/sqlite");
  const { unifiedSignalRepository } = await import("../storage/unified-signal-repository");
  const { orderRepository } = await import("../storage/order-repository");
  const { positionLifecycleRepository } = await import("../storage/position-lifecycle-repository");
  const { chainIntegrityService } = await import("../storage/chain-integrity-service");
  const { decisionChainIntegrityRepository } = await import(
    "../storage/decision-chain-integrity-repository"
  );
  const { reconstructDecisionChain } = await import("../storage/decision-chain-repository");
  const { LifecycleManager } = await import("../execution/lifecycle-manager");
  const { decisionContextFixtureFactory } = await import(
    "../decision/decision-context-fixture-factory"
  );

  const createFixture = (input: {
    idPrefix: string;
    symbol: string;
    includeSignal: boolean;
    includeReview: boolean;
    createdAt: number;
  }): { lifecycleId: string; reviewId: string | null } => {
    const lifecycleManager = new LifecycleManager(() => {});
    const signalId = `${input.idPrefix}-signal`;
    const decisionId = `${input.idPrefix}-decision`;
    const intentId = `${input.idPrefix}-intent`;
    const order = buildOrder({
      orderId: `${input.idPrefix}-order`,
      intentId,
      symbol: input.symbol,
      quantity: 1,
      createdAt: input.createdAt + 10
    });

    if (input.includeSignal) {
      unifiedSignalRepository.upsertUnifiedSignal(
        buildUnifiedSignal(signalId, input.symbol, input.createdAt)
      );
    }

    decisionContextFixtureFactory.createFinalContext({
      id: decisionId,
      unifiedSignalId: signalId,
      symbol: input.symbol,
      decision: "ENTER",
      decisionReason: "Fixture decision context.",
      orderIntentId: intentId,
      source: "system",
      status: "linked_to_order",
      createdAt: input.createdAt + 20
    });

    orderRepository.upsertOrderState(order);
    orderRepository.saveIntentResponse({
      intentId,
      createdAt: input.createdAt + 30,
      sourceWindowId: order.sourceWindowId,
      orderId: order.orderId,
      responseType: "order_ack",
      dryRun: order.dryRun,
      response: buildAck(intentId, order, input.createdAt + 31)
    });

    lifecycleManager.createOrOpenPositionLifecycle({
      order,
      timestamp: input.createdAt + 40,
      decisionContextId: decisionId,
      unifiedSignalId: signalId
    });
    const createdLifecycle = positionLifecycleRepository.getPositionLifecycleByOrderIntentId(intentId);
    if (!createdLifecycle) {
      throw new Error(`Fixture lifecycle was not created for ${intentId}.`);
    }

    let reviewId: string | null = null;
    if (input.includeReview) {
      const closedLifecycle = lifecycleManager.closeLiveRecoveryLifecycle({
        lifecycle: createdLifecycle,
        timestamp: input.createdAt + 50,
        payload: {
          fixture: true,
          idPrefix: input.idPrefix
        }
      });
      reviewId =
        reconstructDecisionChain({ positionLifecycleId: closedLifecycle.id }).decisionReview?.id ?? null;
    }

    return {
      lifecycleId: createdLifecycle.id,
      reviewId
    };
  };

  try {
    const complete = createFixture({
      idPrefix: "complete",
      symbol: "BTCUSDT",
      includeSignal: true,
      includeReview: true,
      createdAt: 1_700_000_000_000
    });
    const missingSignal = createFixture({
      idPrefix: "missing-signal",
      symbol: "ETHUSDT",
      includeSignal: false,
      includeReview: true,
      createdAt: 1_700_000_100_000
    });
    const missingReview = createFixture({
      idPrefix: "missing-review",
      symbol: "SOLUSDT",
      includeSignal: true,
      includeReview: false,
      createdAt: 1_700_000_200_000
    });

    const completeResult = chainIntegrityService.checkChain({
      positionLifecycleId: complete.lifecycleId,
      reviewId: complete.reviewId,
      source: "fixture_complete"
    });
    const missingSignalResult = chainIntegrityService.checkChain({
      positionLifecycleId: missingSignal.lifecycleId,
      reviewId: missingSignal.reviewId,
      source: "fixture_missing_signal"
    });
    const missingReviewResult = chainIntegrityService.checkChain({
      positionLifecycleId: missingReview.lifecycleId,
      source: "fixture_missing_review"
    });

    assert.equal(completeResult.status, "COMPLETE");
    assert.deepEqual(completeResult.missingLinks, []);

    assert.equal(missingSignalResult.status, "DEGRADED");
    assert.deepEqual(missingSignalResult.missingLinks, ["UNIFIED_SIGNAL"]);

    assert.equal(missingReviewResult.status, "DEGRADED");
    assert.deepEqual(missingReviewResult.missingLinks, ["DECISION_REVIEW"]);

    const persisted = decisionChainIntegrityRepository.listRecentRecords(20);
    assert.ok(persisted.length >= 3);

    const persistedBySource = new Map(persisted.map((record) => [record.source, record]));
    assert.equal(persistedBySource.get("fixture_complete")?.status, "COMPLETE");
    assert.deepEqual(persistedBySource.get("fixture_missing_signal")?.missingLinks, [
      "UNIFIED_SIGNAL"
    ]);
    assert.deepEqual(persistedBySource.get("fixture_missing_review")?.missingLinks, [
      "DECISION_REVIEW"
    ]);

    const completeChain = reconstructDecisionChain({
      positionLifecycleId: complete.lifecycleId,
      reviewId: complete.reviewId
    });
    const command = completeChain.executionCommand ?? null;
    assert.ok(command, "Expected reconstructed execution command for complete chain.");
    assert.equal(command.type, "PAPER");

    console.log("decision-chain-integrity check passed", {
      sqlitePath,
      results: [
        {
          source: completeResult.source,
          status: completeResult.status,
          missingLinks: completeResult.missingLinks
        },
        {
          source: missingSignalResult.source,
          status: missingSignalResult.status,
          missingLinks: missingSignalResult.missingLinks
        },
        {
          source: missingReviewResult.source,
          status: missingReviewResult.status,
          missingLinks: missingReviewResult.missingLinks
        }
      ]
    });
  } finally {
    closeSqlite();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error("decision-chain-integrity check failed", error);
  process.exitCode = 1;
});
