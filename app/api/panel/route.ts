import { NextRequest, NextResponse } from "next/server";
import { PanelRequestSchema, type PanelResponse } from "@/lib/types";
import { checkSql } from "@/lib/sqlGuard";
import { executePanelQuery, explainQueryCost } from "@/lib/db";
import { getCurrentUserId } from "@/lib/identity";
import { getExecutionContext, ConnectionError } from "@/lib/connections";
import { errorResponse, connectionErrorResponse } from "@/lib/apiErrors";
import { SchemaContextMissingError } from "@/lib/schemaContext";
import { recordPanelRun } from "@/lib/telemetry";

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "invalid_request", "That request wasn't valid.", null);
  }

  const parsed = PanelRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, "invalid_request", "That chart request wasn't valid.", parsed.error.message);
  }

  let context;
  try {
    context = await getExecutionContext(userId, parsed.data.connectionId);
  } catch (err) {
    if (err instanceof ConnectionError || err instanceof SchemaContextMissingError) {
      return connectionErrorResponse(err);
    }
    throw err;
  }

  const guard = await checkSql(parsed.data.sql, context.catalog);
  if (!guard.ok) {
    recordPanelRun({
      userId,
      connectionKey: context.connectionKey,
      sql: parsed.data.sql,
      durationMs: 0,
      rowCount: null,
      outcome: "rejected",
      errorCode: null,
      totalCost: null,
    });
    return errorResponse(
      400,
      "sql_rejected",
      "This chart's query isn't a supported read-only query and can't be run.",
      guard.reason
    );
  }

  const maxRows = context.settings.maxResultRows;

  // Cost guard stage 1 (warn-only): record the planner estimate alongside
  // the outcome so per-connection (cost, duration, outcome) history
  // accumulates. No action is taken on it yet — cost units are not portable
  // across databases.
  const totalCost = await explainQueryCost(context.pool, guard.sanitizedSql!, maxRows);

  const started = performance.now();
  try {
    const result = await executePanelQuery(context.pool, guard.sanitizedSql!, maxRows);
    recordPanelRun({
      userId,
      connectionKey: context.connectionKey,
      sql: guard.sanitizedSql!,
      durationMs: performance.now() - started,
      rowCount: result.rows.length,
      outcome: "ok",
      errorCode: null,
      totalCost,
    });
    const responseBody: PanelResponse = result;
    return NextResponse.json(responseBody, { status: 200 });
  } catch (err) {
    const pgCode = (err as { code?: string })?.code;
    const debug = err instanceof Error ? err.message : String(err);
    recordPanelRun({
      userId,
      connectionKey: context.connectionKey,
      sql: guard.sanitizedSql!,
      durationMs: performance.now() - started,
      rowCount: null,
      outcome: pgCode === "57014" ? "timeout" : "error",
      errorCode: pgCode ?? null,
      totalCost,
    });

    if (pgCode === "57014") {
      return errorResponse(
        504,
        "query_timeout",
        "That query took too long to run and was cancelled. Try narrowing the date range or asking a simpler question.",
        debug
      );
    }

    return errorResponse(
      500,
      "query_failed",
      "Something went wrong running that chart's query.",
      debug
    );
  }
}
