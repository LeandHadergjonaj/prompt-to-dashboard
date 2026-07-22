import { NextRequest, NextResponse } from "next/server";
import { UpdateDashboardRequestSchema } from "@/lib/types";
import { getCurrentUserId } from "@/lib/identity";
import { deleteDashboard, getDashboard, updateDashboard } from "@/lib/dashboards";
import { ENV_CONNECTION_ID, getConnectionSummary, hasEnvConnection } from "@/lib/connections";
import { capturePanelExamples } from "@/lib/examples";
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
  const parsed = UpdateDashboardRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, "invalid_request", "That update request wasn't valid.", parsed.error.message);
  }

  const existing = getDashboard(userId, id);
  if (!existing) {
    return errorResponse(404, "not_found", "That saved dashboard no longer exists.", null);
  }

  const { title, spec, history, readyPanelIds } = parsed.data;
  const defaultKey = existing.connectionId ?? ENV_CONNECTION_ID;

  // A re-saved spec must only reference connections this user can still use.
  if (spec !== undefined) {
    const referencedKeys = new Set<string>(spec.panels.map((p) => p.connectionId ?? defaultKey));
    for (const key of referencedKeys) {
      if (key === ENV_CONNECTION_ID) {
        if (!hasEnvConnection()) {
          return errorResponse(400, "connection_failed", "No database is connected for this dashboard.", null);
        }
      } else if (!getConnectionSummary(userId, key)) {
        return errorResponse(404, "not_found", "A database connection this dashboard uses no longer exists.", null);
      }
    }
  }

  updateDashboard(userId, id, {
    title,
    spec,
    // Only a re-save (spec present) may replace history — a rename-only
    // PATCH must not wipe it with the schema's [] default.
    history: spec !== undefined ? history : undefined,
  });

  // Re-saving is the same accept signal as saving: panels that rendered
  // successfully become few-shot examples, attributed to each panel's own
  // connection. Failures never fail the update.
  if (spec !== undefined && readyPanelIds.length > 0) {
    await capturePanelExamples(userId, defaultKey, spec.panels, readyPanelIds);
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
