-- Prompt Burn schema. Applied once, when ~/.prompt-burn/db.sqlite is created.
-- There is no migration runner (docs/implementation-plan.md): the reset path is
-- deleting the file. Any change here needs one until a second user has the old
-- schema on disk.

-- Usage rows store tokens only; cost is always derived from price_entries, so a
-- new or corrected rate re-prices history without rewriting a single row.
CREATE TABLE usage_events (
  id          TEXT PRIMARY KEY,
  source      TEXT NOT NULL CHECK (source IN ('omp', 'cursor')),
  -- 'event' rows are timestamped and obey calendar filters. 'cycle' rows are
  -- Cursor Pro aggregates: real tokens, no timestamp, never split into days.
  period      TEXT NOT NULL CHECK (period IN ('event', 'cycle')),
  -- ISO 8601 UTC for 'event'; empty string for 'cycle' — never a fake time.
  timestamp   TEXT NOT NULL,
  model       TEXT NOT NULL,
  raw_model   TEXT NOT NULL,
  input       INTEGER NOT NULL DEFAULT 0,
  output      INTEGER NOT NULL DEFAULT 0,
  cache_read  INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  session_id  TEXT,
  CHECK ((period = 'cycle') = (timestamp = ''))
);

CREATE INDEX usage_events_timestamp ON usage_events (timestamp);
CREATE INDEX usage_events_source_model ON usage_events (source, model);

-- Rates in USD per million tokens, versioned by validity window. The row that
-- prices an event is the one where effective_from <= timestamp AND
-- (effective_until IS NULL OR effective_until > timestamp). A rate change is a
-- new row, never an UPDATE — old events keep the rate that was valid then.
CREATE TABLE price_entries (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  model                TEXT NOT NULL,
  provider             TEXT NOT NULL,
  effective_from       TEXT NOT NULL,
  effective_until      TEXT,
  input_per_mtok       REAL NOT NULL,
  output_per_mtok      REAL NOT NULL,
  cache_read_per_mtok  REAL,
  cache_write_per_mtok REAL
);

CREATE INDEX price_entries_model ON price_entries (model, effective_from);

-- Incremental OMP sync: skip a session file whose mtime and size are unchanged.
CREATE TABLE omp_sync_state (
  path   TEXT PRIMARY KEY,
  mtime  INTEGER NOT NULL,
  offset INTEGER NOT NULL DEFAULT 0
);

-- OMP path, cursor enabled, last_success_at, last_error, … Never Cursor tokens:
-- those are read from Cursor's own database at fetch time and never persisted.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
