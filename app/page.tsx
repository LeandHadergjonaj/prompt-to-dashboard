'use client';
import { useEffect, useState } from 'react';
import { useDashboard } from '@/hooks/useDashboard';
import { PromptBar } from '@/components/PromptBar';
import { ExampleChips } from '@/components/ExampleChips';
import { DashboardView } from '@/components/DashboardView';

const EXAMPLES = [
  'Which regions have the most company-owned properties?',
  'Build me a dashboard on our opportunities pipeline',
  'Top 10 local authorities by total rateable value',
  'How do opportunity signals break down by sector?',
];

export default function Page() {
  const { phase, question, spec, panels, dashboardError, submit, reset, retry } = useDashboard();
  const [debug, setDebug] = useState(false);

  useEffect(() => {
    setDebug(new URLSearchParams(window.location.search).get('debug') === '1');
  }, []);

  if (phase === 'idle' || phase === 'planning') {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-4 pt-24 text-center">
        <div>
          <h1 className="text-3xl font-semibold text-[#0b0b0b]">Ask for a dashboard in plain English.</h1>
          <p className="mt-2 text-base text-[#52514e]">No SQL, no setup — just tell us what you want to see about your property data.</p>
        </div>
        <PromptBar onSubmit={submit} disabled={phase === 'planning'} defaultValue={question} />
        {phase === 'idle' && <ExampleChips examples={EXAMPLES} onSelect={submit} />}
        {phase === 'planning' && (
          <div role="status" aria-live="polite" aria-busy="true" className="flex items-center justify-center gap-2 py-10">
            <span className="flex gap-1">
