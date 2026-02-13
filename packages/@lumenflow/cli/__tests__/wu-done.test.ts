/**
 * @file wu-done.test.ts
 * Test suite for wu:done --docs-only flag (WU-1012)
 *
 * Tests the --docs-only flag behavior:
 * - Flag exists and is parsed correctly
 * - Validates WU exposure is 'documentation'
 * - Format gate still runs on markdown files
 * - Code gates (lint, typecheck, test) are skipped
 * - Clear error if used on non-docs WU
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import the functions we're testing from dist (built files)
import {
  validateDocsOnlyFlag,
  buildGatesCommand,
  computeBranchOnlyFallback,
} from '../dist/wu-done.js';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';

// Mock die function for WU-1153 tests
vi.mock('@lumenflow/core/error-handler', () => ({
  die: vi.fn(),
}));

// Test constants to avoid duplicate strings
const TEST_WU_ID = 'WU-1012';
const TEST_WU_ID_1153 = 'WU-1153';
const DOCS_ONLY_FLAG = '--docs-only';
const EXPOSURE_FIELD = 'exposure';
const WU_DONE_FILE = 'packages/@lumenflow/cli/src/wu-done.ts';
const NEW_FILE = 'packages/@lumenflow/cli/src/new-file.ts';
const COMMITTED_FILE = 'packages/@lumenflow/cli/src/committed.ts';
const GIT_STATUS_MODIFIED_WU_DONE = ` M ${WU_DONE_FILE}`;
const GIT_STATUS_MODIFIED_WU_DONE_AND_NEW = `${GIT_STATUS_MODIFIED_WU_DONE}\n?? ${NEW_FILE}`;
const GIT_STATUS_STAGED_MIXED = `M  ${WU_DONE_FILE}\n A  packages/@lumenflow/cli/src/added.ts\n D  packages/@lumenflow/cli/src/deleted.ts\n?? packages/@lumenflow/cli/src/untracked.ts`;

describe('wu:done --docs-only flag (WU-1012)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('argument parsing', () => {
    it('should parse --docs-only flag', () => {
      const originalArgv = process.argv;
      process.argv = ['node', 'wu-done.js', '--id', TEST_WU_ID, '--docs-only'];

      const args = createWUParser({
        name: 'wu-done',
        description: 'Complete a work unit',
        options: [WU_OPTIONS.id, WU_OPTIONS.docsOnly],
      });

      process.argv = originalArgv;

      expect(args.docsOnly).toBe(true);
      expect(args.id).toBe(TEST_WU_ID);
    });

    it('should default docsOnly to undefined when not provided', () => {
      const originalArgv = process.argv;
      process.argv = ['node', 'wu-done.js', '--id', TEST_WU_ID];

      const args = createWUParser({
        name: 'wu-done',
        description: 'Complete a work unit',
        options: [WU_OPTIONS.id, WU_OPTIONS.docsOnly],
      });

      process.argv = originalArgv;

      expect(args.docsOnly).toBeUndefined();
    });
  });

  describe('exposure validation', () => {
    it('should accept --docs-only for WU with exposure: documentation', () => {
      const wu = {
        id: TEST_WU_ID,
        exposure: 'documentation',
        type: 'documentation',
        code_paths: ['docs/04-operations/_frameworks/lumenflow/test.md'],
      };

      const result = validateDocsOnlyFlag(wu, { docsOnly: true });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject --docs-only for WU with exposure: api', () => {
      const wu = {
        id: TEST_WU_ID,
        exposure: 'api',
        type: 'feature',
        code_paths: [WU_DONE_FILE],
      };

      const result = validateDocsOnlyFlag(wu, { docsOnly: true });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain(DOCS_ONLY_FLAG);
      expect(result.errors[0]).toContain(EXPOSURE_FIELD);
    });

    it('should reject --docs-only for WU with exposure: ui', () => {
      const wu = {
        id: TEST_WU_ID,
        exposure: 'ui',
        type: 'feature',
        code_paths: ['apps/web/src/app/page.tsx'],
      };

      const result = validateDocsOnlyFlag(wu, { docsOnly: true });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain(DOCS_ONLY_FLAG);
    });

    it('should reject --docs-only for WU with exposure: backend-only', () => {
      const wu = {
        id: TEST_WU_ID,
        exposure: 'backend-only',
        type: 'feature',
        code_paths: ['packages/@lumenflow/core/src/utils.ts'],
      };

      const result = validateDocsOnlyFlag(wu, { docsOnly: true });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain(DOCS_ONLY_FLAG);
    });

    it('should accept --docs-only for WU with docs-only code_paths (auto-detect)', () => {
      // WU without explicit exposure but with docs-only code_paths
      const wu = {
        id: TEST_WU_ID,
        type: 'documentation',
        code_paths: ['docs/04-operations/_frameworks/lumenflow/playbook.md', 'CLAUDE.md'],
      };

      const result = validateDocsOnlyFlag(wu, { docsOnly: true });

      expect(result.valid).toBe(true);
    });

    it('should not validate exposure when --docs-only is not used', () => {
      const wu = {
        id: TEST_WU_ID,
        exposure: 'api',
        type: 'feature',
      };

      // docsOnly is false/undefined - no validation needed
      const result = validateDocsOnlyFlag(wu, { docsOnly: false });

      expect(result.valid).toBe(true);
    });
  });

  describe('gates behavior with --docs-only', () => {
    it('should build docs-only gates command when --docs-only flag is set', () => {
      const cmd = buildGatesCommand({ docsOnly: true, isDocsOnly: false });

      expect(cmd).toContain(DOCS_ONLY_FLAG);
    });

    it('should build docs-only gates command when auto-detected as docs-only', () => {
      const cmd = buildGatesCommand({ docsOnly: false, isDocsOnly: true });

      expect(cmd).toContain(DOCS_ONLY_FLAG);
    });

    it('should build full gates command when neither flag nor auto-detect', () => {
      const cmd = buildGatesCommand({ docsOnly: false, isDocsOnly: false });

      expect(cmd).not.toContain(DOCS_ONLY_FLAG);
    });

    it('should prioritize explicit --docs-only over auto-detection', () => {
      // Both explicit flag and auto-detection true
      const cmd = buildGatesCommand({ docsOnly: true, isDocsOnly: true });

      expect(cmd).toContain(DOCS_ONLY_FLAG);
    });
  });

  describe('error messages', () => {
    it('should provide clear error message for non-docs WU', () => {
      const wu = {
        id: 'WU-999',
        exposure: 'api',
        type: 'feature',
        code_paths: ['packages/@lumenflow/cli/src/api.ts'],
      };

      const result = validateDocsOnlyFlag(wu, { docsOnly: true });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('WU-999');
      expect(result.errors[0]).toContain('documentation');
      // Should suggest removing the flag or changing the WU type
      expect(result.errors[0]).toMatch(/remove.*--docs-only|change.*exposure/i);
    });
  });
});

describe('branch-only fallback (WU-1031)', () => {
  it('should allow branch-only when worktree is missing and flag is provided', () => {
    const result = computeBranchOnlyFallback({
      isBranchOnly: false,
      branchOnlyRequested: true,
      worktreeExists: false,
      derivedWorktree: 'worktrees/framework-cli-wu-1031',
    });

    expect(result.allowFallback).toBe(true);
    expect(result.effectiveBranchOnly).toBe(true);
  });

  it('should not allow branch-only when worktree exists', () => {
    const result = computeBranchOnlyFallback({
      isBranchOnly: false,
      branchOnlyRequested: true,
      worktreeExists: true,
      derivedWorktree: 'worktrees/framework-cli-wu-1031',
    });

    expect(result.allowFallback).toBe(false);
    expect(result.effectiveBranchOnly).toBe(false);
  });

  it('should keep branch-only when already in branch-only mode', () => {
    const result = computeBranchOnlyFallback({
      isBranchOnly: true,
      branchOnlyRequested: false,
      worktreeExists: false,
      derivedWorktree: null,
    });

    expect(result.allowFallback).toBe(false);
    expect(result.effectiveBranchOnly).toBe(true);
  });
});

/**
 * WU-1153: wu:done guard for uncommitted code_paths
 *
 * Tests that wu:done aborts before metadata commit when code_paths are uncommitted.
 * This prevents lost work from metadata rollbacks after code commits.
 */
describe('WU-1153: wu:done guard for uncommitted code_paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateCodePathsCommittedBeforeDone', () => {
    it('should pass when all code_paths are committed', async () => {
      const mockGitAdapter = {
        getStatus: vi.fn().mockResolvedValue(''), // Clean status
      };

      const wu = {
        id: TEST_WU_ID_1153,
        code_paths: [WU_DONE_FILE],
      };

      // Import the function we're testing
      const { validateCodePathsCommittedBeforeDone } =
        await import('@lumenflow/core/wu-done-validation');

      const result = await validateCodePathsCommittedBeforeDone(wu, mockGitAdapter);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.uncommittedPaths).toEqual([]);
    });

    it('should pass when code_paths is empty', async () => {
      const mockGitAdapter = {
        getStatus: vi.fn().mockResolvedValue(''), // Clean status
      };

      const wu = {
        id: TEST_WU_ID_1153,
        code_paths: [],
      };

      const { validateCodePathsCommittedBeforeDone } =
        await import('@lumenflow/core/wu-done-validation');

      const result = await validateCodePathsCommittedBeforeDone(wu, mockGitAdapter);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.uncommittedPaths).toEqual([]);
    });

    it('should pass when code_paths is undefined', async () => {
      const mockGitAdapter = {
        getStatus: vi.fn().mockResolvedValue(''), // Clean status
      };

      const wu = {
        id: TEST_WU_ID_1153,
        code_paths: undefined,
      };

      const { validateCodePathsCommittedBeforeDone } =
        await import('@lumenflow/core/wu-done-validation');

      const result = await validateCodePathsCommittedBeforeDone(wu, mockGitAdapter);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.uncommittedPaths).toEqual([]);
    });

    it('should detect uncommitted code_paths', async () => {
      const mockGitAdapter = {
        getStatus: vi.fn().mockResolvedValue(GIT_STATUS_MODIFIED_WU_DONE_AND_NEW),
      };

      const wu = {
        id: TEST_WU_ID_1153,
        code_paths: [
          WU_DONE_FILE,
          NEW_FILE,
          COMMITTED_FILE, // This one is not in status
        ],
      };

      const { validateCodePathsCommittedBeforeDone } =
        await import('@lumenflow/core/wu-done-validation');

      const result = await validateCodePathsCommittedBeforeDone(wu, mockGitAdapter);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.uncommittedPaths).toEqual([WU_DONE_FILE, NEW_FILE]);
    });

    it('should handle different git status formats', async () => {
      const mockGitAdapter = {
        getStatus: vi.fn().mockResolvedValue(GIT_STATUS_STAGED_MIXED),
      };

      const wu = {
        id: TEST_WU_ID_1153,
        code_paths: [
          WU_DONE_FILE,
          'packages/@lumenflow/cli/src/added.ts',
          'packages/@lumenflow/cli/src/deleted.ts',
          'packages/@lumenflow/cli/src/untracked.ts',
        ],
      };

      const { validateCodePathsCommittedBeforeDone } =
        await import('@lumenflow/core/wu-done-validation');

      const result = await validateCodePathsCommittedBeforeDone(wu, mockGitAdapter);
      expect(result.valid).toBe(false);
      expect(result.uncommittedPaths).toEqual([
        WU_DONE_FILE,
        'packages/@lumenflow/cli/src/added.ts',
        'packages/@lumenflow/cli/src/deleted.ts',
        'packages/@lumenflow/cli/src/untracked.ts',
      ]);
    });
  });

  describe('buildCodePathsCommittedErrorMessage', () => {
    it('should build proper error message', async () => {
      const id = TEST_WU_ID_1153;
      const uncommittedPaths = [WU_DONE_FILE, NEW_FILE];

      const { buildCodePathsCommittedErrorMessage } =
        await import('@lumenflow/core/wu-done-validation');
      const message = buildCodePathsCommittedErrorMessage(id, uncommittedPaths);

      expect(message).toContain(TEST_WU_ID_1153);
      expect(message).toContain('2 code_paths for WU-1153 are not committed');
      expect(message).toContain(WU_DONE_FILE);
      expect(message).toContain(NEW_FILE);
      expect(message).toContain('git add');
      expect(message).toContain('git commit');
    });

    it('should handle single uncommitted path', async () => {
      const id = TEST_WU_ID_1153;
      const uncommittedPaths = [WU_DONE_FILE];

      const { buildCodePathsCommittedErrorMessage } =
        await import('@lumenflow/core/wu-done-validation');
      const message = buildCodePathsCommittedErrorMessage(id, uncommittedPaths);

      expect(message).toContain('1 code_path for WU-1153 are not committed');
      expect(message).toContain(WU_DONE_FILE);
    });

    it('should handle multiple uncommitted paths', async () => {
      const id = TEST_WU_ID_1153;
      const uncommittedPaths = [
        'packages/@lumenflow/cli/src/file1.ts',
        'packages/@lumenflow/cli/src/file2.ts',
        'packages/@lumenflow/cli/src/file3.ts',
      ];

      const { buildCodePathsCommittedErrorMessage } =
        await import('@lumenflow/core/wu-done-validation');
      const message = buildCodePathsCommittedErrorMessage(id, uncommittedPaths);

      expect(message).toContain('3 code_paths for WU-1153 are not committed');
      expect(message).toContain('file1.ts');
      expect(message).toContain('file2.ts');
      expect(message).toContain('file3.ts');
    });
  });

  describe('integration with die function', () => {
    it('should call die when validation fails and abort flag is true', async () => {
      const { die } = await import('@lumenflow/core/error-handler');
      const mockDie = vi.mocked(die);

      const mockGitAdapter = {
        getStatus: vi.fn().mockResolvedValue(GIT_STATUS_MODIFIED_WU_DONE),
      };

      const wu = {
        id: TEST_WU_ID_1153,
        code_paths: [WU_DONE_FILE],
      };

      const { validateCodePathsCommittedBeforeDone } =
        await import('@lumenflow/core/wu-done-validation');

      await validateCodePathsCommittedBeforeDone(wu, mockGitAdapter, { abortOnFailure: true });

      expect(mockDie).toHaveBeenCalledWith(
        expect.stringContaining(TEST_WU_ID_1153) &&
          expect.stringContaining('code_path for WU-1153 are not committed'),
      );
    });

    it('should not call die when abort flag is false', async () => {
      const { die } = await import('@lumenflow/core/error-handler');
      const mockDie = vi.mocked(die);

      const mockGitAdapter = {
        getStatus: vi.fn().mockResolvedValue(GIT_STATUS_MODIFIED_WU_DONE),
      };

      const wu = {
        id: TEST_WU_ID_1153,
        code_paths: [WU_DONE_FILE],
      };

      const { validateCodePathsCommittedBeforeDone } =
        await import('@lumenflow/core/wu-done-validation');

      await validateCodePathsCommittedBeforeDone(wu, mockGitAdapter, { abortOnFailure: false });

      expect(mockDie).not.toHaveBeenCalled();
    });
  });
});
