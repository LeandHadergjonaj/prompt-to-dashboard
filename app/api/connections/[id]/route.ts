import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/identity";
import {
  deleteConnection,
  getConnectionSummary,
  getConnectionSettings,
  updateConnectionSettings,
  hasEnvConnection,
  ENV_CONNECTION_ID,
} from "@/lib/connections";
import { UpdateConnectionRequestSchema } from "@/lib/types";
import { errorResponse } from "@/lib/apiErrors";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getCurrentUserId();
  const { id } = await params;
  const connection = getConnectionSummary(userId, id);
  if (!connection) {
    return errorResponse(404, "not_found", "That database connection no longer exists.", null);
  }
  return NextResponse.json({ connection, settings: getConnectionSettings(id) });
}

// Per-connection execution settings. The 'env' sentinel is a valid target so
// the built-in connection can be tuned too.
export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getCurrentUserId();
  const { id } = await params;

  if (id === ENV_CONNECTION_ID) {
    if (!hasEnvConnection()) {
      return errorResponse(404, "not_found", "There is no built-in connection configured.", null);
    }
  } else if (!getConnectionSummary(userId, id)) {
    return errorResponse(404, "not_found", "That database connection no longer exists.", null);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "invalid_request", "That request wasn't valid.", null);
  }
  const parsed = UpdateConnectionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, "invalid_request", "Those settings aren't valid.", parsed.error.message);
  }

  const settings = updateConnectionSettings(id, parsed.data.settings);
  return NextResponse.json({ settings });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const userId = await getCurrentUserId();
  const { id } = await params;
  const deleted = deleteConnection(userId, id);
  if (!deleted) {
    return errorResponse(404, "not_found", "That database connection no longer exists.", null);
  }
  return NextResponse.json({ ok: true });
}
