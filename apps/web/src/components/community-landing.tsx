'use client';

import type { CommunityPackShowcase } from '../lib/community-types';
import {
  COMMUNITY_PAGE_TITLE,
  ECOSYSTEM_HEADING,
  ECOSYSTEM_DESCRIPTION,
  GETTING_STARTED_HEADING,
  PACK_AUTHORING_GUIDE_URL,
  PACK_AUTHORING_LINK_LABEL,
  PACK_SHOWCASE_HEADING,
  PACK_SHOWCASE_EMPTY_MESSAGE,
  VIEW_MARKETPLACE_LABEL,
  VIEW_MARKETPLACE_URL,
  GETTING_STARTED_STEPS,
} from '../lib/community-types';

/* ------------------------------------------------------------------
 * ShowcasePackCard — a single pack in the showcase grid
 * ------------------------------------------------------------------ */

interface ShowcasePackCardProps {
  readonly pack: CommunityPackShowcase;
}

function ShowcasePackCard({ pack }: ShowcasePackCardProps) {
  return (
    <a
      data-testid={`showcase-pack-link-${pack.id}`}
      href={`/marketplace/${pack.id}`}
      className="block rounded-lg border border-slate-200 bg-white p-5 transition-shadow hover:shadow-md"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold text-slate-900">{pack.id}</h3>
        <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-500">
          {pack.latestVersion}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-600">{pack.description}</p>
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
  );
}

/* ------------------------------------------------------------------
 * GettingStartedCard — a single step in the getting started guide
 * ------------------------------------------------------------------ */

interface GettingStartedCardProps {
  readonly title: string;
  readonly description: string;
  readonly command?: string;
  readonly stepNumber: number;
}

function GettingStartedCard({ title, description, command, stepNumber }: GettingStartedCardProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">
          {stepNumber}
        </span>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      </div>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
      {command && (
        <pre className="mt-3 overflow-x-auto rounded bg-slate-900 px-4 py-2 font-mono text-sm text-slate-100">
          {command}
        </pre>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
 * CommunityLanding — main community page component
 * ------------------------------------------------------------------ */

export interface CommunityLandingProps {
  readonly packs: readonly CommunityPackShowcase[];
}

export function CommunityLanding({ packs }: CommunityLandingProps) {
  const hasPacks = packs.length > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-12 p-6">
      {/* Page header */}
      <div data-testid="community-header">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{COMMUNITY_PAGE_TITLE}</h1>
        <p className="mt-2 text-lg text-slate-600">
          Discover, share, and contribute to the LumenFlow pack ecosystem.
        </p>
      </div>

      {/* Ecosystem overview (AC1) */}
      <section data-testid="ecosystem-section" className="space-y-4">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">{ECOSYSTEM_HEADING}</h2>
        <p className="max-w-3xl text-base leading-relaxed text-slate-600">
          {ECOSYSTEM_DESCRIPTION}
        </p>
      </section>

      {/* Getting started guide (AC2) */}
      <section data-testid="getting-started-section" className="space-y-6">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          {GETTING_STARTED_HEADING}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {GETTING_STARTED_STEPS.map((step, index) => (
            <GettingStartedCard
              key={`step-${step.title}`}
              title={step.title}
              description={step.description}
              command={step.command}
              stepNumber={index + 1}
            />
          ))}
        </div>
        <div className="pt-2">
          <a
            data-testid="pack-authoring-guide-link"
            href={PACK_AUTHORING_GUIDE_URL}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            {PACK_AUTHORING_LINK_LABEL}
          </a>
        </div>
      </section>

      {/* Pack showcase (AC3) */}
      <section data-testid="pack-showcase-section" className="space-y-6">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            {PACK_SHOWCASE_HEADING}
          </h2>
          <span
            data-testid="pack-showcase-count"
            className="rounded bg-slate-100 px-2 py-1 text-sm font-medium text-slate-500"
          >
            {packs.length}
          </span>
        </div>

        {hasPacks ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {packs.map((pack) => (
              <ShowcasePackCard key={`showcase-${pack.id}`} pack={pack} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
            {PACK_SHOWCASE_EMPTY_MESSAGE}
          </div>
        )}

        <div className="pt-2">
          <a
            data-testid="view-marketplace-link"
            href={VIEW_MARKETPLACE_URL}
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            {VIEW_MARKETPLACE_LABEL}
          </a>
        </div>
      </section>
    </div>
  );
}
