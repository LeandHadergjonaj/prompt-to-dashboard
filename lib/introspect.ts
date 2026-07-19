import type { SqlCatalog } from "./sqlGuard";

// Generic schema introspection for any PostgreSQL-compatible database.
// Produces three views of the same walk:
//  - markdown: the LLM schema context (same format db/schema-context.md uses)
//  - catalog:  table -> columns, for AST identifier binding
//  - stats:    friendly numbers for the plain-English onboarding summary

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

function quoteIdent(s: string): string {
  return '"' + s.replace(/"/g, '""') + '"';
}

export async function introspectDatabase(client: Queryable): Promise<IntrospectResult> {
  const dbRes = await client.query("SELECT current_database() AS db");
  const databaseName = String(dbRes.rows[0]?.db ?? "");

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
    md += `- Approximate row count: ${approx}\n`;
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

    for (const c of cols.rows) {
      const name = String(c.column_name);
      const type = String(c.data_type);

      if (type === "date" || type.startsWith("timestamp")) {
        const r = await client.query(
          `SELECT min(${quoteIdent(name)})::text AS lo, max(${quoteIdent(name)})::text AS hi FROM ${quoteIdent(table_name)};`
        );
        if (r.rows[0]?.lo) {
          const lo = String(r.rows[0].lo);
          const hi = String(r.rows[0].hi);
          valueNotes += `- ${table_name}.${name}: ranges ${lo} .. ${hi}\n`;
          stats.dateRanges.push({ column: `${table_name}.${name}`, from: lo, to: hi });
        }
        continue;
      }

      if (
        (type === "text" || type === "boolean" || type === "character varying") &&
        !SKIP_VALUE_COLUMNS.test(name)
      ) {
        const r = await client.query(
          `SELECT ${quoteIdent(name)}::text AS v, count(*) AS n
           FROM ${quoteIdent(table_name)}
           WHERE ${quoteIdent(name)} IS NOT NULL
           GROUP BY 1 ORDER BY n DESC LIMIT ${MAX_ENUM_VALUES + 1};`
        );
        if (r.rows.length === 0) continue;
        if (r.rows.length <= MAX_ENUM_VALUES) {
          valueNotes += `- ${table_name}.${name} (all values): ${r.rows.map((x) => JSON.stringify(x.v)).join(", ")}\n`;
        } else {
          valueNotes += `- ${table_name}.${name} (high cardinality; most common): ${r.rows
            .slice(0, TOP_SAMPLE)
            .map((x) => JSON.stringify(x.v))
            .join(", ")}, ...\n`;
        }
      }
    }
  }

  md += `## Column value reference\n\nDistinct values for low-cardinality columns, top values for high-cardinality ones, and date ranges:\n\n${valueNotes}`;

  // Binding catalog also admits views/materialized views/foreign tables:
  // they are queryable even though the markdown documents plain tables only,
  // so the guard must never reject them as "unknown".
  const { rows: extraRels } = await client.query(
    `SELECT c.relname AS rel_name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm', 'f');`
  );
  for (const r of extraRels) {
    const rel = String(r.rel_name);
    if (!catalog.tables[rel]) catalog.tables[rel] = [];
  }

  return { markdown: md, catalog, stats };
}
