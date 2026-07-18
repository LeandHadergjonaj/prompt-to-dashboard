---
name: dashboard-design
description: How to choose chart types from question intent, compose a small dashboard, and get the design details (axes, sorting, color, labels) right. Use when editing the dashboard-generation prompt, the chart components, or reviewing generated dashboard quality.
---

# Dashboard design

This engine emits six panel types — `line`, `bar`, `area`, `pie`, `stat`, `table` —
so every rule here is expressed against that vocabulary. The core idea across all
sources: **choose the chart from the purpose of the question, not from the shape of
the data columns** (IBM Carbon; Metabase chart guide).

## 1. Choosing the chart type

The FT Visual Vocabulary classifies charts by the *relationship* a question asks
about. Collapsed to this engine's six types:

| Question intent | Panel type | Notes |
|---|---|---|
| "How is X trending / changing over time?" | `line` | Time on x; >8 points |
| "How much? Which is biggest?" (categories) | `bar` | Zero-baselined, sorted |
| "Rank the top N …" | `bar`, sorted descending | Ranking = ordered bars (FT) |
| "What share of the whole?" | `pie` only for ≤6 categories with one dominant slice; otherwise `bar` | See pie rules below |
| "How does the total accumulate / compose over time?" | `area` | Total is the story |
| "What is the single number?" | `stat` | Plus comparison vs. prior period when the SQL computes it |
| "Show me the actual records / exact values" | `table` | Lookup, not scanning |
| Distribution ("spread of order values") | `bar` as a histogram | Bin in SQL with sensible round bins |
| Correlation ("does X relate to Y?") | `table` fallback | A scatter is the right chart (FT) but isn't in this engine — never fake it with dual-axis lines |

**Line vs. bar — the most common call** (Metabase chart guide):
- Categorical x-axis → `bar`. Time-series x-axis → `line`. Never draw a line across
  unordered categories; a line implies continuity between points.
- A short time series (≤8 buckets) reads better as `bar`; a long one as `line`.
- If a metric just fluctuates in a narrow band and has no meaningful relation to
  zero, bars mislead (they encode length-from-zero) — use a line.

**Pie rules** (from Data to Viz caveat collection):
- Humans compare lengths far better than angles; similar-sized slices are unreadable.
- Pie is defensible only for a small part-to-whole breakdown — ideally 2–3 segments
  with one dominant ("70% of the whole" stories). Beyond ~6 categories, always `bar`.
- Never pie for time series. Never 3D or donut-for-style.
- This repo enforces a client-side top-8 + "Other" rollup (`rollupPieSlices` in
  `lib/format.ts`) and the prompt caps pie at 6 categories — keep the SQL aggregated
  to a handful of categories anyway rather than leaning on the rollup.

**Trap encodings to refuse** (from Data to Viz):
- Dual y-axes manufacture or hide correlation via axis scaling — use two panels
  sharing a time axis, or index both series to 100.
- If the question is about a difference, ratio, or share, compute it in SQL and plot
  the derived value — don't make the reader do mental arithmetic.

## 2. Composing the dashboard

- **One question per dashboard.** Every panel must be traceable to the user's prompt;
  a dashboard should "tell a story or answer a question" (Grafana best practices).
  1–6 panels is a *maximum*, not a quota — if two panels answer it, emit two.
- **Stratified layout** (Dashboard Design Patterns, Bach et al.): order panels
  top-down by importance — headline `stat` values first, the main trend next,
  breakdowns after, `table` detail last. The classic broad-question shape:
  1. `stat` — "what's the number?"
  2. `line`/`area` — "how is it changing?"
  3. `bar`/`pie` — "what drives it?"
  4. `table` — "show me the detail" (optional)
- `stat` panels are small — this app renders them quarter-width; put 2–4 in a row
  rather than one per row.
- **On a fixed single-screen canvas, aggregation is the only free lever.** Screen
  space, page count, interactivity, and abstraction trade off against each other
  (Dashboard Design Patterns tradeoffs); with panels capped at 6, aggregate harder
  in SQL instead of adding panels.
- No near-duplicate panels ("dashboard sprawl", Grafana): don't show the same metric
  twice in different clothes.
- Same entity ⇒ same color in every panel (from Data to Viz "chart consistency";
  this repo's `PALETTE` in `lib/format.ts` assigns colors by series index — keep
  series order stable across panels when possible).

## 3. Design details that matter

**Axis baselines**
- `bar` and `area` encode filled magnitude — the y-axis must start at zero (FT;
  from Data to Viz "cut y-axis"). Truncating a bar axis is inherently deceptive.
- `line` may zoom into a narrow range to show meaningful variation — legitimately,
  as readers track slope, not height from the floor — but pick an honest range.

**Sorting**
- Sort category bars by value, descending — the single biggest readability win
  (from Data to Viz "order your data").
- Exception: keep natural order for intrinsically ordinal axes — time, day-of-week,
  month, age brackets, funnel stages.
- Long category labels → the fix is horizontal bars, never rotated axis labels.

**Time bucketing**
- Always aggregate into buckets via `date_trunc`; target roughly 20–100 points for a
  line, ≤8 for bars. Granularity heuristics: ≤6 weeks → day, ≤6 months → week,
  up to a few years → month, multi-year → year (mirrors the generation prompt).
- **Exclude the in-progress period** — a partial current month renders as a fake
  cliff at the right edge (Metabase line-chart guide).
- Zero-fill gaps for counts/sums (missing buckets otherwise vanish and the line
  lies); leave gaps as NULL for rates/averages, where zero would be false. See the
  date-spine pattern in `analytical-sql`.

**Top-N and series caps**
- Breakdown panels: at most 5–10 categories; top-N in SQL with the remainder rolled
  into `'Other'`, kept last regardless of sort.
- Multi-series lines: ~5 series max before spaghetti (from Data to Viz); this repo
  hard-caps at 12 with dashed strokes past 8 (`pivotLongToWide`) — treat that as a
  fallback, not a target.

**Color**
- Color must mean something: one series ⇒ one color; per-bar rainbow adds nothing
  and implies a nonexistent encoding (from Data to Viz "meaningless color").
- Never a rainbow palette on numeric scales; sequential single-hue ramps instead.
- Highlighting one series? Accent color for it, gray for the rest (Datawrapper).
- Green-good/red-bad is colorblind-hostile as a sole channel — pair with a
  direction indicator (this repo's `stat` comparison text does this).

**Labels and numbers**
- Panel titles state what the panel answers in the user's vocabulary ("Revenue by
  month, last 12 months"), never query-ish names.
- Abbreviate big numbers on axes and stats (1.2k, 3.4M — `formatCompactNumber`);
  full precision belongs in tooltips. Percentages ≤1 decimal. Dates formatted to
  match bucket granularity ("Mar 2026" for monthly, "Mar 3" for daily) — this is
  what `formatDateTick` does; keep SQL bucket granularity aligned with it.
- Compare like with like: when entities differ wildly in size, chart rates or
  percentages, not raw totals (Grafana normalization guidance).

**Stacked charts**
- Only the bottom series and the total are readable in a stack; middle-series
  trends are illegible (from Data to Viz; FT). Stack only when the total is the
  story, ≤4–5 segments, biggest series at the baseline.

## 4. Mistakes checklist

Chart-level (from Data to Viz caveat collection unless noted):
- [ ] Truncated y-axis on bars/areas
- [ ] Pie with >6 slices, or similar-sized slices
- [ ] Dual y-axes implying correlation
- [ ] Spaghetti lines (too many series, no top-N)
- [ ] Color that encodes nothing / rainbow on numeric data
- [ ] Unsorted category bars
- [ ] Line drawn across unordered categories
- [ ] Stacked chart used to compare middle series

Data/query-level (the LLM writes the SQL, so these are generation bugs):
- [ ] Shares that don't sum to ~100%; AVG-of-ratios ≠ ratio-of-AVGs
- [ ] Simpson's paradox — aggregate trend reversing within subgroups the question
      actually asked about
- [ ] Partial current period charted as a collapse
- [ ] Missing date buckets silently bridged by the line
- [ ] Raw totals compared across differently-sized entities

Dashboard-level:
- [ ] Panels not traceable to the question (padding to fill the panel cap)
- [ ] Near-duplicate panels
- [ ] Same entity in different colors across panels
- [ ] Titles that describe the query instead of answering the question

## Sources

Paraphrased with attribution from: [FT Visual Vocabulary](https://github.com/Financial-Times/chart-doctor)
(MIT repo, FT-content carve-out), [from Data to Viz](https://www.data-to-viz.com/caveats.html)
([MIT repo](https://github.com/holtzy/data_to_viz)), [Dashboard Design Patterns, Bach et al.](https://dashboarddesignpatterns.github.io/)
([paper](https://arxiv.org/abs/2205.00757)), [Grafana dashboard best practices](https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/best-practices/),
[Metabase Learn chart guide](https://www.metabase.com/learn/metabase-basics/querying-and-dashboards/visualization/chart-guide),
[IBM Carbon data viz](https://carbondesignsystem.com/data-visualization/chart-types/),
[Datawrapper color guidance](https://www.datawrapper.de/blog/beautifulcolors/),
[U.S. Data Design Standards](https://xdgov.github.io/data-design-standards/) (CC0).
Unattributed heuristics (granularity thresholds, top-N caps, number formatting) are
synthesis aligned with this repo's implementation.
