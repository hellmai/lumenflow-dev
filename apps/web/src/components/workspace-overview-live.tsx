'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TaskSpec } from '@lumenflow/kernel';
import type { DashboardEvent } from '../lib/dashboard-types';
import { buildWorkspaceOverview } from '../lib/workspace-data';
import type { WorkspaceOverviewData } from '../lib/workspace-types';
import { useWorkspaceConnection } from '../hooks/use-workspace-connection';
import { WorkspaceConnectionStatus, WorkspacePathPrompt } from './workspace-connector';
import { type CreateTaskInput, WorkspaceOverview } from './workspace-overview';

const EVENTS_API_PATH = '/api/events/all';
const TASKS_API_PATH = '/api/tasks';
const LOADING_MESSAGE = 'Loading workspace data...';
const ERROR_MESSAGE_PREFIX = 'Failed to load workspace data';
const ERROR_CREATE_TASK_PREFIX = 'Failed to create task';
const ERROR_CREATE_TASK_NO_WORKSPACE = 'Workspace is not connected';
const RETRY_LABEL = 'Retry';
const TASK_ID_PREFIX = 'task-web-';
const UUID_BYTE_LENGTH = 16;
const UUID_VERSION_INDEX = 6;
const UUID_VARIANT_INDEX = 8;
const UUID_VERSION_4_MASK = 0x40;
const UUID_VERSION_CLEAR_MASK = 0x0f;
const UUID_VARIANT_RFC4122_MASK = 0x80;
const UUID_VARIANT_CLEAR_MASK = 0x3f;
const HEX_PAD_WIDTH = 2;
const DEFAULT_TASK_DOMAIN = 'software-delivery';
const DEFAULT_TASK_TYPE = 'feature';
const ACCEPTANCE_PREFIX = 'Deliver: ';
const CREATED_DATE_SEPARATOR = 'T';
const JSON_CONTENT_TYPE = 'application/json';

type FetchState = 'idle' | 'loading' | 'success' | 'error';

interface UseWorkspaceDataResult {
  readonly state: FetchState;
  readonly data: WorkspaceOverviewData | null;
  readonly errorMessage: string | null;
  readonly refetch: () => void;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseEventsResponse(events: unknown[]): DashboardEvent[] {
  return events
    .filter((event): event is Record<string, unknown> => isObjectRecord(event))
    .filter((event) => typeof event.kind === 'string' && typeof event.timestamp === 'string')
    .map((event, index) => ({
      id: typeof event.id === 'string' && event.id.length > 0 ? event.id : `evt-${index}`,
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

function useWorkspaceData(enabled: boolean): UseWorkspaceDataResult {
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
    if (!enabled) {
      return;
    }
    void fetchData();
  }, [enabled, fetchData]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void fetchData();
  }, [enabled, fetchData]);

  return { state, data, errorMessage, refetch };
}

function generateClientUUID(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(UUID_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  const versionByte = bytes[UUID_VERSION_INDEX] ?? 0;
  const variantByte = bytes[UUID_VARIANT_INDEX] ?? 0;
  bytes[UUID_VERSION_INDEX] = (versionByte & UUID_VERSION_CLEAR_MASK) | UUID_VERSION_4_MASK;
  bytes[UUID_VARIANT_INDEX] = (variantByte & UUID_VARIANT_CLEAR_MASK) | UUID_VARIANT_RFC4122_MASK;
  const hex = [...bytes].map((b) => b.toString(16).padStart(HEX_PAD_WIDTH, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getTodayDate(): string {
  return new Date().toISOString().split(CREATED_DATE_SEPARATOR)[0] ?? '';
}

function buildTaskSpec(input: CreateTaskInput, workspaceId: string): TaskSpec {
  return {
    id: `${TASK_ID_PREFIX}${generateClientUUID()}`,
    workspace_id: workspaceId,
    lane_id: input.laneId,
    domain: DEFAULT_TASK_DOMAIN,
    title: input.title,
    description: input.description,
    acceptance: [`${ACCEPTANCE_PREFIX}${input.title}`],
    declared_scopes: [],
    risk: input.risk,
    type: DEFAULT_TASK_TYPE,
    priority: input.priority,
    created: getTodayDate(),
  };
}

async function extractApiError(response: Response, fallbackMessage: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isObjectRecord(body) && typeof body.error === 'string') {
      return body.error;
    }
  } catch {
    // Non-JSON response body: return fallback message.
  }

  if (response.statusText.length > 0) {
    return `${fallbackMessage}: ${response.statusText}`;
  }
  return fallbackMessage;
}

/**
 * Client component that fetches all workspace events and renders
 * the workspace overview with task list and lane WIP visualization.
 */
export function WorkspaceOverviewLive() {
  const {
    state: workspaceConnectionState,
    connect,
    disconnect,
    isConnecting,
  } = useWorkspaceConnection();
  const isConnected = workspaceConnectionState.status === 'connected';
  const { state, data, errorMessage, refetch } = useWorkspaceData(isConnected);

  const handleConnect = useCallback(
    (workspacePath: string) => {
      void connect(workspacePath);
    },
    [connect],
  );

  const handleCreateTask = useCallback(
    async (input: CreateTaskInput): Promise<void> => {
      const workspaceInfo = workspaceConnectionState.workspaceInfo;
      if (!workspaceInfo) {
        throw new Error(ERROR_CREATE_TASK_NO_WORKSPACE);
      }

      const taskSpec = buildTaskSpec(input, workspaceInfo.workspaceId);
      const response = await fetch(TASKS_API_PATH, {
        method: 'POST',
        headers: {
          'Content-Type': JSON_CONTENT_TYPE,
        },
        body: JSON.stringify(taskSpec),
      });

      if (!response.ok) {
        throw new Error(await extractApiError(response, ERROR_CREATE_TASK_PREFIX));
      }

      refetch();
    },
    [refetch, workspaceConnectionState.workspaceInfo],
  );

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <WorkspacePathPrompt onConnect={handleConnect} isConnecting={isConnecting} />
        {workspaceConnectionState.status !== 'disconnected' && (
          <WorkspaceConnectionStatus state={workspaceConnectionState} onDisconnect={disconnect} />
        )}
      </div>
    );
  }

  if (state === 'idle' || state === 'loading') {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <WorkspaceConnectionStatus state={workspaceConnectionState} onDisconnect={disconnect} />
        <div className="animate-pulse rounded-lg bg-slate-100 p-8 text-center text-sm text-slate-400">
          {LOADING_MESSAGE}
        </div>
      </div>
    );
  }

  if (state === 'error' || !data) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <WorkspaceConnectionStatus state={workspaceConnectionState} onDisconnect={disconnect} />
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
    <>
      <div className="mx-auto max-w-5xl px-6 pt-6">
        <WorkspaceConnectionStatus state={workspaceConnectionState} onDisconnect={disconnect} />
      </div>
      <WorkspaceOverview
        statusGroups={data.statusGroups}
        laneWipEntries={data.laneWipEntries}
        totalCount={data.totalCount}
        statusCounts={data.statusCounts}
        workspaceConnected={true}
        onCreateTask={handleCreateTask}
      />
    </>
  );
}
