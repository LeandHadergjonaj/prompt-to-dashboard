import { Pool, types } from "pg";
import { DEFAULT_MAX_RESULT_ROWS, wrapForExecution } from "./sqlGuard";
import type { ColumnMeta } from "./types";

// numeric + int8 -> numbers (safe: values < 2^53); dates/timestamps -> ISO strings
types.setTypeParser(1700, (v: string) => parseFloat(v));
types.setTypeParser(20, (v: string) => parseInt(v, 10));
types.setTypeParser(1082, (v: string) => v); // 'YYYY-MM-DD'
types.setTypeParser(1114, (v: string) => v.replace(" ", "T"));
types.setTypeParser(1184, (v: string) => {
  const iso = v.replace(" ", "T");
  return iso.endsWith("+00") ? iso.slice(0, -3) + "Z" : iso;
});

// TLS comes from the connection string's sslmode parameter
// (disable | require | no-verify | verify-full).
//
// statementTimeoutMs is the per-connection setting (connection_settings) and
// is the EFFECTIVE bound: newly onboarded roles carry the 120s ceiling as
// their ALTER ROLE default, so this connection parameter is what actually
// governs. Connections onboarded before the ceiling change still have the
// 20s role default, which silently caps values above it until re-onboarding.
export const DEFAULT_STATEMENT_TIMEOUT_MS = 20_000;

export function createReaderPool(
  connectionString: string,
  statementTimeoutMs: number = DEFAULT_STATEMENT_TIMEOUT_MS
): Pool {
  return new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: statementTimeoutMs,
  });
}

const NUMBER_OIDS = new Set([20, 21, 23, 700, 701, 1700]);
const DATE_OIDS = new Set([1082, 1114, 1184]);
const BOOLEAN_OIDS = new Set([16]);

export function normalizeColumnType(oid: number): ColumnMeta["type"] {
  if (NUMBER_OIDS.has(oid)) return "number";
  if (DATE_OIDS.has(oid)) return "date";
  if (BOOLEAN_OIDS.has(oid)) return "boolean";
  return "string";
}

export interface PanelQueryResult {
  columns: ColumnMeta[];
  rows: unknown[][];
  truncated: boolean;
}

export async function executePanelQuery(
  pool: Pool,
  sanitizedSql: string,
  maxRows: number = DEFAULT_MAX_RESULT_ROWS
): Promise<PanelQueryResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const result = await client.query({ text: wrapForExecution(sanitizedSql, maxRows), rowMode: "array" });
    await client.query("COMMIT");

    const columns: ColumnMeta[] = result.fields.map((f) => ({
      name: f.name,
      type: normalizeColumnType(f.dataTypeID),
    }));
    const truncated = result.rows.length > maxRows;
    const rows = truncated ? result.rows.slice(0, maxRows) : result.rows;
    return { columns, rows, truncated };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Pre-flight planner cost (A.3 stage 1, warn-only): EXPLAIN without ANALYZE
// is read-only, fast, and does not execute the query. Issued only by OUR
// code on the pooled read-only connection — EXPLAIN arriving from the model
// stays rejected by the AST guard (ExplainStmt is not a SelectStmt).
// Best-effort: any failure returns null and the panel runs regardless.
export async function explainQueryCost(
  pool: Pool,
  sanitizedSql: string,
  maxRows: number = DEFAULT_MAX_RESULT_ROWS
): Promise<number | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const result = await client.query(
      `EXPLAIN (FORMAT JSON) ${wrapForExecution(sanitizedSql, maxRows)}`
    );
    await client.query("COMMIT");
    const plan = (result.rows[0]?.["QUERY PLAN"] as Array<{ Plan?: { "Total Cost"?: number } }>)?.[0];
    const cost = plan?.Plan?.["Total Cost"];
    return typeof cost === "number" ? cost : null;
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return null;
  } finally {
    client.release();
  }
}
