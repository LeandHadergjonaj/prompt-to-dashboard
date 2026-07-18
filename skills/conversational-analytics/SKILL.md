---
name: conversational-analytics
description: How multi-turn, follow-up-driven analytics should work — context carry-over, resolving references like "make this a pie chart", update-vs-new classification, and ambiguity handling. Use when editing the conversation-continuity prompt section, the history plumbing, or the useDashboard follow-up logic.
---

# Conversational analytics (multi-turn text-to-SQL)

This engine supports follow-up turns: the client sends prior (question → dashboard)
turns with each request, the model returns a full dashboard with a `mode` of
`"update"` or `"new"`, and panels whose SQL is carried over verbatim reuse cached
results (`hooks/useDashboard.ts`, "Conversation continuity" section in
`lib/openai.ts`). These are the findings that shaped it and the rules for evolving it.

## 1. Context carry-over: send history, don't rewrite it

- **Full-history concatenation beats question rewriting.** Studies on the SParC and
  CoSQL multi-turn benchmarks find that rewriting the follow-up into a standalone
  question generally underperforms passing the conversation itself — rewrites
  diverge from intent exactly on the ambiguous turns where context matters most.
  Hence this engine passes prior turns as real user/assistant message pairs rather
  than paraphrasing them.
- **What to carry per turn: the question and the produced SQL/spec, not the result
  rows.** Prior SQL is a lossless, compact record of what "that chart" means;
  result sets are large and stale. (The assistant side of each history turn here is
  `{ title, panels: [{ title, chartType, sql }] }` — deliberately.)
- **Cap history.** Long conversations drift and cost tokens; the last N turns
  (this engine: 8) capture the working context. CoSQL dialogues show users *shift
  focus* between turns rather than monotonically refining — old turns go stale
  fast, so a sliding window loses little.
- **Carry the SQL that actually ran.** If a repair fixed a panel's query, the
  history must contain the repaired SQL, not the broken original — otherwise the
  model re-inherits the bug every turn (this is why `useDashboard` patches history
  after successful repairs).

## 2. Classifying the follow-up

Every turn is one of three moves (synthesis of vanna's separation of SQL-vs-chart
generation and LinkedIn's intent-classifier front door):

1. **Presentation edit** — "make this a pie chart", "swap those colors", "shorter
   title". Data is unchanged; only the spec changes. The SQL must be carried over
   **byte-identical** so cached results are reused: zero queries, zero SQL risk,
   instant response. The one exception: when the target chart type needs a
   different data shape (50-row table → pie), the SQL legitimately changes —
   reshape to what the target chart reads well (top-N + aggregate), don't copy a
   query that will render as noise.
2. **Data edit** — "only 2024", "break that down by genre", "add revenue by
   country". Regenerate the affected panel's SQL with its prior question + SQL as
   context; keep every untouched panel verbatim.
3. **New question** — a self-contained request about a different subject. Design
   from scratch; don't drag prior panels along.

Classification heuristics that work in prompts:
- Pronouns and elliptical phrasing ("this", "that one", "sort it") → the message is
  incomplete on its own → **update**, targeting the most plausible panel (for a
  single-panel dashboard, that panel).
- A complete, self-contained request about a different entity → **new**.
- When genuinely torn, prefer **update** for ambiguous fragments and **new** for
  complete sentences — a wrong "update" keeps useful context visible; a wrong
  "new" throws the user's work away.
- With no history, the answer is always **new** (enforce this in code, not just
  the prompt — this repo forces `mode: "new"` when history is empty).

## 3. Building up a dashboard across turns

- "Add …" turns must return the **full dashboard, not a diff** — every panel that
  should stay, again, with unchanged SQL byte-identical. Full-state responses make
  the client trivial (render what you got) and make cache reuse a pure string
  comparison. Diffs invite id-bookkeeping bugs and dangling references.
- Respect the panel cap by dropping the *least relevant older* panels only when
  forced; never silently drop what the user just asked for.
- Titles/summaries update only when content meaningfully changed — gratuitous
  retitling makes the dashboard feel unstable across turns.

## 4. Ambiguity: assume visibly or ask, never guess silently

The PRACTIQ taxonomy of real ambiguous questions: ambiguous column (which
"revenue"?), ambiguous filter value ("the US" vs "USA"), vague criteria
("recent", "top"), and unanswerable variants (nonexistent column/value/join). Two
findings matter:

- Even frontier models are mediocre at *detecting* ambiguity unprompted (best model
  77.4% on PRACTIQ's classification; most under 60%) — so instruct explicitly,
  don't rely on emergent judgment.
- Production systems put the human check at the cheapest decision point (Uber,
  Pinterest, LinkedIn confirm *table selection*, not free-text clarification
  dialogs). For a dashboard engine the equivalent: **state assumptions on the
  dashboard** ("Showing calendar-year 2024; 'revenue' = invoice totals") rather
  than interrupting with questions. CoSQL — the reference multi-turn benchmark —
  bakes in exactly three system behaviors: clarify when ambiguous, flag when
  unanswerable, describe what was returned so the user can verify. The summary
  field this engine renders under the title is that third behavior; an
  `assumptions` field is the natural next one.

## 5. Repair is a conversation feature

LinkedIn's highest-usage feature — used in **80% of sessions** — is "fix this
query with the error attached". Users naturally treat follow-up turns as repair
loops ("that looks wrong, the totals are doubled"). Implications:

- A failed panel's *error* belongs in the conversational context, so "why is that
  empty?" or "fix the last chart" can work as follow-ups.
- The wrong-number complaint ("totals look too high") is usually JOIN fan-out —
  see `analytical-sql` §1 — and the fix needs the prior SQL in context, which the
  history already carries.

## Sources

Benchmarks/papers: [SParC](https://yale-lily.github.io/sparc) and
[CoSQL](https://arxiv.org/abs/1909.05378) (Yale LILY),
[PRACTIQ](https://arxiv.org/abs/2410.11076), context-strategy comparison in
[Future Internet 17(11):527](https://www.mdpi.com/1999-5903/17/11/527).
Systems (paraphrased): [vanna](https://github.com/vanna-ai/vanna) (MIT — separate
SQL/chart steps), [LinkedIn SQL Bot](https://www.linkedin.com/blog/engineering/ai/practical-text-to-sql-for-data-analytics)
(intent routing, fix-with-AI usage), [Uber QueryGPT](https://www.uber.com/en-SE/blog/query-gpt/)
and [Pinterest](https://medium.com/pinterest-engineering/how-we-built-text-to-sql-at-pinterest-30bad30dabff)
(confirmation at the cheapest decision point). Unattributed rules are synthesis,
aligned with this repo's implementation.
