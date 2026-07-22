// Run: npx tsx scripts/test-prompt.ts
//
// Prompt regression guards:
//  1. CamelCase-identifier quoting: against a CamelCase schema (Chinook's
//     "Invoice"."Total"), unquoted identifiers fold to lower-case and every
//     first-pass query fails. The fix lives in prompt text, so these tests
//     assert the quoting instruction is present in BOTH the generation and
//     repair prompts.
//  2. Multi-source assembly (PLAN4 Phase B): the static prompt explains the
//     one-panel-one-source contract, and each source message carries its
//     name, id, and schema — in a shape that keeps the prompt-cache prefix
//     stable per ordered source combination.
//  3. Timeout-aware repair (PLAN4 A.2): the timeout branch instructs
//     do-less-work rewrites, not identifier-quoting boilerplate only.

// lib/openai imports lib/env (which requires these) and constructs an OpenAI
// client at import time; set dummy values so the pure prompt builders load.
// The dynamic import below must run AFTER these assignments, so everything is
// wrapped in an async IIFE (tsx's CJS transform also forbids top-level await).
process.env.OPENAI_API_KEY ||= "test-key-not-used";
process.env.DATABASE_URL_READONLY ||= "postgresql://user:pass@localhost:5432/db";

async function main() {
const { buildDashboardSystemPrompt, buildRepairSystemPrompt, buildSourceMessage } = await import(
  "../lib/openai"
);

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

const dashboardPrompt = buildDashboardSystemPrompt({ currentDate: "2026-07-18" });
const sourceMessage = buildSourceMessage({
  id: "conn-a",
  name: "Chinook",
  schemaContext: camelCaseSchema,
});
const repairPrompt = buildRepairSystemPrompt(camelCaseSchema);
const timeoutRepairPrompt = buildRepairSystemPrompt(camelCaseSchema, true);

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
  name: 'dashboard prompt shows a quoted CamelCase example ("Invoice")',
  pass: dashboardPrompt.includes('"Invoice"'),
});

// --- Multi-source contract (Phase B) ---
checks.push({
  name: "dashboard prompt states one panel queries exactly one source",
  pass: has(dashboardPrompt, /exactly ONE source/i),
});
checks.push({
  name: "dashboard prompt explains the sourceId field",
  pass: has(dashboardPrompt, /sourceId/),
});
checks.push({
  name: "dashboard prompt forbids cross-source queries in a single panel",
  pass: has(dashboardPrompt, /never mix tables from different sources/i),
});
checks.push({
  name: "dashboard prompt prefers the primary (first) source",
  pass: has(dashboardPrompt, /FIRST listed source/i),
});
checks.push({
  name: "dashboard prompt warns about millions-of-rows tables (A.1)",
  pass: has(dashboardPrompt, /millions/i) && has(dashboardPrompt, /aggregates and date filters/i),
});
checks.push({
  name: "static prompt does not embed any schema (cache-stable prefix)",
  pass: !dashboardPrompt.includes("### Invoice") && !dashboardPrompt.includes("| InvoiceId |"),
});
checks.push({
  name: "source message carries name, id, and the schema",
  pass:
    sourceMessage.includes('## Source "Chinook" (id: conn-a)') &&
    sourceMessage.includes("InvoiceDate") &&
    sourceMessage.includes('sourceId "conn-a"'),
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

// --- Timeout-aware repair branch (A.2) ---
checks.push({
  name: "timeout repair prompt states the query exceeded its time budget",
  pass: has(timeoutRepairPrompt, /time budget/i),
});
checks.push({
  name: "timeout repair prompt instructs pre-aggregation / narrower date filters",
  pass: has(timeoutRepairPrompt, /pre-aggregate/i) && has(timeoutRepairPrompt, /date filter/i),
});
checks.push({
  name: "timeout repair prompt warns resubmitting will time out again",
  pass: has(timeoutRepairPrompt, /time out again/i),
});
checks.push({
  name: "timeout branch differs from the plain error branch",
  pass: timeoutRepairPrompt !== repairPrompt && !has(repairPrompt, /CANCELLED FOR EXCEEDING/),
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
