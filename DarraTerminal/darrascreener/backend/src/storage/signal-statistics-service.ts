import type Database from "better-sqlite3";
import { getSqlite } from "./sqlite";

export interface SignalStatisticsFilters {
  sinceMs?: number;
  limit?: number;
  symbol?: string;
  type?: string;
  source?: string;
  setupType?: string;
  opportunityVerdict?: string;
  doNotTradeAction?: string;
  doNotTradeSeverity?: string;
  alertPriority?: string;
  horizonSec?: number;
}

export interface SignalStatisticsBucket {
  key: string;
  total_signals: number;
  total_outcomes: number;
  confidence: "low" | "normal";
  avg_favorable_pct: number;
  avg_adverse_pct: number;
  avg_end_move_pct: number;
  win_rate_pct: number;
  best_move_pct: number;
  worst_move_pct: number;
}

const MIN_CONFIDENT_OUTCOMES = 30;

export interface SignalStatisticsRecentOutcome {
  signalId: string;
  symbol: string;
  type: string;
  setupType: string | null;
  opportunityVerdict: string | null;
  doNotTradeAllowed: boolean | null;
  doNotTradeSeverity: string | null;
  doNotTradeAction: string | null;
  alertPriority: string | null;
  alertRankScore: number | null;
  alertSuppress: boolean | null;
  source: string | null;
  severity: string | null;
  signalCreatedAt: number;
  outcomeCreatedAt: number;
  horizonSec: number;
  direction: "long" | "short" | "unknown";
  startPrice: number | null;
  endPrice: number | null;
  endMovePct: number;
  maxFavorablePct: number;
  maxAdversePct: number;
  recommendedNotional: number | null;
  recommendedQty: number | null;
  normalizedQty: number | null;
  rawQty: number | null;
  suggestedLeverage: number | null;
  riskPerTradePct: number | null;
  stopDistancePct: number | null;
  win: boolean;
}

interface SignalOutcomeRow {
  signal_id: string;
  symbol: string;
  type: string;
  setup_type: string | null;
  opportunity_verdict: string | null;
  dnt_allowed: number | null;
  dnt_severity: string | null;
  dnt_action: string | null;
  alert_priority: string | null;
  alert_rank_score: number | null;
  alert_suppress: number | null;
  source: string | null;
  severity: string | null;
  signal_created_at: number;
  outcome_created_at: number;
  horizon_sec: number;
  start_price: number | null;
  end_price: number | null;
  max_favorable_pct: number | null;
  max_adverse_pct: number | null;
  recommended_notional: number | null;
  recommended_qty: number | null;
  normalized_qty: number | null;
  raw_qty: number | null;
  suggested_leverage: number | null;
  risk_per_trade_pct: number | null;
  stop_distance_pct: number | null;
  outcome_json: string;
}

interface NormalizedFilters {
  sinceMs: number | null;
  limit: number;
  symbol: string | null;
  type: string | null;
  source: string | null;
  setupType: string | null;
  opportunityVerdict: string | null;
  doNotTradeAction: string | null;
  doNotTradeSeverity: string | null;
  alertPriority: string | null;
  horizonSec: number | null;
}

interface OutcomeStats {
  totalOutcomes: number;
  favorableSum: number;
  adverseSum: number;
  endMoveSum: number;
  wins: number;
  bestMovePct: number | null;
  worstMovePct: number | null;
}

const emptyStats = (): OutcomeStats => ({
  totalOutcomes: 0,
  favorableSum: 0,
  adverseSum: 0,
  endMoveSum: 0,
  wins: 0,
  bestMovePct: null,
  worstMovePct: null
});

const normalizeLimit = (value: number | undefined): number =>
  Math.min(Math.max(Math.trunc(value ?? 50), 1), 500);

const normalizeString = (value: string | undefined, uppercase = false): string | null => {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  return uppercase ? normalized.toUpperCase() : normalized;
};

const normalizeFilters = (filters: SignalStatisticsFilters = {}): NormalizedFilters => ({
  sinceMs:
    typeof filters.sinceMs === "number" && Number.isFinite(filters.sinceMs) && filters.sinceMs > 0
      ? filters.sinceMs
      : null,
  limit: normalizeLimit(filters.limit),
  symbol: normalizeString(filters.symbol, true),
  type: normalizeString(filters.type),
  source: normalizeString(filters.source),
  setupType: normalizeString(filters.setupType),
  opportunityVerdict: normalizeString(filters.opportunityVerdict),
  doNotTradeAction: normalizeString(filters.doNotTradeAction),
  doNotTradeSeverity: normalizeString(filters.doNotTradeSeverity),
  alertPriority: normalizeString(filters.alertPriority),
  horizonSec:
    typeof filters.horizonSec === "number" &&
    Number.isFinite(filters.horizonSec) &&
    filters.horizonSec > 0
      ? Math.trunc(filters.horizonSec)
      : null
});

const roundMetric = (value: number): number => Math.round(value * 10_000) / 10_000;

const safeAverage = (sum: number, count: number): number =>
  count > 0 ? roundMetric(sum / count) : 0;

const parseOutcomeJson = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const normalizeDirection = (value: unknown): "long" | "short" | "unknown" => {
  if (typeof value !== "string") {
    return "unknown";
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "long" || normalized === "short") {
    return normalized;
  }

  return "unknown";
};

const calculateEndMovePct = (row: SignalOutcomeRow, outcome: Record<string, unknown>): number => {
  if (typeof outcome.endMovePct === "number" && Number.isFinite(outcome.endMovePct)) {
    return outcome.endMovePct;
  }

  if (
    typeof row.start_price === "number" &&
    Number.isFinite(row.start_price) &&
    row.start_price > 0 &&
    typeof row.end_price === "number" &&
    Number.isFinite(row.end_price)
  ) {
    return ((row.end_price - row.start_price) / row.start_price) * 100;
  }

  return 0;
};

const isWin = (direction: "long" | "short" | "unknown", endMovePct: number): boolean => {
  if (direction === "long") {
    return endMovePct > 0;
  }

  if (direction === "short") {
    return endMovePct < 0;
  }

  return Math.abs(endMovePct) >= 0.5;
};

const createBucket = (key: string, totalSignals: number, stats: OutcomeStats): SignalStatisticsBucket => ({
  key,
  total_signals: totalSignals,
  total_outcomes: stats.totalOutcomes,
  confidence: stats.totalOutcomes < MIN_CONFIDENT_OUTCOMES ? "low" : "normal",
  avg_favorable_pct: safeAverage(stats.favorableSum, stats.totalOutcomes),
  avg_adverse_pct: safeAverage(stats.adverseSum, stats.totalOutcomes),
  avg_end_move_pct: safeAverage(stats.endMoveSum, stats.totalOutcomes),
  win_rate_pct: stats.totalOutcomes > 0 ? roundMetric((stats.wins / stats.totalOutcomes) * 100) : 0,
  best_move_pct: roundMetric(stats.bestMovePct ?? 0),
  worst_move_pct: roundMetric(stats.worstMovePct ?? 0)
});

export class SignalStatisticsService {
  constructor(private readonly db: Database.Database = getSqlite()) {}

  getSummary(filters: SignalStatisticsFilters = {}): SignalStatisticsBucket {
    const normalized = normalizeFilters(filters);
    const rows = this.queryOutcomeRows(normalized);
    const stats = this.aggregateOutcomeRows(rows);

    return createBucket("summary", this.countSignals(normalized), stats);
  }

  getBySetupType(filters: SignalStatisticsFilters = {}): SignalStatisticsBucket[] {
    return this.groupBy("setup_type", filters);
  }

  getByType(filters: SignalStatisticsFilters = {}): SignalStatisticsBucket[] {
    return this.groupBy("type", filters);
  }

  getByOpportunityVerdict(filters: SignalStatisticsFilters = {}): SignalStatisticsBucket[] {
    return this.groupBy("opportunity_verdict", filters);
  }

  getByDoNotTradeAction(filters: SignalStatisticsFilters = {}): SignalStatisticsBucket[] {
    return this.groupBy("dnt_action", filters);
  }

  getByDoNotTradeSeverity(filters: SignalStatisticsFilters = {}): SignalStatisticsBucket[] {
    return this.groupBy("dnt_severity", filters);
  }

  getByAlertPriority(filters: SignalStatisticsFilters = {}): SignalStatisticsBucket[] {
    return this.groupBy("alert_priority", filters);
  }

  getBySymbol(filters: SignalStatisticsFilters = {}): SignalStatisticsBucket[] {
    return this.groupBy("symbol", filters);
  }

  getBySource(filters: SignalStatisticsFilters = {}): SignalStatisticsBucket[] {
    return this.groupBy("source", filters);
  }

  getRecentOutcomes(filters: SignalStatisticsFilters = {}): SignalStatisticsRecentOutcome[] {
    const normalized = normalizeFilters(filters);

    return this.queryOutcomeRows(normalized).slice(0, normalized.limit).map((row) => {
      const outcome = parseOutcomeJson(row.outcome_json);
      const direction = normalizeDirection(outcome.direction);
      const endMovePct = roundMetric(calculateEndMovePct(row, outcome));

      return {
        signalId: row.signal_id,
        symbol: row.symbol,
        type: row.type,
        setupType: row.setup_type,
        opportunityVerdict: row.opportunity_verdict,
        doNotTradeAllowed: typeof row.dnt_allowed === "number" ? row.dnt_allowed !== 0 : null,
        doNotTradeSeverity: row.dnt_severity,
        doNotTradeAction: row.dnt_action,
        alertPriority: row.alert_priority,
        alertRankScore: row.alert_rank_score,
        alertSuppress: typeof row.alert_suppress === "number" ? row.alert_suppress !== 0 : null,
        source: row.source,
        severity: row.severity,
        signalCreatedAt: row.signal_created_at,
        outcomeCreatedAt: row.outcome_created_at,
        horizonSec: row.horizon_sec,
        direction,
        startPrice: row.start_price,
        endPrice: row.end_price,
        endMovePct,
        maxFavorablePct: roundMetric(row.max_favorable_pct ?? 0),
        maxAdversePct: roundMetric(row.max_adverse_pct ?? 0),
        recommendedNotional: row.recommended_notional,
        recommendedQty: row.recommended_qty,
        normalizedQty: row.normalized_qty,
        rawQty: row.raw_qty,
        suggestedLeverage: row.suggested_leverage,
        riskPerTradePct: row.risk_per_trade_pct,
        stopDistancePct: row.stop_distance_pct,
        win: isWin(direction, endMovePct)
      };
    });
  }

  private groupBy(
    field:
      | "type"
      | "setup_type"
      | "opportunity_verdict"
      | "dnt_action"
      | "dnt_severity"
      | "alert_priority"
      | "symbol"
      | "source",
    filters: SignalStatisticsFilters
  ): SignalStatisticsBucket[] {
    const normalized = normalizeFilters(filters);
    const rows = this.queryOutcomeRows(normalized);
    const totals = this.countSignalsByField(field, normalized);
    const groupedStats = new Map<string, OutcomeStats>();

    for (const row of rows) {
      const key = (row[field] ?? "unknown").trim() || "unknown";
      const stats = groupedStats.get(key) ?? emptyStats();
      this.addOutcomeToStats(stats, row);
      groupedStats.set(key, stats);
    }

    for (const key of totals.keys()) {
      if (!groupedStats.has(key)) {
        groupedStats.set(key, emptyStats());
      }
    }

    return Array.from(groupedStats.entries())
      .map(([key, stats]) => createBucket(key, totals.get(key) ?? 0, stats))
      .sort(
        (left, right) =>
          right.total_outcomes - left.total_outcomes ||
          right.total_signals - left.total_signals ||
          left.key.localeCompare(right.key)
      )
      .slice(0, normalized.limit);
  }

  private aggregateOutcomeRows(rows: SignalOutcomeRow[]): OutcomeStats {
    const stats = emptyStats();

    for (const row of rows) {
      this.addOutcomeToStats(stats, row);
    }

    return stats;
  }

  private addOutcomeToStats(stats: OutcomeStats, row: SignalOutcomeRow): void {
    const outcome = parseOutcomeJson(row.outcome_json);
    const direction = normalizeDirection(outcome.direction);
    const endMovePct = calculateEndMovePct(row, outcome);

    stats.totalOutcomes += 1;
    stats.favorableSum += row.max_favorable_pct ?? 0;
    stats.adverseSum += row.max_adverse_pct ?? 0;
    stats.endMoveSum += endMovePct;
    stats.wins += isWin(direction, endMovePct) ? 1 : 0;
    stats.bestMovePct =
      stats.bestMovePct === null ? endMovePct : Math.max(stats.bestMovePct, endMovePct);
    stats.worstMovePct =
      stats.worstMovePct === null ? endMovePct : Math.min(stats.worstMovePct, endMovePct);
  }

  private countSignals(filters: NormalizedFilters): number {
    const clauses = this.buildSignalClauses(filters);
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM signals s ${clauses.sql}`)
      .get(...clauses.params) as { count: number };

    return row.count;
  }

  private countSignalsByField(
    field:
      | "type"
      | "setup_type"
      | "opportunity_verdict"
      | "dnt_action"
      | "dnt_severity"
      | "alert_priority"
      | "symbol"
      | "source",
    filters: NormalizedFilters
  ): Map<string, number> {
    const clauses = this.buildSignalClauses(filters);
    const rows = this.db
      .prepare(
        `
          SELECT COALESCE(NULLIF(TRIM(s.${field}), ''), 'unknown') AS key, COUNT(*) AS count
          FROM signals s
          ${clauses.sql}
          GROUP BY key
        `
      )
      .all(...clauses.params) as Array<{ key: string; count: number }>;

    return new Map(rows.map((row) => [row.key, row.count]));
  }

  private queryOutcomeRows(filters: NormalizedFilters): SignalOutcomeRow[] {
    const clauses = this.buildOutcomeClauses(filters);

    return this.db
      .prepare(
        `
          SELECT
            s.id AS signal_id,
            s.symbol,
            s.type,
            s.setup_type,
            s.opportunity_verdict,
            s.dnt_allowed,
            s.dnt_severity,
            s.dnt_action,
            s.alert_priority,
            s.alert_rank_score,
            s.alert_suppress,
            s.source,
            s.severity,
            s.created_at AS signal_created_at,
            o.created_at AS outcome_created_at,
            o.horizon_sec,
            o.start_price,
            o.end_price,
            o.max_favorable_pct,
            o.max_adverse_pct,
            s.recommended_notional,
            s.recommended_qty,
            s.normalized_qty,
            s.raw_qty,
            s.suggested_leverage,
            s.risk_per_trade_pct,
            s.stop_distance_pct,
            o.outcome_json
          FROM signal_outcomes o
          JOIN signals s ON s.id = o.signal_id
          ${clauses.sql}
          ORDER BY o.created_at DESC
          LIMIT ?
        `
      )
      .all(...clauses.params, filters.limit) as SignalOutcomeRow[];
  }

  private buildSignalClauses(filters: NormalizedFilters): { sql: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];

    this.addCommonSignalClauses(clauses, params, filters);

    return {
      sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
      params
    };
  }

  private buildOutcomeClauses(filters: NormalizedFilters): { sql: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];

    this.addCommonSignalClauses(clauses, params, filters);

    if (filters.horizonSec !== null) {
      clauses.push("o.horizon_sec = ?");
      params.push(filters.horizonSec);
    }

    return {
      sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
      params
    };
  }

  private addCommonSignalClauses(
    clauses: string[],
    params: unknown[],
    filters: NormalizedFilters
  ): void {
    if (filters.sinceMs !== null) {
      clauses.push("s.created_at >= ?");
      params.push(Date.now() - filters.sinceMs);
    }

    if (filters.symbol !== null) {
      clauses.push("s.symbol = ?");
      params.push(filters.symbol);
    }

    if (filters.type !== null) {
      clauses.push("s.type = ?");
      params.push(filters.type);
    }

    if (filters.source !== null) {
      clauses.push("s.source = ?");
      params.push(filters.source);
    }

    if (filters.setupType !== null) {
      clauses.push("s.setup_type = ?");
      params.push(filters.setupType);
    }

    if (filters.opportunityVerdict !== null) {
      clauses.push("s.opportunity_verdict = ?");
      params.push(filters.opportunityVerdict);
    }

    if (filters.doNotTradeAction !== null) {
      clauses.push("s.dnt_action = ?");
      params.push(filters.doNotTradeAction);
    }

    if (filters.doNotTradeSeverity !== null) {
      clauses.push("s.dnt_severity = ?");
      params.push(filters.doNotTradeSeverity);
    }

    if (filters.alertPriority !== null) {
      clauses.push("s.alert_priority = ?");
      params.push(filters.alertPriority);
    }
  }
}

export const signalStatisticsService = new SignalStatisticsService();
