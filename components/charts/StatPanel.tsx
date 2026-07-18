'use client';
import { formatUnitValue } from '@/lib/format';
import type { Unit } from '@/lib/types';

export function StatPanel({ value, unit, caption }: { value: number | null; unit?: Unit | null; caption?: string | null }) {
  return (
    <div className="flex h-[280px] flex-col items-center justify-center gap-2 text-center">
      <span className="font-serif text-5xl font-medium tracking-[-.01em] text-ink">{formatUnitValue(value, unit, 'stat')}</span>
      {caption && <span className="text-sm text-muted">{caption}</span>}
    </div>
  );
}
