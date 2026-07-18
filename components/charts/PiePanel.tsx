'use client';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { PALETTE, formatUnitValue, type PieSlice } from '@/lib/format';
import type { Unit } from '@/lib/types';

export function PiePanel({ slices, unit }: { slices: PieSlice[]; unit?: Unit | null }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Tooltip
          formatter={(value, name) => [formatUnitValue(value, unit, 'tooltip'), String(name)]}
          contentStyle={{ borderRadius: 8, border: '1px solid rgba(11,11,11,0.10)', fontSize: 12 }}
        />
        {slices.length > 1 && <Legend layout="horizontal" align="center" verticalAlign="bottom" wrapperStyle={{ fontSize: 12 }} />}
        <Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="45%" outerRadius={90}
             stroke="#fcfcfb" strokeWidth={2} isAnimationActive={false}>
          {slices.map((slice, i) => (
            <Cell key={slice.name} fill={slice.name === 'Other' ? '#c3c2b7' : PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}
