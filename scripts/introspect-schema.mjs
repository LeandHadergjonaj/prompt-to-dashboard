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

