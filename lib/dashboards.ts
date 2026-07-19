import { getAppStore, newId } from "./appStore";
import type { HistoryTurn } from "./types";
import type { z } from "zod";
import type { SavedSpecSchema } from "./types";

export type SavedSpec = z.infer<typeof SavedSpecSchema>;

export interface SavedDashboardListItem {
  id: string;
  title: string;
  summary: string;
  question: string;
  connectionId: string | null;
  panelCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SavedDashboard extends SavedDashboardListItem {
  spec: SavedSpec;
  history: HistoryTurn[];
}

interface DashboardRow {
  id: string;
  user_id: string;
  connection_id: string | null;
  title: string;
  summary: string;
  question: string;
  spec_json: string;
  history_json: string;
  created_at: string;
  updated_at: string;
}

function toListItem(row: DashboardRow): SavedDashboardListItem {
  const spec = JSON.parse(row.spec_json) as SavedSpec;
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    question: row.question,
    connectionId: row.connection_id,
    panelCount: spec.panels.length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listDashboards(userId: string): SavedDashboardListItem[] {
  const rows = getAppStore()
    .prepare("SELECT * FROM dashboards WHERE user_id = ? ORDER BY updated_at DESC")
    .all(userId) as DashboardRow[];
  return rows.map(toListItem);
}

export function getDashboard(userId: string, id: string): SavedDashboard | null {
  const row = getAppStore()
    .prepare("SELECT * FROM dashboards WHERE id = ? AND user_id = ?")
    .get(id, userId) as DashboardRow | undefined;
  if (!row) return null;
  return {
    ...toListItem(row),
    spec: JSON.parse(row.spec_json) as SavedSpec,
    history: JSON.parse(row.history_json) as HistoryTurn[],
  };
}

export function saveDashboard(params: {
  userId: string;
  connectionId: string | null;
  title: string;
  question: string;
  spec: SavedSpec;
  history: HistoryTurn[];
}): SavedDashboard {
  const id = newId();
  getAppStore()
    .prepare(
      `INSERT INTO dashboards (id, user_id, connection_id, title, summary, question, spec_json, history_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      params.userId,
      params.connectionId,
      params.title,
      params.spec.summary,
      params.question,
      JSON.stringify(params.spec),
      JSON.stringify(params.history)
    );
  return getDashboard(params.userId, id)!;
}

export function renameDashboard(userId: string, id: string, title: string): boolean {
  const result = getAppStore()
    .prepare(
      `UPDATE dashboards SET title = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ? AND user_id = ?`
    )
    .run(title, id, userId);
  return result.changes > 0;
}

export function deleteDashboard(userId: string, id: string): boolean {
  const result = getAppStore()
    .prepare("DELETE FROM dashboards WHERE id = ? AND user_id = ?")
    .run(id, userId);
  return result.changes > 0;
}
