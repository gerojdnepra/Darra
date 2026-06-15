import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getSqlite } from "./sqlite";

export interface RecoveryAuditEventPayload<T = unknown> {
  auditId: string;
  eventType: string;
  fingerprint: string;
  timestamp: number;
  symbol: string | null;
  orderId: string | null;
  intentId: string | null;
  lifecycleId: string | null;
  decisionContextId: string | null;
  reviewId: string | null;
  clientOrderId: string | null;
  exchangeOrderId: string | null;
  message: string | null;
  payload: T | null;
}

interface RecoveryAuditRow {
  id: string;
  event_type: string;
  fingerprint: string;
  timestamp: number;
  symbol: string | null;
  order_id: string | null;
  intent_id: string | null;
  lifecycle_id: string | null;
  decision_context_id: string | null;
  review_id: string | null;
  client_order_id: string | null;
  exchange_order_id: string | null;
  message: string | null;
  payload_json: string | null;
}

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const normalizeSymbol = (value: string | null | undefined): string | null => {
  const normalized = value?.trim().toUpperCase();
  return normalized ? normalized : null;
};

const parseJson = <T>(value: string | null): T | null => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const toRecoveryAuditEvent = <T>(row: RecoveryAuditRow): RecoveryAuditEventPayload<T> => ({
  auditId: row.id,
  eventType: row.event_type,
  fingerprint: row.fingerprint,
  timestamp: row.timestamp,
  symbol: row.symbol,
  orderId: row.order_id,
  intentId: row.intent_id,
  lifecycleId: row.lifecycle_id,
  decisionContextId: row.decision_context_id,
  reviewId: row.review_id,
  clientOrderId: row.client_order_id,
  exchangeOrderId: row.exchange_order_id,
  message: row.message,
  payload: parseJson<T>(row.payload_json)
});

export class RecoveryAuditRepository {
  constructor(private readonly db: Database.Database = getSqlite()) {}

  appendRecoveryAuditEvent(input: {
    eventType: string;
    fingerprint: string;
    timestamp?: number;
    symbol?: string | null;
    orderId?: string | null;
    intentId?: string | null;
    lifecycleId?: string | null;
    decisionContextId?: string | null;
    reviewId?: string | null;
    clientOrderId?: string | null;
    exchangeOrderId?: string | null;
    message?: string | null;
    payload?: unknown;
  }): RecoveryAuditEventPayload {
    const eventType = normalizeText(input.eventType);
    const fingerprint = normalizeText(input.fingerprint);

    if (!eventType) {
      throw new Error("RecoveryAuditEvent eventType is required.");
    }
    if (!fingerprint) {
      throw new Error("RecoveryAuditEvent fingerprint is required.");
    }

    const auditId = randomUUID();
    const timestamp = input.timestamp ?? Date.now();

    this.db
      .prepare(
        `
          INSERT INTO recovery_audit_events (
            id,
            event_type,
            fingerprint,
            timestamp,
            symbol,
            order_id,
            intent_id,
            lifecycle_id,
            decision_context_id,
            review_id,
            client_order_id,
            exchange_order_id,
            message,
            payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        auditId,
        eventType,
        fingerprint,
        timestamp,
        normalizeSymbol(input.symbol),
        normalizeText(input.orderId),
        normalizeText(input.intentId),
        normalizeText(input.lifecycleId),
        normalizeText(input.decisionContextId),
        normalizeText(input.reviewId),
        normalizeText(input.clientOrderId),
        normalizeText(input.exchangeOrderId),
        normalizeText(input.message),
        JSON.stringify(input.payload ?? null)
      );

    const row = this.db
      .prepare(
        `
          SELECT
            id,
            event_type,
            fingerprint,
            timestamp,
            symbol,
            order_id,
            intent_id,
            lifecycle_id,
            decision_context_id,
            review_id,
            client_order_id,
            exchange_order_id,
            message,
            payload_json
          FROM recovery_audit_events
          WHERE id = ?
        `
      )
      .get(auditId) as RecoveryAuditRow | undefined;

    if (!row) {
      throw new Error("RecoveryAuditEvent create failed.");
    }

    return toRecoveryAuditEvent(row);
  }

  findRecentRecoveryAuditEventByFingerprint<T = unknown>(
    eventType: string,
    fingerprint: string,
    sinceMs: number
  ): RecoveryAuditEventPayload<T> | null {
    const normalizedEventType = normalizeText(eventType);
    const normalizedFingerprint = normalizeText(fingerprint);

    if (!normalizedEventType || !normalizedFingerprint) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            id,
            event_type,
            fingerprint,
            timestamp,
            symbol,
            order_id,
            intent_id,
            lifecycle_id,
            decision_context_id,
            review_id,
            client_order_id,
            exchange_order_id,
            message,
            payload_json
          FROM recovery_audit_events
          WHERE event_type = ?
            AND fingerprint = ?
            AND timestamp >= ?
          ORDER BY timestamp DESC
          LIMIT 1
        `
      )
      .get(normalizedEventType, normalizedFingerprint, Date.now() - sinceMs) as
      | RecoveryAuditRow
      | undefined;

    return row ? toRecoveryAuditEvent<T>(row) : null;
  }

  listRecentRecoveryAuditEvents(limit = 50): RecoveryAuditEventPayload[] {
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            event_type,
            fingerprint,
            timestamp,
            symbol,
            order_id,
            intent_id,
            lifecycle_id,
            decision_context_id,
            review_id,
            client_order_id,
            exchange_order_id,
            message,
            payload_json
          FROM recovery_audit_events
          ORDER BY timestamp DESC, id DESC
          LIMIT ?
        `
      )
      .all(normalizedLimit) as RecoveryAuditRow[];

    return rows.map((row) => toRecoveryAuditEvent(row));
  }
}

export const recoveryAuditRepository = new RecoveryAuditRepository();
