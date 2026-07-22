// Provision a synthetic large database for big-data testing (PLAN4 §3).
//
//   npx tsx scripts/fixture-bigdb.ts "postgresql://admin@localhost:5432/postgres" [rows]
//
// Creates database `bigdb_fixture` (dropped first if present) with:
//   - events:      `rows` rows (default 10M) via generate_series — no
//                  dataset download, ~1-2 min locally. Deliberately NO index
//                  on created_at so min/max scans are slow, exercising the
//                  introspection timeout fallbacks (A.1) and timeout repair (A.2).
//   - daily_stats: a small pre-aggregated table (the "make a view" story).
//   - events_by_day: a view over events (view-column introspection, A.1 §5).
//
// After it finishes, onboard `bigdb_fixture` through /app/connect and watch
// introspection complete within the sampling bounds instead of hanging.
import { Client } from "pg";

const adminUrl = process.argv[2];
const rows = Number(process.argv[3] ?? 10_000_000);
if (!adminUrl) {
  console.error('usage: npx tsx scripts/fixture-bigdb.ts "postgresql://admin@host:5432/postgres" [rows]');
  process.exit(1);
}

async function main() {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  console.log("dropping/creating database bigdb_fixture ...");
  await admin.query("DROP DATABASE IF EXISTS bigdb_fixture WITH (FORCE)");
  await admin.query("CREATE DATABASE bigdb_fixture");
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = "/bigdb_fixture";
  const db = new Client({ connectionString: url.toString() });
  await db.connect();

  console.log(`creating events with ${rows.toLocaleString()} rows (this takes a while) ...`);
  await db.query(`
    CREATE TABLE events (
      id         bigint PRIMARY KEY,
      created_at timestamptz NOT NULL,
      event_type text NOT NULL,
      user_ref   bigint NOT NULL,
      amount     numeric(10,2) NOT NULL
    )`);
  await db.query(`
    INSERT INTO events (id, created_at, event_type, user_ref, amount)
    SELECT g,
           timestamptz '2022-01-01' + (g % 1500) * interval '1 day' + (g % 86400) * interval '1 second',
           (ARRAY['page_view','signup','purchase','refund','login'])[1 + g % 5],
           g % 250000,
           round((random() * 500)::numeric, 2)
    FROM generate_series(1, ${rows}) AS g`);

  console.log("creating daily_stats and events_by_day ...");
  await db.query(`
    CREATE TABLE daily_stats AS
    SELECT created_at::date AS day, event_type, count(*) AS event_count, sum(amount) AS total_amount
    FROM events GROUP BY 1, 2`);
  await db.query(`
    CREATE VIEW events_by_day AS
    SELECT created_at::date AS day, count(*) AS event_count FROM events GROUP BY 1`);
  await db.query("ANALYZE events");
  await db.query("ANALYZE daily_stats");

  const { rows: counts } = await db.query("SELECT count(*)::bigint AS n FROM events");
  console.log(`done — events has ${Number(counts[0].n).toLocaleString()} rows in bigdb_fixture`);
  await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
