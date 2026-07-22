import type { SqlCatalog } from "./sqlGuard";

// Generic schema introspection for any PostgreSQL-compatible database.
// Produces three views of the same walk:
//  - markdown: the LLM schema context (same format db/schema-context.md uses)
//  - catalog:  table -> columns, for AST identifier binding
//  - stats:    friendly numbers for the plain-English onboarding summary
//
// Large-database discipline: every data-sampling query (min/max date ranges,
// value enumeration) runs under a session statement_timeout and is gated by
// the table's approximate row count. One slow table degrades to a less
// detailed note instead of hanging the whole onboarding request.

export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface IntrospectTableStat {
  name: string;
  approxRows: number;
  columnCount: number;
}

export interface IntrospectStats {
  databaseName: string;
  tableCount: number;
  totalApproxRows: number;
  tables: IntrospectTableStat[];
  /** "table.column: from .. to" date coverage notes */
  dateRanges: { column: string; from: string; to: string }[];
}

export interface IntrospectResult {
  markdown: string;
  catalog: SqlCatalog;
  stats: IntrospectStats;
}

// Columns worth enumerating values for: text/boolean, excluding ids,
// free-text and identifier-ish names (kept out to keep the prompt compact).
const SKIP_VALUE_COLUMNS =
  /(^id$|_id$|_ids$|number|address|postcode|reference|_text$|^raw|name$|_by$|_to$|title)/i;
const MAX_ENUM_VALUES = 24;
const TOP_SAMPLE = 10;

// Sampling bounds. Above ENUM_FULL_MAX_ROWS a full GROUP BY scan is replaced
// by TABLESAMPLE; above ENUM_SAMPLE_MAX_ROWS value enumeration is skipped
// entirely. reltuples can be stale — fine for a gate.
const SAMPLE_STATEMENT_TIMEOUT = "5s";
const ENUM_FULL_MAX_ROWS = 2_000_000;
const ENUM_SAMPLE_MAX_ROWS = 50_000_000;

function quoteIdent(s: string): string {
  return '"' + s.replace(/"/g, '""') + '"';
}

function isStatementTimeout(err: unknown): boolean {
  return (err as { code?: string })?.code === "57014";
}

/** 1234 -> "1,234"; 40_120_000 -> "~40M" — keeps huge numbers readable in the prompt. */
export function humanizeRowCount(n: number): string {
  if (n < 10_000) return n.toLocaleString("en-US");
  if (n < 1_000_000) return `~${Math.round(n / 1_000)}K`;
  if (n < 1_000_000_000) return `~${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0).replace(/\.0$/, "")}M`;
  return `~${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
}

const RELKIND_LABEL: Record<string, string> = {
  v: "view",
  m: "materialized view",
  f: "foreign table — federated (remote): queries cross the network; prefer aggregation before joining",
};

export async function introspectDatabase(client: Queryable): Promise<IntrospectResult> {
  const dbRes = await client.query("SELECT current_database() AS db");
  const databaseName = String(dbRes.rows[0]?.db ?? "");

  // Bound every sampling query below. This is OUR admin session, not guarded
  // panel SQL (the AST guard still rejects SET from the model). If the
  // server forbids it, sampling simply runs unbounded as before.
  let sampleCapActive = false;
  try {
    await client.query(`SET statement_timeout = '${SAMPLE_STATEMENT_TIMEOUT}'`);
    sampleCapActive = true;
  } catch {
    // continue without the cap
  }

  // pg_class (not information_schema) so child partitions are excluded
  // generically: partitioned parents ('p') are listed, their partitions not.
  const { rows: tables } = await client.query(
    `SELECT c.relname AS table_name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
     ORDER BY c.relname;`
  );

  let md = `# Schema Context\n\nGenerated: ${new Date().toISOString()}\n\n## Tables\n\n`;
  let valueNotes = "";
  const catalog: SqlCatalog = { tables: {} };
  const stats: IntrospectStats = {
    databaseName,
    tableCount: tables.length,
    totalApproxRows: 0,
    tables: [],
    dateRanges: [],
  };

  for (const row of tables) {
    const table_name = String(row.table_name);
    const cols = await client.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1
       ORDER BY ordinal_position;`,
      [table_name]
    );
    const pk = await client.query(
      `SELECT kcu.column_name FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema='public' AND tc.table_name=$1
       ORDER BY kcu.ordinal_position;`,
      [table_name]
    );
    const fks = await client.query(
      `SELECT kcu.column_name AS fk_column, ccu.table_name AS ref_table, ccu.column_name AS ref_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
       WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public' AND tc.table_name=$1;`,
      [table_name]
    );

    const statsRes = await client.query(
      `SELECT GREATEST(c.reltuples::bigint, s.n_live_tup)::bigint AS n
       FROM pg_class c
       JOIN pg_namespace ns ON ns.oid = c.relnamespace
       LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
       WHERE ns.nspname='public' AND c.relname=$1;`,
      [table_name]
    );
    const approx = Number(statsRes.rows[0]?.n ?? 0);

    catalog.tables[table_name] = cols.rows.map((c) => String(c.column_name));
    stats.tables.push({ name: table_name, approxRows: approx, columnCount: cols.rows.length });
    stats.totalApproxRows += Math.max(0, approx);

    md += `### ${table_name}\n\n`;
    md += `- Approximate row count: ${humanizeRowCount(Math.max(0, approx))}\n`;
    md += `- Primary key: (${pk.rows.map((r) => r.column_name).join(", ") || "none"})\n\n`;
    md += `| Column | Type | Nullable |\n|---|---|---|\n`;
    for (const c of cols.rows) {
      md += `| ${c.column_name} | ${c.data_type} | ${c.is_nullable} |\n`;
    }
    if (fks.rows.length) {
      md += `\nForeign keys:\n`;
      for (const fk of fks.rows) md += `- ${fk.fk_column} -> ${fk.ref_table}(${fk.ref_column})\n`;
    }
    md += `\n`;

    const qTable = quoteIdent(table_name);
    for (const c of cols.rows) {
      const name = String(c.column_name);
      const type = String(c.data_type);
      const qCol = quoteIdent(name);

      if (type === "date" || type.startsWith("timestamp")) {
        // Plain min/max is instant with an index; on timeout fall back to a
        // 1% block sample and mark the range approximate.
        let range: { lo: string; hi: string; approximate: boolean } | null = null;
        try {
          const r = await client.query(
            `SELECT min(${qCol})::text AS lo, max(${qCol})::text AS hi FROM ${qTable};`
          );
          if (r.rows[0]?.lo) {
            range = { lo: String(r.rows[0].lo), hi: String(r.rows[0].hi), approximate: false };
          }
        } catch (err) {
          if (!isStatementTimeout(err)) throw err;
          try {
            const r = await client.query(
              `SELECT min(${qCol})::text AS lo, max(${qCol})::text AS hi FROM ${qTable} TABLESAMPLE SYSTEM (1);`
            );
            if (r.rows[0]?.lo) {
              range = { lo: String(r.rows[0].lo), hi: String(r.rows[0].hi), approximate: true };
            }
          } catch {
            valueNotes += `- ${table_name}.${name}: (skipped — table too large to sample)\n`;
          }
        }
        if (range) {
          valueNotes += `- ${table_name}.${name}: ranges ${range.lo} .. ${range.hi}${
            range.approximate ? " (approximate — sampled)" : ""
          }\n`;
          stats.dateRanges.push({ column: `${table_name}.${name}`, from: range.lo, to: range.hi });
        }
        continue;
      }

      if (
        (type === "text" || type === "boolean" || type === "character varying") &&
        !SKIP_VALUE_COLUMNS.test(name)
      ) {
        if (approx > ENUM_SAMPLE_MAX_ROWS) {
          valueNotes += `- ${table_name}.${name}: (skipped — table too large to sample)\n`;
          continue;
        }
        const useSample = approx > ENUM_FULL_MAX_ROWS;
        const source = useSample ? `${qTable} TABLESAMPLE SYSTEM (1)` : qTable;
        let enumRows: { v: unknown }[];
        try {
          const r = await client.query(
            `SELECT ${qCol}::text AS v, count(*) AS n
             FROM ${source}
             WHERE ${qCol} IS NOT NULL
             GROUP BY 1 ORDER BY n DESC LIMIT ${MAX_ENUM_VALUES + 1};`
          );
          enumRows = r.rows as { v: unknown }[];
        } catch (err) {
          if (!isStatementTimeout(err) && !useSample) throw err;
          // TABLESAMPLE is unsupported on some relations (e.g. partitioned
          // parents on older PG); a timeout even under sampling means give up.
          valueNotes += `- ${table_name}.${name}: (skipped — table too large to sample)\n`;
          continue;
        }
        if (enumRows.length === 0) continue;
        const sampledNote = useSample ? "; sampled" : "";
        if (enumRows.length <= MAX_ENUM_VALUES) {
          valueNotes += `- ${table_name}.${name} (all values${sampledNote}): ${enumRows
            .map((x) => JSON.stringify(x.v))
            .join(", ")}\n`;
        } else {
          valueNotes += `- ${table_name}.${name} (high cardinality; most common${sampledNote}): ${enumRows
            .slice(0, TOP_SAMPLE)
            .map((x) => JSON.stringify(x.v))
            .join(", ")}, ...\n`;
        }
      }
    }
  }

  // Views, materialized views and foreign tables: queryable, so they enter
  // both the binding catalog AND the markdown with their real columns —
  // views are precisely what admins create to make big data queryable, so
  // the LLM must see them. (information_schema does not cover matviews;
  // pg_attribute covers all three relkinds.)
  const { rows: extraRels } = await client.query(
    `SELECT c.relname AS rel_name, c.relkind AS rel_kind,
            GREATEST(c.reltuples::bigint, 0) AS approx_rows,
            COALESCE(a.attname, '') AS col_name,
            COALESCE(format_type(a.atttypid, a.atttypmod), '') AS col_type
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm', 'f')
     ORDER BY c.relname, a.attnum;`
  );
  const extraByRel = new Map<string, { kind: string; approxRows: number; cols: { name: string; type: string }[] }>();
  for (const r of extraRels) {
    const rel = String(r.rel_name);
    let entry = extraByRel.get(rel);
    if (!entry) {
      entry = { kind: String(r.rel_kind), approxRows: Number(r.approx_rows ?? 0), cols: [] };
      extraByRel.set(rel, entry);
    }
    if (r.col_name) entry.cols.push({ name: String(r.col_name), type: String(r.col_type) });
  }

  if (extraByRel.size > 0) {
    md += `## Views and derived relations\n\nThese are queryable exactly like tables:\n\n`;
    for (const [rel, entry] of extraByRel) {
      if (!catalog.tables[rel]) catalog.tables[rel] = entry.cols.map((c) => c.name);
      md += `### ${rel} (${RELKIND_LABEL[entry.kind] ?? "relation"})\n\n`;
      if (entry.kind === "m") {
        md += `- Approximate row count: ${humanizeRowCount(entry.approxRows)}\n`;
      }
      md += `| Column | Type |\n|---|---|\n`;
      for (const c of entry.cols) md += `| ${c.name} | ${c.type} |\n`;
      md += `\n`;
    }
  }

  md += `## Column value reference\n\nDistinct values for low-cardinality columns, top values for high-cardinality ones, and date ranges:\n\n${valueNotes}`;

  if (sampleCapActive) {
    await client.query("SET statement_timeout = DEFAULT").catch(() => {});
  }

  return { markdown: md, catalog, stats };
}
