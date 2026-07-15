'use client';
export function PanelError() {
  return (
    <div className="flex h-[220px] flex-col items-center justify-center gap-1 text-center">
      <p className="text-sm font-medium text-[#0b0b0b]">This chart didn't come together</p>
      <p className="max-w-xs text-xs text-[#52514e]">
        We tried a couple of ways to build this one, but it's not working right now. The rest of your dashboard is fine.
      </p>
    </div>
  );
}
