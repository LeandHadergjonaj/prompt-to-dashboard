'use client';
export function EmptyPanel() {
  return (
    <div className="flex h-[220px] flex-col items-center justify-center gap-1 text-center">
      <p className="text-sm font-medium text-[#0b0b0b]">No data for this one</p>
      <p className="text-xs text-[#52514e]">There's nothing to show for this question yet.</p>
    </div>
  );
}
