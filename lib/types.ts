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

// Panel ids are assigned SERVER-SIDE by /api/dashboard after generation
// (`panel-0`, `panel-1`, ...) — never by the LLM. The frontend keys its
// per-panel state on them.
export type PanelWithId = PanelSpec & { id: string };
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
// `history` defaults to [] so pre-existing single-shot clients keep working.
export const DashboardRequestSchema = z.object({
  question: z.string().trim().min(1).max(500),
  history: z.array(HistoryTurnSchema).max(MAX_HISTORY_TURNS).default([]),
});
export const PanelRequestSchema = z.object({
  sql: z.string().trim().min(1).max(10_000),
  chartType: ChartTypeSchema,
});
export const RepairRequestSchema = z.object({
  question: z.string().trim().min(1).max(500),
  panel: PanelSpecSchema,
  sql: z.string().trim().min(1).max(10_000),
  errorMessage: z.string().trim().min(1).max(2_000),
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
  "invalid_request", // body failed zod validation
  "sql_rejected",    // sqlGuard rejected the SQL
  "llm_error",       // OpenAI call failed / unusable output
  "query_timeout",   // statement_timeout fired (pg code 57014)
  "query_failed",    // any other Postgres error
  "internal_error",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiErrorBody = {
  error: { code: ApiErrorCode; friendlyMessage: string; debug: string | null };
};
