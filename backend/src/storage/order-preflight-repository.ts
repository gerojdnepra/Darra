import type Database from "better-sqlite3";
import type { OrderPreflightRecord, OrderPreflightStatus } from "../types/messages";
import type { OrderSide, OrderType } from "../types/messages";
import { getSqlite } from "./sqlite";

export interface CreateOrderPreflightInput {
  id: string;
  requestId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  normalizedQuantity?: number | null;
  price?: number | null;
  normalizedPrice?: number | null;
  notional?: number | null;
  decisionContextId?: string | null;
  createdAt: number;
  expiresAt: number;
  reason?: string | null;
}

interface OrderPreflightRow {
  id: string;
  request_id: string;
  symbol: string;
  side: string;
  type: string;
  quantity: number;
  normalized_quantity: number | null;
  price: number | null;
  normalized_price: number | null;
  notional: number | null;
  decision_context_id: string | null;
  status: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  invalidated_at: number | null;
  reason: string | null;
}

const statuses = new Set<OrderPreflightStatus>(["ACTIVE", "USED", "EXPIRED", "INVALIDATED"]);

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const normalizeSymbol = (value: string): string => value.trim().toUpperCase();

const toNullableNumber = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const toRecord = (row: OrderPreflightRow): OrderPreflightRecord => ({
  id: row.id,
  requestId: row.request_id,
  symbol: row.symbol,
  side: row.side as OrderSide,
  type: row.type as OrderType,
  quantity: row.quantity,
  normalizedQuantity: row.normalized_quantity,
  price: row.price,
  normalizedPrice: row.normalized_price,
  notional: row.notional,
  decisionContextId: row.decision_context_id,
  status: row.status as OrderPreflightStatus,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  usedAt: row.used_at,
  invalidatedAt: row.invalidated_at,
  reason: row.reason
});

export class OrderPreflightRepository {
  constructor(private readonly db: Database.Database = getSqlite()) {}

  createActivePreflight(input: CreateOrderPreflightInput): OrderPreflightRecord {
    const id = normalizeText(input.id);
    const requestId = normalizeText(input.requestId);

    if (!id) {
      throw new Error("OrderPreflight id is required.");
    }
    if (!requestId) {
      throw new Error("OrderPreflight requestId is required.");
    }

    this.db
      .prepare(
        `
          INSERT INTO order_preflights (
            id,
            request_id,
            symbol,
            side,
            type,
            quantity,
            normalized_quantity,
            price,
            normalized_price,
            notional,
            decision_context_id,
            status,
            created_at,
            expires_at,
            used_at,
            invalidated_at,
            reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, NULL, NULL, ?)
        `
      )
      .run(
        id,
        requestId,
        normalizeSymbol(input.symbol),
        input.side,
        input.type,
        input.quantity,
        toNullableNumber(input.normalizedQuantity),
        toNullableNumber(input.price),
        toNullableNumber(input.normalizedPrice),
        toNullableNumber(input.notional),
        normalizeText(input.decisionContextId),
        input.createdAt,
        input.expiresAt,
        normalizeText(input.reason)
      );

    const created = this.getById(id);
    if (!created) {
      throw new Error("OrderPreflight create failed.");
    }

    return created;
  }

  getById(id: string): OrderPreflightRecord | null {
    const normalizedId = normalizeText(id);
    if (!normalizedId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            id,
            request_id,
            symbol,
            side,
            type,
            quantity,
            normalized_quantity,
            price,
            normalized_price,
            notional,
            decision_context_id,
            status,
            created_at,
            expires_at,
            used_at,
            invalidated_at,
            reason
          FROM order_preflights
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(normalizedId) as OrderPreflightRow | undefined;

    return row ? toRecord(row) : null;
  }

  markUsed(id: string, usedAt = Date.now(), reason?: string | null): OrderPreflightRecord | null {
    const normalizedId = normalizeText(id);
    if (!normalizedId) {
      return null;
    }

    this.db
      .prepare(
        `
          UPDATE order_preflights
          SET status = 'USED',
              used_at = ?,
              reason = COALESCE(?, reason)
          WHERE id = ?
            AND status = 'ACTIVE'
        `
      )
      .run(usedAt, normalizeText(reason), normalizedId);

    return this.getById(normalizedId);
  }

  markInvalidated(
    id: string,
    invalidatedAt = Date.now(),
    reason: string
  ): OrderPreflightRecord | null {
    const normalizedId = normalizeText(id);
    const normalizedReason = normalizeText(reason);
    if (!normalizedId || !normalizedReason) {
      return null;
    }

    this.db
      .prepare(
        `
          UPDATE order_preflights
          SET status = 'INVALIDATED',
              invalidated_at = ?,
              reason = ?
          WHERE id = ?
            AND status = 'ACTIVE'
        `
      )
      .run(invalidatedAt, normalizedReason, normalizedId);

    return this.getById(normalizedId);
  }

  expireActivePreflight(
    id: string,
    now = Date.now(),
    reason = "ACTIVE preflight expired."
  ): OrderPreflightRecord | null {
    const normalizedId = normalizeText(id);
    const normalizedReason = normalizeText(reason);
    if (!normalizedId || !normalizedReason) {
      return null;
    }

    this.db
      .prepare(
        `
          UPDATE order_preflights
          SET status = 'EXPIRED',
              reason = ?
          WHERE id = ?
            AND status = 'ACTIVE'
            AND expires_at <= ?
        `
      )
      .run(normalizedReason, normalizedId, now);

    return this.getById(normalizedId);
  }

  expireExpiredActivePreflights(
    now = Date.now(),
    reason = "ACTIVE preflight expired during startup cleanup."
  ): number {
    const normalizedReason = normalizeText(reason);
    if (!normalizedReason) {
      throw new Error("Expire reason is required.");
    }

    const result = this.db
      .prepare(
        `
          UPDATE order_preflights
          SET status = 'EXPIRED',
              reason = ?
          WHERE status = 'ACTIVE'
            AND expires_at <= ?
        `
      )
      .run(normalizedReason, now);

    return result.changes;
  }

  listByIds(ids: string[]): OrderPreflightRecord[] {
    const normalizedIds = Array.from(
      new Set(ids.map((id) => normalizeText(id)).filter((id): id is string => id !== null))
    );
    if (normalizedIds.length === 0) {
      return [];
    }

    const placeholders = normalizedIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            request_id,
            symbol,
            side,
            type,
            quantity,
            normalized_quantity,
            price,
            normalized_price,
            notional,
            decision_context_id,
            status,
            created_at,
            expires_at,
            used_at,
            invalidated_at,
            reason
          FROM order_preflights
          WHERE id IN (${placeholders})
        `
      )
      .all(...normalizedIds) as OrderPreflightRow[];

    return rows
      .map(toRecord)
      .filter((record) => statuses.has(record.status))
      .sort((left, right) => left.createdAt - right.createdAt);
  }
}

export const orderPreflightRepository = new OrderPreflightRepository();
