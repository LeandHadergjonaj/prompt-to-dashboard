'use client';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { colorForSeriesIndex, dashArrayForSeriesIndex, formatDateTick, formatUnitValue, type DateGranularity } from '@/lib/format';
import type { Unit } from '@/lib/types';

interface Props {
  data: Record<string, unknown>[];
  xField: string;
  seriesKeys: string[];
  unit?: Unit | null;
  dateGranularity: DateGranularity;
}

export function LineChartPanel({ data, xField, seriesKeys, unit, dateGranularity }: Props) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        <CartesianGrid stroke="#e1e0d9" vertical={false} />
        <XAxis
          dataKey={xField}
          tickFormatter={(v) => formatDateTick(v, dateGranularity)}
          tick={{ fontSize: 12, fill: '#898781' }}
          axisLine={{ stroke: '#c3c2b7' }}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={(v) => formatUnitValue(v, unit, 'axis')}
          tick={{ fontSize: 12, fill: '#898781' }}
          axisLine={{ stroke: '#c3c2b7' }}
          tickLine={false}
          width={56}
        />
        <Tooltip
          formatter={(value, name) => [formatUnitValue(value, unit, 'tooltip'), String(name)]}
          labelFormatter={(label) => formatDateTick(label, dateGranularity)}
          contentStyle={{ borderRadius: 8, border: '1px solid rgba(11,11,11,0.10)', fontSize: 12 }}
        />
        {seriesKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {seriesKeys.map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            name={key}
            stroke={colorForSeriesIndex(i)}
            strokeWidth={2}
            strokeDasharray={dashArrayForSeriesIndex(i)}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: '#fcfcfb' }}
            isAnimationActive={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
