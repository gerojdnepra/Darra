import type Database from "better-sqlite3";

interface Migration {
  id: number;
  name: string;
  sql?: string;
  up?: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    id: 1,
    name: "create_signal_foundation_tables",
    sql: `
      CREATE TABLE IF NOT EXISTS signals (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        type TEXT NOT NULL,
        severity TEXT,
        source TEXT,
        price REAL,
        score REAL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS signal_features (
        id TEXT PRIMARY KEY,
        signal_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        feature_json TEXT NOT NULL,
        FOREIGN KEY(signal_id) REFERENCES signals(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS signal_outcomes (
        id TEXT PRIMARY KEY,
        signal_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        horizon_sec INTEGER NOT NULL,
        start_price REAL,
        end_price REAL,
        max_favorable_pct REAL,
        max_adverse_pct REAL,
        outcome_json TEXT NOT NULL,
        FOREIGN KEY(signal_id) REFERENCES signals(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS journal_entries (
        id TEXT PRIMARY KEY,
        signal_id TEXT,
        symbol TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        side TEXT,
        entry_price REAL,
        exit_price REAL,
        size REAL,
        pnl REAL,
        notes TEXT,
        tags_json TEXT,
        FOREIGN KEY(signal_id) REFERENCES signals(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_signals_symbol_created_at
        ON signals(symbol, created_at);

      CREATE INDEX IF NOT EXISTS idx_signals_type_created_at
        ON signals(type, created_at);

      CREATE INDEX IF NOT EXISTS idx_signal_features_signal_id
        ON signal_features(signal_id);

      CREATE INDEX IF NOT EXISTS idx_signal_outcomes_signal_id_horizon_sec
        ON signal_outcomes(signal_id, horizon_sec);

      CREATE INDEX IF NOT EXISTS idx_journal_entries_symbol_created_at
        ON journal_entries(symbol, created_at);
    `
  },
  {
    id: 2,
    name: "add_signal_setup_classification_columns",
    up: (db) => {
      const columns = new Set(
        (db.prepare("PRAGMA table_info(signals)").all() as Array<{ name: string }>).map(
          (column) => column.name
        )
      );

      if (!columns.has("setup_type")) {
        db.exec("ALTER TABLE signals ADD COLUMN setup_type TEXT");
      }

      if (!columns.has("setup_confidence")) {
        db.exec("ALTER TABLE signals ADD COLUMN setup_confidence REAL");
      }

      if (!columns.has("setup_direction")) {
        db.exec("ALTER TABLE signals ADD COLUMN setup_direction TEXT");
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_signals_setup_type_created_at
          ON signals(setup_type, created_at);
      `);
    }
  },
  {
    id: 3,
    name: "add_signal_opportunity_score_columns",
    up: (db) => {
      const columns = new Set(
        (db.prepare("PRAGMA table_info(signals)").all() as Array<{ name: string }>).map(
          (column) => column.name
        )
      );

      if (!columns.has("opportunity_verdict")) {
        db.exec("ALTER TABLE signals ADD COLUMN opportunity_verdict TEXT");
      }

      if (!columns.has("opportunity_score")) {
        db.exec("ALTER TABLE signals ADD COLUMN opportunity_score REAL");
      }

      if (!columns.has("opportunity_confidence")) {
        db.exec("ALTER TABLE signals ADD COLUMN opportunity_confidence REAL");
      }

      if (!columns.has("opportunity_risk_level")) {
        db.exec("ALTER TABLE signals ADD COLUMN opportunity_risk_level TEXT");
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_signals_opportunity_verdict_created_at
          ON signals(opportunity_verdict, created_at);
      `);
    }
  },
  {
    id: 4,
    name: "add_signal_position_sizing_columns",
    up: (db) => {
      const columns = new Set(
        (db.prepare("PRAGMA table_info(signals)").all() as Array<{ name: string }>).map(
          (column) => column.name
        )
      );

      if (!columns.has("recommended_notional")) {
        db.exec("ALTER TABLE signals ADD COLUMN recommended_notional REAL");
      }

      if (!columns.has("recommended_qty")) {
        db.exec("ALTER TABLE signals ADD COLUMN recommended_qty REAL");
      }

      if (!columns.has("suggested_leverage")) {
        db.exec("ALTER TABLE signals ADD COLUMN suggested_leverage REAL");
      }

      if (!columns.has("risk_per_trade_pct")) {
        db.exec("ALTER TABLE signals ADD COLUMN risk_per_trade_pct REAL");
      }

      if (!columns.has("stop_distance_pct")) {
        db.exec("ALTER TABLE signals ADD COLUMN stop_distance_pct REAL");
      }
    }
  },
  {
    id: 5,
    name: "add_signal_exchange_filter_sizing_columns",
    up: (db) => {
      const columns = new Set(
        (db.prepare("PRAGMA table_info(signals)").all() as Array<{ name: string }>).map(
          (column) => column.name
        )
      );

      if (!columns.has("normalized_qty")) {
        db.exec("ALTER TABLE signals ADD COLUMN normalized_qty REAL");
      }

      if (!columns.has("raw_qty")) {
        db.exec("ALTER TABLE signals ADD COLUMN raw_qty REAL");
      }
    }
  },
  {
    id: 6,
    name: "add_signal_do_not_trade_columns",
    up: (db) => {
      const columns = new Set(
        (db.prepare("PRAGMA table_info(signals)").all() as Array<{ name: string }>).map(
          (column) => column.name
        )
      );

      if (!columns.has("dnt_allowed")) {
        db.exec("ALTER TABLE signals ADD COLUMN dnt_allowed INTEGER");
      }

      if (!columns.has("dnt_severity")) {
        db.exec("ALTER TABLE signals ADD COLUMN dnt_severity TEXT");
      }

      if (!columns.has("dnt_action")) {
        db.exec("ALTER TABLE signals ADD COLUMN dnt_action TEXT");
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_signals_dnt_action_created_at
          ON signals(dnt_action, created_at);

        CREATE INDEX IF NOT EXISTS idx_signals_dnt_severity_created_at
          ON signals(dnt_severity, created_at);
      `);
    }
  },
  {
    id: 7,
    name: "add_signal_alert_ranking_columns",
    up: (db) => {
      const columns = new Set(
        (db.prepare("PRAGMA table_info(signals)").all() as Array<{ name: string }>).map(
          (column) => column.name
        )
      );

      if (!columns.has("alert_priority")) {
        db.exec("ALTER TABLE signals ADD COLUMN alert_priority TEXT");
      }

      if (!columns.has("alert_rank_score")) {
        db.exec("ALTER TABLE signals ADD COLUMN alert_rank_score REAL");
      }

      if (!columns.has("alert_suppress")) {
        db.exec("ALTER TABLE signals ADD COLUMN alert_suppress INTEGER");
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_signals_alert_priority_created_at
          ON signals(alert_priority, created_at);
      `);
    }
  }
];

export const applyMigrations = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const hasMigration = db
    .prepare("SELECT 1 FROM schema_migrations WHERE id = ?")
    .pluck() as Database.Statement<[number], 1 | undefined>;
  const insertMigration = db.prepare(
    "INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)"
  );

  const runPendingMigrations = db.transaction(() => {
    for (const migration of migrations) {
      if (hasMigration.get(migration.id)) {
        continue;
      }

      if (migration.up) {
        migration.up(db);
      } else if (migration.sql) {
        db.exec(migration.sql);
      }
      insertMigration.run(migration.id, migration.name, Date.now());
    }
  });

  runPendingMigrations();
};
