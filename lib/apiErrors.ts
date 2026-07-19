import { NextResponse } from "next/server";
import { ConnectionError } from "./connections";
import type { ApiErrorBody } from "./types";

export function errorResponse(
  status: number,
  code: ApiErrorBody["error"]["code"],
  friendlyMessage: string,
  debug: string | null
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, friendlyMessage, debug } }, { status });
}

/** Map a thrown ConnectionError (or anything else) to a response. */
export function connectionErrorResponse(err: unknown): NextResponse<ApiErrorBody> {
  if (err instanceof ConnectionError) {
    return errorResponse(
      err.status,
      err.status === 404 ? "not_found" : "connection_failed",
      err.friendlyMessage,
      err.message
    );
  }
  return errorResponse(
    500,
    "internal_error",
    "Something went wrong on our end.",
    err instanceof Error ? err.message : String(err)
  );
}
