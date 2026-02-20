'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PackCatalogEntry } from '../lib/pack-catalog-types';
import { loadPersistedWorkspacePath } from '../lib/workspace-connection';
import { PackCatalog } from './pack-catalog';

const PACKS_API_PATH = '/api/workspace/packs';
const WORKSPACE_ROOT_QUERY_PARAM = 'workspaceRoot';
const DASHBOARD_BASE_URL = '/dashboard';
const LOADING_MESSAGE = 'Loading workspace packs...';
const ERROR_MESSAGE_PREFIX = 'Failed to load pack catalog';
const DISCONNECTED_MESSAGE = 'Connect a workspace to view loaded packs.';
const DISCONNECTED_HINT =
  'Connect your workspace in the dashboard first, then return to this page.';
const RETRY_LABEL = 'Retry';

type FetchState = 'idle' | 'loading' | 'success' | 'error' | 'disconnected';

interface UsePackCatalogDataResult {
  readonly state: FetchState;
  readonly packs: readonly PackCatalogEntry[];
  readonly errorMessage: string | null;
  readonly refetch: () => void;
}

function parsePacksResponse(rawPacks: unknown[]): PackCatalogEntry[] {
  return rawPacks
    .filter((pack): pack is Record<string, unknown> => typeof pack === 'object' && pack !== null)
    .filter(
      (pack) =>
        typeof pack.id === 'string' &&
        typeof pack.version === 'string' &&
        typeof pack.source === 'string',
    )
    .map((pack) => ({
      id: String(pack.id),
      version: String(pack.version),
      source: pack.source as 'local' | 'git' | 'registry',
      integrity: typeof pack.integrity === 'string' ? pack.integrity : 'unknown',
      tools: Array.isArray(pack.tools) ? pack.tools : [],
      policies: Array.isArray(pack.policies) ? pack.policies : [],
      taskTypes: Array.isArray(pack.taskTypes) ? pack.taskTypes : [],
      evidenceTypes: Array.isArray(pack.evidenceTypes) ? pack.evidenceTypes : [],
    }));
}

function extractRawPacksResponse(json: unknown): unknown[] {
  if (Array.isArray(json)) {
    return json;
  }

  if (typeof json === 'object' && json !== null) {
    const record = json as Record<string, unknown>;
    if (Array.isArray(record.packs)) {
      return record.packs;
    }
  }

  return [];
}

function extractErrorMessage(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) {
    return null;
  }

  const record = json as Record<string, unknown>;
  if (record.success === false && typeof record.error === 'string') {
    return record.error;
  }
  if (typeof record.error === 'string') {
    return record.error;
  }
  return null;
}

function buildPacksApiPath(workspaceRoot: string): string {
  const query = new URLSearchParams({
    [WORKSPACE_ROOT_QUERY_PARAM]: workspaceRoot,
  });
  return `${PACKS_API_PATH}?${query.toString()}`;
}

function resolvePersistedWorkspaceRoot(): string | null {
  try {
    return loadPersistedWorkspacePath(localStorage);
  } catch {
    return null;
  }
}

function usePackCatalogData(): UsePackCatalogDataResult {
  const workspaceRoot = resolvePersistedWorkspaceRoot();
  const [state, setState] = useState<FetchState>(workspaceRoot ? 'idle' : 'disconnected');
  const [packs, setPacks] = useState<readonly PackCatalogEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!workspaceRoot) {
      setState('disconnected');
      setPacks([]);
      setErrorMessage(null);
      return;
    }

    setState('loading');
    setErrorMessage(null);

    try {
      const response = await fetch(buildPacksApiPath(workspaceRoot));
      const json: unknown = await response.json();
      const responseError = extractErrorMessage(json);

      if (!response.ok) {
        const responseErrorMessage = responseError ?? response.statusText ?? 'Request failed';
        throw new Error(`${ERROR_MESSAGE_PREFIX}: ${responseErrorMessage}`);
      }

      if (responseError) {
        throw new Error(`${ERROR_MESSAGE_PREFIX}: ${responseError}`);
      }

      const rawPacks = extractRawPacksResponse(json);
      const parsedPacks = parsePacksResponse(rawPacks);

      setPacks(parsedPacks);
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
    if (workspaceRoot) {
      void fetchData();
    }
  }, [workspaceRoot, fetchData]);

  return { state, packs, errorMessage, refetch };
}

/**
 * Client component that fetches loaded packs from the kernel HTTP surface
 * and renders the pack catalog with tool and policy visualization.
 */
export function PackCatalogLive() {
  const { state, packs, errorMessage, refetch } = usePackCatalogData();

  if (state === 'disconnected') {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div
          data-testid="pack-catalog-disconnected"
          className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center"
        >
          <p className="text-sm font-medium text-slate-700">{DISCONNECTED_MESSAGE}</p>
          <p className="mt-2 text-xs text-slate-500">{DISCONNECTED_HINT}</p>
        </div>
      </div>
    );
  }

  if (state === 'idle' || state === 'loading') {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="animate-pulse rounded-lg bg-slate-100 p-8 text-center text-sm text-slate-400">
          {LOADING_MESSAGE}
        </div>
      </div>
    );
  }

  if (state === 'error') {
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

  return <PackCatalog packs={packs} traceBaseUrl={DASHBOARD_BASE_URL} />;
}
