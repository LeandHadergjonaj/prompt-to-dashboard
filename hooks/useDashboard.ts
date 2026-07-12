'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardSpecWithIds, PanelWithId, ColumnMeta } from '@/lib/types';

export type Phase = 'idle' | 'planning' | 'rendering' | 'done' | 'error';
export type PanelStatus = 'loading' | 'repairing' | 'ready' | 'failed';

export interface PanelState {
  status: PanelStatus;
  sql: string; // sql currently in effect (original or repaired)
  columns?: ColumnMeta[];
  rows?: unknown[][];
  truncated?: boolean;
  error?: { friendlyMessage: string; debug?: string | null };
}

interface DashboardState {
  phase: Phase;
  question: string;
  spec: DashboardSpecWithIds | null;
  panels: Record<string, PanelState>;
  dashboardError: string | null;
}

const GENERIC_DASHBOARD_ERROR =
  'Something went wrong on our end. Try again, or try asking in a different way.';
const GENERIC_PANEL_ERROR =
  "We tried a couple of ways to build this one, but it's not working right now.";

class FriendlyError extends Error {}

type ApiErrorShape = { code?: string; friendlyMessage?: string; debug?: string | null };

export function useDashboard() {
  const [state, setState] = useState<DashboardState>({
    phase: 'idle', question: '', spec: null, panels: {}, dashboardError: null,
  });

  const dashboardControllerRef = useRef<AbortController | null>(null);
  const panelControllersRef = useRef<Map<string, AbortController>>(new Map());
  const currentQuestionRef = useRef('');

  const abortAll = useCallback(() => {
    dashboardControllerRef.current?.abort();
    dashboardControllerRef.current = null;
    for (const c of panelControllersRef.current.values()) c.abort();
    panelControllersRef.current.clear();
  }, []);

  useEffect(() => () => abortAll(), [abortAll]);

  const setPanel = useCallback((id: string, patch: Partial<PanelState>) => {
    setState((s) => ({ ...s, panels: { ...s.panels, [id]: { ...s.panels[id], ...patch } as PanelState } }));
  }, []);

  const maybeFinish = useCallback(() => {
    setState((s) => {
      const allSettled = Object.values(s.panels).every((p) => p.status === 'ready' || p.status === 'failed');
      if (allSettled && s.phase === 'rendering') return { ...s, phase: 'done' };
      return s;
    });
  }, []);

  const runPanel = useCallback(
    async (panel: PanelWithId, signal: AbortSignal, sqlOverride?: string, isRepairRun = false) => {
      const sql = sqlOverride ?? panel.sql;
      setPanel(panel.id, { status: isRepairRun ? 'repairing' : 'loading', sql });
      try {
        const res = await fetch('/api/panel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql, chartType: panel.chartType }),
          signal,
        });
        const body = await res.json().catch(() => null);
        if (res.ok && body && !body.error) {
          setPanel(panel.id, { status: 'ready', columns: body.columns, rows: body.rows, truncated: body.truncated });
          maybeFinish();
          return;
        }
        const errBody: ApiErrorShape | undefined = body?.error;
        const friendlyMessage = errBody?.friendlyMessage ?? GENERIC_PANEL_ERROR;
        if (isRepairRun) {
          setPanel(panel.id, { status: 'failed', error: { friendlyMessage, debug: errBody?.debug } });
          maybeFinish();
          return;
        }
        // Raw DB error lives in debug — that's what the repair prompt needs.
        const rawError = (errBody?.debug ?? errBody?.friendlyMessage ?? 'unknown error').slice(0, 2000);
        await attemptRepair(panel, signal, sql, rawError);
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        if (isRepairRun) {
          setPanel(panel.id, { status: 'failed', error: { friendlyMessage: GENERIC_PANEL_ERROR } });
          maybeFinish();
          return;
        }
        await attemptRepair(panel, signal, sql, 'network error');
      }
    },
    [setPanel, maybeFinish] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const attemptRepair = useCallback(
    async (panel: PanelWithId, signal: AbortSignal, sql: string, errorMessage: string) => {
      setPanel(panel.id, { status: 'repairing' });
      try {
        const res = await fetch('/api/repair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: currentQuestionRef.current, panel, sql, errorMessage }),
          signal,
        });
        if (!res.ok) throw new Error('repair failed');
        const { sql: repairedSql } = await res.json();
        await runPanel(panel, signal, repairedSql, true);
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        setPanel(panel.id, { status: 'failed', error: { friendlyMessage: GENERIC_PANEL_ERROR } });
        maybeFinish();
      }
    },
    [setPanel, runPanel, maybeFinish]
  );

  const submit = useCallback(
    async (question: string) => {
      abortAll();
      currentQuestionRef.current = question;
      setState({ phase: 'planning', question, spec: null, panels: {}, dashboardError: null });

      const controller = new AbortController();
      dashboardControllerRef.current = controller;
      try {
        const res = await fetch('/api/dashboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => null);
          throw new FriendlyError(errBody?.error?.friendlyMessage ?? GENERIC_DASHBOARD_ERROR);
        }
        const { spec } = (await res.json()) as { spec: DashboardSpecWithIds };

        const initialPanels: Record<string, PanelState> = {};
        for (const p of spec.panels) initialPanels[p.id] = { status: 'loading', sql: p.sql };
        setState({ phase: 'rendering', question, spec, panels: initialPanels, dashboardError: null });

        for (const p of spec.panels) {
          const panelController = new AbortController();
          panelControllersRef.current.set(p.id, panelController);
          runPanel(p, panelController.signal); // fire-and-forget: panels settle independently
        }
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        setState({
          phase: 'error', question, spec: null, panels: {},
          dashboardError: err instanceof FriendlyError ? err.message : GENERIC_DASHBOARD_ERROR,
        });
      }
    },
    [abortAll, runPanel]
  );

  const reset = useCallback(() => {
    abortAll();
    setState({ phase: 'idle', question: '', spec: null, panels: {}, dashboardError: null });
  }, [abortAll]);

  const retry = useCallback(() => submit(currentQuestionRef.current), [submit]);

  return { ...state, submit, reset, retry };
}
