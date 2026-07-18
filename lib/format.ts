import type { PanelWithId, ColumnMeta, Unit } from './types';

// Display locale/currency are deploy-time configuration (NEXT_PUBLIC_* vars
// are inlined at build). The LLM's `unit: "currency"` contract is unchanged.
const LOCALE = process.env.NEXT_PUBLIC_LOCALE || 'en-US';
const CURRENCY = process.env.NEXT_PUBLIC_CURRENCY || 'USD';
const CURRENCY_SYMBOL = (() => {
  try {
    return (
      new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY })
        .formatToParts(0)
        .find((p) => p.type === 'currency')?.value ?? CURRENCY
    );
  } catch {
    return CURRENCY;
  }
})();

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

// timeZone pinned to UTC deliberately: date_trunc results are UTC midnight;
// local-zone formatting would shift the shown date back a day for negative-
// offset users. Do not remove.
export function formatDateTick(raw: unknown, granularity: DateGranularity): string {
  if (granularity === 'none') return raw == null ? '' : String(raw);
  const d = new Date(raw as string);
  if (Number.isNaN(d.getTime())) return String(raw);
  if (granularity === 'year') return new Intl.DateTimeFormat(LOCALE, { year: 'numeric', timeZone: 'UTC' }).format(d);
  if (granularity === 'month') return new Intl.DateTimeFormat(LOCALE, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
  return new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}

// ---------- number formatting ----------

export function formatCompactNumber(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${sign}${abs}`;
}

export function formatCurrencyFull(n: number): string {
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export function formatCountFull(n: number): string {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(n);
}

// percent values arrive already scaled 0-100 (the prompt defines unit
// "percent" that way for the LLM).
export function formatPercent(n: number): string {
  return `${(Math.round(n * 10) / 10).toFixed(1)}%`;
}

export function formatUnitValue(raw: unknown, unit: Unit | null | undefined, mode: 'axis' | 'tooltip' | 'stat'): string {
  const n = safeNumber(raw);
  if (n === null) return '—';
  switch (unit) {
    case 'currency':
      return mode === 'tooltip' || mode === 'stat' ? formatCurrencyFull(n) : `${CURRENCY_SYMBOL}${formatCompactNumber(n)}`;
    case 'percent':
      return formatPercent(n);
    default:
      return mode === 'tooltip' ? formatCountFull(n) : mode === 'stat' ? formatCountFull(n) : formatCompactNumber(n);
  }
}

// ---------- palette ----------

// Validated against a white surface with the dataviz palette validator: all
// hard gates pass. Three hues (magenta/amber/aqua) fall below 3:1 text
// contrast on white, so palette colors are used ONLY as fills/strokes — all
// text renders in ink colors (#0b0b0b / #52514e).
export const PALETTE = [
  '#2a78d6', // blue
  '#008300', // green
  '#e87ba4', // magenta/rose
  '#eda100', // amber
  '#1baf7a', // aqua/teal
  '#eb6834', // orange
  '#4a3aa7', // violet
  '#e34948', // red
] as const;

export function colorForSeriesIndex(i: number): string {
  return PALETTE[i % PALETTE.length];
}

export function dashArrayForSeriesIndex(i: number): string | undefined {
  return i < PALETTE.length ? undefined : '6 3';
}
