// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MarketplacePackSummary, MarketplaceCategory } from '../src/lib/marketplace-types';
import {
  MARKETPLACE_PAGE_TITLE,
  SEARCH_PLACEHOLDER,
  ALL_CATEGORIES_LABEL,
  NO_PACKS_MESSAGE,
  CREATE_PACK_CTA_LABEL,
  AUTHORING_GUIDE_URL,
} from '../src/lib/marketplace-types';

/* ------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------ */

const FIXTURE_PACKS: MarketplacePackSummary[] = [
  {
    id: 'software-delivery',
    description: 'Git tools, worktree isolation, quality gates, lane locking',
    latestVersion: '0.1.0',
    updatedAt: '2026-02-18T00:00:00Z',
    categories: ['development', 'devops'],
  },
  {
    id: 'customer-support',
    description: 'Ticket management, PII redaction, escalation workflows',
    latestVersion: '1.2.0',
    updatedAt: '2026-02-17T00:00:00Z',
    categories: ['support'],
  },
  {
    id: 'data-pipeline',
    description: 'ETL orchestration, schema validation, data quality checks',
    latestVersion: '0.5.0',
    updatedAt: '2026-02-16T00:00:00Z',
    categories: ['development', 'data'],
  },
];

const FIXTURE_CATEGORIES: MarketplaceCategory[] = [
  { id: 'development', label: 'Development', count: 2 },
  { id: 'devops', label: 'DevOps', count: 1 },
  { id: 'support', label: 'Support', count: 1 },
  { id: 'data', label: 'Data', count: 1 },
];

/* ------------------------------------------------------------------
 * AC1: Browse page with search and categories
 * ------------------------------------------------------------------ */

describe('MarketplaceBrowse component', () => {
  describe('AC1: Browse page with search and categories', () => {
    it('renders marketplace page title', async () => {
      const { MarketplaceBrowse } = await import('../src/components/marketplace-browse');

      render(<MarketplaceBrowse packs={FIXTURE_PACKS} categories={FIXTURE_CATEGORIES} />);

      expect(screen.getByTestId('marketplace-header')).toBeDefined();
      expect(screen.getByText(MARKETPLACE_PAGE_TITLE)).toBeDefined();
    });

    it('renders all pack cards with id and description', async () => {
      const { MarketplaceBrowse } = await import('../src/components/marketplace-browse');

      render(<MarketplaceBrowse packs={FIXTURE_PACKS} categories={FIXTURE_CATEGORIES} />);

      expect(screen.getByText('software-delivery')).toBeDefined();
      expect(screen.getByText('customer-support')).toBeDefined();
      expect(screen.getByText('data-pipeline')).toBeDefined();

      expect(
        screen.getByText('Git tools, worktree isolation, quality gates, lane locking'),
      ).toBeDefined();
    });

    it('displays latest version for each pack', async () => {
      const { MarketplaceBrowse } = await import('../src/components/marketplace-browse');

      render(<MarketplaceBrowse packs={FIXTURE_PACKS} categories={FIXTURE_CATEGORIES} />);

      expect(screen.getByText('0.1.0')).toBeDefined();
      expect(screen.getByText('1.2.0')).toBeDefined();
      expect(screen.getByText('0.5.0')).toBeDefined();
    });

    it('renders search input with placeholder', async () => {
      const { MarketplaceBrowse } = await import('../src/components/marketplace-browse');

      render(<MarketplaceBrowse packs={FIXTURE_PACKS} categories={FIXTURE_CATEGORIES} />);

      const searchInput = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
      expect(searchInput).toBeDefined();
    });

    it('filters packs by search query matching id', async () => {
      const { MarketplaceBrowse } = await import('../src/components/marketplace-browse');

      render(<MarketplaceBrowse packs={FIXTURE_PACKS} categories={FIXTURE_CATEGORIES} />);

      const searchInput = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
      fireEvent.change(searchInput, { target: { value: 'customer' } });

      expect(screen.getByText('customer-support')).toBeDefined();
      expect(screen.queryByText('software-delivery')).toBeNull();
      expect(screen.queryByText('data-pipeline')).toBeNull();
    });

    it('filters packs by search query matching description', async () => {
      const { MarketplaceBrowse } = await import('../src/components/marketplace-browse');

      render(<MarketplaceBrowse packs={FIXTURE_PACKS} categories={FIXTURE_CATEGORIES} />);

      const searchInput = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
      fireEvent.change(searchInput, { target: { value: 'ETL' } });

      expect(screen.getByText('data-pipeline')).toBeDefined();
      expect(screen.queryByText('software-delivery')).toBeNull();
    });

    it('renders category filter buttons', async () => {
      const { MarketplaceBrowse } = await import('../src/components/marketplace-browse');

      render(<MarketplaceBrowse packs={FIXTURE_PACKS} categories={FIXTURE_CATEGORIES} />);

      expect(screen.getByTestId('category-filter-all')).toBeDefined();
      expect(screen.getByText(ALL_CATEGORIES_LABEL)).toBeDefined();
      expect(screen.getByTestId('category-filter-development')).toBeDefined();
      expect(screen.getByTestId('category-filter-support')).toBeDefined();
    });

    it('filters packs by selected category', async () => {
      const { MarketplaceBrowse } = await import('../src/components/marketplace-browse');

      render(<MarketplaceBrowse packs={FIXTURE_PACKS} categories={FIXTURE_CATEGORIES} />);

      const supportButton = screen.getByTestId('category-filter-support');
      fireEvent.click(supportButton);

      expect(screen.getByText('customer-support')).toBeDefined();
      expect(screen.queryByText('software-delivery')).toBeNull();
      expect(screen.queryByText('data-pipeline')).toBeNull();
    });

    it('shows all packs when All category is selected', async () => {
      const { MarketplaceBrowse } = await import('../src/components/marketplace-browse');

      render(<MarketplaceBrowse packs={FIXTURE_PACKS} categories={FIXTURE_CATEGORIES} />);

      // First filter to a category
      fireEvent.click(screen.getByTestId('category-filter-support'));
      expect(screen.queryByText('software-delivery')).toBeNull();

      // Then click All to reset
      fireEvent.click(screen.getByTestId('category-filter-all'));
      expect(screen.getByText('software-delivery')).toBeDefined();
      expect(screen.getByText('customer-support')).toBeDefined();
      expect(screen.getByText('data-pipeline')).toBeDefined();
    });

    it('shows empty state when no packs match filters', async () => {
      const { MarketplaceBrowse } = await import('../src/components/marketplace-browse');

      render(<MarketplaceBrowse packs={FIXTURE_PACKS} categories={FIXTURE_CATEGORIES} />);

      const searchInput = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
      fireEvent.change(searchInput, { target: { value: 'nonexistent-pack-xyz' } });

      expect(screen.getByText(NO_PACKS_MESSAGE)).toBeDefined();
    });

    it('renders empty state when no packs are provided', async () => {
      const { MarketplaceBrowse } = await import('../src/components/marketplace-browse');

      render(<MarketplaceBrowse packs={[]} categories={[]} />);

      expect(screen.getByText(NO_PACKS_MESSAGE)).toBeDefined();
    });

    it('renders pack cards as links to detail page', async () => {
      const { MarketplaceBrowse } = await import('../src/components/marketplace-browse');

      render(<MarketplaceBrowse packs={FIXTURE_PACKS} categories={FIXTURE_CATEGORIES} />);

      const packLink = screen.getByTestId('pack-link-software-delivery');
      expect(packLink.getAttribute('href')).toBe('/marketplace/software-delivery');
    });
  });

  describe('AC4: Create Pack CTA links to guide', () => {
    it('renders Create Pack CTA button', async () => {
      const { MarketplaceBrowse } = await import('../src/components/marketplace-browse');

      render(<MarketplaceBrowse packs={FIXTURE_PACKS} categories={FIXTURE_CATEGORIES} />);

      const cta = screen.getByTestId('create-pack-cta');
      expect(cta).toBeDefined();
      expect(cta.textContent).toContain(CREATE_PACK_CTA_LABEL);
    });

    it('Create Pack CTA links to authoring guide', async () => {
      const { MarketplaceBrowse } = await import('../src/components/marketplace-browse');

      render(<MarketplaceBrowse packs={FIXTURE_PACKS} categories={FIXTURE_CATEGORIES} />);

      const cta = screen.getByTestId('create-pack-cta');
      expect(cta.getAttribute('href')).toBe(AUTHORING_GUIDE_URL);
    });
  });
});
