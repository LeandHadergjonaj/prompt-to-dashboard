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

