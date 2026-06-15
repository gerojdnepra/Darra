import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  DecisionChainIntegrityRecord,
  DecisionChainIntegrityStatus,
  DecisionChainMissingLink
} from "../types/messages";
import { getSqlite } from "./sqlite";

export interface CreateDecisionChainIntegrityInput {
  id?: string;
  lifecycleId?: string | null;
  reviewId?: string | null;
  orderIntentId?: string | null;
  decisionContextId?: string | null;
  unifiedSignalId?: string | null;
  status: DecisionChainIntegrityStatus;
  missingLinks: DecisionChainMissingLink[];
  checkedAt?: number;
  source: string;
}

interface DecisionChainIntegrityRow {
  id: string;
  lifecycle_id: string | null;
  review_id: string | null;
  order_intent_id: string | null;
  decision_context_id: string | null;
  unified_signal_id: string | null;
  status: string;
  missing_links_json: string;
  checked_at: number;
  source: string;
}

const statuses = new Set<DecisionChainIntegrityStatus>(["COMPLETE", "DEGRADED", "BROKEN"]);
const missingLinks = new Set<DecisionChainMissingLink>([
  "UNIFIED_SIGNAL",
  "DECISION_CONTEXT",
  "ORDER_INTENT",
  "EXECUTION_COMMAND",
  "EXECUTION_RESULT",
  "POSITION_LIFECYCLE",
  "DECISION_REVIEW"
]);

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const normalizeMissingLinks = (
  values: DecisionChainMissingLink[] | undefined
): DecisionChainMissingLink[] =>
  Array.from(
    new Set(
      (values ?? []).filter((value): value is DecisionChainMissingLink => missingLinks.has(value))
    )
  );

const parseMissingLinks = (value: string): DecisionChainMissingLink[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeMissingLinks(
      parsed.filter((item): item is DecisionChainMissingLink => typeof item === "string")
    );
  } catch {
    return [];
  }
};

const toRecord = (row: DecisionChainIntegrityRow): DecisionChainIntegrityRecord => ({
  id: row.id,
  lifecycleId: row.lifecycle_id,
  reviewId: row.review_id,
  orderIntentId: row.order_intent_id,
  decisionContextId: row.decision_context_id,
  unifiedSignalId: row.unified_signal_id,
  status: row.status as DecisionChainIntegrityStatus,
  missingLinks: parseMissingLinks(row.missing_links_json),
  checkedAt: row.checked_at,
  source: row.source
});

export class DecisionChainIntegrityRepository {
  constructor(private readonly db: Database.Database = getSqlite()) {}

  createRecord(input: CreateDecisionChainIntegrityInput): DecisionChainIntegrityRecord {
    const id = normalizeText(input.id) ?? randomUUID();
    const source = normalizeText(input.source);
    const checkedAt =
      typeof input.checkedAt === "number" && Number.isFinite(input.checkedAt)
        ? input.checkedAt
        : Date.now();
    const nextMissingLinks = normalizeMissingLinks(input.missingLinks);

    if (!id) {
      throw new Error("DecisionChainIntegrity id is required.");
    }
    if (!statuses.has(input.status)) {
      throw new Error("DecisionChainIntegrity status is invalid.");
    }
    if (!source) {
      throw new Error("DecisionChainIntegrity source is required.");
    }

    this.db
      .prepare(
        `
          INSERT INTO decision_chain_integrity (
            id,
            lifecycle_id,
            review_id,
            order_intent_id,
            decision_context_id,
            unified_signal_id,
            status,
            missing_links_json,
            checked_at,
            source
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        id,
        normalizeText(input.lifecycleId),
        normalizeText(input.reviewId),
        normalizeText(input.orderIntentId),
        normalizeText(input.decisionContextId),
        normalizeText(input.unifiedSignalId),
        input.status,
        JSON.stringify(nextMissingLinks),
        checkedAt,
        source
      );

    const created = this.getRecordById(id);
    if (!created) {
      throw new Error("DecisionChainIntegrity create failed.");
    }

    return created;
  }

  getRecordById(id: string): DecisionChainIntegrityRecord | null {
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
            review_id,
            order_intent_id,
            decision_context_id,
            unified_signal_id,
            status,
            missing_links_json,
            checked_at,
            source
          FROM decision_chain_integrity
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(normalizedId) as DecisionChainIntegrityRow | undefined;

    return row ? toRecord(row) : null;
  }

  listRecentRecords(limit = 50): DecisionChainIntegrityRecord[] {
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            lifecycle_id,
            review_id,
            order_intent_id,
            decision_context_id,
            unified_signal_id,
            status,
            missing_links_json,
            checked_at,
            source
          FROM decision_chain_integrity
          ORDER BY checked_at DESC, id DESC
          LIMIT ?
        `
      )
      .all(normalizedLimit) as DecisionChainIntegrityRow[];

    return rows.map(toRecord);
  }
}

export const decisionChainIntegrityRepository = new DecisionChainIntegrityRepository();
