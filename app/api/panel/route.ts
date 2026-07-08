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

  const guard = checkSql(parsed.data.sql);
  if (!guard.ok) {
    return errorResponse(
      400,
      "sql_rejected",
      "This chart's query isn't a supported read-only query and can't be run.",
      guard.reason
    );
  }

  try {
    const result = await executePanelQuery(guard.sanitizedSql!);
    const responseBody: PanelResponse = result;
    return NextResponse.json(responseBody, { status: 200 });
  } catch (err) {
    const pgCode = (err as { code?: string })?.code;
    const debug = err instanceof Error ? err.message : String(err);

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
