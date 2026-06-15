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
  },
  {
    id: 8,
    name: "create_order_infrastructure_tables",
    sql: `
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        intent_id TEXT,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        type TEXT NOT NULL,
        quantity REAL NOT NULL,
        price REAL,
        stop_price REAL,
        stop_loss_price REAL,
        take_profit_price REAL,
        status TEXT NOT NULL,
        client_order_id TEXT NOT NULL UNIQUE,
        exchange_order_id TEXT,
        source_window_id TEXT,
        parent_order_id TEXT,
        protective_kind TEXT,
        dry_run INTEGER NOT NULL,
        reduce_only INTEGER NOT NULL,
        executed_qty REAL NOT NULL,
        avg_price REAL,
        reject_reason TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_event_source TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS order_audit_events (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        intent_id TEXT,
        timestamp INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        type TEXT NOT NULL,
        quantity REAL NOT NULL,
        price REAL,
        client_order_id TEXT NOT NULL,
        status TEXT NOT NULL,
        source_window_id TEXT,
        dry_run INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        message TEXT,
        FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS order_intents (
        intent_id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        source_window_id TEXT,
        order_id TEXT,
        response_type TEXT NOT NULL,
        dry_run INTEGER NOT NULL,
        response_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_orders_symbol_status
        ON orders(symbol, status);

      CREATE INDEX IF NOT EXISTS idx_orders_client_order_id
        ON orders(client_order_id);

      CREATE INDEX IF NOT EXISTS idx_orders_exchange_order_id
        ON orders(exchange_order_id);

      CREATE INDEX IF NOT EXISTS idx_orders_parent_order_id
        ON orders(parent_order_id);

      CREATE INDEX IF NOT EXISTS idx_orders_intent_id
        ON orders(intent_id);

      CREATE INDEX IF NOT EXISTS idx_order_audit_events_order_id_timestamp
        ON order_audit_events(order_id, timestamp);

      CREATE INDEX IF NOT EXISTS idx_order_audit_events_intent_id_timestamp
        ON order_audit_events(intent_id, timestamp);

      CREATE INDEX IF NOT EXISTS idx_order_intents_order_id
        ON order_intents(order_id);

      CREATE INDEX IF NOT EXISTS idx_order_intents_source_window_id
        ON order_intents(source_window_id);
    `
  },
  {
    id: 9,
    name: "add_order_protective_columns",
    up: (db) => {
      const columns = new Set(
        (db.prepare("PRAGMA table_info(orders)").all() as Array<{ name: string }>).map(
          (column) => column.name
        )
      );

      if (!columns.has("stop_loss_price")) {
        db.exec("ALTER TABLE orders ADD COLUMN stop_loss_price REAL");
      }

      if (!columns.has("take_profit_price")) {
        db.exec("ALTER TABLE orders ADD COLUMN take_profit_price REAL");
      }

      if (!columns.has("parent_order_id")) {
        db.exec("ALTER TABLE orders ADD COLUMN parent_order_id TEXT");
      }

      if (!columns.has("protective_kind")) {
        db.exec("ALTER TABLE orders ADD COLUMN protective_kind TEXT");
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_orders_parent_order_id
          ON orders(parent_order_id);
      `);
    }
  },
  {
    id: 10,
    name: "create_paper_positions",
    sql: `
      CREATE TABLE IF NOT EXISTS paper_positions (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        quantity REAL NOT NULL,
        entry_price REAL NOT NULL,
        entry_order_id TEXT NOT NULL UNIQUE,
        stop_loss_order_id TEXT,
        take_profit_order_id TEXT,
        status TEXT NOT NULL,
        opened_at INTEGER NOT NULL,
        closed_at INTEGER,
        close_price REAL,
        close_reason TEXT,
        realized_pnl REAL,
        unrealized_pnl REAL,
        paper_mode INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(entry_order_id) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY(stop_loss_order_id) REFERENCES orders(id) ON DELETE SET NULL,
        FOREIGN KEY(take_profit_order_id) REFERENCES orders(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_paper_positions_status_symbol
        ON paper_positions(status, symbol);

      CREATE INDEX IF NOT EXISTS idx_paper_positions_opened_at
        ON paper_positions(opened_at);

      CREATE INDEX IF NOT EXISTS idx_paper_positions_updated_at
        ON paper_positions(updated_at);
    `
  },
  {
    id: 11,
    name: "add_order_fill_detail_columns",
    up: (db) => {
      const columns = new Set(
        (db.prepare("PRAGMA table_info(orders)").all() as Array<{ name: string }>).map(
          (column) => column.name
        )
      );

      const addColumn = (name: string, definition: string): void => {
        if (!columns.has(name)) {
          db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${definition}`);
        }
      };

      addColumn("last_filled_qty", "REAL");
      addColumn("realized_pnl", "REAL");
      addColumn("commission", "REAL");
      addColumn("commission_asset", "TEXT");
      addColumn("last_execution_type", "TEXT");
      addColumn("last_trade_time", "INTEGER");
    }
  },
  {
    id: 12,
    name: "create_realized_pnl_ledger",
    sql: `
      CREATE TABLE IF NOT EXISTS realized_pnl_ledger (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        trading_day TEXT NOT NULL,
        event_time INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        order_id TEXT,
        client_order_id TEXT,
        exchange_order_id TEXT,
        trade_id TEXT,
        realized_pnl REAL NOT NULL,
        commission REAL,
        commission_asset TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_realized_pnl_ledger_trading_day_event_time
        ON realized_pnl_ledger(trading_day, event_time);

      CREATE INDEX IF NOT EXISTS idx_realized_pnl_ledger_symbol_trading_day
        ON realized_pnl_ledger(symbol, trading_day);
    `
  },
  {
    id: 13,
    name: "create_trade_decision_contexts",
    sql: `
      CREATE TABLE IF NOT EXISTS trade_decision_contexts (
        id TEXT PRIMARY KEY,
        unified_signal_id TEXT,
        symbol TEXT NOT NULL,
        decision TEXT NOT NULL,
        decision_reason TEXT,
        risk_snapshot_ref TEXT,
        preflight_id TEXT,
        preflight_nonce TEXT,
        order_intent_id TEXT,
        review_correlation_id TEXT,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER,
        payload_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_trade_decision_contexts_symbol_created_at
        ON trade_decision_contexts(symbol, created_at);

      CREATE INDEX IF NOT EXISTS idx_trade_decision_contexts_unified_signal_id
        ON trade_decision_contexts(unified_signal_id);

      CREATE INDEX IF NOT EXISTS idx_trade_decision_contexts_order_intent_id
        ON trade_decision_contexts(order_intent_id);

      CREATE INDEX IF NOT EXISTS idx_trade_decision_contexts_review_correlation_id
        ON trade_decision_contexts(review_correlation_id);
    `
  },
  {
    id: 14,
    name: "create_position_lifecycle_tables",
    sql: `
      CREATE TABLE IF NOT EXISTS position_lifecycles (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        order_intent_id TEXT,
        decision_context_id TEXT,
        unified_signal_id TEXT,
        status TEXT NOT NULL,
        opened_at INTEGER,
        closed_at INTEGER,
        updated_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_position_lifecycles_symbol_status
        ON position_lifecycles(symbol, status);

      CREATE INDEX IF NOT EXISTS idx_position_lifecycles_order_intent_id
        ON position_lifecycles(order_intent_id);

      CREATE INDEX IF NOT EXISTS idx_position_lifecycles_decision_context_id
        ON position_lifecycles(decision_context_id);

      CREATE INDEX IF NOT EXISTS idx_position_lifecycles_unified_signal_id
        ON position_lifecycles(unified_signal_id);

      CREATE INDEX IF NOT EXISTS idx_position_lifecycles_opened_at
        ON position_lifecycles(opened_at);

      CREATE TABLE IF NOT EXISTS position_lifecycle_events (
        id TEXT PRIMARY KEY,
        lifecycle_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        payload_json TEXT,
        FOREIGN KEY(lifecycle_id) REFERENCES position_lifecycles(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_position_lifecycle_events_lifecycle_id_timestamp
        ON position_lifecycle_events(lifecycle_id, timestamp);

      CREATE INDEX IF NOT EXISTS idx_position_lifecycle_events_event_type_timestamp
        ON position_lifecycle_events(event_type, timestamp);
    `
  },
  {
    id: 15,
    name: "repair_order_audit_events_payload_and_legacy_log",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS order_audit_events (
          id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL,
          intent_id TEXT,
          timestamp INTEGER NOT NULL,
          symbol TEXT NOT NULL,
          side TEXT NOT NULL,
          type TEXT NOT NULL,
          quantity REAL NOT NULL,
          price REAL,
          client_order_id TEXT NOT NULL,
          status TEXT NOT NULL,
          source_window_id TEXT,
          dry_run INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          message TEXT,
          payload_json TEXT,
          FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
        );
      `);

      const orderAuditEventColumns = new Set(
        (db.prepare("PRAGMA table_info(order_audit_events)").all() as Array<{ name: string }>).map(
          (column) => column.name
        )
      );

      if (!orderAuditEventColumns.has("payload_json")) {
        db.exec("ALTER TABLE order_audit_events ADD COLUMN payload_json TEXT");
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_order_audit_events_order_id_timestamp
          ON order_audit_events(order_id, timestamp);

        CREATE INDEX IF NOT EXISTS idx_order_audit_events_intent_id_timestamp
          ON order_audit_events(intent_id, timestamp);
      `);

      const hasLegacyOrderAuditLog = Boolean(
        (
          db
            .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'order_audit_log'")
            .pluck()
            .get() as 1 | undefined
        )
      );

      if (!hasLegacyOrderAuditLog) {
        return;
      }

      const legacyColumns = new Set(
        (db.prepare("PRAGMA table_info(order_audit_log)").all() as Array<{ name: string }>).map(
          (column) => column.name
        )
      );
      const legacyPayloadExpression = legacyColumns.has("payload_json") ? "payload_json" : "NULL";

      db.exec(`
        INSERT OR IGNORE INTO order_audit_events (
          id,
          order_id,
          intent_id,
          timestamp,
          symbol,
          side,
          type,
          quantity,
          price,
          client_order_id,
          status,
          source_window_id,
          dry_run,
          event_type,
          message,
          payload_json
        )
        SELECT
          id,
          order_id,
          intent_id,
          timestamp,
          symbol,
          side,
          type,
          quantity,
          price,
          client_order_id,
          status,
          source_window_id,
          dry_run,
          event_type,
          message,
          ${legacyPayloadExpression}
        FROM order_audit_log;
      `);
    }
  },
  {
    id: 16,
    name: "create_decision_reviews",
    sql: `
      CREATE TABLE IF NOT EXISTS decision_reviews (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        signal_id TEXT,
        unified_signal_id TEXT,
        decision_context_id TEXT,
        order_intent_id TEXT,
        position_lifecycle_id TEXT,
        journal_entry_id TEXT,
        outcome_id TEXT,
        market_regime TEXT,
        trade_grade TEXT,
        rule_violations_json TEXT NOT NULL DEFAULT '[]',
        playbook_tags_json TEXT NOT NULL DEFAULT '[]',
        notes TEXT,
        status TEXT NOT NULL,
        generation_source TEXT NOT NULL,
        generation_version TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_decision_reviews_symbol_created_at
        ON decision_reviews(symbol, created_at);

      CREATE INDEX IF NOT EXISTS idx_decision_reviews_position_lifecycle_id
        ON decision_reviews(position_lifecycle_id);

      CREATE INDEX IF NOT EXISTS idx_decision_reviews_decision_context_id
        ON decision_reviews(decision_context_id);

      CREATE INDEX IF NOT EXISTS idx_decision_reviews_order_intent_id
        ON decision_reviews(order_intent_id);

      CREATE INDEX IF NOT EXISTS idx_decision_reviews_unified_signal_id
        ON decision_reviews(unified_signal_id);

      CREATE INDEX IF NOT EXISTS idx_decision_reviews_status_created_at
        ON decision_reviews(status, created_at);
    `
  },
  {
    id: 17,
    name: "add_unique_decision_review_lifecycle_index",
    up: (db) => {
      const duplicateLifecycleId = db
        .prepare(
          `
            SELECT position_lifecycle_id
            FROM decision_reviews
            WHERE position_lifecycle_id IS NOT NULL
            GROUP BY position_lifecycle_id
            HAVING COUNT(*) > 1
            LIMIT 1
          `
        )
        .pluck()
        .get() as string | undefined;

      if (duplicateLifecycleId) {
        return;
      }

      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_reviews_position_lifecycle_id_unique
          ON decision_reviews(position_lifecycle_id)
          WHERE position_lifecycle_id IS NOT NULL;
      `);
    }
  },
  {
    id: 18,
    name: "add_position_lifecycle_event_sequence",
    up: (db) => {
      const columns = new Set(
        (
          db.prepare("PRAGMA table_info(position_lifecycle_events)").all() as Array<{
            name: string;
          }>
        ).map((column) => column.name)
      );

      if (!columns.has("event_seq")) {
        db.exec("ALTER TABLE position_lifecycle_events ADD COLUMN event_seq INTEGER");
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_position_lifecycle_events_lifecycle_timestamp_seq
          ON position_lifecycle_events(lifecycle_id, timestamp, event_seq, id);
      `);
    }
  },
  {
    id: 19,
    name: "create_unified_signals",
    sql: `
      CREATE TABLE IF NOT EXISTS unified_signals (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_id TEXT,
        symbol TEXT,
        kind TEXT NOT NULL,
        bias TEXT,
        severity TEXT,
        rank_score REAL,
        noise_class TEXT,
        ttl_sec INTEGER,
        reason TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        payload_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_unified_signals_symbol_created_at
        ON unified_signals(symbol, created_at);

      CREATE INDEX IF NOT EXISTS idx_unified_signals_source_source_id
        ON unified_signals(source, source_id);

      CREATE INDEX IF NOT EXISTS idx_unified_signals_kind_created_at
        ON unified_signals(kind, created_at);

      CREATE INDEX IF NOT EXISTS idx_unified_signals_created_at
        ON unified_signals(created_at);
    `
  },
  {
    id: 20,
    name: "create_decision_chain_integrity",
    sql: `
      CREATE TABLE IF NOT EXISTS decision_chain_integrity (
        id TEXT PRIMARY KEY,
        lifecycle_id TEXT,
        review_id TEXT,
        order_intent_id TEXT,
        decision_context_id TEXT,
        unified_signal_id TEXT,
        status TEXT NOT NULL,
        missing_links_json TEXT NOT NULL,
        checked_at INTEGER NOT NULL,
        source TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_decision_chain_integrity_lifecycle_checked_at
        ON decision_chain_integrity(lifecycle_id, checked_at);

      CREATE INDEX IF NOT EXISTS idx_decision_chain_integrity_review_checked_at
        ON decision_chain_integrity(review_id, checked_at);

      CREATE INDEX IF NOT EXISTS idx_decision_chain_integrity_status_checked_at
        ON decision_chain_integrity(status, checked_at);
    `
  },
  {
    id: 21,
    name: "create_order_preflights",
    sql: `
      CREATE TABLE IF NOT EXISTS order_preflights (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        type TEXT NOT NULL,
        quantity REAL NOT NULL,
        normalized_quantity REAL,
        price REAL,
        normalized_price REAL,
        notional REAL,
        decision_context_id TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        invalidated_at INTEGER,
        reason TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_order_preflights_request_id
        ON order_preflights(request_id);

      CREATE INDEX IF NOT EXISTS idx_order_preflights_status_expires_at
        ON order_preflights(status, expires_at);

      CREATE INDEX IF NOT EXISTS idx_order_preflights_decision_context_id
        ON order_preflights(decision_context_id);
    `
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
