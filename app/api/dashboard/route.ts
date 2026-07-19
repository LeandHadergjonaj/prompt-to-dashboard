import { NextRequest, NextResponse } from "next/server";
import {
  DashboardRequestSchema,
  type DashboardResponse,
  type PanelWithId,
} from "@/lib/types";
import { generateDashboardSpec, type FewShotExample } from "@/lib/openai";
import { checkSql } from "@/lib/sqlGuard";
import { getCurrentUserId } from "@/lib/identity";
import { getExecutionContext, ConnectionError } from "@/lib/connections";
import { retrieveExamples } from "@/lib/examples";
import { errorResponse, connectionErrorResponse } from "@/lib/apiErrors";
import { SchemaContextMissingError } from "@/lib/schemaContext";

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

  let context;
  try {
    context = await getExecutionContext(userId, parsed.data.connectionId);
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

  // Few-shot retrieval from previously accepted pairs; never blocks generation.
  let examples: FewShotExample[] = [];
  try {
    examples = await retrieveExamples(userId, context.connectionKey, parsed.data.question);
  } catch {
    examples = [];
  }

  let spec;
  try {
    spec = await generateDashboardSpec({
      question: parsed.data.question,
      currentDate,
      schemaContext: context.schemaContext,
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

  const guardResults = await Promise.all(
    spec.panels.map((panel) => checkSql(panel.sql, context.catalog))
  );
  const panelsWithIds: PanelWithId[] = spec.panels
    .filter((_, i) => guardResults[i].ok)
    .slice(0, 6)
    .map((panel, i) => ({
      ...panel,
      xField: clean(panel.xField),
      seriesField: clean(panel.seriesField),
      labelField: clean(panel.labelField),
      valueField: clean(panel.valueField),
      comparison: clean(panel.comparison),
      yFields: panel.yFields?.filter((f) => clean(f) !== null) ?? null,
      id: `panel-${i}`,
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
