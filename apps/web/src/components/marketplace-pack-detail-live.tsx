'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MarketplacePackDetail as PackDetailType } from '../lib/marketplace-types';
import type { PackRegistryEntry } from '../lib/pack-registry-types';
import { MarketplacePackDetail } from './marketplace-pack-detail';

/* ------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------ */

const REGISTRY_API_PATH_PREFIX = '/api/registry/packs';
const LOADING_MESSAGE = 'Loading pack details...';
const ERROR_MESSAGE_PREFIX = 'Failed to load pack details';
const NOT_FOUND_MESSAGE = 'Pack not found.';
const RETRY_LABEL = 'Retry';
const BACK_LABEL = 'Back to Marketplace';
const MARKETPLACE_PATH = '/marketplace';

/* ------------------------------------------------------------------
 * Data transformation
 * ------------------------------------------------------------------ */

type FetchState = 'idle' | 'loading' | 'success' | 'error' | 'not-found';

function toPackDetail(entry: PackRegistryEntry): PackDetailType {
  // In production, tools and policies would come from the pack manifest.
  // For now, we expose the pack metadata with empty tools/policies
  // that can be populated once manifest parsing is added.
  return {
    id: entry.id,
    description: entry.description,
    latestVersion: entry.latestVersion,
    updatedAt: entry.updatedAt,
    categories: [],
    tools: [],
    policies: [],
  };
}

/* ------------------------------------------------------------------
 * Hook
 * ------------------------------------------------------------------ */

interface UsePackDetailDataResult {
  readonly state: FetchState;
  readonly pack: PackDetailType | null;
  readonly errorMessage: string | null;
  readonly refetch: () => void;
}

function usePackDetailData(packId: string): UsePackDetailDataResult {
  const [state, setState] = useState<FetchState>('idle');
  const [pack, setPack] = useState<PackDetailType | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setState('loading');
    setErrorMessage(null);

    try {
      const response = await fetch(`${REGISTRY_API_PATH_PREFIX}/${encodeURIComponent(packId)}`);

      if (response.status === 404) {
        setState('not-found');
        return;
      }

      if (!response.ok) {
        throw new Error(`${ERROR_MESSAGE_PREFIX}: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        success: boolean;
        pack: PackRegistryEntry;
      };
      const detail = toPackDetail(data.pack);

      setPack(detail);
      setState('success');
    } catch (error) {
      const message = error instanceof Error ? error.message : ERROR_MESSAGE_PREFIX;
      setErrorMessage(message);
      setState('error');
    }
  }, [packId]);

  const refetch = useCallback(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { state, pack, errorMessage, refetch };
}

/* ------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------ */

interface MarketplacePackDetailLiveProps {
  readonly packId: string;
}

export function MarketplacePackDetailLive({ packId }: MarketplacePackDetailLiveProps) {
  const { state, pack, errorMessage, refetch } = usePackDetailData(packId);

  if (state === 'idle' || state === 'loading') {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="animate-pulse rounded-lg bg-slate-100 p-8 text-center text-sm text-slate-400">
          {LOADING_MESSAGE}
        </div>
      </div>
    );
  }

  if (state === 'not-found') {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-lg border border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-500">{NOT_FOUND_MESSAGE}</p>
          <a
            href={MARKETPLACE_PATH}
            className="mt-4 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
          >
            {BACK_LABEL}
          </a>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="mx-auto max-w-4xl p-6">
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

  if (!pack) {
    return null;
  }

  return <MarketplacePackDetail pack={pack} />;
}
