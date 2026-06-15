import type Database from "better-sqlite3";
import type { TradeDecisionContext } from "../types/messages";
import { getSqlite } from "./sqlite";

export type TradeDecisionSource = "manual" | "signal_inbox" | "trading_ticket" | "system";
export type TradeDecisionStatus = "draft" | "committed" | "linked_to_order" | "reviewed";

export interface CreateTradeDecisionContextInput {
  id: string;
  unifiedSignalId?: string | null | undefined;
  symbol: string;
  decision: TradeDecisionContext["decision"];
  decisionReason?: string | null | undefined;
  riskSnapshotRef?: string | null | undefined;
  preflightId?: string | null | undefined;
  preflightNonce?: string | null | undefined;
  orderIntentId?: string | null | undefined;
  reviewCorrelationId?: string | null | undefined;
  source: TradeDecisionSource;
  status?: TradeDecisionStatus | undefined;
  createdAt?: number | undefined;
  updatedAt?: number | null | undefined;
  payload?: unknown;
}

interface TradeDecisionContextRow {
  id: string;
  unified_signal_id: string | null;
  symbol: string;
  decision: string;
  decision_reason: string | null;
  risk_snapshot_ref: string | null;
  preflight_id: string | null;
  preflight_nonce: string | null;
  order_intent_id: string | null;
  review_correlation_id: string | null;
  source: string;
  status: string;
  created_at: number;
  updated_at: number | null;
  payload_json: string | null;
}

const decisions = new Set<TradeDecisionContext["decision"]>(["ENTER", "WAIT", "SKIP"]);
const sources = new Set<TradeDecisionSource>(["manual", "signal_inbox", "trading_ticket", "system"]);
const statuses = new Set<TradeDecisionStatus>(["draft", "committed", "linked_to_order", "reviewed"]);
const maxPayloadJsonBytes = 32 * 1024;

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const normalizeSymbol = (value: string): string => value.trim().toUpperCase();

const parsePayload = (value: string | null): unknown => {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};

const readRecordPath = (value: unknown, path: string[]): unknown => {
  let current = value;

  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return current;
};

const readNumber = (value: unknown, path: string[]): number | undefined => {
  const candidate = readRecordPath(value, path);
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
};

const readString = (value: unknown, path: string[]): string | undefined => {
  const candidate = readRecordPath(value, path);
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
};

const serializeBoundedPayload = (payload: unknown): string | null => {
  if (payload === undefined || payload === null) {
    return null;
  }

  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json, "utf8") > maxPayloadJsonBytes) {
    throw new Error("TradeDecisionContext payload_json exceeds 32KB.");
  }

  return json;
};

const toTradeDecisionContext = (row: TradeDecisionContextRow): TradeDecisionContext => {
  const payload = parsePayload(row.payload_json);
  const marketRegime =
    readString(payload, ["decisionQuality", "marketRegime"]) ??
    readString(payload, ["signal", "marketRegime"]);
  const signalConfidence = readNumber(payload, ["decisionQuality", "signalConfidence"]);
  const signalStability = readNumber(payload, ["decisionQuality", "signalStability"]);
  const rawDecisionStrength = readString(payload, ["decisionQuality", "decisionStrength"]);
  const decisionStrength: TradeDecisionContext["decisionStrength"] | null =
    rawDecisionStrength === "WEAK" ||
    rawDecisionStrength === "NORMAL" ||
    rawDecisionStrength === "STRONG"
      ? rawDecisionStrength
      : null;
  const decisionQualityScore = readNumber(payload, ["decisionQuality", "decisionQualityScore"]);

  return {
    id: row.id,
    unifiedSignalId: row.unified_signal_id,
    signalId: row.unified_signal_id,
    symbol: row.symbol,
    decision: row.decision as TradeDecisionContext["decision"],
    decisionReason: row.decision_reason,
    riskSnapshotRef: row.risk_snapshot_ref,
    preflightId: row.preflight_id,
    preflightNonce: row.preflight_nonce,
    orderIntentId: row.order_intent_id,
    reviewCorrelationId: row.review_correlation_id,
    source: row.source as TradeDecisionContext["source"],
    status: row.status as TradeDecisionContext["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(marketRegime ? { marketRegime } : {}),
    ...(signalConfidence !== undefined ? { signalConfidence } : {}),
    ...(signalStability !== undefined ? { signalStability } : {}),
    ...(decisionStrength ? { decisionStrength } : {}),
    ...(decisionQualityScore !== undefined ? { decisionQualityScore } : {}),
    payload
  };
};

export class TradeDecisionRepository {
  constructor(private readonly db: Database.Database = getSqlite()) {}

  createTradeDecisionContext(input: CreateTradeDecisionContextInput): TradeDecisionContext {
    const id = normalizeText(input.id);
    const symbol = normalizeSymbol(input.symbol);
    const now = Date.now();
    const createdAt =
      typeof input.createdAt === "number" && Number.isFinite(input.createdAt)
        ? input.createdAt
        : now;
    const status = input.status ?? "committed";

    if (!id) {
      throw new Error("TradeDecisionContext id is required.");
    }
    if (!symbol) {
      throw new Error("TradeDecisionContext symbol is required.");
    }
    if (!decisions.has(input.decision)) {
      throw new Error("TradeDecisionContext decision must be ENTER, WAIT or SKIP.");
    }
    if (!sources.has(input.source)) {
      throw new Error("TradeDecisionContext source is invalid.");
    }
    if (!statuses.has(status)) {
      throw new Error("TradeDecisionContext status is invalid.");
    }

    this.db
      .prepare(
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
      )
      .run(
        id,
        normalizeText(input.unifiedSignalId),
        symbol,
        input.decision,
        normalizeText(input.decisionReason),
        normalizeText(input.riskSnapshotRef),
        normalizeText(input.preflightId),
        normalizeText(input.preflightNonce),
        normalizeText(input.orderIntentId),
        normalizeText(input.reviewCorrelationId),
        input.source,
        status,
        createdAt,
        typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt)
          ? input.updatedAt
          : null,
        serializeBoundedPayload(input.payload)
      );

    const created = this.getTradeDecisionContextById(id);
    if (!created) {
      throw new Error("TradeDecisionContext create failed.");
    }

    return created;
  }

  getTradeDecisionContextById(id: string): TradeDecisionContext | null {
    const normalizedId = normalizeText(id);
    if (!normalizedId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
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
          FROM trade_decision_contexts
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(normalizedId) as TradeDecisionContextRow | undefined;

    return row ? toTradeDecisionContext(row) : null;
  }

  getTradeDecisionContextByOrderIntentId(orderIntentId: string): TradeDecisionContext | null {
    const normalizedOrderIntentId = normalizeText(orderIntentId);
    if (!normalizedOrderIntentId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
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
          FROM trade_decision_contexts
          WHERE order_intent_id = ?
          ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC
          LIMIT 1
        `
      )
      .get(normalizedOrderIntentId) as TradeDecisionContextRow | undefined;

    return row ? toTradeDecisionContext(row) : null;
  }

  listTradeDecisionContextsForSymbol(symbol: string, limit = 50): TradeDecisionContext[] {
    const normalizedSymbol = normalizeSymbol(symbol);
    if (!normalizedSymbol) {
      return [];
    }
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const rows = this.db
      .prepare(
        `
          SELECT
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
          FROM trade_decision_contexts
          WHERE symbol = ?
          ORDER BY created_at DESC
          LIMIT ?
        `
      )
      .all(normalizedSymbol, normalizedLimit) as TradeDecisionContextRow[];

    return rows.map(toTradeDecisionContext);
  }

  linkTradeDecisionContextToOrder(input: {
    id: string;
    orderIntentId: string;
    reviewCorrelationId?: string | null;
    updatedAt?: number;
  }): TradeDecisionContext | null {
    const id = normalizeText(input.id);
    const orderIntentId = normalizeText(input.orderIntentId);
    if (!id || !orderIntentId) {
      throw new Error("TradeDecisionContext link requires id and orderIntentId.");
    }

    const updatedAt =
      typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt)
        ? input.updatedAt
        : Date.now();

    this.db
      .prepare(
        `
          UPDATE trade_decision_contexts
          SET
            order_intent_id = ?,
            review_correlation_id = COALESCE(?, review_correlation_id),
            status = 'linked_to_order',
            updated_at = ?
          WHERE id = ?
        `
      )
      .run(orderIntentId, normalizeText(input.reviewCorrelationId), updatedAt, id);

    return this.getTradeDecisionContextById(id);
  }

  updateTradeDecisionContextStatus(input: {
    id: string;
    status: TradeDecisionStatus;
    updatedAt?: number;
  }): TradeDecisionContext | null {
    const id = normalizeText(input.id);
    if (!id) {
      throw new Error("TradeDecisionContext status update requires id.");
    }
    if (!statuses.has(input.status)) {
      throw new Error("TradeDecisionContext status is invalid.");
    }

    const updatedAt =
      typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt)
        ? input.updatedAt
        : Date.now();

    this.db
      .prepare(
        `
          UPDATE trade_decision_contexts
          SET status = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(input.status, updatedAt, id);

    return this.getTradeDecisionContextById(id);
  }
}

export const tradeDecisionRepository = new TradeDecisionRepository();
