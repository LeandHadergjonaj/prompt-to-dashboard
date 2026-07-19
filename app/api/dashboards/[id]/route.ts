import { NextRequest, NextResponse } from "next/server";
import { RenameDashboardRequestSchema } from "@/lib/types";
import { getCurrentUserId } from "@/lib/identity";
import { deleteDashboard, getDashboard, renameDashboard } from "@/lib/dashboards";
import { errorResponse } from "@/lib/apiErrors";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getCurrentUserId();
  const { id } = await params;
  const dashboard = getDashboard(userId, id);
  if (!dashboard) {
    return errorResponse(404, "not_found", "That saved dashboard no longer exists.", null);
  }
  return NextResponse.json({ dashboard });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getCurrentUserId();
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "invalid_request", "That request wasn't valid.", null);
  }
  const parsed = RenameDashboardRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, "invalid_request", "Give the dashboard a name up to 120 characters.", parsed.error.message);
  }

  if (!renameDashboard(userId, id, parsed.data.title)) {
    return errorResponse(404, "not_found", "That saved dashboard no longer exists.", null);
  }
  return NextResponse.json({ dashboard: getDashboard(userId, id) });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const userId = await getCurrentUserId();
  const { id } = await params;
  if (!deleteDashboard(userId, id)) {
    return errorResponse(404, "not_found", "That saved dashboard no longer exists.", null);
  }
  return NextResponse.json({ ok: true });
}
