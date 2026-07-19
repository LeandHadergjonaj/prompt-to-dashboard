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
    store.prepare("DELETE FROM connections WHERE id = ? AND user_id = ?").run(id, userId);
  });
  tx();
  const pool = pools.get(id);
  if (pool) {
    pools.delete(id);
    pool.end().catch(() => {});
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
  await admin.query(`ALTER ROLE ${READER_ROLE} SET statement_timeout = '20s'`);
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
    // fail inside its read-only default transaction.
    let writeBlocked = false;
    try {
      await client.query("CREATE TEMP TABLE _ptd_write_probe (x int)");
      await client.query("DROP TABLE _ptd_write_probe");
    } catch {
      writeBlocked = true;
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

  let introspection;
  const readerPassword = crypto.randomBytes(24).toString("base64url");
  try {
    try {
      await ensureReaderRole(admin, readerPassword);
    } catch (err) {
      throw new ConnectionError(
        `role setup failed: ${err instanceof Error ? err.message : String(err)}`,
        "We connected, but couldn't create the read-only role. The user in the connection string needs permission to create roles and grant access (an admin/owner user).",
        502
      );
    }
    try {
      introspection = await introspectDatabase(admin);
    } catch (err) {
      throw new ConnectionError(
        `introspection failed: ${err instanceof Error ? err.message : String(err)}`,
        "We connected, but couldn't read the database's structure.",
        502
      );
    }
  } finally {
    await admin.end().catch(() => {});
  }

  if (introspection.stats.tableCount === 0) {
    throw new ConnectionError(
      "no tables found",
      "We connected, but found no tables in the public schema — there's nothing to build dashboards from yet."
    );
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
// Execution contexts (pools + schema context + binding catalog)
// ---------------------------------------------------------------------------

export interface ExecutionContext {
  /** Stable key for scoping examples: connection id, or "env". */
  connectionKey: string;
  pool: Pool;
  schemaContext: string;
  catalog: SqlCatalog | null;
}

const pools = new Map<string, Pool>();

function getPool(key: string, dsn: string): Pool {
  let pool = pools.get(key);
  if (!pool) {
    pool = createReaderPool(dsn);
    pools.set(key, pool);
  }
  return pool;
}

// Legacy connection's binding catalog, introspected lazily from pg_catalog
// (db/schema-context.md is hand-generated and not machine-parsed).
let envCatalog: SqlCatalog | null = null;
let envCatalogFailed = false;

async function getEnvCatalog(pool: Pool): Promise<SqlCatalog | null> {
  if (envCatalog || envCatalogFailed) return envCatalog;
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
  } catch {
    envCatalogFailed = true; // degrade to no binding rather than blocking queries
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
    const pool = getPool(ENV_CONNECTION_ID, env.DATABASE_URL_READONLY);
    return {
      connectionKey: ENV_CONNECTION_ID,
      pool,
      schemaContext: getSchemaContext(),
      catalog: await getEnvCatalog(pool),
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
  return {
    connectionKey: row.id,
    pool: getPool(row.id, decryptString(row.dsn_ciphertext)),
    schemaContext: row.schema_context,
    catalog: JSON.parse(row.catalog_json) as SqlCatalog,
  };
}

export function hasEnvConnection(): boolean {
  return env.DATABASE_URL_READONLY !== null;
}
