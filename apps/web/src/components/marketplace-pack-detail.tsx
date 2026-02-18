'use client';

import { useState, useCallback } from 'react';
import type {
  MarketplacePackDetail as PackDetailType,
  MarketplaceToolView,
  MarketplacePolicyView,
} from '../lib/marketplace-types';
import {
  generateInstallCommand,
  INSTALL_BUTTON_LABEL,
  INSTALL_COPIED_LABEL,
  BACK_TO_MARKETPLACE_LABEL,
  CREATE_PACK_CTA_LABEL,
  AUTHORING_GUIDE_URL,
} from '../lib/marketplace-types';

/* ------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------ */

const SECTION_TITLE_CLASS = 'text-sm font-semibold uppercase tracking-wide text-slate-500';

const PERMISSION_BADGE_COLORS = new Map<string, string>([
  ['read', 'bg-blue-100 text-blue-700'],
  ['write', 'bg-amber-100 text-amber-700'],
  ['admin', 'bg-red-100 text-red-700'],
]);

const DECISION_BADGE_COLORS = new Map<string, string>([
  ['allow', 'bg-green-100 text-green-700'],
  ['deny', 'bg-red-100 text-red-700'],
]);

const DEFAULT_BADGE_COLOR = 'bg-slate-100 text-slate-600';

const COPY_RESET_DELAY_MS = 2000;

const TOOLS_EMPTY_MESSAGE = 'No tools defined.';
const POLICIES_EMPTY_MESSAGE = 'No policies defined.';

/* ------------------------------------------------------------------
 * ToolItem
 * ------------------------------------------------------------------ */

interface ToolItemProps {
  readonly tool: MarketplaceToolView;
}

function ToolItem({ tool }: ToolItemProps) {
  return (
    <div className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium text-slate-800">{tool.name}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              PERMISSION_BADGE_COLORS.get(tool.permission) ?? DEFAULT_BADGE_COLOR
            }`}
          >
            {tool.permission}
          </span>
        </div>
        {tool.description && <span className="text-xs text-slate-500">{tool.description}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
 * PolicyItem
 * ------------------------------------------------------------------ */

interface PolicyItemProps {
  readonly policy: MarketplacePolicyView;
}

function PolicyItem({ policy }: PolicyItemProps) {
  return (
    <div className="flex items-center gap-2 rounded border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
          DECISION_BADGE_COLORS.get(policy.decision) ?? DEFAULT_BADGE_COLOR
        }`}
      >
        {policy.decision}
      </span>
      <span className="font-mono text-slate-700">{policy.id}</span>
      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-500">
        {policy.trigger}
      </span>
      {policy.reason && <span className="text-xs text-slate-400">{policy.reason}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------
 * InstallSection
 * ------------------------------------------------------------------ */

interface InstallSectionProps {
  readonly packId: string;
  readonly version: string;
}

function InstallSection({ packId, version }: InstallSectionProps) {
  const [copied, setCopied] = useState(false);
  const installCommand = generateInstallCommand(packId, version);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(installCommand).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_RESET_DELAY_MS);
    });
  }, [installCommand]);

  return (
    <div data-testid="pack-detail-install" className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className={SECTION_TITLE_CLASS}>Install</h3>
      </div>
      <div className="flex items-center justify-between px-4 py-3">
        <code className="rounded bg-slate-50 px-3 py-2 font-mono text-sm text-slate-800">
          {installCommand}
        </code>
        <button
          type="button"
          data-testid="copy-install-button"
          onClick={handleCopy}
          className="ml-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
        >
          {copied ? INSTALL_COPIED_LABEL : INSTALL_BUTTON_LABEL}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
 * MarketplacePackDetail
 * ------------------------------------------------------------------ */

export interface MarketplacePackDetailProps {
  readonly pack: PackDetailType;
}

export function MarketplacePackDetail({ pack }: MarketplacePackDetailProps) {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Back link */}
      <a
        href="/marketplace"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        {BACK_TO_MARKETPLACE_LABEL}
      </a>

      {/* Header */}
      <div data-testid="pack-detail-header">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{pack.id}</h1>
          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-sm text-slate-500">
            {pack.latestVersion}
          </span>
        </div>
        <p className="mt-2 text-slate-600">{pack.description}</p>
        {pack.categories.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {pack.categories.map((cat) => (
              <span
                key={`category-${cat}`}
                data-testid={`category-badge-${cat}`}
                className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600"
              >
                {cat}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Install Section (AC3) */}
      <InstallSection packId={pack.id} version={pack.latestVersion} />

      {/* Tools Section (AC2) */}
      <div data-testid="pack-detail-tools" className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className={SECTION_TITLE_CLASS}>
            Tools{' '}
            <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-400">
              {pack.tools.length}
            </span>
          </h3>
        </div>
        {pack.tools.length > 0 ? (
          <div className="space-y-1 px-4 py-3">
            {pack.tools.map((tool) => (
              <ToolItem key={`tool-${tool.name}`} tool={tool} />
            ))}
          </div>
        ) : (
          <div data-testid="pack-detail-tools-empty" className="px-4 py-3 text-xs text-slate-400">
            {TOOLS_EMPTY_MESSAGE}
          </div>
        )}
      </div>

      {/* Policies Section (AC2) */}
      <div
        data-testid="pack-detail-policies"
        className="rounded-lg border border-slate-200 bg-white"
      >
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className={SECTION_TITLE_CLASS}>
            Policies{' '}
            <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-400">
              {pack.policies.length}
            </span>
          </h3>
        </div>
        {pack.policies.length > 0 ? (
          <div className="space-y-1 px-4 py-3">
            {pack.policies.map((policy) => (
              <PolicyItem key={`policy-${policy.id}`} policy={policy} />
            ))}
          </div>
        ) : (
          <div
            data-testid="pack-detail-policies-empty"
            className="px-4 py-3 text-xs text-slate-400"
          >
            {POLICIES_EMPTY_MESSAGE}
          </div>
        )}
      </div>

      {/* Create Pack CTA (AC4) */}
      <div className="rounded-lg border border-dashed border-indigo-200 bg-indigo-50 p-6 text-center">
        <p className="text-sm text-slate-600">Want to build your own pack?</p>
        <a
          data-testid="detail-create-pack-cta"
          href={AUTHORING_GUIDE_URL}
          className="mt-2 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
        >
          {CREATE_PACK_CTA_LABEL}
        </a>
      </div>
    </div>
  );
}
