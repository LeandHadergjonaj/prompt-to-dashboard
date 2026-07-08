import { NextRequest, NextResponse } from "next/server";
import { PanelRequestSchema, type ApiErrorBody, type PanelResponse } from "@/lib/types";
import { checkSql } from "@/lib/sqlGuard";
import { executePanelQuery } from "@/lib/db";

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

  const parsed = PanelRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, "invalid_request", "That chart request wasn't valid.", parsed.error.message);
  }

