// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { MarketplacePackDetail } from '../src/lib/marketplace-types';
import {
  generateInstallCommand,
  INSTALL_BUTTON_LABEL,
  INSTALL_COPIED_LABEL,
  BACK_TO_MARKETPLACE_LABEL,
  AUTHORING_GUIDE_URL,
  CREATE_PACK_CTA_LABEL,
} from '../src/lib/marketplace-types';

/* ------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------ */

const FIXTURE_PACK_DETAIL: MarketplacePackDetail = {
  id: 'software-delivery',
  description:
    'Git tools, worktree isolation, quality gates, lane locking for software development.',
  latestVersion: '0.1.0',
  updatedAt: '2026-02-18T00:00:00Z',
  categories: ['development', 'devops'],
  tools: [
    { name: 'git:status', permission: 'read', description: 'Check git working tree status' },
    { name: 'wu:claim', permission: 'write', description: 'Claim a work unit' },
    { name: 'file:read', permission: 'read' },
  ],
  policies: [
    {
      id: 'software-delivery.gate.format',
      trigger: 'on_completion',
      decision: 'allow',
    },
    {
      id: 'software-delivery.gate.lint',
      trigger: 'on_completion',
      decision: 'allow',
    },
    {
      id: 'software-delivery.pii-block',
      trigger: 'on_tool_request',
      decision: 'deny',
      reason: 'PII must not be committed to git',
    },
  ],
};

const FIXTURE_EMPTY_PACK: MarketplacePackDetail = {
  id: 'empty-pack',
  description: 'A pack with no tools or policies.',
  latestVersion: '0.0.1',
  updatedAt: '2026-02-18T00:00:00Z',
  categories: [],
  tools: [],
  policies: [],
};

const FIXTURE_REGISTRY_PACK_WITH_MANIFEST = {
  id: 'software-delivery',
  description: 'Git tools, worktree isolation, quality gates.',
  owner: 'testuser',
  latestVersion: '2.0.0',
  versions: [
    {
      version: '2.0.0',
      integrity: 'sha256:abc123',
      publishedAt: '2026-02-20T00:00:00Z',
      publishedBy: 'testuser',
      blobUrl: 'https://registry.example/packs/software-delivery/2.0.0.tgz',
      manifest_summary: {
        tools: [{ name: 'file:read', permission: 'read' }],
        policies: [
          { id: 'software-delivery.allow-read', trigger: 'on_tool_request', decision: 'allow' },
        ],
        categories: ['development'],
        trust: {
          integrityVerified: true,
          manifestParsed: true,
          publisherVerified: true,
          permissionScopes: ['read'],
        },
      },
    },
  ],
  createdAt: '2026-02-20T00:00:00Z',
  updatedAt: '2026-02-20T00:00:00Z',
};

/* ------------------------------------------------------------------
 * Unit tests for generateInstallCommand
 * ------------------------------------------------------------------ */

describe('generateInstallCommand', () => {
  it('generates command with pack id only', () => {
    const command = generateInstallCommand('software-delivery');
    expect(command).toBe('npx lumenflow pack:install --id software-delivery --source registry');
  });

  it('generates command with pack id and version', () => {
    const command = generateInstallCommand('software-delivery', '0.1.0');
    expect(command).toBe(
      'npx lumenflow pack:install --id software-delivery --source registry --version 0.1.0',
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------
 * AC2: Pack detail page with tools and policies
 * ------------------------------------------------------------------ */

describe('MarketplacePackDetail component', () => {
  describe('AC2: Pack detail page with tools and policies', () => {
    it('renders pack name and description', async () => {
      const { MarketplacePackDetail: PackDetailComponent } =
        await import('../src/components/marketplace-pack-detail');

      render(<PackDetailComponent pack={FIXTURE_PACK_DETAIL} />);

      expect(screen.getByTestId('pack-detail-header')).toBeDefined();
      expect(screen.getByText('software-delivery')).toBeDefined();
      expect(
        screen.getByText(
          'Git tools, worktree isolation, quality gates, lane locking for software development.',
        ),
      ).toBeDefined();
    });

    it('displays latest version', async () => {
      const { MarketplacePackDetail: PackDetailComponent } =
        await import('../src/components/marketplace-pack-detail');

      render(<PackDetailComponent pack={FIXTURE_PACK_DETAIL} />);

      expect(screen.getByText('0.1.0')).toBeDefined();
    });

    it('displays tools list with names and permissions', async () => {
      const { MarketplacePackDetail: PackDetailComponent } =
        await import('../src/components/marketplace-pack-detail');

      render(<PackDetailComponent pack={FIXTURE_PACK_DETAIL} />);

      const toolsSection = screen.getByTestId('pack-detail-tools');
      expect(toolsSection).toBeDefined();

      expect(screen.getByText('git:status')).toBeDefined();
      expect(screen.getByText('wu:claim')).toBeDefined();
      expect(screen.getByText('file:read')).toBeDefined();
    });

    it('displays tool descriptions when present', async () => {
      const { MarketplacePackDetail: PackDetailComponent } =
        await import('../src/components/marketplace-pack-detail');

      render(<PackDetailComponent pack={FIXTURE_PACK_DETAIL} />);

      expect(screen.getByText('Check git working tree status')).toBeDefined();
      expect(screen.getByText('Claim a work unit')).toBeDefined();
    });

    it('displays tool count', async () => {
      const { MarketplacePackDetail: PackDetailComponent } =
        await import('../src/components/marketplace-pack-detail');

      render(<PackDetailComponent pack={FIXTURE_PACK_DETAIL} />);

      const toolsSection = screen.getByTestId('pack-detail-tools');
      expect(toolsSection.textContent).toContain('3');
    });

    it('displays policies list with id, trigger, and decision', async () => {
      const { MarketplacePackDetail: PackDetailComponent } =
        await import('../src/components/marketplace-pack-detail');

      render(<PackDetailComponent pack={FIXTURE_PACK_DETAIL} />);

      const policiesSection = screen.getByTestId('pack-detail-policies');
      expect(policiesSection).toBeDefined();

      expect(screen.getByText('software-delivery.gate.format')).toBeDefined();
      expect(screen.getByText('software-delivery.gate.lint')).toBeDefined();
      expect(screen.getByText('software-delivery.pii-block')).toBeDefined();
    });

    it('displays policy reasons when present', async () => {
      const { MarketplacePackDetail: PackDetailComponent } =
        await import('../src/components/marketplace-pack-detail');

      render(<PackDetailComponent pack={FIXTURE_PACK_DETAIL} />);

      expect(screen.getByText('PII must not be committed to git')).toBeDefined();
    });

    it('displays policy count', async () => {
      const { MarketplacePackDetail: PackDetailComponent } =
        await import('../src/components/marketplace-pack-detail');

      render(<PackDetailComponent pack={FIXTURE_PACK_DETAIL} />);

      const policiesSection = screen.getByTestId('pack-detail-policies');
      expect(policiesSection.textContent).toContain('3');
    });

    it('shows empty state for tools when none exist', async () => {
      const { MarketplacePackDetail: PackDetailComponent } =
        await import('../src/components/marketplace-pack-detail');

      render(<PackDetailComponent pack={FIXTURE_EMPTY_PACK} />);

      expect(screen.getByTestId('pack-detail-tools-empty')).toBeDefined();
    });

    it('shows empty state for policies when none exist', async () => {
      const { MarketplacePackDetail: PackDetailComponent } =
        await import('../src/components/marketplace-pack-detail');

      render(<PackDetailComponent pack={FIXTURE_EMPTY_PACK} />);

      expect(screen.getByTestId('pack-detail-policies-empty')).toBeDefined();
    });

    it('renders back to marketplace link', async () => {
      const { MarketplacePackDetail: PackDetailComponent } =
        await import('../src/components/marketplace-pack-detail');

      render(<PackDetailComponent pack={FIXTURE_PACK_DETAIL} />);

      const backLink = screen.getByText(BACK_TO_MARKETPLACE_LABEL);
      expect(backLink).toBeDefined();
      expect(backLink.closest('a')?.getAttribute('href')).toBe('/marketplace');
    });

    it('renders categories as badges', async () => {
      const { MarketplacePackDetail: PackDetailComponent } =
        await import('../src/components/marketplace-pack-detail');

      render(<PackDetailComponent pack={FIXTURE_PACK_DETAIL} />);

      expect(screen.getByTestId('category-badge-development')).toBeDefined();
      expect(screen.getByTestId('category-badge-devops')).toBeDefined();
    });
  });

  describe('AC3: Install instructions generated', () => {
    it('renders install command section', async () => {
      const { MarketplacePackDetail: PackDetailComponent } =
        await import('../src/components/marketplace-pack-detail');

      render(<PackDetailComponent pack={FIXTURE_PACK_DETAIL} />);

      const installSection = screen.getByTestId('pack-detail-install');
      expect(installSection).toBeDefined();
    });

    it('displays the generated install command', async () => {
      const { MarketplacePackDetail: PackDetailComponent } =
        await import('../src/components/marketplace-pack-detail');

      render(<PackDetailComponent pack={FIXTURE_PACK_DETAIL} />);

      const expectedCommand = generateInstallCommand(
        FIXTURE_PACK_DETAIL.id,
        FIXTURE_PACK_DETAIL.latestVersion,
      );
      expect(screen.getByText(expectedCommand)).toBeDefined();
    });

    it('renders copy install command button', async () => {
      const { MarketplacePackDetail: PackDetailComponent } =
        await import('../src/components/marketplace-pack-detail');

      render(<PackDetailComponent pack={FIXTURE_PACK_DETAIL} />);

      const copyButton = screen.getByTestId('copy-install-button');
      expect(copyButton).toBeDefined();
      expect(copyButton.textContent).toContain(INSTALL_BUTTON_LABEL);
    });

    it('copies install command to clipboard on button click', async () => {
      const { MarketplacePackDetail: PackDetailComponent } =
        await import('../src/components/marketplace-pack-detail');

      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: { writeText: writeTextMock },
      });

      render(<PackDetailComponent pack={FIXTURE_PACK_DETAIL} />);

      const copyButton = screen.getByTestId('copy-install-button');
      fireEvent.click(copyButton);

      const expectedCommand = generateInstallCommand(
        FIXTURE_PACK_DETAIL.id,
        FIXTURE_PACK_DETAIL.latestVersion,
      );
      expect(writeTextMock).toHaveBeenCalledWith(expectedCommand);
    });

    it('disables workspace install when no workspace is connected', async () => {
      const { MarketplacePackDetail: PackDetailComponent } =
        await import('../src/components/marketplace-pack-detail');

      render(<PackDetailComponent pack={FIXTURE_PACK_DETAIL} workspaceRoot={null} />);

      const installButton = screen.getByTestId('install-to-workspace-button') as HTMLButtonElement;
      expect(installButton.disabled).toBe(true);
      expect(screen.getByTestId('install-disabled-tooltip')).toBeDefined();
    });

    it('shows install summary with tools/policies/permission scopes on success', async () => {
      const { MarketplacePackDetail: PackDetailComponent } =
        await import('../src/components/marketplace-pack-detail');

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, integrity: 'sha256:abc' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<PackDetailComponent pack={FIXTURE_PACK_DETAIL} workspaceRoot="/tmp/workspace" />);

      fireEvent.click(screen.getByTestId('install-to-workspace-button'));

      await waitFor(() => {
        expect(screen.getByTestId('install-success-feedback').textContent).toContain('3 tools');
      });
      expect(screen.getByTestId('install-success-feedback').textContent).toContain('3 policies');
      expect(screen.getByTestId('install-success-feedback').textContent).toContain(
        'permission scopes: read, write',
      );
    });

    it('shows error feedback when one-click install fails', async () => {
      const { MarketplacePackDetail: PackDetailComponent } =
        await import('../src/components/marketplace-pack-detail');

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ success: false, error: 'Registry unavailable' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<PackDetailComponent pack={FIXTURE_PACK_DETAIL} workspaceRoot="/tmp/workspace" />);

      fireEvent.click(screen.getByTestId('install-to-workspace-button'));

      await waitFor(() => {
        expect(screen.getByTestId('install-error-feedback').textContent).toContain(
          'Registry unavailable',
        );
      });
    });
  });

  describe('AC4: Create Pack CTA on detail page', () => {
    it('renders Create Pack CTA linking to authoring guide', async () => {
      const { MarketplacePackDetail: PackDetailComponent } =
        await import('../src/components/marketplace-pack-detail');

      render(<PackDetailComponent pack={FIXTURE_PACK_DETAIL} />);

      const cta = screen.getByTestId('detail-create-pack-cta');
      expect(cta).toBeDefined();
      expect(cta.textContent).toContain(CREATE_PACK_CTA_LABEL);
      expect(cta.getAttribute('href')).toBe(AUTHORING_GUIDE_URL);
    });
  });

  describe('WU-1950: MarketplacePackDetailLive manifest summary rendering', () => {
    it('renders manifest-derived tools, policies, categories, and trust badges', async () => {
      const { MarketplacePackDetailLive } =
        await import('../src/components/marketplace-pack-detail-live');

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          success: true,
          pack: FIXTURE_REGISTRY_PACK_WITH_MANIFEST,
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<MarketplacePackDetailLive packId="software-delivery" />);

      await waitFor(() => {
        expect(screen.getByText('file:read')).toBeDefined();
      });

      expect(screen.getByText('software-delivery.allow-read')).toBeDefined();
      expect(screen.getByTestId('category-badge-development')).toBeDefined();
      expect(screen.getByTestId('category-badge-trust-integrity-verified')).toBeDefined();
      expect(screen.getByTestId('category-badge-trust-manifest-parsed')).toBeDefined();
      expect(screen.getByTestId('category-badge-trust-publisher-verified')).toBeDefined();
      expect(screen.getByTestId('category-badge-scope-read')).toBeDefined();
    });
  });
});
