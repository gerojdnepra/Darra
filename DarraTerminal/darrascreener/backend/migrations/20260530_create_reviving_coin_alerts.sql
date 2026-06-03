CREATE TABLE IF NOT EXISTS screener_signal_events (
  id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  kind TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_screener_signal_events_symbol_created_at
  ON screener_signal_events(symbol, created_at);

CREATE TABLE IF NOT EXISTS reviving_coin_alert_events (
  id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  base_asset TEXT NOT NULL,
  quote_volume_24h REAL NOT NULL,
  average_daily_quote_volume REAL,
  volume_change_pct REAL,
  liquidity_lookback_days INTEGER NOT NULL,
  no_signal_lookback_days INTEGER NOT NULL,
  low_average_volume INTEGER NOT NULL,
  no_recent_signals INTEGER NOT NULL,
  require_all_dead_criteria INTEGER NOT NULL,
  settings_snapshot_json TEXT NOT NULL,
  detected_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reviving_coin_alert_events_symbol_detected_at
  ON reviving_coin_alert_events(symbol, detected_at);
