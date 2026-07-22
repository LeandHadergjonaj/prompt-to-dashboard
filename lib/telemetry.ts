import { getAppStore, newId } from "./appStore";

// Panel-run telemetry: the evidence base for the timeout UX, the cost guard,
// and the performance advisor. Local-only (.data/app.db), append-only,
// best-effort — recording must never fail or slow a panel request.

export type PanelRunOutcome = "ok" | "timeout" | "error" | "rejected";

export interface PanelRun {
  userId: string;
  connectionKey: string; // connection id, or 'env'
  sql: string;           // sanitized SQL (pre-wrap)
  durationMs: number;
  rowCount: number | null;
  outcome: PanelRunOutcome;
  errorCode: string | null; // pg code when outcome != 'ok'
  totalCost: number | null; // planner estimate from EXPLAIN, when available
}

const MAX_RUNS_PER_CONNECTION = 2000;

export function recordPanelRun(run: PanelRun): void {
  try {
    const store = getAppStore();
    const tx = store.transaction(() => {
      store
        .prepare(
          `INSERT INTO panel_runs
             (id, user_id, connection_id, sql, duration_ms, row_count, outcome, error_code, total_cost)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          newId(),
          run.userId,
          run.connectionKey,
          run.sql,
          Math.round(run.durationMs),
          run.rowCount,
          run.outcome,
          run.errorCode,
          run.totalCost
        );
      store
        .prepare(
          `DELETE FROM panel_runs WHERE connection_id = ? AND id NOT IN (
             SELECT id FROM panel_runs WHERE connection_id = ?
             ORDER BY created_at DESC LIMIT ?
           )`
        )
        .run(run.connectionKey, run.connectionKey, MAX_RUNS_PER_CONNECTION);
    });
    tx();
  } catch {
    // best-effort: telemetry must never fail a request
  }
}

export interface StoredPanelRun {
  sql: string;
  durationMs: number;
  rowCount: number | null;
  outcome: PanelRunOutcome;
  errorCode: string | null;
  totalCost: number | null;
  createdAt: string;
}

export function listPanelRuns(userId: string, connectionKey: string, limit = 500): StoredPanelRun[] {
  const rows = getAppStore()
    .prepare(
      `SELECT sql, duration_ms, row_count, outcome, error_code, total_cost, created_at
       FROM panel_runs WHERE user_id = ? AND connection_id = ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(userId, connectionKey, limit) as Array<{
    sql: string;
    duration_ms: number;
    row_count: number | null;
    outcome: PanelRunOutcome;
    error_code: string | null;
    total_cost: number | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    sql: r.sql,
    durationMs: r.duration_ms,
    rowCount: r.row_count,
    outcome: r.outcome,
    errorCode: r.error_code,
    totalCost: r.total_cost,
    createdAt: r.created_at,
  }));
}
