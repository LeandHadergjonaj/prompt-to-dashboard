import type { PanelWithId, ColumnMeta, Unit } from './types';

// ---------- guards ----------

export function safeNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

// ---------- row shaping ----------

export function toObjects(
  columns: ColumnMeta[],
  rows: unknown[][]
): Record<string, unknown>[] {
  return rows.map((row) =>
    Object.fromEntries(columns.map((col, i) => [col.name, row[i] === undefined ? null : row[i]]))
  );
}

export function inferColumnKind(values: unknown[]): 'number' | 'date' | 'string' {
  const nonNull = values.filter((v) => v !== null && v !== undefined);
  if (nonNull.length === 0) return 'string';
  if (nonNull.every((v) => safeNumber(v) !== null)) return 'number';
  const allDate = nonNull.every((v) => {
    if (typeof v === 'number') return false;
    const d = new Date(v as string);
    return !Number.isNaN(d.getTime());
  });
  return allDate ? 'date' : 'string';
}

// ---------- field resolution / fallback ----------

export interface ResolvedFields {
  xField?: string;
  yFields: string[];
  seriesField?: string;
  labelField?: string;
  valueField?: string;
}

export function resolveFields(
  panel: PanelWithId,
  columns: ColumnMeta[],
  objects: Record<string, unknown>[]
): ResolvedFields {
  const names = new Set(columns.map((c) => c.name));
  const kindByName = new Map(
    columns.map((c) => [c.name, inferColumnKind(objects.map((o) => o[c.name]))])
  );
  const numericCols = columns.filter((c) => kindByName.get(c.name) === 'number').map((c) => c.name);
  const otherCols = columns.filter((c) => kindByName.get(c.name) !== 'number').map((c) => c.name);

  const xField = panel.xField && names.has(panel.xField) ? panel.xField : otherCols[0];
  let yFields = (panel.yFields ?? []).filter((f) => names.has(f));
  if (yFields.length === 0) yFields = numericCols.filter((n) => n !== xField);
  const seriesField = panel.seriesField && names.has(panel.seriesField) ? panel.seriesField : undefined;
  const labelField = panel.labelField && names.has(panel.labelField) ? panel.labelField : otherCols[0];
  const valueField = panel.valueField && names.has(panel.valueField) ? panel.valueField : numericCols[0];

  return { xField, yFields, seriesField, labelField, valueField };
}

// ---------- long → wide pivot ----------

export interface PivotResult {
  data: Record<string, unknown>[];
  seriesKeys: string[];
  overflowCount: number;
}

// Cap at 12 series (top 12 by total value; rest dropped). Only 8 palette hues:
// series 9-12 reuse hues 1-4 with a dashed stroke as the non-color encoding.
export function pivotLongToWide(
  objects: Record<string, unknown>[],
  xField: string,
  seriesField: string,
  yField: string,
  maxSeries = 12
): PivotResult {
  const totals = new Map<string, number>();
  for (const o of objects) {
    const key = o[seriesField] == null ? 'Unknown' : String(o[seriesField]);
    totals.set(key, (totals.get(key) ?? 0) + (safeNumber(o[yField]) ?? 0));
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const keptSeries = ranked.slice(0, maxSeries);
  const keptSet = new Set(keptSeries);
  const overflowCount = Math.max(0, ranked.length - maxSeries);

  const byX = new Map<string, Record<string, unknown>>();
  for (const o of objects) {
    const seriesKey = o[seriesField] == null ? 'Unknown' : String(o[seriesField]);
    if (!keptSet.has(seriesKey)) continue;
    const xVal = o[xField];
    const rowKey = String(xVal);
    if (!byX.has(rowKey)) byX.set(rowKey, { [xField]: xVal });
    byX.get(rowKey)![seriesKey] = safeNumber(o[yField]);
  }
  return { data: [...byX.values()], seriesKeys: keptSeries, overflowCount };
}

// ---------- pie "Other" rollup ----------

export interface PieSlice {
  name: string;
  value: number;
}

export function rollupPieSlices(
  objects: Record<string, unknown>[],
  labelField: string,
  valueField: string,
  maxSlices = 8
): { slices: PieSlice[]; overflow: boolean } {
  const rows: PieSlice[] = objects
    .map((o) => ({
      name: o[labelField] == null ? 'Unknown' : String(o[labelField]),
      value: safeNumber(o[valueField]) ?? 0,
    }))
    .filter((r) => r.value > 0);
  rows.sort((a, b) => b.value - a.value);
  if (rows.length <= maxSlices) return { slices: rows, overflow: false };
  const top = rows.slice(0, maxSlices - 1);
  const otherValue = rows.slice(maxSlices - 1).reduce((sum, r) => sum + r.value, 0);
  return { slices: [...top, { name: 'Other', value: otherValue }], overflow: true };
}

// ---------- date granularity + formatting ----------

export type DateGranularity = 'year' | 'month' | 'day' | 'none';

export function detectDateGranularity(values: unknown[]): DateGranularity {
  const dates = values
    .map((v) => (v == null ? null : new Date(v as string)))
    .filter((d): d is Date => d !== null && !Number.isNaN(d.getTime()));
  if (dates.length === 0 || dates.length !== values.length) return 'none';
  const allFirstOfMonth = dates.every((d) => d.getUTCDate() === 1);
  const allJanuary = dates.every((d) => d.getUTCMonth() === 0);
  if (allFirstOfMonth && allJanuary) return 'year';
  if (allFirstOfMonth) return 'month';
  return 'day';
}

