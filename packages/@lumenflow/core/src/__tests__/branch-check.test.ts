import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isAgentBranch, isHeadlessAllowed } from '../branch-check.js';

describe('isAgentBranch', () => {
  describe('fail-closed behavior', () => {
    it('returns false for null/undefined branch', () => {
      expect(isAgentBranch(null)).toBe(false);
      expect(isAgentBranch(undefined)).toBe(false);
      expect(isAgentBranch('')).toBe(false);
    });

    it('returns false for detached HEAD', () => {
      expect(isAgentBranch('HEAD')).toBe(false);
    });
  });

  describe('protected branches', () => {
    it('returns false for main branch', () => {
      expect(isAgentBranch('main')).toBe(false);
    });

    it('returns false for master branch', () => {
      expect(isAgentBranch('master')).toBe(false);
    });
  });

  describe('lane branches', () => {
    it('returns false for lane branches', () => {
      expect(isAgentBranch('lane/operations/wu-123')).toBe(false);
      expect(isAgentBranch('lane/intelligence/wu-456')).toBe(false);
    });
  });

  describe('default agent patterns', () => {
    it('returns true for agent/* branches', () => {
      expect(isAgentBranch('agent/prompt-studio-abc')).toBe(true);
      expect(isAgentBranch('agent/test-feature')).toBe(true);
    });
  });

  describe('unknown branches (fail-closed)', () => {
    it('returns false for feature branches', () => {
      expect(isAgentBranch('feature/xyz')).toBe(false);
    });

    it('returns false for claude/* (not in default patterns)', () => {
      expect(isAgentBranch('claude/use-prompt-studio-xyz')).toBe(false);
    });
  });

  describe('config override', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('respects agentBranchPatterns from config', async () => {
      // Mock getConfig to return custom patterns including claude/*
      vi.doMock('../lumenflow-config.js', () => ({
        getConfig: () => ({
          git: { mainBranch: 'main', agentBranchPatterns: ['agent/*', 'claude/*'] },
        }),
      }));

      const { isAgentBranch: freshIsAgentBranch } = await import('../branch-check.js');
      expect(freshIsAgentBranch('claude/use-prompt-studio-xyz')).toBe(true);
    });

    it('falls back to defaults when config patterns empty', async () => {
      vi.doMock('../lumenflow-config.js', () => ({
        getConfig: () => ({ git: { mainBranch: 'main', agentBranchPatterns: [] } }),
      }));

      const { isAgentBranch: freshIsAgentBranch } = await import('../branch-check.js');
      expect(freshIsAgentBranch('agent/test')).toBe(true);
    });

    it('derives protected branches from mainBranch + master', async () => {
      vi.doMock('../lumenflow-config.js', () => ({
        getConfig: () => ({ git: { mainBranch: 'develop', agentBranchPatterns: ['agent/*'] } }),
      }));

      const { isAgentBranch: freshIsAgentBranch } = await import('../branch-check.js');
      // 'develop' is now protected (mainBranch)
      expect(freshIsAgentBranch('develop')).toBe(false);
      // 'master' still protected (legacy)
      expect(freshIsAgentBranch('master')).toBe(false);
      // 'main' is NOT protected when mainBranch='develop'
      // (but fail-closed - unknown branch is blocked anyway)
      expect(freshIsAgentBranch('main')).toBe(false);
    });

    it('respects laneBranchPrefix from config', async () => {
      vi.doMock('../lumenflow-config.js', () => ({
        getConfig: () => ({
          git: { mainBranch: 'main', laneBranchPrefix: 'work/', agentBranchPatterns: ['agent/*'] },
        }),
      }));

      const { isAgentBranch: freshIsAgentBranch } = await import('../branch-check.js');
      // Custom prefix 'work/' should be blocked
      expect(freshIsAgentBranch('work/operations/wu-123')).toBe(false);
      // Default 'lane/' prefix should NOT be blocked when custom prefix is set
      // (but fail-closed - unknown branch is blocked anyway)
      expect(freshIsAgentBranch('lane/operations/wu-123')).toBe(false);
    });
  });
});

describe('isHeadlessAllowed', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns false when LUMENFLOW_HEADLESS is not set', () => {
    delete process.env.LUMENFLOW_HEADLESS;
    expect(isHeadlessAllowed()).toBe(false);
  });

  it('returns false when LUMENFLOW_HEADLESS=1 but no guard', () => {
    process.env.LUMENFLOW_HEADLESS = '1';
    delete process.env.LUMENFLOW_ADMIN;
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    expect(isHeadlessAllowed()).toBe(false);
  });

  it('returns true when LUMENFLOW_HEADLESS=1 and LUMENFLOW_ADMIN=1', () => {
    process.env.LUMENFLOW_HEADLESS = '1';
    process.env.LUMENFLOW_ADMIN = '1';
    expect(isHeadlessAllowed()).toBe(true);
  });

  it('returns true when LUMENFLOW_HEADLESS=1 and CI=true', () => {
    process.env.LUMENFLOW_HEADLESS = '1';
    process.env.CI = 'true';
    expect(isHeadlessAllowed()).toBe(true);
  });

  it('returns true when LUMENFLOW_HEADLESS=1 and CI=1 (truthy)', () => {
    process.env.LUMENFLOW_HEADLESS = '1';
    process.env.CI = '1';
    expect(isHeadlessAllowed()).toBe(true);
  });

  it('returns true when LUMENFLOW_HEADLESS=1 and GITHUB_ACTIONS=true', () => {
    process.env.LUMENFLOW_HEADLESS = '1';
    process.env.GITHUB_ACTIONS = 'true';
    expect(isHeadlessAllowed()).toBe(true);
  });

  it('returns true when LUMENFLOW_HEADLESS=1 and GITHUB_ACTIONS=1 (truthy)', () => {
    process.env.LUMENFLOW_HEADLESS = '1';
    process.env.GITHUB_ACTIONS = '1';
    expect(isHeadlessAllowed()).toBe(true);
  });
});
