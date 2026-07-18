// Run: npx tsx scripts/test-prompt.ts
//
// Regression guard for the CamelCase-identifier class of bug: the dashboard
// engine relies on the LLM to double-quote case-sensitive identifiers. Against
// a CamelCase schema (e.g. Chinook's "Invoice"."Total"), unquoted identifiers
// are folded to lower-case by PostgreSQL and every first-pass query fails with
// `relation "invoice" does not exist`, forcing a repair round-trip. The fix
// lives in the prompt text, so these tests assert the quoting instruction is
// present in BOTH the generation and repair prompts. If someone removes it,
// this test fails loudly instead of the regression resurfacing silently.

// lib/openai imports lib/env (which requires these) and constructs an OpenAI
// client at import time; set dummy values so the pure prompt builders load.
// The dynamic import below must run AFTER these assignments, so everything is
// wrapped in an async IIFE (tsx's CJS transform also forbids top-level await).
process.env.OPENAI_API_KEY ||= "test-key-not-used";
process.env.DATABASE_URL_READONLY ||= "postgresql://user:pass@localhost:5432/db";

async function main() {
const { buildDashboardSystemPrompt, buildRepairSystemPrompt } = await import("../lib/openai");

// A deliberately CamelCase / mixed-case schema fixture — the exact shape that
// exposed the bug (Chinook-style quoted identifiers).
const camelCaseSchema = `# Schema Context

## Tables

### Invoice
| Column | Type | Nullable |
|---|---|---|
| InvoiceId | integer | NO |
| CustomerId | integer | NO |
| InvoiceDate | timestamp without time zone | NO |
| Total | numeric | NO |

### Customer
| Column | Type | Nullable |
|---|---|---|
| CustomerId | integer | NO |
| FirstName | character varying | NO |
| Country | character varying | YES |
`;

const dashboardPrompt = buildDashboardSystemPrompt({
  currentDate: "2026-07-18",
  schemaContext: camelCaseSchema,
});
const repairPrompt = buildRepairSystemPrompt(camelCaseSchema);

type Check = { name: string; pass: boolean };
const checks: Check[] = [];
const has = (haystack: string, needle: RegExp) => needle.test(haystack);

// --- The generation prompt must instruct identifier quoting ---
checks.push({
  name: "dashboard prompt mentions identifiers are case-sensitive",
  pass: has(dashboardPrompt, /case-sensitive/i),
});
checks.push({
  name: "dashboard prompt instructs double-quoting identifiers",
  pass: has(dashboardPrompt, /double quote/i),
});
checks.push({
  name: "dashboard prompt shows a quoted CamelCase example (\"Invoice\")",
  pass: dashboardPrompt.includes('"Invoice"'),
});
checks.push({
  name: "dashboard prompt embeds the CamelCase schema fixture",
  pass: dashboardPrompt.includes("InvoiceDate") && dashboardPrompt.includes("### Invoice"),
});

// --- The repair prompt must instruct identifier quoting too ---
checks.push({
  name: "repair prompt mentions identifiers are case-sensitive",
  pass: has(repairPrompt, /case-sensitive/i),
});
checks.push({
  name: "repair prompt instructs double-quoting identifiers",
  pass: has(repairPrompt, /double quote/i),
});
checks.push({
  name: "repair prompt links the lower-case folding symptom to unquoted identifiers",
  pass: has(repairPrompt, /does not exist/i) && has(repairPrompt, /lower-?case/i),
});

let failures = 0;
for (const c of checks) {
  if (c.pass) {
    console.log(`PASS ${c.name}`);
  } else {
    failures++;
    console.error(`FAIL ${c.name}`);
  }
}

process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};
