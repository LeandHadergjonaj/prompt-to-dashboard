'use client';
import { formatUnitValue } from '@/lib/format';
import type { Unit } from '@/lib/types';

export function StatPanel({ value, unit, caption }: { value: number | null; unit?: Unit | null; caption?: string | null }) {
  return (
    <div className="flex h-[280px] flex-col items-center justify-center gap-1 text-center">
      <span className="text-4xl font-semibold tracking-tight text-[#0b0b0b]">{formatUnitValue(value, unit, 'stat')}</span>
      {caption && <span className="text-sm text-[#52514e]">{caption}</span>}
    </div>
  );
}
