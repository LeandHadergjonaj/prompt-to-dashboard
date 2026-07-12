#!/usr/bin/env node
// Generic schema introspector: writes db/schema-context.md for the LLM prompt.
// Run: DATABASE_URL=... node scripts/introspect-schema.mjs
import { Client } from 'pg';
import { writeFileSync } from 'node:fs';

// Strip sslmode from the URL: it would override the ssl object below and
// force full chain verification, which fails on Supabase's pooler cert.
const connectionString = (process.env.DATABASE_URL ?? '')
  .replace(/([?&])sslmode=[^&]*&?/, '$1')
  .replace(/[?&]$/, '');

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

// Columns worth enumerating values for: text/boolean, excluding ids,
// free-text and identifier-ish names (kept out to keep the prompt compact).
const SKIP_VALUE_COLUMNS =
  /(^id$|_id$|_ids$|number|address|postcode|reference|uarn|rationale|_text$|^raw|name$|_by$|_to$|scat_code|title)/i;
const MAX_ENUM_VALUES = 24;
const TOP_SAMPLE = 10;

async function main() {
  await client.connect();

  const { rows: tables } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       AND table_name NOT LIKE 'payment\\_p%'
     ORDER BY table_name;`
  );

  let md = `# Schema Context\n\nGenerated: ${new Date().toISOString()}\n\n## Tables\n\n`;
  let valueNotes = '';

  for (const { table_name } of tables) {
    const cols = await client.query(
      `SELECT column_name, data_type, is_nullable
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

    const statsRes = await client.query(
      `SELECT GREATEST(c.reltuples::bigint, s.n_live_tup)::bigint AS n
       FROM pg_class c
       JOIN pg_namespace ns ON ns.oid = c.relnamespace
       LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
       WHERE ns.nspname='public' AND c.relname=$1;`, [table_name]
    );
    const approx = statsRes.rows[0]?.n ?? 0;

    md += `### ${table_name}\n\n`;
    md += `- Approximate row count: ${approx}\n`;
    md += `- Primary key: (${pk.rows.map(r => r.column_name).join(', ') || 'none'})\n\n`;
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
      const name = c.column_name;
      const type = c.data_type;

      if (type === 'date' || type.startsWith('timestamp')) {
        const r = await client.query(
          `SELECT min(${quoteIdent(name)})::text AS lo, max(${quoteIdent(name)})::text AS hi FROM ${quoteIdent(table_name)};`
        );
        if (r.rows[0]?.lo) {
          valueNotes += `- ${table_name}.${name}: ranges ${r.rows[0].lo} .. ${r.rows[0].hi}\n`;
        }
        continue;
      }

      if ((type === 'text' || type === 'boolean' || type === 'character varying') && !SKIP_VALUE_COLUMNS.test(name)) {
        const r = await client.query(
          `SELECT ${quoteIdent(name)}::text AS v, count(*) AS n
           FROM ${quoteIdent(table_name)}
           WHERE ${quoteIdent(name)} IS NOT NULL
           GROUP BY 1 ORDER BY n DESC LIMIT ${MAX_ENUM_VALUES + 1};`
        );
        if (r.rows.length === 0) continue;
        if (r.rows.length <= MAX_ENUM_VALUES) {
          valueNotes += `- ${table_name}.${name} (all values): ${r.rows.map(x => JSON.stringify(x.v)).join(', ')}\n`;
        } else {
          valueNotes += `- ${table_name}.${name} (high cardinality; most common): ${r.rows.slice(0, TOP_SAMPLE).map(x => JSON.stringify(x.v)).join(', ')}, ...\n`;
        }
      }
    }
  }

  md += `## Column value reference\n\nDistinct values for low-cardinality columns, top values for high-cardinality ones, and date ranges:\n\n${valueNotes}`;

  writeFileSync('db/schema-context.md', md);
  await client.end();
  console.log('Wrote db/schema-context.md');
}

function quoteIdent(s) {
  return '"' + s.replace(/"/g, '""') + '"';
}

main().catch(e => { console.error(e); process.exit(1); });
