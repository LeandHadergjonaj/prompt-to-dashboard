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

export const DashboardSpecSchema = z.object({
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
  title: string;
  summary: string;
  panels: PanelWithId[];
};

