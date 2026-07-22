import { listPanelRuns } from "./telemetry";
import { generateAdviceSuggestions, type AdviceSuggestion } from "./openai";

// Performance advisor (read-only, suggestions only). Aggregates a
// connection's panel-run telemetry into per-table timeout/duration stats,
// asks the LLM for 2-4 concrete admin actions (index / matview / ANALYZE),
// and degrades to a deterministic top-timeout-tables hint if that call
// fails. Nothing here ever executes anything against the user's database.

export interface AdvisorTableStat {
  table: string;
  runs: number;
  timeouts: number;
  avgDurationMs: number;
  maxDurationMs: number;
}

export interface AdvisorReport {
  totalRuns: number;
  okRuns: number;
  timeouts: number;
  errors: number;
  avgDurationMs: number;
  tables: AdvisorTableStat[];
  suggestions: AdviceSuggestion[];
  /** 'llm' | 'fallback' | 'none' (not enough data) */
  source: "llm" | "fallback" | "none";
}

// Tables are extracted with the guard's parser (libpg-query), never regexes.
// CTE names are excluded the same way the guard excludes them from binding.
async function extractTables(sql: string): Promise<string[]> {
  try {
    const libpgQuery = await import("libpg-query");
    const parsed = (await libpgQuery.parse(sql)) as unknown;
    const ctes = new Set<string>();
    const tables = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node === null || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      if (typeof obj.ctename === "string" && obj.ctequery !== undefined) ctes.add(obj.ctename);
      for (const [key, value] of Object.entries(obj)) {
        if (key === "RangeVar") {
          const rv = value as { relname?: string };
          if (rv.relname) tables.add(rv.relname);
        }
        walk(value);
      }
    };
    walk(parsed);
    return [...tables].filter((t) => !ctes.has(t));
  } catch {
    return [];
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export async function buildAdvisorReport(
  userId: string,
  connectionKey: string,
  schemaContext: string
): Promise<AdvisorReport> {
  const runs = listPanelRuns(userId, connectionKey, 500);
  const executed = runs.filter((r) => r.outcome !== "rejected");

  const base = {
    totalRuns: executed.length,
    okRuns: executed.filter((r) => r.outcome === "ok").length,
    timeouts: executed.filter((r) => r.outcome === "timeout").length,
    errors: executed.filter((r) => r.outcome === "error").length,
    avgDurationMs: executed.length
      ? round(executed.reduce((s, r) => s + r.durationMs, 0) / executed.length)
      : 0,
  };

  if (executed.length === 0) {
    return { ...base, tables: [], suggestions: [], source: "none" };
  }

  // Per-table stats via parsed SQL (deduped per distinct statement).
  const tableStats = new Map<string, AdvisorTableStat>();
  const tablesBySql = new Map<string, string[]>();
  for (const run of executed) {
    let tables = tablesBySql.get(run.sql);
    if (!tables) {
      tables = await extractTables(run.sql);
      tablesBySql.set(run.sql, tables);
    }
    for (const table of tables) {
      const stat =
        tableStats.get(table) ??
        ({ table, runs: 0, timeouts: 0, avgDurationMs: 0, maxDurationMs: 0 } as AdvisorTableStat);
      stat.runs += 1;
      if (run.outcome === "timeout") stat.timeouts += 1;
      stat.avgDurationMs += run.durationMs; // sum for now; divided below
      stat.maxDurationMs = Math.max(stat.maxDurationMs, run.durationMs);
      tableStats.set(table, stat);
    }
  }
  const tables = [...tableStats.values()]
    .map((s) => ({ ...s, avgDurationMs: round(s.avgDurationMs / s.runs) }))
    .sort((a, b) => b.timeouts - a.timeouts || b.avgDurationMs - a.avgDurationMs);

  // Slowest recurring SQL shapes (whitespace-normalized) for the LLM.
  const shapeStats = new Map<string, { sql: string; runs: number; avgDurationMs: number; timeouts: number }>();
  for (const run of executed) {
    const shape = run.sql.replace(/\s+/g, " ").trim();
    const s = shapeStats.get(shape) ?? { sql: shape, runs: 0, avgDurationMs: 0, timeouts: 0 };
    s.runs += 1;
    s.avgDurationMs += run.durationMs;
    if (run.outcome === "timeout") s.timeouts += 1;
    shapeStats.set(shape, s);
  }
  const slowestShapes = [...shapeStats.values()]
    .map((s) => ({ ...s, avgDurationMs: round(s.avgDurationMs / s.runs) }))
    .sort((a, b) => b.timeouts - a.timeouts || b.avgDurationMs - a.avgDurationMs)
    .slice(0, 5);

  let suggestions: AdviceSuggestion[];
  let source: AdvisorReport["source"];
  try {
    suggestions = await generateAdviceSuggestions({
      aggregates: { ...base, tables: tables.slice(0, 10), slowestShapes },
      schemaContext,
    });
    source = "llm";
  } catch {
    suggestions = fallbackSuggestions(tables);
    source = "fallback";
  }

  return { ...base, tables, suggestions, source };
}

function fallbackSuggestions(tables: AdvisorTableStat[]): AdviceSuggestion[] {
  return tables
    .filter((t) => t.timeouts > 0)
    .slice(0, 3)
    .map((t) => ({
      title: `Queries on "${t.table}" keep timing out`,
      ddl: null,
      rationale:
        `${t.timeouts} of ${t.runs} recent queries touching "${t.table}" hit the time budget ` +
        `(avg ${Math.round(t.avgDurationMs)} ms). An index on its most-filtered date or join column, ` +
        `or a pre-aggregated materialized view, usually fixes this — run it yourself as an admin; ` +
        `this app never modifies your database.`,
    }));
}
