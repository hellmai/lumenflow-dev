'use client';

import { useState, useMemo, useCallback } from 'react';
import type { MarketplacePackSummary, MarketplaceCategory } from '../lib/marketplace-types';
import {
  MARKETPLACE_PAGE_TITLE,
  SEARCH_PLACEHOLDER,
  ALL_CATEGORIES_LABEL,
  NO_PACKS_MESSAGE,
  CREATE_PACK_CTA_LABEL,
  AUTHORING_GUIDE_URL,
} from '../lib/marketplace-types';
import { loadPersistedWorkspacePath } from '../lib/workspace-connection';
import { CreatePackWizard } from './create-pack-wizard';

/* ------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------ */

const ACTIVE_CATEGORY_CLASS = 'bg-slate-900 text-white';
const INACTIVE_CATEGORY_CLASS = 'bg-slate-100 text-slate-600 hover:bg-slate-200';
const ALL_CATEGORY_ID = 'all';
const INSTALL_API_PATH_PREFIX = '/api/registry/packs';
const INSTALL_FEEDBACK_RESET_DELAY_MS = 5000;
const INSTALL_CARD_BUTTON_LABEL = 'Install';
const INSTALL_CARD_BUTTON_INSTALLING_LABEL = 'Installing...';
const INSTALL_CARD_BUTTON_SUCCESS_LABEL = 'Installed';
const INSTALL_CARD_DISABLED_TOOLTIP = 'Connect a workspace to install packs';
const INSTALL_CARD_FALLBACK_ERROR = 'Install failed';

type InstallFeedback = 'idle' | 'installing' | 'success' | 'error';

/* ------------------------------------------------------------------
 * PackSummaryCard
 * ------------------------------------------------------------------ */

interface PackSummaryCardProps {
  readonly pack: MarketplacePackSummary;
  readonly workspaceRoot: string | null;
}

function PackSummaryCard({ pack, workspaceRoot }: PackSummaryCardProps) {
  const [installFeedback, setInstallFeedback] = useState<InstallFeedback>('idle');
  const [installError, setInstallError] = useState<string | null>(null);
  const isWorkspaceConnected = workspaceRoot !== null;

  const handleInstall = useCallback(async () => {
    if (!workspaceRoot) return;

    setInstallFeedback('installing');
    setInstallError(null);

    try {
      const response = await fetch(
        `${INSTALL_API_PATH_PREFIX}/${encodeURIComponent(pack.id)}/install`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceRoot, version: pack.latestVersion }),
        },
      );
      const body = (await response.json()) as { success: boolean; error?: string };

      if (!response.ok || !body.success) {
        setInstallFeedback('error');
        setInstallError(body.error ?? INSTALL_CARD_FALLBACK_ERROR);
        setTimeout(() => setInstallFeedback('idle'), INSTALL_FEEDBACK_RESET_DELAY_MS);
        return;
      }

      setInstallFeedback('success');
      setTimeout(() => setInstallFeedback('idle'), INSTALL_FEEDBACK_RESET_DELAY_MS);
    } catch (error) {
      const message = error instanceof Error ? error.message : INSTALL_CARD_FALLBACK_ERROR;
      setInstallFeedback('error');
      setInstallError(message);
      setTimeout(() => setInstallFeedback('idle'), INSTALL_FEEDBACK_RESET_DELAY_MS);
    }
  }, [workspaceRoot, pack.id, pack.latestVersion]);

  function getInstallButtonLabel(): string {
    if (installFeedback === 'installing') return INSTALL_CARD_BUTTON_INSTALLING_LABEL;
    if (installFeedback === 'success') return INSTALL_CARD_BUTTON_SUCCESS_LABEL;
    return INSTALL_CARD_BUTTON_LABEL;
  }

  function getInstallButtonClass(): string {
    const base = 'rounded-md px-3 py-1.5 text-xs font-medium transition-colors';
    if (installFeedback === 'success') {
      return `${base} bg-green-600 text-white`;
    }
    if (installFeedback === 'error') {
      return `${base} bg-red-600 text-white hover:bg-red-700`;
    }
    if (!isWorkspaceConnected || installFeedback === 'installing') {
      return `${base} bg-indigo-600 text-white opacity-50 cursor-not-allowed`;
    }
    return `${base} bg-indigo-600 text-white hover:bg-indigo-700`;
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 transition-shadow hover:shadow-md">
      <a data-testid={`pack-link-${pack.id}`} href={`/marketplace/${pack.id}`} className="block">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-slate-900">{pack.id}</h3>
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-500">
                {pack.latestVersion}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{pack.description}</p>
          </div>
        </div>
        {pack.categories.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {pack.categories.map((cat) => (
              <span
                key={`category-${pack.id}-${cat}`}
                className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600"
              >
                {cat}
              </span>
            ))}
          </div>
        )}
      </a>

      <div className="mt-4 border-t border-slate-100 pt-3">
        <button
          type="button"
          data-testid={`install-pack-button-${pack.id}`}
          onClick={() => void handleInstall()}
          disabled={!isWorkspaceConnected || installFeedback === 'installing'}
          title={!isWorkspaceConnected ? INSTALL_CARD_DISABLED_TOOLTIP : undefined}
          className={getInstallButtonClass()}
        >
          {getInstallButtonLabel()}
        </button>
        {installFeedback === 'success' && (
          <p
            data-testid={`install-pack-success-${pack.id}`}
            className="mt-2 text-xs text-green-700"
          >
            Installed {pack.id}@{pack.latestVersion}.
          </p>
        )}
        {installFeedback === 'error' && installError && (
          <p data-testid={`install-pack-error-${pack.id}`} className="mt-2 text-xs text-red-700">
            {installError}
          </p>
        )}
        {!isWorkspaceConnected && (
          <p
            data-testid={`install-pack-disabled-${pack.id}`}
            className="mt-2 text-xs text-slate-400"
          >
            {INSTALL_CARD_DISABLED_TOOLTIP}
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
 * Workspace connection state
 * ------------------------------------------------------------------ */

function usePersistedWorkspaceRoot(): string | null {
  const [workspaceRoot] = useState<string | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      return loadPersistedWorkspacePath(window.localStorage);
    } catch {
      // localStorage unavailable in non-browser contexts
      return null;
    }
  });
  return workspaceRoot;
}

/* ------------------------------------------------------------------
 * MarketplaceBrowse
 * ------------------------------------------------------------------ */

export interface MarketplaceBrowseProps {
  readonly packs: readonly MarketplacePackSummary[];
  readonly categories: readonly MarketplaceCategory[];
}

export function MarketplaceBrowse({ packs, categories }: MarketplaceBrowseProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>(ALL_CATEGORY_ID);
  const workspaceRoot = usePersistedWorkspaceRoot();

  const filteredPacks = useMemo(() => {
    let result = [...packs];

    // Filter by search query
    if (searchQuery.length > 0) {
      const lowerQuery = searchQuery.toLowerCase();
      result = result.filter(
        (pack) =>
          pack.id.toLowerCase().includes(lowerQuery) ||
          pack.description.toLowerCase().includes(lowerQuery),
      );
    }

    // Filter by category
    if (selectedCategory !== ALL_CATEGORY_ID) {
      result = result.filter((pack) => pack.categories.includes(selectedCategory));
    }

    return result;
  }, [packs, searchQuery, selectedCategory]);

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      {/* Header */}
      <div data-testid="marketplace-header" className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {MARKETPLACE_PAGE_TITLE}
          </h1>
          <span className="rounded bg-slate-100 px-2 py-1 text-sm font-medium text-slate-500">
            {packs.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <CreatePackWizard />
          <a
            data-testid="create-pack-cta"
            href={AUTHORING_GUIDE_URL}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            {CREATE_PACK_CTA_LABEL}
          </a>
        </div>
      </div>

      {/* Search */}
      <div>
        <input
          type="text"
          placeholder={SEARCH_PLACEHOLDER}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      {/* Category filters */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="category-filter-all"
          onClick={() => setSelectedCategory(ALL_CATEGORY_ID)}
          className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
            selectedCategory === ALL_CATEGORY_ID ? ACTIVE_CATEGORY_CLASS : INACTIVE_CATEGORY_CLASS
          }`}
        >
          {ALL_CATEGORIES_LABEL}
        </button>
        {categories.map((category) => (
          <button
            type="button"
            key={`category-filter-${category.id}`}
            data-testid={`category-filter-${category.id}`}
            onClick={() => setSelectedCategory(category.id)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              selectedCategory === category.id ? ACTIVE_CATEGORY_CLASS : INACTIVE_CATEGORY_CLASS
            }`}
          >
            {category.label}
            <span className="ml-1 text-xs opacity-60">{category.count}</span>
          </button>
        ))}
      </div>

      {/* Pack grid */}
      {filteredPacks.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredPacks.map((pack) => (
            <PackSummaryCard key={`pack-${pack.id}`} pack={pack} workspaceRoot={workspaceRoot} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
          {NO_PACKS_MESSAGE}
        </div>
      )}
    </div>
  );
}
