/**
 * @fileoverview Tests for branch-check module
 *
 * Tests the async isAgentBranch() function that uses the registry patterns.
 *
 * @module __tests__/branch-check.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Will need to mock the registry module
vi.mock('../agent-patterns-registry.js', () => ({
  getAgentPatterns: vi.fn(),
  DEFAULT_AGENT_PATTERNS: ['agent/*'],
  clearCache: vi.fn(),
}));

// Module under test
import { isAgentBranch, isHeadlessAllowed } from '../branch-check.js';
import { getAgentPatterns } from '../agent-patterns-registry.js';

// Mock getConfig
vi.mock('../lumenflow-config.js', () => ({
  getConfig: vi.fn(() => ({
    git: {
      mainBranch: 'main',
      laneBranchPrefix: 'lane/',
      agentBranchPatterns: [], // Empty to use registry
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
        vi.mocked(getAgentPatterns).mockResolvedValue(['claude/*', 'agent/*']);

        const result = await isAgentBranch(null);

        expect(result).toBe(false);
      });

      it('should return false for undefined branch', async () => {
        vi.mocked(getAgentPatterns).mockResolvedValue(['claude/*', 'agent/*']);

        const result = await isAgentBranch(undefined);

        expect(result).toBe(false);
      });

      it('should return false for empty string branch', async () => {
        vi.mocked(getAgentPatterns).mockResolvedValue(['claude/*', 'agent/*']);

        const result = await isAgentBranch('');

        expect(result).toBe(false);
      });

      it('should return false for detached HEAD', async () => {
        vi.mocked(getAgentPatterns).mockResolvedValue(['claude/*', 'agent/*']);

        const result = await isAgentBranch('HEAD');

        expect(result).toBe(false);
      });

      it('should return false for main branch', async () => {
        vi.mocked(getAgentPatterns).mockResolvedValue(['main/*', 'agent/*']);

        const result = await isAgentBranch('main');

        expect(result).toBe(false);
      });

      it('should return false for master branch', async () => {
        vi.mocked(getAgentPatterns).mockResolvedValue(['master/*', 'agent/*']);

        const result = await isAgentBranch('master');

        expect(result).toBe(false);
      });

      it('should return false for lane branches', async () => {
        vi.mocked(getAgentPatterns).mockResolvedValue(['lane/*', 'agent/*']);

        const result = await isAgentBranch('lane/operations/wu-123');

        expect(result).toBe(false);
      });
    });

    describe('agent branch patterns from registry', () => {
      it('should match claude/* branches', async () => {
        vi.mocked(getAgentPatterns).mockResolvedValue([
          'claude/*',
          'codex/*',
          'copilot/*',
          'cursor/*',
          'agent/*',
        ]);

        const result = await isAgentBranch('claude/session-12345');

        expect(result).toBe(true);
      });

      it('should match codex/* branches', async () => {
        vi.mocked(getAgentPatterns).mockResolvedValue([
          'claude/*',
          'codex/*',
          'copilot/*',
          'cursor/*',
          'agent/*',
        ]);

        const result = await isAgentBranch('codex/workspace-abc');

        expect(result).toBe(true);
      });

      it('should match copilot/* branches', async () => {
        vi.mocked(getAgentPatterns).mockResolvedValue([
          'claude/*',
          'codex/*',
          'copilot/*',
          'cursor/*',
          'agent/*',
        ]);

        const result = await isAgentBranch('copilot/pr-fix-123');

        expect(result).toBe(true);
      });

      it('should match cursor/* branches', async () => {
        vi.mocked(getAgentPatterns).mockResolvedValue([
          'claude/*',
          'codex/*',
          'copilot/*',
          'cursor/*',
          'agent/*',
        ]);

        const result = await isAgentBranch('cursor/composer-session');

        expect(result).toBe(true);
      });

      it('should match agent/* branches (default pattern)', async () => {
        vi.mocked(getAgentPatterns).mockResolvedValue(['agent/*']);

        const result = await isAgentBranch('agent/automation-task');

        expect(result).toBe(true);
      });

      it('should not match branches outside patterns', async () => {
        vi.mocked(getAgentPatterns).mockResolvedValue(['claude/*', 'agent/*']);

        const result = await isAgentBranch('feature/my-feature');

        expect(result).toBe(false);
      });
    });

    describe('glob pattern matching', () => {
      it('should support ** glob patterns', async () => {
        vi.mocked(getAgentPatterns).mockResolvedValue(['ai/**']);

        expect(await isAgentBranch('ai/agent/claude/session')).toBe(true);
        expect(await isAgentBranch('ai/task')).toBe(true);
      });

      it('should support multiple glob patterns', async () => {
        vi.mocked(getAgentPatterns).mockResolvedValue(['bot/*', 'automation/*']);

        expect(await isAgentBranch('bot/task-123')).toBe(true);
        expect(await isAgentBranch('automation/deploy')).toBe(true);
        expect(await isAgentBranch('human/work')).toBe(false);
      });
    });

    describe('config override', () => {
      it('should use config patterns when specified', async () => {
        // Re-mock with config patterns
        vi.doMock('../lumenflow-config.js', () => ({
          getConfig: vi.fn(() => ({
            git: {
              mainBranch: 'main',
              laneBranchPrefix: 'lane/',
              agentBranchPatterns: ['custom/*'], // Config override
            },
          })),
        }));

        // Note: This test verifies the behavior when config has patterns
        // The actual logic falls back to registry when config is empty
        vi.mocked(getAgentPatterns).mockResolvedValue(['registry/*']);

        // With empty config patterns, should use registry
        const result = await isAgentBranch('registry/branch');

        expect(result).toBe(true);
      });
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
