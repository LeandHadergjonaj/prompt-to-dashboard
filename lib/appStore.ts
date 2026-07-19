import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// App-local metadata store (users, connections, dashboards, examples).
// Deliberately separate from any user-connected database, which the engine
// only ever reads. One SQLite file under .data/, WAL mode, created on demand.

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_FILE = path.join(DATA_DIR, "app.db");

const SCHEMA = `
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

let db: Database.Database | null = null;

export function getAppStore(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_FILE);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export function newId(): string {
  return crypto.randomUUID();
}
