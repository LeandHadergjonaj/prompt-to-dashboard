# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Professional repo scaffolding: MIT license, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, GitHub issue/PR templates, `.editorconfig`.

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
- A full Pagila (DVD rental sample database) load-and-scale pipeline (`db/00`–`05`, `scripts/01`–`04`)
  as a reference dataset, parked unused in favor of the project's live dataset for the first
  deployment — see `PLAN.md`'s post-execution addendum.
