'use client';
import { useState } from 'react';

export function PromptBar({ onSubmit, disabled, defaultValue }: { onSubmit: (q: string) => void; disabled?: boolean; defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue ?? '');
  return (
    <form
      className="flex w-full gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder="e.g. Show me revenue by month for the last year"
        className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base text-[#0b0b0b] placeholder:text-gray-400 focus:border-[#2a78d6] focus:outline-none focus:ring-2 focus:ring-[#2a78d6]/20 disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={disabled}
        className="rounded-xl bg-[#2a78d6] px-5 py-3 text-sm font-medium text-white hover:bg-[#1c5cab] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Build my dashboard
      </button>
    </form>
  );
}
