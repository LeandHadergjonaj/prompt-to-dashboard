# Plan 4 — Multiple data sources and large-data analysis

Builds on the per-connection engine from `PLAN3.md`. This plan answers two
questions end to end, with best-practice solutions and concrete build steps:

1. **How should the product handle multiple data sources** — today they are
   parallel silos (one connection per dashboard, picker to switch); what are
   the right steps toward side-by-side and true cross-source analysis?
2. **How does the system analyze 5+ GB of data** — what actually limits it,
   what breaks first, and what to build so large databases work reliably?

Written before implementation. Judgment calls and assumptions are logged at
the bottom. Every "current state" claim below was verified by reading the
code at the commit this plan was written on.

---

## 0. Current state (verified)

- **One connection per dashboard.** Every API call carries a `connectionId`
  (`null`/`"env"` = the env-configured built-in connection). The header picker
  (`/app?c=`) selects it; switching resets the conversation
  (`hooks/useDashboard.ts` → `setConnectionId`). Saved dashboards store one
  `connection_id` and reopen against it.
- **All compute is pushed down to the source database.** The app never holds
  the dataset: the LLM sees only the introspected schema context + retrieved
  few-shot pairs; generated SQL runs in the user's PostgreSQL; results come
  back capped by the `LIMIT 5001` wrap (`lib/sqlGuard.ts` →
  `wrapForExecution`). Data volume therefore does not flow through the app —
  only aggregated panels do.
- **The effective large-data limit is latency, not size**: the
  `dashboard_reader` role sets `statement_timeout = '20s'`
  (`lib/connections.ts` → `ensureReaderRole`, `db/readonly_role.sql`), and
  `createReaderPool` passes the same as a connection parameter (`lib/db.ts`).
  Timeouts surface as pg code `57014` → `query_timeout` (504) with a
  "narrow the question" message (`app/api/panel/route.ts`).
- **Introspection runs unbounded scans.** `lib/introspect.ts` computes
  `min()/max()` for every date column and `GROUP BY` value enumeration for
  every eligible text/boolean column, with no row-count gate and no
  per-query timeout. Fine at demo scale; a liability on 5 GB tables (see §2.2).
- **Views/matviews/foreign tables are queryable but undocumented**: they are
  added to the binding catalog with **empty column lists** (`introspect.ts`
  end), so the guard accepts them but the LLM never learns their columns.
- **No query telemetry.** Nothing records how long panels take, which time
  out, or which tables are hot. Every performance conversation is anecdotal.
- **App store migrations are `CREATE TABLE IF NOT EXISTS` only**
  (`lib/appStore.ts`). Adding columns to existing tables (needed by several
  phases below) has no mechanism yet.

### The honest answer to "5 GB across multiple sources" today

- 5 GB in **one** PostgreSQL: works now, provided the queries the LLM writes
  are index-friendly or complete within 20 s. Nothing in the app needs to
  change for data volume per se — the gaps are introspection cost, timeout
  UX, and observability (Phase A fixes these).
- 5 GB spread across **several** sources, analyzed **together**: not
  supported today in a single query, by design. Phases B–D add this in three
  escalating steps (side-by-side → in-Postgres federation → a real
  federation engine), each with its own cost/benefit.

---

## 1. Guiding principles (apply to every phase)

1. **Push compute down; never pull data up.** The app must never become a
   data plane. Any feature that requires streaming source rows through
   Node.js at scale is out (this rules out app-side joins in Node — see §8).
2. **Safety invariants are non-negotiable and phase-independent**: read-only
   role, read-only transaction, single-statement SELECT-only AST guard with
   identifier binding, LIMIT wrap, statement timeout. Every phase below
   states explicitly how it preserves each invariant.
3. **Degrade, don't break.** Every new mechanism (telemetry, cost guard,
   federation) must fail toward current behavior, the same way few-shot
   retrieval degrades to "no examples".
4. **One phase per PR-sized unit.** Later phases depend on earlier ones but
   each lands independently useful.

---

## Phase 0 — Foundations (prerequisite for everything below)

### 0.1 Versioned app-store migrations

**Problem.** `lib/appStore.ts` applies idempotent `CREATE TABLE IF NOT
EXISTS` DDL. Phases below need `ALTER TABLE` (new columns on `dashboards`),
new tables (`panel_runs`, `connection_settings`), and backfills. SQLite has
no `ADD COLUMN IF NOT EXISTS`, so re-runnable DDL alone stops working the
moment we alter anything.

**Solution.** Standard `PRAGMA user_version` migration ladder:

```ts
// lib/appStore.ts
const MIGRATIONS: string[] = [
  /* 1 */ SCHEMA_V1,                     // exactly today's SCHEMA string
  /* 2 */ `ALTER TABLE ...; CREATE TABLE ...;`,
];
function migrate(db: Database.Database) {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
```

Rules: migrations are append-only, each runs in a transaction, never edit a
shipped entry. Existing databases (currently `user_version = 0` with V1
tables already present) are handled by making migration 1 idempotent
(`IF NOT EXISTS`, as today) so the ladder converges from both states.

**Files**: `lib/appStore.ts`. **Test**: unit script that opens a temp DB at
V0-with-tables and at empty, migrates both to head, asserts identical
`sqlite_master` shape.

### 0.2 Per-connection settings

**Problem.** One global 20 s timeout and one row cap for every database is
wrong once databases differ by 100× in size. These belong to the connection.

**Solution.** New table (via 0.1):

```sql
CREATE TABLE connection_settings (
  connection_id  TEXT PRIMARY KEY,     -- 'env' allowed (same sentinel as examples)
  statement_timeout_ms INTEGER NOT NULL DEFAULT 20000
                 CHECK (statement_timeout_ms BETWEEN 5000 AND 120000),
  max_result_rows      INTEGER NOT NULL DEFAULT 5000
                 CHECK (max_result_rows BETWEEN 100 AND 20000),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

Plumbing: `getExecutionContext` reads settings into the returned context;
`createReaderPool` takes `statement_timeout` from it (connection parameter,
exactly as today — **not** a `SET` statement, which the guard forbids and
must keep forbidding); `wrapForExecution(sql, maxRows)` takes the row cap.
Important: the DB-level role also has `statement_timeout = '20s'` as a
`ALTER ROLE ... SET`; onboarding should set the role default to the **max**
allowed (120 s) and let the per-connection parameter be the effective,
tighter bound — otherwise per-connection values above 20 s silently don't
work. Rotation of existing connections happens on next re-onboard (document
this; do not auto-touch user databases).

UI: a small "Connection settings" disclosure on `/app/connect`'s done card
and on a new per-connection row in a settings surface (can be deferred; API
first: `PATCH /api/connections/:id` accepting `{ settings }`).

**Files**: `lib/appStore.ts`, `lib/connections.ts`, `lib/db.ts`,
`lib/sqlGuard.ts` (`wrapForExecution` signature), `app/api/panel/route.ts`,
`app/api/connections/[id]/route.ts`, onboarding role DDL in
`lib/connections.ts` + `db/readonly_role.sql` (+ README).

### 0.3 Panel-run telemetry

**Problem.** Phases A2/A4 (cost guard, advisor) and any honest performance
work need ground truth: which queries run, how long, against which tables,
which time out.

**Solution.** Append-only table, written best-effort (never fails a
request), pruned by size:

```sql
CREATE TABLE panel_runs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  connection_id TEXT NOT NULL,          -- 'env' sentinel, as examples
  sql           TEXT NOT NULL,          -- sanitized SQL (pre-wrap)
  duration_ms   INTEGER NOT NULL,
  row_count     INTEGER,                -- NULL on error
  outcome       TEXT NOT NULL CHECK (outcome IN ('ok','timeout','error','rejected')),
  error_code    TEXT,                   -- pg code when outcome != 'ok'
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_panel_runs_scope ON panel_runs(connection_id, created_at);
```

Cap ~2 000 rows per connection (delete-oldest on insert, same pattern as
`lib/examples.ts`). Recorded in `app/api/panel/route.ts` around
`executePanelQuery` (wall-clock via `performance.now()`), including guard
rejections (`outcome='rejected'`). Privacy note for README: telemetry stays
in the local `.data/app.db`, never leaves the deployment, and contains SQL
text but no result data.

**Files**: `lib/appStore.ts`, new `lib/telemetry.ts`,
`app/api/panel/route.ts`.

---

## Phase A — Large-data hardening (the "5 GB in one source" track)

Everything here benefits every deployment immediately and none of it changes
the product's shape. Recommended first after Phase 0.

### A.1 Introspection that survives big tables

**Problem (concrete).** For a 40 M-row `events` table, onboarding today runs
`SELECT min(created_at), max(created_at) FROM events` (index-assisted only
if an index exists) and up to a dozen
`SELECT col, count(*) ... GROUP BY 1 ORDER BY n DESC` full scans — during a
synchronous HTTP request with **no timeout** on the admin connection.
Onboarding a large database can hang for minutes or appear to fail.

**Solution — bound every sampling query, gate by size, degrade to less
detail:**

1. Open the admin introspection with a session-level cap:
   `SET statement_timeout = '5s'` per sampling query (allowed here — this is
   our own admin session, not guarded panel SQL). One slow query skips that
   note, logged into the markdown as `- events.payload_type: (skipped —
   table too large to sample)` so the LLM knows the gap is deliberate.
2. Gate value enumeration by `approxRows`: full `GROUP BY` only when
   `approxRows ≤ 2_000_000`; between 2 M and ~50 M use
   `TABLESAMPLE SYSTEM (1)` with a note that values are sampled; above that,
   skip enumeration entirely. (`reltuples` is already fetched per table —
   reuse it; it can be stale, which is fine for a gate.)
3. Date ranges: try plain `min/max` under the 5 s cap (index makes it
   instant); on timeout, fall back to
   `min/max` over `TABLESAMPLE SYSTEM (1)` marked as approximate.
4. Emit row counts in the markdown in humanized form (`~40M rows`) so the
   generation prompt can warn the model: a new static-prompt line —
   "prefer aggregates and date filters on tables marked with millions of
   rows; avoid selecting raw rows from them".
5. Document columns for **views and materialized views** (from
   `information_schema.columns`) instead of the current empty catalog
   entries — views are precisely what admins create to make big data
   queryable, so the LLM must see them. Matviews get their row count too.

**Files**: `lib/introspect.ts` (bulk of the change),
`lib/openai.ts` (one static-prompt line), `scripts/introspect-schema.ts`
(unchanged, wrapper). **Tests**: run introspection against a fixture DB with
a large synthetic table (generate with `generate_series` in a setup script);
assert notes degrade instead of hanging (assert wall-clock bound).

### A.2 Timeout-aware repair and honest timeout UX

**Problem.** Today a `57014` timeout takes the same path as a syntax error:
`useDashboard.attemptRepair` sends it to `/api/repair`, which asks the LLM
to "fix" SQL that was semantically fine but too slow — usually returning a
cosmetically different query that times out again, doubling the pain
(2 × 20 s + 2 LLM calls) before the panel fails.

**Solution.**

1. `/api/repair` gains awareness: when `errorMessage` contains the canceled-
   statement signature (or the client passes the structured code — better:
   extend `RepairRequestSchema` with `errorCode: string | null`), the repair
   prompt switches instruction sets: *"the query was correct but exceeded
   the time budget — rewrite it to do less work: pre-aggregate, add a date
   filter to the most recent N months, reduce joins, or use an existing
   materialized view"*. That is a genuinely fixable failure mode and worth
   exactly one attempt.
2. The panel error card for a timeout (client already receives
   `query_timeout`) gets a distinct treatment: message plus a one-click
   "Retry with last 90 days" affordance — implemented honestly by resending
   the user's question to `/api/dashboard` with a synthetic follow-up turn
   ("restrict this panel to the most recent 90 days"), not by string-editing
   SQL client-side.
3. Telemetry (0.3) records `outcome='timeout'` so repeated timeouts per
   table become visible for A.4.

**Files**: `lib/types.ts` (`RepairRequestSchema` + client hook types),
`lib/openai.ts` (repair prompt branch), `app/api/repair/route.ts`,
`hooks/useDashboard.ts` (pass `errorCode`, add the retry affordance
plumbing), one panel-card component. **Tests**: extend
`scripts/test-prompt.ts` to assert the timeout branch of the repair prompt
mentions time budget/pre-aggregation and NOT identifier quoting boilerplate
only; hook-level behavior verified by an integration smoke against a
fixture DB with `statement_timeout` set to 1 ms.

### A.3 Optional pre-flight cost guard (warn-first, then enforce)

**Problem.** A 20 s timeout is a blunt instrument: the user waits the full
20 s to learn the query was hopeless, per attempt.

**Solution (two stages, gated by telemetry evidence).**

- Stage 1 (cheap, ship with Phase A): before executing, run
  `EXPLAIN (FORMAT JSON) <wrapped sql>` on the same pool (EXPLAIN without
  ANALYZE is read-only, fast, and does not execute). Record
  `total_cost` into `panel_runs`. **Take no action yet** — cost units are
  not portable across databases, so first accumulate (cost, duration,
  outcome) pairs per connection.
- Stage 2 (only after data justifies it): per connection, derive a
  cost threshold from its own history (e.g. the cost above which >50 % of
  runs timed out, with a hard floor). Above the threshold: still run, but
  flag the panel UI "this looks expensive" immediately (perceived
  responsiveness), and let the repair prompt know. Full rejection stays
  off by default (`connection_settings.cost_guard = 'off'|'warn'|'enforce'`)
  — false-positive rejections of fine queries are worse than slow panels.

Guard interaction: `EXPLAIN` is issued by **our** code on the pooled
read-only connection, never accepted from the model — `ExplainStmt` remains
forbidden by the AST guard (it is a distinct statement node, already
rejected today; add an explicit test).

**Files**: `lib/db.ts` (explain helper), `app/api/panel/route.ts`,
`lib/telemetry.ts`, `scripts/test-sqlguard.ts` (EXPLAIN rejection case).

### A.4 Performance advisor (read-only, suggestions only)

**Problem.** When panels routinely time out on a table, the fix (an index,
a materialized view, `ANALYZE`) lives in the user's database, which we are
sworn never to write. Today the user gets no help at all.

**Solution.** A per-connection "Performance" card (surface: the saved-
dashboards page or a connection detail view) generated on demand:

1. Aggregate `panel_runs` for the connection: slowest recurring SQL shapes,
   timeout rate per referenced table (tables extracted via `libpg-query`
   parse of stored SQL — reuse the guard's parser, no regexes).
2. One LLM call over (aggregates + schema context) producing 2–4 concrete,
   copy-pasteable suggestions, each as DDL in a code block with a plain-
   English cost/benefit line, e.g. `CREATE INDEX CONCURRENTLY idx_events_created_at ON events (created_at);`
   or a matview + refresh-cadence suggestion for a hot monthly rollup.
3. **Never executed by the app.** Clearly labeled "run this yourself as an
   admin". This preserves the read-only stance while actually solving the
   user's problem. Deterministic fallback if the LLM call fails: top-3
   timeout tables with a generic index hint.

**Files**: new `lib/advisor.ts`, new route `GET
/api/connections/:id/advice`, small UI card. **Effort note**: this is the
most deferrable item in Phase A; ship A.1–A.3 without it if time-boxed.

---

## Phase B — Side-by-side multi-source dashboards (per-panel connections)

**What it delivers.** One dashboard mixing panels from different databases —
"Postgres-A revenue next to Postgres-B signups". No cross-source joins (a
single panel still queries exactly one database). This is the largest UX
win per unit of risk, and it is the correct *product* answer for most
"multiple sources" asks, which are comparison asks, not join asks.

### B.1 Data model and types

- `dashboards` keeps its dashboard-level `connection_id` as the **default**;
  each saved panel gains an optional override. No schema change needed for
  the spec payload (panels live inside `spec_json`) — but `PanelWithIdSchema`
  gains `connectionId: z.string().max(100).nullable().default(null)`
  (null = inherit dashboard default). `HistoryPanelSchema` gains the same so
  follow-up turns preserve panel→source attribution.
- `PanelRequestSchema` already carries `connectionId` — unchanged; the
  client simply sends the panel's effective connection instead of the
  dashboard-level one.
- Few-shot examples: attribute each accepted pair to the **panel's**
  connection (`app/api/dashboards` POST/PATCH already computes pairs from
  panels; extend the pair with the panel's effective connection id).

### B.2 Generation across N schemas (the hard part)

The single `/api/dashboard` call must know every selected source's schema to
plan panels against them. Design:

- The client sends `connectionIds: string[]` (1–3, hard cap 3) instead of a
  single id. Order matters and is preserved (see caching).
- The server builds the system context as: static prompt (unchanged, cache-
  stable) + **one system message per connection**, each prefixed
  `## Source "<name>" (id: <id>)` around its schema context, in the request's
  connection order + the few-shot message (pairs retrieved per connection,
  interleaved, each labeled with its source name).
- Structured output: `PanelSpecSchema` in the generation schema gains
  `sourceId: string` (must equal one of the provided ids; validated
  server-side after generation, invalid → treat as first source + log).
  The static prompt explains: *"each panel queries exactly ONE source; SQL
  must only reference tables from that panel's source"*.
- **Guard binding enforces the promise**: `/api/panel` binds SQL against the
  catalog of the panel's `connectionId` — a hallucinated cross-source
  reference fails identifier binding with "unknown table", exactly like any
  hallucinated table today. No guard code changes needed; this invariant is
  why per-panel connections are cheap to secure.
- **Prompt-cache reality check**: today the prefix (static + one schema) is
  byte-stable per connection. With multi-source, the prefix is stable per
  *ordered combination* — acceptable at a cap of 3; sort ids
  deterministically (dashboard-default first, then lexicographic) to avoid
  cache-splitting on UI ordering accidents.
- Token budget: 3 schema contexts can be large. Mitigation in this phase:
  cap at 3 sources; A.1's humanized/leaner contexts help. Do **not** build
  schema-pruning/RAG-over-schema yet (it changes answer quality
  unpredictably); note it as a future lever.

### B.3 Execution, history, persistence, UI

- `useDashboard`: `connectionIdRef` becomes `connectionIdsRef: string[]`
  (primary first). `runPanel`/`attemptRepair` send the panel's own
  `connectionId ?? primary`. History turns store panel `connectionId`s.
  Switching the *primary* source still resets the conversation; adding a
  comparison source does not (history stays valid — existing panels keep
  their sources).
- Repair: `RepairRequestSchema` unchanged (already takes `connectionId`);
  client passes the panel's.
- Save/reopen: no route changes (spec carries the per-panel ids); the save
  validation loop must check **every** referenced connection still exists,
  not just the dashboard-level one (`app/api/dashboards/route.ts`).
  Reopening re-runs each panel against its own source; a missing source
  fails only its panels with a clear message, not the whole dashboard.
- UI: the header picker becomes a compact multi-select ("Primary: A ·
  also using: B"); each panel gets a small source badge when the dashboard
  uses >1 source; the connect page is unchanged.
- Examples/`?c=` deep links: `?c=` keeps meaning the primary; an additional
  `&also=` param can wait.

### B.4 Safety review for Phase B

- Read-only role/transaction/limit/timeout: unchanged (each panel runs on
  its own connection's pool exactly as today).
- AST guard: unchanged code; binding catalog selected per panel. New test:
  spec'd source A, SQL referencing a B-only table → rejected as unknown.
- Identity scoping: all connections in `connectionIds` must belong to the
  cookie user — `getExecutionContext` already enforces per-id; the
  dashboard route must validate the full array before generation.

**Files**: `lib/types.ts`, `lib/openai.ts` (context assembly + prompt line +
generation schema), `app/api/dashboard/route.ts`, `app/api/dashboards/*`
(validation + example attribution), `hooks/useDashboard.ts`,
`app/app/page.tsx` + picker component, `components/DashboardView.tsx`
(badges). **Tests**: prompt-assembly unit checks (ordering, labeling,
cache-stable prefix), guard cross-source rejection, save/reopen round-trip
with two sources, `npm test`/lint/build, live smoke with two local DBs.

---

## Phase C — Cross-source joins inside PostgreSQL (`postgres_fdw` hub)

**What it delivers.** Real joins across sources ("revenue per customer from
DB-A joined to support tickets from DB-B in one chart") using PostgreSQL's
own federation, with **zero engine changes** — because the engine already
treats whatever is in `public` of the connected database as the schema.

### C.1 Two delivery levels

**Level 1 — documentation + introspection support (small, ship first).**
A user with admin access creates a hub database themselves:

```sql
CREATE EXTENSION postgres_fdw;
CREATE SERVER src_a FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (host '...', dbname 'a', fetch_size '1000');
CREATE USER MAPPING FOR dashboard_reader SERVER src_a
  OPTIONS (user 'dashboard_reader', password '<remote reader pw>');
IMPORT FOREIGN SCHEMA public FROM SERVER src_a INTO a;
-- expose with source-prefixed names the LLM can distinguish:
CREATE VIEW public.a__orders AS SELECT * FROM a.orders;
```

Then they onboard the hub through the normal `/app/connect`. What we must
fix for this to work well (all verified gaps):

- Introspection documents view/foreign-table **columns** (shared work with
  A.1 §5 — this is the same change).
- The introspection markdown labels foreign relations as
  "federated (remote) — queries cross the network; prefer aggregation
  before joining" so the LLM plans pushdown-friendly SQL.
- README gets a worked "Federate multiple databases" guide including the
  security note: user mappings should reference the **remote**
  `dashboard_reader` (re-onboarding the remote source rotates that password
  and breaks the mapping — document the `ALTER USER MAPPING` fix).

**Level 2 — guided hub setup in-app (larger, optional, decide after Level 1
sees use).** Extend `/app/connect` with "add this source to an existing
hub": the app executes the `CREATE SERVER` / `USER MAPPING` /
`IMPORT FOREIGN SCHEMA` / prefixed-views ritual itself over the hub's admin
URL (transient, like onboarding), using remote reader credentials it
generates on the remote first. Meaningful new failure surface (network
between the two databases, `pg_hba.conf`), so it must come with precise
error taxonomy. Judgment: build only if Level 1 documentation proves the
demand.

### C.2 Constraints to document honestly

- Pushdown: modern PG pushes down WHERE and (since PG 14, with
  `extensions`/`fetch_size` tuned) many aggregates, but cross-server joins
  can still pull remote rows to the hub. The per-connection timeout (0.2)
  is the backstop; A.2's timeout repair covers the UX.
- The hub's `statement_timeout` governs the whole federated query; remote
  role timeouts must be ≥ hub's (document; Level 2 sets this up correctly).
- Guard/binding: no changes — foreign tables and prefixed views live in the
  hub's `public` and bind like any table (`relkind 'f'`/`'v'` already enter
  the catalog).

---

## Phase D — True federation engine (DuckDB) — only if joins-without-a-hub
become a product requirement

**What it delivers.** "Join 3 Postgres sources in one query, no hub DB, no
ETL" — DuckDB attaches each source read-only
(`ATTACH 'postgres://…' AS a (TYPE postgres, READ_ONLY)`) and executes
cross-database SQL in-process, streaming from the sources.

**Why it is deliberately last.** It introduces a second SQL dialect and a
second execution engine, which breaks the current single-trust-chain design:

- **Guard**: `libpg-query` no longer matches the executing engine's grammar.
  DuckDB is close to PG but not identical (three-part
  `source.schema.table` names arrive in `RangeVar.catalogname` — binding
  must resolve (source alias, table) against a **merged multi-source
  catalog**; some DuckDB functions don't exist in PG and would fail parsing).
  Mitigation: constrain the LLM to the PG-compatible subset; parse with
  `libpg-query` as today; extend `RangeVar` binding with `catalogname`
  resolution; hard-reject anything that fails the PG parse. Accepted
  limitation: a slice of valid DuckDB SQL is rejected — fine, safety first.
- **Sandboxing (non-negotiable list)**: run in a separate worker process;
  `SET enable_external_access = false` (kills `read_csv`/`read_parquet`/
  `httpfs` — the DuckDB analogues of `pg_read_file`); `SET memory_limit`
  (e.g. 1–2 GB) + temp spill directory under `.data/duck-tmp`; wall-clock
  kill from the parent (DuckDB has no statement_timeout equivalent to trust
  alone — the parent process terminates the worker); attach every source
  with the connection's existing **reader** DSN (reuse stored encrypted
  credentials — no new secrets), `READ_ONLY`.
- **Row cap**: the same `LIMIT` wrap applies verbatim.
- **Resource reality**: cross-source joins on 5 GB tables stream through the
  app host — this is the one phase that violates "the app is not a data
  plane" in a controlled way. The memory limit + spill + timeout make it
  bounded; the docs must set expectations (aggregate-then-join queries are
  fast; row-level cross-joins of two 40 M-row tables are not going to fit
  any interactive budget, on any tool of this class).
- **Product shape**: a "federated view" is a virtual connection — appears in
  the picker like any connection, is defined as a set of member connection
  ids, introspects by merging member catalogs with `a.`/`b.` prefixes, and
  stores nothing new secret-wise. Dashboards/examples scope to it normally.

Decision gate: build D only when concrete demand exists that Phase B
(side-by-side) plus Phase C (hub) demonstrably can't serve, because its
maintenance surface (second engine, dialect drift, sandbox) is permanent.

**Alternative for heavy users, zero engine work**: ETL into a warehouse
(even "one more Postgres" fed by Airbyte/Fivetran/pg_dump-cron) and onboard
that. The README should say this plainly in the federation guide — for
recurring heavy cross-source analytics it beats live federation on cost,
speed, and reliability, and this product consumes the result natively.

---

## 2. Recommended sequencing and why

| Order | Phase | Effort (rough) | Unlocks |
|---|---|---|---|
| 1 | 0.1 migrations | S | everything below |
| 2 | 0.3 telemetry | S | A.2–A.4 evidence base |
| 3 | A.1 introspection bounds + view columns | M | 5 GB onboarding reliability; feeds C |
| 4 | A.2 timeout-aware repair/UX | M | biggest big-data UX win |
| 5 | 0.2 per-connection settings | S–M | tunable timeouts/caps |
| 6 | B per-panel sources | L | multi-source dashboards (no joins) |
| 7 | C Level 1 (FDW docs + labels) | S | cross-source joins for admins |
| 8 | A.3 cost guard stage 1→2 | M | fast-fail expensive queries |
| 9 | A.4 advisor | M | closes the perf loop |
| 10 | C Level 2 guided hub | L | joins without leaving the app |
| 11 | D DuckDB federation | XL | joins without a hub — only on demand |

Rationale: 1–5 make the *existing* product robust at 5 GB (the question's
first half) with no shape change; 6–7 answer the multi-source half in the
cheapest trustworthy order; 8–11 are evidence-gated.

## 3. Cross-phase testing strategy

- **Fixture scale harness**: a `scripts/fixture-bigdb.ts` that provisions a
  local PG database with `generate_series` tables at 10 M+ rows (fast to
  create, no dataset download) — used by A.1/A.2/A.3 tests and CI-able.
- **Guard suite** grows with: EXPLAIN rejection (A.3), cross-source unknown
  table (B), `catalogname` binding cases (D, if built).
- **Round-trip smokes** (extend the pattern used to verify PLAN3): two-source
  save/reopen (B), FDW hub end-to-end against two local PGs (C), sandbox
  kill/memory-limit tests (D).
- Every phase ends with the standing bar: `npm test`, lint, `next build`,
  live smoke.

## 4. Explicit non-goals (so they don't creep in)

- **App-side joins in Node.js** (fetch two result sets, join in JS): breaks
  the row cap's meaning, the memory model, and the safety story. Panels
  may *display* side-by-side (B); they never merge datasets in the app.
- **Client-side big-data processing** (shipping rows to the browser beyond
  the panel cap): same reasons.
- **Result snapshotting** as a performance fix (saved dashboards stay live
  by design — PLAN3 decision stands; caching is a separate future concern
  with TTLs, not part of this plan).
- **Automatic writes to user databases** (indexes, matviews): the advisor
  suggests; the human executes. The read-only stance is the product.

## 5. Judgment calls / assumptions (flag disagreements early)

- **Side-by-side ≠ joins, and that's the right first multi-source step.**
  Most "multiple sources" requests are comparison dashboards; B delivers
  those at a fraction of C/D's risk. C/D are staged behind it deliberately.
- **Cap of 3 sources per dashboard** (B): token cost and prompt-cache
  combinatorics; raise later if real usage pushes on it.
- **Cost guard ships warn-only** (A.3): rejecting queries on non-portable
  planner cost estimates without per-connection evidence would create
  support pain worse than slow panels.
- **DuckDB is the endgame, not the next step** (D): a second engine/dialect
  is the single most expensive permanent commitment in this plan; the gate
  is demonstrated demand B+C can't meet.
- **Telemetry is local-only** (0.3): no phone-home; it exists to serve the
  deployment's own advisor and thresholds.
- **Role timeout becomes the ceiling (120 s), connection param the real
  bound** (0.2): otherwise per-connection tuning above 20 s is a no-op lie.
  Applies to newly onboarded/re-onboarded connections only; documented.
