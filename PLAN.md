# Text-to-Dashboard on Pagila — Build Spec

> **How to read this document.** This is a build spec, not an architecture sketch. It is written to be executed mechanically by a faster/cheaper model: every library is pinned, every file is named, every prompt and SQL script is spelled out or precisely specified. Execute stages in order; each stage ends with a verification gate that must pass before the next stage starts. Where a step needs input only the user can give (credentials), STOP and ask the user in chat — never invent placeholder values.

## Context

The user wants a working end-to-end system where a completely non-technical person types a plain-English request ("show me revenue by store over the last year", "build me a dashboard on customer rentals") and gets back a real dashboard — charts and numbers pulled live from a real database — without ever seeing SQL, code, or jargon. This is an agent that *builds* dashboards, not a chatbot that talks about data.

The repo (`/Users/leand/dev/text-to-sql`) is empty except for a one-line README — this is a green-field build. First version priorities: real question → real dashboard on screen, end to end, on a genuinely large dataset (>1GB), over polish or edge-case hardening.

**Decisions locked with the user during planning (do not relitigate):**

| Decision | Choice |
|---|---|
| Database hosting | Supabase **Pro** project (paid; free tier's 500MB cap can't hold >1GB). User provides the Postgres connection string + DB password at build time. Supabase MCP is NOT connected — all DB work goes through local `psql` / `pg`. |
| Dataset | Pagila schema, synthetically scaled to **~2–3GB**: ~15M rentals, ~15M payments, ~50k customers, ~300k inventory rows; 1000 films unchanged. Dates span 2022-01-01 → today so "last year" style questions return data. |
| LLM for the agent | **OpenAI API** (user provides `OPENAI_API_KEY`), official `openai` npm SDK. |
| Charts | **Recharts** (fixed vocabulary: line, bar, area, pie, stat, table). |
| App shape | One **Next.js 15 App Router** project (TypeScript, Tailwind, npm) serving both the UI and the API routes. |
| Safety | DB access only via a dedicated `dashboard_reader` role: SELECT-only grants, `default_transaction_read_only=on`, `statement_timeout=20s`; plus app-level SQL guard, read-only transactions, and a hard LIMIT wrapper. Generated SQL can never modify data. |

**Environment facts (verified):** macOS, psql 14.15 via Homebrew, Node v23.7.0, npm 10.9.2, Docker present. Local environment date: 2026-07-18.

## System shape (one paragraph)

A question is POSTed to `/api/dashboard`; one LLM call (with the database schema + current date in the system prompt, structured-output JSON schema enforced) returns a **DashboardSpec** — a title, a summary, and 1–6 panels each carrying `{title, chartType, sql, field mappings}`. The frontend renders the dashboard shell immediately and fetches `/api/panel` for each panel in parallel; that route validates the SQL with `sqlGuard`, wraps it in `SELECT * FROM (…) _panel LIMIT 5001`, runs it inside a read-only transaction on the `dashboard_reader` pool, and returns `{columns, rows, truncated}`. Each panel independently goes skeleton → chart. If a panel's SQL fails, the frontend calls `/api/repair` once (LLM fixes the SQL given the error), retries, and only then shows a friendly failure card. The user never sees SQL or raw errors (a `?debug=1` flag reveals them for development).

## Stages

- **Stage 0 — Preflight & credentials** (STOP-and-ask gate): collect Supabase connection string, reader password, OpenAI key; verify connectivity.
- **Stage 1 — Load Pagila + scale to >1GB**: psql scripts in `db/`, batched synthetic data generation, size verification.
- **Stage 2 — Read-only role**: create `dashboard_reader`, prove writes fail.
- **Stage 3 — App scaffold**: create-next-app@15, pinned deps.
- **Stage 4 — Schema context**: introspection script writes `db/schema-context.md` for the LLM prompt (runs after Stage 3 so `pg` is installed).
- **Stage 5 — Backend libs**: `lib/env.ts`, `lib/db.ts`, `lib/sqlGuard.ts`, `lib/types.ts`, `lib/openai.ts` (+ prompts).
- **Stage 6 — API routes**: `/api/dashboard`, `/api/panel`, `/api/repair`; curl smoke tests.
- **Stage 7 — Frontend**: components, chart renderers, UX copy, styling.
- **Stage 8 — End-to-end verification**: canonical questions through the real UI against the real database.
- **Stage 9 — Report back** to the user.

---

# Stage 0 — Preflight & credentials (STOP-and-ask gate)

Nothing runs until these exist. Ask the user in chat for:

1. **Supabase session-pooler connection string for the admin `postgres` user**, copied verbatim from Supabase Dashboard → Connect → **Session pooler** (port 5432). Format: `postgresql://postgres.<project-ref>:<ADMIN_PASSWORD>@<pooler-host>:5432/postgres`. ⚠️ The host is `aws-N-<region>.pooler.supabase.com` where **N varies per project** — never assume `aws-0`; use the exact string from the dashboard. The project must be on the **Pro plan** (free tier's 500MB cap cannot hold >1GB; Pro defaults to an 8GB autoscaling disk — no manual resize needed).
2. **A password the user chooses for the new `dashboard_reader` role.**
3. **`OPENAI_API_KEY`** (platform.openai.com, billing enabled).

Never invent placeholder values; never commit credentials. Set up:

```bash
# Shell exports for the pipeline scripts (session-scoped, not committed):
export DATABASE_URL="postgresql://postgres.<project-ref>:<ADMIN_PASSWORD>@<pooler-host>:5432/postgres?sslmode=require"
export READER_PASSWORD="<user-chosen password>"
export DATABASE_URL_READONLY="postgresql://dashboard_reader.<project-ref>:${READER_PASSWORD}@<same-pooler-host>:5432/postgres?sslmode=require"
```

Pooler username format is `<rolename>.<project-ref>` for ANY role — this is how `dashboard_reader` logs in through Supavisor. [verified]

**Gate:** `psql "$DATABASE_URL" -c "select version();"` must succeed before Stage 1. Later (Stage 3), the same three values go into the app's `.env.local` as `DATABASE_URL_READONLY`, `OPENAI_API_KEY`, and optionally `OPENAI_MODEL`.

Supabase facts the executor must respect throughout [all verified by planning agent against Supabase docs]:
- Use the **Session pooler (5432)** for everything — IPv4-friendly, and the only pooler mode honoring session-level `SET` (the bulk load needs `SET statement_timeout = 0`; the `postgres` role is otherwise capped at ~2 min). Never the Transaction pooler (6543). The direct host `db.<ref>.supabase.co` is IPv6-only by default — avoid it.
- Supabase's `postgres` role is not a superuser, but pagila needs nothing superuser-y: no extensions, and its ~49 `ALTER … OWNER TO postgres` lines are no-ops since `postgres` just created every object. Expected to load cleanly.
- `sslmode=require` on every connection string; node scripts use `ssl: { rejectUnauthorized: false }` (v1 decision, see B0).

---

# Stage 1 — Load Pagila and scale to >1GB

### Files (build/run in this order)

```
scripts/01_fetch_pagila.sh              # curl the two upstream pagila files into db/vendor/
scripts/02_load_pagila.sh               # psql -f schema, then data, against $DATABASE_URL
db/00_extend_payment_partitions.sql     # extend payment partitions 2022-08 → 2026-12 + DEFAULT
db/01_scale_customer.sql                # customer → ~50,000 rows
db/02_scale_inventory.sql               # inventory → ~300,000 rows
scripts/03_scale_rental_payment.sh      # 15 × 1M-row batches: rental + derived payment
db/03_post_load_indexes_and_analyze.sql # dashboard indexes + ANALYZE
```

Facts [verified by planning agent — fetched the actual upstream files]:
- Canonical source: `devrimgunduz/pagila`; raw URLs used below. `pagila-data.sql` uses client-driven `COPY … FROM stdin;` which works as a **non-superuser** (it is not server-side file COPY).
- `payment` is `PARTITION BY RANGE (payment_date)` and ships exactly 7 partitions `payment_p2022_01`…`payment_p2022_07`.
- `rental` has a UNIQUE index on `(rental_date, inventory_id, customer_id)` (a bare CREATE UNIQUE INDEX, **not** a table constraint — so conflict handling must use column-list inference, not `ON CONFLICT ON CONSTRAINT`).
- Stock pagila has **no** index on `rental.rental_date` or `rental.customer_id`.
- `pagila-schema.sql` ships `GRANT ALL ON SCHEMA public TO PUBLIC;` — a CREATE-privilege hole that Stage 2 must explicitly revoke.

### scripts/01_fetch_pagila.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
mkdir -p db/vendor
curl -fsSL -o db/vendor/pagila-schema.sql \
  https://raw.githubusercontent.com/devrimgunduz/pagila/master/pagila-schema.sql
curl -fsSL -o db/vendor/pagila-data.sql \
  https://raw.githubusercontent.com/devrimgunduz/pagila/master/pagila-data.sql
wc -l db/vendor/pagila-schema.sql db/vendor/pagila-data.sql
```

### scripts/02_load_pagila.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?export DATABASE_URL first}"

echo "Loading schema..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/vendor/pagila-schema.sql

echo "Loading base data..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/vendor/pagila-data.sql

psql "$DATABASE_URL" -c "
  SELECT 'customer' t, count(*) FROM customer
  UNION ALL SELECT 'inventory', count(*) FROM inventory
  UNION ALL SELECT 'rental', count(*) FROM rental
  UNION ALL SELECT 'payment', count(*) FROM payment
  UNION ALL SELECT 'film', count(*) FROM film;
"
```

Fallback if an `ALTER … OWNER` line unexpectedly fails: re-run without `-v ON_ERROR_STOP=1`, let the file finish, then confirm all ~22 tables exist with `\dt public.*` (ownership errors are cosmetic here).

### db/00_extend_payment_partitions.sql (idempotent)

```sql
SET timezone = 'UTC';

DO $$
DECLARE
  month_start date;
  month_end   date;
  part_name   text;
BEGIN
  FOR month_start IN
    SELECT d::date
    FROM generate_series('2022-08-01'::date, '2026-12-01'::date, interval '1 month') AS d
  LOOP
    month_end := (month_start + interval '1 month')::date;
    part_name := format('payment_p%s', to_char(month_start, 'YYYY_MM'));
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = part_name
    ) THEN
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.payment FOR VALUES FROM (%L) TO (%L);',
        part_name, month_start, month_end
      );
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'payment_pdefault'
  ) THEN
    EXECUTE 'CREATE TABLE public.payment_pdefault PARTITION OF public.payment DEFAULT;';
  END IF;
END $$;
```

If Postgres raises "would overlap with partition", a partition already exists with different bounds — run `\d+ payment` and start the loop at the first genuinely missing month.

### db/01_scale_customer.sql (idempotent — skips if already at target)

```sql
DO $$
DECLARE
  target_total  int := 50000;
  current_total int;
  to_add        int;
BEGIN
  SELECT count(*) INTO current_total FROM public.customer;
  to_add := target_total - current_total;
  IF to_add <= 0 THEN
    RAISE NOTICE 'customer already at % rows, skipping', current_total;
    RETURN;
  END IF;

  INSERT INTO public.customer
    (store_id, first_name, last_name, email, address_id, activebool, create_date, last_update, active)
  SELECT
    (1 + (gs % (SELECT count(*)::int FROM public.store))),
    (ARRAY['James','Maria','Robert','Linda','Michael','Patricia','David','Jennifer',
           'John','Elizabeth','William','Susan','Richard','Jessica','Thomas','Karen',
           'Charles','Nancy','Daniel','Lisa'])[1 + (gs % 20)],
    (ARRAY['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis',
           'Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson',
           'Thomas','Taylor','Moore','Jackson','Martin'])[1 + ((gs / 20) % 20)],
    lower(
      (ARRAY['James','Maria','Robert','Linda','Michael','Patricia','David','Jennifer',
             'John','Elizabeth','William','Susan','Richard','Jessica','Thomas','Karen',
             'Charles','Nancy','Daniel','Lisa'])[1 + (gs % 20)]
      || '.' ||
      (ARRAY['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis',
             'Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson',
             'Thomas','Taylor','Moore','Jackson','Martin'])[1 + ((gs / 20) % 20)]
      || gs || '@example.com'
    ),
    addr.ids[1 + floor(random() * addr.n)::int],
    (random() > 0.03),
    (date '2022-01-01' + floor(random() * 1660)::int),
    now(),
    CASE WHEN random() > 0.03 THEN 1 ELSE 0 END
  FROM generate_series(1, to_add) AS gs
  CROSS JOIN (SELECT array_agg(address_id) AS ids, count(*)::int AS n FROM public.address) AS addr;
END $$;
```

### db/02_scale_inventory.sql (idempotent)

```sql
DO $$
DECLARE
  target_total  int := 300000;
  current_total int;
  to_add        int;
BEGIN
  SELECT count(*) INTO current_total FROM public.inventory;
  to_add := target_total - current_total;
  IF to_add <= 0 THEN
    RAISE NOTICE 'inventory already at % rows, skipping', current_total;
    RETURN;
  END IF;

  INSERT INTO public.inventory (film_id, store_id, last_update)
  SELECT
    film.ids[1 + floor(random() * film.n)::int],
    store.ids[1 + floor(random() * store.n)::int],
    now()
  FROM generate_series(1, to_add)
  CROSS JOIN (SELECT array_agg(film_id) AS ids, count(*)::int AS n FROM public.film) AS film
  CROSS JOIN (SELECT array_agg(store_id) AS ids, count(*)::int AS n FROM public.store) AS store;
END $$;
```

### scripts/03_scale_rental_payment.sh

Design (locked): 15 batches × 1M rentals, **each batch its own psql invocation/transaction** (a single DO block would hold one multi-GB transaction — WAL bloat, no incremental progress, one failure loses everything). Payments derive from the just-inserted rentals via `INSERT … RETURNING` feeding a second INSERT in the same statement, so FK integrity is automatic and there are no orphan payments. Rental dates span 2022-01-01 → 2026-07-18; payment_date = rental_date + 0–71h (partitions covered through 2026-12 + DEFAULT). Re-running a failed batch is safe (`ON CONFLICT DO NOTHING` on the rental unique index; payments only match what actually inserted). **Leave all shipped indexes in place** during load — drop/recreate surgery across a partitioned table is exactly the error-prone judgment work this plan avoids; the modest speed cost is accepted.

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?export DATABASE_URL first}"

BATCH_SIZE=1000000
NUM_BATCHES=15
START_TS="2022-01-01 00:00:00+00"
END_TS="2026-07-18 23:59:59+00"

for ((i=0; i<NUM_BATCHES; i++)); do
  lo=$(( i * BATCH_SIZE + 1 ))
  hi=$(( (i + 1) * BATCH_SIZE ))
  echo "== Batch $((i+1))/$NUM_BATCHES =="

  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
    SET statement_timeout = 0;
    SET work_mem = '64MB';

    WITH bounds AS (
      SELECT
        (SELECT max(customer_id)  FROM customer)  AS max_customer,
        (SELECT max(inventory_id) FROM inventory) AS max_inventory,
        (SELECT max(staff_id)     FROM staff)     AS max_staff
    ),
    gen AS (
      SELECT
        b.max_customer, b.max_inventory, b.max_staff,
        t.rd, t.dur
      FROM bounds b,
           generate_series($lo, $hi) AS s(n),
           LATERAL (
             SELECT
               timestamptz '$START_TS'
                 + (random() * extract(epoch FROM (timestamptz '$END_TS' - timestamptz '$START_TS'))) * interval '1 second'
                 AS rd,
               (interval '1 hour' + random() * interval '13 days') AS dur
           ) t
    ),
    new_rentals AS (
      INSERT INTO rental (rental_date, inventory_id, customer_id, return_date, staff_id, last_update)
      SELECT
        rd,
        (1 + floor(random() * max_inventory))::int,
        (1 + floor(random() * max_customer))::int,
        CASE
          WHEN rd + dur > timestamptz '$END_TS' THEN NULL
          WHEN rd > (timestamptz '$END_TS' - interval '10 days') AND random() < 0.35 THEN NULL
          ELSE rd + dur
        END,
        (1 + floor(random() * max_staff))::int,
        now()
      FROM gen
      ON CONFLICT (rental_date, inventory_id, customer_id) DO NOTHING
      RETURNING rental_id, rental_date, customer_id, staff_id
    )
    INSERT INTO payment (customer_id, staff_id, rental_id, amount, payment_date)
    SELECT
      customer_id,
      staff_id,
      rental_id,
      round((0.99 + random() * 11.00)::numeric, 2),
      rental_date + (interval '1 hour' * floor(random() * 71))
    FROM new_rentals;
  "
done
```

Expected wall-clock [unverified — time batch 1 and extrapolate]: ~3–8 min per batch on Supabase Micro compute, i.e. roughly 45–120 min total. If a batch takes far longer than ~10 min, cut `BATCH_SIZE` to 250k–500k and raise `NUM_BATCHES` proportionally — nothing else changes. ⚠️ Executor check before batch 1: confirm `payment.payment_id` has a sequence default (`\d payment`) — the INSERT omits it.

### db/03_post_load_indexes_and_analyze.sql

```sql
CREATE INDEX IF NOT EXISTS idx_rental_rental_date ON public.rental (rental_date);
CREATE INDEX IF NOT EXISTS idx_rental_customer_id ON public.rental (customer_id);
CREATE INDEX IF NOT EXISTS idx_inventory_film_id   ON public.inventory (film_id);
CREATE INDEX IF NOT EXISTS idx_inventory_store_id  ON public.inventory (store_id);
CREATE INDEX IF NOT EXISTS idx_customer_store_id   ON public.customer (store_id);

ANALYZE public.customer;
ANALYZE public.inventory;
ANALYZE public.rental;
ANALYZE public.payment;
ANALYZE public.film;
ANALYZE public.store;
```

Run with `SET statement_timeout = 0;` prefixed (index builds on 15M rows can exceed the 2-min cap): `psql "$DATABASE_URL" -c "SET statement_timeout = 0;" -f db/03_post_load_indexes_and_analyze.sql` — or inline the SET at the top of the file. No index on `payment.payment_date` is needed: it's the partition key, pruning handles date filters. `ANALYZE` here also makes Stage 4's `reltuples` row counts accurate.

**Stage 1 gate:** `SELECT pg_size_pretty(pg_database_size(current_database()));` > 1 GB; rental ≈ payment ≈ 15M; customer ≈ 50k; inventory ≈ 300k; film exactly 1000; `min/max(rental_date)` ≈ 2022-01-01 / 2026-07-18.

---

# Stage 2 — Read-only role `dashboard_reader`

### db/04_dashboard_reader_role.sql

Invoke: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v reader_password="$READER_PASSWORD" -f db/04_dashboard_reader_role.sql`

⚠️ psql variables are NOT interpolated inside dollar-quoted DO bodies — role creation must use the `\gexec` pattern below, not a DO block:

```sql
-- Create or update the role (psql \gexec pattern; :'reader_password' is a psql var)
SELECT format('CREATE ROLE dashboard_reader LOGIN PASSWORD %L CONNECTION LIMIT 10', :'reader_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_reader') \gexec

SELECT format('ALTER ROLE dashboard_reader LOGIN PASSWORD %L CONNECTION LIMIT 10', :'reader_password')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_reader') \gexec

ALTER ROLE dashboard_reader SET default_transaction_read_only = on;
ALTER ROLE dashboard_reader SET statement_timeout = '20s';

-- pagila-schema.sql grants ALL (incl. CREATE) on schema public to PUBLIC; close that hole.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO dashboard_reader;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dashboard_reader;

-- Belt-and-suspenders
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM dashboard_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM dashboard_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM dashboard_reader;
REVOKE CREATE ON SCHEMA public FROM dashboard_reader;
```

Security model to keep straight: the role-level GUCs (`default_transaction_read_only`, `statement_timeout`) are session *defaults*, not hard boundaries — the unbypassable boundary is the GRANT/REVOKE set (no write privilege exists on anything). The app adds two more layers (sqlGuard + single-statement read-only transactions), so a client can never issue the `SET` that would lift the defaults anyway.

### scripts/04_verify.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?export DATABASE_URL first}"
: "${DATABASE_URL_READONLY:?export DATABASE_URL_READONLY first}"

echo "== Database size (must be > 1 GB) =="
psql "$DATABASE_URL" -c "SELECT pg_size_pretty(pg_database_size(current_database()));"

echo "== Row counts =="
psql "$DATABASE_URL" -c "
  SELECT 'customer'  t, count(*) FROM customer
  UNION ALL SELECT 'inventory', count(*) FROM inventory
  UNION ALL SELECT 'rental',    count(*) FROM rental
  UNION ALL SELECT 'payment',   count(*) FROM payment
  UNION ALL SELECT 'film',      count(*) FROM film
  ORDER BY 1;
"

echo "== Date ranges =="
psql "$DATABASE_URL" -c "SELECT min(rental_date), max(rental_date) FROM rental;"
psql "$DATABASE_URL" -c "SELECT min(payment_date), max(payment_date) FROM payment;"

fail=0
check_fails() {
  local label="$1"
  local sql="$2"
  # "permission denied" (DML/CREATE), "must be owner" (DROP), "read-only transaction" all count as correctly blocked
  if psql "$DATABASE_URL_READONLY" -c "$sql" 2>&1 | grep -qiE "permission denied|must be owner|read-only transaction"; then
    echo "PASS: $label correctly rejected"
  else
    echo "FAIL: $label was NOT rejected"
    fail=1
  fi
}

echo "== dashboard_reader negative checks (each MUST fail) =="
check_fails "INSERT"       "INSERT INTO customer (store_id, first_name, last_name, address_id) VALUES (1,'x','y',1);"
check_fails "UPDATE"       "UPDATE customer SET first_name = 'x' WHERE customer_id = 1;"
check_fails "DELETE"       "DELETE FROM customer WHERE customer_id = 1;"
check_fails "CREATE TABLE" "CREATE TABLE t_should_fail (id int);"
check_fails "DROP TABLE"   "DROP TABLE film;"

echo "== dashboard_reader positive check (MUST succeed) =="
psql "$DATABASE_URL_READONLY" -c "SELECT count(*) FROM film;"

exit $fail
```

**Stage 2 gate:** all five negative checks PASS, positive check succeeds.

---

# Stage 3 — App scaffold

```bash
npx create-next-app@15 . --typescript --tailwind --eslint --app --import-alias "@/*" --use-npm
```

- Must be `create-next-app@15` (resolves to 15.5.x) — plain `@latest` now scaffolds Next 16. [verified]
- The repo contains only `README.md` + `.git`. [unverified — executor must check] if create-next-app refuses the non-empty dir: scaffold into a temp folder and move everything except `.git`/`README.md` into the repo root.
- It scaffolds **Tailwind v4** (no tailwind.config; `@import "tailwindcss"` in globals.css). This spec needs no theme edits — all custom colors use arbitrary values (`bg-[#2a78d6]`).

Then:

```bash
npm install pg@^8.16 zod@^3.25 openai@^5 recharts@3.9.2
npm install -D @types/pg
```

- **recharts is pinned to `3.9.2` exactly** — a deliberate deviation from the original `2.15.4` idea: the 2.x line is dead (last release 2025-06; the repo explicitly says v2 receives no updates). Every chart composition in Stage 7 was written against the v3 API and uses nothing from v3's removed-props list. [verified against npm registry + recharts 3.0 migration guide]
- zod stays on v3: the OpenAI SDK's `zodTextFormat` helper is incompatible with zod v4. [verified]
- Create `.env.local` with `DATABASE_URL_READONLY` and `OPENAI_API_KEY` from Stage 0 (scaffolded `.gitignore` already excludes `.env*`). Add `db/vendor/` to `.gitignore` (re-downloadable). `db/schema-context.md` (Stage 4) **must be committed** — routes read it at runtime.
- In `app/layout.tsx`, delete the scaffolded Geist `next/font` import — the app uses the system font stack (Stage 7).

**Stage 3 gate:** `npm run dev` serves the default page on localhost:3000.

---

# Stage 4 — Schema context: `scripts/introspect-schema.mjs`

Plain Node + `pg` (installed by Stage 3), connects with the **admin** URL, writes `db/schema-context.md`. Run: `DATABASE_URL="$DATABASE_URL" node scripts/introspect-schema.mjs`

```js
#!/usr/bin/env node
import { Client } from 'pg';
import { writeFileSync } from 'node:fs';

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const LOW_CARDINALITY = [
  { table: 'film', column: 'rating' },
  { table: 'category', column: 'name' },
  { table: 'language', column: 'name' },
  { table: 'customer', column: 'active' },
];

async function main() {
  await client.connect();

  const { rows: tables } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name;`
  );

  let md = `# Schema Context\n\nGenerated: ${new Date().toISOString()}\n\n## Tables\n\n`;

  for (const { table_name } of tables) {
    const cols = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1
       ORDER BY ordinal_position;`, [table_name]
    );
    const pk = await client.query(
      `SELECT kcu.column_name FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema='public' AND tc.table_name=$1
       ORDER BY kcu.ordinal_position;`, [table_name]
    );
    const fks = await client.query(
      `SELECT kcu.column_name AS fk_column, ccu.table_name AS ref_table, ccu.column_name AS ref_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
       WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public' AND tc.table_name=$1;`, [table_name]
    );

    let approx;
    if (table_name === 'payment') {
      // partitioned parent stores nothing itself — sum the children
      const r = await client.query(
        `SELECT sum(c.reltuples)::bigint AS n FROM pg_inherits i
         JOIN pg_class c ON c.oid = i.inhrelid
         JOIN pg_class p ON p.oid = i.inhparent
         WHERE p.relname = 'payment';`
      );
      approx = r.rows[0].n;
    } else {
      const r = await client.query(
        `SELECT reltuples::bigint AS n FROM pg_class c
         JOIN pg_namespace ns ON ns.oid = c.relnamespace
         WHERE ns.nspname='public' AND c.relname=$1;`, [table_name]
      );
      approx = r.rows[0]?.n ?? 0;
    }

    md += `### ${table_name}\n\n`;
    md += `- Approximate row count: ${approx}\n`;
    md += `- Primary key: (${pk.rows.map(r => r.column_name).join(', ') || 'none'})\n\n`;
    md += `| Column | Type | Nullable | Default |\n|---|---|---|---|\n`;
    for (const c of cols.rows) {
      md += `| ${c.column_name} | ${c.data_type} | ${c.is_nullable} | ${c.column_default ?? ''} |\n`;
    }
    if (fks.rows.length) {
      md += `\nForeign keys:\n`;
      for (const fk of fks.rows) md += `- ${fk.fk_column} -> ${fk.ref_table}(${fk.ref_column})\n`;
    }
    md += `\n`;
  }

  md += `## Low-cardinality reference values\n\n`;
  for (const { table, column } of LOW_CARDINALITY) {
    const r = await client.query(`SELECT DISTINCT ${column} FROM ${table} ORDER BY 1;`);
    md += `### ${table}.${column}\n\n`;
    md += r.rows.map(row => `- ${row[column]}`).join('\n') + '\n\n';
  }
  const stores = await client.query(`SELECT store_id FROM store ORDER BY store_id;`);
  md += `### store.store_id\n\n` + stores.rows.map(r => `- ${r.store_id}`).join('\n') + '\n';

  writeFileSync('db/schema-context.md', md);
  await client.end();
  console.log('Wrote db/schema-context.md');
}

main().catch(e => { console.error(e); process.exit(1); });
```

Skip the payment partition child tables (`payment_p*`) if they clutter the table list: filter them out with `AND table_name NOT LIKE 'payment\_p%'` in the tables query — the LLM should only see the logical `payment` parent. **Do apply this filter** — 60+ partition entries would bloat every prompt.

**Stage 4 gate:** `db/schema-context.md` exists, lists ~22 tables (partition children excluded), row counts ≈ the scaled numbers, and includes distinct values for film.rating, category.name, language.name, customer.active, store.store_id. Commit it.

---

# Stage 5 + 6 — Backend: libs, prompts, API routes (detailed spec)

> Build order within this part: `lib/env.ts` → `lib/types.ts` → `lib/sqlGuard.ts` → `lib/db.ts` → `lib/openai.ts` → the three routes. Everything below is exact; paste-adapt rather than redesign.

## B0. Verified facts and pinned backend decisions

- **OpenAI API surface: use the Responses API (`client.responses.parse`), never `chat.completions.*`.** OpenAI's docs recommend Responses for all new projects (better reasoning-model results, better prompt caching). [verified by planning agent against OpenAI docs]
- **Model IDs:** as of 2026-07 OpenAI's current generation is GPT-5.6 in three tiers: `gpt-5.6-sol` (flagship), `gpt-5.6-terra` (mid, ~half Sol's price), `gpt-5.6-luna` (cheapest). **Default `OPENAI_MODEL` = `gpt-5.6-terra`; hardcoded `FALLBACK_MODEL = "gpt-5.6-luna"`** used for one automatic retry on 429/5xx/network errors. ⚠️ EXECUTOR MUST VERIFY at build time: `curl https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY" | grep gpt-5` — if these IDs don't exist, substitute the current second-tier and cheapest-tier model IDs, keep the architecture.
- **Never send `temperature`** — GPT-5-series reasoning models reject non-default values. Steer with `reasoning: { effort }` and `text: { verbosity }` instead.
- **Structured outputs strict-mode rules (hard constraints):** every property must be in `required` (optionality = nullable types via `anyOf` with null); `additionalProperties: false` on every object; root must be a plain object; `minItems`/`maxItems`/`minLength` are NOT enforced by the model — cardinality rules ("1–6 panels") must live in the prompt AND be clamped in app code.
- **PanelSpec is one flat object with nullable chart-specific fields** — NOT a discriminated union (strict-mode unions multiply schema surface and the SDK's zod converter has bugs with them).
- **zod must stay on v3** (`zod@^3.25`): the OpenAI SDK's `zodTextFormat` helper (from `openai/helpers/zod`) is incompatible with zod v4. Do not upgrade.
- **Supabase pooler SSL with node-postgres:** default trust store throws `self-signed certificate in certificate chain`. v1 decision: `ssl: { rejectUnauthorized: false }` (still TLS-encrypted; chain verification skipped; blast radius already limited by read-only role). CA-pinning is a documented follow-up, not part of this build.
- **pg type parsers:** by default `pg` returns numeric/int8 as strings and dates as `Date` objects — both wrong for charts. Override OIDs 1700 (numeric→parseFloat), 20 (int8→parseInt), 1082 (date→string as-is), 1114/1184 (timestamps→ISO strings).
- **`rowMode: 'array'`** for panel queries: rows come back as `unknown[][]` in field order — avoids the silent-collision bug when two output columns share a name.
- **Install:** `npm install pg@^8.16 zod@^3.25 openai@^5 && npm install -D @types/pg`

## B1. `lib/env.ts`

Computed once at module load; throws a formatted multi-line error listing each missing var and where to get it.

```ts
// lib/env.ts
interface Env {
  DATABASE_URL_READONLY: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
}

const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";

const HELP_TEXT: Record<string, string> = {
  DATABASE_URL_READONLY:
    "Supabase dashboard -> Project Settings -> Database -> Connection string -> " +
    "Session pooler. Use the credentials for the read-only `dashboard_reader` " +
    "role (NOT the default postgres role). Format: " +
    "postgresql://dashboard_reader:<password>@<pooler-host>:5432/postgres",
  OPENAI_API_KEY:
    "Create one at https://platform.openai.com/api-keys " +
    "(requires an OpenAI account with billing enabled).",
};

function readEnv(): Env {
  const DATABASE_URL_READONLY = process.env.DATABASE_URL_READONLY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;

  const missing: string[] = [];
  if (!DATABASE_URL_READONLY) missing.push("DATABASE_URL_READONLY");
  if (!OPENAI_API_KEY) missing.push("OPENAI_API_KEY");

  if (missing.length > 0) {
    const lines = [
      "",
      "=".repeat(72),
      `Missing required environment variable(s): ${missing.join(", ")}`,
      "",
      "Set these in .env.local (development), then restart the server.",
      "",
      ...missing.flatMap((name) => [`  ${name}`, `    ${HELP_TEXT[name]}`, ""]),
      "=".repeat(72),
      "",
    ];
    throw new Error(lines.join("\n"));
  }

  return {
    DATABASE_URL_READONLY: DATABASE_URL_READONLY!,
    OPENAI_API_KEY: OPENAI_API_KEY!,
    OPENAI_MODEL,
  };
}

export const env = readEnv();
```

## B2. `lib/types.ts`

zod is the single source of truth; the OpenAI JSON schema is generated from it via `zodTextFormat` at call time.

```ts
// lib/types.ts
import { z } from "zod";

export const ChartTypeSchema = z.enum(["line", "bar", "area", "pie", "stat", "table"]);
export type ChartType = z.infer<typeof ChartTypeSchema>;

export const UnitSchema = z.enum(["currency", "count", "percent", "none"]);
export type Unit = z.infer<typeof UnitSchema>;

// Flat panel spec: ALL 11 fields always present (strict structured outputs
// forbids optional fields); non-applicable fields are null.
export const PanelSpecSchema = z.object({
  title: z.string(),
  description: z.string(),
  chartType: ChartTypeSchema,
  sql: z.string(),
  // line / bar / area
  xField: z.string().nullable(),
  yFields: z.array(z.string()).nullable(),
  seriesField: z.string().nullable(),
  // pie
  labelField: z.string().nullable(),
  // pie (value) / stat (value)
  valueField: z.string().nullable(),
  // all chart types (drives number formatting); null only for table panels
  unit: UnitSchema.nullable(),
  // stat only
  comparison: z.string().nullable(),
});
export type PanelSpec = z.infer<typeof PanelSpecSchema>;

export const DashboardSpecSchema = z.object({
  title: z.string(),
  summary: z.string(), // one plain-English sentence shown under the dashboard title
  panels: z.array(PanelSpecSchema), // 1-6 cap enforced in route code, not schema
});
export type DashboardSpec = z.infer<typeof DashboardSpecSchema>;

// Panel ids are assigned SERVER-SIDE by /api/dashboard after generation
// (`panel-0`, `panel-1`, ...) — never by the LLM. The frontend keys its
// per-panel state on them.
export type PanelWithId = PanelSpec & { id: string };
export type DashboardSpecWithIds = {
  title: string;
  summary: string;
  panels: PanelWithId[];
};

// Repair call structured output
export const RepairSqlSchema = z.object({ sql: z.string() });

// ---- API request bodies ----
export const DashboardRequestSchema = z.object({
  question: z.string().trim().min(1).max(500),
});
export const PanelRequestSchema = z.object({
  sql: z.string().trim().min(1).max(10_000),
  chartType: ChartTypeSchema,
});
export const RepairRequestSchema = z.object({
  question: z.string().trim().min(1).max(500),
  panel: PanelSpecSchema,
  sql: z.string().trim().min(1).max(10_000),
  errorMessage: z.string().trim().min(1).max(2_000),
});

// ---- API response bodies ----
export const ColumnMetaSchema = z.object({
  name: z.string(),
  type: z.enum(["number", "date", "boolean", "string"]),
});
export type ColumnMeta = z.infer<typeof ColumnMetaSchema>;

export type DashboardResponse = { spec: DashboardSpecWithIds };
export type PanelResponse = {
  columns: ColumnMeta[];
  rows: unknown[][];
  truncated: boolean;
};
export type RepairResponse = { sql: string };

// ---- Error taxonomy (shared by all three routes) ----
export const ApiErrorCodeSchema = z.enum([
  "invalid_request", // body failed zod validation
  "sql_rejected",    // sqlGuard rejected the SQL
  "llm_error",       // OpenAI call failed / unusable output
  "query_timeout",   // statement_timeout fired (pg code 57014)
  "query_failed",    // any other Postgres error
  "internal_error",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiErrorBody = {
  error: { code: ApiErrorCode; friendlyMessage: string; debug: string | null };
};
```

The generated OpenAI schema (`zodTextFormat(DashboardSpecSchema, "dashboard_spec")`) must come out with: every property in `required`, `additionalProperties: false` everywhere, nullable fields as `anyOf: [{type:"X"},{type:"null"}]`. If the helper misbehaves, hand-roll that JSON schema to exactly those rules.

## B3. `lib/sqlGuard.ts`

Pure, synchronous. Exports:

```ts
export interface SqlGuardResult {
  ok: boolean;
  reason: string | null;       // non-null when ok === false
  sanitizedSql: string | null; // non-null when ok === true
}
export function checkSql(rawSql: string): SqlGuardResult;
export function wrapForExecution(sanitizedSql: string): string;
```

`checkSql` algorithm, in exact order:
1. **Strip comments:** block comments `/\/\*[\s\S]*?\*\//g` → single space; then line comments `/--.*$/gm` → "". (Accepted v1 limitation: doesn't parse string literals; over-stripping can only over-reject, never smuggle a write through.)
2. **Trim** whitespace.
3. **Reject if empty** → reason `"query is empty after removing comments"`.
4. **Strip one trailing semicolon** (`/;\s*$/`), then **reject if any `;` remains** → `"multiple SQL statements are not allowed"`. Runs before keyword scan so `SELECT 1; DROP …` dies here deterministically.
5. **Must match `/^\s*(SELECT|WITH)\b/i`** → else `"query must start with SELECT or WITH"`.
6. **Forbidden-keyword scan** — case-insensitive `\b<KEYWORD>\b` per keyword; `_` is a word char so `updated_at`/`created_by` don't false-positive. First match → `"forbidden keyword: <KW>"`. Exact list:
   `INSERT, UPDATE, DELETE, MERGE, UPSERT, DROP, ALTER, TRUNCATE, CREATE, COMMENT, GRANT, REVOKE, EXECUTE, CALL, DO, PREPARE, DEALLOCATE, COPY, VACUUM, ANALYZE, REINDEX, CLUSTER, REFRESH, LOCK, LISTEN, NOTIFY, UNLISTEN, SET, RESET, BEGIN, COMMIT, ROLLBACK, SAVEPOINT, INTO`
   (`INTO` blocks `SELECT … INTO new_table`, which starts with SELECT but creates a table. Accepted trade-off: a literal like `'Drop Dead Fred'` over-rejects — safe direction, and auto-repair mitigates.)
7. Pass → `{ ok: true, reason: null, sanitizedSql: <string as of step 4> }`.

```ts
export function wrapForExecution(sanitizedSql: string): string {
  return `SELECT * FROM (\n${sanitizedSql}\n) AS _panel LIMIT 5001`;
}
```
Only ever called on guard-passed SQL (semicolon already stripped — otherwise the wrap is syntactically invalid). `WITH … SELECT` wraps fine as a subquery body.

Unit tests (put in `lib/sqlGuard.test.ts` or verify via a scratch script) — exact cases:
| # | Input | Expect |
|---|---|---|
| 1 | `SELECT store_id, SUM(amount) AS total_revenue FROM payment GROUP BY store_id` | ok |
| 2 | `-- monthly revenue` + CTE query ending `;` | ok; comment + `;` stripped |
| 3 | `SELECT customer_id, updated_at FROM customer` | ok (no false positive on `updated_at`) |
| 4 | `SELECT title FROM film WHERE title = 'Dropbox Promo Night'` | ok (`Dropbox` ≠ `\bDROP\b`) |
| 5 | `SELECT * FROM payment; DROP TABLE payment;` | reject: multiple statements |
| 6 | `DELETE FROM payment WHERE payment_id = 1` | reject: must start with SELECT/WITH |
| 7 | `SELECT * INTO backup_payment FROM payment` | reject: forbidden keyword INTO |
| 8 | `SELECT title FROM film WHERE title = 'Drop Dead Fred'` | reject (documented accepted false positive) |

## B4. `lib/db.ts`

```ts
// lib/db.ts
import { Pool, types } from "pg";
import { env } from "./env";
import { wrapForExecution } from "./sqlGuard";
import type { ColumnMeta } from "./types";

// numeric + int8 -> numbers (safe: values < 2^53); dates/timestamps -> ISO strings
types.setTypeParser(1700, (v: string) => parseFloat(v));
types.setTypeParser(20, (v: string) => parseInt(v, 10));
types.setTypeParser(1082, (v: string) => v);                       // 'YYYY-MM-DD'
types.setTypeParser(1114, (v: string) => v.replace(" ", "T"));
types.setTypeParser(1184, (v: string) => {
  const iso = v.replace(" ", "T");
  return iso.endsWith("+00") ? iso.slice(0, -3) + "Z" : iso;
});

export const pool = new Pool({
  connectionString: env.DATABASE_URL_READONLY,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 19_000, // just under the role's 20s backstop
  ssl: { rejectUnauthorized: false },
});

const NUMBER_OIDS = new Set([20, 21, 23, 700, 701, 1700]);
const DATE_OIDS = new Set([1082, 1114, 1184]);
const BOOLEAN_OIDS = new Set([16]);

export function normalizeColumnType(oid: number): ColumnMeta["type"] {
  if (NUMBER_OIDS.has(oid)) return "number";
  if (DATE_OIDS.has(oid)) return "date";
  if (BOOLEAN_OIDS.has(oid)) return "boolean";
  return "string";
}

export interface PanelQueryResult {
  columns: ColumnMeta[];
  rows: unknown[][];
  truncated: boolean;
}

const WRAP_LIMIT = 5001;
const DISPLAY_LIMIT = 5000;

export async function executePanelQuery(sanitizedSql: string): Promise<PanelQueryResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const result = await client.query({ text: wrapForExecution(sanitizedSql), rowMode: "array" });
    await client.query("COMMIT");

    const columns: ColumnMeta[] = result.fields.map((f) => ({
      name: f.name,
      type: normalizeColumnType(f.dataTypeID),
    }));
    const truncated = result.rows.length >= WRAP_LIMIT;
    const rows = truncated ? result.rows.slice(0, DISPLAY_LIMIT) : result.rows;
    return { columns, rows, truncated };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
```

Rules: never `pool.query()` for panel execution (BEGIN/COMMIT must share one client); `pool` is a module singleton — never construct a second Pool; timeout classification (`err.code === "57014"`) happens in the route.

## B5. `lib/openai.ts` + prompts (verbatim)

```ts
// lib/openai.ts
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { env } from "./env";
import {
  DashboardSpecSchema, RepairSqlSchema,
  type DashboardSpec, type PanelSpec,
} from "./types";

const FALLBACK_MODEL = "gpt-5.6-luna";
const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export class LlmError extends Error {
  readonly code = "llm_error" as const;
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "LlmError";
  }
}

function isRetriableError(err: unknown): boolean {
  if (err instanceof OpenAI.APIError) {
    return err.status === 429 || (err.status !== undefined && err.status >= 500);
  }
  return true; // network errors, aborts
}

async function callWithFallback<T>(fn: (model: string) => Promise<T>): Promise<T> {
  try {
    return await fn(env.OPENAI_MODEL);
  } catch (err) {
    if (!isRetriableError(err)) throw new LlmError("OpenAI call failed (non-retriable)", err);
    try {
      return await fn(FALLBACK_MODEL);
    } catch (fallbackErr) {
      throw new LlmError("OpenAI call failed on primary and fallback model", fallbackErr);
    }
  }
}

export interface GenerateDashboardParams {
  question: string;
  currentDate: string;   // 'YYYY-MM-DD'
  schemaContext: string; // contents of db/schema-context.md
}

export async function generateDashboardSpec(params: GenerateDashboardParams): Promise<DashboardSpec> {
  const systemPrompt = buildDashboardSystemPrompt(params);
  return callWithFallback(async (model) => {
    const response = await client.responses.parse({
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: params.question },
      ],
      reasoning: { effort: "medium" },
      text: { verbosity: "low", format: zodTextFormat(DashboardSpecSchema, "dashboard_spec") },
      max_output_tokens: 4000,
    });
    if (!response.output_parsed) throw new LlmError("model returned no parseable dashboard spec", response);
    return response.output_parsed;
  });
}

export interface RepairSqlParams {
  question: string;
  panel: PanelSpec;
  sql: string;
  errorMessage: string;
  schemaContext: string;
}

export async function repairSql(params: RepairSqlParams): Promise<string> {
  const systemPrompt = buildRepairSystemPrompt(params.schemaContext);
  const userPrompt = buildRepairUserPrompt(params);
  return callWithFallback(async (model) => {
    const response = await client.responses.parse({
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      reasoning: { effort: "low" },
      text: { verbosity: "low", format: zodTextFormat(RepairSqlSchema, "sql_repair") },
      max_output_tokens: 600,
    });
    if (!response.output_parsed) throw new LlmError("model returned no parseable repair", response);
    return response.output_parsed.sql;
  });
}
```

Prompt-cache note: schema context + current date live in the **system** message; per-call content (question / failing SQL) in the **user** message — maximizes Responses-API prompt-cache reuse.

### Dashboard system prompt (verbatim — paste as a template literal)

```
You are a senior data analyst embedded in a business intelligence tool for a DVD rental company that runs on the Pagila sample database (hosted on PostgreSQL). Non-technical staff type plain-English questions and you turn each question into a small dashboard specification. You never talk to the user directly — you only produce a single structured JSON object that exactly matches the provided output schema. Do not include any prose, explanation, or markdown outside the JSON.

## Today's date
Today's date is ${currentDate} (YYYY-MM-DD). The database contains data from 2022-01-01 up to and including today. When the user uses a relative time phrase:
- "last year" / "past year" / "trailing year" -> the 365 days ending today, i.e. WHERE payment_date >= (DATE '${currentDate}' - INTERVAL '1 year')
- "this year" / "year to date" / "YTD" -> WHERE payment_date >= date_trunc('year', DATE '${currentDate}')
- "last month" -> the calendar month immediately before the current calendar month
- "this month" -> the current calendar month to date
- "last quarter" -> the calendar quarter immediately before the current one
- "last N days/weeks/months" -> the trailing N days/weeks/months ending today
- If no time period is mentioned and the question is naturally about "all time" (e.g. "which films are most popular"), do not add a date filter.
Always compute relative dates using the literal date '${currentDate}' in the SQL itself (e.g. DATE '${currentDate}' - INTERVAL '1 year') rather than CURRENT_DATE, so results are reproducible.

## Database schema
You may ONLY reference tables and columns that appear below. If a question cannot be answered exactly with this schema, do the closest reasonable thing with the data available rather than inventing columns or tables.

<schema>
${schemaContext}
</schema>

## SQL rules (hard requirements)
1. Every panel's `sql` must be a single read-only PostgreSQL statement. It must start with SELECT or WITH. Never use INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE, GRANT, REVOKE, MERGE, CALL, or COPY, or any statement that writes data or metadata.
2. Never include a trailing semicolon or more than one statement.
3. Always alias every aggregate or computed expression with a clear, snake_case name (e.g. SUM(amount) AS total_revenue, COUNT(*) AS rental_count). Never leave a column named "sum", "count", "?column?", etc.
4. Always use date_trunc('day' | 'week' | 'month' | 'quarter' | 'year', <timestamp column>) to bucket time series data. Pick the coarsest bucket that gives a readable chart (roughly 6-30 points): day for spans of six weeks or less, week for up to about six months, month for up to a few years, year for multi-year spans.
5. Unless the query is already aggregated (GROUP BY, or a single summary row), add LIMIT 1000. Aggregated queries whose result is naturally small (grouped by store, by category, by month, etc.) do not need an additional LIMIT, but never return raw, row-level data without one.
6. Revenue / money questions always use the payment.amount column, summed. Never use film.replacement_cost or rental counts alone as a proxy for revenue.
7. When a question asks for results "by store" or "per store", attribute the transaction to the store of the staff member who processed it: join payment to staff on payment.staff_id = staff.staff_id, then staff to store on staff.store_id = store.store_id. Do not use customer.store_id for this purpose — that is the customer's home store, not the store where the transaction happened.
8. When a question involves film genre or category, join film_category (film_category.film_id = film.film_id) to category (category.category_id = film_category.category_id) and group by category.name.
9. When a question involves customers, join through customer.customer_id; when it involves rentals, join rental.customer_id and rental.inventory_id -> inventory.film_id -> film.
10. Prefer explicit JOIN ... ON syntax over comma joins. Always qualify ambiguous column names with a table alias.
11. Never use SELECT *; always select explicit columns.

## Choosing chart types
- "stat": a single headline number (a total, an average, a count) with no breakdown — the SQL must return exactly one row. Use valueField for the number, and comparison for a one-clause plain-English comparison (e.g. "vs. $12,400 the prior year") only if the SQL actually computes that comparison value; otherwise null.
- "line": a trend over a continuous time axis — use when the question involves change over time with more than about 8 points. Use xField for the date/time bucket column and yFields for one or more numeric columns. Use seriesField only when the data is split into multiple named series (e.g. one line per store); otherwise null.
- "bar": comparing a metric across a small number of discrete categories (stores, categories, ratings, top-N films), or a short time series with few buckets (8 or fewer). Use xField for the category column and yFields for the numeric column(s).
- "area": like line, but for emphasizing a cumulative total or volume under the curve. Use the same field convention as line.
- "pie": a proportion/share breakdown across at most 6 categories that sum to a meaningful whole (e.g. rentals by category). Use labelField and valueField. Never use pie for more than 6 categories, and never for time series — use "bar" instead if there are more than 6 categories.
- "table": a ranked list or row-level detail (e.g. "top 10 customers", "list of overdue rentals") where the individual rows matter more than a visual trend. Set every mapping field (xField, yFields, seriesField, labelField, valueField, unit, comparison) to null for table panels; the table renders every returned column.
- For every non-table panel, set unit to exactly one of: "currency" (money values, formatted with $), "count" (plain quantities), "percent" (values already scaled 0-100), or "none". It controls how numbers are formatted on axes, tooltips, and stat values.

## Building the dashboard
- Produce between 1 and 6 panels. Prefer fewer, well-chosen panels over many redundant ones.
- If the question is broad (e.g. "build me a dashboard on customer rentals", "show me a sales dashboard"), start with one "stat" panel giving the single most important headline number, followed by 2-4 panels that break that headline down by time, category, or store.
- If the question is narrow and asks for one specific thing (e.g. "revenue by store over the last year"), return the single most appropriate panel (usually "bar" or "line"), plus optionally one "stat" panel with the overall total if that adds real value.
- Every panel needs a short human title (60 characters or fewer) and a one-sentence plain-English description of what it shows (e.g. "Total rental revenue for each store over the trailing 12 months.").
- Give the whole dashboard a short title (80 characters or fewer) that reflects the user's question, and a one-sentence plain-English summary (the summary field) describing what the dashboard shows.

## Output format
Return only the JSON object described by the response schema. Do not wrap it in markdown code fences. Do not add commentary before or after it.
```

### Repair system prompt (verbatim)

```
You are a PostgreSQL expert fixing a single broken query inside a dashboard panel for a DVD rental company's business intelligence tool, running on the Pagila sample database. You will be given the original user question, the panel's title and chart type, the SQL that failed, and the exact database error message. Return a corrected single SELECT/WITH statement that fixes the error while still answering the original intent of the panel as closely as possible.

## Database schema
<schema>
${schemaContext}
</schema>

## Rules
1. The corrected SQL must be a single read-only statement starting with SELECT or WITH. No trailing semicolon. Never use INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE, GRANT, REVOKE, MERGE, CALL, or COPY.
2. Only reference tables and columns that appear in the schema above.
3. Preserve the original panel's intent (same grouping, breakdown, and time range) unless the error means that intent is impossible with this schema, in which case make the smallest reasonable change.
4. Always alias aggregate or computed columns with clear snake_case names.
5. If the error indicates a timeout, add or tighten a LIMIT, narrow the aggregation, or add a missing date-range filter rather than simply resubmitting the same query unchanged.
6. Return only the corrected SQL as the sql field of the JSON response. Do not include a trailing semicolon, comments, or any explanation.
```

### Repair user prompt (verbatim template)

```
Original question: "${question}"
Panel title: "${panel.title}"
Chart type: ${panel.chartType}
Panel description: "${panel.description}"

Failing SQL:
${sql}

Database error message:
${errorMessage}

Fix this query.
```

## B6. The three API routes

All three share an `errorResponse(status, code, friendlyMessage, debug)` helper returning `{ error: { code, friendlyMessage, debug } }`. `friendlyMessage` is safe for the UI; `debug` (raw detail) is never shown by default.

### `app/api/dashboard/route.ts`
- Reads `db/schema-context.md` once at module load: `fs.readFileSync(path.join(process.cwd(), "db", "schema-context.md"), "utf-8")`.
- `POST { question }` → zod-parse (400 `invalid_request` on failure; friendly: "Please enter a question between 1 and 500 characters.").
- `currentDate = new Date().toISOString().slice(0, 10)`.
- Call `generateDashboardSpec` → on throw: 502 `llm_error`, friendly "The assistant is having trouble right now. Please try again in a moment."
- **Pre-filter panels and assign ids:** `const panelsWithIds = spec.panels.filter(p => checkSql(p.sql).ok).slice(0, 6).map((p, i) => ({ ...p, id: \`panel-${i}\` }))`; if zero remain → 502 `llm_error`, friendly "The assistant couldn't design a dashboard for that question. Try rephrasing it or being more specific."
- 200: `{ spec: { title: spec.title, summary: spec.summary, panels: panelsWithIds } }`.

### `app/api/panel/route.ts`
- `POST { sql, chartType }` → zod-parse (400 `invalid_request`).
- `checkSql(sql)` → not ok: 400 `sql_rejected`, friendly "This chart's query isn't a supported read-only query and can't be run.", debug = guard reason.
- `executePanelQuery(guard.sanitizedSql!)` → 200 `{ columns, rows, truncated }`.
- Catch: pg code `57014` → 504 `query_timeout`, friendly "That query took too long to run and was cancelled. Try narrowing the date range or asking a simpler question." Anything else → 500 `query_failed`, friendly "Something went wrong running that chart's query."
- **Invariant: no code path calls `executePanelQuery` on a string that didn't just pass `checkSql` in the same request** — including repaired SQL resubmitted by the frontend.

### `app/api/repair/route.ts`
- Reads schema context at module load (same pattern).
- `POST { question, panel, sql, errorMessage }` → zod-parse (400).
- `repairSql(...)` → on throw: 502 `llm_error`, friendly "The assistant couldn't fix this chart's query. Try adjusting your original question instead."
- Guard-check the repaired SQL; if it fails → same 502 `llm_error` (debug: `repaired sql failed sqlGuard: <reason>`).
- 200: `{ sql: guard.sanitizedSql }` — frontend passes it straight back to `/api/panel` (which re-validates anyway).
- Note: the `panel` the frontend sends back includes the server-assigned `id`; zod v3 objects strip unknown keys by default, so `PanelSpecSchema` accepts it unchanged.

---

# Stage 7 — Frontend (detailed spec)

> All components import shared types from `lib/types.ts` (Stage 5): `PanelWithId`, `DashboardSpecWithIds`, `ColumnMeta`, `ChartType`, `Unit`. Frontend-only types (`Phase`, `PanelStatus`, `PanelState`) live in `hooks/useDashboard.ts`. **`app/layout.tsx` is the only Server Component**; `app/page.tsx`, everything under `components/`, and the hook all start with `'use client'`. `lib/format.ts` is plain TS, no directive.

## F1. File inventory

| Path | Responsibility |
|---|---|
| `app/layout.tsx` | HTML shell; system font; page background; no next/font. |
| `app/page.tsx` | View switch on `phase`; owns `EXAMPLES` and the `?debug=1` flag. |
| `lib/format.ts` | All pure transforms/formatters + palette (full code below). |
| `hooks/useDashboard.ts` | Fetch-orchestration state machine (full code below). |
| `components/PromptBar.tsx` | Input + submit; native form Enter-to-submit. |
| `components/ExampleChips.tsx` | 4 example-question pill buttons. |
| `components/DashboardView.tsx` | Dashboard header + responsive panel grid. |
| `components/PanelCard.tsx` | Panel chrome; dispatches skeleton/repairing/chart/error; debug SQL block. |
| `components/PanelError.tsx` | Friendly failure card (copy §F7). |
| `components/EmptyPanel.tsx` | "No data for this one" card. |
| `components/charts/ChartRenderer.tsx` | Field resolution → pivot/rollup → dispatch to chart component; table fallback. |
| `components/charts/{LineChartPanel,BarChartPanel,AreaChartPanel,PiePanel,StatPanel,TablePanel}.tsx` | One file per chart type. |

## F2. `lib/format.ts` — exact implementation

```ts
import type { PanelWithId, ColumnMeta, Unit } from './types';

// ---------- guards ----------

export function safeNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

// ---------- row shaping ----------

export function toObjects(
  columns: ColumnMeta[],
  rows: unknown[][]
): Record<string, unknown>[] {
  return rows.map((row) =>
    Object.fromEntries(columns.map((col, i) => [col.name, row[i] === undefined ? null : row[i]]))
  );
}

export function inferColumnKind(values: unknown[]): 'number' | 'date' | 'string' {
  const nonNull = values.filter((v) => v !== null && v !== undefined);
  if (nonNull.length === 0) return 'string';
  if (nonNull.every((v) => safeNumber(v) !== null)) return 'number';
  const allDate = nonNull.every((v) => {
    if (typeof v === 'number') return false;
    const d = new Date(v as string);
    return !Number.isNaN(d.getTime());
  });
  return allDate ? 'date' : 'string';
}

// ---------- field resolution / fallback ----------

export interface ResolvedFields {
  xField?: string;
  yFields: string[];
  seriesField?: string;
  labelField?: string;
  valueField?: string;
}

export function resolveFields(
  panel: PanelWithId,
  columns: ColumnMeta[],
  objects: Record<string, unknown>[]
): ResolvedFields {
  const names = new Set(columns.map((c) => c.name));
  const kindByName = new Map(
    columns.map((c) => [c.name, inferColumnKind(objects.map((o) => o[c.name]))])
  );
  const numericCols = columns.filter((c) => kindByName.get(c.name) === 'number').map((c) => c.name);
  const otherCols = columns.filter((c) => kindByName.get(c.name) !== 'number').map((c) => c.name);

  const xField = panel.xField && names.has(panel.xField) ? panel.xField : otherCols[0];
  let yFields = (panel.yFields ?? []).filter((f) => names.has(f));
  if (yFields.length === 0) yFields = numericCols.filter((n) => n !== xField);
  const seriesField = panel.seriesField && names.has(panel.seriesField) ? panel.seriesField : undefined;
  const labelField = panel.labelField && names.has(panel.labelField) ? panel.labelField : otherCols[0];
  const valueField = panel.valueField && names.has(panel.valueField) ? panel.valueField : numericCols[0];

  return { xField, yFields, seriesField, labelField, valueField };
}

// ---------- long → wide pivot ----------

export interface PivotResult {
  data: Record<string, unknown>[];
  seriesKeys: string[];
  overflowCount: number;
}

// Cap at 12 series (top 12 by total value; rest dropped). Only 8 palette hues:
// series 9-12 reuse hues 1-4 with a dashed stroke as the non-color encoding.
export function pivotLongToWide(
  objects: Record<string, unknown>[],
  xField: string,
  seriesField: string,
  yField: string,
  maxSeries = 12
): PivotResult {
  const totals = new Map<string, number>();
  for (const o of objects) {
    const key = o[seriesField] == null ? 'Unknown' : String(o[seriesField]);
    totals.set(key, (totals.get(key) ?? 0) + (safeNumber(o[yField]) ?? 0));
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const keptSeries = ranked.slice(0, maxSeries);
  const keptSet = new Set(keptSeries);
  const overflowCount = Math.max(0, ranked.length - maxSeries);

  const byX = new Map<string, Record<string, unknown>>();
  for (const o of objects) {
    const seriesKey = o[seriesField] == null ? 'Unknown' : String(o[seriesField]);
    if (!keptSet.has(seriesKey)) continue;
    const xVal = o[xField];
    const rowKey = String(xVal);
    if (!byX.has(rowKey)) byX.set(rowKey, { [xField]: xVal });
    byX.get(rowKey)![seriesKey] = safeNumber(o[yField]);
  }
  return { data: [...byX.values()], seriesKeys: keptSeries, overflowCount };
}

// ---------- pie "Other" rollup ----------

export interface PieSlice {
  name: string;
  value: number;
}

export function rollupPieSlices(
  objects: Record<string, unknown>[],
  labelField: string,
  valueField: string,
  maxSlices = 8
): { slices: PieSlice[]; overflow: boolean } {
  const rows: PieSlice[] = objects
    .map((o) => ({
      name: o[labelField] == null ? 'Unknown' : String(o[labelField]),
      value: safeNumber(o[valueField]) ?? 0,
    }))
    .filter((r) => r.value > 0);
  rows.sort((a, b) => b.value - a.value);
  if (rows.length <= maxSlices) return { slices: rows, overflow: false };
  const top = rows.slice(0, maxSlices - 1);
  const otherValue = rows.slice(maxSlices - 1).reduce((sum, r) => sum + r.value, 0);
  return { slices: [...top, { name: 'Other', value: otherValue }], overflow: true };
}

// ---------- date granularity + formatting ----------

export type DateGranularity = 'year' | 'month' | 'day' | 'none';

export function detectDateGranularity(values: unknown[]): DateGranularity {
  const dates = values
    .map((v) => (v == null ? null : new Date(v as string)))
    .filter((d): d is Date => d !== null && !Number.isNaN(d.getTime()));
  if (dates.length === 0 || dates.length !== values.length) return 'none';
  const allFirstOfMonth = dates.every((d) => d.getUTCDate() === 1);
  const allJanuary = dates.every((d) => d.getUTCMonth() === 0);
  if (allFirstOfMonth && allJanuary) return 'year';
  if (allFirstOfMonth) return 'month';
  return 'day';
}

// timeZone pinned to UTC deliberately: date_trunc results are UTC midnight;
// local-zone formatting would shift the shown date back a day for negative-
// offset users. Do not remove.
export function formatDateTick(raw: unknown, granularity: DateGranularity): string {
  if (granularity === 'none') return raw == null ? '' : String(raw);
  const d = new Date(raw as string);
  if (Number.isNaN(d.getTime())) return String(raw);
  if (granularity === 'year') return new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'UTC' }).format(d);
  if (granularity === 'month') return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}

// ---------- number formatting ----------

export function formatCompactNumber(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${sign}${abs}`;
}

export function formatCurrencyFull(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export function formatCountFull(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
}

// percent values arrive already scaled 0-100 (the prompt defines unit
// "percent" that way for the LLM).
export function formatPercent(n: number): string {
  return `${(Math.round(n * 10) / 10).toFixed(1)}%`;
}

export function formatUnitValue(raw: unknown, unit: Unit | null | undefined, mode: 'axis' | 'tooltip' | 'stat'): string {
  const n = safeNumber(raw);
  if (n === null) return '—';
  switch (unit) {
    case 'currency':
      return mode === 'tooltip' || mode === 'stat' ? formatCurrencyFull(n) : `$${formatCompactNumber(n)}`;
    case 'percent':
      return formatPercent(n);
    default:
      return mode === 'tooltip' ? formatCountFull(n) : mode === 'stat' ? formatCountFull(n) : formatCompactNumber(n);
  }
}

// ---------- palette ----------

// Validated against a white surface with the dataviz palette validator: all
// hard gates pass. Three hues (magenta/amber/aqua) fall below 3:1 text
// contrast on white, so palette colors are used ONLY as fills/strokes — all
// text renders in ink colors (#0b0b0b / #52514e).
export const PALETTE = [
  '#2a78d6', // blue
  '#008300', // green
  '#e87ba4', // magenta/rose
  '#eda100', // amber
  '#1baf7a', // aqua/teal
  '#eb6834', // orange
  '#4a3aa7', // violet
  '#e34948', // red
] as const;

export function colorForSeriesIndex(i: number): string {
  return PALETTE[i % PALETTE.length];
}

export function dashArrayForSeriesIndex(i: number): string | undefined {
  return i < PALETTE.length ? undefined : '6 3';
}
```

## F3. `hooks/useDashboard.ts` — exact state machine

Handles the nested error body `{ error: { code, friendlyMessage, debug } }` from Stage 6, feeds the RAW error (`debug`, which carries the Postgres message) to `/api/repair`, and aborts superseded requests. Note on the mutual `runPanel` ⇄ `attemptRepair` reference: declare both with `useCallback` in the order below — each render recreates both together, so the closure capture is correct; silence the exhaustive-deps lint on the two lines that reference the later-declared function.

```ts
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardSpecWithIds, PanelWithId, ColumnMeta } from '@/lib/types';

export type Phase = 'idle' | 'planning' | 'rendering' | 'done' | 'error';
export type PanelStatus = 'loading' | 'repairing' | 'ready' | 'failed';

export interface PanelState {
  status: PanelStatus;
  sql: string; // sql currently in effect (original or repaired)
  columns?: ColumnMeta[];
  rows?: unknown[][];
  truncated?: boolean;
  error?: { friendlyMessage: string; debug?: string | null };
}

interface DashboardState {
  phase: Phase;
  question: string;
  spec: DashboardSpecWithIds | null;
  panels: Record<string, PanelState>;
  dashboardError: string | null;
}

const GENERIC_DASHBOARD_ERROR =
  'Something went wrong on our end. Try again, or try asking in a different way.';
const GENERIC_PANEL_ERROR =
  "We tried a couple of ways to build this one, but it's not working right now.";

class FriendlyError extends Error {}

type ApiErrorShape = { code?: string; friendlyMessage?: string; debug?: string | null };

export function useDashboard() {
  const [state, setState] = useState<DashboardState>({
    phase: 'idle', question: '', spec: null, panels: {}, dashboardError: null,
  });

  const dashboardControllerRef = useRef<AbortController | null>(null);
  const panelControllersRef = useRef<Map<string, AbortController>>(new Map());
  const currentQuestionRef = useRef('');

  const abortAll = useCallback(() => {
    dashboardControllerRef.current?.abort();
    dashboardControllerRef.current = null;
    for (const c of panelControllersRef.current.values()) c.abort();
    panelControllersRef.current.clear();
  }, []);

  useEffect(() => () => abortAll(), [abortAll]);

  const setPanel = useCallback((id: string, patch: Partial<PanelState>) => {
    setState((s) => ({ ...s, panels: { ...s.panels, [id]: { ...s.panels[id], ...patch } as PanelState } }));
  }, []);

  const maybeFinish = useCallback(() => {
    setState((s) => {
      const allSettled = Object.values(s.panels).every((p) => p.status === 'ready' || p.status === 'failed');
      if (allSettled && s.phase === 'rendering') return { ...s, phase: 'done' };
      return s;
    });
  }, []);

  const runPanel = useCallback(
    async (panel: PanelWithId, signal: AbortSignal, sqlOverride?: string, isRepairRun = false) => {
      const sql = sqlOverride ?? panel.sql;
      setPanel(panel.id, { status: isRepairRun ? 'repairing' : 'loading', sql });
      try {
        const res = await fetch('/api/panel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql, chartType: panel.chartType }),
          signal,
        });
        const body = await res.json().catch(() => null);
        if (res.ok && body && !body.error) {
          setPanel(panel.id, { status: 'ready', columns: body.columns, rows: body.rows, truncated: body.truncated });
          maybeFinish();
          return;
        }
        const errBody: ApiErrorShape | undefined = body?.error;
        const friendlyMessage = errBody?.friendlyMessage ?? GENERIC_PANEL_ERROR;
        if (isRepairRun) {
          setPanel(panel.id, { status: 'failed', error: { friendlyMessage, debug: errBody?.debug } });
          maybeFinish();
          return;
        }
        // Raw DB error lives in debug — that's what the repair prompt needs.
        const rawError = (errBody?.debug ?? errBody?.friendlyMessage ?? 'unknown error').slice(0, 2000);
        await attemptRepair(panel, signal, sql, rawError);
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        if (isRepairRun) {
          setPanel(panel.id, { status: 'failed', error: { friendlyMessage: GENERIC_PANEL_ERROR } });
          maybeFinish();
          return;
        }
        await attemptRepair(panel, signal, sql, 'network error');
      }
    },
    [setPanel, maybeFinish] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const attemptRepair = useCallback(
    async (panel: PanelWithId, signal: AbortSignal, sql: string, errorMessage: string) => {
      setPanel(panel.id, { status: 'repairing' });
      try {
        const res = await fetch('/api/repair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: currentQuestionRef.current, panel, sql, errorMessage }),
          signal,
        });
        if (!res.ok) throw new Error('repair failed');
        const { sql: repairedSql } = await res.json();
        await runPanel(panel, signal, repairedSql, true);
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        setPanel(panel.id, { status: 'failed', error: { friendlyMessage: GENERIC_PANEL_ERROR } });
        maybeFinish();
      }
    },
    [setPanel, runPanel, maybeFinish]
  );

  const submit = useCallback(
    async (question: string) => {
      abortAll();
      currentQuestionRef.current = question;
      setState({ phase: 'planning', question, spec: null, panels: {}, dashboardError: null });

      const controller = new AbortController();
      dashboardControllerRef.current = controller;
      try {
        const res = await fetch('/api/dashboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => null);
          throw new FriendlyError(errBody?.error?.friendlyMessage ?? GENERIC_DASHBOARD_ERROR);
        }
        const { spec } = (await res.json()) as { spec: DashboardSpecWithIds };

        const initialPanels: Record<string, PanelState> = {};
        for (const p of spec.panels) initialPanels[p.id] = { status: 'loading', sql: p.sql };
        setState({ phase: 'rendering', question, spec, panels: initialPanels, dashboardError: null });

        for (const p of spec.panels) {
          const panelController = new AbortController();
          panelControllersRef.current.set(p.id, panelController);
          runPanel(p, panelController.signal); // fire-and-forget: panels settle independently
        }
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        setState({
          phase: 'error', question, spec: null, panels: {},
          dashboardError: err instanceof FriendlyError ? err.message : GENERIC_DASHBOARD_ERROR,
        });
      }
    },
    [abortAll, runPanel]
  );

  const reset = useCallback(() => {
    abortAll();
    setState({ phase: 'idle', question: '', spec: null, panels: {}, dashboardError: null });
  }, [abortAll]);

  const retry = useCallback(() => submit(currentQuestionRef.current), [submit]);

  return { ...state, submit, reset, retry };
}
```

## F4. Chart components — exact Recharts composition

All chart bodies live in a fixed-height container matching `ResponsiveContainer height={280}`. `isAnimationActive={false}` on every mark. Marks per the dataviz system: 2px lines, `radius={[4,4,0,0]}` + `maxBarSize={24}` bars, 10%-opacity area fills, solid hairline gridlines, legend only for ≥2 series.

### `components/charts/LineChartPanel.tsx`

```tsx
'use client';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { colorForSeriesIndex, dashArrayForSeriesIndex, formatDateTick, formatUnitValue, type DateGranularity } from '@/lib/format';
import type { Unit } from '@/lib/types';

interface Props {
  data: Record<string, unknown>[];
  xField: string;
  seriesKeys: string[];
  unit?: Unit | null;
  dateGranularity: DateGranularity;
}

export function LineChartPanel({ data, xField, seriesKeys, unit, dateGranularity }: Props) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        <CartesianGrid stroke="#e1e0d9" vertical={false} />
        <XAxis
          dataKey={xField}
          tickFormatter={(v) => formatDateTick(v, dateGranularity)}
          tick={{ fontSize: 12, fill: '#898781' }}
          axisLine={{ stroke: '#c3c2b7' }}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={(v) => formatUnitValue(v, unit, 'axis')}
          tick={{ fontSize: 12, fill: '#898781' }}
          axisLine={{ stroke: '#c3c2b7' }}
          tickLine={false}
          width={56}
        />
        <Tooltip
          formatter={(value: number, name: string) => [formatUnitValue(value, unit, 'tooltip'), name]}
          labelFormatter={(label) => formatDateTick(label, dateGranularity)}
          contentStyle={{ borderRadius: 8, border: '1px solid rgba(11,11,11,0.10)', fontSize: 12 }}
        />
        {seriesKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {seriesKeys.map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            name={key}
            stroke={colorForSeriesIndex(i)}
            strokeWidth={2}
            strokeDasharray={dashArrayForSeriesIndex(i)}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: '#fcfcfb' }}
            isAnimationActive={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
```

### `components/charts/BarChartPanel.tsx`

Identical axis/grid/tooltip/legend block inside `<BarChart>`, with per-series:

```tsx
<Bar key={key} dataKey={key} name={key} fill={colorForSeriesIndex(i)}
     radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
```

For categorical x-axes (granularity `'none'`) the `tickFormatter` passes values through unchanged — `formatDateTick` already does this.

### `components/charts/AreaChartPanel.tsx`

Identical block inside `<AreaChart>`, per-series:

```tsx
<Area key={key} type="monotone" dataKey={key} name={key}
      stroke={colorForSeriesIndex(i)} strokeWidth={2}
      fill={colorForSeriesIndex(i)} fillOpacity={0.1}
      isAnimationActive={false} connectNulls />
```

Multiple series are **overlaid, never stacked** (no `stackId`) — stacking silently turns independent metrics into a cumulative total.

### `components/charts/PiePanel.tsx`

```tsx
'use client';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { PALETTE, formatUnitValue, type PieSlice } from '@/lib/format';
import type { Unit } from '@/lib/types';

export function PiePanel({ slices, unit }: { slices: PieSlice[]; unit?: Unit | null }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Tooltip
          formatter={(value: number, name: string) => [formatUnitValue(value, unit, 'tooltip'), name]}
          contentStyle={{ borderRadius: 8, border: '1px solid rgba(11,11,11,0.10)', fontSize: 12 }}
        />
        {slices.length > 1 && <Legend layout="horizontal" align="center" verticalAlign="bottom" wrapperStyle={{ fontSize: 12 }} />}
        <Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="45%" outerRadius={90}
             stroke="#fcfcfb" strokeWidth={2} isAnimationActive={false}>
          {slices.map((slice, i) => (
            <Cell key={slice.name} fill={slice.name === 'Other' ? '#c3c2b7' : PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}
```

"Other" is always neutral gray (`#c3c2b7`), never a categorical hue.

### `components/charts/StatPanel.tsx`

```tsx
'use client';
import { formatUnitValue } from '@/lib/format';
import type { Unit } from '@/lib/types';

export function StatPanel({ value, unit, caption }: { value: number | null; unit?: Unit | null; caption?: string | null }) {
  return (
    <div className="flex h-[280px] flex-col items-center justify-center gap-1 text-center">
      <span className="text-4xl font-semibold tracking-tight text-[#0b0b0b]">{formatUnitValue(value, unit, 'stat')}</span>
      {caption && <span className="text-sm text-[#52514e]">{caption}</span>}
    </div>
  );
}
```

`caption` receives the panel's `comparison` field when non-null, else nothing (the description already renders in the card header).

### `components/charts/TablePanel.tsx`

```tsx
'use client';
import { formatCountFull } from '@/lib/format';
import type { ColumnMeta } from '@/lib/types';

export function TablePanel({ columns, rows, truncated }: { columns: ColumnMeta[]; rows: unknown[][]; truncated: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            {columns.map((c) => (
              <th key={c.name} className="px-4 py-2 whitespace-nowrap">{c.name}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-gray-50">
              {row.map((cell, j) => (
                <td key={j} className={`px-4 py-2 whitespace-nowrap ${typeof cell === 'number' ? 'tabular-nums text-right' : 'text-left'}`}>
                  {cell === null || cell === undefined ? '—' : typeof cell === 'number' ? formatCountFull(cell) : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && (
        <div className="border-t border-gray-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Showing a partial result — there's more data than fits here.
        </div>
      )}
    </div>
  );
}
```

### `components/charts/ChartRenderer.tsx` — the dispatcher

```tsx
'use client';
import { toObjects, resolveFields, pivotLongToWide, rollupPieSlices, detectDateGranularity, safeNumber } from '@/lib/format';
import { LineChartPanel } from './LineChartPanel';
import { BarChartPanel } from './BarChartPanel';
import { AreaChartPanel } from './AreaChartPanel';
import { PiePanel } from './PiePanel';
import { StatPanel } from './StatPanel';
import { TablePanel } from './TablePanel';
import { EmptyPanel } from '../EmptyPanel';
import type { PanelWithId, ColumnMeta } from '@/lib/types';

export function ChartRenderer({ panel, columns, rows, truncated }: {
  panel: PanelWithId; columns: ColumnMeta[]; rows: unknown[][]; truncated: boolean;
}) {
  if (rows.length === 0) return <EmptyPanel />;

  const objects = toObjects(columns, rows);
  const resolved = resolveFields(panel, columns, objects);

  const needsTableFallback =
    (['line', 'bar', 'area'].includes(panel.chartType) && (!resolved.xField || resolved.yFields.length === 0)) ||
    (panel.chartType === 'pie' && (!resolved.labelField || !resolved.valueField)) ||
    (panel.chartType === 'stat' && (!resolved.valueField || objects.length !== 1));

  if (needsTableFallback) return <TablePanel columns={columns} rows={rows} truncated={truncated} />;

  switch (panel.chartType) {
    case 'line':
    case 'bar':
    case 'area': {
      const granularity = detectDateGranularity(objects.map((o) => o[resolved.xField!]));
      let data = objects;
      let seriesKeys = resolved.yFields;
      if (resolved.seriesField && resolved.yFields[0]) {
        const pivoted = pivotLongToWide(objects, resolved.xField!, resolved.seriesField, resolved.yFields[0]);
        data = pivoted.data;
        seriesKeys = pivoted.seriesKeys;
      }
      const Comp = panel.chartType === 'line' ? LineChartPanel : panel.chartType === 'bar' ? BarChartPanel : AreaChartPanel;
      return <Comp data={data} xField={resolved.xField!} seriesKeys={seriesKeys} unit={panel.unit} dateGranularity={granularity} />;
    }
    case 'pie': {
      const { slices } = rollupPieSlices(objects, resolved.labelField!, resolved.valueField!);
      return <PiePanel slices={slices} unit={panel.unit} />;
    }
    case 'stat': {
      const value = safeNumber(objects[0][resolved.valueField!]);
      return <StatPanel value={value} unit={panel.unit} caption={panel.comparison} />;
    }
    case 'table':
    default:
      return <TablePanel columns={columns} rows={rows} truncated={truncated} />;
  }
}
```

## F5. Shell components

### `components/PromptBar.tsx`

```tsx
'use client';
import { useState } from 'react';

export function PromptBar({ onSubmit, disabled, defaultValue }: { onSubmit: (q: string) => void; disabled?: boolean; defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue ?? '');
  return (
    <form
      className="flex w-full gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder="e.g. Show me revenue by store over the last year"
        className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base text-[#0b0b0b] placeholder:text-gray-400 focus:border-[#2a78d6] focus:outline-none focus:ring-2 focus:ring-[#2a78d6]/20 disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={disabled}
        className="rounded-xl bg-[#2a78d6] px-5 py-3 text-sm font-medium text-white hover:bg-[#1c5cab] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Build my dashboard
      </button>
    </form>
  );
}
```

