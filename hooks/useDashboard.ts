'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardSpecWithIds, PanelWithId, ColumnMeta, HistoryTurn } from '@/lib/types';
import { MAX_HISTORY_TURNS } from '@/lib/types';

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

// With conversation follow-ups, two states beyond the original machine exist:
// phase 'planning' with a non-null spec (previous dashboard stays visible while
// the follow-up is designed) and phase 'done' with a non-null dashboardError
// (a follow-up failed; the previous dashboard is kept with an error banner).

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
  // Which connection every API call targets; null = the env-configured one.
  const connectionIdRef = useRef<string | null>(null);
  // Completed turns, oldest first — sent with every /api/dashboard request.
  const historyRef = useRef<HistoryTurn[]>([]);
  // Mirror of state for reads inside async callbacks (submit closures).
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });

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

  // When a repair produced the working SQL, record it in the last history turn
  // so the next turn's model carries over the query that actually ran — not
  // the broken original.
  const patchHistorySql = useCallback((panelId: string, sql: string) => {
    const last = historyRef.current[historyRef.current.length - 1];
    const index = Number(panelId.replace('panel-', ''));
    if (last && Number.isInteger(index) && last.panels[index]) {
      last.panels[index] = { ...last.panels[index], sql };
    }
  }, []);

  const runPanel = useCallback(
    async (panel: PanelWithId, signal: AbortSignal, sqlOverride?: string, isRepairRun = false) => {
      const sql = sqlOverride ?? panel.sql;
      setPanel(panel.id, { status: isRepairRun ? 'repairing' : 'loading', sql });
      try {
        const res = await fetch('/api/panel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql, chartType: panel.chartType, connectionId: connectionIdRef.current }),
          signal,
        });
        const body = await res.json().catch(() => null);
        if (res.ok && body && !body.error) {
          setPanel(panel.id, { status: 'ready', columns: body.columns, rows: body.rows, truncated: body.truncated });
          if (isRepairRun) patchHistorySql(panel.id, sql);
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
    [setPanel, maybeFinish, patchHistorySql] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const attemptRepair = useCallback(
    async (panel: PanelWithId, signal: AbortSignal, sql: string, errorMessage: string) => {
      setPanel(panel.id, { status: 'repairing' });
      try {
        const res = await fetch('/api/repair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: currentQuestionRef.current, panel, sql, errorMessage,
            connectionId: connectionIdRef.current,
          }),
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

      const prev = stateRef.current;
      const hasVisible = prev.spec !== null && (prev.phase === 'rendering' || prev.phase === 'done');

      // Results from the visible dashboard, keyed by the SQL that produced
      // them — a follow-up panel with byte-identical SQL reuses them without
      // re-querying.
      const cachedBySql = new Map<string, PanelState>();
      if (hasVisible && prev.spec) {
        for (const p of prev.spec.panels) {
          const st = prev.panels[p.id];
          if (st?.status === 'ready') cachedBySql.set(st.sql.trim(), st);
        }
      }

      // Follow-ups keep the current dashboard on screen while planning.
      setState({
        phase: 'planning',
        question,
        spec: hasVisible ? prev.spec : null,
        panels: hasVisible ? prev.panels : {},
        dashboardError: null,
      });

      const controller = new AbortController();
      dashboardControllerRef.current = controller;
      try {
        const res = await fetch('/api/dashboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question, history: historyRef.current, connectionId: connectionIdRef.current,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => null);
          throw new FriendlyError(errBody?.error?.friendlyMessage ?? GENERIC_DASHBOARD_ERROR);
        }
        const { spec } = (await res.json()) as { spec: DashboardSpecWithIds };

        historyRef.current = [
          ...historyRef.current,
          {
            question,
            dashboardTitle: spec.title,
            panels: spec.panels.map((p) => ({ title: p.title, chartType: p.chartType, sql: p.sql })),
          },
        ].slice(-MAX_HISTORY_TURNS);

        const initialPanels: Record<string, PanelState> = {};
        const toFetch: PanelWithId[] = [];
        for (const p of spec.panels) {
          const cached = cachedBySql.get(p.sql.trim());
          if (cached) {
            initialPanels[p.id] = {
              status: 'ready', sql: cached.sql,
              columns: cached.columns, rows: cached.rows, truncated: cached.truncated,
            };
          } else {
            initialPanels[p.id] = { status: 'loading', sql: p.sql };
            toFetch.push(p);
          }
        }
        setState({
          phase: toFetch.length === 0 ? 'done' : 'rendering',
          question, spec, panels: initialPanels, dashboardError: null,
        });

        for (const p of toFetch) {
          const panelController = new AbortController();
          panelControllersRef.current.set(p.id, panelController);
          runPanel(p, panelController.signal); // fire-and-forget: panels settle independently
        }
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        const message = err instanceof FriendlyError ? err.message : GENERIC_DASHBOARD_ERROR;
        if (hasVisible && prev.spec) {
          // Follow-up failed: keep the previous dashboard, surface a banner.
          // Panels that were still in flight were aborted above — settle them
          // as failed rather than leaving permanent skeletons.
          const restoredPanels = Object.fromEntries(
            Object.entries(prev.panels).map(([id, p]) => [
              id,
              p.status === 'ready' || p.status === 'failed'
                ? p
                : { ...p, status: 'failed' as const, error: { friendlyMessage: GENERIC_PANEL_ERROR } },
            ])
          );
          setState({
            phase: 'done', question: prev.question, spec: prev.spec,
            panels: restoredPanels, dashboardError: message,
          });
        } else {
          setState({ phase: 'error', question, spec: null, panels: {}, dashboardError: message });
        }
      }
    },
    [abortAll, runPanel]
  );

  const reset = useCallback(() => {
    abortAll();
    historyRef.current = [];
    currentQuestionRef.current = '';
    setState({ phase: 'idle', question: '', spec: null, panels: {}, dashboardError: null });
  }, [abortAll]);

  const retry = useCallback(() => submit(currentQuestionRef.current), [submit]);

  // Point subsequent requests at a different connection. The conversation is
  // reset: history against one database makes no sense against another.
  const setConnectionId = useCallback(
    (id: string | null) => {
      if (id !== connectionIdRef.current) {
        connectionIdRef.current = id;
        reset();
      }
    },
    [reset]
  );

  // Persist the dashboard currently on screen (each panel with the SQL that
  // actually ran, post-repair). Returns the saved dashboard's id.
  const save = useCallback(async (title: string): Promise<string> => {
    const s = stateRef.current;
    if (!s.spec) throw new Error('nothing to save');
    const panels = s.spec.panels.map((p) => ({ ...p, sql: s.panels[p.id]?.sql ?? p.sql }));
    const readyPanelIds = s.spec.panels.filter((p) => s.panels[p.id]?.status === 'ready').map((p) => p.id);
    const res = await fetch('/api/dashboards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connectionId: connectionIdRef.current,
        title,
        question: currentQuestionRef.current,
        spec: { mode: s.spec.mode, title: s.spec.title, summary: s.spec.summary, panels },
        history: historyRef.current,
        readyPanelIds,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.dashboard?.id) {
      throw new Error(body?.error?.friendlyMessage ?? 'Saving failed. Please try again.');
    }
    return body.dashboard.id as string;
  }, []);

  // Reopen a saved dashboard: restore spec + conversation history + the
  // connection, then re-run every panel through the normal /api/panel path
  // (the saved artifact is the spec; the data stays live).
  const loadSaved = useCallback(
    (saved: {
      question: string;
      connectionId: string | null;
      spec: DashboardSpecWithIds;
      history: HistoryTurn[];
    }) => {
      abortAll();
      connectionIdRef.current = saved.connectionId;
      historyRef.current = saved.history;
      const question = saved.question || saved.history[saved.history.length - 1]?.question || '';
      currentQuestionRef.current = question;

      const initialPanels: Record<string, PanelState> = {};
      for (const p of saved.spec.panels) {
        initialPanels[p.id] = { status: 'loading', sql: p.sql };
      }
      setState({ phase: 'rendering', question, spec: saved.spec, panels: initialPanels, dashboardError: null });

      for (const p of saved.spec.panels) {
        const panelController = new AbortController();
        panelControllersRef.current.set(p.id, panelController);
        runPanel(p, panelController.signal);
      }
    },
    [abortAll, runPanel]
  );

  return { ...state, submit, reset, retry, setConnectionId, save, loadSaved };
}
