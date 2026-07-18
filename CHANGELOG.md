# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

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
