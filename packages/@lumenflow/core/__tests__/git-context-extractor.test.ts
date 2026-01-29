/**
 * Tests for git-context-extractor module (WU-1190)
 *
 * These tests verify the extraction of git history insights:
 * - Co-occurrence: files frequently changed together
 * - Ownership: primary contributors to file/directory
 * - Churn: change frequency metrics (hotspots)
 *
 * TDD: These tests were written BEFORE implementation.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  extractGitContext,
  getFileCoOccurrence,
  getOwnershipSignals,
  getChurnMetrics,
  summarizeGitContext,
  type GitContext,
  type GitContextOptions,
} from '../src/git-context-extractor.js';
import { execSync } from 'node:child_process';

// Mock child_process
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

// Test constants to avoid duplicate string literals
const TEST_PROJECT_ROOT = '/test/project';
const REV_LIST_COUNT_CMD = 'rev-list --count';
const PACKAGES_CORE_PATH = 'packages/core';
const PACKAGES_CLI_PATH = 'packages/cli';

describe('git-context-extractor', () => {
  const mockExecSync = vi.mocked(execSync);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('extractGitContext', () => {
    it('should extract complete git context from a repository', () => {
      // Mock git commands - execSync returns string when encoding is specified
      mockExecSync.mockImplementation((cmd: unknown) => {
        const cmdStr = String(cmd);
        if (cmdStr.includes('--name-only')) {
          return `abc123
packages/core/src/a.ts
packages/core/src/b.ts

def456
packages/core/src/a.ts
packages/cli/src/c.ts
`;
        }
        if (cmdStr.includes('shortlog')) {
          return `    10\tAlice <alice@example.com>
     5\tBob <bob@example.com>
`;
        }
        if (cmdStr.includes(REV_LIST_COUNT_CMD)) {
          return '150';
        }
        if (cmdStr.includes('ls-tree')) {
          return `packages
docs
`;
        }
        if (cmdStr.includes('--numstat')) {
          return `50\t25\tpackages/core/src/a.ts`;
        }
        return '';
      });

      const projectRoot = TEST_PROJECT_ROOT;
      const result = extractGitContext(projectRoot);

      expect(result).toBeDefined();
      expect(result.coOccurrences).toBeDefined();
      expect(result.ownership).toBeDefined();
      expect(result.churn).toBeDefined();
      expect(Array.isArray(result.coOccurrences)).toBe(true);
      expect(Array.isArray(result.ownership)).toBe(true);
      expect(Array.isArray(result.churn)).toBe(true);
    });

    it('should gracefully handle repos with no git history', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('fatal: your current branch does not have any commits');
      });

      const projectRoot = '/test/empty-repo';
      const result = extractGitContext(projectRoot);

      expect(result).toBeDefined();
      expect(result.coOccurrences).toEqual([]);
      expect(result.ownership).toEqual([]);
      expect(result.churn).toEqual([]);
      expect(result.hasLimitedHistory).toBe(true);
    });

    it('should gracefully handle non-git directories', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('fatal: not a git repository');
      });

      const projectRoot = '/test/not-a-repo';
      const result = extractGitContext(projectRoot);

      expect(result).toBeDefined();
      expect(result.coOccurrences).toEqual([]);
      expect(result.ownership).toEqual([]);
      expect(result.churn).toEqual([]);
      expect(result.hasLimitedHistory).toBe(true);
      expect(result.error).toContain('not a git repository');
    });

    it('should respect options for limiting history depth', () => {
      mockExecSync.mockImplementation((cmd: unknown) => {
        const cmdStr = String(cmd);
        if (cmdStr.includes(REV_LIST_COUNT_CMD)) {
          return '150';
        }
        if (cmdStr.includes('ls-tree')) {
          return '';
        }
        return '';
      });

      const projectRoot = TEST_PROJECT_ROOT;
      const options: GitContextOptions = {
        maxCommits: 50,
        since: '3 months ago',
      };

      extractGitContext(projectRoot, options);

      // Verify git commands include the options
      const calls = mockExecSync.mock.calls.map((c) => String(c[0]));
      const logCall = calls.find((c) => c.includes('log'));
      expect(logCall).toContain('-n 50');
      expect(logCall).toContain('--since=3 months ago');
    });
  });

  describe('getFileCoOccurrence', () => {
    it('should identify files frequently changed together', () => {
      // Mock git log with commit info and files
      mockExecSync.mockReturnValue(
        `abc123
packages/core/src/a.ts
packages/core/src/b.ts

def456
packages/core/src/a.ts
packages/core/src/b.ts

ghi789
packages/core/src/a.ts
packages/core/src/c.ts
`,
      );

      const result = getFileCoOccurrence(TEST_PROJECT_ROOT);

      expect(result.length).toBeGreaterThan(0);
      // a.ts and b.ts were changed together in 2 commits
      const abPair = result.find(
        (co) =>
          (co.file1.includes('a.ts') && co.file2.includes('b.ts')) ||
          (co.file1.includes('b.ts') && co.file2.includes('a.ts')),
      );
      expect(abPair).toBeDefined();
      expect(abPair?.count).toBe(2);
    });

    it('should return empty array for repos with single-file commits', () => {
      mockExecSync.mockReturnValue(
        `abc123
packages/core/src/a.ts

def456
packages/core/src/b.ts
`,
      );

      const result = getFileCoOccurrence(TEST_PROJECT_ROOT);

      expect(result).toEqual([]);
    });

    it('should limit results to top N co-occurrences', () => {
      // Generate many co-occurrences with varying counts
      // Each pair needs to appear at least twice to be counted
      const commits = Array.from({ length: 20 }, (_, i) => {
        const files = [`file${i % 5}.ts`, `file${(i % 5) + 1}.ts`];
        return `commit${i}\n${files.join('\n')}\n`;
      }).join('\n');

      mockExecSync.mockReturnValue(commits);

      const result = getFileCoOccurrence(TEST_PROJECT_ROOT, { maxResults: 3 });

      expect(result.length).toBeLessThanOrEqual(3);
    });
  });

  describe('getOwnershipSignals', () => {
    it('should identify primary contributors by directory', () => {
      mockExecSync.mockImplementation((cmd: unknown) => {
        const cmdStr = String(cmd);
        if (cmdStr.includes(PACKAGES_CORE_PATH)) {
          return `    15\tAlice <alice@example.com>
     5\tBob <bob@example.com>
`;
        }
        if (cmdStr.includes(PACKAGES_CLI_PATH)) {
          return `    10\tBob <bob@example.com>
     3\tCharlie <charlie@example.com>
`;
        }
        return '';
      });

      const result = getOwnershipSignals(TEST_PROJECT_ROOT, [
        PACKAGES_CORE_PATH,
        PACKAGES_CLI_PATH,
      ]);

      expect(result.length).toBe(2);
      const coreOwnership = result.find((o) => o.path === PACKAGES_CORE_PATH);
      expect(coreOwnership?.primaryOwner).toContain('Alice');
      expect(coreOwnership?.commitCount).toBe(20); // 15 + 5
    });

    it('should handle directories with no contributors', () => {
      mockExecSync.mockReturnValue('');

      const result = getOwnershipSignals(TEST_PROJECT_ROOT, ['packages/empty']);

      expect(result.length).toBe(1);
      expect(result[0].primaryOwner).toBeNull();
      expect(result[0].commitCount).toBe(0);
    });

    it('should aggregate ownership at package level for monorepos', () => {
      mockExecSync.mockReturnValue(
        `    25\tAlice <alice@example.com>
    10\tBob <bob@example.com>
`,
      );

      const result = getOwnershipSignals(TEST_PROJECT_ROOT, ['packages/@lumenflow/core']);

      expect(result[0].primaryOwner).toContain('Alice');
      expect(result[0].contributors).toHaveLength(2);
    });
  });

  describe('getChurnMetrics', () => {
    it('should identify high-churn files (hotspots)', () => {
      // Mock git log with change counts
      mockExecSync.mockReturnValue(
        `50\t25\tpackages/core/src/hot-file.ts
10\t5\tpackages/core/src/cold-file.ts
100\t50\tpackages/core/src/very-hot-file.ts
`,
      );

      const result = getChurnMetrics(TEST_PROJECT_ROOT);

      expect(result.length).toBeGreaterThan(0);
      // Results should be sorted by churn (descending)
      expect(result[0].filePath).toContain('very-hot-file.ts');
      expect(result[0].additions).toBe(100);
      expect(result[0].deletions).toBe(50);
      expect(result[0].churnScore).toBe(150); // additions + deletions
    });

    it('should filter out non-source files', () => {
      mockExecSync.mockReturnValue(
        `50\t25\tpackages/core/src/file.ts
100\t100\tpnpm-lock.yaml
50\t50\tREADME.md
`,
      );

      const result = getChurnMetrics(TEST_PROJECT_ROOT, { excludePatterns: ['*.yaml', '*.md'] });

      expect(result.length).toBe(1);
      expect(result[0].filePath).toContain('file.ts');
    });

    it('should return empty for repos with no history', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('fatal: no commits');
      });

      const result = getChurnMetrics(TEST_PROJECT_ROOT);

      expect(result).toEqual([]);
    });
  });

  describe('summarizeGitContext', () => {
    it('should produce token-efficient summary under limit', () => {
      const context: GitContext = {
        coOccurrences: [
          { file1: 'a.ts', file2: 'b.ts', count: 10 },
          { file1: 'c.ts', file2: 'd.ts', count: 5 },
        ],
        ownership: [
          {
            path: PACKAGES_CORE_PATH,
            primaryOwner: 'Alice',
            contributors: ['Alice', 'Bob'],
            commitCount: 20,
          },
        ],
        churn: [
          { filePath: 'hot.ts', additions: 100, deletions: 50, churnScore: 150, commitCount: 20 },
        ],
        hasLimitedHistory: false,
      };

      const summary = summarizeGitContext(context, { maxTokens: 500 });

      expect(summary).toBeDefined();
      expect(typeof summary).toBe('string');
      expect(summary.length).toBeLessThan(2000); // Rough token limit proxy
      expect(summary).toContain('Co-occurrence');
      expect(summary).toContain('Ownership');
      expect(summary).toContain('Churn');
    });

    it('should truncate when context exceeds token limit', () => {
      // Create large context
      const context: GitContext = {
        coOccurrences: Array.from({ length: 100 }, (_, i) => ({
          file1: `file${i}a.ts`,
          file2: `file${i}b.ts`,
          count: 10,
        })),
        ownership: Array.from({ length: 50 }, (_, i) => ({
          path: `packages/pkg${i}`,
          primaryOwner: `Owner${i}`,
          contributors: [`Owner${i}`, `Contrib${i}`],
          commitCount: 10,
        })),
        churn: Array.from({ length: 100 }, (_, i) => ({
          filePath: `churn${i}.ts`,
          additions: 50,
          deletions: 25,
          churnScore: 75,
          commitCount: 5,
        })),
        hasLimitedHistory: false,
      };

      const summary = summarizeGitContext(context, { maxTokens: 200 });

      // Should be significantly shorter than unrestricted
      expect(summary.length).toBeLessThan(1000); // ~200 tokens max
      expect(summary).toContain('(truncated)');
    });

    it('should indicate limited history in summary', () => {
      const context: GitContext = {
        coOccurrences: [],
        ownership: [],
        churn: [],
        hasLimitedHistory: true,
        error: 'Repository has fewer than 10 commits',
      };

      const summary = summarizeGitContext(context);

      // The summary should indicate the limited state
      expect(summary).toContain('limited');
    });

    it('should return informative message for completely empty context', () => {
      const context: GitContext = {
        coOccurrences: [],
        ownership: [],
        churn: [],
        hasLimitedHistory: true,
      };

      const summary = summarizeGitContext(context);

      // Should still return something useful
      expect(summary).toContain('limited');
    });
  });

  describe('integration with lane-suggest', () => {
    it('should produce context suitable for LLM prompt enrichment', () => {
      mockExecSync.mockImplementation((cmd: unknown) => {
        const cmdStr = String(cmd);
        if (cmdStr.includes('--name-only')) {
          return `abc123
packages/core/src/state.ts
packages/core/src/validator.ts

def456
packages/cli/src/claim.ts
packages/cli/src/done.ts
`;
        }
        if (cmdStr.includes('shortlog')) {
          return `    10\tAlice <alice@example.com>`;
        }
        if (cmdStr.includes('--numstat')) {
          return `50\t25\tpackages/core/src/state.ts`;
        }
        if (cmdStr.includes(REV_LIST_COUNT_CMD)) {
          return '150';
        }
        if (cmdStr.includes('ls-tree')) {
          return 'packages\n';
        }
        return '';
      });

      const context = extractGitContext(TEST_PROJECT_ROOT);
      const summary = summarizeGitContext(context, { maxTokens: 300 });

      // Summary should be usable as prompt context
      expect(summary).toBeDefined();
      expect(summary).not.toContain('undefined');
      expect(summary).not.toContain('[object Object]');

      // Should be human-readable
      expect(summary).toMatch(/[A-Za-z]/);
    });
  });
});
