import { NextRequest, NextResponse } from "next/server";
import { SaveDashboardRequestSchema } from "@/lib/types";
import { getCurrentUserId } from "@/lib/identity";
import { listDashboards, saveDashboard } from "@/lib/dashboards";
import { getConnectionSummary, ENV_CONNECTION_ID, hasEnvConnection } from "@/lib/connections";
import { capturePanelExamples } from "@/lib/examples";
import { errorResponse } from "@/lib/apiErrors";

export async function GET() {
  const userId = await getCurrentUserId();
  return NextResponse.json({ dashboards: listDashboards(userId) });
}

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "invalid_request", "That request wasn't valid.", null);
  }
  const parsed = SaveDashboardRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, "invalid_request", "That save request wasn't valid.", parsed.error.message);
  }

  // The dashboard must reference connections this user can actually use —
  // the dashboard-level default AND every per-panel override.
  const { connectionId } = parsed.data;
  const defaultKey = connectionId ?? ENV_CONNECTION_ID;
  const referencedKeys = new Set<string>([
    defaultKey,
    ...parsed.data.spec.panels.map((p) => p.connectionId ?? defaultKey),
  ]);
  for (const key of referencedKeys) {
    if (key === ENV_CONNECTION_ID) {
      if (!hasEnvConnection()) {
        return errorResponse(400, "connection_failed", "No database is connected for this dashboard.", null);
      }
    } else if (!getConnectionSummary(userId, key)) {
      return errorResponse(404, "not_found", "A database connection this dashboard uses no longer exists.", null);
    }
  }

  const saved = saveDashboard({
    userId,
    connectionId,
    title: parsed.data.title,
    question: parsed.data.question,
    spec: parsed.data.spec,
    history: parsed.data.history,
  });

  // Accept signal: panels that rendered successfully become few-shot
  // examples, each attributed to the PANEL's effective connection.
  // Failures here never fail the save.
  await capturePanelExamples(userId, defaultKey, parsed.data.spec.panels, parsed.data.readyPanelIds);

  return NextResponse.json({ dashboard: saved }, { status: 201 });
}
