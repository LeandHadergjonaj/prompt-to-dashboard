// SQL guard: AST-based validation using the real PostgreSQL parser
// (libpg-query, compiled to WASM), with table-level identifier binding
// against the connection's introspected catalog.
//
// Structural checks replace the old keyword denylist: every statement kind
// the denylist matched by keyword (INSERT, DROP, SET, BEGIN, COPY, CALL, …)
// is a distinct parse-tree node type, so "the single statement must be a
// SelectStmt, and no non-SELECT statement node may appear anywhere in the
// tree" rejects all of them — without the denylist's false positives on
// keywords inside string literals or identifiers. The keyword guard is kept
// below as an automatic fallback if the WASM parser ever fails to load, so
// coverage can degrade to the previous level but never below it.
//
// Defense-in-depth underneath is unchanged: read-only role, read-only
// transaction, statement timeout, subselect LIMIT wrap.

export interface SqlGuardResult {
  ok: boolean;
  reason: string | null;       // non-null when ok === false
  sanitizedSql: string | null; // non-null when ok === true
}

/** Table -> column names, as introspected from the connected database. */
export interface SqlCatalog {
  tables: Record<string, string[]>;
}

// Functions that read files/large objects, execute arbitrary queries, take
// cluster-wide locks, signal backends, or change settings. The read-only
// role already blocks most of their effects; rejecting them here fails fast
// and closes the read-side holes (file reads, catalog dumps, advisory-lock
// and sleep-based denial of service) a read-only role does not cover.
const FORBIDDEN_FUNCTIONS = new Set([
  "pg_sleep", "pg_sleep_for", "pg_sleep_until",
  "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_ls_logdir",
  "pg_ls_waldir", "pg_ls_tmpdir", "pg_stat_file",
  "lo_import", "lo_export",
  "pg_terminate_backend", "pg_cancel_backend", "pg_reload_conf",
  "pg_rotate_logfile", "pg_switch_wal", "pg_promote",
  "set_config",
  "query_to_xml", "query_to_xmlschema", "query_to_xml_and_xmlschema",
  "database_to_xml", "database_to_xmlschema", "database_to_xml_and_xmlschema",
  "schema_to_xml", "schema_to_xmlschema", "schema_to_xml_and_xmlschema",
  "table_to_xml", "table_to_xmlschema", "table_to_xml_and_xmlschema",
  "cursor_to_xml", "cursor_to_xmlschema",
]);
const FORBIDDEN_FUNCTION_PREFIXES = ["dblink", "pg_advisory"];

type PgNode = Record<string, unknown>;

interface WalkFinding {
  reason: string;
}

function functionName(funcCall: PgNode): string {
  const names = funcCall.funcname as Array<{ String?: { sval?: string } }> | undefined;
  if (!Array.isArray(names) || names.length === 0) return "";
  return (names[names.length - 1]?.String?.sval ?? "").toLowerCase();
}

/** First pass: collect every CTE name defined anywhere in the query. */
function collectCteNames(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectCteNames(item, out);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const obj = node as PgNode;
  if (typeof obj.ctename === "string" && obj.ctequery !== undefined) {
    out.add(obj.ctename);
  }
  for (const value of Object.values(obj)) collectCteNames(value, out);
}

/** Second pass: reject forbidden structures; bind relations to the catalog. */
function walk(node: unknown, cteNames: Set<string>, catalog: SqlCatalog | null): WalkFinding | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = walk(item, cteNames, catalog);
      if (found) return found;
    }
    return null;
  }
  if (node === null || typeof node !== "object") return null;

  const obj = node as PgNode;
  for (const [key, value] of Object.entries(obj)) {
    if (key.endsWith("Stmt") && key !== "SelectStmt") {
      return { reason: `forbidden statement type: ${key.replace(/Stmt$/, "")}` };
    }
    // Typed fields are emitted unwrapped ("intoClause": {...}); generic Node
    // lists are wrapped ("IntoClause": {...}) — match both spellings.
    if (key === "IntoClause" || key === "intoClause") {
      return { reason: "SELECT ... INTO creates a table and is not allowed" };
    }
    if (key === "LockingClause") {
      return { reason: "row locking (FOR UPDATE/SHARE) is not allowed" };
    }
    if (key === "FuncCall") {
      const name = functionName(value as PgNode);
      if (
        FORBIDDEN_FUNCTIONS.has(name) ||
        FORBIDDEN_FUNCTION_PREFIXES.some((p) => name.startsWith(p))
      ) {
        return { reason: `forbidden function: ${name}` };
      }
    }
    if (key === "RangeVar" && catalog) {
      const rv = value as { relname?: string; schemaname?: string };
      const relname = rv.relname ?? "";
      if (rv.schemaname !== undefined && rv.schemaname !== "public") {
        return { reason: `only the public schema is queryable (got "${rv.schemaname}"."${relname}")` };
      }
      const known =
        Object.prototype.hasOwnProperty.call(catalog.tables, relname) || cteNames.has(relname);
      if (!known) {
        return { reason: `unknown table: "${relname}" is not in this database's schema` };
      }
    }
    const found = walk(value, cteNames, catalog);
    if (found) return found;
  }
  return null;
}

/**
 * Validate a candidate panel query. When `catalog` is provided, every table
 * reference must bind to it (or to a CTE defined in the query itself).
 */
export async function checkSql(
  rawSql: string,
  catalog: SqlCatalog | null = null
): Promise<SqlGuardResult> {
  // Strip trailing semicolons only; interior semicolons surface as a second
  // parsed statement and are rejected below. (Unlike the old guard, comment
  // markers and keywords inside string literals cannot cause rejection.)
  const sql = rawSql.trim().replace(/;+\s*$/, "").trimEnd();
  if (sql.length === 0) {
    return { ok: false, reason: "query is empty", sanitizedSql: null };
  }

  let parsed: { stmts?: Array<{ stmt?: PgNode }> };
  try {
    const libpgQuery = await import("libpg-query");
    try {
      parsed = await libpgQuery.parse(sql);
    } catch (parseErr) {
      const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
      return { ok: false, reason: `not valid PostgreSQL: ${message}`, sanitizedSql: null };
    }
  } catch {
    // Parser module unavailable (WASM load failure): fall back to the keyword
    // guard so validation never silently disappears.
    return checkSqlKeyword(rawSql);
  }

  const stmts = parsed.stmts ?? [];
  if (stmts.length === 0) {
    return { ok: false, reason: "query is empty", sanitizedSql: null };
  }
  if (stmts.length > 1) {
    return { ok: false, reason: "multiple SQL statements are not allowed", sanitizedSql: null };
  }

  const stmt = stmts[0].stmt ?? {};
  if (!("SelectStmt" in stmt)) {
    const kind = Object.keys(stmt)[0] ?? "unknown";
    return {
      ok: false,
      reason: `only SELECT queries are allowed (got ${kind.replace(/Stmt$/, "")})`,
      sanitizedSql: null,
    };
  }

  const cteNames = new Set<string>();
  collectCteNames(stmt, cteNames);
  const finding = walk(stmt, cteNames, catalog);
  if (finding) {
    return { ok: false, reason: finding.reason, sanitizedSql: null };
  }

  return { ok: true, reason: null, sanitizedSql: sql };
}

// ---------------------------------------------------------------------------
// Legacy keyword guard — retained verbatim as the fallback path (see above)
// and for comparison in tests.
// ---------------------------------------------------------------------------

// Case-insensitive, whole-word (`_` is a word char, so identifiers like
// updated_at / create_date never false-positive). INTO blocks
// `SELECT ... INTO new_table`, which starts with SELECT but creates a table.
const FORBIDDEN_KEYWORDS = [
  "INSERT", "UPDATE", "DELETE", "MERGE", "UPSERT",
  "DROP", "ALTER", "TRUNCATE", "CREATE", "COMMENT",
  "GRANT", "REVOKE",
  "EXECUTE", "CALL", "DO", "PREPARE", "DEALLOCATE",
  "COPY", "VACUUM", "ANALYZE", "REINDEX", "CLUSTER", "REFRESH",
  "LOCK", "LISTEN", "NOTIFY", "UNLISTEN",
  "SET", "RESET",
  "BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT",
  "INTO",
] as const;

export function checkSqlKeyword(rawSql: string): SqlGuardResult {
  // 1. Strip comments. Accepted limitation: comment markers inside string
  // literals are also stripped, which can only over-reject, never smuggle a
  // write statement through.
  let sql = rawSql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, "");

  // 2. Trim.
  sql = sql.trim();

  // 3. Empty after stripping?
  if (sql.length === 0) {
    return { ok: false, reason: "query is empty after removing comments", sanitizedSql: null };
  }

  // 4. Strip exactly one trailing semicolon, then reject if any remain
  // (runs before the keyword scan so `SELECT 1; DROP ...` dies here).
  sql = sql.replace(/;\s*$/, "").trimEnd();
  if (sql.includes(";")) {
    return { ok: false, reason: "multiple SQL statements are not allowed", sanitizedSql: null };
  }

  // 5. Must start with SELECT or WITH.
  if (!/^\s*(SELECT|WITH)\b/i.test(sql)) {
    return { ok: false, reason: "query must start with SELECT or WITH", sanitizedSql: null };
  }

  // 6. Forbidden-keyword scan; first match wins.
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, "i").test(sql)) {
      return { ok: false, reason: `forbidden keyword: ${keyword}`, sanitizedSql: null };
    }
  }

  // 7. Pass.
  return { ok: true, reason: null, sanitizedSql: sql };
}

// Only ever call with SQL that just passed checkSql (trailing semicolon
// already stripped — otherwise the wrap is syntactically invalid). A trailing
// `--` line comment cannot swallow the closing paren because the wrap places
// it on its own line.
export function wrapForExecution(sanitizedSql: string): string {
  return `SELECT * FROM (\n${sanitizedSql}\n) AS _panel LIMIT 5001`;
}
