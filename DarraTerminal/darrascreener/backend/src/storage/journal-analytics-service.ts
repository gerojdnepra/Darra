import type Database from "better-sqlite3";
import { getSqlite } from "./sqlite";

export type JournalAnalyticsGroupField =
  | "setup_type"
  | "opportunity_verdict"
  | "symbol"
  | "side";

export interface JournalAnalyticsFilters {
  sinceMs?: number;
  limit?: number;
  symbol?: string;
  side?: string;
  setupType?: string;
  opportunityVerdict?: string;
}

export interface JournalAnalyticsBucket {
  key: string;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate_pct: number;
  total_pnl: number;
  avg_pnl: number;
  best_trade_pnl: number;
  worst_trade_pnl: number;
  avg_size: number;
  long_trades: number;
  short_trades: number;
}

export interface JournalAnalyticsPayload {
  summary: JournalAnalyticsBucket;
  bySetupType: JournalAnalyticsBucket[];
  byOpportunityVerdict: JournalAnalyticsBucket[];
  bySymbol: JournalAnalyticsBucket[];
  bySide: JournalAnalyticsBucket[];
}

interface NormalizedFilters {
  sinceMs: number | null;
  limit: number;
  symbol: string | null;
  side: string | null;
  setupType: string | null;
  opportunityVerdict: string | null;
}

interface JournalAnalyticsRow {
  key?: string | null;
  total_trades: number | null;
  winning_trades: number | null;
  losing_trades: number | null;
  total_pnl: number | null;
  avg_pnl: number | null;
  best_trade_pnl: number | null;
  worst_trade_pnl: number | null;
  avg_size: number | null;
  long_trades: number | null;
  short_trades: number | null;
}

const normalizeLimit = (value: number | undefined): number =>
  Math.min(Math.max(Math.trunc(value ?? 50), 1), 500);

const normalizeString = (value: string | undefined, uppercase = false): string | null => {
  const normalized = value?.trim();

  if (!normalized || normalized.toLowerCase() === "all") {
    return null;
  }

  return uppercase ? normalized.toUpperCase() : normalized;
};

const normalizeFilters = (filters: JournalAnalyticsFilters = {}): NormalizedFilters => ({
  sinceMs:
    typeof filters.sinceMs === "number" && Number.isFinite(filters.sinceMs) && filters.sinceMs > 0
      ? filters.sinceMs
      : null,
  limit: normalizeLimit(filters.limit),
  symbol: normalizeString(filters.symbol, true),
  side: normalizeString(filters.side),
  setupType: normalizeString(filters.setupType),
  opportunityVerdict: normalizeString(filters.opportunityVerdict)
});

const roundMetric = (value: number): number => Math.round(value * 10_000) / 10_000;

const emptyBucket = (key = "summary"): JournalAnalyticsBucket => ({
  key,
  total_trades: 0,
  winning_trades: 0,
  losing_trades: 0,
  win_rate_pct: 0,
  total_pnl: 0,
  avg_pnl: 0,
  best_trade_pnl: 0,
  worst_trade_pnl: 0,
  avg_size: 0,
  long_trades: 0,
  short_trades: 0
});

const toBucket = (row: JournalAnalyticsRow | undefined, key = "summary"): JournalAnalyticsBucket => {
  if (!row || !row.total_trades) {
    return emptyBucket(key);
  }

  const totalTrades = row.total_trades;
  const winningTrades = row.winning_trades ?? 0;

  return {
    key,
    total_trades: totalTrades,
    winning_trades: winningTrades,
    losing_trades: row.losing_trades ?? 0,
    win_rate_pct: totalTrades > 0 ? roundMetric((winningTrades / totalTrades) * 100) : 0,
    total_pnl: roundMetric(row.total_pnl ?? 0),
    avg_pnl: roundMetric(row.avg_pnl ?? 0),
    best_trade_pnl: roundMetric(row.best_trade_pnl ?? 0),
    worst_trade_pnl: roundMetric(row.worst_trade_pnl ?? 0),
    avg_size: roundMetric(row.avg_size ?? 0),
    long_trades: row.long_trades ?? 0,
    short_trades: row.short_trades ?? 0
  };
};

const groupExpression = (field: JournalAnalyticsGroupField): string => {
  if (field === "setup_type") {
    return "COALESCE(NULLIF(TRIM(s.setup_type), ''), 'unknown')";
  }

  if (field === "opportunity_verdict") {
    return "COALESCE(NULLIF(TRIM(s.opportunity_verdict), ''), 'unknown')";
  }

  if (field === "symbol") {
    return "COALESCE(NULLIF(TRIM(j.symbol), ''), 'unknown')";
  }

  return "COALESCE(NULLIF(TRIM(j.side), ''), 'unknown')";
};

const metricSelect = `
  COUNT(*) AS total_trades,
  SUM(CASE WHEN COALESCE(j.pnl, 0) > 0 THEN 1 ELSE 0 END) AS winning_trades,
  SUM(CASE WHEN COALESCE(j.pnl, 0) < 0 THEN 1 ELSE 0 END) AS losing_trades,
  COALESCE(SUM(j.pnl), 0) AS total_pnl,
  COALESCE(AVG(j.pnl), 0) AS avg_pnl,
  COALESCE(MAX(j.pnl), 0) AS best_trade_pnl,
  COALESCE(MIN(j.pnl), 0) AS worst_trade_pnl,
  COALESCE(AVG(j.size), 0) AS avg_size,
  SUM(CASE WHEN j.side = 'long' THEN 1 ELSE 0 END) AS long_trades,
  SUM(CASE WHEN j.side = 'short' THEN 1 ELSE 0 END) AS short_trades
`;

export class JournalAnalyticsService {
  constructor(private readonly db: Database.Database = getSqlite()) {}

  getJournalAnalytics(filters: JournalAnalyticsFilters = {}): JournalAnalyticsPayload {
    return {
      summary: this.getSummary(filters),
      bySetupType: this.getJournalBySetupType(filters),
      byOpportunityVerdict: this.getJournalByOpportunityVerdict(filters),
      bySymbol: this.getJournalBySymbol(filters),
      bySide: this.getJournalBySide(filters)
    };
  }

  getSummary(filters: JournalAnalyticsFilters = {}): JournalAnalyticsBucket {
    const normalized = normalizeFilters(filters);
    const clauses = this.buildClauses(normalized);
    const row = this.db
      .prepare(
        `
          SELECT ${metricSelect}
          FROM journal_entries j
          LEFT JOIN signals s ON s.id = j.signal_id
          ${clauses.sql}
        `
      )
      .get(...clauses.params) as JournalAnalyticsRow | undefined;

    return toBucket(row);
  }

  getJournalBySetupType(filters: JournalAnalyticsFilters = {}): JournalAnalyticsBucket[] {
    return this.groupBy("setup_type", filters);
  }

  getJournalBySymbol(filters: JournalAnalyticsFilters = {}): JournalAnalyticsBucket[] {
    return this.groupBy("symbol", filters);
  }

  getJournalBySide(filters: JournalAnalyticsFilters = {}): JournalAnalyticsBucket[] {
    return this.groupBy("side", filters);
  }

  getJournalByOpportunityVerdict(filters: JournalAnalyticsFilters = {}): JournalAnalyticsBucket[] {
    return this.groupBy("opportunity_verdict", filters);
  }

  private groupBy(
    field: JournalAnalyticsGroupField,
    filters: JournalAnalyticsFilters
  ): JournalAnalyticsBucket[] {
    const normalized = normalizeFilters(filters);
    const clauses = this.buildClauses(normalized);
    const keyExpression = groupExpression(field);
    const rows = this.db
      .prepare(
        `
          SELECT
            ${keyExpression} AS key,
            ${metricSelect}
          FROM journal_entries j
          LEFT JOIN signals s ON s.id = j.signal_id
          ${clauses.sql}
          GROUP BY key
          ORDER BY total_trades DESC, total_pnl DESC, key ASC
          LIMIT ?
        `
      )
      .all(...clauses.params, normalized.limit) as JournalAnalyticsRow[];

    return rows.map((row) => toBucket(row, row.key?.trim() || "unknown"));
  }

  private buildClauses(filters: NormalizedFilters): { sql: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters.sinceMs !== null) {
      clauses.push("j.created_at >= ?");
      params.push(Date.now() - filters.sinceMs);
    }

    if (filters.symbol !== null) {
      clauses.push("j.symbol = ?");
      params.push(filters.symbol);
    }

    if (filters.side !== null) {
      clauses.push("j.side = ?");
      params.push(filters.side);
    }

    if (filters.setupType !== null) {
      clauses.push("s.setup_type = ?");
      params.push(filters.setupType);
    }

    if (filters.opportunityVerdict !== null) {
      clauses.push("s.opportunity_verdict = ?");
      params.push(filters.opportunityVerdict);
    }

    return {
      sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
      params
    };
  }
}

export const journalAnalyticsService = new JournalAnalyticsService();
