import { NextRequest, NextResponse } from "next/server";
import {
  RepairRequestSchema,
  type ApiErrorBody,
  type RepairResponse,
} from "@/lib/types";
import { repairSql } from "@/lib/openai";
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

  const parsed = RepairRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, "invalid_request", "That repair request wasn't valid.", parsed.error.message);
  }

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

  let repairedSql: string;
  try {
    repairedSql = await repairSql({
      question: parsed.data.question,
      panel: parsed.data.panel,
      sql: parsed.data.sql,
      errorMessage: parsed.data.errorMessage,
      schemaContext,
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

  const guard = checkSql(repairedSql);
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
