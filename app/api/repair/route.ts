import { NextRequest, NextResponse } from "next/server";
import { RepairRequestSchema, type RepairResponse } from "@/lib/types";
import { repairSql } from "@/lib/openai";
import { checkSql } from "@/lib/sqlGuard";
import { getCurrentUserId } from "@/lib/identity";
import { getExecutionContext, ConnectionError } from "@/lib/connections";
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

  const parsed = RepairRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, "invalid_request", "That repair request wasn't valid.", parsed.error.message);
  }

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

  // Structured code from the client is authoritative; the message signature
  // is the fallback for clients that don't send it.
  const timedOut =
    parsed.data.errorCode === "query_timeout" ||
    /canceling statement due to statement timeout/i.test(parsed.data.errorMessage);

  let repairedSql: string;
  try {
    repairedSql = await repairSql({
      question: parsed.data.question,
      panel: parsed.data.panel,
      sql: parsed.data.sql,
      errorMessage: parsed.data.errorMessage,
      schemaContext: context.schemaContext,
      timedOut,
    });
  } catch (err) {
    const debug = err instanceof Error ? err.message : String(err);
    return errorResponse(
      502,
      "llm_error",
      "The assistant couldn't fix this chart's query. Try adjusting your original question instead.",
      debug
    );
  }

  const guard = await checkSql(repairedSql, context.catalog);
  if (!guard.ok) {
    return errorResponse(
      502,
      "llm_error",
      "The assistant couldn't fix this chart's query. Try adjusting your original question instead.",
      `repaired sql failed sqlGuard: ${guard.reason}`
    );
  }

  const responseBody: RepairResponse = { sql: guard.sanitizedSql! };
  return NextResponse.json(responseBody, { status: 200 });
}
