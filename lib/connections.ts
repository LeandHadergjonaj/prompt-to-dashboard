import { Client, Pool } from "pg";
import crypto from "node:crypto";
import { getAppStore, newId } from "./appStore";
import { createReaderPool } from "./db";
import { decryptString, encryptString } from "./secrets";
import { env } from "./env";
import { getSchemaContext } from "./schemaContext";
import { introspectDatabase, type IntrospectStats } from "./introspect";
import type { SqlCatalog } from "./sqlGuard";

// Per-user database connections: onboarding (role creation + introspection +
// verification), encrypted credential storage, and a pool registry that
// resolves every API request to { pool, schemaContext, catalog }.
//
// connectionId === null means the legacy env-configured connection
// (DATABASE_URL_READONLY + db/schema-context.md) — that path behaves exactly
// as the app did before connections existed.

export const ENV_CONNECTION_ID = "env";
const READER_ROLE = "dashboard_reader";

export class ConnectionError extends Error {
  constructor(
    message: string,
    readonly friendlyMessage: string,
    readonly status: number = 400
  ) {
    super(message);
    this.name = "ConnectionError";
  }
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface ConnectionSummary {
  id: string;
  name: string;
  databaseName: string;
  host: string;
  summary: string;
  stats: IntrospectStats;
  createdAt: string;
}

interface ConnectionRow {
  id: string;
  user_id: string;
  name: string;
  database_name: string;
  host: string;
  dsn_ciphertext: Buffer;
  schema_context: string;
  catalog_json: string;
  stats_json: string;
  summary: string;
  created_at: string;
}

function toSummary(row: ConnectionRow): ConnectionSummary {
  return {
    id: row.id,
    name: row.name,
    databaseName: row.database_name,
    host: row.host,
    summary: row.summary,
    stats: JSON.parse(row.stats_json) as IntrospectStats,
    createdAt: row.created_at,
  };
}

export function listConnections(userId: string): ConnectionSummary[] {
  const rows = getAppStore()
    .prepare("SELECT * FROM connections WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as ConnectionRow[];
  return rows.map(toSummary);
}

function getConnectionRow(userId: string, id: string): ConnectionRow | null {
  return (getAppStore()
    .prepare("SELECT * FROM connections WHERE id = ? AND user_id = ?")
    .get(id, userId) ?? null) as ConnectionRow | null;
}

export function getConnectionSummary(userId: string, id: string): ConnectionSummary | null {
  const row = getConnectionRow(userId, id);
  return row ? toSummary(row) : null;
}

export function deleteConnection(userId: string, id: string): boolean {
  const store = getAppStore();
  const row = getConnectionRow(userId, id);
  if (!row) return false;
  const tx = store.transaction(() => {
    store.prepare("DELETE FROM examples WHERE user_id = ? AND connection_id = ?").run(userId, id);
    store.prepare("DELETE FROM dashboards WHERE user_id = ? AND connection_id = ?").run(userId, id);
    store.prepare("DELETE FROM connection_settings WHERE connection_id = ?").run(id);
    store.prepare("DELETE FROM panel_runs WHERE connection_id = ?").run(id);
    store.prepare("DELETE FROM connections WHERE id = ? AND user_id = ?").run(id, userId);
  });
  tx();
  const entry = pools.get(id);
  if (entry) {
    pools.delete(id);
    entry.pool.end().catch(() => {});
  }
  return true;
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

function parsePostgresUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConnectionError(
      "invalid url",
      "That doesn't look like a valid connection string. It should start with postgresql:// and include a host and database name."
    );
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new ConnectionError(
      `unsupported protocol ${url.protocol}`,
      "The connection string must start with postgresql:// (or postgres://)."
    );
  }
  if (!url.hostname || url.pathname.replace(/^\//, "").length === 0) {
    throw new ConnectionError(
      "missing host or database",
      "The connection string needs both a host and a database name (postgresql://user:password@host:5432/database)."
    );
  }
  return url;
}

async function ensureReaderRole(admin: Client, password: string): Promise<void> {
  // Role name is a fixed constant and the password is generated base64url —
  // neither can contain quotes, so inlining into DDL (which cannot be
  // parameterized) is safe. Mirrors db/readonly_role.sql statement-for-statement.
  const { rows } = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [READER_ROLE]);
  const head = rows.length === 0 ? "CREATE" : "ALTER";
  await admin.query(`${head} ROLE ${READER_ROLE} LOGIN PASSWORD '${password}' CONNECTION LIMIT 10`);
  await admin.query(`ALTER ROLE ${READER_ROLE} SET default_transaction_read_only = on`);
  // The role default is the CEILING (the settings schema's max); the
  // per-connection statement_timeout connection parameter is the effective,
  // tighter bound. If the role default were 20s, per-connection values above
  // it would silently not work.
  await admin.query(`ALTER ROLE ${READER_ROLE} SET statement_timeout = '120s'`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${READER_ROLE}`);
  await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${READER_ROLE}`);
  await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${READER_ROLE}`);
  await admin.query(
    `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM ${READER_ROLE}`
  );
  await admin.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${READER_ROLE}`);
  await admin.query(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${READER_ROLE}`);
  await admin.query(`REVOKE CREATE ON SCHEMA public FROM ${READER_ROLE}`);
}

async function verifyReaderDsn(readerDsn: string): Promise<void> {
  const client = new Client({ connectionString: readerDsn, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
  } catch (err) {
    throw new ConnectionError(
      `reader connect failed: ${err instanceof Error ? err.message : String(err)}`,
      "The read-only role was created, but connecting with it failed. Your database may restrict which roles can log in.",
      502
    );
  }
  try {
    await client.query("SELECT 1");
    // Positive proof the role cannot write: creating even a TEMP table must
    // fail inside its read-only default transaction — and specifically with
    // "cannot execute ... in a read-only transaction" (SQLSTATE 25006). Any
    // other failure is inconclusive, not proof, so it does not pass.
    let writeBlocked = false;
    try {
      await client.query("CREATE TEMP TABLE _ptd_write_probe (x int)");
      await client.query("DROP TABLE _ptd_write_probe");
    } catch (err) {
      const code = (err as { code?: string }).code;
      writeBlocked = code === "25006";
    }
    if (!writeBlocked) {
      throw new ConnectionError(
        "write probe succeeded",
        "We couldn't confirm the new role is read-only, so the connection was not saved. This can happen when the database overrides role settings.",
        502
      );
    }
  } finally {
    await client.end().catch(() => {});
  }
}

export interface OnboardResult {
  connection: ConnectionSummary;
}

/**
 * Full onboarding: verify the admin connection, create/rotate the read-only
 * role, introspect the schema, verify the reader credentials, store only the
 * encrypted reader DSN. The admin URL is used transiently and never persisted.
 */
export async function onboardConnection(params: {
  userId: string;
  name: string;
  adminUrl: string;
  summarize: (stats: IntrospectStats) => Promise<string>;
}): Promise<OnboardResult> {
  const url = parsePostgresUrl(params.adminUrl);

  const admin = new Client({ connectionString: params.adminUrl, connectionTimeoutMillis: 10_000 });
  try {
    await admin.connect();
  } catch (err) {
    throw new ConnectionError(
      `admin connect failed: ${err instanceof Error ? err.message : String(err)}`,
      "We couldn't connect with those details. Check the host, database name, user and password — and that the database accepts connections from this app.",
      502
    );
  }

  // Introspect before touching the reader role: a database we can't read
  // (or one with nothing in it) must fail onboarding WITHOUT rotating the
  // password of a dashboard_reader role an earlier connection may be using.
  let introspection;
  const readerPassword = crypto.randomBytes(24).toString("base64url");
  try {
    try {
      introspection = await introspectDatabase(admin);
    } catch (err) {
      throw new ConnectionError(
        `introspection failed: ${err instanceof Error ? err.message : String(err)}`,
        "We connected, but couldn't read the database's structure.",
        502
      );
    }
    if (introspection.stats.tableCount === 0) {
      throw new ConnectionError(
        "no tables found",
        "We connected, but found no tables in the public schema — there's nothing to build dashboards from yet."
      );
    }
    try {
      await ensureReaderRole(admin, readerPassword);
    } catch (err) {
      throw new ConnectionError(
        `role setup failed: ${err instanceof Error ? err.message : String(err)}`,
        "We connected, but couldn't create the read-only role. The user in the connection string needs permission to create roles and grant access (an admin/owner user).",
        502
      );
    }
  } finally {
    await admin.end().catch(() => {});
  }

  const readerUrl = new URL(url.toString());
  readerUrl.username = READER_ROLE;
  readerUrl.password = readerPassword;
  const readerDsn = readerUrl.toString();

  await verifyReaderDsn(readerDsn);

  let summary: string;
  try {
    summary = await params.summarize(introspection.stats);
  } catch {
    summary = fallbackSummary(introspection.stats);
  }

  const id = newId();
  getAppStore()
    .prepare(
      `INSERT INTO connections
         (id, user_id, name, database_name, host, dsn_ciphertext, schema_context, catalog_json, stats_json, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      params.userId,
      params.name,
      introspection.stats.databaseName,
      url.hostname,
      encryptString(readerDsn),
      introspection.markdown,
      JSON.stringify(introspection.catalog),
      JSON.stringify(introspection.stats),
      summary
    );

  const row = getConnectionRow(params.userId, id)!;
  return { connection: toSummary(row) };
}

export function fallbackSummary(stats: IntrospectStats): string {
  const biggest = [...stats.tables].sort((a, b) => b.approxRows - a.approxRows).slice(0, 3);
  const tableList = biggest.map((t) => t.name).join(", ");
  const dates = stats.dateRanges[0];
  const dateNote = dates
    ? ` Date coverage runs from ${dates.from.slice(0, 10)} to ${dates.to.slice(0, 10)}.`
    : "";
  return (
    `Connected to "${stats.databaseName}" and found ${stats.tableCount} tables holding roughly ` +
    `${stats.totalApproxRows.toLocaleString("en-US")} rows in total. The largest tables are ${tableList}.` +
    dateNote
  );
}

// ---------------------------------------------------------------------------
// Per-connection settings (statement timeout + result-row cap)
// ---------------------------------------------------------------------------

export interface ConnectionSettings {
  statementTimeoutMs: number;
  maxResultRows: number;
}

export const DEFAULT_CONNECTION_SETTINGS: ConnectionSettings = {
  statementTimeoutMs: 20_000,
  maxResultRows: 5_000,
};

export function getConnectionSettings(connectionKey: string): ConnectionSettings {
  const row = getAppStore()
    .prepare("SELECT statement_timeout_ms, max_result_rows FROM connection_settings WHERE connection_id = ?")
    .get(connectionKey) as { statement_timeout_ms: number; max_result_rows: number } | undefined;
  if (!row) return { ...DEFAULT_CONNECTION_SETTINGS };
  return { statementTimeoutMs: row.statement_timeout_ms, maxResultRows: row.max_result_rows };
}

/** Range validation happens in the request schema; the table CHECKs are the backstop. */
export function updateConnectionSettings(
  connectionKey: string,
  patch: Partial<ConnectionSettings>
): ConnectionSettings {
  const merged = { ...getConnectionSettings(connectionKey), ...patch };
  getAppStore()
    .prepare(
      `INSERT INTO connection_settings (connection_id, statement_timeout_ms, max_result_rows)
       VALUES (?, ?, ?)
       ON CONFLICT(connection_id) DO UPDATE SET
         statement_timeout_ms = excluded.statement_timeout_ms,
         max_result_rows = excluded.max_result_rows,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
    )
    .run(connectionKey, merged.statementTimeoutMs, merged.maxResultRows);
  return merged;
}

// ---------------------------------------------------------------------------
// Execution contexts (pools + schema context + binding catalog)
// ---------------------------------------------------------------------------

export interface ExecutionContext {
  /** Stable key for scoping examples: connection id, or "env". */
  connectionKey: string;
  pool: Pool;
  schemaContext: string;
  catalog: SqlCatalog | null;
  settings: ConnectionSettings;
}

// Pools are created on demand and evicted after sitting unused — clients
// within a pool are already idle-pruned (lib/db.ts), but without whole-pool
// eviction a user touching many connections would accumulate one live pool
// per connection for the process lifetime.
const POOL_IDLE_EVICT_MS = 15 * 60_000;
const pools = new Map<string, { pool: Pool; lastUsedAt: number; statementTimeoutMs: number }>();

function getPool(key: string, dsn: string, statementTimeoutMs: number): Pool {
  const now = Date.now();
  for (const [k, entry] of pools) {
    if (k !== key && now - entry.lastUsedAt > POOL_IDLE_EVICT_MS) {
      pools.delete(k);
      entry.pool.end().catch(() => {});
    }
  }
  let entry = pools.get(key);
  // statement_timeout is a pool-creation parameter, so a settings change
  // must retire the old pool and build a fresh one.
  if (entry && entry.statementTimeoutMs !== statementTimeoutMs) {
    pools.delete(key);
    entry.pool.end().catch(() => {});
    entry = undefined;
  }
  if (!entry) {
    entry = { pool: createReaderPool(dsn, statementTimeoutMs), lastUsedAt: now, statementTimeoutMs };
    pools.set(key, entry);
  }
  entry.lastUsedAt = now;
  return entry.pool;
}

// Legacy connection's binding catalog, introspected lazily from pg_catalog
// (db/schema-context.md is hand-generated and not machine-parsed). A failed
// introspection degrades to no binding for a cooldown period, then retries —
// a transient outage must not disable binding for the process lifetime.
const ENV_CATALOG_RETRY_MS = 60_000;
let envCatalog: SqlCatalog | null = null;
let envCatalogFailedAt = 0;

async function getEnvCatalog(pool: Pool): Promise<SqlCatalog | null> {
  if (envCatalog) return envCatalog;
  if (envCatalogFailedAt && Date.now() - envCatalogFailedAt < ENV_CATALOG_RETRY_MS) return null;
  try {
    const { rows } = await pool.query(
      `SELECT c.relname AS rel, COALESCE(a.attname, '') AS col
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f') AND NOT c.relispartition`
    );
    const catalog: SqlCatalog = { tables: {} };
    for (const r of rows as { rel: string; col: string }[]) {
      (catalog.tables[r.rel] ??= []).push(r.col);
    }
    envCatalog = catalog;
    envCatalogFailedAt = 0;
  } catch {
    envCatalogFailedAt = Date.now(); // degrade to no binding rather than blocking queries
  }
  return envCatalog;
}

export async function getExecutionContext(
  userId: string,
  connectionId: string | null
): Promise<ExecutionContext> {
  if (connectionId === null || connectionId === ENV_CONNECTION_ID) {
    if (!env.DATABASE_URL_READONLY) {
      throw new ConnectionError(
        "no env connection configured",
        "No database is connected yet. Connect one from the app to get started.",
        400
      );
    }
    const settings = getConnectionSettings(ENV_CONNECTION_ID);
    const pool = getPool(ENV_CONNECTION_ID, env.DATABASE_URL_READONLY, settings.statementTimeoutMs);
    return {
      connectionKey: ENV_CONNECTION_ID,
      pool,
      schemaContext: getSchemaContext(),
      catalog: await getEnvCatalog(pool),
      settings,
    };
  }

  const row = getConnectionRow(userId, connectionId);
  if (!row) {
    throw new ConnectionError(
      `connection ${connectionId} not found for user`,
      "That database connection no longer exists. Pick another connection or connect a new database.",
      404
    );
  }
  getAppStore()
    .prepare("UPDATE connections SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .run(row.id);
  const settings = getConnectionSettings(row.id);
  return {
    connectionKey: row.id,
    pool: getPool(row.id, decryptString(row.dsn_ciphertext), settings.statementTimeoutMs),
    schemaContext: row.schema_context,
    catalog: JSON.parse(row.catalog_json) as SqlCatalog,
    settings,
  };
}

export function hasEnvConnection(): boolean {
  return env.DATABASE_URL_READONLY !== null;
}
