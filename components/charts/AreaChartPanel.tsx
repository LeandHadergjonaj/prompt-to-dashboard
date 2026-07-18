'use client';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
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

export function AreaChartPanel({ data, xField, seriesKeys, unit, dateGranularity }: Props) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
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
        />
        {seriesKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {seriesKeys.map((key, i) => (
          <Area key={key} type="monotone" dataKey={key} name={key}
                stroke={colorForSeriesIndex(i)} strokeWidth={2}
                fill={colorForSeriesIndex(i)} fillOpacity={0.1}
                isAnimationActive={false} connectNulls />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
