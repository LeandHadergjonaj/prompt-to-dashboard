import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/identity";
import { deleteConnection, getConnectionSummary } from "@/lib/connections";
import { errorResponse } from "@/lib/apiErrors";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getCurrentUserId();
  const { id } = await params;
  const connection = getConnectionSummary(userId, id);
  if (!connection) {
    return errorResponse(404, "not_found", "That database connection no longer exists.", null);
  }
  return NextResponse.json({ connection });
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
