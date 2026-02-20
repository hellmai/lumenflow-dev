// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CommunityPackShowcase } from '../src/lib/community-types';
import {
  COMMUNITY_PAGE_TITLE,
  ECOSYSTEM_HEADING,
  ECOSYSTEM_DESCRIPTION,
  GETTING_STARTED_HEADING,
  PACK_AUTHORING_LINK_LABEL,
  PACK_AUTHORING_GUIDE_URL,
  PACK_SHOWCASE_HEADING,
  PACK_SHOWCASE_EMPTY_MESSAGE,
  VIEW_MARKETPLACE_LABEL,
  VIEW_MARKETPLACE_URL,
  GETTING_STARTED_STEPS,
} from '../src/lib/community-types';

/* ------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------ */

const FIXTURE_PACKS: CommunityPackShowcase[] = [
  {
    id: 'software-delivery',
    description: 'Git tools, worktree isolation, quality gates, lane locking',
    latestVersion: '0.1.0',
    categories: ['development', 'devops'],
  },
  {
    id: 'customer-support',
    description: 'Ticket management, PII redaction, escalation workflows',
    latestVersion: '1.2.0',
    categories: ['support'],
  },
  {
    id: 'data-pipeline',
    description: 'ETL orchestration, schema validation, data quality checks',
    latestVersion: '0.5.0',
    categories: ['data'],
  },
];

/* ------------------------------------------------------------------
 * AC1: /community route renders pack ecosystem overview
 * ------------------------------------------------------------------ */

describe('CommunityLanding component', () => {
  describe('AC1: Pack ecosystem overview', () => {
    it('renders the community page title', async () => {
      const { CommunityLanding } = await import('../src/components/community-landing');

      render(<CommunityLanding packs={FIXTURE_PACKS} />);

      expect(screen.getByTestId('community-header')).toBeDefined();
      expect(screen.getByText(COMMUNITY_PAGE_TITLE)).toBeDefined();
    });

    it('renders the ecosystem overview section', async () => {
      const { CommunityLanding } = await import('../src/components/community-landing');

      render(<CommunityLanding packs={FIXTURE_PACKS} />);

      expect(screen.getByTestId('ecosystem-section')).toBeDefined();
      expect(screen.getByText(ECOSYSTEM_HEADING)).toBeDefined();
      expect(screen.getByText(ECOSYSTEM_DESCRIPTION)).toBeDefined();
    });
  });

  /* ------------------------------------------------------------------
   * AC2: Getting started guide with link to pack authoring docs
   * ------------------------------------------------------------------ */

  describe('AC2: Getting started guide', () => {
    it('renders getting started section with heading', async () => {
      const { CommunityLanding } = await import('../src/components/community-landing');

      render(<CommunityLanding packs={FIXTURE_PACKS} />);

      expect(screen.getByTestId('getting-started-section')).toBeDefined();
      expect(screen.getByText(GETTING_STARTED_HEADING)).toBeDefined();
    });

    it('renders all getting started steps', async () => {
      const { CommunityLanding } = await import('../src/components/community-landing');

      render(<CommunityLanding packs={FIXTURE_PACKS} />);

      for (const step of GETTING_STARTED_STEPS) {
        expect(screen.getByText(step.title)).toBeDefined();
        expect(screen.getByText(step.description)).toBeDefined();
      }
    });

    it('renders command snippets for steps that have them', async () => {
      const { CommunityLanding } = await import('../src/components/community-landing');

      render(<CommunityLanding packs={FIXTURE_PACKS} />);

      const stepsWithCommands = GETTING_STARTED_STEPS.filter((s) => s.command);
      for (const step of stepsWithCommands) {
        expect(screen.getByText(step.command!)).toBeDefined();
      }
    });

    it('renders a link to the pack authoring guide', async () => {
      const { CommunityLanding } = await import('../src/components/community-landing');

      render(<CommunityLanding packs={FIXTURE_PACKS} />);

      const guideLink = screen.getByTestId('pack-authoring-guide-link');
      expect(guideLink).toBeDefined();
      expect(guideLink.textContent).toContain(PACK_AUTHORING_LINK_LABEL);
      expect(guideLink.getAttribute('href')).toBe(PACK_AUTHORING_GUIDE_URL);
    });
  });

  /* ------------------------------------------------------------------
   * AC3: Showcase of available packs from registry
   * ------------------------------------------------------------------ */

  describe('AC3: Pack showcase', () => {
    it('renders the pack showcase section heading', async () => {
      const { CommunityLanding } = await import('../src/components/community-landing');

      render(<CommunityLanding packs={FIXTURE_PACKS} />);

      expect(screen.getByTestId('pack-showcase-section')).toBeDefined();
      expect(screen.getByText(PACK_SHOWCASE_HEADING)).toBeDefined();
    });

    it('renders all showcase packs with id and description', async () => {
      const { CommunityLanding } = await import('../src/components/community-landing');

      render(<CommunityLanding packs={FIXTURE_PACKS} />);

      for (const pack of FIXTURE_PACKS) {
        expect(screen.getByText(pack.id)).toBeDefined();
        expect(screen.getByText(pack.description)).toBeDefined();
      }
    });

    it('displays version badge for each pack', async () => {
      const { CommunityLanding } = await import('../src/components/community-landing');

      render(<CommunityLanding packs={FIXTURE_PACKS} />);

      expect(screen.getByText('0.1.0')).toBeDefined();
      expect(screen.getByText('1.2.0')).toBeDefined();
      expect(screen.getByText('0.5.0')).toBeDefined();
    });

    it('displays category badges for each pack', async () => {
      const { CommunityLanding } = await import('../src/components/community-landing');

      render(<CommunityLanding packs={FIXTURE_PACKS} />);

      expect(screen.getByText('development')).toBeDefined();
      expect(screen.getByText('devops')).toBeDefined();
      expect(screen.getByText('support')).toBeDefined();
      expect(screen.getByText('data')).toBeDefined();
    });

    it('links each pack card to its marketplace detail page', async () => {
      const { CommunityLanding } = await import('../src/components/community-landing');

      render(<CommunityLanding packs={FIXTURE_PACKS} />);

      for (const pack of FIXTURE_PACKS) {
        const link = screen.getByTestId(`showcase-pack-link-${pack.id}`);
        expect(link.getAttribute('href')).toBe(`/marketplace/${pack.id}`);
      }
    });

    it('renders browse marketplace CTA link', async () => {
      const { CommunityLanding } = await import('../src/components/community-landing');

      render(<CommunityLanding packs={FIXTURE_PACKS} />);

      const ctaLink = screen.getByTestId('view-marketplace-link');
      expect(ctaLink).toBeDefined();
      expect(ctaLink.textContent).toContain(VIEW_MARKETPLACE_LABEL);
      expect(ctaLink.getAttribute('href')).toBe(VIEW_MARKETPLACE_URL);
    });

    it('renders empty state when no packs are provided', async () => {
      const { CommunityLanding } = await import('../src/components/community-landing');

      render(<CommunityLanding packs={[]} />);

      expect(screen.getByText(PACK_SHOWCASE_EMPTY_MESSAGE)).toBeDefined();
    });

    it('renders pack count in showcase header', async () => {
      const { CommunityLanding } = await import('../src/components/community-landing');

      render(<CommunityLanding packs={FIXTURE_PACKS} />);

      expect(screen.getByTestId('pack-showcase-count')).toBeDefined();
      expect(screen.getByTestId('pack-showcase-count').textContent).toBe(
        String(FIXTURE_PACKS.length),
      );
    });
  });
});
