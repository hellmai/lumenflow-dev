'use client';

import { useEffect, useState } from 'react';
import type { CommunityPackShowcase } from '../lib/community-types';
import { CommunityLanding } from './community-landing';

/**
 * Default showcase packs used when the registry API is unavailable.
 * These represent the core packs that ship with LumenFlow.
 */
const DEFAULT_SHOWCASE_PACKS: CommunityPackShowcase[] = [
  {
    id: 'software-delivery',
    description: 'Git tools, worktree isolation, quality gates, lane locking',
    latestVersion: '1.0.0',
    categories: ['development', 'devops'],
  },
  {
    id: 'customer-support',
    description: 'Ticket management, PII redaction, escalation workflows',
    latestVersion: '0.5.0',
    categories: ['support', 'automation'],
  },
  {
    id: 'data-pipeline',
    description: 'ETL orchestration, schema validation, data quality checks',
    latestVersion: '0.3.0',
    categories: ['data', 'automation'],
  },
];

const REGISTRY_API_PATH = '/api/registry/packs';

/**
 * Live wrapper that fetches pack data from the registry API
 * and renders the CommunityLanding component.
 * Falls back to default showcase packs if the API is unavailable.
 */
export function CommunityLandingLive() {
  const [packs, setPacks] = useState<CommunityPackShowcase[]>(DEFAULT_SHOWCASE_PACKS);

  useEffect(() => {
    let cancelled = false;

    async function fetchPacks() {
      try {
        const response = await fetch(REGISTRY_API_PATH);
        if (!response.ok) {
          return;
        }
        const data: { packs: Array<{ id: string; description: string; latestVersion: string }> } =
          await response.json();

        if (!cancelled && Array.isArray(data.packs)) {
          const showcasePacks: CommunityPackShowcase[] = data.packs.map((pack) => ({
            id: pack.id,
            description: pack.description,
            latestVersion: pack.latestVersion,
            categories: [],
          }));
          setPacks(showcasePacks.length > 0 ? showcasePacks : DEFAULT_SHOWCASE_PACKS);
        }
      } catch {
        // Silently fall back to defaults
      }
    }

    void fetchPacks();

    return () => {
      cancelled = true;
    };
  }, []);

  return <CommunityLanding packs={packs} />;
}
