import { NextRequest, NextResponse } from "next/server";
import { SaveDashboardRequestSchema } from "@/lib/types";
import { getCurrentUserId } from "@/lib/identity";
import { listDashboards, saveDashboard } from "@/lib/dashboards";
import { getConnectionSummary, ENV_CONNECTION_ID, hasEnvConnection } from "@/lib/connections";
import { saveExamples } from "@/lib/examples";
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

  // The dashboard must reference a connection this user can actually use.
  const { connectionId } = parsed.data;
  if (connectionId === null || connectionId === ENV_CONNECTION_ID) {
    if (!hasEnvConnection()) {
      return errorResponse(400, "connection_failed", "No database is connected for this dashboard.", null);
    }
  } else if (!getConnectionSummary(userId, connectionId)) {
    return errorResponse(404, "not_found", "That database connection no longer exists.", null);
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
  // examples for this connection. Failures here never fail the save.
  const readyIds = new Set(parsed.data.readyPanelIds);
  const pairs = parsed.data.spec.panels
    .filter((p) => readyIds.has(p.id))
    .map((p) => ({ question: `${p.title}: ${p.description}`, sql: p.sql }));
  try {
    await saveExamples(userId, connectionId ?? ENV_CONNECTION_ID, pairs);
  } catch {
    // ignore — example capture is best-effort
  }

  return NextResponse.json({ dashboard: saved }, { status: 201 });
}
