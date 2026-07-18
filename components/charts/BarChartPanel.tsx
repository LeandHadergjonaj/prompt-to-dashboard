'use client';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import {
  colorForSeriesIndex, formatDateTick, formatUnitValue,
  CHART_GRID, CHART_AXIS_TEXT, CHART_AXIS_LINE, CHART_TOOLTIP_STYLE, CHART_TOOLTIP_LABEL_STYLE,
  type DateGranularity,
} from '@/lib/format';
import type { Unit } from '@/lib/types';

interface Props {
  data: Record<string, unknown>[];
  xField: string;
  seriesKeys: string[];
  unit?: Unit | null;
  dateGranularity: DateGranularity;
}

export function BarChartPanel({ data, xField, seriesKeys, unit, dateGranularity }: Props) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        <CartesianGrid stroke={CHART_GRID} vertical={false} />
        <XAxis
          dataKey={xField}
          tickFormatter={(v) => formatDateTick(v, dateGranularity)}
          tick={{ fontSize: 12, fill: CHART_AXIS_TEXT }}
          axisLine={{ stroke: CHART_AXIS_LINE }}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={(v) => formatUnitValue(v, unit, 'axis')}
          tick={{ fontSize: 12, fill: CHART_AXIS_TEXT }}
          axisLine={{ stroke: CHART_AXIS_LINE }}
          tickLine={false}
          width={56}
        />
        <Tooltip
          formatter={(value, name) => [formatUnitValue(value, unit, 'tooltip'), String(name)]}
          labelFormatter={(label) => formatDateTick(label, dateGranularity)}
          contentStyle={CHART_TOOLTIP_STYLE}
          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
          cursor={{ fill: 'rgba(29,92,74,0.06)' }}
        />
        {seriesKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {seriesKeys.map((key, i) => (
          <Bar key={key} dataKey={key} name={key} fill={colorForSeriesIndex(i)}
               radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
