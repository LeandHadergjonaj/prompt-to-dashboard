import { NextRequest, NextResponse } from "next/server";
import {
  DashboardRequestSchema,
  type ApiErrorBody,
  type DashboardResponse,
  type PanelWithId,
} from "@/lib/types";
import { generateDashboardSpec } from "@/lib/openai";
import { checkSql } from "@/lib/sqlGuard";
import { getSchemaContext } from "@/lib/schemaContext";

function errorResponse(
  status: number,
  code: ApiErrorBody["error"]["code"],
  friendlyMessage: string,
  debug: string | null
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, friendlyMessage, debug } }, { status });
}

export async function POST(req: NextRequest) {
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

  let schemaContext: string;
  try {
    schemaContext = getSchemaContext();
  } catch (err) {
    return errorResponse(
      500,
      "internal_error",
      "This app isn't connected to a database schema yet. Ask whoever runs it to generate the schema context.",
      err instanceof Error ? err.message : String(err)
    );
  }

  let spec;
  try {
    spec = await generateDashboardSpec({
      question: parsed.data.question,
      currentDate,
      schemaContext,
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

  const panelsWithIds: PanelWithId[] = spec.panels
    .filter((panel) => checkSql(panel.sql).ok)
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
      "model returned zero panels with guard-passing SQL"
    );
  }

  const responseBody: DashboardResponse = {
    spec: { title: spec.title, summary: spec.summary, panels: panelsWithIds },
  };
  return NextResponse.json(responseBody, { status: 200 });
}
