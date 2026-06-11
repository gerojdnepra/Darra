import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import type { DecisionReviewObject, PositionLifecycle, TradeDecisionContext } from "../types/messages";
import { getSqlite } from "./sqlite";
import {
  TradeDecisionRepository,
  tradeDecisionRepository
} from "./trade-decision-repository";

export type DecisionReviewStatus = "draft" | "reviewed" | "archived";
export type DecisionReviewGenerationSource = "position_lifecycle" | "manual" | "system";
export type DecisionReviewTradeGrade = NonNullable<DecisionReviewObject["tradeGrade"]>;

export interface CreateDecisionReviewInput {
  id?: string;
  symbol: string;
  signalId?: string | null;
  unifiedSignalId?: string | null;
  decisionContextId?: string | null;
  orderIntentId?: string | null;
  positionLifecycleId?: string | null;
  journalEntryId?: string | null;
  outcomeId?: string | null;
  marketRegime?: string | null;
  tradeGrade?: DecisionReviewTradeGrade | null;
  ruleViolations?: string[];
  playbookTags?: string[];
  notes?: string | null;
  status?: DecisionReviewStatus;
  generationSource?: DecisionReviewGenerationSource;
  generationVersion?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface UpdateDecisionReviewInput {
  id: string;
  signalId?: string | null;
  unifiedSignalId?: string | null;
  decisionContextId?: string | null;
  orderIntentId?: string | null;
  positionLifecycleId?: string | null;
  journalEntryId?: string | null;
  outcomeId?: string | null;
  marketRegime?: string | null;
  tradeGrade?: DecisionReviewTradeGrade | null;
  ruleViolations?: string[];
  playbookTags?: string[];
  notes?: string | null;
  status?: DecisionReviewStatus;
  updatedAt?: number;
}

export interface CreateDecisionReviewFromLifecycleInput {
  lifecycle: PositionLifecycle;
  createdAt?: number;
}

interface DecisionReviewRow {
  id: string;
  symbol: string;
  signal_id: string | null;
  unified_signal_id: string | null;
  decision_context_id: string | null;
  order_intent_id: string | null;
  position_lifecycle_id: string | null;
  journal_entry_id: string | null;
  outcome_id: string | null;
  market_regime: string | null;
  trade_grade: string | null;
  rule_violations_json: string;
  playbook_tags_json: string;
  notes: string | null;
  status: string;
  generation_source: string;
  generation_version: string;
  created_at: number;
  updated_at: number;
}

const statuses = new Set<DecisionReviewStatus>(["draft", "reviewed", "archived"]);
const generationSources = new Set<DecisionReviewGenerationSource>([
  "position_lifecycle",
  "manual",
  "system"
]);
const tradeGrades = new Set<DecisionReviewTradeGrade>(["A", "B", "C", "D", "F"]);

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const normalizeSymbol = (value: string): string => value.trim().toUpperCase();

const normalizeStringList = (values: string[] | undefined): string[] => {
  if (!values) {
    return [];
  }

  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))
  );
};

const parseStringList = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return normalizeStringList(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return [];
  }
};

const stringifyStringList = (values: string[] | undefined): string =>
  JSON.stringify(normalizeStringList(values));

const getPayloadString = (
  payload: TradeDecisionContext["payload"] | undefined,
  key: string
): string | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? normalizeText(value) : null;
};

const normalizeTradeGrade = (
  value: DecisionReviewTradeGrade | null | undefined
): DecisionReviewTradeGrade | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (!tradeGrades.has(value)) {
    throw new Error("DecisionReview tradeGrade is invalid.");
  }
  return value;
};

const toDecisionReview = (row: DecisionReviewRow): DecisionReviewObject => ({
  id: row.id,
  symbol: row.symbol,
  signalId: row.signal_id,
  unifiedSignalId: row.unified_signal_id,
  decisionContextId: row.decision_context_id,
  orderIntentId: row.order_intent_id,
  positionLifecycleId: row.position_lifecycle_id,
  journalEntryId: row.journal_entry_id,
  outcomeId: row.outcome_id,
  marketRegime: row.market_regime,
  tradeGrade: normalizeTradeGrade(row.trade_grade as DecisionReviewTradeGrade | null),
  ruleViolations: parseStringList(row.rule_violations_json),
  playbookTags: parseStringList(row.playbook_tags_json),
  notes: row.notes,
  status: row.status as DecisionReviewStatus,
  generationSource: row.generation_source as DecisionReviewGenerationSource,
  generationVersion: row.generation_version,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export class DecisionReviewRepository {
  constructor(
    private readonly db: Database.Database = getSqlite(),
    private readonly decisions: TradeDecisionRepository = tradeDecisionRepository
  ) {}

  createDecisionReview(input: CreateDecisionReviewInput): DecisionReviewObject {
    const id = normalizeText(input.id) ?? randomUUID();
    const symbol = normalizeSymbol(input.symbol);
    const now = Date.now();
    const createdAt = input.createdAt ?? now;
    const updatedAt = input.updatedAt ?? createdAt;
    const status = input.status ?? "draft";
    const generationSource = input.generationSource ?? "position_lifecycle";
    const generationVersion = normalizeText(input.generationVersion) ?? "v1";

    if (!id) {
      throw new Error("DecisionReview id is required.");
    }
    if (!symbol) {
      throw new Error("DecisionReview symbol is required.");
    }
    if (!statuses.has(status)) {
      throw new Error("DecisionReview status is invalid.");
    }
    if (!generationSources.has(generationSource)) {
      throw new Error("DecisionReview generationSource is invalid.");
    }

    this.db
      .prepare(
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
      )
      .run(
        id,
        symbol,
        normalizeText(input.signalId),
        normalizeText(input.unifiedSignalId),
        normalizeText(input.decisionContextId),
        normalizeText(input.orderIntentId),
        normalizeText(input.positionLifecycleId),
        normalizeText(input.journalEntryId),
        normalizeText(input.outcomeId),
        normalizeText(input.marketRegime),
        normalizeTradeGrade(input.tradeGrade),
        stringifyStringList(input.ruleViolations),
        stringifyStringList(input.playbookTags),
        normalizeText(input.notes),
        status,
        generationSource,
        generationVersion,
        createdAt,
        updatedAt
      );

    const created = this.getDecisionReviewById(id);
    if (!created) {
      throw new Error("DecisionReview create failed.");
    }
    return created;
  }

  getDecisionReviewById(id: string): DecisionReviewObject | null {
    const normalizedId = normalizeText(id);
    if (!normalizedId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT ${this.selectColumns()}
          FROM decision_reviews
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(normalizedId) as DecisionReviewRow | undefined;

    return row ? toDecisionReview(row) : null;
  }

  getDecisionReviewByLifecycleId(positionLifecycleId: string): DecisionReviewObject | null {
    const normalizedLifecycleId = normalizeText(positionLifecycleId);
    if (!normalizedLifecycleId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT ${this.selectColumns()}
          FROM decision_reviews
          WHERE position_lifecycle_id = ?
          ORDER BY created_at DESC
          LIMIT 1
        `
      )
      .get(normalizedLifecycleId) as DecisionReviewRow | undefined;

    return row ? toDecisionReview(row) : null;
  }

  listDecisionReviewsForSymbol(symbol: string, limit = 50): DecisionReviewObject[] {
    const normalizedSymbol = normalizeSymbol(symbol);
    if (!normalizedSymbol) {
      return [];
    }
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);

    const rows = this.db
      .prepare(
        `
          SELECT ${this.selectColumns()}
          FROM decision_reviews
          WHERE symbol = ?
          ORDER BY created_at DESC
          LIMIT ?
        `
      )
      .all(normalizedSymbol, normalizedLimit) as DecisionReviewRow[];

    return rows.map(toDecisionReview);
  }

  listRecentDecisionReviews(limit = 100): DecisionReviewObject[] {
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);

    const rows = this.db
      .prepare(
        `
          SELECT ${this.selectColumns()}
          FROM decision_reviews
          ORDER BY created_at DESC
          LIMIT ?
        `
      )
      .all(normalizedLimit) as DecisionReviewRow[];

    return rows.map(toDecisionReview);
  }

  updateDecisionReview(input: UpdateDecisionReviewInput): DecisionReviewObject | null {
    const id = normalizeText(input.id);
    if (!id) {
      throw new Error("DecisionReview update requires id.");
    }

    const existing = this.getDecisionReviewById(id);
    if (!existing) {
      return null;
    }

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    const setNullableText = (column: string, value: string | null | undefined): void => {
      updates.push(`${column} = ?`);
      values.push(normalizeText(value));
    };

    if ("signalId" in input) {
      setNullableText("signal_id", input.signalId);
    }
    if ("unifiedSignalId" in input) {
      setNullableText("unified_signal_id", input.unifiedSignalId);
    }
    if ("decisionContextId" in input) {
      setNullableText("decision_context_id", input.decisionContextId);
    }
    if ("orderIntentId" in input) {
      setNullableText("order_intent_id", input.orderIntentId);
    }
    if ("positionLifecycleId" in input) {
      setNullableText("position_lifecycle_id", input.positionLifecycleId);
    }
    if ("journalEntryId" in input) {
      setNullableText("journal_entry_id", input.journalEntryId);
    }
    if ("outcomeId" in input) {
      setNullableText("outcome_id", input.outcomeId);
    }
    if ("marketRegime" in input) {
      setNullableText("market_regime", input.marketRegime);
    }
    if ("tradeGrade" in input) {
      updates.push("trade_grade = ?");
      values.push(normalizeTradeGrade(input.tradeGrade));
    }
    if ("ruleViolations" in input) {
      updates.push("rule_violations_json = ?");
      values.push(stringifyStringList(input.ruleViolations));
    }
    if ("playbookTags" in input) {
      updates.push("playbook_tags_json = ?");
      values.push(stringifyStringList(input.playbookTags));
    }
    if ("notes" in input) {
      setNullableText("notes", input.notes);
    }
    if ("status" in input) {
      if (!statuses.has(input.status)) {
        throw new Error("DecisionReview status is invalid.");
      }
      updates.push("status = ?");
      values.push(input.status);
    }

    updates.push("updated_at = ?");
    values.push(input.updatedAt ?? Date.now());
    values.push(id);

    this.db
      .prepare(
        `
          UPDATE decision_reviews
          SET ${updates.join(", ")}
          WHERE id = ?
        `
      )
      .run(...values);

    return this.getDecisionReviewById(id);
  }

  createDecisionReviewFromLifecycle(
    input: CreateDecisionReviewFromLifecycleInput
  ): DecisionReviewObject {
    const existing = this.getDecisionReviewByLifecycleId(input.lifecycle.id);
    if (existing) {
      return existing;
    }

    const decisionContextById = input.lifecycle.decisionContextId
      ? this.decisions.getTradeDecisionContextById(input.lifecycle.decisionContextId)
      : null;
    const decisionContext =
      decisionContextById ??
      (input.lifecycle.orderIntentId
        ? this.decisions.getTradeDecisionContextByOrderIntentId(input.lifecycle.orderIntentId)
        : null);
    const unifiedSignalId =
      normalizeText(input.lifecycle.unifiedSignalId) ??
      normalizeText(decisionContext?.unifiedSignalId);
    const orderIntentId =
      normalizeText(input.lifecycle.orderIntentId) ?? normalizeText(decisionContext?.orderIntentId);
    const marketRegime =
      normalizeText(decisionContext?.marketRegime) ??
      getPayloadString(decisionContext?.payload, "marketRegime");

    const createInput: CreateDecisionReviewInput = {
      symbol: input.lifecycle.symbol,
      signalId: normalizeText(decisionContext?.signalId) ?? unifiedSignalId,
      unifiedSignalId,
      decisionContextId:
        normalizeText(input.lifecycle.decisionContextId) ?? normalizeText(decisionContext?.id),
      orderIntentId,
      positionLifecycleId: input.lifecycle.id,
      journalEntryId: null,
      outcomeId: null,
      marketRegime,
      tradeGrade: null,
      ruleViolations: [],
      playbookTags: [],
      notes: null,
      status: "draft",
      generationSource: "position_lifecycle",
      generationVersion: "v1"
    };

    if (typeof input.createdAt === "number" && Number.isFinite(input.createdAt)) {
      createInput.createdAt = input.createdAt;
    }

    return this.createDecisionReview(createInput);
  }

  private selectColumns(): string {
    return `
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
    `;
  }
}

export const decisionReviewRepository = new DecisionReviewRepository();
