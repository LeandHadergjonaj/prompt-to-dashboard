# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Multi-source dashboards**: one dashboard can draw panels from up to 3 databases side by side.
  The header picker gains a "+ compare" control; each panel carries (and is validated against) its
  own connection; saved dashboards, conversation history, and few-shot examples are all attributed
  per panel's source. A single panel still queries exactly one database — SQL referencing another
  source's tables fails identifier binding before execution.
- **Large-database introspection bounds**: onboarding sampling queries run under a 5s statement
  timeout, switch to `TABLESAMPLE` above ~2M rows, and skip value enumeration above ~50M — noting
  each degradation in the schema context instead of hanging. Views, materialized views, and
  foreign tables are now documented with their columns (foreign tables labeled as federated), and
  row counts are humanized (`~40M`) with a matching prompt rule steering the model toward
  aggregates on huge tables.
- **Timeout-aware repair and UX**: a panel cancelled by `statement_timeout` now takes a dedicated
  repair path ("do less work: pre-aggregate, narrow the date range, use an existing view") instead
  of the syntax-fix path, and its error card offers a one-click "Retry with last 90 days" that
  honestly re-plans the panel through the model.
- **Per-connection settings** (`PATCH /api/connections/:id`): statement timeout (5s–120s) and
  result-row cap (100–20,000) per database, `env` included. Newly onboarded reader roles carry a
  120s role-level ceiling so per-connection values above 20s actually take effect (existing
  connections keep 20s until re-onboarded).
- **Local panel-run telemetry**: every run (SQL, duration, outcome, planner cost estimate from a
  pre-flight `EXPLAIN`) is recorded in `.data/app.db`, capped at 2,000 rows per connection.
  Local-only, best-effort, no result data.
- **Performance advisor** (`GET /api/connections/:id/advice` + a card on the saved-dashboards
  page): aggregates telemetry per table/query shape and produces 2–4 copy-pasteable suggestions
  (indexes, matviews, `ANALYZE`) for a human admin — never executed by the app.
- **Versioned app-store migrations** (`PRAGMA user_version` ladder) replacing the re-runnable-DDL
  approach; pre-versioning databases converge automatically. Covered by `npm run test:appstore`.
- **Federation guide**: README documents joining sources through a `postgres_fdw` hub database
  (including the password-rotation caveat and the ETL-into-a-warehouse alternative).
- `npm run fixture:bigdb` provisions a 10M-row synthetic database for exercising all of the above.

- **In-app connection onboarding** (`/app/connect`): paste an admin connection string once and the
  app introspects the schema, creates/rotates a `SELECT`-only `dashboard_reader` role, proves the
  role cannot write (the probe must fail with PostgreSQL's "read-only transaction" error), and
  stores only the AES-256-GCM-encrypted read-only connection string. Admin credentials are never
  persisted. A connection picker in the app header (`?c=`) targets every request.
- **Saved dashboards**: save, list, open (`?d=`), rename, re-save, and delete — scoped to a signed
  anonymous browser identity. Saving again in the same conversation (or after reopening) updates
  the dashboard in place instead of creating a copy. Opening a saved dashboard re-runs its SQL, so
  the data stays live.
- **Few-shot learning from accepted queries**: saving a dashboard stores each rendered panel's
  question → SQL pair (with an embedding) per user + connection; generation retrieves the most
  similar accepted pairs and injects them as extra context. Embedding failures degrade to no
  examples, never to a failed request.
- **AST-based SQL validation**: `libpg-query` (the real PostgreSQL parser compiled to WASM)
  replaces the keyword denylist — single-statement SELECT-only enforcement, rejection of
  `SELECT ... INTO`, row locking, data-modifying CTEs, and dangerous functions, plus table-level
  identifier binding against the connection's introspected catalog (blocks `pg_catalog` /
  `information_schema` and hallucinated tables). The keyword guard remains as an automatic
  fallback if the WASM parser cannot load.
- App-local metadata store (`.data/app.db`, SQLite/WAL) for users, connections, dashboards, and
  examples — separate from user databases, which stay strictly read-only.

### Changed

- `DATABASE_URL_READONLY` is now optional: it defines the shared built-in connection when present,
  and the app works with zero database env config once users onboard their own connections.
- `APP_SECRET`, when set, must be at least 16 characters.
- Onboarding introspects before touching the reader role, so a failed onboarding attempt no longer
  rotates a password an existing connection may be using.

- **Rescoped to a database-agnostic dashboard engine.** The project no longer targets any
  particular company's database, hosting provider, or sector: LLM prompts are fully generic (all
  dataset-specific knowledge now travels in the generated schema context), the schema context is
  generated locally per deployment and gitignored instead of committed, and all provider-specific
  connection handling was removed.
- **Breaking:** TLS is now controlled entirely by the connection string's `sslmode` parameter.
  Connections that silently relied on the previous forced certificate-verification bypass must now
  set `sslmode=no-verify` explicitly.
- Display currency and locale are configurable via `NEXT_PUBLIC_CURRENCY` / `NEXT_PUBLIC_LOCALE`
  (previously hardcoded).
- Schema context is loaded lazily with a friendly "not connected yet" API error when missing,
  instead of crashing at startup.

### Removed

- The sample-dataset load/scale pipeline and its database scripts.
- The committed schema snapshot (`db/schema-context.md`) and the original build spec (`PLAN.md`).
- Environment-specific read-only-role scripts, replaced by a single generic `db/readonly_role.sql`.

### Added

- Professional repo scaffolding: MIT license, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, GitHub issue/PR templates, `.editorconfig`.
- `npm run introspect` script alias for generating the schema context.

## [0.1.0] - 2026-07-18

### Added

- Initial end-to-end text-to-dashboard system: Next.js 15 frontend, OpenAI Responses API agent for
  dashboard-spec and SQL-repair generation, and a defense-in-depth SQL execution layer
  (`lib/sqlGuard.ts` + a dedicated read-only Postgres role + read-only transactions + a hard row
  cap).
- Six chart types (line, bar, area, pie, stat, table) with automatic fallback to a table when a
  generated spec's field mappings don't match the returned columns.
- One-shot automatic SQL repair: a failing panel query gets a single LLM-driven correction attempt
  before falling back to a friendly error card.
- Generic Postgres schema-introspection script (`scripts/introspect-schema.mjs`) that builds the
  LLM's schema context from any database.
