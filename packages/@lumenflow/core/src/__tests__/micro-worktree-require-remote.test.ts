/**
 * Tests for micro-worktree requireRemote configuration
 *
 * WU-1308: When git.requireRemote=false, micro-worktree operations should
 * skip origin fetch/merge to enable local-only wu:create/wu:claim.
 *
 * Test coverage:
 * - shouldSkipRemoteOperations helper returns correct values
 * - Configuration defaults are correct (requireRemote=true by default)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Module path for lumenflow-config (extracted to avoid duplication) */
const LUMENFLOW_CONFIG_MODULE = '../lumenflow-config.js';

/** Mock project root path for testing */
const MOCK_PROJECT_ROOT = '/mock/project';

/** Module path for micro-worktree (extracted to avoid duplication) */
const MICRO_WORKTREE_MODULE = '../micro-worktree.js';

describe('micro-worktree requireRemote configuration (WU-1308)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Helper to create mock for lumenflow-config.js with specified git config.
   * @param gitConfig - The git configuration to return from getConfig()
   */
  function mockLumenflowConfig(gitConfig: Record<string, unknown>): void {
    vi.doMock(LUMENFLOW_CONFIG_MODULE, () => ({
      getConfig: vi.fn().mockReturnValue({ git: gitConfig }),
      findProjectRoot: vi.fn().mockReturnValue(MOCK_PROJECT_ROOT),
      getProjectRoot: vi.fn().mockReturnValue(MOCK_PROJECT_ROOT),
    }));
  }

  describe('shouldSkipRemoteOperations helper', () => {
    it('should return true when requireRemote is false', async () => {
      mockLumenflowConfig({ requireRemote: false });

      const { shouldSkipRemoteOperations } = await import(MICRO_WORKTREE_MODULE);

      expect(shouldSkipRemoteOperations()).toBe(true);
    });

    it('should return false when requireRemote is true', async () => {
      mockLumenflowConfig({ requireRemote: true });

      const { shouldSkipRemoteOperations } = await import(MICRO_WORKTREE_MODULE);

      expect(shouldSkipRemoteOperations()).toBe(false);
    });

    it('should return false when requireRemote is undefined (default is true)', async () => {
      mockLumenflowConfig({
        mainBranch: 'main',
        defaultRemote: 'origin',
        // No requireRemote specified - should default to true
      });

      const { shouldSkipRemoteOperations } = await import(MICRO_WORKTREE_MODULE);

      // Default should be requireRemote=true (from schema), so skip should be false
      // But since we're mocking without the default, undefined !== false, so it should return false
      expect(shouldSkipRemoteOperations()).toBe(false);
    });
  });

  describe('shouldSkipRemoteOperations is exported', () => {
    it('should be exported from micro-worktree module', async () => {
      mockLumenflowConfig({ requireRemote: true });

      const module = await import(MICRO_WORKTREE_MODULE);

      expect(typeof module.shouldSkipRemoteOperations).toBe('function');
    });
  });

  describe('configuration schema default', () => {
    it('requireRemote should default to true in the schema', async () => {
      // Test that the actual config schema has the right default
      const { getDefaultConfig } = await import('../lumenflow-config-schema.js');

      const defaultConfig = getDefaultConfig();

      expect(defaultConfig.git.requireRemote).toBe(true);
    });
  });
});
