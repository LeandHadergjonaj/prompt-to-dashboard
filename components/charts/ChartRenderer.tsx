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

  switch (panel.chartType) {
    case 'line':
    case 'bar':
    case 'area': {
      const granularity = detectDateGranularity(objects.map((o) => o[resolved.xField!]));
      let data = objects;
      let seriesKeys = resolved.yFields;
      if (resolved.seriesField && resolved.yFields[0]) {
        const pivoted = pivotLongToWide(objects, resolved.xField!, resolved.seriesField, resolved.yFields[0]);
        data = pivoted.data;
        seriesKeys = pivoted.seriesKeys;
      }
      const Comp = panel.chartType === 'line' ? LineChartPanel : panel.chartType === 'bar' ? BarChartPanel : AreaChartPanel;
      return <Comp data={data} xField={resolved.xField!} seriesKeys={seriesKeys} unit={panel.unit} dateGranularity={granularity} />;
    }
    case 'pie': {
      const { slices } = rollupPieSlices(objects, resolved.labelField!, resolved.valueField!);
      return <PiePanel slices={slices} unit={panel.unit} />;
    }
    case 'stat': {
      const value = safeNumber(objects[0][resolved.valueField!]);
      return <StatPanel value={value} unit={panel.unit} caption={panel.comparison} />;
    }
    case 'table':
    default:
      return <TablePanel columns={columns} rows={rows} truncated={truncated} />;
  }
}
