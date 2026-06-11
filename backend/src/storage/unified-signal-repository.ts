import type Database from "better-sqlite3";
import type { UnifiedSignalEvent } from "../types/messages";
import { getSqlite } from "./sqlite";

const PAYLOAD_JSON_MAX_BYTES = 32 * 1024;

export interface UnifiedSignalRecord {
  id: string;
  source: UnifiedSignalEvent["source"];
  sourceId: string | null;
  symbol: string | null;
  kind: string;
  bias: string | null;
  severity: string | null;
  rankScore: number | null;
  noiseClass: UnifiedSignalEvent["noiseClass"] | null;
  ttlSec: number | null;
  reason: string | null;
  createdAt: number;
  expiresAt: number | null;
  payload?: unknown;
}

interface UnifiedSignalRow {
  id: string;
  source: string;
  source_id: string | null;
  symbol: string | null;
  kind: string;
  bias: string | null;
  severity: string | null;
  rank_score: number | null;
  noise_class: string | null;
  ttl_sec: number | null;
  reason: string | null;
  created_at: number;
  expires_at: number | null;
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

const stringifyPayload = (payload: unknown): string | null => {
  if (payload === undefined || payload === null) {
    return null;
  }

  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json, "utf8") > PAYLOAD_JSON_MAX_BYTES) {
    throw new Error("UnifiedSignal payload_json exceeds 32KB.");
  }

  return json;
};

const toRecord = (row: UnifiedSignalRow): UnifiedSignalRecord => ({
  id: row.id,
  source: row.source as UnifiedSignalEvent["source"],
  sourceId: row.source_id,
  symbol: row.symbol,
  kind: row.kind,
  bias: row.bias,
  severity: row.severity,
  rankScore: row.rank_score,
  noiseClass: row.noise_class as UnifiedSignalEvent["noiseClass"] | null,
  ttlSec: row.ttl_sec,
  reason: row.reason,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  payload: parsePayload(row.payload_json)
});

const toPayload = (signal: UnifiedSignalEvent): unknown => ({
  title: signal.title,
  description: signal.description,
  direction: signal.direction,
  priority: signal.priority,
  suppress: signal.suppress,
  suppressReason: signal.suppressReason,
  tags: signal.tags,
  liveVisibility: signal.liveVisibility,
  mergeKey: signal.mergeKey,
  rawRef: signal.rawRef
});

const asPayloadRecord = (payload: unknown): Record<string, unknown> | null =>
  typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;

const isRawRef = (value: unknown): value is UnifiedSignalEvent["rawRef"] => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const rawRef = value as Record<string, unknown>;
  return (
    (rawRef.collection === "alerts" ||
      rawRef.collection === "volumeMilestones" ||
      rawRef.collection === "volumeThresholdMilestones") &&
    typeof rawRef.id === "string" &&
    rawRef.id.trim().length > 0
  );
};

const toUnifiedSignalEvent = (record: UnifiedSignalRecord): UnifiedSignalEvent | null => {
  const payload = asPayloadRecord(record.payload);
  const title = typeof payload?.title === "string" ? normalizeText(payload.title) : null;
  const mergeKey = typeof payload?.mergeKey === "string" ? normalizeText(payload.mergeKey) : null;
  const rawRef = isRawRef(payload?.rawRef) ? payload.rawRef : null;

  if (!record.sourceId || !record.symbol || !title || !mergeKey || !rawRef) {
    return null;
  }

  return {
    id: record.id,
    source: record.source,
    sourceId: record.sourceId,
    symbol: record.symbol,
    kind: record.kind,
    ...(record.bias ? { bias: record.bias } : {}),
    ...(typeof payload?.direction === "string" ? { direction: payload.direction } : {}),
    title,
    ...(typeof payload?.description === "string" ? { description: payload.description } : {}),
    ...(record.severity ? { severity: record.severity } : {}),
    ...(typeof payload?.priority === "string" ? { priority: payload.priority } : {}),
    ...(record.rankScore !== null ? { rankScore: record.rankScore } : {}),
    ...(typeof payload?.suppress === "boolean" ? { suppress: payload.suppress } : {}),
    ...(typeof payload?.suppressReason === "string" ? { suppressReason: payload.suppressReason } : {}),
    ...(record.ttlSec !== null ? { ttlSec: record.ttlSec } : {}),
    ...(Array.isArray(payload?.tags)
      ? { tags: payload.tags.filter((tag): tag is string => typeof tag === "string") }
      : {}),
    ...(payload?.liveVisibility === "PRIMARY" ||
    payload?.liveVisibility === "REVIEW" ||
    payload?.liveVisibility === "HIDDEN"
      ? { liveVisibility: payload.liveVisibility }
      : {}),
    ...(record.noiseClass ? { noiseClass: record.noiseClass } : {}),
    createdAt: record.createdAt,
    ...(record.expiresAt !== null ? { expiresAt: record.expiresAt } : {}),
    mergeKey,
    rawRef
  };
};

export class UnifiedSignalRepository {
  constructor(private readonly db: Database.Database = getSqlite()) {}

  upsertUnifiedSignal(input: UnifiedSignalEvent): UnifiedSignalRecord {
    const id = normalizeText(input.id);
    const sourceId = normalizeText(input.sourceId);
    const source = normalizeText(input.source);
    const kind = normalizeText(input.kind) ?? input.source;
    const createdAt =
      typeof input.createdAt === "number" && Number.isFinite(input.createdAt)
        ? input.createdAt
        : Date.now();

    if (!id) {
      throw new Error("UnifiedSignal id is required.");
    }
    if (!source) {
      throw new Error("UnifiedSignal source is required.");
    }

    this.db
      .prepare(
        `
          INSERT INTO unified_signals (
            id,
            source,
            source_id,
            symbol,
            kind,
            bias,
            severity,
            rank_score,
            noise_class,
            ttl_sec,
            reason,
            created_at,
            expires_at,
            payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            source = excluded.source,
            source_id = excluded.source_id,
            symbol = excluded.symbol,
            kind = excluded.kind,
            bias = excluded.bias,
            severity = excluded.severity,
            rank_score = excluded.rank_score,
            noise_class = excluded.noise_class,
            ttl_sec = excluded.ttl_sec,
            reason = excluded.reason,
            created_at = excluded.created_at,
            expires_at = excluded.expires_at,
            payload_json = excluded.payload_json
        `
      )
      .run(
        id,
        source,
        sourceId,
        normalizeSymbol(input.symbol),
        kind,
        normalizeText(input.bias ?? input.direction),
        normalizeText(input.severity),
        toNullableNumber(input.rankScore),
        normalizeText(input.noiseClass),
        toNullableNumber(input.ttlSec),
        normalizeText(input.description ?? input.title),
        createdAt,
        toNullableNumber(input.expiresAt),
        stringifyPayload(toPayload(input))
      );

    const saved = this.getUnifiedSignalById(id);
    if (!saved) {
      throw new Error("UnifiedSignal upsert failed.");
    }
    return saved;
  }

  getUnifiedSignalById(id: string): UnifiedSignalRecord | null {
    const normalizedId = normalizeText(id);
    if (!normalizedId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT ${this.selectColumns()}
          FROM unified_signals
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(normalizedId) as UnifiedSignalRow | undefined;

    return row ? toRecord(row) : null;
  }

  getUnifiedSignalEventById(id: string): UnifiedSignalEvent | null {
    const record = this.getUnifiedSignalById(id);
    return record ? toUnifiedSignalEvent(record) : null;
  }

  getUnifiedSignalBySource(
    source: UnifiedSignalEvent["source"],
    sourceId: string
  ): UnifiedSignalRecord | null {
    const normalizedSource = normalizeText(source);
    const normalizedSourceId = normalizeText(sourceId);
    if (!normalizedSource || !normalizedSourceId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT ${this.selectColumns()}
          FROM unified_signals
          WHERE source = ?
            AND source_id = ?
          ORDER BY created_at DESC
          LIMIT 1
        `
      )
      .get(normalizedSource, normalizedSourceId) as UnifiedSignalRow | undefined;

    return row ? toRecord(row) : null;
  }

  listRecentUnifiedSignals(limit = 100): UnifiedSignalRecord[] {
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const rows = this.db
      .prepare(
        `
          SELECT ${this.selectColumns()}
          FROM unified_signals
          ORDER BY created_at DESC
          LIMIT ?
        `
      )
      .all(normalizedLimit) as UnifiedSignalRow[];

    return rows.map(toRecord);
  }

  listUnifiedSignalsForSymbol(symbol: string, limit = 100): UnifiedSignalRecord[] {
    const normalizedSymbol = normalizeSymbol(symbol);
    if (!normalizedSymbol) {
      return [];
    }
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const rows = this.db
      .prepare(
        `
          SELECT ${this.selectColumns()}
          FROM unified_signals
          WHERE symbol = ?
          ORDER BY created_at DESC
          LIMIT ?
        `
      )
      .all(normalizedSymbol, normalizedLimit) as UnifiedSignalRow[];

    return rows.map(toRecord);
  }

  private selectColumns(): string {
    return `
      id,
      source,
      source_id,
      symbol,
      kind,
      bias,
      severity,
      rank_score,
      noise_class,
      ttl_sec,
      reason,
      created_at,
      expires_at,
      payload_json
    `;
  }
}

export const unifiedSignalRepository = new UnifiedSignalRepository();
