# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities. Instead, email
**leandhad@gmail.com** with:

- A description of the issue and its potential impact
- Steps to reproduce (a minimal example, if possible)
- Any suggested fix or mitigation, if you have one

You should receive an acknowledgment within a few days. This is a personal/portfolio project without
a formal bug bounty program, but genuine reports are taken seriously and credited in the fix.

## Scope and what matters most here

This project accepts natural-language input from an end user, turns it into SQL via an LLM, and
executes that SQL against a real database. The most security-sensitive surface is therefore the path
between "user's question" and "query executed against Postgres." Issues in this area are the highest
priority:

- **`lib/sqlGuard.ts`** — any input that results in a non-`SELECT`/`WITH` statement, a multi-statement
  payload, or a forbidden keyword being executed.
- **`lib/db.ts`** — anything that would let a query escape the `READ ONLY` transaction or the
  `LIMIT 5001` wrapper.
- **`db/04_dashboard_reader_role.sql` / `db/05_dashboard_reader_existing_data.sql`** — the
  `dashboard_reader` Postgres role's grants. If you can find a way for this role to `INSERT`,
  `UPDATE`, `DELETE`, or run DDL, that's a critical finding.
- **Prompt injection** — a natural-language question crafted to make the LLM emit SQL that, while
  syntactically a `SELECT`, exfiltrates data outside the intended schema or abuses the read-only
  role's remaining permissions in an unintended way.
- **Secrets handling** — `.env.local` and any real database/API credentials should never appear in
  a commit, log line, or error message returned to the client (`friendlyMessage` vs. `debug` in the
  API error shape exists specifically to prevent this — see the README's
  [Safety model](README.md#safety-model)).

## Supported versions

This is a single-branch (`main`) project without long-term-support releases. Security fixes are
applied to `main` and there is no backport policy.
