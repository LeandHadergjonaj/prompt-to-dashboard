# Rescope: company-specific dashboard tool → generic AI dashboard engine

## Context

The repo (`text-to-sql`, a Next.js 15 + TypeScript text-to-dashboard app) was built and tested against one company's Supabase database (a UK commercial-property dataset), after an earlier spec targeting the Pagila sample dataset. The product being rescoped to is a **generic plugin/extension-style engine**: AI-driven dashboard creation on top of *any* user-supplied Postgres-compatible connection — sector-agnostic, vendor-agnostic, not a destination BI tool. This pass is cleanup/rescope only: remove everything Supabase- and company-specific, generalize the reusable pipeline (introspection → NL→dashboard-spec → guarded SQL execution → chart rendering), no new features or frontend. Per the user's instructions: write `PLAN2.md` to the repo root first, then execute without further approval, logging judgment calls in `PLAN2.md`.

**Verified state:** no real secrets are committed (no keys/passwords; `.env*` gitignored, none tracked). The company coupling lives in: `db/schema-context.md` (generated schema snapshot **containing real sampled data values**), `lib/openai.ts` prompts (domain framing + table-specific cast/join rules + residual Pagila leakage), `db/05_dashboard_reader_existing_data.sql` (RLS for the 8 company tables), `app/page.tsx` + `components/PromptBar.tsx` copy, `PLAN.md` (Pagila spec + addendum naming the real Supabase project ref, redacted here), a dead Pagila pipeline (`db/00–04*.sql`, `scripts/01–04*.sh`), Supabase naming/SSL hacks in `lib/db.ts`, `lib/env.ts`, `scripts/introspect-schema.mjs`, `package.json`, `README.md`, and GBP/`£`/en-GB hardcoding in `lib/format.ts`. Both `app/api/dashboard/route.ts` and `app/api/repair/route.ts` do module-level `readFileSync` of `db/schema-context.md` — deleting it without fixing both breaks `next build`.

## Step 0 — Write `PLAN2.md` (repo root)

Full plan document: removals, keeps/generalizations, resulting structure, judgment calls (see "Judgment calls" below), and the git-history caveat (R1).

## Step 1 — Deletions (12 files)

- `PLAN.md` (contained the real hosting project ref + company addendum + Pagila spec)
- `db/schema-context.md` (company schema + real sampled values)
- `db/00_extend_payment_partitions.sql`, `db/01_scale_customer.sql`, `db/02_scale_inventory.sql`, `db/03_post_load_indexes_and_analyze.sql` (Pagila pipeline)
- `db/04_dashboard_reader_role.sql`, `db/05_dashboard_reader_existing_data.sql` (superseded — content salvaged into generic `db/readonly_role.sql`)
- `scripts/01_fetch_pagila.sh`, `scripts/02_load_pagila.sh`, `scripts/03_scale_rental_payment.sh`, `scripts/04_verify.sh`

## Step 2 — Core plumbing

1. **NEW `lib/schemaContext.ts`** — `getSchemaContext(): string` + `SchemaContextMissingError`. Lazily reads and caches `db/schema-context.md` (`process.cwd()`-relative); on ENOENT throws with message: "No schema context found at db/schema-context.md. Run `npm run introspect` with a database connection string to generate it."
2. **`app/api/dashboard/route.ts`** — remove `fs`/`path` imports and module-level `SCHEMA_CONTEXT` (lines 2–3, 13–16); inside `POST`, `getSchemaContext()` in try/catch → `errorResponse(500, "internal_error", "This app isn't connected to a database schema yet…", err.message)`. (Confirm the error-code union in `lib/types.ts` includes `internal_error`; if not, use the closest existing code or extend the union.)
3. **`app/api/repair/route.ts`** — same change (it has a twin module-level read at lines ~12–15).
4. **`lib/db.ts`** — remove the sslmode-strip regex + Supabase comment (lines 16–20) and `ssl: { rejectUnauthorized: false }` (line 28); pass `env.DATABASE_URL_READONLY` straight through. Short comment: TLS is controlled by `sslmode` in the connection string (`disable`/`require`/`no-verify`/default full verification).
5. **`scripts/introspect-schema.mjs`** — de-vendor the header comment; connection from `DATABASE_URL ?? DATABASE_URL_READONLY` with clear exit-1 error if unset; drop the SSL hack (same as db.ts); replace the Pagila partition filter (`table_name NOT LIKE 'payment\_p%'`, line ~31) with a generic one (query `pg_class`/`pg_namespace`: `relkind IN ('r','p') AND NOT c.relispartition`); remove sector tokens `uarn`, `scat_code`, `rationale` from `SKIP_VALUE_COLUMNS` (line ~21).
6. **NEW `db/readonly_role.sql`** — generic merge of deleted 04+05: idempotent `dashboard_reader` role (`default_transaction_read_only=on`, `statement_timeout='20s'`, SELECT-only grants, revokes), plus a clearly commented **optional** RLS block ("if your tables use row-level security, add a SELECT policy per table" — generic loop, no vendor naming). Invocation via psql `-v reader_password=...` documented in comments.
7. **`lib/env.ts`** — replace Supabase help text for `DATABASE_URL_READONLY` with vendor-neutral: read-only role via `db/readonly_role.sql`, generic `postgresql://` format, `sslmode` note (`no-verify` for providers with non-verifiable cert chains).
8. **`.gitignore`** — remove Pagila comment + `db/vendor/`; add `db/schema-context.md` (comment: generated locally, contains your schema + sampled values, never commit); add `!.env.example` under `.env*`.
9. **NEW `.env.example`** — `DATABASE_URL_READONLY` (localhost placeholder + sslmode note), `OPENAI_API_KEY`, optional `OPENAI_MODEL`, `NEXT_PUBLIC_CURRENCY=USD`, `NEXT_PUBLIC_LOCALE=en-US`. (Fixes the long-broken `cp .env.example .env.local` instruction.)
10. **`package.json` scripts** — add `"introspect": "node scripts/introspect-schema.mjs"`.

## Step 3 — Prompt + formatting generalization

11. **`lib/openai.ts`** (structure, fallback logic, cache note all stay):
    - Dashboard system prompt opening → generic: "senior data analyst embedded in a dashboard layer that runs on top of the user's own PostgreSQL database; you know nothing about the database except the schema context below." Keep JSON-only instructions verbatim.
    - Date section: `payment_date` examples → `<date_column>` placeholder.
    - SQL rules: keep 1–5, 10, 11 (renumbered). **Delete** company rules 6–8 (text-cast, GBP columns, join keys). Replace rule 9 with two generic rules: never chart raw json/jsonb or uuid/serial id columns; match string case to sampled values in the schema context (ILIKE when unsure). Neutralize example aliases (`order_count`) and parentheticals.
    - Chart-type section: "top-N films"→"top-N categories", "one line per store"→"one line per category", "rentals by category"→"orders by status", table examples → generic; `unit: "currency"` → "monetary values; display currency is configured in the app" (drop GBP/£).
    - Dashboard-composition section: generic examples ("build me a dashboard on our sales", "revenue by month"); "region, or sector" → "or another dimension".
    - Repair prompt: drop "UK commercial-property intelligence platform's" → "a generated dashboard panel".
12. **`lib/format.ts`** — module constants `LOCALE` (`NEXT_PUBLIC_LOCALE` ?? `en-US`) and `CURRENCY` (`NEXT_PUBLIC_CURRENCY` ?? `USD`); derive `CURRENCY_SYMBOL` once via `Intl.NumberFormat(...).formatToParts`; use in `formatCurrencyFull` and the `£${...}` axis path (line ~189); switch hardcoded `en-US`/`en-GB` in `formatDateTick`/`formatCountFull` to `LOCALE`. Keep UTC-pinning comment.

## Step 4 — UI copy (existing demo harness only, no new functionality)

13. **`app/page.tsx`** — `EXAMPLES` → four schema-agnostic questions ("Give me an overview dashboard of this database", "What are the biggest categories by total value?", "Show me activity over the last 12 months", "Which records were added most recently?"); subtitle → "…ask questions about whatever database this app is connected to."
14. **`components/PromptBar.tsx`** — placeholder → "e.g. Show me revenue by month for the last year".
15. **`app/layout.tsx`** — align `metadata.title` with new name (one line).

## Step 5 — Identity, docs, tests

16. **`package.json`** — name `prompt-to-dashboard`; description "Embeddable AI dashboard engine: plain-English questions become live, safety-guarded dashboards on top of your own PostgreSQL database."; keywords drop `supabase`, add `embedded-analytics`/`text-to-dashboard`. Leave `homepage`/`bugs`/`repository` pointing at the real GitHub repo until the user renames it (flag in PLAN2.md).
17. **`README.md`** — rewrite, same skeleton: plugin-layer positioning up top (`app/` = thin demo harness; `lib/` + introspector = the engine); drop Supabase badge/mentions ("any PostgreSQL-compatible database"); Getting started = role script → `.env.example` → `npm run introspect` (output is local + gitignored, regenerate on schema change) → `npm run dev`; updated structure tree; safety model references `db/readonly_role.sql`; roadmap TLS item → "custom CA bundle support"; delete Pagila Acknowledgments. Keep the (already generic) mermaid diagram.
18. **`CHANGELOG.md`** — scrub the Pagila bullet from 0.1.0; add `[Unreleased]` Changed (rescope to database-agnostic engine, locally generated schema context, URL-driven TLS **breaking note**, configurable currency/locale) and Removed (sample-dataset pipeline, committed snapshot, environment-specific role scripts).
19. **`CONTRIBUTING.md`** — remove/repoint `PLAN.md` references and old role-script names; keep instructions inline.
20. **`SECURITY.md`** — `db/04…/05…` → `db/readonly_role.sql`.
21. **`.github/PULL_REQUEST_TEMPLATE.md`** — drop `PLAN.md` mention.
22. **`scripts/test-sqlguard.ts`** — behavior-identical fixture renames: `payment`→`orders`, `film`/`title`→`products`/`product_name`, etc.; `'Dropbox Promo Night'`→`'Dropdown menu item'` (still exercises `\bDROP\b` non-match); `'Drop Dead Fred'`→`'Drop zone A'` (still the documented accepted false positive).

## Verification

1. `npm run test:sqlguard` — all cases pass with renamed fixtures.
2. `npm run lint` — clean.
3. `DATABASE_URL_READONLY="postgresql://u:p@localhost:5432/db" OPENAI_API_KEY="sk-dummy" npm run build` — must pass **without** `db/schema-context.md` present (proves the lazy-loader fix; dummy vars needed because `lib/env.ts` fail-fasts at import).
4. Zero-hit grep sweeps over tracked files (excluding `package-lock.json`): `supabase|pagila|sakila`; `mkbrkjqvuqgaentojher`; company table names (`land_registry|voa_properties|company_watchlist|enrichment_queue|criteria_brief|digest_runs|opportunit`); vendor/sector terms (`land registry|companies house|gazette|hmrc|rateable|proprietor|price_paid|uarn|scat_code`); `dropbox`; `£|GBP|en-GB`; `rejectUnauthorized`; targeted `commercial.property|property (data|portfolio|intelligence)` (manual review of any hits).
5. `ls db/` → only `readonly_role.sql`; `git status` confirms `schema-context.md` untracked/absent.
6. If feasible, smoke test: dev server without schema context returns the friendly "not connected yet" error, not a crash.

Then commit (no push unless asked).

## Judgment calls to log in PLAN2.md

- **OpenAI stays named** — it's a real runtime dependency (`openai` SDK); the no-vendor-naming constraint is applied to the data connection/sector side. Abstracting LLM providers = new functionality, out of scope.
- **Git history retains the removed content** (project ref, sampled values) — rewriting history is destructive and out of this pass's scope; PLAN2.md will recommend squashing to a fresh root before any publication. No remote is currently configured.
- **TLS behavior change** — URLs that silently relied on forced `rejectUnauthorized:false` must now say `sslmode=no-verify`; documented as breaking in CHANGELOG.
- **Layout kept** (no `packages/core` split) — `lib/` already is the embeddable core; restructuring would churn every import for a positioning-only pass.
- **Existing UI page kept** as a generic demo/dev harness (not new frontend work; removal would gut testability).
- **`NEXT_PUBLIC_*` currency/locale** are build-time inlined — fine for this pass, noted in README.

---

## Execution addendum (2026-07-18)

The plan above was executed in full. Corrections and extra judgment calls made during execution:

- **A remote IS configured** (`origin` → `github.com/LeandHadergjonaj/text-to-sql`), contrary to
  the "no remote is currently configured" note above — the planning session ran from a clone that
  couldn't see it. This *raises* the stakes of the git-history caveat: the pre-rescope commits
  (which include the committed company schema snapshot with sampled data values, and `PLAN.md`
  with the real hosting project ref) exist in the pushed history too. Before making the repo
  public, squash to a fresh root or rewrite history, and force-push.
- **`.env.local` (untracked) contained the live read-only connection string to the original
  company's database** — outside the planning session's visibility since env files are
  gitignored. The `DATABASE_URL_READONLY` line was deleted; the OpenAI key was kept since the
  generic tool still needs it. Nothing from the original connection now remains anywhere in the
  working tree. Rotating the old role's database password (it reportedly matched the admin
  password) and the OpenAI key (previously shared in plain text) is still recommended.
- **`db/readonly_role.sql`: `REVOKE CREATE ON SCHEMA public FROM PUBLIC` was made an optional,
  commented block** rather than applied unconditionally (alongside the optional RLS block).
  Reason: unlike every other statement in the script, it changes permissions for roles *other
  than* `dashboard_reader`, which is too invasive as a default against an arbitrary existing
  production database. It stays in the file as a recommended hardening step.
- **`components/PromptBar.tsx`, `app/layout.tsx`, `.github/PULL_REQUEST_TEMPLATE.md`,
  `CONTRIBUTING.md`, `SECURITY.md`** were updated as planned (steps 14, 15, 19–21); the sqlGuard
  fixture rename also updated two test-case *names* ("Dropbox…"/"Drop Dead Fred…") so the test
  output no longer references those strings either.