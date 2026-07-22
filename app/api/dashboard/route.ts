import { NextRequest, NextResponse } from "next/server";
import {
  DashboardRequestSchema,
  type DashboardResponse,
  type PanelWithId,
} from "@/lib/types";
import { generateDashboardSpec, type DashboardSource, type FewShotExample } from "@/lib/openai";
import { checkSql, type SqlCatalog } from "@/lib/sqlGuard";
import { getCurrentUserId } from "@/lib/identity";
import {
  getExecutionContext,
  getConnectionSummary,
  ConnectionError,
  ENV_CONNECTION_ID,
  type ExecutionContext,
} from "@/lib/connections";
import { retrieveExamples } from "@/lib/examples";
import { errorResponse, connectionErrorResponse } from "@/lib/apiErrors";
import { SchemaContextMissingError } from "@/lib/schemaContext";

const MAX_TOTAL_EXAMPLES = 6;

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "invalid_request", "That request wasn't valid.", null);
  }

  const parsed = DashboardRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "invalid_request",
      "Please enter a question between 1 and 500 characters.",
      parsed.error.message
    );
  }

  const currentDate = new Date().toISOString().slice(0, 10);

  // Every source this dashboard may draw from, primary FIRST. The rest is
  // sorted lexicographically so the prompt-cache prefix is stable per
  // combination regardless of UI ordering accidents.
  const primary = parsed.data.connectionIds?.[0] ?? parsed.data.connectionId ?? ENV_CONNECTION_ID;
  const rest = (parsed.data.connectionIds ?? [])
    .slice(1)
    .filter((id, i, a) => id !== primary && a.indexOf(id) === i)
    .sort();
  const sourceIds = [primary, ...rest];

  // Resolve (and thereby ownership-validate) every source before generation.
  const contexts = new Map<string, ExecutionContext>();
  const sources: DashboardSource[] = [];
  for (const id of sourceIds) {
    try {
      const context = await getExecutionContext(userId, id === ENV_CONNECTION_ID ? null : id);
      contexts.set(id, context);
      const name =
        id === ENV_CONNECTION_ID
          ? "Built-in data"
          : getConnectionSummary(userId, id)?.name ?? id;
      sources.push({ id, name, schemaContext: context.schemaContext });
    } catch (err) {
      if (err instanceof SchemaContextMissingError) {
        return errorResponse(
          500,
          "internal_error",
          "This app isn't connected to a database schema yet. Ask whoever runs it to generate the schema context.",
          err.message
        );
      }
      if (err instanceof ConnectionError) return connectionErrorResponse(err);
      throw err;
    }
  }

  // Few-shot retrieval per source (labeled when several sources are in
  // play), interleaved so no single source monopolizes the budget. Never
  // blocks generation.
  let examples: FewShotExample[] = [];
  try {
    const perSource = await Promise.all(
      sources.map(async (s) => {
        const found = await retrieveExamples(
          userId,
          contexts.get(s.id)!.connectionKey,
          parsed.data.question
        );
        return found.map((e) => ({ ...e, sourceName: sources.length > 1 ? s.name : undefined }));
      })
    );
    for (let i = 0; examples.length < MAX_TOTAL_EXAMPLES; i++) {
      const round = perSource.map((list) => list[i]).filter(Boolean);
      if (round.length === 0) break;
      examples.push(...round.slice(0, MAX_TOTAL_EXAMPLES - examples.length));
    }
  } catch {
    examples = [];
  }

  let spec;
  try {
    spec = await generateDashboardSpec({
      question: parsed.data.question,
      currentDate,
      sources,
      history: parsed.data.history,
      examples,
    });
  } catch (err) {
    const debug = err instanceof Error ? err.message : String(err);
    return errorResponse(
      502,
      "llm_error",
      "The assistant is having trouble right now. Please try again in a moment.",
      debug
    );
  }

  // Some models fill unused nullable fields with junk strings ("/dev/null",
  // "null", "") instead of JSON null — normalize before the frontend sees them.
  const junk = new Set(["/dev/null", "null", "none", ""]);
  const clean = (v: string | null) => (v !== null && junk.has(v.trim().toLowerCase()) ? null : v);

  // An invalid sourceId degrades to the primary source; the guard then binds
  // the SQL against that source's catalog, so a hallucinated cross-source
  // table reference fails as "unknown table" exactly like any other.
  const effectiveSourceIds = spec.panels.map((panel) =>
    contexts.has(panel.sourceId) ? panel.sourceId : sourceIds[0]
  );
  const guardResults = await Promise.all(
    spec.panels.map((panel, i) => {
      const catalog: SqlCatalog | null = contexts.get(effectiveSourceIds[i])!.catalog;
      return checkSql(panel.sql, catalog);
    })
  );
  const panelsWithIds: PanelWithId[] = spec.panels
    .map((panel, i) => ({ panel, sourceId: effectiveSourceIds[i], ok: guardResults[i].ok }))
    .filter((entry) => entry.ok)
    .slice(0, 6)
    .map(({ panel, sourceId }, i) => ({
      title: panel.title,
      description: panel.description,
      chartType: panel.chartType,
      sql: panel.sql,
      xField: clean(panel.xField),
      yFields: panel.yFields?.filter((f) => clean(f) !== null) ?? null,
      seriesField: clean(panel.seriesField),
      labelField: clean(panel.labelField),
      valueField: clean(panel.valueField),
      unit: panel.unit,
      comparison: clean(panel.comparison),
      id: `panel-${i}`,
      connectionId: sourceId,
    }));

  if (panelsWithIds.length === 0) {
    return errorResponse(
      502,
      "llm_error",
      "The assistant couldn't design a dashboard for that question. Try rephrasing it or being more specific.",
      `model returned zero panels with guard-passing SQL (first rejection: ${
        guardResults.find((r) => !r.ok)?.reason ?? "none"
      })`
    );
  }

  // A first-turn request can only ever be a fresh dashboard, whatever the model says.
  const mode = parsed.data.history.length === 0 ? "new" : spec.mode;
  const responseBody: DashboardResponse = {
    spec: { mode, title: spec.title, summary: spec.summary, panels: panelsWithIds },
  };
  return NextResponse.json(responseBody, { status: 200 });
}
