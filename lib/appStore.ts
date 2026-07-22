import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// App-local metadata store (users, connections, dashboards, examples,
// telemetry). Deliberately separate from any user-connected database, which
// the engine only ever reads. One SQLite file under .data/, WAL mode,
// created on demand.

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_FILE = path.join(DATA_DIR, "app.db");

// Migration 1: the original schema. Idempotent (IF NOT EXISTS) on purpose —
// databases created before versioning exist at user_version 0 WITH these
// tables already present, so the ladder must converge from both states.
const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS connections (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  name           TEXT NOT NULL,
  database_name  TEXT NOT NULL,
  host           TEXT NOT NULL,
  dsn_ciphertext BLOB NOT NULL,
  schema_context TEXT NOT NULL,
  catalog_json   TEXT NOT NULL,
  stats_json     TEXT NOT NULL,
  summary        TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_connections_user ON connections(user_id);

CREATE TABLE IF NOT EXISTS dashboards (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  connection_id TEXT,          -- NULL = legacy env-configured connection
  title         TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  question      TEXT NOT NULL DEFAULT '',
  spec_json     TEXT NOT NULL,
  history_json  TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_dashboards_user ON dashboards(user_id);

-- connection_id here is NOT NULL with sentinel 'env' (unlike dashboards,
-- where NULL marks the env connection): the dedupe UNIQUE below must include
-- connection_id, and SQLite treats NULLs as always-distinct in UNIQUE
-- constraints, so a NULL sentinel would disable dedupe for env examples.
CREATE TABLE IF NOT EXISTS examples (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  connection_id TEXT NOT NULL, -- 'env' for the legacy env-configured connection
  question      TEXT NOT NULL,
  sql           TEXT NOT NULL,
  embedding     BLOB,          -- Float32Array bytes; NULL when embedding failed
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(user_id, connection_id, question, sql)
);
CREATE INDEX IF NOT EXISTS idx_examples_scope ON examples(user_id, connection_id);
`;

// Migration 2: per-connection execution settings and panel-run telemetry.
// Telemetry stays in this local file, never leaves the deployment, and
// contains SQL text but no result data.
const SCHEMA_V2 = `
CREATE TABLE connection_settings (
  connection_id  TEXT PRIMARY KEY,     -- 'env' allowed (same sentinel as examples)
  statement_timeout_ms INTEGER NOT NULL DEFAULT 20000
                 CHECK (statement_timeout_ms BETWEEN 5000 AND 120000),
  max_result_rows      INTEGER NOT NULL DEFAULT 5000
                 CHECK (max_result_rows BETWEEN 100 AND 20000),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE panel_runs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  connection_id TEXT NOT NULL,          -- 'env' sentinel, as examples
  sql           TEXT NOT NULL,          -- sanitized SQL (pre-wrap)
  duration_ms   INTEGER NOT NULL,
  row_count     INTEGER,                -- NULL on error
  outcome       TEXT NOT NULL CHECK (outcome IN ('ok','timeout','error','rejected')),
  error_code    TEXT,                   -- pg code when outcome != 'ok'
  total_cost    REAL,                   -- planner estimate from EXPLAIN, when available
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_panel_runs_scope ON panel_runs(connection_id, created_at);
`;

// Append-only: each entry runs once, inside a transaction, and bumps
// user_version. Never edit a shipped entry — add a new one.
export const MIGRATIONS: string[] = [SCHEMA_V1, SCHEMA_V2];

export function migrate(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

let db: Database.Database | null = null;

export function getAppStore(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_FILE);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function newId(): string {
  return crypto.randomUUID();
}
