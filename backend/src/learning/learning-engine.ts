import type Database from "better-sqlite3";
import { getSqlite } from "../storage/sqlite";

export type LearningGroup =
  | "setup"
  | "opportunity"
  | "alertPriority"
  | "symbol"
  | "direction";

export interface LearningReportFilters {
  sinceMs?: number;
  horizonSec?: number;
  limit?: number;
}

export interface LearningPerformanceBucket {
  key: string;
  total_signals: number;
  total_outcomes: number;
  win_rate: number;
  avg_move: number;
  avg_favorable: number;
  avg_adverse: number;
  avg_pnl: number;
  confidence_score: number;
}

export interface LearningRecommendations {
  preferredSetups: string[];
  weakSetups: string[];
  setupsToAvoid: string[];
  symbolsToAvoid: string[];
  symbolsPerformingBest: string[];
}

export interface LearningReportInsights {
  bestSetup: string | null;
  bestOpportunityVerdict: string | null;
  bestAlertPriority: string | null;
  overestimatedVerdicts: string[];
  uselessAlertPriorities: string[];
}

export interface LearningReportPayload {
  generatedAt: number;
  filters: {
    sinceMs: number | null;
    horizonSec: number | null;
    limit: number;
  };
  setupPerformance: LearningPerformanceBucket[];
  opportunityPerformance: LearningPerformanceBucket[];
  alertPriorityPerformance: LearningPerformanceBucket[];
  symbolPerformance: LearningPerformanceBucket[];
  directionPerformance: LearningPerformanceBucket[];
  recommendations: LearningRecommendations;
  insights: LearningReportInsights;
}

interface NormalizedFilters {
  sinceMs: number | null;
  horizonSec: number | null;
  limit: number;
}

interface OutcomeRow {
  signal_id: string;
  symbol: string;
  setup_type: string | null;
  opportunity_verdict: string | null;
  alert_priority: string | null;
  setup_direction: string | null;
  start_price: number | null;
  end_price: number | null;
  max_favorable_pct: number | null;
  max_adverse_pct: number | null;
  outcome_json: string;
}

interface GroupStats {
  totalOutcomes: number;
  wins: number;
  moveSum: number;
  favorableSum: number;
  adverseSum: number;
}

const opportunityKeys = ["TRADE", "WAIT", "DO_NOT_TRADE"] as const;
const alertPriorityKeys = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "IGNORE"] as const;
const MIN_RECOMMENDATION_OUTCOMES = 30;
const directionKeys = ["LONG", "SHORT"] as const;

const emptyStats = (): GroupStats => ({
  totalOutcomes: 0,
  wins: 0,
  moveSum: 0,
  favorableSum: 0,
  adverseSum: 0
});

const roundMetric = (value: number): number => Math.round(value * 10_000) / 10_000;

const normalizeLimit = (value: number | undefined): number =>
  Math.min(Math.max(Math.trunc(value ?? 50), 1), 500);

const normalizeFilters = (filters: LearningReportFilters = {}): NormalizedFilters => ({
  sinceMs:
    typeof filters.sinceMs === "number" && Number.isFinite(filters.sinceMs) && filters.sinceMs > 0
      ? filters.sinceMs
      : null,
  horizonSec:
    typeof filters.horizonSec === "number" &&
    Number.isFinite(filters.horizonSec) &&
    filters.horizonSec > 0
      ? Math.trunc(filters.horizonSec)
      : null,
  limit: normalizeLimit(filters.limit)
});

const normalizeKey = (value: string | null | undefined, fallback = "UNKNOWN"): string => {
  const normalized = value?.trim();
  return normalized ? normalized.toUpperCase() : fallback;
};

const normalizeDirection = (value: unknown): "LONG" | "SHORT" | "UNKNOWN" => {
  if (typeof value !== "string") {
    return "UNKNOWN";
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "long") {
    return "LONG";
  }

  if (normalized === "short") {
    return "SHORT";
  }

  return "UNKNOWN";
};

const parseOutcomeJson = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const getEndMovePct = (row: OutcomeRow, outcome: Record<string, unknown>): number => {
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

const getDirectionalMove = (direction: string, rawMovePct: number): number => {
  if (direction === "LONG") {
    return rawMovePct;
  }

  if (direction === "SHORT") {
    return -rawMovePct;
  }

  return Math.abs(rawMovePct);
};

const getScore = (
  totalOutcomes: number,
  winRate: number,
  avgMove: number,
  avgFavorable: number,
  avgAdverse: number,
  avgPnl: number
): number => {
  const sampleConfidence = Math.min(1, Math.sqrt(totalOutcomes / 100));
  const expectancy = Math.max(-1, Math.min(1, avgMove / 2));
  const excursionQuality =
    avgFavorable + avgAdverse > 0 ? (avgFavorable - avgAdverse) / (avgFavorable + avgAdverse) : 0;
  const pnlQuality = Math.max(-1, Math.min(1, avgPnl / 100));
  const rawScore =
    ((winRate / 100) * 0.45 + expectancy * 0.25 + excursionQuality * 0.2 + pnlQuality * 0.1) *
    sampleConfidence;

  return roundMetric(Math.max(0, Math.min(1, rawScore)));
};

const createBucket = (
  key: string,
  totalSignals: number,
  stats: GroupStats,
  avgPnl: number
): LearningPerformanceBucket => {
  const winRate =
    stats.totalOutcomes > 0 ? roundMetric((stats.wins / stats.totalOutcomes) * 100) : 0;
  const avgMove = stats.totalOutcomes > 0 ? roundMetric(stats.moveSum / stats.totalOutcomes) : 0;
  const avgFavorable =
    stats.totalOutcomes > 0 ? roundMetric(stats.favorableSum / stats.totalOutcomes) : 0;
  const avgAdverse =
    stats.totalOutcomes > 0 ? roundMetric(stats.adverseSum / stats.totalOutcomes) : 0;

  return {
    key,
    total_signals: totalSignals,
    total_outcomes: stats.totalOutcomes,
    win_rate: winRate,
    avg_move: avgMove,
    avg_favorable: avgFavorable,
    avg_adverse: avgAdverse,
    avg_pnl: roundMetric(avgPnl),
    confidence_score: getScore(
      stats.totalOutcomes,
      winRate,
      avgMove,
      avgFavorable,
      avgAdverse,
      avgPnl
    )
  };
};

const sortPerformance = (rows: LearningPerformanceBucket[]): LearningPerformanceBucket[] =>
  rows.sort(
    (left, right) =>
      right.confidence_score - left.confidence_score ||
      right.avg_pnl - left.avg_pnl ||
      right.avg_move - left.avg_move ||
      right.total_outcomes - left.total_outcomes ||
      left.key.localeCompare(right.key)
  );

export class LearningEngine {
  constructor(private readonly db: Database.Database = getSqlite()) {}

  getLearningReport(filters: LearningReportFilters = {}): LearningReportPayload {
    const normalized = normalizeFilters(filters);
    const rows = this.queryOutcomeRows(normalized);

    const setupPerformance = this.buildPerformance("setup", rows, normalized);
    const opportunityPerformance = this.buildPerformance("opportunity", rows, normalized);
    const alertPriorityPerformance = this.buildPerformance("alertPriority", rows, normalized);
    const symbolPerformance = this.buildPerformance("symbol", rows, normalized);
    const directionPerformance = this.buildPerformance("direction", rows, normalized);
    const confidentSetups = setupPerformance.filter(
      (row) => row.total_outcomes >= MIN_RECOMMENDATION_OUTCOMES
    );
    const confidentOpportunities = opportunityPerformance.filter(
      (row) => row.total_outcomes >= MIN_RECOMMENDATION_OUTCOMES
    );
    const confidentAlertPriorities = alertPriorityPerformance.filter(
      (row) => row.total_outcomes >= MIN_RECOMMENDATION_OUTCOMES
    );
    const confidentSymbols = symbolPerformance.filter(
      (row) => row.total_outcomes >= MIN_RECOMMENDATION_OUTCOMES
    );

    return {
      generatedAt: Date.now(),
      filters: normalized,
      setupPerformance,
      opportunityPerformance,
      alertPriorityPerformance,
      symbolPerformance,
      directionPerformance,
      recommendations: {
        preferredSetups: confidentSetups
          .filter((row) => row.confidence_score >= 0.45)
          .slice(0, 5)
          .map((row) => row.key),
        weakSetups: confidentSetups
          .filter((row) => row.confidence_score < 0.45)
          .slice(0, 5)
          .map((row) => row.key),
        setupsToAvoid: confidentSetups
          .filter((row) => row.win_rate < 35 || row.avg_move < 0)
          .sort((left, right) => left.confidence_score - right.confidence_score)
          .slice(0, 5)
          .map((row) => row.key),
        symbolsToAvoid: confidentSymbols
          .filter((row) => row.win_rate < 35 || row.avg_move < 0)
          .sort((left, right) => left.confidence_score - right.confidence_score)
          .slice(0, 8)
          .map((row) => row.key),
        symbolsPerformingBest: confidentSymbols
          .filter((row) => row.confidence_score >= 0.45)
          .slice(0, 8)
          .map((row) => row.key)
      },
      insights: {
        bestSetup: confidentSetups[0]?.key ?? null,
        bestOpportunityVerdict: confidentOpportunities[0]?.key ?? null,
        bestAlertPriority: confidentAlertPriorities[0]?.key ?? null,
        overestimatedVerdicts: confidentOpportunities
          .filter(
            (row) =>
              (row.key === "TRADE" || row.key === "WAIT") &&
              (row.win_rate < 45 || row.avg_move <= 0)
          )
          .map((row) => row.key),
        uselessAlertPriorities: confidentAlertPriorities
          .filter(
            (row) =>
              (row.key === "CRITICAL" || row.key === "HIGH" || row.key === "MEDIUM") &&
              (row.win_rate < 40 || row.avg_move <= 0)
          )
          .map((row) => row.key)
      }
    };
  }

  private buildPerformance(
    group: LearningGroup,
    rows: OutcomeRow[],
    filters: NormalizedFilters
  ): LearningPerformanceBucket[] {
    const statsByKey = new Map<string, GroupStats>();
    const totalSignalsByKey = this.countSignalsByGroup(group, filters);
    const pnlByKey = this.getAveragePnlByGroup(group, filters);

    for (const row of rows) {
      const outcome = parseOutcomeJson(row.outcome_json);
      const direction = normalizeDirection(outcome.direction ?? row.setup_direction);
      const key = this.getOutcomeGroupKey(group, row, direction);

      if (key === "UNKNOWN" && group === "direction") {
        continue;
      }

      const rawMovePct = getEndMovePct(row, outcome);
      const directionalMove = getDirectionalMove(direction, rawMovePct);
      const stats = statsByKey.get(key) ?? emptyStats();

      stats.totalOutcomes += 1;
      stats.wins += directionalMove > 0 ? 1 : 0;
      stats.moveSum += directionalMove;
      stats.favorableSum += row.max_favorable_pct ?? 0;
      stats.adverseSum += row.max_adverse_pct ?? 0;
      statsByKey.set(key, stats);
    }

    for (const key of this.requiredKeys(group)) {
      if (!statsByKey.has(key)) {
        statsByKey.set(key, emptyStats());
      }

      if (!totalSignalsByKey.has(key)) {
        totalSignalsByKey.set(key, 0);
      }
    }

    for (const key of totalSignalsByKey.keys()) {
      if (!statsByKey.has(key)) {
        statsByKey.set(key, emptyStats());
      }
    }

    return sortPerformance(
      Array.from(statsByKey.entries()).map(([key, stats]) =>
        createBucket(key, totalSignalsByKey.get(key) ?? 0, stats, pnlByKey.get(key) ?? 0)
      )
    ).slice(0, filters.limit);
  }

  private requiredKeys(group: LearningGroup): string[] {
    if (group === "opportunity") {
      return [...opportunityKeys];
    }

    if (group === "alertPriority") {
      return [...alertPriorityKeys];
    }

    if (group === "direction") {
      return [...directionKeys];
    }

    return [];
  }

  private getOutcomeGroupKey(
    group: LearningGroup,
    row: OutcomeRow,
    direction: "LONG" | "SHORT" | "UNKNOWN"
  ): string {
    if (group === "setup") {
      return normalizeKey(row.setup_type);
    }

    if (group === "opportunity") {
      return normalizeKey(row.opportunity_verdict);
    }

    if (group === "alertPriority") {
      return normalizeKey(row.alert_priority);
    }

    if (group === "symbol") {
      return normalizeKey(row.symbol);
    }

    return direction;
  }

  private queryOutcomeRows(filters: NormalizedFilters): OutcomeRow[] {
    const clauses = this.buildOutcomeClauses(filters);

    return this.db
      .prepare(
        `
          SELECT
            s.id AS signal_id,
            s.symbol,
            s.setup_type,
            s.opportunity_verdict,
            s.alert_priority,
            s.setup_direction,
            o.start_price,
            o.end_price,
            o.max_favorable_pct,
            o.max_adverse_pct,
            o.outcome_json
          FROM signal_outcomes o
          JOIN signals s ON s.id = o.signal_id
          ${clauses.sql}
          ORDER BY o.created_at DESC
        `
      )
      .all(...clauses.params) as OutcomeRow[];
  }

  private countSignalsByGroup(
    group: LearningGroup,
    filters: NormalizedFilters
  ): Map<string, number> {
    const clauses = this.buildSignalClauses(filters);
    const keyExpression = this.signalGroupExpression(group);
    const rows = this.db
      .prepare(
        `
          SELECT ${keyExpression} AS key, COUNT(*) AS count
          FROM signals s
          ${clauses.sql}
          GROUP BY key
        `
      )
      .all(...clauses.params) as Array<{ key: string | null; count: number }>;

    return new Map(rows.map((row) => [normalizeKey(row.key), row.count]));
  }

  private getAveragePnlByGroup(
    group: LearningGroup,
    filters: NormalizedFilters
  ): Map<string, number> {
    const clauses = this.buildJournalClauses(filters);
    const keyExpression = this.journalGroupExpression(group);
    const rows = this.db
      .prepare(
        `
          SELECT ${keyExpression} AS key, COALESCE(AVG(j.pnl), 0) AS avg_pnl
          FROM journal_entries j
          LEFT JOIN signals s ON s.id = j.signal_id
          ${clauses.sql}
          GROUP BY key
        `
      )
      .all(...clauses.params) as Array<{ key: string | null; avg_pnl: number | null }>;

    return new Map(rows.map((row) => [normalizeKey(row.key), roundMetric(row.avg_pnl ?? 0)]));
  }

  private signalGroupExpression(group: LearningGroup): string {
    if (group === "setup") {
      return "COALESCE(NULLIF(TRIM(s.setup_type), ''), 'UNKNOWN')";
    }

    if (group === "opportunity") {
      return "COALESCE(NULLIF(TRIM(s.opportunity_verdict), ''), 'UNKNOWN')";
    }

    if (group === "alertPriority") {
      return "COALESCE(NULLIF(TRIM(s.alert_priority), ''), 'UNKNOWN')";
    }

    if (group === "symbol") {
      return "COALESCE(NULLIF(TRIM(s.symbol), ''), 'UNKNOWN')";
    }

    return "UPPER(COALESCE(NULLIF(TRIM(s.setup_direction), ''), 'UNKNOWN'))";
  }

  private journalGroupExpression(group: LearningGroup): string {
    if (group === "setup") {
      return "COALESCE(NULLIF(TRIM(s.setup_type), ''), 'UNKNOWN')";
    }

    if (group === "opportunity") {
      return "COALESCE(NULLIF(TRIM(s.opportunity_verdict), ''), 'UNKNOWN')";
    }

    if (group === "alertPriority") {
      return "COALESCE(NULLIF(TRIM(s.alert_priority), ''), 'UNKNOWN')";
    }

    if (group === "symbol") {
      return "COALESCE(NULLIF(TRIM(j.symbol), ''), 'UNKNOWN')";
    }

    return "UPPER(COALESCE(NULLIF(TRIM(j.side), ''), 'UNKNOWN'))";
  }

  private buildSignalClauses(filters: NormalizedFilters): { sql: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters.sinceMs !== null) {
      clauses.push("s.created_at >= ?");
      params.push(Date.now() - filters.sinceMs);
    }

    return {
      sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
      params
    };
  }

  private buildOutcomeClauses(filters: NormalizedFilters): { sql: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters.sinceMs !== null) {
      clauses.push("s.created_at >= ?");
      params.push(Date.now() - filters.sinceMs);
    }

    if (filters.horizonSec !== null) {
      clauses.push("o.horizon_sec = ?");
      params.push(filters.horizonSec);
    }

    return {
      sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
      params
    };
  }

  private buildJournalClauses(filters: NormalizedFilters): { sql: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters.sinceMs !== null) {
      clauses.push("j.created_at >= ?");
      params.push(Date.now() - filters.sinceMs);
    }

    return {
      sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
      params
    };
  }
}

export const learningEngine = new LearningEngine();
