import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import {
  RepairRequestSchema,
  type ApiErrorBody,
  type RepairResponse,
} from "@/lib/types";
import { repairSql } from "@/lib/openai";
import { checkSql } from "@/lib/sqlGuard";

const SCHEMA_CONTEXT = fs.readFileSync(
  path.join(process.cwd(), "db", "schema-context.md"),
  "utf-8"
);

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

  let repairedSql: string;
  try {
    repairedSql = await repairSql({
      question: parsed.data.question,
      panel: parsed.data.panel,
      sql: parsed.data.sql,
      errorMessage: parsed.data.errorMessage,
      schemaContext: SCHEMA_CONTEXT,
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
