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

// Strip sslmode from the URL: it would override the ssl object below and
// force full chain verification, which fails on Supabase's pooler cert.
const connectionString = env.DATABASE_URL_READONLY
  .replace(/([?&])sslmode=[^&]*&?/, "$1")
  .replace(/[?&]$/, "");

export const pool = new Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 19_000, // just under the role's 20s backstop
  ssl: { rejectUnauthorized: false },
});

const NUMBER_OIDS = new Set([20, 21, 23, 700, 701, 1700]);
const DATE_OIDS = new Set([1082, 1114, 1184]);
const BOOLEAN_OIDS = new Set([16]);

