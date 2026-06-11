import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { AlertRankingResult } from "../alert-ranking/alert-ranking-engine";
import type { DoNotTradeResult } from "../do-not-trade/do-not-trade-engine";
import type { PositionSizingResult } from "../risk/position-sizing-engine";
import { getSqlite } from "./sqlite";

type JsonValue = unknown;

export interface SignalRecord {
  id: string;
  symbol: string;
  createdAt: number;
  type: string;
  severity: string | null;
  source: string | null;
  price: number | null;
  score: number | null;
  setupType: string | null;
  setupConfidence: number | null;
  setupDirection: string | null;
  opportunityVerdict: string | null;
  opportunityScore: number | null;
  opportunityConfidence: number | null;
  opportunityRiskLevel: string | null;
  dntAllowed: boolean | null;
  dntSeverity: string | null;
  dntAction: string | null;
  alertPriority: string | null;
  alertRankScore: number | null;
  alertSuppress: boolean | null;
  recommendedNotional: number | null;
  recommendedQty: number | null;
  normalizedQty: number | null;
  rawQty: number | null;
  suggestedLeverage: number | null;
  riskPerTradePct: number | null;
  stopDistancePct: number | null;
  payload: JsonValue;
}

export interface SignalFeatureRecord {
  id: string;
  signalId: string;
  createdAt: number;
  symbol: string;
  features: JsonValue;
}

export interface SignalOutcomeRecord {
  id: string;
  signalId: string;
  createdAt: number;
  horizonSec: number;
  startPrice: number | null;
  endPrice: number | null;
  maxFavorablePct: number | null;
  maxAdversePct: number | null;
  outcome: JsonValue;
}

export interface SignalReplayTimelineEntry {
  label: "T0" | "+1m" | "+5m" | "+15m" | "+1h";
  timestamp: number | null;
  horizonSec: number | null;
  type: "signal" | "outcome";
  outcome: SignalOutcomeRecord | null;
}

export interface SignalReplayPayload {
  signalId: string;
  signal: SignalRecord;
  features: JsonValue;
  outcomes: SignalOutcomeRecord[];
  setupClassification: JsonValue;
  opportunityScore: JsonValue;
  positionSizing: JsonValue;
  doNotTrade: JsonValue;
  alertRanking: JsonValue;
  timeline: SignalReplayTimelineEntry[];
}

export interface RecoverablePendingOutcomeSignal {
  id: string;
  symbol: string;
  createdAt: number;
  price: number | null;
  setupDirection: string | null;
  payload: JsonValue;
  existingHorizons: number[];
}

export type JournalEntrySide = "long" | "short";

export interface JournalEntryRecord {
  id: string;
  signalId: string | null;
  symbol: string;
  createdAt: number;
  side: JournalEntrySide | null;
  entryPrice: number | null;
  exitPrice: number | null;
  size: number | null;
  pnl: number | null;
  notes: string | null;
  tags: string[];
}

export interface CreateSignalInput {
  id?: string;
  symbol: string;
  createdAt?: number;
  type: string;
  severity?: string | null;
  source?: string | null;
  price?: number | null;
  score?: number | null;
  setupType?: string | null;
  setupConfidence?: number | null;
  setupDirection?: string | null;
  opportunityVerdict?: string | null;
  opportunityScore?: number | null;
  opportunityConfidence?: number | null;
  opportunityRiskLevel?: string | null;
  positionSizing?: PositionSizingResult | null;
  doNotTrade?: DoNotTradeResult | null;
  alertRanking?: AlertRankingResult | null;
  payload: JsonValue;
}

export interface AddSignalFeaturesInput {
  id?: string;
  signalId: string;
  createdAt?: number;
  symbol: string;
  features: JsonValue;
}

export interface AddSignalOutcomeInput {
  id?: string;
  signalId: string;
  createdAt?: number;
  horizonSec: number;
  startPrice?: number | null;
  endPrice?: number | null;
  maxFavorablePct?: number | null;
  maxAdversePct?: number | null;
  outcome: JsonValue;
}

export interface CreateSignalResult {
  signal: SignalRecord;
  created: boolean;
}

export interface AddSignalOutcomeResult {
  id: string;
  created: boolean;
}

export interface CreateJournalEntryInput {
  id?: string;
  signalId?: string | null;
  symbol: string;
  createdAt?: number;
  side?: string | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
  size?: number | null;
  pnl?: number | null;
  notes?: string | null;
  tags?: string[] | null;
}

export interface UpdateJournalEntryPatch {
  signalId?: string | null;
  symbol?: string;
  side?: string | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
  size?: number | null;
  pnl?: number | null;
  notes?: string | null;
  tags?: string[] | null;
}

export interface JournalEntryFilters {
  symbol?: string;
  side?: string;
  sinceMs?: number;
  limit?: number;
}

interface SignalRow {
  id: string;
  symbol: string;
  created_at: number;
  type: string;
  severity: string | null;
  source: string | null;
  price: number | null;
  score: number | null;
  setup_type: string | null;
  setup_confidence: number | null;
  setup_direction: string | null;
  opportunity_verdict: string | null;
  opportunity_score: number | null;
  opportunity_confidence: number | null;
  opportunity_risk_level: string | null;
  dnt_allowed: number | null;
  dnt_severity: string | null;
  dnt_action: string | null;
  alert_priority: string | null;
  alert_rank_score: number | null;
  alert_suppress: number | null;
  recommended_notional: number | null;
  recommended_qty: number | null;
  normalized_qty: number | null;
  raw_qty: number | null;
  suggested_leverage: number | null;
  risk_per_trade_pct: number | null;
  stop_distance_pct: number | null;
  payload_json: string;
}

interface SignalFeatureRow {
  id: string;
  signal_id: string;
  created_at: number;
  symbol: string;
  feature_json: string;
}

interface SignalOutcomeRow {
  id: string;
  signal_id: string;
  created_at: number;
  horizon_sec: number;
  start_price: number | null;
  end_price: number | null;
  max_favorable_pct: number | null;
  max_adverse_pct: number | null;
  outcome_json: string;
}

interface JournalEntryRow {
  id: string;
  signal_id: string | null;
  symbol: string;
  created_at: number;
  side: string | null;
  entry_price: number | null;
  exit_price: number | null;
  size: number | null;
  pnl: number | null;
  notes: string | null;
  tags_json: string | null;
}

const PAYLOAD_JSON_MAX_BYTES = 32 * 1024;
const FEATURE_JSON_MAX_BYTES = 16 * 1024;

const byteLength = (value: string): number => Buffer.byteLength(value, "utf8");

const buildLimitedJsonWarning = (label: string, originalBytes: number, maxBytes: number, sourceJson: string): string => {
  const warning = `${label} exceeded ${maxBytes} bytes and was trimmed from ${originalBytes} bytes.`;
  let truncatedJson = sourceJson.slice(0, Math.max(0, maxBytes - 512));

  for (;;) {
    const candidate = JSON.stringify({
      __storageWarning: warning,
      __truncated: true,
      originalBytes,
      maxBytes,
      truncatedJson
    });

    if (byteLength(candidate) <= maxBytes || truncatedJson.length === 0) {
      return candidate;
    }

    truncatedJson = truncatedJson.slice(0, Math.floor(truncatedJson.length * 0.8));
  }
};

const stringifyJson = (value: JsonValue, maxBytes?: number, label = "json"): string => {
  const json = JSON.stringify(value ?? null);

  if (!maxBytes || byteLength(json) <= maxBytes) {
    return json;
  }

  return buildLimitedJsonWarning(label, byteLength(json), maxBytes, json);
};

const normalizeSymbol = (symbol: string): string => symbol.trim().toUpperCase();

const toNullableNumber = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const toNullableText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const toNullableBooleanInt = (value: boolean | null | undefined): number | null =>
  typeof value === "boolean" ? (value ? 1 : 0) : null;

const toNullableBoolean = (value: number | null): boolean | null =>
  typeof value === "number" ? value !== 0 : null;

const normalizeJournalSide = (value: string | null | undefined): JournalEntrySide | null => {
  const normalized = value?.trim().toLowerCase();
  return normalized === "long" || normalized === "short" ? normalized : null;
};

const normalizeTags = (value: string[] | null | undefined): string[] =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
    )
  ).slice(0, 24);

const parseJson = (value: string): JsonValue => {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return null;
  }
};

const toSignalRecord = (row: SignalRow): SignalRecord => ({
  id: row.id,
  symbol: row.symbol,
  createdAt: row.created_at,
  type: row.type,
  severity: row.severity,
  source: row.source,
  price: row.price,
  score: row.score,
  setupType: row.setup_type,
  setupConfidence: row.setup_confidence,
  setupDirection: row.setup_direction,
  opportunityVerdict: row.opportunity_verdict,
  opportunityScore: row.opportunity_score,
  opportunityConfidence: row.opportunity_confidence,
  opportunityRiskLevel: row.opportunity_risk_level,
  dntAllowed: toNullableBoolean(row.dnt_allowed),
  dntSeverity: row.dnt_severity,
  dntAction: row.dnt_action,
  alertPriority: row.alert_priority,
  alertRankScore: row.alert_rank_score,
  alertSuppress: toNullableBoolean(row.alert_suppress),
  recommendedNotional: row.recommended_notional,
  recommendedQty: row.recommended_qty,
  normalizedQty: row.normalized_qty,
  rawQty: row.raw_qty,
  suggestedLeverage: row.suggested_leverage,
  riskPerTradePct: row.risk_per_trade_pct,
  stopDistancePct: row.stop_distance_pct,
  payload: parseJson(row.payload_json)
});

const toFeatureRecord = (row: SignalFeatureRow): SignalFeatureRecord => ({
  id: row.id,
  signalId: row.signal_id,
  createdAt: row.created_at,
  symbol: row.symbol,
  features: parseJson(row.feature_json)
});

const toOutcomeRecord = (row: SignalOutcomeRow): SignalOutcomeRecord => ({
  id: row.id,
  signalId: row.signal_id,
  createdAt: row.created_at,
  horizonSec: row.horizon_sec,
  startPrice: row.start_price,
  endPrice: row.end_price,
  maxFavorablePct: row.max_favorable_pct,
  maxAdversePct: row.max_adverse_pct,
  outcome: parseJson(row.outcome_json)
});

const toJournalEntryRecord = (row: JournalEntryRow): JournalEntryRecord => {
  const parsedTags = parseJson(row.tags_json ?? "[]");

  return {
    id: row.id,
    signalId: row.signal_id,
    symbol: row.symbol,
    createdAt: row.created_at,
    side: normalizeJournalSide(row.side),
    entryPrice: row.entry_price,
    exitPrice: row.exit_price,
    size: row.size,
    pnl: row.pnl,
    notes: row.notes,
    tags: Array.isArray(parsedTags)
      ? parsedTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
      : []
  };
};

const readRecordPath = (value: JsonValue, path: string[]): JsonValue => {
  let current: unknown = value;

  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) {
      return null;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return current as JsonValue;
};

const buildReplayTimeline = (
  signal: SignalRecord,
  outcomes: SignalOutcomeRecord[]
): SignalReplayTimelineEntry[] => {
  const outcomeByHorizon = new Map(outcomes.map((outcome) => [outcome.horizonSec, outcome]));
  const horizons = [
    { label: "+1m" as const, horizonSec: 60 },
    { label: "+5m" as const, horizonSec: 300 },
    { label: "+15m" as const, horizonSec: 900 },
    { label: "+1h" as const, horizonSec: 3600 }
  ];

  return [
    {
      label: "T0",
      timestamp: signal.createdAt,
      horizonSec: null,
      type: "signal",
      outcome: null
    },
    ...horizons.map(({ label, horizonSec }) => {
      const outcome = outcomeByHorizon.get(horizonSec) ?? null;

      return {
        label,
        timestamp: outcome?.createdAt ?? null,
        horizonSec,
        type: "outcome" as const,
        outcome
      };
    })
  ];
};

export class SignalRepository {
  private lastSqliteQueryMs: number | null = null;

  constructor(private readonly db: Database.Database = getSqlite()) {}

  getLastSqliteQueryMs(): number | null {
    return this.lastSqliteQueryMs;
  }

  private measureSqliteQuery<T>(fn: () => T): T {
    const startedAt = Date.now();
    const result = fn();
    this.lastSqliteQueryMs = Date.now() - startedAt;
    return result;
  }

  createSignal(input: CreateSignalInput): CreateSignalResult {
    const id = input.id ?? randomUUID();
    const symbol = normalizeSymbol(input.symbol);
    const createdAt = input.createdAt ?? Date.now();

    const insertResult = this.measureSqliteQuery(() =>
      this.db
        .prepare(
          `
            INSERT OR IGNORE INTO signals (
              id,
              symbol,
              created_at,
              type,
              severity,
              source,
              price,
              score,
              setup_type,
              setup_confidence,
              setup_direction,
              opportunity_verdict,
              opportunity_score,
              opportunity_confidence,
              opportunity_risk_level,
              dnt_allowed,
              dnt_severity,
              dnt_action,
              alert_priority,
              alert_rank_score,
              alert_suppress,
              recommended_notional,
              recommended_qty,
              normalized_qty,
              raw_qty,
              suggested_leverage,
              risk_per_trade_pct,
              stop_distance_pct,
              payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          id,
          symbol,
          createdAt,
          input.type,
          input.severity ?? null,
          input.source ?? null,
          toNullableNumber(input.price),
          toNullableNumber(input.score),
          input.setupType ?? null,
          toNullableNumber(input.setupConfidence),
          input.setupDirection ?? null,
          input.opportunityVerdict ?? null,
          toNullableNumber(input.opportunityScore),
          toNullableNumber(input.opportunityConfidence),
          input.opportunityRiskLevel ?? null,
          toNullableBooleanInt(input.doNotTrade?.allowed),
          input.doNotTrade?.severity ?? null,
          input.doNotTrade?.action ?? null,
          input.alertRanking?.priority ?? null,
          toNullableNumber(input.alertRanking?.rankScore),
          toNullableBooleanInt(input.alertRanking?.suppress),
          toNullableNumber(input.positionSizing?.recommendedNotional),
          toNullableNumber(input.positionSizing?.recommendedQty),
          toNullableNumber(input.positionSizing?.normalizedQty),
          toNullableNumber(input.positionSizing?.rawQty),
          toNullableNumber(input.positionSizing?.suggestedLeverage),
          toNullableNumber(input.positionSizing?.riskPerTradePct),
          toNullableNumber(input.positionSizing?.stopDistancePct),
          stringifyJson(input.payload, PAYLOAD_JSON_MAX_BYTES, "payload_json")
        )
    );

    if (insertResult.changes === 0) {
      const existingSignal = this.getSignalById(id);

      if (existingSignal) {
        return {
          signal: existingSignal,
          created: false
        };
      }
    }

    return {
      signal: {
      id,
      symbol,
      createdAt,
      type: input.type,
      severity: input.severity ?? null,
      source: input.source ?? null,
      price: toNullableNumber(input.price),
      score: toNullableNumber(input.score),
      setupType: input.setupType ?? null,
      setupConfidence: toNullableNumber(input.setupConfidence),
      setupDirection: input.setupDirection ?? null,
      opportunityVerdict: input.opportunityVerdict ?? null,
      opportunityScore: toNullableNumber(input.opportunityScore),
      opportunityConfidence: toNullableNumber(input.opportunityConfidence),
      opportunityRiskLevel: input.opportunityRiskLevel ?? null,
      dntAllowed: input.doNotTrade?.allowed ?? null,
      dntSeverity: input.doNotTrade?.severity ?? null,
      dntAction: input.doNotTrade?.action ?? null,
      alertPriority: input.alertRanking?.priority ?? null,
      alertRankScore: toNullableNumber(input.alertRanking?.rankScore),
      alertSuppress: input.alertRanking?.suppress ?? null,
      recommendedNotional: toNullableNumber(input.positionSizing?.recommendedNotional),
      recommendedQty: toNullableNumber(input.positionSizing?.recommendedQty),
      normalizedQty: toNullableNumber(input.positionSizing?.normalizedQty),
      rawQty: toNullableNumber(input.positionSizing?.rawQty),
      suggestedLeverage: toNullableNumber(input.positionSizing?.suggestedLeverage),
      riskPerTradePct: toNullableNumber(input.positionSizing?.riskPerTradePct),
      stopDistancePct: toNullableNumber(input.positionSizing?.stopDistancePct),
        payload: parseJson(stringifyJson(input.payload, PAYLOAD_JSON_MAX_BYTES, "payload_json"))
      },
      created: true
    };
  }

  addSignalFeatures(input: AddSignalFeaturesInput): string {
    const id = input.id ?? randomUUID();

    this.measureSqliteQuery(() =>
      this.db
        .prepare(
          `
            INSERT INTO signal_features (
              id,
              signal_id,
              created_at,
              symbol,
              feature_json
            ) VALUES (?, ?, ?, ?, ?)
          `
        )
        .run(
          id,
          input.signalId,
          input.createdAt ?? Date.now(),
          normalizeSymbol(input.symbol),
          stringifyJson(input.features, FEATURE_JSON_MAX_BYTES, "feature_json")
        )
    );

    return id;
  }

  addSignalOutcome(input: AddSignalOutcomeInput): AddSignalOutcomeResult {
    const id = input.id ?? randomUUID();

    const insertResult = this.db
      .prepare(
        `
          INSERT INTO signal_outcomes (
            id,
            signal_id,
            created_at,
            horizon_sec,
            start_price,
            end_price,
            max_favorable_pct,
            max_adverse_pct,
            outcome_json
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (
            SELECT 1
            FROM signal_outcomes
            WHERE signal_id = ?
              AND horizon_sec = ?
          )
        `
      )
      .run(
        id,
        input.signalId,
        input.createdAt ?? Date.now(),
        input.horizonSec,
        toNullableNumber(input.startPrice),
        toNullableNumber(input.endPrice),
        toNullableNumber(input.maxFavorablePct),
        toNullableNumber(input.maxAdversePct),
        stringifyJson(input.outcome),
        input.signalId,
        input.horizonSec
      );

    if (insertResult.changes === 0) {
      const existingOutcome = this.getSignalOutcomeByHorizon(input.signalId, input.horizonSec);

      if (existingOutcome) {
        return {
          id: existingOutcome.id,
          created: false
        };
      }
    }

    return {
      id,
      created: true
    };
  }

  listRecentSignals(limit = 100): SignalRecord[] {
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const rows = this.measureSqliteQuery(() =>
      this.db
        .prepare(
          `
            SELECT
              id,
              symbol,
              created_at,
              type,
              severity,
              source,
              price,
              score,
              setup_type,
              setup_confidence,
              setup_direction,
              opportunity_verdict,
              opportunity_score,
              opportunity_confidence,
              opportunity_risk_level,
              dnt_allowed,
              dnt_severity,
              dnt_action,
              alert_priority,
              alert_rank_score,
              alert_suppress,
              recommended_notional,
              recommended_qty,
              normalized_qty,
              raw_qty,
              suggested_leverage,
              risk_per_trade_pct,
              stop_distance_pct,
              payload_json
            FROM signals
            ORDER BY created_at DESC
            LIMIT ?
          `
        )
        .all(normalizedLimit) as SignalRow[]
    );

    return rows.map(toSignalRecord);
  }

  findSignalsMissingRecentOutcomes(
    sinceCreatedAt: number,
    horizons: readonly number[]
  ): RecoverablePendingOutcomeSignal[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            s.id,
            s.symbol,
            s.created_at,
            s.price,
            s.setup_direction,
            s.payload_json,
            GROUP_CONCAT(o.horizon_sec) AS outcome_horizons
          FROM signals s
          LEFT JOIN signal_outcomes o
            ON o.signal_id = s.id
            AND o.horizon_sec IN (${horizons.map(() => "?").join(", ")})
          WHERE s.created_at >= ?
            AND s.price IS NOT NULL
            AND s.price > 0
          GROUP BY s.id
          HAVING COUNT(DISTINCT o.horizon_sec) < ?
          ORDER BY s.created_at ASC
        `
      )
      .all(...horizons, sinceCreatedAt, horizons.length) as Array<{
        id: string;
        symbol: string;
        created_at: number;
        price: number | null;
        setup_direction: string | null;
        payload_json: string;
        outcome_horizons: string | null;
      }>;

    return rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      createdAt: row.created_at,
      price: row.price,
      setupDirection: row.setup_direction,
      payload: parseJson(row.payload_json),
      existingHorizons: (row.outcome_horizons ?? "")
        .split(",")
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
    }));
  }

  getSignalById(id: string): SignalRecord | null {
    const row = this.db
      .prepare(
        `
          SELECT
            id,
            symbol,
            created_at,
            type,
            severity,
            source,
            price,
            score,
            setup_type,
            setup_confidence,
            setup_direction,
            opportunity_verdict,
            opportunity_score,
            opportunity_confidence,
            opportunity_risk_level,
            dnt_allowed,
            dnt_severity,
            dnt_action,
            alert_priority,
            alert_rank_score,
            alert_suppress,
            recommended_notional,
            recommended_qty,
            normalized_qty,
            raw_qty,
            suggested_leverage,
            risk_per_trade_pct,
            stop_distance_pct,
            payload_json
          FROM signals
          WHERE id = ?
        `
      )
      .get(id) as SignalRow | undefined;

    return row ? toSignalRecord(row) : null;
  }

  getSignalOutcomeByHorizon(signalId: string, horizonSec: number): SignalOutcomeRecord | null {
    const row = this.db
      .prepare(
        `
          SELECT
            id,
            signal_id,
            created_at,
            horizon_sec,
            start_price,
            end_price,
            max_favorable_pct,
            max_adverse_pct,
            outcome_json
          FROM signal_outcomes
          WHERE signal_id = ?
            AND horizon_sec = ?
          ORDER BY created_at DESC
          LIMIT 1
        `
      )
      .get(signalId, horizonSec) as SignalOutcomeRow | undefined;

    return row ? toOutcomeRecord(row) : null;
  }

  findLatestJournalLinkSignal(symbol: string, sinceCreatedAt: number): SignalRecord | null {
    const normalizedSymbol = normalizeSymbol(symbol);

    if (!normalizedSymbol) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            id,
            symbol,
            created_at,
            type,
            severity,
            source,
            price,
            score,
            setup_type,
            setup_confidence,
            setup_direction,
            opportunity_verdict,
            opportunity_score,
            opportunity_confidence,
            opportunity_risk_level,
            dnt_allowed,
            dnt_severity,
            dnt_action,
            alert_priority,
            alert_rank_score,
            alert_suppress,
            recommended_notional,
            recommended_qty,
            normalized_qty,
            raw_qty,
            suggested_leverage,
            risk_per_trade_pct,
            stop_distance_pct,
            payload_json
          FROM signals
          WHERE symbol = ?
            AND created_at >= ?
            AND opportunity_verdict IN ('TRADE', 'WAIT')
            AND setup_type IS NOT NULL
            AND TRIM(setup_type) <> ''
            AND setup_type <> 'UNKNOWN'
          ORDER BY created_at DESC
          LIMIT 1
        `
      )
      .get(normalizedSymbol, sinceCreatedAt) as SignalRow | undefined;

    return row ? toSignalRecord(row) : null;
  }

  getSignalReplay(signalId: string): SignalReplayPayload | null {
    const normalizedSignalId = signalId.trim();

    if (!normalizedSignalId) {
      return null;
    }

    const signal = this.getSignalById(normalizedSignalId);

    if (!signal) {
      return null;
    }

    const featureRows = this.db
      .prepare(
        `
          SELECT
            id,
            signal_id,
            created_at,
            symbol,
            feature_json
          FROM signal_features
          WHERE signal_id = ?
          ORDER BY created_at DESC
        `
      )
      .all(normalizedSignalId) as SignalFeatureRow[];
    const latestFeatureRow = featureRows[0];
    const latestFeatures = latestFeatureRow ? toFeatureRecord(latestFeatureRow).features : null;

    const outcomeRows = this.db
      .prepare(
        `
          SELECT
            id,
            signal_id,
            created_at,
            horizon_sec,
            start_price,
            end_price,
            max_favorable_pct,
            max_adverse_pct,
            outcome_json
          FROM signal_outcomes
          WHERE signal_id = ?
          ORDER BY horizon_sec ASC, created_at DESC
        `
      )
      .all(normalizedSignalId) as SignalOutcomeRow[];
    const outcomeByHorizon = new Map<number, SignalOutcomeRecord>();

    for (const row of outcomeRows) {
      if (!outcomeByHorizon.has(row.horizon_sec)) {
        outcomeByHorizon.set(row.horizon_sec, toOutcomeRecord(row));
      }
    }

    const outcomes = Array.from(outcomeByHorizon.values()).sort(
      (left, right) => left.horizonSec - right.horizonSec
    );

    return {
      signalId: signal.id,
      signal,
      features: latestFeatures,
      outcomes,
      setupClassification: readRecordPath(signal.payload, ["setupClassification"]),
      opportunityScore: readRecordPath(signal.payload, ["opportunityScore"]),
      positionSizing: readRecordPath(signal.payload, ["positionSizing"]),
      doNotTrade: readRecordPath(signal.payload, ["doNotTrade"]),
      alertRanking: readRecordPath(signal.payload, ["alertRanking"]),
      timeline: buildReplayTimeline(signal, outcomes)
    };
  }

  createJournalEntry(input: CreateJournalEntryInput): JournalEntryRecord {
    const id = input.id ?? randomUUID();
    const symbol = normalizeSymbol(input.symbol);

    if (!symbol) {
      throw new Error("Journal entry symbol is required");
    }

    const createdAt = input.createdAt ?? Date.now();
    const side = normalizeJournalSide(input.side);
    const tags = normalizeTags(input.tags);

    this.db
      .prepare(
        `
          INSERT INTO journal_entries (
            id,
            signal_id,
            symbol,
            created_at,
            side,
            entry_price,
            exit_price,
            size,
            pnl,
            notes,
            tags_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        id,
        toNullableText(input.signalId),
        symbol,
        createdAt,
        side,
        toNullableNumber(input.entryPrice),
        toNullableNumber(input.exitPrice),
        toNullableNumber(input.size),
        toNullableNumber(input.pnl),
        toNullableText(input.notes),
        stringifyJson(tags)
      );

    return {
      id,
      signalId: toNullableText(input.signalId),
      symbol,
      createdAt,
      side,
      entryPrice: toNullableNumber(input.entryPrice),
      exitPrice: toNullableNumber(input.exitPrice),
      size: toNullableNumber(input.size),
      pnl: toNullableNumber(input.pnl),
      notes: toNullableText(input.notes),
      tags
    };
  }

  updateJournalEntry(id: string, patch: UpdateJournalEntryPatch): JournalEntryRecord | null {
    const normalizedId = id.trim();

    if (!normalizedId) {
      throw new Error("Journal entry id is required");
    }

    const assignments: string[] = [];
    const params: unknown[] = [];

    if ("signalId" in patch) {
      assignments.push("signal_id = ?");
      params.push(toNullableText(patch.signalId));
    }

    if ("symbol" in patch) {
      const symbol = normalizeSymbol(patch.symbol ?? "");
      if (!symbol) {
        throw new Error("Journal entry symbol is required");
      }
      assignments.push("symbol = ?");
      params.push(symbol);
    }

    if ("side" in patch) {
      assignments.push("side = ?");
      params.push(normalizeJournalSide(patch.side));
    }

    if ("entryPrice" in patch) {
      assignments.push("entry_price = ?");
      params.push(toNullableNumber(patch.entryPrice));
    }

    if ("exitPrice" in patch) {
      assignments.push("exit_price = ?");
      params.push(toNullableNumber(patch.exitPrice));
    }

    if ("size" in patch) {
      assignments.push("size = ?");
      params.push(toNullableNumber(patch.size));
    }

    if ("pnl" in patch) {
      assignments.push("pnl = ?");
      params.push(toNullableNumber(patch.pnl));
    }

    if ("notes" in patch) {
      assignments.push("notes = ?");
      params.push(toNullableText(patch.notes));
    }

    if ("tags" in patch) {
      assignments.push("tags_json = ?");
        params.push(stringifyJson(normalizeTags(patch.tags)));
    }

    if (assignments.length > 0) {
      this.db.prepare(`UPDATE journal_entries SET ${assignments.join(", ")} WHERE id = ?`).run(
        ...params,
        normalizedId
      );
    }

    return this.getJournalEntryById(normalizedId);
  }

  deleteJournalEntry(id: string): boolean {
    const result = this.db.prepare("DELETE FROM journal_entries WHERE id = ?").run(id.trim());
    return result.changes > 0;
  }

  listJournalEntries(filters: JournalEntryFilters = {}): JournalEntryRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const symbol = toNullableText(filters.symbol)?.toUpperCase() ?? null;
    const side = normalizeJournalSide(filters.side);
    const sinceMs =
      typeof filters.sinceMs === "number" && Number.isFinite(filters.sinceMs) && filters.sinceMs > 0
        ? filters.sinceMs
        : null;
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 50), 1), 500);

    if (symbol) {
      clauses.push("symbol = ?");
      params.push(symbol);
    }

    if (side) {
      clauses.push("side = ?");
      params.push(side);
    }

    if (sinceMs !== null) {
      clauses.push("created_at >= ?");
      params.push(Date.now() - sinceMs);
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            signal_id,
            symbol,
            created_at,
            side,
            entry_price,
            exit_price,
            size,
            pnl,
            notes,
            tags_json
          FROM journal_entries
          ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
          ORDER BY created_at DESC
          LIMIT ?
        `
      )
      .all(...params, limit) as JournalEntryRow[];

    return rows.map(toJournalEntryRecord);
  }

  getJournalEntryById(id: string): JournalEntryRecord | null {
    const row = this.db
      .prepare(
        `
          SELECT
            id,
            signal_id,
            symbol,
            created_at,
            side,
            entry_price,
            exit_price,
            size,
            pnl,
            notes,
            tags_json
          FROM journal_entries
          WHERE id = ?
        `
      )
      .get(id.trim()) as JournalEntryRow | undefined;

    return row ? toJournalEntryRecord(row) : null;
  }

  findOpenAutoJournalEntry(symbol: string, side: JournalEntrySide): JournalEntryRecord | null {
    const normalizedSymbol = normalizeSymbol(symbol);
    const normalizedSide = normalizeJournalSide(side);

    if (!normalizedSymbol || !normalizedSide) {
      return null;
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            signal_id,
            symbol,
            created_at,
            side,
            entry_price,
            exit_price,
            size,
            pnl,
            notes,
            tags_json
          FROM journal_entries
          WHERE symbol = ?
            AND side = ?
            AND exit_price IS NULL
            AND tags_json LIKE '%"auto"%'
            AND tags_json LIKE '%"binance-position"%'
          ORDER BY created_at DESC
          LIMIT 1
        `
      )
      .all(normalizedSymbol, normalizedSide) as JournalEntryRow[];

    return rows[0] ? toJournalEntryRecord(rows[0]) : null;
  }
}

export const signalRepository = new SignalRepository();
