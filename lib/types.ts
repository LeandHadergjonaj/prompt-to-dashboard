import { z } from "zod";

export const ChartTypeSchema = z.enum(["line", "bar", "area", "pie", "stat", "table"]);
export type ChartType = z.infer<typeof ChartTypeSchema>;

export const UnitSchema = z.enum(["currency", "count", "percent", "none"]);
export type Unit = z.infer<typeof UnitSchema>;

// Flat panel spec: ALL fields always present (strict structured outputs
// forbids optional fields); non-applicable fields are null.
export const PanelSpecSchema = z.object({
  title: z.string(),
  description: z.string(),
  chartType: ChartTypeSchema,
  sql: z.string(),
  // line / bar / area
  xField: z.string().nullable(),
  yFields: z.array(z.string()).nullable(),
  seriesField: z.string().nullable(),
  // pie
  labelField: z.string().nullable(),
  // pie (value) / stat (value)
  valueField: z.string().nullable(),
  // all chart types (drives number formatting); null only for table panels
  unit: UnitSchema.nullable(),
  // stat only
  comparison: z.string().nullable(),
});
export type PanelSpec = z.infer<typeof PanelSpecSchema>;

// "update" = this turn refines/extends the dashboard from the previous turn
// (unchanged panels keep their SQL verbatim so results can be reused);
// "new" = a fresh dashboard unrelated to what came before.
export const DashboardModeSchema = z.enum(["new", "update"]);
export type DashboardMode = z.infer<typeof DashboardModeSchema>;

export const DashboardSpecSchema = z.object({
  mode: DashboardModeSchema,
  title: z.string(),
  summary: z.string(), // one plain-English sentence shown under the dashboard title
  panels: z.array(PanelSpecSchema), // 1-6 cap enforced in route code, not schema
});
export type DashboardSpec = z.infer<typeof DashboardSpecSchema>;

// LLM-facing generation schema (multi-source): each panel names the ONE
// source it queries. sourceId must equal one of the source ids provided in
// the prompt ('env' or a connection id); the route validates it after
// generation and falls back to the primary source when invalid.
export const GeneratedPanelSchema = PanelSpecSchema.extend({ sourceId: z.string() });
export const GeneratedDashboardSchema = z.object({
  mode: DashboardModeSchema,
  title: z.string(),
  summary: z.string(),
  panels: z.array(GeneratedPanelSchema),
});
export type GeneratedDashboard = z.infer<typeof GeneratedDashboardSchema>;

// Panel ids are assigned SERVER-SIDE by /api/dashboard after generation
// (`panel-0`, `panel-1`, ...) — never by the LLM. The frontend keys its
// per-panel state on them.
//
// connectionId is the panel's own source: 'env' for the env-configured
// connection, a connection id otherwise, or null meaning "inherit the
// dashboard-level default" (the shape of pre-multi-source saved panels).
export type PanelWithId = PanelSpec & { id: string; connectionId: string | null };
export type DashboardSpecWithIds = {
  mode: DashboardMode;
  title: string;
  summary: string;
  panels: PanelWithId[];
};

// Repair call structured output
export const RepairSqlSchema = z.object({ sql: z.string() });

// ---- Conversation history (client -> /api/dashboard) ----
// A compact record of each prior turn: what the user asked and what dashboard
// came back. SQL is included so the model can carry unchanged panels over
// verbatim (and the client can then reuse cached results).
export const HistoryPanelSchema = z.object({
  title: z.string().max(200),
  chartType: ChartTypeSchema,
  sql: z.string().max(10_000),
  // Panel's own source ('env' or a connection id); null = the conversation's
  // primary connection. Preserves panel -> source attribution across turns.
  connectionId: z.string().max(100).nullable().default(null),
});
export type HistoryPanel = z.infer<typeof HistoryPanelSchema>;

export const HistoryTurnSchema = z.object({
  question: z.string().trim().min(1).max(500),
  dashboardTitle: z.string().max(200),
  panels: z.array(HistoryPanelSchema).max(6),
});
export type HistoryTurn = z.infer<typeof HistoryTurnSchema>;

export const MAX_HISTORY_TURNS = 8;

// ---- API request bodies ----
// `history` defaults to [] and `connectionId` to null so pre-existing
// single-shot clients keep working (null = the env-configured connection).
const ConnectionIdSchema = z.string().max(100).nullable().default(null);

export const MAX_DASHBOARD_SOURCES = 3;

export const DashboardRequestSchema = z.object({
  question: z.string().trim().min(1).max(500),
  history: z.array(HistoryTurnSchema).max(MAX_HISTORY_TURNS).default([]),
  connectionId: ConnectionIdSchema,
  // Multi-source dashboards: every source this dashboard may draw from,
  // primary FIRST ('env' sentinel allowed). When absent, the single
  // connectionId above is the only source (pre-multi-source clients).
  connectionIds: z.array(z.string().min(1).max(100)).min(1).max(MAX_DASHBOARD_SOURCES).optional(),
});
export const PanelRequestSchema = z.object({
  sql: z.string().trim().min(1).max(10_000),
  chartType: ChartTypeSchema,
  connectionId: ConnectionIdSchema,
});
export const RepairRequestSchema = z.object({
  question: z.string().trim().min(1).max(500),
  panel: PanelSpecSchema,
  sql: z.string().trim().min(1).max(10_000),
  errorMessage: z.string().trim().min(1).max(2_000),
  // Structured API error code from the failed panel run (e.g.
  // "query_timeout") — switches the repair prompt to the do-less-work
  // instruction set instead of the fix-the-syntax one.
  errorCode: z.string().max(40).nullable().default(null),
  connectionId: ConnectionIdSchema,
});

// ---- Connections (onboarding) ----
export const CreateConnectionRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  adminUrl: z.string().trim().min(1).max(1_000),
});

// Per-connection execution settings (PATCH /api/connections/:id). Ranges
// mirror the connection_settings table CHECKs; the statement-timeout max is
// the role-level ceiling set at onboarding.
export const ConnectionSettingsSchema = z.object({
  statementTimeoutMs: z.number().int().min(5_000).max(120_000),
  maxResultRows: z.number().int().min(100).max(20_000),
});
export const UpdateConnectionRequestSchema = z.object({
  settings: ConnectionSettingsSchema.partial().refine(
    (s) => s.statementTimeoutMs !== undefined || s.maxResultRows !== undefined,
    { message: "provide at least one setting" }
  ),
});

// ---- Saved dashboards ----
// The client sends each panel's EFFECTIVE SQL (post-repair) inside spec, plus
// which panels actually rendered — those become few-shot example material.
export const PanelWithIdSchema = PanelSpecSchema.extend({
  id: z.string().max(40),
  // 'env' or a connection id; null = inherit the dashboard-level connection
  // (also the shape of every panel saved before multi-source existed).
  connectionId: z.string().max(100).nullable().default(null),
});
export const SavedSpecSchema = z.object({
  mode: DashboardModeSchema,
  title: z.string().max(200),
  summary: z.string().max(1_000),
  panels: z.array(PanelWithIdSchema).min(1).max(6),
});
export const SaveDashboardRequestSchema = z.object({
  connectionId: ConnectionIdSchema,
  title: z.string().trim().min(1).max(120),
  question: z.string().trim().max(500).default(""),
  spec: SavedSpecSchema,
  history: z.array(HistoryTurnSchema).max(MAX_HISTORY_TURNS).default([]),
  readyPanelIds: z.array(z.string().max(40)).max(6).default([]),
});
// PATCH /api/dashboards/:id — rename, re-save (updated spec + history), or
// both. Re-saves carry readyPanelIds so accepted panels feed few-shot
// examples exactly like a first save does.
export const UpdateDashboardRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    spec: SavedSpecSchema.optional(),
    history: z.array(HistoryTurnSchema).max(MAX_HISTORY_TURNS).default([]),
    readyPanelIds: z.array(z.string().max(40)).max(6).default([]),
  })
  .refine((v) => v.title !== undefined || v.spec !== undefined, {
    message: "provide a title, a spec, or both",
  });

// ---- API response bodies ----
export const ColumnMetaSchema = z.object({
  name: z.string(),
  type: z.enum(["number", "date", "boolean", "string"]),
});
export type ColumnMeta = z.infer<typeof ColumnMetaSchema>;

export type DashboardResponse = { spec: DashboardSpecWithIds };
export type PanelResponse = {
  columns: ColumnMeta[];
  rows: unknown[][];
  truncated: boolean;
};
export type RepairResponse = { sql: string };

// ---- Error taxonomy (shared by all three routes) ----
export const ApiErrorCodeSchema = z.enum([
  "invalid_request",    // body failed zod validation
  "sql_rejected",       // sqlGuard rejected the SQL
  "llm_error",          // OpenAI call failed / unusable output
  "query_timeout",      // statement_timeout fired (pg code 57014)
  "query_failed",       // any other Postgres error
  "connection_failed",  // onboarding / connection resolution failed
  "not_found",          // resource doesn't exist or isn't yours
  "internal_error",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiErrorBody = {
  error: { code: ApiErrorCode; friendlyMessage: string; debug: string | null };
};
