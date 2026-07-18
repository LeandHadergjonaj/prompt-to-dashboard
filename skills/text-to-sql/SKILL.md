---
name: text-to-sql
description: Evidence-backed techniques for LLM SQL generation — schema representation, prompting, repair loops, guardrails, and evaluation. Use when editing lib/openai.ts prompts, the introspection script, lib/sqlGuard.ts, or planning accuracy improvements.
---

# Text-to-SQL with LLMs

This engine's pipeline: introspected schema context (markdown) + question → one
structured-output call → panel specs with SQL → keyword-denylist guard → read-only
execution → one repair attempt with the DB error. Each section below states what
the evidence says and how it maps to this pipeline.

## 1. Schema representation (`scripts/introspect-schema.mjs` territory)

**What the schema context must contain.** The systematic studies agree on the
ingredients, more than the format:

- Types, primary keys, and **foreign keys** — FKs alone improved execution accuracy
  by 0.6–2.9% (DAIL-SQL benchmark study). Join paths are the thing models guess
  worst.
- **Example values, especially enumerations of low-cardinality columns.** Pinterest
  injects distinct values of low-cardinality columns so filters like
  `platform = 'WEB'` match reality; the best Spider prompts included ~3 column
  values or ~10 sample rows (Chang & Fosler-Lussier). This engine's introspection
  already samples distinct values — that's load-bearing, keep it.
- Table descriptions and row counts. Pinterest measured table-search hit rate going
  from **40% → ~90%** as documentation weight increased — documentation quality
  dominates model choice. Vanna's accuracy experiment: schema-only context ~3%
  accuracy; retrieved relevant examples ~70–80%, and context strategy mattered more
  than which LLM.
- Format itself is secondary: DDL (`CREATE TABLE`) is the well-studied baseline
  (DAIL-SQL "code representation"); M-Schema's compact semi-structured format
  (name, type, description, PK flag, example values per column + FK section)
  slightly beats DDL (XiYan-SQL). This repo's markdown tables are equivalent in
  information content — that's what matters.

**Don't prune the schema until you must.** For frontier models, schema-linking/
pruning *reduces* accuracy — filters drop required columns, while modern models
ignore irrelevant ones fine ("The Death of Schema Linking?", 71.83% BIRD with no
pruning). Ship the full annotated schema while it fits the context budget; when a
deployment's schema outgrows it, prune at **table** granularity via retrieval
(Uber/LinkedIn/Pinterest all do table-level selection, often with user
confirmation), never column-by-column.

## 2. Prompting techniques, ranked by measured effect

1. **Few-shot examples retrieved by similarity** — the single highest-leverage
   technique. GPT-4 on Spider went 72.3% → 83.5% execution accuracy with 5
   well-chosen examples (DAIL-SQL); every production system converges on a store of
   accepted question→SQL pairs (vanna's pair store, Dataherald's "golden SQL",
   Uber's per-domain samples). **The flywheel this repo doesn't have yet: persist
   every accepted (question, SQL, panel spec) triple as future few-shot material.**
2. **Plan-then-generate.** Full DIN-SQL decomposition (schema linking →
   classification → generation → self-correction, +10% over plain few-shot; 85.3%
   Spider) is too slow for an interactive 6-panel call, but the transferable piece
   is cheap: a brief reasoning field (join path, filters, grain) in the structured
   output *before* each panel's SQL. CHASE-SQL's query-plan chain-of-thought is the
   same idea as a candidate generator.
3. **Keep the SQL field bare.** "No explanation" instructions consistently helped
   (removing them cost 1.3–2.4%, DAIL-SQL) — with structured outputs, reasoning
   goes in its own field, never mixed into the SQL string.
4. **Self-consistency voting is marginal** (+0.4%, DAIL-SQL) — not worth 3× cost
   here. CHASE-SQL's finding: a *selection agent* over diverse candidates beats
   voting — relevant only if this engine ever generates candidates in parallel.
5. **Per-database instructions.** Dataherald's admin-written rules injected into
   every prompt ("always exclude test accounts") are directly portable: an optional
   free-text section in `db/schema-context.md` that deployers own.

## 3. Repair loops (the `/api/repair` design)

Execution-feedback repair is the best-supported cheap win: +2–3% overall, +9% on
the hardest split (Self-Debugging, ICLR'24). Design rules from MAC-SQL's Refiner
and LinkedIn's validators:

- **Validate statically first** so cheap failures never burn an LLM call: parse
  check, then bind every referenced identifier against the introspected schema.
  LinkedIn also dry-runs `EXPLAIN` before real execution.
- The repair prompt needs: original question, panel intent, failing SQL, **verbatim
  DB error**, schema. For "column does not exist" errors, a nearest-match hint
  ("no `revenue`; closest: `total_revenue`") measurably helps. (This repo sends the
  verbatim error already; identifier-binding and hints are the gap.)
- **One attempt captures most of the value** — returns diminish sharply after the
  first correction (consistent across Self-Debugging and MAC-SQL). This repo's
  single-repair budget is the right call.
- **Empty results are a soft signal, not an error.** MAC-SQL retries on empty; but
  legitimate empties exist — flag ("no data matched") rather than auto-retry.

## 4. Guardrails

- **A keyword denylist is the weakest layer.** `lib/sqlGuard.ts` is fine as
  defense-in-depth, but the category upgrade is AST-based validation
  ([sqlglot](https://github.com/tobymao/sqlglot)-style: parse, reject unparseable,
  allowlist statement type = SELECT, bind identifiers to the schema, enforce the
  LIMIT by rewriting the AST). Identifier binding also catches the most common
  semantic failure — **hallucinated columns/tables** (Uber, LinkedIn) — before
  execution instead of via the repair loop.
- **The DB grant is the guarantee; the guard is belt-and-suspenders.** Read-only
  role + read-only transaction + statement timeout (this repo has all three) is
  the stance every production system lands on.
- **Never execute LLM-generated code for charts.** Vanna's CVE-2024-5565 was
  exactly this: prompt injection → `exec()` of generated Plotly code → RCE (JFrog
  advisory). This repo's declarative panel specs are the mitigation — keep it that
  way; never add a "custom chart code" field.
- **Abstention beats guessing.** sqlcoder's prompt bakes in an "I do not know"
  escape hatch; TrustSQL-line research shows selective refusal measurably improves
  reliability. Structured-output mapping: an `assumptions` field per panel
  (rendered as a caption) and an explicit unanswerable path, instead of silent
  guesses. The current prompt's "do the closest reasonable thing" should at least
  say what it assumed.

## 5. Evaluation

- **Public benchmarks flatter.** Spider 1.0 is saturated (86–91%); on Spider 2.0's
  real enterprise workflows the same class of models scores 6–21%. BIRD shows a
  ~20-point dependence on hand-written external knowledge — which is exactly what a
  good schema-context file substitutes for. Don't chase benchmark numbers.
- **Build a small in-domain eval set instead**: checked-in questions → expected
  results, graded on **execution results, not SQL string match** — LinkedIn found
  ~60% of questions have multiple correct SQLs, and single-gold grading
  underreported by 10–15%. Uber's per-stage signals (table choice, execution
  success, non-empty output, judged similarity) localize regressions to a pipeline
  stage. For this repo: extend `scripts/` with an eval harness over the demo
  database (Chinook-style fixtures) asserting on result shapes, not SQL text.

## Priorities for this engine, ranked by evidence strength

1. Keep enriching the schema context (FKs, descriptions, value enumerations) — the
   documentation-quality effect dwarfs everything else.
2. AST-based guard + identifier binding to replace/augment the keyword denylist.
3. Persist accepted question→SQL pairs; retrieve as few-shots (the ~3%→80% lever).
4. Static validation + nearest-match hints in the repair prompt.
5. `assumptions` + refusal fields in the structured output.

## Sources

Open source: [vanna](https://github.com/vanna-ai/vanna) (MIT),
[Dataherald](https://github.com/Dataherald/dataherald) (Apache-2.0),
[defog sqlcoder](https://github.com/defog-ai/sqlcoder) (Apache-2.0),
[sqlglot](https://github.com/tobymao/sqlglot) (MIT),
[M-Schema](https://github.com/XGenerationLab/M-Schema).
Papers: [DIN-SQL](https://arxiv.org/abs/2304.11015),
[DAIL-SQL](https://arxiv.org/abs/2308.15363),
[Chang & Fosler-Lussier](https://arxiv.org/abs/2305.11853),
[Death of Schema Linking](https://arxiv.org/abs/2408.07702),
[CHASE-SQL](https://arxiv.org/abs/2410.01943),
[XiYan-SQL](https://arxiv.org/abs/2411.08599),
[Self-Debugging](https://arxiv.org/abs/2304.05128),
[MAC-SQL](https://arxiv.org/abs/2312.11242),
[Spider 2.0](https://arxiv.org/abs/2411.07763), [TrustSQL](https://arxiv.org/pdf/2403.15879).
Engineering: [Uber QueryGPT](https://www.uber.com/en-SE/blog/query-gpt/),
[Pinterest](https://medium.com/pinterest-engineering/how-we-built-text-to-sql-at-pinterest-30bad30dabff),
[LinkedIn SQL Bot](https://www.linkedin.com/blog/engineering/ai/practical-text-to-sql-for-data-analytics),
[vanna accuracy experiment](https://github.com/vanna-ai/vanna/blob/main/papers/ai-sql-accuracy-2023-08-17.md),
[JFrog CVE-2024-5565 advisory](https://jfrog.com/blog/prompt-injection-attack-code-execution-in-vanna-ai-cve-2024-5565/).
