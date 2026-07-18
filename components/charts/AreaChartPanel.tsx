'use client';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { colorForSeriesIndex, formatDateTick, formatUnitValue, type DateGranularity } from '@/lib/format';
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
        <CartesianGrid stroke="#e1e0d9" vertical={false} />
        <XAxis
          dataKey={xField}
          tickFormatter={(v) => formatDateTick(v, dateGranularity)}
          tick={{ fontSize: 12, fill: '#898781' }}
          axisLine={{ stroke: '#c3c2b7' }}
          tickLine={false}
