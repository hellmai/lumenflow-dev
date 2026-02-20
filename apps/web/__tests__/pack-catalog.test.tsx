// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { PackCatalogEntry, PackToolView, PackPolicyView } from '../src/lib/pack-catalog-types';
import { WORKSPACE_LOCAL_STORAGE_KEY } from '../src/lib/workspace-connection';

/* ------------------------------------------------------------------
 * AC1: Lists loaded packs with manifest metadata
 * AC2: Tools per pack shown with scope badges
 * AC3: Policies per pack displayed
 * AC4: Links to tool execution traces
 * ------------------------------------------------------------------ */

// --- Fixtures ---

const FIXTURE_TOOLS: PackToolView[] = [
  {
    name: 'git:status',
    permission: 'read',
    scopes: [{ type: 'path', pattern: '**', access: 'read' }],
  },
  {
    name: 'wu:claim',
    permission: 'write',
    scopes: [{ type: 'path', pattern: '**', access: 'write' }],
  },
  {
    name: 'file:read',
    permission: 'read',
    scopes: [{ type: 'path', pattern: 'src/**', access: 'read' }],
  },
];

const FIXTURE_POLICIES: PackPolicyView[] = [
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
    id: 'software-delivery.gate.test',
    trigger: 'on_completion',
    decision: 'allow',
  },
];

const FIXTURE_PACK: PackCatalogEntry = {
  id: 'software-delivery',
  version: '0.1.0',
  source: 'local',
  integrity: 'sha256:abc123def456',
  tools: FIXTURE_TOOLS,
  policies: FIXTURE_POLICIES,
  taskTypes: ['work-unit'],
  evidenceTypes: ['gate-run'],
};

const FIXTURE_SECOND_PACK: PackCatalogEntry = {
  id: 'customer-support',
  version: '1.2.0',
  source: 'registry',
  integrity: 'sha256:789ghi012jkl',
  tools: [
    {
      name: 'ticket:create',
      permission: 'write',
      scopes: [{ type: 'api', pattern: 'tickets/**', access: 'write' }],
    },
  ],
  policies: [
    {
      id: 'customer-support.pii-redaction',
      trigger: 'on_tool_request',
      decision: 'deny',
      reason: 'PII must be redacted before external API calls',
    },
  ],
  taskTypes: ['support-ticket'],
  evidenceTypes: [],
};

const FIXTURE_PACKS: PackCatalogEntry[] = [FIXTURE_PACK, FIXTURE_SECOND_PACK];

afterEach(() => {
  localStorage.removeItem(WORKSPACE_LOCAL_STORAGE_KEY);
  vi.unstubAllGlobals();
});

// --- Tests ---

describe('PackCatalog component', () => {
  describe('AC1: Lists loaded packs with manifest metadata', () => {
    it('renders pack catalog header', async () => {
      const { PackCatalog } = await import('../src/components/pack-catalog');

      render(<PackCatalog packs={FIXTURE_PACKS} />);

      expect(screen.getByTestId('pack-catalog-header')).toBeDefined();
      expect(screen.getByText('Pack Catalog')).toBeDefined();
    });

    it('lists all loaded packs by id and version', async () => {
      const { PackCatalog } = await import('../src/components/pack-catalog');

      render(<PackCatalog packs={FIXTURE_PACKS} />);

      // Pack IDs should be visible
      expect(screen.getByText('software-delivery')).toBeDefined();
      expect(screen.getByText('customer-support')).toBeDefined();

      // Versions should be visible
      expect(screen.getByText('0.1.0')).toBeDefined();
      expect(screen.getByText('1.2.0')).toBeDefined();
    });

    it('displays source type for each pack', async () => {
      const { PackCatalog } = await import('../src/components/pack-catalog');

      render(<PackCatalog packs={FIXTURE_PACKS} />);

      expect(screen.getByTestId('pack-source-software-delivery')).toBeDefined();
      expect(screen.getByTestId('pack-source-software-delivery').textContent).toBe('local');

      expect(screen.getByTestId('pack-source-customer-support')).toBeDefined();
      expect(screen.getByTestId('pack-source-customer-support').textContent).toBe('registry');
    });

    it('displays integrity hash for each pack', async () => {
      const { PackCatalog } = await import('../src/components/pack-catalog');

      render(<PackCatalog packs={FIXTURE_PACKS} />);

      expect(screen.getByTestId('pack-integrity-software-delivery')).toBeDefined();
      expect(screen.getByTestId('pack-integrity-software-delivery').textContent).toContain(
        'sha256:abc123def456',
      );

      expect(screen.getByTestId('pack-integrity-customer-support')).toBeDefined();
    });

    it('displays task types for each pack', async () => {
      const { PackCatalog } = await import('../src/components/pack-catalog');

      render(<PackCatalog packs={FIXTURE_PACKS} />);

      expect(screen.getByText('work-unit')).toBeDefined();
      expect(screen.getByText('support-ticket')).toBeDefined();
    });

    it('renders empty state when no packs are loaded', async () => {
      const { PackCatalog } = await import('../src/components/pack-catalog');

      render(<PackCatalog packs={[]} />);

      expect(screen.getByTestId('pack-catalog-empty')).toBeDefined();
    });

    it('displays pack count in the header', async () => {
      const { PackCatalog } = await import('../src/components/pack-catalog');

      render(<PackCatalog packs={FIXTURE_PACKS} />);

      const header = screen.getByTestId('pack-catalog-header');
      expect(within(header).getByText('2')).toBeDefined();
    });
  });

  describe('AC2: Tools per pack shown with scope badges', () => {
    it('shows tool names within the pack section', async () => {
      const { PackCatalog } = await import('../src/components/pack-catalog');

      render(<PackCatalog packs={[FIXTURE_PACK]} />);

      // All tool names should be visible
      expect(screen.getByText('git:status')).toBeDefined();
      expect(screen.getByText('wu:claim')).toBeDefined();
      expect(screen.getByText('file:read')).toBeDefined();
    });

    it('shows permission badges for each tool', async () => {
      const { PackCatalog } = await import('../src/components/pack-catalog');

      render(<PackCatalog packs={[FIXTURE_PACK]} />);

      // Permission badges should exist
      const readBadges = screen.getAllByText('read');
      const writeBadges = screen.getAllByText('write');
      expect(readBadges.length).toBeGreaterThanOrEqual(2);
      expect(writeBadges.length).toBeGreaterThanOrEqual(1);
    });

    it('shows scope information for tools', async () => {
      const { PackCatalog } = await import('../src/components/pack-catalog');

      render(<PackCatalog packs={[FIXTURE_PACK]} />);

      // Scope type and pattern should be visible
      const scopePatterns = screen.getAllByText('**');
      expect(scopePatterns.length).toBeGreaterThanOrEqual(1);

      // Specific scope pattern for file:read
      expect(screen.getByText('src/**')).toBeDefined();
    });

    it('displays tool count per pack', async () => {
      const { PackCatalog } = await import('../src/components/pack-catalog');

      render(<PackCatalog packs={[FIXTURE_PACK]} />);

      const toolsSection = screen.getByTestId('pack-tools-software-delivery');
      expect(toolsSection).toBeDefined();
      expect(within(toolsSection).getByText('3')).toBeDefined();
    });
  });

  describe('AC3: Policies per pack displayed', () => {
    it('shows policy id, trigger, and decision for each policy', async () => {
      const { PackCatalog } = await import('../src/components/pack-catalog');

      render(<PackCatalog packs={[FIXTURE_PACK]} />);

      // Policy IDs should be visible
      expect(screen.getByText('software-delivery.gate.format')).toBeDefined();
      expect(screen.getByText('software-delivery.gate.lint')).toBeDefined();
      expect(screen.getByText('software-delivery.gate.test')).toBeDefined();

      // Trigger and decision should be visible
      const onCompletionBadges = screen.getAllByText('on_completion');
      expect(onCompletionBadges.length).toBe(3);
    });

    it('shows allow/deny decision badges with color coding', async () => {
      const { PackCatalog } = await import('../src/components/pack-catalog');

      render(<PackCatalog packs={[FIXTURE_SECOND_PACK]} />);

      // Deny decision should be visible
      expect(screen.getByText('deny')).toBeDefined();
    });

    it('displays policy reason when present', async () => {
      const { PackCatalog } = await import('../src/components/pack-catalog');

      render(<PackCatalog packs={[FIXTURE_SECOND_PACK]} />);

      expect(screen.getByText('PII must be redacted before external API calls')).toBeDefined();
    });

    it('displays policy count per pack', async () => {
      const { PackCatalog } = await import('../src/components/pack-catalog');

      render(<PackCatalog packs={[FIXTURE_PACK]} />);

      const policiesSection = screen.getByTestId('pack-policies-software-delivery');
      expect(policiesSection).toBeDefined();
      expect(within(policiesSection).getByText('3')).toBeDefined();
    });
  });

  describe('AC4: Links to tool execution traces', () => {
    it('renders trace links when traceBaseUrl is provided', async () => {
      const { PackCatalog } = await import('../src/components/pack-catalog');

      render(<PackCatalog packs={[FIXTURE_PACK]} traceBaseUrl="/dashboard" />);

      // Each tool should have a trace link
      const traceLinks = screen.getAllByTestId(/^tool-trace-link-/);
      expect(traceLinks.length).toBe(FIXTURE_TOOLS.length);
    });

    it('trace links point to dashboard with tool name parameter', async () => {
      const { PackCatalog } = await import('../src/components/pack-catalog');

      render(<PackCatalog packs={[FIXTURE_PACK]} traceBaseUrl="/dashboard" />);

      const traceLink = screen.getByTestId('tool-trace-link-git:status');
      expect(traceLink.getAttribute('href')).toBe('/dashboard?tool=git%3Astatus');
    });

    it('does not render trace links when traceBaseUrl is omitted', async () => {
      const { PackCatalog } = await import('../src/components/pack-catalog');

      render(<PackCatalog packs={[FIXTURE_PACK]} />);

      const traceLinks = screen.queryAllByTestId(/^tool-trace-link-/);
      expect(traceLinks.length).toBe(0);
    });
  });
});

describe('PackCatalogLive component', () => {
  it('shows a disconnected empty state when no workspace is connected', async () => {
    const { PackCatalogLive } = await import('../src/components/pack-catalog-live');

    render(<PackCatalogLive />);

    expect(screen.getByTestId('pack-catalog-disconnected')).toBeDefined();
    expect(screen.getByText(/connect a workspace/i)).toBeDefined();
  });

  it('fetches workspace-loaded packs from /api/workspace/packs when connected', async () => {
    const { PackCatalogLive } = await import('../src/components/pack-catalog-live');
    localStorage.setItem(WORKSPACE_LOCAL_STORAGE_KEY, '/tmp/workspace');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      statusText: 'OK',
      json: async () => ({ success: true, packs: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PackCatalogLive />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspace/packs?workspaceRoot=%2Ftmp%2Fworkspace',
      );
    });
  });

  it('renders workspace-loaded packs returned by API', async () => {
    const { PackCatalogLive } = await import('../src/components/pack-catalog-live');
    localStorage.setItem(WORKSPACE_LOCAL_STORAGE_KEY, '/tmp/workspace');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      statusText: 'OK',
      json: async () => ({ success: true, packs: [FIXTURE_PACK] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PackCatalogLive />);

    await waitFor(() => {
      expect(screen.getByText('software-delivery')).toBeDefined();
    });
  });
});
