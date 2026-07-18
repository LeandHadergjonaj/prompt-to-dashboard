'use client';
export function ExampleChips({ examples, onSelect }: { examples: string[]; onSelect: (q: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <span className="font-mono text-[11px] uppercase tracking-[.14em] text-faint">Try one of these</span>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {examples.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onSelect(q)}
            className="rounded-full border border-line bg-surface px-4 py-2 text-sm text-muted transition-colors hover:border-brand/50 hover:text-brand"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
