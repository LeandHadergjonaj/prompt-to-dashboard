import { Pool, types } from "pg";
import { env } from "./env";
import { wrapForExecution } from "./sqlGuard";
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
export const pool = new Pool({
  connectionString: env.DATABASE_URL_READONLY,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 19_000, // just under the role's 20s backstop
});

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

const WRAP_LIMIT = 5001;
const DISPLAY_LIMIT = 5000;

export async function executePanelQuery(sanitizedSql: string): Promise<PanelQueryResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const result = await client.query({ text: wrapForExecution(sanitizedSql), rowMode: "array" });
    await client.query("COMMIT");

    const columns: ColumnMeta[] = result.fields.map((f) => ({
      name: f.name,
      type: normalizeColumnType(f.dataTypeID),
    }));
    const truncated = result.rows.length >= WRAP_LIMIT;
    const rows = truncated ? result.rows.slice(0, DISPLAY_LIMIT) : result.rows;
    return { columns, rows, truncated };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
