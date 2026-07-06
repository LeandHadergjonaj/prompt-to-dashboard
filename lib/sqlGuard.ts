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

