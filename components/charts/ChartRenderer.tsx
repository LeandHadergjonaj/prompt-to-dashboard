'use client';
import { toObjects, resolveFields, pivotLongToWide, rollupPieSlices, detectDateGranularity, safeNumber } from '@/lib/format';
import { LineChartPanel } from './LineChartPanel';
import { BarChartPanel } from './BarChartPanel';
import { AreaChartPanel } from './AreaChartPanel';
import { PiePanel } from './PiePanel';
import { StatPanel } from './StatPanel';
import { TablePanel } from './TablePanel';
import { EmptyPanel } from '../EmptyPanel';
import type { PanelWithId, ColumnMeta } from '@/lib/types';

export function ChartRenderer({ panel, columns, rows, truncated }: {
  panel: PanelWithId; columns: ColumnMeta[]; rows: unknown[][]; truncated: boolean;
}) {
  if (rows.length === 0) return <EmptyPanel />;

  const objects = toObjects(columns, rows);
  const resolved = resolveFields(panel, columns, objects);

  const needsTableFallback =
    (['line', 'bar', 'area'].includes(panel.chartType) && (!resolved.xField || resolved.yFields.length === 0)) ||
    (panel.chartType === 'pie' && (!resolved.labelField || !resolved.valueField)) ||
    (panel.chartType === 'stat' && (!resolved.valueField || objects.length !== 1));

  if (needsTableFallback) return <TablePanel columns={columns} rows={rows} truncated={truncated} />;

