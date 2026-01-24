/**
 * @fileoverview Tests for branch-check module
 *
 * Tests the async isAgentBranch() function that uses resolveAgentPatterns.
 * WU-1089: Updated to mock resolveAgentPatterns instead of getAgentPatterns.
 *
 * @module __tests__/branch-check.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the registry module with resolveAgentPatterns (WU-1089)
vi.mock('../agent-patterns-registry.js', () => ({
  resolveAgentPatterns: vi.fn(),
  DEFAULT_AGENT_PATTERNS: ['agent/*'],
  clearCache: vi.fn(),
}));

// Module under test
import { isAgentBranch, isAgentBranchWithDetails, isHeadlessAllowed } from '../branch-check.js';
import { resolveAgentPatterns } from '../agent-patterns-registry.js';

// Mock getConfig
vi.mock('../lumenflow-config.js', () => ({
  getConfig: vi.fn(() => ({
    git: {
      mainBranch: 'main',
      laneBranchPrefix: 'lane/',
      agentBranchPatterns: [], // Empty to use registry
      agentBranchPatternsOverride: undefined,
      disableAgentPatternRegistry: false,
    },
  })),
}));

describe('branch-check', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isAgentBranch (async)', () => {
    describe('protected branches', () => {
      it('should return false for null branch', async () => {
        vi.mocked(resolveAgentPatterns).mockResolvedValue({
          patterns: ['claude/*', 'agent/*'],
          source: 'registry',
          registryFetched: true,
        });

        const result = await isAgentBranch(null);

        expect(result).toBe(false);
      });

      it('should return false for undefined branch', async () => {
        vi.mocked(resolveAgentPatterns).mockResolvedValue({
          patterns: ['claude/*', 'agent/*'],
          source: 'registry',
          registryFetched: true,
        });

        const result = await isAgentBranch(undefined);

        expect(result).toBe(false);
      });

      it('should return false for empty string branch', async () => {
        vi.mocked(resolveAgentPatterns).mockResolvedValue({
          patterns: ['claude/*', 'agent/*'],
          source: 'registry',
          registryFetched: true,
        });

        const result = await isAgentBranch('');

        expect(result).toBe(false);
      });

      it('should return false for detached HEAD', async () => {
        vi.mocked(resolveAgentPatterns).mockResolvedValue({
          patterns: ['claude/*', 'agent/*'],
          source: 'registry',
          registryFetched: true,
        });

        const result = await isAgentBranch('HEAD');

        expect(result).toBe(false);
      });

      it('should return false for main branch', async () => {
        vi.mocked(resolveAgentPatterns).mockResolvedValue({
          patterns: ['main/*', 'agent/*'],
          source: 'registry',
          registryFetched: true,
        });

        const result = await isAgentBranch('main');

        expect(result).toBe(false);
      });

      it('should return false for master branch', async () => {
        vi.mocked(resolveAgentPatterns).mockResolvedValue({
          patterns: ['master/*', 'agent/*'],
          source: 'registry',
          registryFetched: true,
        });

        const result = await isAgentBranch('master');

        expect(result).toBe(false);
      });

      it('should return false for lane branches', async () => {
        vi.mocked(resolveAgentPatterns).mockResolvedValue({
          patterns: ['lane/*', 'agent/*'],
          source: 'registry',
          registryFetched: true,
        });

        const result = await isAgentBranch('lane/operations/wu-123');

        expect(result).toBe(false);
      });
    });

    describe('agent branch patterns from registry', () => {
      it('should match claude/* branches', async () => {
        vi.mocked(resolveAgentPatterns).mockResolvedValue({
          patterns: ['claude/*', 'codex/*', 'copilot/*', 'cursor/*', 'agent/*'],
          source: 'registry',
          registryFetched: true,
        });

        const result = await isAgentBranch('claude/session-12345');

        expect(result).toBe(true);
      });

      it('should match codex/* branches', async () => {
        vi.mocked(resolveAgentPatterns).mockResolvedValue({
          patterns: ['claude/*', 'codex/*', 'copilot/*', 'cursor/*', 'agent/*'],
          source: 'registry',
          registryFetched: true,
        });

        const result = await isAgentBranch('codex/workspace-abc');

        expect(result).toBe(true);
      });

      it('should match copilot/* branches', async () => {
        vi.mocked(resolveAgentPatterns).mockResolvedValue({
          patterns: ['claude/*', 'codex/*', 'copilot/*', 'cursor/*', 'agent/*'],
          source: 'registry',
          registryFetched: true,
        });

        const result = await isAgentBranch('copilot/pr-fix-123');

        expect(result).toBe(true);
      });

      it('should match cursor/* branches', async () => {
        vi.mocked(resolveAgentPatterns).mockResolvedValue({
          patterns: ['claude/*', 'codex/*', 'copilot/*', 'cursor/*', 'agent/*'],
          source: 'registry',
          registryFetched: true,
        });

        const result = await isAgentBranch('cursor/composer-session');

        expect(result).toBe(true);
      });

      it('should match agent/* branches (default pattern)', async () => {
        vi.mocked(resolveAgentPatterns).mockResolvedValue({
          patterns: ['agent/*'],
          source: 'defaults',
          registryFetched: false,
        });

        const result = await isAgentBranch('agent/automation-task');

        expect(result).toBe(true);
      });

      it('should not match branches outside patterns', async () => {
        vi.mocked(resolveAgentPatterns).mockResolvedValue({
          patterns: ['claude/*', 'agent/*'],
          source: 'registry',
          registryFetched: true,
        });

        const result = await isAgentBranch('feature/my-feature');

        expect(result).toBe(false);
      });
    });

    describe('glob pattern matching', () => {
      it('should support ** glob patterns', async () => {
        vi.mocked(resolveAgentPatterns).mockResolvedValue({
          patterns: ['ai/**'],
          source: 'config',
          registryFetched: false,
        });

        expect(await isAgentBranch('ai/agent/claude/session')).toBe(true);
        expect(await isAgentBranch('ai/task')).toBe(true);
      });

      it('should support multiple glob patterns', async () => {
        vi.mocked(resolveAgentPatterns).mockResolvedValue({
          patterns: ['bot/*', 'automation/*'],
          source: 'config',
          registryFetched: false,
        });

        expect(await isAgentBranch('bot/task-123')).toBe(true);
        expect(await isAgentBranch('automation/deploy')).toBe(true);
        expect(await isAgentBranch('human/work')).toBe(false);
      });
    });

    describe('WU-1089: merge/override/airgapped modes', () => {
      it('should pass config to resolveAgentPatterns', async () => {
        vi.mocked(resolveAgentPatterns).mockResolvedValue({
          patterns: ['merged/*'],
          source: 'merged',
          registryFetched: true,
        });

        await isAgentBranch('merged/branch');

        // Verify resolveAgentPatterns was called with config values
        expect(resolveAgentPatterns).toHaveBeenCalledWith({
          configPatterns: [],
          overridePatterns: undefined,
          disableAgentPatternRegistry: false,
        });
      });

      it('should use merged patterns from registry + config', async () => {
        vi.mocked(resolveAgentPatterns).mockResolvedValue({
          patterns: ['custom/*', 'claude/*', 'codex/*'],
          source: 'merged',
          registryFetched: true,
        });

        expect(await isAgentBranch('custom/branch')).toBe(true);
        expect(await isAgentBranch('claude/session')).toBe(true);
      });

      it('should use override patterns when specified', async () => {
        vi.mocked(resolveAgentPatterns).mockResolvedValue({
          patterns: ['only-this/*'],
          source: 'override',
          registryFetched: false,
        });

        expect(await isAgentBranch('only-this/branch')).toBe(true);
        expect(await isAgentBranch('claude/session')).toBe(false);
      });

      it('should use defaults in airgapped mode', async () => {
        vi.mocked(resolveAgentPatterns).mockResolvedValue({
          patterns: ['agent/*'],
          source: 'defaults',
          registryFetched: false,
        });

        expect(await isAgentBranch('agent/task')).toBe(true);
        expect(await isAgentBranch('claude/session')).toBe(false);
      });
    });
  });

  describe('isAgentBranchWithDetails', () => {
    it('should return full pattern result for observability', async () => {
      vi.mocked(resolveAgentPatterns).mockResolvedValue({
        patterns: ['claude/*', 'agent/*'],
        source: 'registry',
        registryFetched: true,
      });

      const result = await isAgentBranchWithDetails('claude/session-123');

      expect(result.isMatch).toBe(true);
      expect(result.patternResult.source).toBe('registry');
      expect(result.patternResult.registryFetched).toBe(true);
      expect(result.patternResult.patterns).toContain('claude/*');
    });

    it('should return isMatch false for protected branches', async () => {
      const result = await isAgentBranchWithDetails('main');

      expect(result.isMatch).toBe(false);
      expect(result.patternResult.patterns).toEqual([]);
    });

    it('should return isMatch false for lane branches', async () => {
      const result = await isAgentBranchWithDetails('lane/ops/wu-123');

      expect(result.isMatch).toBe(false);
      expect(result.patternResult.patterns).toEqual([]);
    });

    it('should return isMatch false for null branch', async () => {
      const result = await isAgentBranchWithDetails(null);

      expect(result.isMatch).toBe(false);
    });
  });

  describe('isHeadlessAllowed', () => {
    it('should return false when LUMENFLOW_HEADLESS is not set', () => {
      delete process.env.LUMENFLOW_HEADLESS;
      delete process.env.LUMENFLOW_ADMIN;
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;

      expect(isHeadlessAllowed()).toBe(false);
    });

    it('should return false when LUMENFLOW_HEADLESS is not "1"', () => {
      process.env.LUMENFLOW_HEADLESS = 'true';
      process.env.CI = 'true';

      expect(isHeadlessAllowed()).toBe(false);
    });

    it('should return true when LUMENFLOW_HEADLESS=1 and CI is truthy', () => {
      process.env.LUMENFLOW_HEADLESS = '1';
      process.env.CI = 'true';
      delete process.env.LUMENFLOW_ADMIN;
      delete process.env.GITHUB_ACTIONS;

      expect(isHeadlessAllowed()).toBe(true);
    });

    it('should return true when LUMENFLOW_HEADLESS=1 and GITHUB_ACTIONS is truthy', () => {
      process.env.LUMENFLOW_HEADLESS = '1';
      process.env.GITHUB_ACTIONS = 'true';
      delete process.env.LUMENFLOW_ADMIN;
      delete process.env.CI;

      expect(isHeadlessAllowed()).toBe(true);
    });

    it('should return true when LUMENFLOW_HEADLESS=1 and LUMENFLOW_ADMIN=1', () => {
      process.env.LUMENFLOW_HEADLESS = '1';
      process.env.LUMENFLOW_ADMIN = '1';
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;

      expect(isHeadlessAllowed()).toBe(true);
    });

    it('should return false when only LUMENFLOW_HEADLESS=1 without guards', () => {
      process.env.LUMENFLOW_HEADLESS = '1';
      delete process.env.LUMENFLOW_ADMIN;
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;

      expect(isHeadlessAllowed()).toBe(false);
    });
  });
});
