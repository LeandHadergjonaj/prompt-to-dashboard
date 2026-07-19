#!/usr/bin/env npx tsx
// Writes db/schema-context.md for the legacy env-configured connection.
// Run: DATABASE_URL=... npm run introspect
// (In-app onboarding introspects automatically; this script is only for the
// DATABASE_URL_READONLY setup path.)
// TLS comes from the connection string's sslmode parameter
// (disable | require | no-verify | verify-full).
import { Client } from "pg";
import { writeFileSync } from "node:fs";
import { introspectDatabase } from "../lib/introspect";

const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_READONLY;
if (!connectionString) {
  console.error(
    "Set DATABASE_URL (or DATABASE_URL_READONLY) to a Postgres connection string, e.g.\n" +
      "  DATABASE_URL=postgresql://user:pass@host:5432/db npm run introspect"
  );
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString });
  await client.connect();
  const { markdown, stats } = await introspectDatabase(client);
  await client.end();
  writeFileSync("db/schema-context.md", markdown);
  console.log(
    `Wrote db/schema-context.md (${stats.tableCount} tables, ~${stats.totalApproxRows} rows)`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
