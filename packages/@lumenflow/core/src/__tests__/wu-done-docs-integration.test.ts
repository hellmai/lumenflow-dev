/**
 * @file wu-done-docs-integration.test.ts
 * @description Tests for wu:done integration with docs:generate
 *
 * WU-1061: Integrate docs:generate into wu:done for @lumenflow/* changes
 *
 * This module tests the integration of doc regeneration into the wu:done workflow,
 * ensuring docs are regenerated when doc-source files change and staged before
 * the metadata commit.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

// Import the integration function
import { maybeRegenerateAndStageDocs } from '../wu-done-docs-generate.js';

// Mock the git adapter
vi.mock('../git-adapter.js', () => ({
  getGitForCwd: vi.fn(),
  GitAdapter: vi.fn(),
}));

// Mock execSync
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { getGitForCwd } from '../git-adapter.js';
import { execSync } from 'node:child_process';

describe('wu-done docs integration', () => {
  let mockGit: {
    raw: Mock;
    add: Mock;
  };
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockGit = {
      raw: vi.fn(),
      add: vi.fn(),
    };
    vi.mocked(getGitForCwd).mockReturnValue(mockGit as never);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    consoleSpy.mockRestore();
  });

  describe('maybeRegenerateAndStageDocs', () => {
    it('should detect changes and regenerate docs when doc-source files changed', async () => {
      // Mock git diff to return a doc-source file
      mockGit.raw.mockResolvedValue('packages/@lumenflow/core/src/arg-parser.ts\n');
      mockGit.add.mockResolvedValue(undefined);
      vi.mocked(execSync).mockReturnValue('');

      const result = await maybeRegenerateAndStageDocs({
        baseBranch: 'main',
        repoRoot: '/repo',
      });

      expect(result.docsChanged).toBe(true);
      expect(result.regenerated).toBe(true);
      expect(execSync).toHaveBeenCalledWith('pnpm turbo docs:generate', expect.any(Object));
    });

    it('should skip regeneration when no doc-source files changed', async () => {
      // Mock git diff to return empty (no doc-source changes)
      mockGit.raw.mockResolvedValue('');

      const result = await maybeRegenerateAndStageDocs({
        baseBranch: 'main',
        repoRoot: '/repo',
      });

      expect(result.docsChanged).toBe(false);
      expect(result.regenerated).toBe(false);
      expect(execSync).not.toHaveBeenCalled();
    });

    it('should use the provided baseBranch for detection', async () => {
      mockGit.raw.mockResolvedValue('');

      await maybeRegenerateAndStageDocs({
        baseBranch: 'origin/main',
        repoRoot: '/repo',
      });

      expect(mockGit.raw).toHaveBeenCalledWith(
        expect.arrayContaining(['diff', 'origin/main...HEAD', '--name-only', '--']),
      );
    });

    it('should stage doc outputs after regeneration', async () => {
      mockGit.raw.mockResolvedValue('tools/generate-cli-docs.ts\n');
      mockGit.add.mockResolvedValue(undefined);
      vi.mocked(execSync).mockReturnValue('');

      await maybeRegenerateAndStageDocs({
        baseBranch: 'main',
        repoRoot: '/repo',
      });

      // Should stage the doc output files
      expect(mockGit.add).toHaveBeenCalledWith(
        expect.arrayContaining([
          'apps/docs/src/content/docs/reference/cli.mdx',
          'apps/docs/src/content/docs/reference/config.mdx',
        ]),
      );
    });

    it('should handle git errors gracefully and return safe defaults', async () => {
      mockGit.raw.mockRejectedValue(new Error('git error'));

      const result = await maybeRegenerateAndStageDocs({
        baseBranch: 'main',
        repoRoot: '/repo',
      });

      // Should not throw, return safe defaults
      expect(result.docsChanged).toBe(false);
      expect(result.regenerated).toBe(false);
    });

    it('should handle turbo execution errors and propagate them', async () => {
      mockGit.raw.mockResolvedValue('tools/generate-cli-docs.ts\n');
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('turbo failed');
      });

      await expect(
        maybeRegenerateAndStageDocs({
          baseBranch: 'main',
          repoRoot: '/repo',
        }),
      ).rejects.toThrow('turbo failed');
    });

    it('should detect changes for CLI src directory changes', async () => {
      mockGit.raw.mockResolvedValue('packages/@lumenflow/cli/src/wu-claim.ts\n');
      mockGit.add.mockResolvedValue(undefined);
      vi.mocked(execSync).mockReturnValue('');

      const result = await maybeRegenerateAndStageDocs({
        baseBranch: 'main',
        repoRoot: '/repo',
      });

      expect(result.docsChanged).toBe(true);
      expect(result.regenerated).toBe(true);
    });
  });
});
