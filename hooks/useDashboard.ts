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
  // `code` is the API error code (e.g. 'query_timeout') — drives the
  // distinct timeout treatment on the panel error card.
  error?: { friendlyMessage: string; debug?: string | null; code?: string };
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
  // The PRIMARY connection; null = the env-configured one. Panels may
  // override it with their own connectionId ('env' or a connection id).
  const connectionIdRef = useRef<string | null>(null);
  // Additional comparison sources ('env' or connection ids, never the
  // primary). Changing these does NOT reset the conversation — existing
  // panels keep their own sources, so history stays valid.
  const extraConnectionIdsRef = useRef<string[]>([]);
  // Completed turns, oldest first — sent with every /api/dashboard request.
  const historyRef = useRef<HistoryTurn[]>([]);
  // Saved-dashboard id this conversation belongs to; save() updates it in
  // place (PATCH) instead of creating a copy. Cleared when the conversation
  // moves to an unrelated dashboard.
  const savedIdRef = useRef<string | null>(null);
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

  // The connection a panel actually queries: its own override, else the
  // conversation's primary ('env' when the primary is the env connection —
  // the server treats 'env' and null identically).
  const effectiveConnectionId = useCallback(
    (panel: PanelWithId) => panel.connectionId ?? connectionIdRef.current ?? 'env',
    []
  );

  const runPanel = useCallback(
    async (panel: PanelWithId, signal: AbortSignal, sqlOverride?: string, isRepairRun = false) => {
      const sql = sqlOverride ?? panel.sql;
      setPanel(panel.id, { status: isRepairRun ? 'repairing' : 'loading', sql });
      try {
        const res = await fetch('/api/panel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql, chartType: panel.chartType, connectionId: effectiveConnectionId(panel) }),
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
          setPanel(panel.id, {
            status: 'failed',
            error: { friendlyMessage, debug: errBody?.debug, code: errBody?.code },
          });
          maybeFinish();
          return;
        }
        // Raw DB error lives in debug — that's what the repair prompt needs.
        const rawError = (errBody?.debug ?? errBody?.friendlyMessage ?? 'unknown error').slice(0, 2000);
        await attemptRepair(panel, signal, sql, rawError, errBody?.code ?? null);
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        if (isRepairRun) {
          setPanel(panel.id, { status: 'failed', error: { friendlyMessage: GENERIC_PANEL_ERROR } });
          maybeFinish();
          return;
        }
        await attemptRepair(panel, signal, sql, 'network error', null);
      }
    },
    [setPanel, maybeFinish, patchHistorySql, effectiveConnectionId] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const attemptRepair = useCallback(
    async (panel: PanelWithId, signal: AbortSignal, sql: string, errorMessage: string, errorCode: string | null) => {
      setPanel(panel.id, { status: 'repairing' });
      try {
        const res = await fetch('/api/repair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: currentQuestionRef.current, panel, sql, errorMessage, errorCode,
            connectionId: effectiveConnectionId(panel),
          }),
          signal,
        });
        if (!res.ok) throw new Error('repair failed');
        const { sql: repairedSql } = await res.json();
        await runPanel(panel, signal, repairedSql, true);
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        setPanel(panel.id, {
          status: 'failed',
          error: { friendlyMessage: GENERIC_PANEL_ERROR, code: errorCode ?? undefined },
        });
        maybeFinish();
      }
    },
    [setPanel, runPanel, maybeFinish, effectiveConnectionId]
  );

  const submit = useCallback(
    async (question: string) => {
      abortAll();
      currentQuestionRef.current = question;

      const prev = stateRef.current;
      const hasVisible = prev.spec !== null && (prev.phase === 'rendering' || prev.phase === 'done');

      // Results from the visible dashboard, keyed by (connection, SQL) — a
      // follow-up panel with byte-identical SQL against the same source
      // reuses them without re-querying.
      const cacheKey = (conn: string, sql: string) => `${conn} ${sql.trim()}`;
      const cachedBySql = new Map<string, PanelState>();
      if (hasVisible && prev.spec) {
        for (const p of prev.spec.panels) {
          const st = prev.panels[p.id];
          if (st?.status === 'ready') cachedBySql.set(cacheKey(effectiveConnectionId(p), st.sql), st);
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
        const primary = connectionIdRef.current ?? 'env';
        const connectionIds = [primary, ...extraConnectionIdsRef.current.filter((id) => id !== primary)];
        const res = await fetch('/api/dashboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question, history: historyRef.current,
            connectionId: connectionIdRef.current, connectionIds,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => null);
          throw new FriendlyError(errBody?.error?.friendlyMessage ?? GENERIC_DASHBOARD_ERROR);
        }
        const { spec } = (await res.json()) as { spec: DashboardSpecWithIds };

        // A fresh, unrelated dashboard must not overwrite the saved one.
        if (spec.mode === 'new') savedIdRef.current = null;

        historyRef.current = [
          ...historyRef.current,
          {
            question,
            dashboardTitle: spec.title,
            panels: spec.panels.map((p) => ({
              title: p.title, chartType: p.chartType, sql: p.sql, connectionId: p.connectionId,
            })),
          },
        ].slice(-MAX_HISTORY_TURNS);

        const initialPanels: Record<string, PanelState> = {};
        const toFetch: PanelWithId[] = [];
        for (const p of spec.panels) {
          const cached = cachedBySql.get(cacheKey(effectiveConnectionId(p), p.sql));
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
    [abortAll, runPanel, effectiveConnectionId]
  );

  const reset = useCallback(() => {
    abortAll();
    historyRef.current = [];
    currentQuestionRef.current = '';
    savedIdRef.current = null;
    setState({ phase: 'idle', question: '', spec: null, panels: {}, dashboardError: null });
  }, [abortAll]);

  const retry = useCallback(() => submit(currentQuestionRef.current), [submit]);

  // Point subsequent requests at a different PRIMARY connection. The
  // conversation is reset: history against one database makes no sense
  // against another.
  const setConnectionId = useCallback(
    (id: string | null) => {
      if (id !== connectionIdRef.current) {
        connectionIdRef.current = id;
        reset();
      }
    },
    [reset]
  );

  // Add/remove comparison sources. Unlike switching the primary, this keeps
  // the conversation — existing panels keep their own sources.
  const setExtraConnectionIds = useCallback((ids: string[]) => {
    const primary = connectionIdRef.current ?? 'env';
    extraConnectionIdsRef.current = [...new Set(ids.filter((id) => id !== primary))];
  }, []);

  // Timeout recovery: honestly re-plan the panel through /api/dashboard with
  // a synthetic follow-up turn — never string-edit SQL client-side.
  const narrowPanel = useCallback(
    (panel: PanelWithId) => {
      void submit(`Restrict the "${panel.title}" panel to the most recent 90 days of data`);
    },
    [submit]
  );

  // Persist the dashboard currently on screen (each panel with the SQL that
  // actually ran, post-repair). First save creates it; saving again in the
  // same conversation (or after reopening) updates it in place. Returns the
  // saved dashboard's id.
  const save = useCallback(async (title: string): Promise<string> => {
    const s = stateRef.current;
    if (!s.spec) throw new Error('nothing to save');
    const panels = s.spec.panels.map((p) => ({ ...p, sql: s.panels[p.id]?.sql ?? p.sql }));
    const readyPanelIds = s.spec.panels.filter((p) => s.panels[p.id]?.status === 'ready').map((p) => p.id);
    const spec = { mode: s.spec.mode, title: s.spec.title, summary: s.spec.summary, panels };

    const savedId = savedIdRef.current;
    const res = await fetch(savedId ? `/api/dashboards/${savedId}` : '/api/dashboards', {
      method: savedId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        savedId
          ? { title, spec, history: historyRef.current, readyPanelIds }
          : {
              connectionId: connectionIdRef.current,
              title,
              question: currentQuestionRef.current,
              spec,
              history: historyRef.current,
              readyPanelIds,
            }
      ),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.dashboard?.id) {
      // A stale id (dashboard deleted elsewhere) shouldn't wedge saving.
      if (savedId && res.status === 404) savedIdRef.current = null;
      throw new Error(body?.error?.friendlyMessage ?? 'Saving failed. Please try again.');
    }
    savedIdRef.current = body.dashboard.id as string;
    return body.dashboard.id as string;
  }, []);

  // Reopen a saved dashboard: restore spec + conversation history + the
  // connection, then re-run every panel through the normal /api/panel path
  // (the saved artifact is the spec; the data stays live).
  const loadSaved = useCallback(
    (saved: {
      id: string;
      question: string;
      connectionId: string | null;
      spec: DashboardSpecWithIds;
      history: HistoryTurn[];
    }) => {
      abortAll();
      savedIdRef.current = saved.id;
      connectionIdRef.current = saved.connectionId;
      // Rebuild the comparison-source set from the panels' own connections
      // so follow-up turns still see every source this dashboard uses.
      const primary = saved.connectionId ?? 'env';
      extraConnectionIdsRef.current = [
        ...new Set(
          saved.spec.panels
            .map((p) => p.connectionId)
            .filter((c): c is string => c !== null && c !== primary)
        ),
      ];
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

  return {
    ...state, submit, reset, retry, setConnectionId, setExtraConnectionIds,
    narrowPanel, save, loadSaved,
  };
}
