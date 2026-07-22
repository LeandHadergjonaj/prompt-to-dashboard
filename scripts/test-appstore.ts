// Run: npx tsx scripts/test-appstore.ts
//
// Migration-ladder invariants (PLAN4 Phase 0.1): a brand-new database and a
// pre-versioning database (user_version 0 but V1 tables already present)
// must both migrate to head and end up with the identical schema.
import Database from "better-sqlite3";
import { MIGRATIONS, migrate } from "../lib/appStore";

function schemaShape(db: Database.Database): string {
  const rows = db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
    )
    .all() as { type: string; name: string; sql: string }[];
  return JSON.stringify(rows, null, 2);
}

let failures = 0;
function check(name: string, pass: boolean, detail?: string) {
  if (pass) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  }
}

// Path A: empty database, full ladder.
const fresh = new Database(":memory:");
migrate(fresh);
check(
  "fresh db migrates to head version",
  (fresh.pragma("user_version", { simple: true }) as number) === MIGRATIONS.length
);

// Path B: pre-versioning database — V1 tables exist, user_version is 0.
const legacy = new Database(":memory:");
legacy.exec(MIGRATIONS[0]);
check("legacy fixture starts at version 0", (legacy.pragma("user_version", { simple: true }) as number) === 0);
migrate(legacy);
check(
  "legacy db converges to head version",
  (legacy.pragma("user_version", { simple: true }) as number) === MIGRATIONS.length
);

check("fresh and legacy schemas are identical", schemaShape(fresh) === schemaShape(legacy));

// Re-running is a no-op (idempotent at head).
const before = schemaShape(fresh);
migrate(fresh);
check("migrate at head is a no-op", schemaShape(fresh) === before);

// The new tables exist with their expected columns.
for (const [table, column] of [
  ["connection_settings", "statement_timeout_ms"],
  ["panel_runs", "total_cost"],
] as const) {
  const cols = fresh.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  check(`${table} has column ${column}`, cols.some((c) => c.name === column));
}

// CHECK constraints reject out-of-range settings.
let rejected = false;
try {
  fresh.prepare("INSERT INTO connection_settings (connection_id, statement_timeout_ms) VALUES ('x', 1)").run();
} catch {
  rejected = true;
}
check("connection_settings CHECK rejects out-of-range timeout", rejected);

process.exit(failures ? 1 : 0);
