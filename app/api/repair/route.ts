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

