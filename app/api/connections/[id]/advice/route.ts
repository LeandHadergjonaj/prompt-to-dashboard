import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/identity";
import { getExecutionContext, ConnectionError, ENV_CONNECTION_ID } from "@/lib/connections";
import { buildAdvisorReport } from "@/lib/advisor";
import { errorResponse, connectionErrorResponse } from "@/lib/apiErrors";
import { SchemaContextMissingError } from "@/lib/schemaContext";

type Params = { params: Promise<{ id: string }> };

// Performance advice for one connection, generated on demand from local
// telemetry. Suggestions are DDL for the user to run themselves as an admin
// — this app never executes them.
export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getCurrentUserId();
  const { id } = await params;

  let context;
  try {
    context = await getExecutionContext(userId, id === ENV_CONNECTION_ID ? null : id);
  } catch (err) {
    if (err instanceof ConnectionError || err instanceof SchemaContextMissingError) {
      return connectionErrorResponse(err);
    }
    throw err;
  }

  try {
    const advice = await buildAdvisorReport(userId, context.connectionKey, context.schemaContext);
    return NextResponse.json({ advice });
  } catch (err) {
    return errorResponse(
      500,
      "internal_error",
      "We couldn't build performance advice right now.",
      err instanceof Error ? err.message : String(err)
    );
  }
}
