# Skills

Gathered, distilled knowledge on how to do the work this project does well: turning
plain-English questions into correct SQL and honest, readable dashboards. The content
was researched from open-source repositories, official documentation, peer-reviewed
papers, and production engineering writeups — then adapted to this codebase (its six
chart types, its panel-spec contract, its SQL guard and repair loop). It is not
generic advice written from scratch.

Each skill is a self-contained `SKILL.md` with frontmatter, written to be useful two ways:

1. **For contributors** — when editing the prompts in `lib/openai.ts`, the guard in
   `lib/sqlGuard.ts`, the chart components, or the introspection script, the relevant
   skill is the checklist of what "good" looks like and why.
2. **For the engine itself** — sections are written as directly promptable rules, so
   they can be selectively folded into the system prompt or a future retrieval step.

## Contents

| Skill | Covers |
|---|---|
| [`dashboard-design/`](dashboard-design/SKILL.md) | Choosing chart types from question intent, dashboard composition and layout, axis/sort/color/labeling rules, a mistakes checklist |
| [`analytical-sql/`](analytical-sql/SKILL.md) | PostgreSQL correctness pitfalls (NULLs, fan-out, time buckets, ties), analytical query patterns (windows, date spines, FILTER), style for generated SQL, performance under a statement timeout |
| [`text-to-sql/`](text-to-sql/SKILL.md) | Schema representation for the LLM, prompting techniques with measured effects, repair loops, guardrails and validation, evaluation |
| [`conversational-analytics/`](conversational-analytics/SKILL.md) | Multi-turn follow-ups: context carry-over, reference resolution ("make this a pie chart"), update-vs-new classification, ambiguity handling |

## Sources and licensing

Content is paraphrased and synthesized with inline attribution; nothing is reproduced
verbatim from restrictively licensed sources. Primary sources by license:

| Source | License (verified) | Used in |
|---|---|---|
| [PostgreSQL docs](https://www.postgresql.org/docs/current/) + [wiki "Don't Do This"](https://wiki.postgresql.org/wiki/Don%27t_Do_This) | PostgreSQL License (permissive) | analytical-sql |
| [FT Visual Vocabulary](https://github.com/Financial-Times/chart-doctor) | MIT (repo; FT content carve-out — paraphrased only) | dashboard-design |
| [from Data to Viz](https://github.com/holtzy/data_to_viz) caveat collection | MIT | dashboard-design |
| [U.S. Data Design Standards](https://github.com/XDgov/data-design-standards) | CC0 (public domain) | dashboard-design |
| [SQL Style Guide (Holywell)](https://www.sqlstyle.guide/) | CC BY-SA 4.0 (paraphrased) | analytical-sql |
| [Mozilla data-docs SQL style](https://docs.telemetry.mozilla.org/concepts/sql_style.html) | MPL 2.0 | analytical-sql |
| [GitLab handbook SQL style guide](https://handbook.gitlab.com/handbook/enterprise-data/platform/sql-style-guide/) | MIT | analytical-sql |
| [SQLFluff rules](https://docs.sqlfluff.com/en/stable/reference/rules.html) | MIT | analytical-sql |
| [vanna](https://github.com/vanna-ai/vanna) | MIT | text-to-sql, conversational-analytics |
| [Dataherald](https://github.com/Dataherald/dataherald) | Apache-2.0 | text-to-sql |
| [defog sqlcoder prompt](https://github.com/defog-ai/sqlcoder) | Apache-2.0 (code) | text-to-sql |
| Papers: [DIN-SQL](https://arxiv.org/abs/2304.11015), [DAIL-SQL](https://arxiv.org/abs/2308.15363), [CHASE-SQL](https://arxiv.org/abs/2410.01943), [M-Schema/XiYan-SQL](https://arxiv.org/abs/2411.08599), [Self-Debugging](https://arxiv.org/abs/2304.05128), [MAC-SQL](https://arxiv.org/abs/2312.11242), ["Death of Schema Linking"](https://arxiv.org/abs/2408.07702), [Spider 2.0](https://arxiv.org/abs/2411.07763), [CoSQL](https://arxiv.org/abs/1909.05378), [PRACTIQ](https://arxiv.org/abs/2410.11076) | citable research | text-to-sql, conversational-analytics |
| Engineering blogs: [Uber QueryGPT](https://www.uber.com/en-SE/blog/query-gpt/), [Pinterest](https://medium.com/pinterest-engineering/how-we-built-text-to-sql-at-pinterest-30bad30dabff), [LinkedIn SQL Bot](https://www.linkedin.com/blog/engineering/ai/practical-text-to-sql-for-data-analytics) | citable, paraphrased | text-to-sql, conversational-analytics |
| [Grafana dashboard best practices](https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/best-practices/), [Metabase Learn chart guides](https://www.metabase.com/learn/metabase-basics/querying-and-dashboards/visualization/chart-guide), [Dashboard Design Patterns (Bach et al.)](https://dashboarddesignpatterns.github.io/), [Datawrapper color guidance](https://www.datawrapper.de/blog/beautifulcolors/) | citable, paraphrased | dashboard-design |
