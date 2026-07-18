# Contributing to prompt-to-dashboard

Thanks for your interest in improving this project. This document covers everything you need to
get set up, the conventions the codebase follows, and how to submit a change.

## Getting set up

1. Fork the repo and clone your fork.
2. `npm install`
3. `cp .env.example .env.local` and fill in `DATABASE_URL_READONLY` + `OPENAI_API_KEY` (see the
   [README](README.md#configuration) for details on both), then `npm run introspect` to generate
   the schema context for your database.
4. `npm run dev` and confirm the app loads at `http://localhost:3000`.

## Before you open a PR

- **Run the SQL guard tests** if you touched `lib/sqlGuard.ts`: `npx tsx scripts/test-sqlguard.ts`.
  All 8 cases (plus the sanitization check) must pass — this is the core safety boundary between a
  user's question and a live database, so changes here get extra scrutiny.
- **Run a production build**: `npm run build`. This also runs `next lint` and the TypeScript
  compiler; both must be clean.
- **Manually exercise the change** in the browser — type a question through the real UI, not just
  the API routes in isolation. Flows worth covering: loading states, a panel whose SQL fails (and
  its one-shot repair), the `?debug=1` error surface, and responsive layout.

## Conventions

- **TypeScript, strict mode.** No `any` without a specific reason left as a comment.
- **Zod is the source of truth** for shared types (`lib/types.ts`) — add new fields there first,
  derive types with `z.infer`, and keep OpenAI's structured-output schema in sync (all fields must
  stay `required`, non-applicable ones `nullable`, per OpenAI's strict-mode constraints).
- **No comments explaining *what* code does** — name things so the code reads on its own. Comments
  are reserved for non-obvious *why* (a workaround, an external constraint, a subtle invariant).
- **Commit messages**: short, imperative, conventional-style prefixes where useful (`feat:`, `fix:`,
  `docs:`, `test:`, `chore:`). Explain *why* in the body when the reasoning isn't obvious from the
  diff.
- **Safety-critical code** (`lib/sqlGuard.ts`, `lib/db.ts`, `db/readonly_role.sql`) should never
  be relaxed to "fix" a failing query.
  Fix the prompt or the schema context instead — see [SECURITY.md](SECURITY.md) for why this
  boundary matters.

## Submitting a change

1. Create a branch off `main`: `git checkout -b feat/short-description`.
2. Keep PRs focused — one logical change per PR is easier to review and revert if needed.
3. Open a PR with a clear description of *why*, not just *what*. Link any related issue.
4. Be responsive to review feedback — small, incremental commits addressing comments are easier to
   follow than force-pushed rewrites.

## Reporting bugs / requesting features

Use the issue templates under `.github/ISSUE_TEMPLATE/`. For anything security-related, follow
[SECURITY.md](SECURITY.md) instead of filing a public issue.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you're
expected to uphold it.
