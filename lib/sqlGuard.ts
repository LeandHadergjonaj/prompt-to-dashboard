export interface SqlGuardResult {
  ok: boolean;
  reason: string | null;       // non-null when ok === false
  sanitizedSql: string | null; // non-null when ok === true
}

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

export function checkSql(rawSql: string): SqlGuardResult {
  // 1. Strip comments. Accepted v1 limitation: comment markers inside string
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
// already stripped — otherwise the wrap is syntactically invalid).
export function wrapForExecution(sanitizedSql: string): string {
  return `SELECT * FROM (\n${sanitizedSql}\n) AS _panel LIMIT 5001`;
}
