'use client';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { PALETTE, PIE_OTHER, CHART_SURFACE, CHART_TOOLTIP_STYLE, formatUnitValue, type PieSlice } from '@/lib/format';
import type { Unit } from '@/lib/types';

export function PiePanel({ slices, unit }: { slices: PieSlice[]; unit?: Unit | null }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Tooltip
          formatter={(value, name) => [formatUnitValue(value, unit, 'tooltip'), String(name)]}
          contentStyle={CHART_TOOLTIP_STYLE}
        />
        {slices.length > 1 && <Legend layout="horizontal" align="center" verticalAlign="bottom" wrapperStyle={{ fontSize: 12 }} />}
        <Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="45%" outerRadius={90}
             stroke={CHART_SURFACE} strokeWidth={2} isAnimationActive={false}>
          {slices.map((slice, i) => (
            <Cell key={slice.name} fill={slice.name === 'Other' ? PIE_OTHER : PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}
