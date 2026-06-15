import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { applyMigrations } from "../storage/migrations";
import {
  evaluateClientOrderIdSafety,
  evaluateOrderRiskSafety,
  evaluateReduceOnlyPositionSafety,
  buildSafeToAddResult
} from "./order-safety";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertDecision = (
  name: string,
  decision: { passed: boolean },
  expectedPassed: boolean
): void => {
  assert(
    decision.passed === expectedPassed,
    `${name}: expected passed=${expectedPassed}, got ${decision.passed}`
  );
};

type FixtureClosureDecision = "CAN_CLOSE" | "CANNOT_CLOSE" | "AMBIGUOUS";

interface FixtureClosureEvaluation {
  decision: FixtureClosureDecision;
  reason: string;
  matchMethod: "orderIntentId" | null;
}

interface FixtureLifecycleRow {
  id: string;
  symbol: string;
  order_intent_id: string | null;
  decision_context_id: string | null;
  unified_signal_id: string | null;
  status: string;
  opened_at: number | null;
  closed_at: number | null;
  updated_at: number;
  created_at: number;
}

interface FixtureDecisionContextRow {
  id: string;
  unified_signal_id: string | null;
  symbol: string;
  order_intent_id: string | null;
  payload_json: string | null;
}

interface FixtureReviewRow {
  id: string;
  symbol: string;
  unified_signal_id: string | null;
  decision_context_id: string | null;
  order_intent_id: string | null;
  position_lifecycle_id: string | null;
  market_regime: string | null;
}

const countFixtureRows = (
  db: Database.Database,
  sql: string,
  ...params: unknown[]
): number => {
  const row = db.prepare(sql).get(...params) as { count: number } | undefined;
  return row?.count ?? 0;
};

const parseFixturePayloadString = (payloadJson: string | null, key: string): string | null => {
  if (!payloadJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const value = (parsed as Record<string, unknown>)[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
};

const seedRecoveryReviewFixtureChain = (
  db: Database.Database,
  input: {
    suffix: string;
    status?: "OPEN" | "MANAGING";
    timestamp: number;
  }
): void => {
  const symbol = "BTCUSDT";
  const status = input.status ?? "OPEN";
  const lifecycleId = `fixture-lifecycle-${input.suffix}`;
  const orderIntentId = `fixture-intent-${input.suffix}`;
  const decisionContextId = `fixture-decision-${input.suffix}`;
  const unifiedSignalId = `fixture-signal-${input.suffix}`;
  const orderId = `fixture-order-${input.suffix}`;
  const clientOrderId = `fixture-client-${input.suffix}`;

  db.prepare(
    `
      INSERT INTO trade_decision_contexts (
        id,
        unified_signal_id,
        symbol,
        decision,
        decision_reason,
        risk_snapshot_ref,
        preflight_id,
        preflight_nonce,
        order_intent_id,
        review_correlation_id,
        source,
        status,
        created_at,
        updated_at,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    decisionContextId,
    unifiedSignalId,
    symbol,
    "ENTER",
    "seeded recovery close review proof",
    null,
    null,
    null,
    orderIntentId,
    `fixture-review-correlation-${input.suffix}`,
    "system",
    "committed",
    input.timestamp,
    null,
    JSON.stringify({ marketRegime: "fixture-regime" })
  );

  db.prepare(
    `
      INSERT INTO position_lifecycles (
        id,
        symbol,
        order_intent_id,
        decision_context_id,
        unified_signal_id,
        status,
        opened_at,
        closed_at,
        updated_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    lifecycleId,
    symbol,
    orderIntentId,
    decisionContextId,
    unifiedSignalId,
    status,
    input.timestamp - 1_000,
    null,
    input.timestamp,
    input.timestamp - 1_000
  );

  db.prepare(
    `
      INSERT INTO orders (
        id,
        intent_id,
        symbol,
        side,
        type,
        quantity,
        price,
        stop_price,
        stop_loss_price,
        take_profit_price,
        status,
        client_order_id,
        exchange_order_id,
        source_window_id,
        parent_order_id,
        protective_kind,
        dry_run,
        reduce_only,
        executed_qty,
        avg_price,
        reject_reason,
        created_at,
        updated_at,
        last_event_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    orderId,
    orderIntentId,
    symbol,
    "BUY",
    "MARKET",
    1,
    null,
    null,
    null,
    null,
    "FILLED",
    clientOrderId,
    `fixture-exchange-${input.suffix}`,
    "fixture-window",
    null,
    null,
    0,
    0,
    1,
    100,
    null,
    input.timestamp - 900,
    input.timestamp - 800,
    "binance_stream"
  );

  db.prepare(
    `
      INSERT INTO order_intents (
        intent_id,
        created_at,
        source_window_id,
        order_id,
        response_type,
        dry_run,
        response_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    orderIntentId,
    input.timestamp - 900,
    "fixture-window",
    orderId,
    "order_ack",
    0,
    JSON.stringify({
      type: "order_ack",
      generatedAt: input.timestamp - 800,
      payload: {
        intentId: orderIntentId,
        accepted: true,
        paperMode: false,
        orderId,
        clientOrderId,
        message: "seeded fixture ack"
      }
    })
  );
};

const createDecisionReviewFromClosedLifecycleFixture = (
  db: Database.Database,
  lifecycleId: string,
  timestamp: number
): string => {
  const existing = db
    .prepare(
      `
        SELECT id
        FROM decision_reviews
        WHERE position_lifecycle_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `
    )
    .get(lifecycleId) as { id: string } | undefined;
  if (existing) {
    return existing.id;
  }

  const lifecycle = db
    .prepare(
      `
        SELECT
          id,
          symbol,
          order_intent_id,
          decision_context_id,
          unified_signal_id,
          status,
          opened_at,
          closed_at,
          updated_at,
          created_at
        FROM position_lifecycles
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(lifecycleId) as FixtureLifecycleRow | undefined;
  if (!lifecycle || lifecycle.status !== "CLOSED") {
    throw new Error("fixture lifecycle must be closed before review creation.");
  }

  const decisionById = lifecycle.decision_context_id
    ? (db
        .prepare(
          `
            SELECT id, unified_signal_id, symbol, order_intent_id, payload_json
            FROM trade_decision_contexts
            WHERE id = ?
            LIMIT 1
          `
        )
        .get(lifecycle.decision_context_id) as FixtureDecisionContextRow | undefined)
    : undefined;
  const decisionContext =
    decisionById ??
    (lifecycle.order_intent_id
      ? (db
          .prepare(
            `
              SELECT id, unified_signal_id, symbol, order_intent_id, payload_json
              FROM trade_decision_contexts
              WHERE order_intent_id = ?
              ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC
              LIMIT 1
            `
          )
          .get(lifecycle.order_intent_id) as FixtureDecisionContextRow | undefined)
      : undefined);
  const unifiedSignalId = lifecycle.unified_signal_id ?? decisionContext?.unified_signal_id ?? null;
  const orderIntentId = lifecycle.order_intent_id ?? decisionContext?.order_intent_id ?? null;
  const decisionContextId = lifecycle.decision_context_id ?? decisionContext?.id ?? null;
  const marketRegime = parseFixturePayloadString(decisionContext?.payload_json ?? null, "marketRegime");
  const reviewId = `fixture-review-${lifecycle.id}`;

  db.prepare(
    `
      INSERT INTO decision_reviews (
        id,
        symbol,
        signal_id,
        unified_signal_id,
        decision_context_id,
        order_intent_id,
        position_lifecycle_id,
        journal_entry_id,
        outcome_id,
        market_regime,
        trade_grade,
        rule_violations_json,
        playbook_tags_json,
        notes,
        status,
        generation_source,
        generation_version,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    reviewId,
    lifecycle.symbol,
    unifiedSignalId,
    unifiedSignalId,
    decisionContextId,
    orderIntentId,
    lifecycle.id,
    null,
    null,
    marketRegime,
    null,
    "[]",
    "[]",
    null,
    "draft",
    "position_lifecycle",
    "v1",
    timestamp,
    timestamp
  );

  return reviewId;
};

const applyRecoveryCloseReviewFixture = (
  db: Database.Database,
  input: {
    lifecycleId: string;
    closureEvaluation: FixtureClosureEvaluation;
    timestamp: number;
  }
): { closed: boolean; reviewId: string | null } => {
  if (
    input.closureEvaluation.decision === "AMBIGUOUS" ||
    input.closureEvaluation.decision === "CANNOT_CLOSE" ||
    input.closureEvaluation.decision !== "CAN_CLOSE" ||
    input.closureEvaluation.matchMethod !== "orderIntentId"
  ) {
    return { closed: false, reviewId: null };
  }

  const lifecycle = db
    .prepare(
      `
        SELECT
          id,
          symbol,
          order_intent_id,
          decision_context_id,
          unified_signal_id,
          status,
          opened_at,
          closed_at,
          updated_at,
          created_at
        FROM position_lifecycles
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(input.lifecycleId) as FixtureLifecycleRow | undefined;
  if (
    !lifecycle ||
    !lifecycle.order_intent_id ||
    (lifecycle.status !== "OPEN" && lifecycle.status !== "MANAGING")
  ) {
    return { closed: false, reviewId: null };
  }

  db.prepare(
    `
      UPDATE position_lifecycles
      SET status = 'CLOSED',
          closed_at = ?,
          updated_at = ?
      WHERE id = ?
    `
  ).run(input.timestamp, input.timestamp, lifecycle.id);
  db.prepare(
    `
      INSERT INTO position_lifecycle_events (
        id,
        lifecycle_id,
        event_type,
        timestamp,
        payload_json
      ) VALUES (?, ?, ?, ?, ?)
    `
  ).run(
    `fixture-close-event-${lifecycle.id}-${input.timestamp}`,
    lifecycle.id,
    "POSITION_CLOSED",
    input.timestamp,
    JSON.stringify({
      reason: input.closureEvaluation.reason,
      closureEvaluation: input.closureEvaluation
    })
  );

  const reviewId = createDecisionReviewFromClosedLifecycleFixture(
    db,
    lifecycle.id,
    input.timestamp
  );
  return { closed: true, reviewId };
};

const assertSeededRecoveryCloseReviewPersistence = (): void => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "darra-recovery-review-"));
  const dbPath = path.join(tmpDir, "fixture.sqlite");
  const db = new Database(dbPath);

  try {
    db.pragma("foreign_keys = ON");
    applyMigrations(db);

    const indexes = db.prepare("PRAGMA index_list(decision_reviews)").all() as Array<{
      name: string;
      unique: number;
    }>;
    assert(
      indexes.some(
        (index) =>
          index.name === "idx_decision_reviews_position_lifecycle_id_unique" &&
          index.unique === 1
      ),
      "fixture schema must enforce unique DecisionReview positionLifecycleId."
    );

    const timestamp = 1_900_000_000_000;
    seedRecoveryReviewFixtureChain(db, { suffix: "can-close", timestamp });
    const orderBeforeClose = JSON.stringify(
      db.prepare("SELECT status, updated_at FROM orders WHERE id = ?").get("fixture-order-can-close")
    );
    const canCloseEvaluation: FixtureClosureEvaluation = {
      decision: "CAN_CLOSE",
      reason: "seeded evaluator proof",
      matchMethod: "orderIntentId"
    };

    const firstClose = applyRecoveryCloseReviewFixture(db, {
      lifecycleId: "fixture-lifecycle-can-close",
      closureEvaluation: canCloseEvaluation,
      timestamp: timestamp + 1
    });
    assert(firstClose.closed === true, "CAN_CLOSE fixture must close the lifecycle.");
    assert(firstClose.reviewId !== null, "CAN_CLOSE fixture must create a DecisionReview.");
    assert(
      countFixtureRows(
        db,
        "SELECT COUNT(*) AS count FROM decision_reviews WHERE position_lifecycle_id = ?",
        "fixture-lifecycle-can-close"
      ) === 1,
      "CAN_CLOSE fixture must persist exactly one DecisionReview after first close."
    );
    assert(
      countFixtureRows(
        db,
        "SELECT COUNT(*) AS count FROM position_lifecycle_events WHERE lifecycle_id = ? AND event_type = 'POSITION_CLOSED'",
        "fixture-lifecycle-can-close"
      ) === 1,
      "CAN_CLOSE fixture must persist a POSITION_CLOSED lifecycle event."
    );
    const closedLifecycle = db
      .prepare("SELECT status, closed_at FROM position_lifecycles WHERE id = ?")
      .get("fixture-lifecycle-can-close") as { status: string; closed_at: number | null } | undefined;
    assert(
      closedLifecycle?.status === "CLOSED" && closedLifecycle.closed_at === timestamp + 1,
      "CAN_CLOSE fixture must persist CLOSED lifecycle status and closedAt."
    );

    const secondClose = applyRecoveryCloseReviewFixture(db, {
      lifecycleId: "fixture-lifecycle-can-close",
      closureEvaluation: canCloseEvaluation,
      timestamp: timestamp + 2
    });
    assert(secondClose.closed === false, "repeat recovery close must not close an already closed lifecycle.");
    assert(
      countFixtureRows(
        db,
        "SELECT COUNT(*) AS count FROM decision_reviews WHERE position_lifecycle_id = ?",
        "fixture-lifecycle-can-close"
      ) === 1,
      "repeat recovery close must not create a duplicate DecisionReview."
    );
    assert(
      countFixtureRows(
        db,
        "SELECT COUNT(*) AS count FROM position_lifecycle_events WHERE lifecycle_id = ? AND event_type = 'POSITION_CLOSED'",
        "fixture-lifecycle-can-close"
      ) === 1,
      "repeat recovery close must not create a duplicate POSITION_CLOSED event."
    );

    const review = db
      .prepare(
        `
          SELECT
            id,
            symbol,
            unified_signal_id,
            decision_context_id,
            order_intent_id,
            position_lifecycle_id,
            market_regime
          FROM decision_reviews
          WHERE position_lifecycle_id = ?
          LIMIT 1
        `
      )
      .get("fixture-lifecycle-can-close") as FixtureReviewRow | undefined;
    if (!review) {
      throw new Error("DecisionReview must be findable by lifecycle id.");
    }
    assert(
      review.decision_context_id === "fixture-decision-can-close" &&
        review.order_intent_id === "fixture-intent-can-close" &&
        review.unified_signal_id === "fixture-signal-can-close" &&
        review.market_regime === "fixture-regime",
      "DecisionReview must reconstruct lifecycle/orderIntent/decisionContext metadata."
    );
    assert(
      countFixtureRows(
        db,
        `
          SELECT COUNT(*) AS count
          FROM decision_reviews review
          JOIN position_lifecycles lifecycle
            ON lifecycle.id = review.position_lifecycle_id
          JOIN trade_decision_contexts decision
            ON decision.id = review.decision_context_id
           AND decision.order_intent_id = review.order_intent_id
          JOIN order_intents intent
            ON intent.intent_id = review.order_intent_id
          JOIN orders ord
            ON ord.intent_id = review.order_intent_id
          WHERE review.id = ?
        `,
        review.id
      ) === 1,
      "DecisionReview must reconstruct through lifecycle, decision context, order intent, and order links."
    );
    assert(
      JSON.stringify(
        db.prepare("SELECT status, updated_at FROM orders WHERE id = ?").get("fixture-order-can-close")
      ) === orderBeforeClose,
      "recovery close review fixture must not mutate live order state."
    );

    seedRecoveryReviewFixtureChain(db, { suffix: "ambiguous", timestamp });
    const ambiguousClose = applyRecoveryCloseReviewFixture(db, {
      lifecycleId: "fixture-lifecycle-ambiguous",
      closureEvaluation: {
        decision: "AMBIGUOUS",
        reason: "symbol-only fixture evidence",
        matchMethod: null
      },
      timestamp: timestamp + 3
    });
    assert(ambiguousClose.closed === false, "AMBIGUOUS fixture must not close lifecycle.");
    assert(
      countFixtureRows(
        db,
        "SELECT COUNT(*) AS count FROM decision_reviews WHERE position_lifecycle_id = ?",
        "fixture-lifecycle-ambiguous"
      ) === 0,
      "AMBIGUOUS fixture must not create a DecisionReview."
    );

    seedRecoveryReviewFixtureChain(db, { suffix: "cannot-close", timestamp });
    const cannotClose = applyRecoveryCloseReviewFixture(db, {
      lifecycleId: "fixture-lifecycle-cannot-close",
      closureEvaluation: {
        decision: "CANNOT_CLOSE",
        reason: "active related order fixture evidence",
        matchMethod: "orderIntentId"
      },
      timestamp: timestamp + 4
    });
    assert(cannotClose.closed === false, "CANNOT_CLOSE fixture must not close lifecycle.");
    assert(
      countFixtureRows(
        db,
        "SELECT COUNT(*) AS count FROM decision_reviews WHERE position_lifecycle_id = ?",
        "fixture-lifecycle-cannot-close"
      ) === 0,
      "CANNOT_CLOSE fixture must not create a DecisionReview."
    );
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

const serviceSource = fs.readFileSync(
  path.resolve("src", "services", "binance-order-service.ts"),
  "utf8"
);
const packageSource = fs.readFileSync(path.resolve("package.json"), "utf8");
const testnetRuntimeHarnessSource = fs.readFileSync(
  path.resolve("src", "safety", "testnet-runtime-harness.ts"),
  "utf8"
);
const testnetPreflightSmokeSource = fs.readFileSync(
  path.resolve("src", "safety", "testnet-preflight-smoke.ts"),
  "utf8"
);
const testnetLifecycleSmokeSource = fs.readFileSync(
  path.resolve("src", "safety", "testnet-lifecycle-smoke.ts"),
  "utf8"
);
const repositorySource = fs.readFileSync(
  path.resolve("src", "storage", "order-repository.ts"),
  "utf8"
);
const decisionReviewRepositorySource = fs.readFileSync(
  path.resolve("src", "storage", "decision-review-repository.ts"),
  "utf8"
);
const handleIntentIndex = serviceSource.indexOf("async handleIntent(");
const duplicateIndex = serviceSource.indexOf(
  "orderRepository.getIntentResponse(meta.intentId)",
  handleIntentIndex
);
const liveGateIndex = serviceSource.indexOf("this.validateLiveGate(payload, meta)", handleIntentIndex);
const replayIndex = serviceSource.indexOf("this.replayIntentResponse(duplicate)", handleIntentIndex);
const decisionContextLinkIndex = serviceSource.indexOf(
  "this.linkExplicitDecisionContext(meta, payload)",
  handleIntentIndex
);
const clientOrderIdIndex = serviceSource.indexOf("evaluateClientOrderIdSafety", handleIntentIndex);
const inFlightIntentLookupIndex = serviceSource.indexOf(
  "orderRepository.findOrderAuditEventByIntentIdAndType(",
  handleIntentIndex
);
const cancelInFlightLookupIndex = serviceSource.indexOf(
  "const submittedCancelIntentAudit =",
  handleIntentIndex
);
const validateBoundPreflightIndex = serviceSource.indexOf("this.validateBoundPreflight(intent)");
const rejectedReplayIndex = serviceSource.indexOf('record.response.type === "order_rejected"');
const duplicateMarkerIndex = serviceSource.indexOf("duplicate: true", rejectedReplayIndex);
const placeFuturesOrderIndex = serviceSource.indexOf("placeFuturesOrder(this.restBase");
const cancelFuturesOrderIndex = serviceSource.indexOf("cancelFuturesOrder(this.restBase");
const preSubmitIntentAuditWriteIndex = serviceSource.indexOf(
  "Persisted durable pre-submit order intent before Binance REST submit."
);
const preSubmitIntentRecordGateCallIndex = serviceSource.indexOf(
  "preSubmitIntent = this.persistAndVerifyPreSubmitOrderIntent",
  validateBoundPreflightIndex
);
const preSubmitIntentRecordWriteIndex = serviceSource.indexOf(
  "orderRepository.savePreSubmitIntentRecord({",
  preSubmitIntentRecordGateCallIndex
);
const preSubmitIntentRecordReadbackIndex = serviceSource.indexOf(
  "orderRepository.getPreSubmitIntentRecord(intent.intentId)",
  preSubmitIntentRecordGateCallIndex
);
const preSubmitDurabilityFailClosedIndex = serviceSource.indexOf(
  "ORDER_INTENT_DURABILITY_FAILED",
  preSubmitIntentRecordGateCallIndex
);
const preSubmitCancelAuditWriteIndex = serviceSource.indexOf(
  "Persisted durable pre-submit cancel intent before Binance REST cancel."
);
const finalIntentResponsePersistIndex = serviceSource.indexOf(
  "orderRepository.saveIntentResponse({",
  placeFuturesOrderIndex
);
const finalCancelResponsePersistIndex = serviceSource.indexOf(
  "orderRepository.saveIntentResponse({",
  cancelFuturesOrderIndex
);
const preflightPayloadMismatchIndex = serviceSource.indexOf('code: "PREFLIGHT_PAYLOAD_MISMATCH"');
const canonicalPayloadFieldsIndex = serviceSource.indexOf("const canonicalPreflightPayloadFields = [");
const canonicalPayloadCompareIndex = serviceSource.indexOf("bound[field] !== submitPayload[field]");
const cancelTargetResolutionIndex = serviceSource.indexOf("const target = this.resolveCancelTarget(intent);");
const cancelValidationIndex = serviceSource.indexOf(
  "const validation = this.buildCancelValidation({",
  cancelTargetResolutionIndex
);
const cancelLiveDispatchIndex = serviceSource.indexOf(
  "await this.handleLiveCancelIntent(intent, target, validation);",
  cancelTargetResolutionIndex
);
const cancelRiskReducingGateIndex = serviceSource.indexOf(
  'input.target.classification === "ENTRY_PENDING_RISK_REDUCING"'
);

assert(handleIntentIndex >= 0, "handleIntent source was not found.");
assert(duplicateIndex > handleIntentIndex, "duplicate intent lookup was not found in handleIntent.");
assert(replayIndex > duplicateIndex, "duplicate replay should happen after duplicate lookup.");
assert(
  inFlightIntentLookupIndex > replayIndex,
  "in-flight intent lookup must run after final response replay branch."
);
assert(
  cancelInFlightLookupIndex > inFlightIntentLookupIndex,
  "cancel in-flight lookup must run after place in-flight lookup."
);
assert(
  decisionContextLinkIndex > inFlightIntentLookupIndex,
  "decision context guard must run after in-flight intent lookup."
);
assert(
  decisionContextLinkIndex > replayIndex,
  "decision context guard must run after duplicate replay branch."
);
assert(
  decisionContextLinkIndex < liveGateIndex,
  "decision context guard must run before live gate for new intents."
);
assert(liveGateIndex > replayIndex, "live gate must run after duplicate replay branch.");
assert(
  clientOrderIdIndex > liveGateIndex,
  "clientOrderId collision check must run after duplicate replay and live gate for new intents."
);
assert(
  placeFuturesOrderIndex > decisionContextLinkIndex,
  "decision context guard must run before placeFuturesOrder can be reached."
);
assert(
  validateBoundPreflightIndex > 0 && placeFuturesOrderIndex > validateBoundPreflightIndex,
  "bound preflight validation must run before placeFuturesOrder can be reached."
);
assert(
  preSubmitIntentAuditWriteIndex > validateBoundPreflightIndex &&
    preSubmitIntentAuditWriteIndex < placeFuturesOrderIndex,
  "durable pre-submit intent audit must occur after preflight validation and before placeFuturesOrder."
);
assert(
  preSubmitIntentRecordGateCallIndex > validateBoundPreflightIndex &&
    preSubmitIntentRecordGateCallIndex < preSubmitIntentAuditWriteIndex,
  "canonical pre-submit OrderIntent durability gate must run before the pre-submit audit."
);
assert(
  preSubmitIntentRecordWriteIndex > preSubmitIntentRecordGateCallIndex &&
    preSubmitIntentRecordReadbackIndex > preSubmitIntentRecordWriteIndex,
  "canonical pre-submit OrderIntent helper must write and then read back the record."
);
assert(
  preSubmitDurabilityFailClosedIndex > preSubmitIntentRecordGateCallIndex &&
    preSubmitDurabilityFailClosedIndex < placeFuturesOrderIndex,
  "pre-submit OrderIntent durability failure must fail closed before placeFuturesOrder."
);
assert(
  finalIntentResponsePersistIndex > placeFuturesOrderIndex,
  "final saveIntentResponse must remain after the exchange response path."
);
assert(
  cancelTargetResolutionIndex > 0 &&
    cancelValidationIndex > cancelTargetResolutionIndex &&
    cancelLiveDispatchIndex > cancelValidationIndex,
  "cancel target resolution and validation must happen before live cancel dispatch."
);
assert(
  preSubmitCancelAuditWriteIndex > cancelLiveDispatchIndex &&
    preSubmitCancelAuditWriteIndex < cancelFuturesOrderIndex,
  "durable pre-submit cancel audit must occur before cancelFuturesOrder."
);
assert(
  finalCancelResponsePersistIndex > cancelFuturesOrderIndex,
  "final cancel saveIntentResponse must remain after the exchange response path."
);
assert(rejectedReplayIndex >= 0, "order_rejected replay branch was not found.");
assert(duplicateMarkerIndex > rejectedReplayIndex, "order_rejected replay must set duplicate marker.");
assert(
  serviceSource.includes('!meta.paperMode && payload.action === "PLACE_ORDER"'),
  "non-paper PLACE_ORDER must require decision context while preserving paper behavior."
);
assert(
  serviceSource.includes('code: "NO_DECISION_CONTEXT"'),
  "missing non-paper PLACE_ORDER decisionContextId must have an explicit rejection code."
);
assert(
  serviceSource.includes('code: "DECISION_CONTEXT_NOT_FOUND"'),
  "invalid explicit decisionContextId must still reject."
);
assert(
  serviceSource.includes('context.decision !== "ENTER"'),
  "non-paper PLACE_ORDER must require an ENTER TradeDecisionContext."
);
assert(
  serviceSource.includes('code: "DECISION_CONTEXT_SYMBOL_MISMATCH"'),
  "non-paper PLACE_ORDER must reject mismatched TradeDecisionContext symbols."
);
assert(
  preflightPayloadMismatchIndex > 0,
  "payload-bound preflight mismatch must have an explicit rejection code."
);
assert(
  canonicalPayloadFieldsIndex > 0,
  "canonical preflight payload field list must be defined."
);
assert(
  canonicalPayloadCompareIndex > 0 && placeFuturesOrderIndex > canonicalPayloadCompareIndex,
  "canonical preflight payload mismatch check must run before placeFuturesOrder can be reached."
);
for (const field of [
  "paperMode",
  "symbol",
  "side",
  "orderType",
  "quantity",
  "price",
  "stopPrice",
  "stopLossPrice",
  "takeProfitPrice",
  "reduceOnly"
]) {
  assert(
    serviceSource.includes(`"${field}"`),
    `canonical preflight payload must cover ${field} mismatches.`
  );
}
assert(
  serviceSource.includes("findCanonicalPreflightPayloadMismatch"),
  "submit path must compare canonical preflight payload fields."
);
assert(
  serviceSource.includes("LIVE_TESTNET_ORDER_INTENT_SUBMITTED"),
  "non-paper PLACE_ORDER must persist a durable pre-submit intent audit event."
);
assert(
  repositorySource.includes("savePreSubmitIntentRecord") &&
    repositorySource.includes("getPreSubmitIntentRecord") &&
    repositorySource.includes("order_intent_pre_submit"),
  "order repository must expose canonical pre-submit intent write/readback helpers."
);
assert(
  serviceSource.includes("persistedBeforeSubmit") &&
    testnetLifecycleSmokeSource.includes("persistedBeforeSubmit"),
  "SG-008B lifecycle smoke must require persistedBeforeSubmit evidence."
);
assert(
  serviceSource.includes('code: "ORDER_INTENT_IN_FLIGHT"'),
  "duplicate same-intent in-flight branch must emit an explicit guard code."
);
assert(
  serviceSource.includes("LIVE_TESTNET_CANCEL_INTENT_SUBMITTED"),
  "non-paper CANCEL_ORDER must persist a durable pre-submit cancel audit event."
);
assert(
  serviceSource.includes('code: "CANCEL_INTENT_IN_FLIGHT"'),
  "duplicate cancel intent in-flight branch must emit an explicit guard code."
);
assert(
  serviceSource.includes('classification: "TERMINAL_OR_INVALID"'),
  "cancel target resolution must classify invalid or terminal targets."
);
assert(
  serviceSource.includes('classification: "PROTECTIVE_OR_RISK_INCREASING"'),
  "cancel target resolution must classify protective or risk-increasing targets."
);
assert(
  serviceSource.includes('classification: "UNKNOWN_RISK"'),
  "cancel target resolution must classify unknown-risk targets."
);
assert(
  cancelRiskReducingGateIndex > 0,
  "cancel validation must explicitly allow only entry-pending risk-reducing cancels."
);
assert(
  serviceSource.includes("Paper cancel accepted."),
  "paper cancel behavior must remain unchanged."
);

assertDecision(
  "active clientOrderId collision",
  evaluateClientOrderIdSafety({
    intentId: "intent-b",
    existingOrder: {
      intentId: "intent-a",
      status: "NEW",
      clientOrderId: "client-1"
    }
  }),
  false
);
assertDecision(
  "terminal clientOrderId reuse",
  evaluateClientOrderIdSafety({
    intentId: "intent-b",
    existingOrder: {
      intentId: "intent-a",
      status: "CANCELED",
      clientOrderId: "client-1"
    }
  }),
  true
);
assertDecision(
  "same intentId clientOrderId replay",
  evaluateClientOrderIdSafety({
    intentId: "intent-a",
    existingOrder: {
      intentId: "intent-a",
      status: "NEW",
      clientOrderId: "client-1"
    }
  }),
  true
);
assertDecision(
  "missing clientOrderId existing order",
  evaluateClientOrderIdSafety({
    intentId: "intent-a",
    existingOrder: null
  }),
  true
);

assertDecision(
  "live reduceOnly without account snapshot",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: false,
    accountPositionAvailable: false,
    side: "BUY",
    quantity: 1,
    signedPositionQuantity: -2
  }),
  false
);
assertDecision(
  "live reduceOnly without position",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: false,
    accountPositionAvailable: true,
    side: "BUY",
    quantity: 1,
    signedPositionQuantity: 0
  }),
  false
);
assertDecision(
  "BUY reduceOnly against short",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: false,
    accountPositionAvailable: true,
    side: "BUY",
    quantity: 2,
    signedPositionQuantity: -3
  }),
  true
);
assertDecision(
  "BUY reduceOnly against long",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: false,
    accountPositionAvailable: true,
    side: "BUY",
    quantity: 2,
    signedPositionQuantity: 3
  }),
  false
);
assertDecision(
  "SELL reduceOnly against long",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: false,
    accountPositionAvailable: true,
    side: "SELL",
    quantity: 2,
    signedPositionQuantity: 3
  }),
  true
);
assertDecision(
  "SELL reduceOnly against short",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: false,
    accountPositionAvailable: true,
    side: "SELL",
    quantity: 2,
    signedPositionQuantity: -3
  }),
  false
);
assertDecision(
  "reduceOnly quantity too large",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: false,
    accountPositionAvailable: true,
    side: "BUY",
    quantity: 4,
    signedPositionQuantity: -3
  }),
  false
);
assertDecision(
  "paper reduceOnly no open position",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: true,
    accountPositionAvailable: false,
    side: "SELL",
    quantity: 1,
    signedPositionQuantity: 0
  }),
  false
);
assertDecision(
  "paper reduceOnly matching position",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: true,
    accountPositionAvailable: false,
    side: "SELL",
    quantity: 1,
    signedPositionQuantity: 2
  }),
  true
);
assertDecision(
  "paper reduceOnly wrong direction",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: true,
    accountPositionAvailable: false,
    side: "BUY",
    quantity: 1,
    signedPositionQuantity: 2
  }),
  false
);
assertDecision(
  "paper reduceOnly quantity too large",
  evaluateReduceOnlyPositionSafety({
    reduceOnly: true,
    paperMode: true,
    accountPositionAvailable: false,
    side: "SELL",
    quantity: 3,
    signedPositionQuantity: 2
  }),
  false
);

const baseRiskInput = {
  paperMode: false,
  reduceOnly: false,
  orderNotional: 100,
  currentSymbolNotional: 50,
  hasCurrentSymbolPosition: true,
  openPositionsCount: 2,
  availableBalanceUsd: 500,
  accountEquityUsd: 100,
  liveRiskLimits: {
    maxOrderNotionalUsdt: { enabled: true, value: 200 },
    maxPositionNotionalUsdt: { enabled: true, value: 200 },
    maxOpenPositions: { enabled: true, value: 3 },
    maxDailyLossUsdt: { enabled: false, value: null },
    maxLeverage: { enabled: false, value: null }
  }
};

const hasRiskCheck = (
  checks: ReturnType<typeof evaluateOrderRiskSafety>,
  code: string,
  passed: boolean
): boolean => checks.some((check) => check.code === code && check.passed === passed);

let riskChecks = evaluateOrderRiskSafety(baseRiskInput);
assert(hasRiskCheck(riskChecks, "max_order_notional", true), "max order notional should pass.");
assert(hasRiskCheck(riskChecks, "max_position_notional", true), "max position notional should pass.");
assert(hasRiskCheck(riskChecks, "margin_available", true), "margin availability should pass.");
assert(!riskChecks.some((check) => check.code === "max_leverage"), "disabled max leverage should not add a check.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  orderNotional: 250
});
assert(hasRiskCheck(riskChecks, "max_order_notional", false), "max order notional should fail.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  currentSymbolNotional: 150
});
assert(hasRiskCheck(riskChecks, "max_position_notional", false), "max position notional should fail.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  hasCurrentSymbolPosition: false,
  openPositionsCount: 3
});
assert(hasRiskCheck(riskChecks, "max_open_positions", false), "max open positions should fail.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  hasCurrentSymbolPosition: false,
  openPositionsCount: 2
});
assert(hasRiskCheck(riskChecks, "max_open_positions", true), "max open positions should pass.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  availableBalanceUsd: 99
});
assert(hasRiskCheck(riskChecks, "margin_available", false), "margin availability should fail.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  availableBalanceUsd: null
});
assert(hasRiskCheck(riskChecks, "margin_available", false), "missing available balance should fail.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  liveRiskLimits: {
    ...baseRiskInput.liveRiskLimits,
    maxDailyLossUsdt: { enabled: true, value: 50 }
  },
  dailyRealizedPnl: {
    status: "AUTHORITATIVE",
    tradingDay: "2026-06-08",
    netRealizedPnl: -40,
    grossRealizedPnl: -35,
    totalCommission: 5,
    lastEventTime: Date.now()
  }
});
assert(hasRiskCheck(riskChecks, "max_daily_loss", true), "max daily loss should pass below limit.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  liveRiskLimits: {
    ...baseRiskInput.liveRiskLimits,
    maxDailyLossUsdt: { enabled: true, value: 50 }
  },
  dailyRealizedPnl: {
    status: "AUTHORITATIVE",
    tradingDay: "2026-06-08",
    netRealizedPnl: -50,
    grossRealizedPnl: -45,
    totalCommission: 5,
    lastEventTime: Date.now()
  }
});
assert(hasRiskCheck(riskChecks, "max_daily_loss", false), "max daily loss should fail at limit.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  liveRiskLimits: {
    ...baseRiskInput.liveRiskLimits,
    maxDailyLossUsdt: { enabled: true, value: 50 }
  },
  dailyRealizedPnl: {
    status: "MISSING",
    tradingDay: null,
    netRealizedPnl: null,
    grossRealizedPnl: null,
    totalCommission: null,
    lastEventTime: null
  }
});
assert(hasRiskCheck(riskChecks, "max_daily_loss", false), "missing daily pnl source should fail closed.");

const authoritativeLeverageBracket = {
  status: "AUTHORITATIVE" as const,
  fetchedAt: Date.now(),
  error: null,
  brackets: [
    {
      bracket: 1,
      initialLeverage: 10,
      notionalFloor: 0,
      notionalCap: 1_000,
      maintMarginRatio: 0.004,
      cum: 0
    }
  ]
};
const authoritativeBracket = authoritativeLeverageBracket.brackets[0]!;

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  liveRiskLimits: {
    ...baseRiskInput.liveRiskLimits,
    maxLeverage: { enabled: true, value: 5 }
  },
  leverageBracket: authoritativeLeverageBracket
});
assert(hasRiskCheck(riskChecks, "max_leverage", true), "max leverage should pass below effective cap.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  currentSymbolNotional: 500,
  liveRiskLimits: {
    ...baseRiskInput.liveRiskLimits,
    maxLeverage: { enabled: true, value: 5 }
  },
  leverageBracket: authoritativeLeverageBracket
});
assert(hasRiskCheck(riskChecks, "max_leverage", false), "max leverage should fail above configured cap.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  currentSymbolNotional: 500,
  liveRiskLimits: {
    ...baseRiskInput.liveRiskLimits,
    maxLeverage: { enabled: true, value: 20 }
  },
  leverageBracket: {
    ...authoritativeLeverageBracket,
    brackets: [
      {
        bracket: authoritativeBracket.bracket,
        initialLeverage: 5,
        notionalFloor: authoritativeBracket.notionalFloor,
        notionalCap: authoritativeBracket.notionalCap,
        maintMarginRatio: authoritativeBracket.maintMarginRatio,
        cum: authoritativeBracket.cum
      }
    ]
  }
});
assert(hasRiskCheck(riskChecks, "max_leverage", false), "max leverage should fail above exchange bracket cap.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  liveRiskLimits: {
    ...baseRiskInput.liveRiskLimits,
    maxLeverage: { enabled: true, value: 5 }
  },
  leverageBracket: {
    status: "MISSING",
    fetchedAt: null,
    error: "missing",
    brackets: []
  }
});
assert(hasRiskCheck(riskChecks, "max_leverage", false), "missing bracket should fail conservatively.");

riskChecks = evaluateOrderRiskSafety({
  ...baseRiskInput,
  liveRiskLimits: {
    ...baseRiskInput.liveRiskLimits,
    maxLeverage: { enabled: true, value: 5 }
  },
  leverageBracket: {
    ...authoritativeLeverageBracket,
    status: "STALE"
  }
});
assert(hasRiskCheck(riskChecks, "max_leverage", false), "stale bracket should fail conservatively.");

const staleSafeToAdd = buildSafeToAddResult({
  symbol: "BTCUSDT",
  direction: "long",
  side: "BUY",
  generatedAt: Date.now(),
  checks: [],
  forceStatus: "STALE"
});
assert(staleSafeToAdd.status === "STALE", "forced stale Safe-To-Add status should be preserved.");
assert(staleSafeToAdd.allowed === false, "STALE Safe-To-Add should block submit under beta policy.");

const closureEvaluatorIndex = serviceSource.indexOf("type LiveLifecycleClosureDecision");
assert(closureEvaluatorIndex > 0, "Live lifecycle closure evaluator types were not found.");
const closureEvaluatorEndIndex = serviceSource.indexOf("const mergeRiskLimits", closureEvaluatorIndex);
assert(closureEvaluatorEndIndex > closureEvaluatorIndex, "Live lifecycle closure evaluator section was not bounded.");
const closureEvaluatorSection = serviceSource.slice(closureEvaluatorIndex, closureEvaluatorEndIndex);
assert(
  closureEvaluatorSection.includes('"CAN_CLOSE"') &&
    closureEvaluatorSection.includes('"CANNOT_CLOSE"') &&
    closureEvaluatorSection.includes('"AMBIGUOUS"'),
  "closure evaluator must model CAN_CLOSE, CANNOT_CLOSE, and AMBIGUOUS decisions."
);
assert(
  !closureEvaluatorSection.includes("closePositionLifecycle"),
  "closure evaluator must not call closePositionLifecycle"
);
assert(
  !closureEvaluatorSection.includes("updatePositionLifecycle"),
  "closure evaluator must not call updatePositionLifecycle"
);
assert(
  !closureEvaluatorSection.includes("createDecisionReview"),
  "closure evaluator must not create DecisionReview"
);
assert(
  closureEvaluatorSection.includes("normalizeText(lifecycle.orderIntentId)") &&
    closureEvaluatorSection.includes("lifecycle.orderIntentId is required"),
  "closure evaluator must require lifecycle.orderIntentId"
);
assert(
  closureEvaluatorSection.includes("parsedPositionAmt !== 0") &&
    closureEvaluatorSection.includes("zero BOTH position"),
  "closure evaluator must require positionAmt == 0 for CAN_CLOSE"
);
assert(
  closureEvaluatorSection.includes('order.status === "NEW" || order.status === "PARTIALLY_FILLED"') &&
    closureEvaluatorSection.includes("Active related local order blocks closure"),
  "closure evaluator must block local active related orders"
);
assert(
  closureEvaluatorSection.includes("matchingExchangeOpenOrders.length > 0") &&
    closureEvaluatorSection.includes("Related exchange open order blocks closure"),
  "closure evaluator must block exchange open related orders"
);
assert(
  closureEvaluatorSection.includes("Exchange/lifecycle evidence is symbol-only without an orderIntentId chain.") &&
    closureEvaluatorSection.includes('"AMBIGUOUS"'),
  "closure evaluator must return AMBIGUOUS for symbol-only evidence"
);
assert(
  closureEvaluatorSection.includes('matchMethod: orderIntentId ? "orderIntentId" : null'),
  "closure evaluator must not use symbol-only matching as a closure key"
);

const closureApplyIndex = serviceSource.indexOf("private applyLiveLifecycleClosureFromRecovery");
assert(closureApplyIndex > 0, "Live lifecycle closure apply helper was not found.");
const closureApplyEndIndex = serviceSource.indexOf(
  "private async recoverLivePositionLifecyclesAuditOnly",
  closureApplyIndex
);
assert(closureApplyEndIndex > closureApplyIndex, "Live lifecycle closure apply helper was not bounded.");
const closureApplySection = serviceSource.slice(closureApplyIndex, closureApplyEndIndex);
const closureApplyCanCloseGuardIndex = closureApplySection.indexOf(
  'input.closureEvaluation.decision !== "CAN_CLOSE"'
);
const closureApplyCloseIndex = closureApplySection.indexOf(
  "positionLifecycleRepository.closePositionLifecycle"
);
const closureApplyClosedObjectIndex = closureApplySection.indexOf("if (!closed)");
const closureApplyDecisionReviewIndex = closureApplySection.indexOf(
  "this.createDecisionReviewFromClosedLifecycle(closed, input.timestamp)"
);
const closureApplyMatchGuardIndex = closureApplySection.indexOf(
  'input.closureEvaluation.matchMethod !== "orderIntentId"'
);
assert(closureApplyCloseIndex > 0, "closure apply helper must call closePositionLifecycle");
assert(
  closureApplyCanCloseGuardIndex > 0 && closureApplyCloseIndex > closureApplyCanCloseGuardIndex,
  "closePositionLifecycle must be guarded by CAN_CLOSE"
);
assert(
  closureApplySection.includes('input.closureEvaluation.decision === "AMBIGUOUS"') &&
    closureApplySection.includes('input.closureEvaluation.decision === "CANNOT_CLOSE"') &&
    closureApplySection.indexOf('input.closureEvaluation.decision === "AMBIGUOUS"') < closureApplyCloseIndex &&
    closureApplySection.indexOf('input.closureEvaluation.decision === "CANNOT_CLOSE"') < closureApplyCloseIndex,
  "closure apply helper must return before close for AMBIGUOUS and CANNOT_CLOSE"
);
assert(
  closureApplyMatchGuardIndex > 0 && closureApplyCloseIndex > closureApplyMatchGuardIndex,
  "symbol-only evidence must not reach closePositionLifecycle"
);
assert(
  closureApplySection.includes("LIVE_RECOVERY_LIFECYCLE_CLOSED"),
  "closure apply helper must emit LIVE_RECOVERY_LIFECYCLE_CLOSED audit marker"
);
assert(
  closureApplySection.includes("LIVE_RECOVERY_LIFECYCLE_CLOSE_ERROR"),
  "closure apply helper must emit a recovery close error marker on closure failure"
);
assert(
  closureApplySection.includes('eventType: "POSITION_CLOSED"'),
  "closure apply helper must append and emit POSITION_CLOSED lifecycle event"
);
assert(
  closureApplyDecisionReviewIndex > closureApplyCloseIndex &&
    closureApplyDecisionReviewIndex > closureApplyClosedObjectIndex,
  "closure apply helper must create DecisionReview only after closePositionLifecycle succeeds"
);
assert(
  closureApplyDecisionReviewIndex > closureApplyCanCloseGuardIndex &&
    closureApplySection.indexOf('input.closureEvaluation.decision === "AMBIGUOUS"') < closureApplyDecisionReviewIndex &&
    closureApplySection.indexOf('input.closureEvaluation.decision === "CANNOT_CLOSE"') < closureApplyDecisionReviewIndex,
  "closure apply helper must create DecisionReview only inside the CAN_CLOSE path"
);
assert(
  !closureApplySection.includes("upsertOrderState") &&
    !closureApplySection.includes("saveIntentResponse") &&
    !closureApplySection.includes("appendRealizedPnlLedgerEntry"),
  "closure apply helper must not mutate order state"
);
assert(
  !closureApplySection.includes("placeFuturesOrder") &&
    !closureApplySection.includes("cancelFuturesOrder"),
  "closure apply helper must not call Binance submit/cancel paths"
);

const decisionReviewHelperIndex = serviceSource.indexOf("private createDecisionReviewFromClosedLifecycle");
assert(decisionReviewHelperIndex > 0, "DecisionReview helper was not found.");
const decisionReviewHelperEndIndex = serviceSource.indexOf(
  "private fillTouchedPaperLimitOrders",
  decisionReviewHelperIndex
);
assert(decisionReviewHelperEndIndex > decisionReviewHelperIndex, "DecisionReview helper section was not bounded.");
const decisionReviewHelperSection = serviceSource.slice(
  decisionReviewHelperIndex,
  decisionReviewHelperEndIndex
);
assert(
  decisionReviewHelperSection.includes("try {") &&
    decisionReviewHelperSection.includes("decisionReviewRepository.createDecisionReviewFromLifecycle") &&
    decisionReviewHelperSection.includes("catch (error)") &&
    decisionReviewHelperSection.includes("DecisionReview creation from closed lifecycle failed"),
  "DecisionReview creation must be wrapped in a non-blocking helper"
);

const reviewLookupIndex = decisionReviewRepositorySource.indexOf("getDecisionReviewByLifecycleId");
assert(reviewLookupIndex > 0, "DecisionReview repository must expose lifecycle-id lookup.");
const reviewLookupEndIndex = decisionReviewRepositorySource.indexOf(
  "listDecisionReviewsForSymbol",
  reviewLookupIndex
);
assert(reviewLookupEndIndex > reviewLookupIndex, "DecisionReview lifecycle lookup section was not bounded.");
const reviewLookupSection = decisionReviewRepositorySource.slice(reviewLookupIndex, reviewLookupEndIndex);
assert(
  reviewLookupSection.includes("WHERE position_lifecycle_id = ?") &&
    reviewLookupSection.includes("LIMIT 1"),
  "DecisionReview lifecycle lookup must query by positionLifecycleId."
);

const reviewFromLifecycleIndex = decisionReviewRepositorySource.indexOf("createDecisionReviewFromLifecycle");
assert(reviewFromLifecycleIndex > 0, "DecisionReview lifecycle factory was not found.");
const reviewFromLifecycleEndIndex = decisionReviewRepositorySource.indexOf(
  "private selectColumns",
  reviewFromLifecycleIndex
);
assert(
  reviewFromLifecycleEndIndex > reviewFromLifecycleIndex,
  "DecisionReview lifecycle factory section was not bounded."
);
const reviewFromLifecycleSection = decisionReviewRepositorySource.slice(
  reviewFromLifecycleIndex,
  reviewFromLifecycleEndIndex
);
const existingReviewLookupIndex = reviewFromLifecycleSection.indexOf(
  "this.getDecisionReviewByLifecycleId(input.lifecycle.id)"
);
const returnExistingReviewIndex = reviewFromLifecycleSection.indexOf("return existing");
const createReviewInputIndex = reviewFromLifecycleSection.indexOf("const createInput");
const createReviewCallIndex = reviewFromLifecycleSection.indexOf("return this.createDecisionReview(createInput)");
assert(
  existingReviewLookupIndex >= 0 &&
    returnExistingReviewIndex > existingReviewLookupIndex &&
    createReviewCallIndex > returnExistingReviewIndex,
  "DecisionReview lifecycle factory must return existing lifecycle review before creating a new one."
);
assert(
  reviewFromLifecycleSection.includes("positionLifecycleId: input.lifecycle.id"),
  "DecisionReview lifecycle factory must persist positionLifecycleId from the closed lifecycle."
);
assert(
  createReviewInputIndex > returnExistingReviewIndex &&
    createReviewCallIndex > createReviewInputIndex,
  "DecisionReview lifecycle factory must create only after idempotency lookup."
);
assert(
  reviewFromLifecycleSection.includes("this.decisions.getTradeDecisionContextById") &&
    reviewFromLifecycleSection.includes("this.decisions.getTradeDecisionContextByOrderIntentId") &&
    reviewFromLifecycleSection.includes("decisionContextById ??"),
  "DecisionReview lifecycle factory must reconstruct decision context by id, then orderIntentId."
);
assert(
  reviewFromLifecycleSection.includes("unifiedSignalId") &&
    reviewFromLifecycleSection.includes("orderIntentId") &&
    reviewFromLifecycleSection.includes("marketRegime"),
  "DecisionReview lifecycle factory must reconstruct review metadata from lifecycle/decision chain."
);

const paperCloseLifecycleIndex = serviceSource.indexOf("private closePaperPositionLifecycle");
const paperCloseLifecycleEndIndex = serviceSource.indexOf(
  "private createDecisionReviewFromClosedLifecycle",
  paperCloseLifecycleIndex
);
assert(paperCloseLifecycleEndIndex > paperCloseLifecycleIndex, "paper close lifecycle section was not bounded.");
const paperCloseLifecycleSection = serviceSource.slice(
  paperCloseLifecycleIndex,
  paperCloseLifecycleEndIndex
);
assert(
  paperCloseLifecycleSection.indexOf("positionLifecycleRepository.closePositionLifecycle") <
    paperCloseLifecycleSection.indexOf("this.createDecisionReviewFromClosedLifecycle"),
  "paper DecisionReview behavior must remain after successful lifecycle close"
);

const recoveryMethodIndex = serviceSource.indexOf("private async recoverLivePositionLifecyclesAuditOnly");
assert(recoveryMethodIndex > 0, "recoverLivePositionLifecyclesAuditOnly method was not found.");

const recoveryMethodEndIndex = serviceSource.indexOf(
  "private completePaperMarketOrder",
  recoveryMethodIndex
);
assert(recoveryMethodEndIndex > recoveryMethodIndex, "recovery method section was not bounded.");
const recoveryMethodSection = serviceSource.slice(recoveryMethodIndex, recoveryMethodEndIndex);
assert(
  !recoveryMethodSection.includes("createPositionLifecycle"),
  "recovery method must not call createPositionLifecycle"
);
assert(
  !recoveryMethodSection.includes("closePositionLifecycle"),
  "recovery method must delegate closure through the gated apply helper"
);
assert(
  !recoveryMethodSection.includes("updatePositionLifecycle"),
  "recovery method must not call updatePositionLifecycle"
);
assert(
  !recoveryMethodSection.includes("createDecisionReview"),
  "recovery method must not call createDecisionReview"
);
assert(
  recoveryMethodSection.includes("LIVE_RECOVERY_SUMMARY"),
  "recovery method must emit LIVE_RECOVERY_SUMMARY audit event"
);
assert(
  recoveryMethodSection.includes("LIVE_RECOVERY_LIFECYCLE_POSITION_CLOSED"),
  "recovery method must emit LIVE_RECOVERY_LIFECYCLE_POSITION_CLOSED audit event"
);
assert(
  recoveryMethodSection.includes("LIVE_RECOVERY_LIFECYCLE_ORPHAN_NO_POSITION"),
  "recovery method must emit LIVE_RECOVERY_LIFECYCLE_ORPHAN_NO_POSITION audit event"
);
assert(
  recoveryMethodSection.includes("LIVE_RECOVERY_ORDER_NO_EXCHANGE_ORDER"),
  "recovery method must emit LIVE_RECOVERY_ORDER_NO_EXCHANGE_ORDER audit event"
);
assert(
  recoveryMethodSection.includes("LIVE_RECOVERY_EXCHANGE_ORDER_NO_LOCAL_ORDER"),
  "recovery method must emit LIVE_RECOVERY_EXCHANGE_ORDER_NO_LOCAL_ORDER audit event"
);
assert(
  recoveryMethodSection.includes("LIVE_RECOVERY_POSITION_NO_LIFECYCLE"),
  "recovery method must emit LIVE_RECOVERY_POSITION_NO_LIFECYCLE audit event"
);
assert(
  recoveryMethodSection.includes("LIVE_RECOVERY_ERROR"),
  "recovery method must emit LIVE_RECOVERY_ERROR audit event"
);
assert(
  !recoveryMethodSection.includes('matchMethod: "symbol"') ||
  recoveryMethodSection.includes("LIVE_RECOVERY_POSITION_NO_LIFECYCLE"),
  "symbol-only matching must only be used for position lifecycle mismatch detection, not for safe lifecycle creation"
);
assert(
  recoveryMethodSection.includes("generateRecoveryFingerprint"),
  "recovery method must include fingerprint generation"
);
assert(
  recoveryMethodSection.includes("recoveryRunId"),
  "recovery method must include recoveryRunId"
);
assert(
  recoveryMethodSection.includes("skippedDuplicateCount"),
  "recovery summary must include skippedDuplicateCount"
);
assert(
  recoveryMethodSection.includes("findRecentOrderAuditEventByFingerprint"),
  "recovery method must use fingerprint-based deduplication"
);
assert(
  recoveryMethodSection.includes("dedupWindowMs"),
  "recovery method must define deduplication window"
);
assert(
  recoveryMethodSection.includes("markerCountsByType"),
  "recovery method must track marker counts by type"
);
assert(
  recoveryMethodSection.includes("fingerprint"),
  "recovery markers must include fingerprint in payload"
);
assert(
  recoveryMethodSection.includes("evaluateLiveLifecycleClosure") &&
    recoveryMethodSection.includes("closureEvaluation") &&
    recoveryMethodSection.includes("closureDecisionCounts"),
  "recovery method must include closure evaluator output in audit payload"
);
const recoveryEvaluatorIndex = recoveryMethodSection.indexOf("evaluateLiveLifecycleClosure");
const recoveryCanCloseBranchIndex = recoveryMethodSection.indexOf(
  'closureEvaluation.decision === "CAN_CLOSE"'
);
const recoveryApplyIndex = recoveryMethodSection.indexOf("this.applyLiveLifecycleClosureFromRecovery");
assert(
  recoveryEvaluatorIndex > 0 &&
    recoveryCanCloseBranchIndex > recoveryEvaluatorIndex &&
    recoveryApplyIndex > recoveryCanCloseBranchIndex,
  "recovery method must call evaluator before applying closure, and only in the CAN_CLOSE branch"
);
assert(
  recoveryMethodSection.includes("LIVE_RECOVERY_LIFECYCLE_CLOSED") ||
    closureApplySection.includes("LIVE_RECOVERY_LIFECYCLE_CLOSED"),
  "recovery closure must emit LIVE_RECOVERY_LIFECYCLE_CLOSED"
);
assert(
  !recoveryMethodSection.includes("upsertOrderState") &&
    !recoveryMethodSection.includes("saveIntentResponse") &&
    !recoveryMethodSection.includes("appendRealizedPnlLedgerEntry"),
  "recovery method must not mutate order state"
);
assert(
  !recoveryMethodSection.includes("placeFuturesOrder") &&
    !recoveryMethodSection.includes("cancelFuturesOrder"),
  "recovery method must not call Binance submit/cancel paths"
);

assert(
  packageSource.includes('"check:testnet-runtime": "tsx src/safety/testnet-runtime-harness.ts"'),
  "package scripts must expose the SG-007G credential-safe testnet runtime harness"
);

assert(
  testnetRuntimeHarnessSource.includes("evaluateLiveReadiness") &&
    testnetRuntimeHarnessSource.includes("fetchFuturesAccountSnapshot") &&
    testnetRuntimeHarnessSource.includes("fetchPositionRiskSnapshot") &&
    testnetRuntimeHarnessSource.includes("getCachedLeverageBrackets") &&
    testnetRuntimeHarnessSource.includes("startUserDataStream") &&
    testnetRuntimeHarnessSource.includes("waitForPrivateWsOpen"),
  "SG-007G harness must cover readiness, account, position, leverage, listenKey, and private WS diagnostics"
);

assert(
  ![
    "placeFuturesOrder",
    "cancelFuturesOrder",
    "closePositionLifecycle",
    "updatePositionLifecycle",
    "createPositionLifecycle",
    "createDecisionReview",
    "upsertOrderState",
    "saveIntentResponse",
    "appendRealizedPnlLedgerEntry",
    "closeUserDataStream",
    "keepaliveUserDataStream",
    "../config",
    "dotenv",
    "readFileSync(",
    "fapi/v1/order?"
  ].some((token) => testnetRuntimeHarnessSource.includes(token)),
  "SG-007G harness must not import config/secrets or call order, lifecycle, review, order-state, or user-stream mutation paths"
);

assert(
  testnetRuntimeHarnessSource.includes("redact(") &&
    testnetRuntimeHarnessSource.includes('listenKey: "<redacted>"') &&
    testnetRuntimeHarnessSource.includes('apiKey: apiKey ? "<configured>" : "<missing>"') &&
    testnetRuntimeHarnessSource.includes('apiSecret: apiSecret ? "<configured>" : "<missing>"') &&
    testnetRuntimeHarnessSource.includes("printedSecrets: false") &&
    testnetRuntimeHarnessSource.includes("Unexpected diagnostic errors are intentionally not printed") &&
    !testnetRuntimeHarnessSource.includes("console.error(error"),
  "SG-007G harness output must redact credentials, listenKey, and unexpected error details"
);

assert(
  [
    "Environment classification",
    "Credential presence",
    "REST authenticated account access",
    "listenKey creation",
    "Private WS connection",
    "Account snapshot access",
    "Leverage bracket retrieval",
    "Preflight readiness inputs"
  ].every((section) => testnetRuntimeHarnessSource.includes(section)) &&
    testnetRuntimeHarnessSource.includes('type HarnessStatus = "PASS" | "FAIL"'),
  "SG-007G harness must report PASS/FAIL for each required diagnostic section"
);

assert(
  packageSource.includes('"check:testnet-preflight": "tsx src/safety/testnet-preflight-smoke.ts"'),
  "package scripts must expose the SG-008A non-mutating testnet preflight smoke"
);

assert(
  testnetPreflightSmokeSource.includes("evaluateLiveReadiness") &&
    testnetPreflightSmokeSource.includes("fetchFuturesAccountSnapshot") &&
    testnetPreflightSmokeSource.includes("fetchPositionRiskSnapshot") &&
    testnetPreflightSmokeSource.includes("getExchangeFilterMap") &&
    testnetPreflightSmokeSource.includes("getCachedLeverageBrackets") &&
    testnetPreflightSmokeSource.includes("evaluateOrderRiskSafety") &&
    testnetPreflightSmokeSource.includes("buildSafeToAddResult") &&
    testnetPreflightSmokeSource.includes('const symbol = "BTCUSDT"'),
  "SG-008A smoke must cover testnet readiness, account, position, filters, leverage, preflight checks, and Safe-To-Add for BTCUSDT"
);

const preflightPositionRiskPriceIndex = testnetPreflightSmokeSource.indexOf(
  '"positionRisk markPrice"'
);
const preflightPremiumIndexPriceIndex = testnetPreflightSmokeSource.indexOf(
  '"/fapi/v1/premiumIndex"'
);
const preflightTickerPriceIndex = testnetPreflightSmokeSource.indexOf(
  '"/fapi/v1/ticker/price"'
);
assert(
  preflightPositionRiskPriceIndex > 0 &&
    preflightPremiumIndexPriceIndex > preflightPositionRiskPriceIndex &&
    preflightTickerPriceIndex > preflightPremiumIndexPriceIndex &&
    testnetPreflightSmokeSource.includes('"premiumIndex markPrice"') &&
    testnetPreflightSmokeSource.includes('"ticker price"') &&
    testnetPreflightSmokeSource.includes("resolveMarkPrice(restBase, positions, sections)") &&
    testnetPreflightSmokeSource.includes("readiness.environment.restEnvironment === \"TESTNET\""),
  "SG-008A smoke must prefer positionRisk markPrice, then use public testnet premiumIndex markPrice, then public ticker price"
);

assert(
  ![
    "placeFuturesOrder",
    "cancelFuturesOrder",
    "startUserDataStream",
    "keepaliveUserDataStream",
    "closeUserDataStream",
    "closePositionLifecycle",
    "updatePositionLifecycle",
    "createPositionLifecycle",
    "createDecisionReview",
    "upsertOrderState",
    "saveIntentResponse",
    "appendRealizedPnlLedgerEntry",
    "orderRepository",
    "positionLifecycleRepository",
    "decisionReviewRepository",
    "BinanceOrderService",
    "better-sqlite3",
    "../config",
    "dotenv",
    "readFileSync(",
    "fapi/v1/order?"
  ].some((token) => testnetPreflightSmokeSource.includes(token)),
  "SG-008A smoke must not import config/secrets, instantiate runtime services, or call order, lifecycle, review, DB, order-state, or user-stream mutation paths"
);

assert(
  testnetPreflightSmokeSource.includes('type FinalPreflightStatus = "ACCEPTED" | "BLOCKED" | "WAIT"') &&
    testnetPreflightSmokeSource.includes("Final preflight status") &&
    testnetPreflightSmokeSource.includes("SG008_STRICT") &&
    testnetPreflightSmokeSource.includes("redact(") &&
    testnetPreflightSmokeSource.includes('apiKey: apiKey ? "<configured>" : "<missing>"') &&
    testnetPreflightSmokeSource.includes('apiSecret: apiSecret ? "<configured>" : "<missing>"') &&
    testnetPreflightSmokeSource.includes("Unexpected diagnostic errors are intentionally not printed") &&
    !testnetPreflightSmokeSource.includes("console.error(error"),
  "SG-008A smoke must report ACCEPTED/BLOCKED/WAIT and redact credentials and unexpected error details"
);

assert(
  [
    "Environment classification",
    "Credential presence",
    "Live readiness mode",
    "Account snapshot access",
    "Position snapshot access",
    "Mark price source",
    "Exchange filters",
    "Leverage bracket retrieval",
    "Preflight request evaluation",
    "Safe-To-Add result"
  ].every((section) => testnetPreflightSmokeSource.includes(section)) &&
    testnetPreflightSmokeSource.includes('type SmokeSectionStatus = "PASS" | "FAIL"'),
  "SG-008A smoke must report PASS/FAIL for each required diagnostic section"
);

assertSeededRecoveryCloseReviewPersistence();

console.log("order-safety checks passed");
