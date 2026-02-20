'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DashboardEvent } from '../lib/dashboard-types';
import { buildWorkspaceOverview } from '../lib/workspace-data';
import type { WorkspaceOverviewData } from '../lib/workspace-types';
import { WorkspaceOverview } from './workspace-overview';

const EVENTS_API_PATH = '/api/events/all';
const LOADING_MESSAGE = 'Loading workspace data...';
const ERROR_MESSAGE_PREFIX = 'Failed to load workspace data';
const RETRY_LABEL = 'Retry';

type FetchState = 'idle' | 'loading' | 'success' | 'error';

interface UseWorkspaceDataResult {
  readonly state: FetchState;
  readonly data: WorkspaceOverviewData | null;
  readonly errorMessage: string | null;
  readonly refetch: () => void;
}

function parseEventsResponse(events: unknown[]): DashboardEvent[] {
  return events
    .filter(
      (event): event is Record<string, unknown> => typeof event === 'object' && event !== null,
    )
    .filter((event) => typeof event.kind === 'string' && typeof event.timestamp === 'string')
    .map((event) => ({
      id: String(event.id ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      kind: String(event.kind),
      timestamp: String(event.timestamp),
      taskId: String(event.task_id ?? ''),
      data: Object.fromEntries(
        Object.entries(event).filter(
          ([key]) => !['id', 'kind', 'timestamp', 'task_id', 'schema_version'].includes(key),
        ),
      ),
    }));
}

function useWorkspaceData(): UseWorkspaceDataResult {
  const [state, setState] = useState<FetchState>('idle');
  const [data, setData] = useState<WorkspaceOverviewData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setState('loading');
    setErrorMessage(null);

    try {
      const response = await fetch(EVENTS_API_PATH);
      if (!response.ok) {
        throw new Error(`${ERROR_MESSAGE_PREFIX}: ${response.statusText}`);
      }

      const json: unknown = await response.json();
      const rawEvents: unknown[] = Array.isArray(json)
        ? json
        : Array.isArray((json as Record<string, unknown>)?.events)
          ? ((json as Record<string, unknown>).events as unknown[])
          : [];
      const events = parseEventsResponse(rawEvents);
      const overview = buildWorkspaceOverview(events);

      setData(overview);
      setState('success');
    } catch (error) {
      const message = error instanceof Error ? error.message : ERROR_MESSAGE_PREFIX;
      setErrorMessage(message);
      setState('error');
    }
  }, []);

  const refetch = useCallback(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { state, data, errorMessage, refetch };
}

/**
 * Client component that fetches all workspace events and renders
 * the workspace overview with task list and lane WIP visualization.
 */
export function WorkspaceOverviewLive() {
  const { state, data, errorMessage, refetch } = useWorkspaceData();

  if (state === 'idle' || state === 'loading') {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="animate-pulse rounded-lg bg-slate-100 p-8 text-center text-sm text-slate-400">
          {LOADING_MESSAGE}
        </div>
      </div>
    );
  }

  if (state === 'error' || !data) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
          <p className="text-sm text-red-700">{errorMessage ?? ERROR_MESSAGE_PREFIX}</p>
          <button
            type="button"
            onClick={refetch}
            className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
          >
            {RETRY_LABEL}
          </button>
        </div>
      </div>
    );
  }

  return (
    <WorkspaceOverview
      statusGroups={data.statusGroups}
      laneWipEntries={data.laneWipEntries}
      totalCount={data.totalCount}
      statusCounts={data.statusCounts}
    />
  );
}
