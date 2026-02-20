'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MarketplacePackDetail as PackDetailType } from '../lib/marketplace-types';
import type {
  PackRegistryEntry,
  PackVersion,
  PackManifestSummary,
} from '../lib/pack-registry-types';
import { loadPersistedWorkspacePath } from '../lib/workspace-connection';
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
const TRUST_INTEGRITY_BADGE = 'trust-integrity-verified';
const TRUST_MANIFEST_BADGE = 'trust-manifest-parsed';
const TRUST_PUBLISHER_BADGE = 'trust-publisher-verified';
const SCOPE_BADGE_PREFIX = 'scope-';

/* ------------------------------------------------------------------
 * Data transformation
 * ------------------------------------------------------------------ */

type FetchState = 'idle' | 'loading' | 'success' | 'error' | 'not-found';

function findLatestVersion(entry: PackRegistryEntry): PackVersion | null {
  const exactMatch = entry.versions.find((version) => version.version === entry.latestVersion);
  return exactMatch ?? entry.versions[entry.versions.length - 1] ?? null;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function buildTrustBadges(summary: PackManifestSummary | undefined): string[] {
  if (!summary) {
    return [];
  }

  const badges: string[] = [];
  if (summary.trust.integrityVerified) {
    badges.push(TRUST_INTEGRITY_BADGE);
  }
  if (summary.trust.manifestParsed) {
    badges.push(TRUST_MANIFEST_BADGE);
  }
  if (summary.trust.publisherVerified) {
    badges.push(TRUST_PUBLISHER_BADGE);
  }

  for (const permission of summary.trust.permissionScopes) {
    badges.push(`${SCOPE_BADGE_PREFIX}${permission}`);
  }

  return uniqueStrings(badges);
}

function toPackDetail(entry: PackRegistryEntry): PackDetailType {
  const latestVersion = findLatestVersion(entry);
  const manifestSummary = latestVersion?.manifest_summary;
  const categories = uniqueStrings([
    ...(manifestSummary?.categories ?? []),
    ...buildTrustBadges(manifestSummary),
  ]);

  return {
    id: entry.id,
    description: entry.description,
    latestVersion: entry.latestVersion,
    updatedAt: entry.updatedAt,
    categories,
    tools: manifestSummary?.tools ?? [],
    policies: manifestSummary?.policies ?? [],
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
  const workspaceRoot = useMemo(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      return loadPersistedWorkspacePath(window.localStorage);
    } catch {
      return null;
    }
  }, []);

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

  return <MarketplacePackDetail pack={pack} workspaceRoot={workspaceRoot} />;
}
