import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  ExecutionContractValidator
} from "../execution/execution-contract-validator";
import type { PositionLifecycle, PositionLifecycleEvent } from "../types/messages";
import { getSqlite } from "./sqlite";

export type PositionLifecycleStatus =
  | "OPENING"
  | "OPEN"
  | "MANAGING"
  | "CLOSING"
  | "CLOSED"
  | "REJECTED"
  | "ERROR";

export type PositionLifecycleEventType =
  | "CREATED"
  | "ORDER_SUBMITTED"
  | "ORDER_FILLED"
  | "POSITION_OPENED"
  | "POSITION_UPDATED"
  | "POSITION_REDUCED"
  | "POSITION_CLOSING"
  | "POSITION_CLOSED"
  | "PNL_REALIZED"
  | "POSITION_STOP_LOSS_TRIGGERED"
  | "POSITION_TAKE_PROFIT_TRIGGERED"
  | "MANUAL_CLOSE"
  | "ERROR";

export interface CreatePositionLifecycleInput {
  writerAuthority?: unknown;
  id?: string;
  symbol: string;
  orderIntentId?: string | null;
  decisionContextId?: string | null;
  unifiedSignalId?: string | null;
  status?: PositionLifecycleStatus;
  openedAt?: number | null;
  createdAt?: number;
}

export interface UpdatePositionLifecycleInput {
  writerAuthority?: unknown;
  id: string;
  status?: PositionLifecycleStatus;
  openedAt?: number | null;
  closedAt?: number | null;
  updatedAt?: number;
}

export interface AppendLifecycleEventInput {
  writerAuthority?: unknown;
  lifecycleId: string;
  eventType: PositionLifecycleEventType;
  timestamp?: number;
  payload?: unknown;
}

interface PositionLifecycleRow {
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

interface PositionLifecycleEventRow {
  id: string;
  lifecycle_id: string;
  event_type: string;
  timestamp: number;
  event_seq: number | null;
  payload_json: string | null;
}

const statuses = new Set<PositionLifecycleStatus>([
  "OPENING",
  "OPEN",
  "MANAGING",
  "CLOSING",
  "CLOSED",
  "REJECTED",
  "ERROR"
]);

const eventTypes = new Set<PositionLifecycleEventType>([
  "CREATED",
  "ORDER_SUBMITTED",
  "ORDER_FILLED",
  "POSITION_OPENED",
  "POSITION_UPDATED",
  "POSITION_REDUCED",
  "POSITION_CLOSING",
  "POSITION_CLOSED",
  "PNL_REALIZED",
  "POSITION_STOP_LOSS_TRIGGERED",
  "POSITION_TAKE_PROFIT_TRIGGERED",
  "MANUAL_CLOSE",
  "ERROR"
]);

const maxPayloadJsonBytes = 32 * 1024;

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const normalizeSymbol = (value: string): string => value.trim().toUpperCase();

const toNullableNumber = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

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

const serializeBoundedPayload = (payload: unknown): string | null => {
  if (payload === undefined || payload === null) {
    return null;
  }

  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json, "utf8") > maxPayloadJsonBytes) {
    throw new Error("PositionLifecycleEvent payload_json exceeds 32KB.");
  }

  return json;
};

const toPositionLifecycle = (row: PositionLifecycleRow): PositionLifecycle => ({
  id: row.id,
  symbol: row.symbol,
  orderIntentId: row.order_intent_id,
  decisionContextId: row.decision_context_id,
  unifiedSignalId: row.unified_signal_id,
  status: row.status as PositionLifecycle["status"],
  openedAt: row.opened_at,
  closedAt: row.closed_at,
  updatedAt: row.updated_at,
  eventRefs: listLifecycleEventIds(row.id)
});

const toPositionLifecycleEvent = (row: PositionLifecycleEventRow): PositionLifecycleEvent => ({
  id: row.id,
  lifecycleId: row.lifecycle_id,
  eventType: row.event_type as PositionLifecycleEventType,
  timestamp: row.timestamp,
  eventSeq: row.event_seq,
  payload: parsePayload(row.payload_json)
});

const listLifecycleEventIds = (lifecycleId: string): string[] => {
  const db = getSqlite();
  const rows = db
    .prepare(
      `
        SELECT id
        FROM position_lifecycle_events
        WHERE lifecycle_id = ?
        ORDER BY timestamp ASC, event_seq ASC, id ASC
      `
    )
    .all(lifecycleId) as Array<{ id: string }>;
  return rows.map((row) => row.id);
};

export class PositionLifecycleRepository {
  constructor(
    private readonly db: Database.Database = getSqlite(),
    private readonly contractValidator: ExecutionContractValidator = new ExecutionContractValidator()
  ) {}

  createPositionLifecycle(input: CreatePositionLifecycleInput): PositionLifecycle {
    this.contractValidator.assertLifecycleWriterAuthority(input.writerAuthority, {
      operation: "createPositionLifecycle",
      input: {
        ...input,
        writerAuthority: input.writerAuthority ? "provided" : "missing"
      }
    });

    const id = input.id ?? randomUUID();
    const symbol = normalizeSymbol(input.symbol);
    const now = Date.now();
    const createdAt = input.createdAt ?? now;
    const status = input.status ?? "OPENING";
    const openedAt = toNullableNumber(input.openedAt);

    if (!id) {
      throw new Error("PositionLifecycle id is required.");
    }
    if (!symbol) {
      throw new Error("PositionLifecycle symbol is required.");
    }
    if (!statuses.has(status)) {
      throw new Error("PositionLifecycle status is invalid.");
    }

    this.db
      .prepare(
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
      )
      .run(
        id,
        symbol,
        normalizeText(input.orderIntentId),
        normalizeText(input.decisionContextId),
        normalizeText(input.unifiedSignalId),
        status,
        openedAt,
        null,
        now,
        createdAt
      );

    const created = this.getPositionLifecycleById(id);
    if (!created) {
      throw new Error("PositionLifecycle create failed.");
    }

    return created;
  }

  updatePositionLifecycle(input: UpdatePositionLifecycleInput): PositionLifecycle | null {
    this.contractValidator.assertLifecycleWriterAuthority(input.writerAuthority, {
      operation: "updatePositionLifecycle",
      input: {
        ...input,
        writerAuthority: input.writerAuthority ? "provided" : "missing"
      }
    });

    const existing = this.getPositionLifecycleById(input.id);

    if (!existing) {
      return null;
    }

    const now = input.updatedAt ?? Date.now();
    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (input.status !== undefined) {
      if (!statuses.has(input.status)) {
        throw new Error("PositionLifecycle status is invalid.");
      }
      updates.push("status = ?");
      values.push(input.status);
    }

    if (input.openedAt !== undefined) {
      updates.push("opened_at = ?");
      values.push(toNullableNumber(input.openedAt));
    }

    if (input.closedAt !== undefined) {
      updates.push("closed_at = ?");
      values.push(toNullableNumber(input.closedAt));
    }

    updates.push("updated_at = ?");
    values.push(now);

    if (updates.length === 0) {
      return existing;
    }

    values.push(input.id);

    this.db
      .prepare(
        `
          UPDATE position_lifecycles
          SET ${updates.join(", ")}
          WHERE id = ?
        `
      )
      .run(...values);

    return this.getPositionLifecycleById(input.id);
  }

  closePositionLifecycle(input: {
    writerAuthority?: unknown;
    id: string;
    closedAt?: number;
  }): PositionLifecycle | null {
    const updateInput: UpdatePositionLifecycleInput = {
      id: input.id,
      status: "CLOSED",
      closedAt: input.closedAt ?? Date.now()
    };

    if (input.writerAuthority !== undefined) {
      updateInput.writerAuthority = input.writerAuthority;
    }

    return this.updatePositionLifecycle(updateInput);
  }

  getPositionLifecycleById(id: string): PositionLifecycle | null {
    const normalizedId = normalizeText(id);
    if (!normalizedId) {
      return null;
    }

    const row = this.db
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
      .get(normalizedId) as PositionLifecycleRow | undefined;

    return row ? toPositionLifecycle(row) : null;
  }

  getPositionLifecycleByOrderIntentId(orderIntentId: string): PositionLifecycle | null {
    const normalizedOrderIntentId = normalizeText(orderIntentId);
    if (!normalizedOrderIntentId) {
      return null;
    }

    const row = this.db
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
          WHERE order_intent_id = ?
          LIMIT 1
        `
      )
      .get(normalizedOrderIntentId) as PositionLifecycleRow | undefined;

    return row ? toPositionLifecycle(row) : null;
  }

  getPositionLifecycleByDecisionContextId(decisionContextId: string): PositionLifecycle | null {
    const normalizedDecisionContextId = normalizeText(decisionContextId);
    if (!normalizedDecisionContextId) {
      return null;
    }

    const row = this.db
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
          WHERE decision_context_id = ?
          LIMIT 1
        `
      )
      .get(normalizedDecisionContextId) as PositionLifecycleRow | undefined;

    return row ? toPositionLifecycle(row) : null;
  }

  listPositionLifecyclesBySymbol(symbol: string, limit = 50): PositionLifecycle[] {
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
          WHERE symbol = ?
          ORDER BY created_at DESC
          LIMIT ?
        `
      )
      .all(normalizedSymbol, normalizedLimit) as PositionLifecycleRow[];

    return rows.map(toPositionLifecycle);
  }

  listOpenPositionLifecycles(limit = 50): PositionLifecycle[] {
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const rows = this.db
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
          WHERE status IN ('OPENING', 'OPEN', 'MANAGING', 'CLOSING')
          ORDER BY opened_at DESC
          LIMIT ?
        `
      )
      .all(normalizedLimit) as PositionLifecycleRow[];

    return rows.map(toPositionLifecycle);
  }

  appendLifecycleEvent(input: AppendLifecycleEventInput): PositionLifecycleEvent {
    this.contractValidator.assertLifecycleWriterAuthority(input.writerAuthority, {
      operation: "appendLifecycleEvent",
      input: {
        ...input,
        writerAuthority: input.writerAuthority ? "provided" : "missing"
      }
    });

    const id = randomUUID();
    const lifecycleId = normalizeText(input.lifecycleId);
    const timestamp = input.timestamp ?? Date.now();

    if (!lifecycleId) {
      throw new Error("PositionLifecycleEvent lifecycleId is required.");
    }
    if (!eventTypes.has(input.eventType)) {
      throw new Error("PositionLifecycleEvent eventType is invalid.");
    }

    const lifecycle = this.getPositionLifecycleById(lifecycleId);
    if (!lifecycle) {
      throw new Error("PositionLifecycle not found for event.");
    }

    const eventSeq = this.nextLifecycleEventSeq(lifecycleId);

    this.db
      .prepare(
        `
          INSERT INTO position_lifecycle_events (
            id,
            lifecycle_id,
            event_type,
            timestamp,
            event_seq,
            payload_json
          ) VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        id,
        lifecycleId,
        input.eventType,
        timestamp,
        eventSeq,
        serializeBoundedPayload(input.payload)
      );

    const created = this.getLifecycleEventById(id);
    if (!created) {
      throw new Error("PositionLifecycleEvent create failed.");
    }

    return created;
  }

  getLifecycleEventById(id: string): PositionLifecycleEvent | null {
    const normalizedId = normalizeText(id);
    if (!normalizedId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            id,
            lifecycle_id,
            event_type,
            timestamp,
            event_seq,
            payload_json
          FROM position_lifecycle_events
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(normalizedId) as PositionLifecycleEventRow | undefined;

    return row ? toPositionLifecycleEvent(row) : null;
  }

  listLifecycleEvents(lifecycleId: string, limit = 100): PositionLifecycleEvent[] {
    const normalizedLifecycleId = normalizeText(lifecycleId);
    if (!normalizedLifecycleId) {
      return [];
    }
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 1000);
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            lifecycle_id,
            event_type,
            timestamp,
            event_seq,
            payload_json
          FROM position_lifecycle_events
          WHERE lifecycle_id = ?
          ORDER BY timestamp ASC, event_seq ASC, id ASC
          LIMIT ?
        `
      )
      .all(normalizedLifecycleId, normalizedLimit) as PositionLifecycleEventRow[];

    return rows.map(toPositionLifecycleEvent);
  }

  private nextLifecycleEventSeq(lifecycleId: string): number {
    const maxSeq = this.db
      .prepare(
        `
          SELECT COALESCE(MAX(event_seq), 0)
          FROM position_lifecycle_events
          WHERE lifecycle_id = ?
        `
      )
      .pluck()
      .get(lifecycleId) as number | null;

    return (maxSeq ?? 0) + 1;
  }
}

export const positionLifecycleRepository = new PositionLifecycleRepository();
