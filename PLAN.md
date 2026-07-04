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

