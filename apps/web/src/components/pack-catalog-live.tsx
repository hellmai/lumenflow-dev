'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PackCatalogEntry } from '../lib/pack-catalog-types';
import { PackCatalog } from './pack-catalog';

const PACKS_API_PATH = '/api/packs';
const DASHBOARD_BASE_URL = '/dashboard';
const LOADING_MESSAGE = 'Loading pack catalog...';
const ERROR_MESSAGE_PREFIX = 'Failed to load pack catalog';
const RETRY_LABEL = 'Retry';

type FetchState = 'idle' | 'loading' | 'success' | 'error';

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

function usePackCatalogData(): UsePackCatalogDataResult {
  const [state, setState] = useState<FetchState>('idle');
  const [packs, setPacks] = useState<readonly PackCatalogEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setState('loading');
    setErrorMessage(null);

    try {
      const response = await fetch(PACKS_API_PATH);
      if (!response.ok) {
        throw new Error(`${ERROR_MESSAGE_PREFIX}: ${response.statusText}`);
      }

      const json: unknown = await response.json();
      const rawPacks: unknown[] = Array.isArray(json)
        ? json
        : Array.isArray((json as Record<string, unknown>)?.packs)
          ? ((json as Record<string, unknown>).packs as unknown[])
          : [];
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
    void fetchData();
  }, [fetchData]);

  return { state, packs, errorMessage, refetch };
}

/**
 * Client component that fetches loaded packs from the kernel HTTP surface
 * and renders the pack catalog with tool and policy visualization.
 */
export function PackCatalogLive() {
  const { state, packs, errorMessage, refetch } = usePackCatalogData();

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
