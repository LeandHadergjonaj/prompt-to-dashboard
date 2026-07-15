'use client';
export function ExampleChips({ examples, onSelect }: { examples: string[]; onSelect: (q: string) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {examples.map((q) => (
        <button
          key={q}
          type="button"
          onClick={() => onSelect(q)}
          className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-[#0b0b0b] transition-colors hover:border-gray-300 hover:bg-gray-50"
        >
          {q}
        </button>
      ))}
    </div>
  );
}
