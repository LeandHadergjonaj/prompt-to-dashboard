---
name: analytical-sql
description: PostgreSQL correctness pitfalls, analytical query patterns, style, and performance rules for the read-only panel queries this engine generates. Use when editing the SQL rules in the generation/repair prompts, reviewing generated SQL, or debugging wrong-looking panel numbers.
---

# Analytical SQL (PostgreSQL)

Context: every panel is **one** read-only `SELECT`/`WITH` statement, run under a
read-only role, wrapped in `LIMIT 5001`, with a ~20s statement timeout
(`lib/sqlGuard.ts`, `lib/db.ts`). The panel's column names become chart field
bindings, so aliases are part of the contract.

## 1. Correctness pitfalls

**Three-valued logic: WHERE keeps only TRUE.** Comparisons with NULL yield Unknown,
which `WHERE` drops. `WHERE status != 'cancelled'` silently loses rows where
`status IS NULL`. Null-safe form: `status IS DISTINCT FROM 'cancelled'`.

**Never `NOT IN (subquery)`** (PostgreSQL wiki "Don't Do This"): one NULL in the
subquery makes it return zero rows, and it defeats the anti-join plan. Rewrite:

```sql
SELECT c.* FROM "customers" AS c
WHERE NOT EXISTS (SELECT FROM "orders" AS o WHERE o."customer_id" = c."id")
```

`NOT IN (1, 2, 3)` against literal non-null constants is fine.

**COUNT variants are three different questions**: `count(*)` rows; `count(col)`
rows with non-null col; `count(DISTINCT col)` distinct non-null values. "How many
orders" → `count(*)`; "how many customers ordered" → `count(DISTINCT customer_id)`.

**Aggregates skip NULLs — and `sum()` of zero rows is NULL, not 0** (PostgreSQL
docs). `avg(score)` divides by `count(score)`, not `count(*)` — if NULL means zero
in the domain, write `avg(coalesce(score, 0))`. Stat panels that must show a number:
`coalesce(sum(amount), 0)`.

**Integer division truncates**: `5 / 2 = 2`. Any rate computed as count/count needs
promotion: `round(100.0 * count(*) FILTER (WHERE converted) / count(*), 1)`.

**Every data-derived denominator gets NULLIF.** `x / 0` errors and kills the panel;
`NULLIF(d, 0)` turns it into NULL ("no data") instead:

```sql
SELECT sum(revenue) / NULLIF(sum(order_count), 0) AS avg_order_value
```

**JOIN fan-out inflates aggregates** — the classic wrong-dashboard-number bug.
Joining one-to-many duplicates the one side; `sum()` then double-counts. Aggregate
the many side first, then join at one row per key:

```sql
WITH customer_orders AS (
    SELECT "customer_id", count(*) AS order_count
    FROM "orders" GROUP BY "customer_id"
)
SELECT c."segment",
       count(*) AS customers,
       sum(c."lifetime_value") AS total_ltv,
       coalesce(sum(co.order_count), 0) AS total_orders
FROM "customers" AS c
LEFT JOIN customer_orders AS co ON co."customer_id" = c."id"
GROUP BY c."segment"
```

`count(DISTINCT c."id")` can rescue a count, but nothing rescues a fanned-out sum —
pre-aggregation is the general cure. Review heuristic: any aggregate over a query
that joins the measured table to a child table on a non-unique key is suspect.

**DISTINCT as a band-aid** usually hides a fan-out or wrong join key (and
`DISTINCT` + `GROUP BY` together is a contradiction — SQLFluff AM01). Legitimate:
`count(DISTINCT x)`, deliberate dedup at a known grain.

**GROUP BY grain**: group by the key; every extra grouped column splits groups.
Grouping by `name` alongside `id` breaks the moment two rows share a name. Row
filters go in `WHERE`, aggregate filters in `HAVING`; prefer `WHERE` when either
works (GitLab style guide).

**BETWEEN double-counts timestamp boundaries** (PostgreSQL wiki). It's a closed
interval: `BETWEEN '2026-06-01' AND '2026-06-30'` includes June 30 00:00 exactly and
misses the rest of the day. Always half-open ranges — also index-friendly and
composable across periods:

```sql
WHERE "created_at" >= DATE '2026-06-01' AND "created_at" < DATE '2026-07-01'
```

**date_trunc and timezones**: on `timestamptz`, `date_trunc('day', ts)` truncates in
the session timezone (typically UTC on a server). Postgres ≥ 12 takes an explicit
zone: `date_trunc('day', ts, 'Europe/Berlin')`. Over DST transitions,
`interval '1 day'` (calendar day) ≠ `interval '24 hours'` (exact duration).

**Gaps in time series**: `GROUP BY date_trunc(...)` emits only buckets that have
rows; a line chart then silently bridges missing days. Fix with a date spine (§2).

**Top-N, ties, and determinism** (PostgreSQL docs): `LIMIT` without a unique
`ORDER BY` returns an *unpredictable* subset — and this engine wraps every query in
a `LIMIT`. Always emit a deterministic `ORDER BY` (measure, then a unique key as
tiebreaker). Tie-inclusive top-N: `ORDER BY units DESC FETCH FIRST 10 ROWS WITH TIES`
(works only with `FETCH FIRST`, not `LIMIT`).

## 2. Analytical patterns

**Window functions** are allowed only in `SELECT`/`ORDER BY` — to filter on one,
wrap it in a CTE (PostgreSQL tutorial). Postgres has **no `QUALIFY`** (that's
Snowflake/BigQuery — a common LLM hallucination). Ranking semantics:
`row_number()` unique sequence, `rank()` ties share + gap, `dense_rank()` ties
share, no gap.

Running total — note the frame: with `ORDER BY`, the default frame includes all
*peers* of the current row, so a non-unique ordering makes running sums jump in
steps. Order by something unique or set the frame:

```sql
sum(revenue) OVER (ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
```

**Date spine — the gap fix** (`generate_series` + LEFT JOIN):

```sql
WITH days AS (
    SELECT generate_series(
        date_trunc('day', DATE '2026-07-18' - INTERVAL '29 days'),
        date_trunc('day', DATE '2026-07-18'),
        INTERVAL '1 day'
    ) AS day
),
daily AS (
    SELECT date_trunc('day', "created_at") AS day, count(*) AS signups
    FROM "users"
    WHERE "created_at" >= DATE '2026-07-18' - INTERVAL '29 days'
    GROUP BY 1
)
SELECT days.day::date AS day, coalesce(daily.signups, 0) AS signups
FROM days
LEFT JOIN daily ON daily.day = days.day
ORDER BY day
```

Rules: the spine drives the LEFT JOIN; `coalesce(..., 0)` only for additive
measures (leave averages NULL — zero would lie); aggregate the fact table *before*
joining; **bound the spine from the question's date range, never
`min(created_at)`** — an unbounded spine is a self-inflicted timeout.

**FILTER for conditional aggregates** — cleaner than CASE-inside-SUM, composable
with any aggregate, and the idiom for pivot-style panels:

```sql
SELECT date_trunc('month', "created_at") AS month,
       count(*) AS visits,
       count(*) FILTER (WHERE "converted") AS conversions,
       round(100.0 * count(*) FILTER (WHERE "converted") / NULLIF(count(*), 0), 1) AS conversion_pct
FROM "visits" GROUP BY 1 ORDER BY 1
```

**Top-N per group** — rank in a CTE, filter in the wrapper:

```sql
WITH ranked AS (
    SELECT "category", "product_name", sum("amount") AS revenue,
           row_number() OVER (PARTITION BY "category" ORDER BY sum("amount") DESC, "product_name") AS rn
    FROM "sales" GROUP BY "category", "product_name"
)
SELECT "category", "product_name", revenue
FROM ranked WHERE rn <= 3
ORDER BY "category", revenue DESC
```

**Period-over-period with lag()** — build complete periods first, exclude the
in-progress one, NULLIF the prior-period denominator:

```sql
WITH monthly AS (
    SELECT date_trunc('month', "created_at") AS month, sum("amount") AS revenue
    FROM "orders"
    WHERE "created_at" >= date_trunc('month', DATE '2026-07-18' - INTERVAL '12 months')
      AND "created_at" <  date_trunc('month', DATE '2026-07-18')
    GROUP BY 1
)
SELECT month, revenue,
       lag(revenue) OVER (ORDER BY month) AS prev_revenue,
       round(100.0 * (revenue - lag(revenue) OVER (ORDER BY month))
             / NULLIF(lag(revenue) OVER (ORDER BY month), 0), 1) AS mom_growth_pct
FROM monthly ORDER BY month
```

Moving averages (`ROWS BETWEEN 6 PRECEDING AND CURRENT ROW`) are only honest over a
gapless spine — otherwise "7 rows" ≠ "7 days".

**Percentiles over averages for skewed data** (latency, order values):

```sql
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY "response_ms") AS median_ms
```

`percentile_cont` interpolates; `percentile_disc` returns an actual data value.

**CTE shape** (dbt-style, adapted): filtered source CTEs first (apply the date
range early), one named transformation per CTE (`monthly_revenue`, not `cte1`),
short final SELECT with ORDER BY. Predictable shape makes generated SQL auditable
and repairable. Since Postgres 12, single-use CTEs are inlined — they are style,
not optimization fences.

## 3. Style for generated SQL

Consensus of sqlstyle.guide (CC BY-SA), Mozilla (MPL), GitLab (MIT), SQLFluff (MIT):

1. **snake_case for everything you name**; but this engine's cardinal rule
   (`lib/openai.ts`, tested by `scripts/test-prompt.ts`): double-quote every
   *schema* identifier with its exact capitalization — Postgres folds unquoted
   identifiers to lowercase, so `Invoice.InvoiceDate` unquoted does not exist.
2. **Alias every expression, always with explicit `AS`** (SQLFluff AL02). Aliases
   are chart field bindings here — never ship `?column?` or `sum`.
3. **Qualify every column when more than one table is in scope** (SQLFluff RF02) —
   prevents ambiguity errors against unknown schemas.
4. **Explicit join types with `ON`**: `INNER JOIN`/`LEFT JOIN`, never bare `JOIN`,
   comma joins, or `USING`; avoid `RIGHT JOIN` by reordering. Put the
   previously-referenced table's column first in `ON` so fan-out direction reads
   left-to-right.
5. **GROUP BY / ORDER BY by name, not position** (SQLFluff AM06, Mozilla) — names
   survive edits; generated SQL has no typing to economize.
6. **No `SELECT *` in the final select** — the panel contract needs known columns.
7. **`UNION ALL` unless dedup is intended** (SQLFluff AM02).
8. **Dialect discipline** — these are warehouse-isms Postgres rejects, and LLMs
   trained on warehouse SQL emit them: `QUALIFY`, `IFF`, `NVL`,
   `DATEDIFF(part, a, b)`, `GROUP BY ALL`. Postgres equivalents: wrapped window
   filter, `CASE`/`coalesce`, interval subtraction/`extract`, explicit column list.

## 4. Performance under a 20-second timeout

1. **Filter early on the raw column.** Push date ranges into the first CTE touching
   each large table.
2. **Sargable predicates**: never wrap the column side of WHERE in a function.
   `WHERE date("created_at") = ...` kills index use; the half-open range on the bare
   column (§1) is both correct and fast.
3. **Aggregate before joining** — the fan-out fix is also the performance fix.
4. **LIMIT is not a cost cap**: `ORDER BY sum(x) LIMIT 20` still scans and sorts
   everything. Real cost control = date-range filters + bounded-cardinality
   grouping.
5. Prefer the simple two-CTE query over the clever single-pass one — the planner
   inlines CTEs anyway, and simple queries are more likely correct and repairable.

## Sources

[PostgreSQL documentation](https://www.postgresql.org/docs/current/) and
[wiki "Don't Do This"](https://wiki.postgresql.org/wiki/Don%27t_Do_This) (PostgreSQL
License), [SQL Style Guide](https://www.sqlstyle.guide/) (CC BY-SA 4.0),
[Mozilla data-docs SQL style](https://docs.telemetry.mozilla.org/concepts/sql_style.html)
(MPL 2.0), [GitLab SQL style guide](https://handbook.gitlab.com/handbook/enterprise-data/platform/sql-style-guide/)
(MIT), [SQLFluff rules](https://docs.sqlfluff.com/en/stable/reference/rules.html)
(MIT), [Wikipedia "Null (SQL)"](https://en.wikipedia.org/wiki/Null_(SQL)) (CC BY-SA),
plus structural ideas (paraphrased, not copied) from dbt Labs' style docs.
