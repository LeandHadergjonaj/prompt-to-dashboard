# Plan 3 — Onboarding, persistence, few-shot retrieval, AST validation

Builds on the generic prompt-to-dashboard engine (see `PLAN2.md` for the rescope
that produced the current state). Four features, in dependency order. Written
before implementation; judgment calls logged at the bottom.

## Current state (verified by reading the code)

- Stateless Next.js 15 app. One global pg `Pool` built at module load from
  `DATABASE_URL_READONLY` (`lib/db.ts`); schema context is a static generated
  file `db/schema-context.md` read by `lib/schemaContext.ts`.
- Three API routes: `/api/dashboard` (LLM → spec), `/api/panel` (guard + execute),
  `/api/repair` (LLM fix). Conversation history lives client-side in
  `hooks/useDashboard.ts` and is replayed per request. Nothing is persisted.
- SQL safety: keyword denylist + single-statement + SELECT/WITH prefix check in
  `lib/sqlGuard.ts`, subselect wrap with LIMIT 5001, read-only transaction,
  and the database-level `dashboard_reader` role (`db/readonly_role.sql`).
- No users, no auth, no storage of any kind.

## Research base

The repo's own sourced skills (`skills/text-to-sql/SKILL.md`) already identify
the two hard pieces of this plan, with citations:

- **Few-shot retrieval**: DAIL-SQL measured 72.3% → 83.5% execution accuracy on
  Spider from 5 similarity-retrieved examples; vanna (MIT), Dataherald
  ("golden SQL"), Uber/Pinterest/LinkedIn all converge on a store of accepted
  question→SQL pairs retrieved by embedding similarity. The skill explicitly
  calls this "the flywheel this repo doesn't have yet".
- **AST validation**: the skill recommends parse → allowlist statement type =
  SELECT → bind identifiers against the introspected schema, noting identifier
  binding also catches hallucinated tables (the most common semantic failure)
  before execution. Parser: `libpg-query` (npm, MIT, maintained by
  launchql/pganalyze lineage) — the *actual* PostgreSQL parser compiled to
  WASM, so there is no grammar-coverage gap like pure-JS parsers have. Needs
  `serverExternalPackages` in `next.config.ts` to avoid bundler WASM issues.
  Version tag `pg17` (17.7.3) — parses PG 13–17-compatible SQL.

## Architecture

### New infrastructure (feature 0, prerequisite for 1–3)

- **App store** — `better-sqlite3` at `.data/app.db` (WAL, gitignored).
  This is the app's *own* metadata store, deliberately separate from any
  user-connected database (which stays strictly read-only). Tables:
  `users`, `connections`, `dashboards`, `examples`. Plain SQL migrations
  applied idempotently on open; no ORM.
- **Identity** — anonymous per-browser identity: `ptd_uid` httpOnly cookie,
  value `<uuid>.<hmac-sha256>` signed with the app secret. Every API route
  resolves (or mints) the user and scopes all reads/writes by `user_id`.
  This gives real per-user separation without building login; swapping in a
  proper auth provider later only changes how `userId` is resolved.
- **Secrets** — `lib/secrets.ts`: AES-256-GCM (random IV, auth tag stored with
  ciphertext), key derived via scrypt from `APP_SECRET` env if set, otherwise
  from an auto-generated `.data/secret.key` (chmod 600). Used only for
  connection strings.
- **Config** — `DATABASE_URL_READONLY` becomes *optional* (it now defines the
  legacy "built-in" connection when present; the app also works with zero env
  DB config once users onboard their own). `lib/db.ts`'s module-level pool
  becomes lazy. `next.config.ts` gets
  `serverExternalPackages: ['better-sqlite3', 'libpg-query']`.

### 1. In-app connection onboarding

`lib/introspect.ts` — the logic of `scripts/introspect-schema.mjs` refactored
into an importable TS function returning `{ markdown, catalog, stats }`, where
`catalog` is `{ [table]: string[] }` (for AST identifier binding) and `stats`
is friendly material (table count, approx rows, date coverage, notable
columns). The script becomes a thin wrapper so `npm run introspect` still works.

`POST /api/connections` — body `{ name, adminUrl }`. Server-side, in order:

1. Connect with the admin URL (10s timeout), `SELECT current_database()`.
2. Create/refresh the `dashboard_reader` role with a freshly generated random
   password — the same statements as `db/readonly_role.sql`, executed from
   Node (the psql `\gexec` trick replaced by a JS existence check). Password is
   `crypto.randomBytes` base64url, so safe to inline in DDL.
3. Introspect the schema over the admin connection.
4. Build the reader DSN (same host/port/db/sslmode, reader credentials),
   verify it: `SELECT 1` must succeed, `CREATE TEMP TABLE` must *fail* with
   "read-only transaction" — a positive proof the role can't write.
5. Generate a 2–3 sentence plain-English summary of what was found (small LLM
   call over `stats`; deterministic template fallback if the call fails).
6. Encrypt and store the **reader** DSN only — the admin URL is used
   transiently and never persisted. Return `{ id, name, summary, stats }`.

`GET /api/connections` lists the user's connections (+ whether the env-based
legacy connection exists); `DELETE /api/connections/:id` removes one (and its
dashboards/examples).

`lib/connections.ts` — pool registry: `Map<connectionId, Pool>` (max 3 clients
each, idle-pruned), and `getExecutionContext(userId, connectionId | null)` →
`{ pool, schemaContext, catalog }`. `connectionId: null` = the legacy env
connection (schema context from `db/schema-context.md` as today; catalog
introspected lazily from `pg_catalog` and cached). **This is how nothing
regresses: requests without a `connectionId` behave exactly as before.**

UI: `/app/connect` — one form (connection name + admin connection string, with
plain-English framing of what will happen), progress state while the single
onboarding request runs, then a reassurance card: the summary sentence(s),
table count/row counts, date coverage — no raw schema dump — and a button into
`/app?c=<id>`. `/app` gains a connection picker in the header (persisted in the
URL as `?c=`), wired through `useDashboard` into all three API calls.

### 2. Dashboard persistence

`/api/dashboards`: `POST` (save: title, connectionId, spec — with each panel's
*effective* SQL, i.e. post-repair — and the conversation history), `GET` list,
`GET /:id` full, `PATCH /:id` (rename / re-save), `DELETE /:id`. All scoped to
the cookie user; a dashboard references the connection it was built on.

UI: Save button next to the Download menu; `/app/dashboards` list page
(title, connection name, updated-at; open/delete). Opening a saved dashboard
(`/app?d=<id>`) hydrates the hook via a new `loadSaved()` — restores spec +
history + connection, then re-runs panels through the normal `/api/panel` path
(data stays live; the saved artifact is the spec, not a stale snapshot).
Follow-up questions on a reopened dashboard keep working because history is
restored.

### 3. Few-shot retrieval from accepted queries

**Accept signal = saving a dashboard.** Explicit, unambiguous, and composes
with feature 2. On save, each ready panel yields a pair:
`question = "<panel title>: <panel description>"` (a self-contained NL
description of what the SQL computes — turn-level questions like "make it a
pie" are not self-contained), `sql` = the SQL that actually ran.

`lib/examples.ts`: store pairs in the app DB with an OpenAI
`text-embedding-3-small` vector (Float32 blob); dedupe on
(connection, question, sql); cap ~200 per connection (prune oldest).
Retrieval: embed the incoming question, cosine similarity in JS over that
user+connection's examples (trivial at this scale), threshold + top-4.

Injection: retrieved pairs go into the generation call as a *second* system
message ("previously accepted question→SQL pairs from this same database —
imitate their identifiers, joins and conventions when relevant"), after the
static system prompt, so the prompt-cache prefix is preserved. Embedding
failures degrade to no examples, never to a failed request.

### 4. AST-based SQL validation

`lib/sqlGuard.ts` rewritten around `libpg-query` (real PG parse trees).
`checkSql(rawSql, catalog?)` becomes async and enforces, structurally:

1. Parses as valid PostgreSQL; **exactly one** statement.
2. The statement is a `SelectStmt` (every write/DDL/utility statement the
   denylist matched by keyword — INSERT, UPDATE, DELETE, DROP, CREATE, GRANT,
   COPY, SET, BEGIN, CALL, … — is a different node type, so all are rejected
   by this one check, with zero false positives on literals/aliases).
3. Recursive walk of the whole tree rejects: `IntoClause` (SELECT … INTO),
   locking clauses (FOR UPDATE/SHARE), any embedded non-SELECT statement node
   (covers data-modifying CTEs like `WITH x AS (INSERT …)`).
4. Function denylist on every `FuncCall`: file/system access (`pg_read_file`,
   `pg_ls_dir`, …), large objects (`lo_import`/`lo_export`), `dblink*`,
   admin signals (`pg_terminate_backend`, …), `set_config`, `pg_sleep`,
   and the `query_to_xml`/`database_to_xml` family (arbitrary-query
   execution / catalog reads that would bypass binding).
5. **Identifier binding (table-level)**: every `RangeVar` must resolve to a
   table in the connection's introspected catalog or a CTE name defined in
   the query; schema-qualified names must be `public`. This structurally
   blocks `pg_catalog` / `information_schema` reads and catches hallucinated
   tables before execution. Column-level binding is deliberately out of scope
   (alias/scope resolution is where false rejections live; column errors are
   already handled by the repair loop).

Coverage vs. the old denylist is a strict superset (mapping in the report);
the legacy keyword guard is kept in the same file and used as an automatic
fallback if the WASM parser ever fails to load, so safety can degrade *to* the
current level, never below it. The read-only transaction wrap, LIMIT wrap,
statement timeout, and DB role are all unchanged underneath.

## Build order

0. Foundation (store, secrets, identity, lazy env) — everything below needs it.
1. AST guard (independent; land early so all later execution paths use it).
2. Onboarding (needs foundation; provides the per-connection model).
3. Persistence (needs identity + connections).
4. Few-shot (needs persistence's accept signal + connections).
5. Verification: extended guard tests, `npm test`, lint, `next build`, smoke
   checks against the configured live database.

## Judgment calls (made without asking, per instructions)

- **Anonymous cookie identity instead of full auth.** The constraint is
  separation, not login. A signed httpOnly cookie gives real per-user data
  isolation now; a login system is a natural next step and slots in behind
  the same `userId` resolution point. Caveat: clearing cookies orphans data.
- **SQLite for app metadata** rather than requiring an app-owned Postgres:
  zero-config for self-hosting, transactional, one file to back up. The
  engine's read-only stance toward *user* databases is untouched.
- **Fixed role name `dashboard_reader`** (idempotent create-or-rotate), same
  as the existing script — re-onboarding the same database rotates the
  password rather than accumulating roles.
- **Admin credentials are never stored**, only used in-request. Re-running
  onboarding is the recovery path if the reader password is lost.
- **Accept signal = explicit save**, not implicit render success — implicit
  signals would happily learn from dashboards the user looked at and
  discarded as wrong.
- **Example text = panel title+description**, not the raw multi-turn user
  question (often not self-contained: "make it a pie").
- **Table-level (not column-level) identifier binding** — see §4.
- **Examples scoped per user+connection** — sharing across users would leak
  one user's question phrasing/SQL to another.
- **Saved dashboards re-run their SQL on open** (live data) instead of
  storing result snapshots.
