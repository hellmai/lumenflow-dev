/**
 * @file wu-done-docs-detection.test.ts
 * @description Tests for doc-source change detection in wu:done
 *
 * WU-1061: Integrate docs:generate into wu:done for @lumenflow/* changes
 *
 * This module tests the detection of changes to files that affect generated
 * documentation, enabling wu:done to regenerate docs only when needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

// Import the module under test
import {
  DOC_SOURCE_PATHSPECS,
  DOC_OUTPUT_FILES,
  hasDocSourceChanges,
  stageDocOutputs,
  runDocsGenerate,
} from '../wu-done-docs-generate.js';

// Mock the git adapter
vi.mock('../git-adapter.js', () => ({
  getGitForCwd: vi.fn(),
  GitAdapter: vi.fn(),
}));

// Mock execSync for running turbo docs:generate
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { getGitForCwd } from '../git-adapter.js';
import { execSync } from 'node:child_process';

describe('wu-done-docs-detection', () => {
  let mockGit: {
    raw: Mock;
    add: Mock;
  };

  beforeEach(() => {
    mockGit = {
      raw: vi.fn(),
      add: vi.fn(),
    };
    vi.mocked(getGitForCwd).mockReturnValue(mockGit as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('DOC_SOURCE_PATHSPECS', () => {
    it('should include generate-cli-docs.ts', () => {
      expect(DOC_SOURCE_PATHSPECS).toContain('tools/generate-cli-docs.ts');
    });

    it('should include arg-parser.ts', () => {
      expect(DOC_SOURCE_PATHSPECS).toContain('packages/@lumenflow/core/src/arg-parser.ts');
    });

    it('should include lumenflow-config-schema.ts', () => {
      expect(DOC_SOURCE_PATHSPECS).toContain(
        'packages/@lumenflow/core/src/lumenflow-config-schema.ts',
      );
    });

    it('should include core index.ts', () => {
      expect(DOC_SOURCE_PATHSPECS).toContain('packages/@lumenflow/core/src/index.ts');
    });

    it('should include CLI src directory', () => {
      expect(DOC_SOURCE_PATHSPECS.some((p) => p.includes('packages/@lumenflow/cli/src'))).toBe(
        true,
      );
    });

    it('should include CLI package.json', () => {
      expect(DOC_SOURCE_PATHSPECS).toContain('packages/@lumenflow/cli/package.json');
    });
  });

  describe('DOC_OUTPUT_FILES', () => {
    it('should include cli.mdx', () => {
      expect(DOC_OUTPUT_FILES).toContain('apps/docs/src/content/docs/reference/cli.mdx');
    });

    it('should include config.mdx', () => {
      expect(DOC_OUTPUT_FILES).toContain('apps/docs/src/content/docs/reference/config.mdx');
    });
  });

  describe('hasDocSourceChanges', () => {
    it('should return true when doc-source files changed', async () => {
      mockGit.raw.mockResolvedValue('packages/@lumenflow/core/src/arg-parser.ts\n');

      const result = await hasDocSourceChanges('main');

      expect(result).toBe(true);
      expect(mockGit.raw).toHaveBeenCalledWith(
        expect.arrayContaining(['diff', expect.stringContaining('main'), '--name-only', '--']),
      );
    });

    it('should return false when diff is empty', async () => {
      mockGit.raw.mockResolvedValue('');

      const result = await hasDocSourceChanges('main');

      expect(result).toBe(false);
    });

    it('should return false when diff is whitespace-only', async () => {
      // Git may return trailing newlines/whitespace; trimming handles this
      mockGit.raw.mockResolvedValue('   \n  \n');

      const result = await hasDocSourceChanges('main');

      expect(result).toBe(false);
    });

    it('should use the provided base branch for comparison', async () => {
      mockGit.raw.mockResolvedValue('');

      await hasDocSourceChanges('origin/main');

      expect(mockGit.raw).toHaveBeenCalledWith(
        expect.arrayContaining(['diff', 'origin/main...HEAD', '--name-only', '--']),
      );
    });

    it('should detect changes in CLI src directory', async () => {
      mockGit.raw.mockResolvedValue('packages/@lumenflow/cli/src/wu-claim.ts\n');

      const result = await hasDocSourceChanges('main');

      expect(result).toBe(true);
    });

    it('should detect changes to tools/generate-cli-docs.ts', async () => {
      mockGit.raw.mockResolvedValue('tools/generate-cli-docs.ts\n');

      const result = await hasDocSourceChanges('main');

      expect(result).toBe(true);
    });

    it('should detect changes to lumenflow-config-schema.ts', async () => {
      mockGit.raw.mockResolvedValue('packages/@lumenflow/core/src/lumenflow-config-schema.ts\n');

      const result = await hasDocSourceChanges('main');

      expect(result).toBe(true);
    });

    it('should handle git errors gracefully', async () => {
      mockGit.raw.mockRejectedValue(new Error('git error'));

      const result = await hasDocSourceChanges('main');

      // Should return false on error (fail-safe: don't regenerate)
      expect(result).toBe(false);
    });
  });

  describe('stageDocOutputs', () => {
    it('should stage all doc output files', async () => {
      mockGit.add.mockResolvedValue(undefined);

      await stageDocOutputs();

      expect(mockGit.add).toHaveBeenCalledWith(DOC_OUTPUT_FILES);
    });

    it('should propagate staging errors', async () => {
      mockGit.add.mockRejectedValue(new Error('staging failed'));

      await expect(stageDocOutputs()).rejects.toThrow('staging failed');
    });
  });

  describe('runDocsGenerate', () => {
    it('should run turbo docs:generate', () => {
      vi.mocked(execSync).mockReturnValue('');

      runDocsGenerate('/repo/root');

      expect(execSync).toHaveBeenCalledWith('pnpm turbo docs:generate', {
        cwd: '/repo/root',
        stdio: 'inherit',
        encoding: 'utf-8',
      });
    });

    it('should propagate execution errors', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('turbo failed');
      });

      expect(() => runDocsGenerate('/repo/root')).toThrow('turbo failed');
    });
  });
});

describe('Integration: hasDocSourceChanges with real pathspecs', () => {
  // These tests verify the pathspec logic by testing specific file patterns
  // without mocking git

  it('should match exact file paths', () => {
    const testFiles = [
      'tools/generate-cli-docs.ts',
      'packages/@lumenflow/core/src/arg-parser.ts',
      'packages/@lumenflow/core/src/lumenflow-config-schema.ts',
      'packages/@lumenflow/core/src/index.ts',
      'packages/@lumenflow/cli/package.json',
    ];

    for (const file of testFiles) {
      const matches = DOC_SOURCE_PATHSPECS.some(
        (pathspec) => file === pathspec || file.startsWith(pathspec),
      );
      expect(matches).toBe(true);
    }
  });

  it('should match files within CLI src directory', () => {
    const cliFiles = [
      'packages/@lumenflow/cli/src/wu-claim.ts',
      'packages/@lumenflow/cli/src/wu-done.ts',
      'packages/@lumenflow/cli/src/index.ts',
    ];

    const cliSrcPathspec = DOC_SOURCE_PATHSPECS.find((p) =>
      p.includes('packages/@lumenflow/cli/src'),
    );
    expect(cliSrcPathspec).toBeDefined();

    for (const file of cliFiles) {
      const matches = file.startsWith(cliSrcPathspec!.replace(/\/$/, ''));
      expect(matches).toBe(true);
    }
  });

  it('should NOT match unrelated files', () => {
    const unrelatedFiles = [
      'packages/@lumenflow/memory/src/index.ts',
      'apps/docs/src/content/docs/index.mdx',
      'docs/README.md',
      '.github/workflows/ci.yml',
    ];

    for (const file of unrelatedFiles) {
      const matches = DOC_SOURCE_PATHSPECS.some(
        (pathspec) => file === pathspec || file.startsWith(pathspec.replace(/\/$/, '')),
      );
      expect(matches).toBe(false);
    }
  });
});
