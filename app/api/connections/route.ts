import { NextRequest, NextResponse } from "next/server";
import { CreateConnectionRequestSchema } from "@/lib/types";
import { getCurrentUserId } from "@/lib/identity";
import {
  ConnectionError,
  hasEnvConnection,
  listConnections,
  onboardConnection,
} from "@/lib/connections";
import { generateConnectionSummary } from "@/lib/openai";
import { errorResponse, connectionErrorResponse } from "@/lib/apiErrors";

export async function GET() {
  const userId = await getCurrentUserId();
  return NextResponse.json({
    connections: listConnections(userId),
    envConnection: hasEnvConnection(),
  });
}

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "invalid_request", "That request wasn't valid.", null);
  }
  const parsed = CreateConnectionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "invalid_request",
      "Give the connection a name and paste the database connection string.",
      parsed.error.message
    );
  }

  try {
    const { connection } = await onboardConnection({
      userId,
      name: parsed.data.name,
      adminUrl: parsed.data.adminUrl,
      summarize: generateConnectionSummary,
    });
    return NextResponse.json({ connection }, { status: 201 });
  } catch (err) {
    if (err instanceof ConnectionError) return connectionErrorResponse(err);
    return errorResponse(
      500,
      "internal_error",
      "Something went wrong while connecting your database.",
      err instanceof Error ? err.message : String(err)
    );
  }
}
