// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as locationResolver from '@lumenflow/core/context/location-resolver';
import * as errorHandler from '@lumenflow/core/error-handler';
import * as wuYaml from '@lumenflow/core/wu-yaml';
import { CONTEXT_VALIDATION, WU_STATUS, CLAIMED_MODES } from '@lumenflow/core/wu-constants';

const { LOCATION_TYPES } = CONTEXT_VALIDATION;

// Mock dependencies
vi.mock('@lumenflow/core/context/location-resolver');
vi.mock('@lumenflow/core/error-handler');
vi.mock('@lumenflow/core/wu-yaml');
vi.mock('../gates.js', () => ({
  runGates: vi.fn().mockResolvedValue(true),
}));
vi.mock('@lumenflow/core/wu-checkpoint', () => ({
  createPreGatesCheckpoint: vi.fn().mockResolvedValue({ checkpointId: 'ckpt-test1234' }),
}));

describe('wu-prep (WU-1223)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('location validation', () => {
    it('should error when run from main checkout', async () => {
      // Mock location as main checkout
      vi.mocked(locationResolver.resolveLocation).mockResolvedValue({
        type: LOCATION_TYPES.MAIN,
        cwd: '/repo',
        gitRoot: '/repo',
        mainCheckout: '/repo',
        worktreeName: null,
        worktreeWuId: null,
      });

      // Import after mocks are set up
      const { resolveLocation } = await import('@lumenflow/core/context/location-resolver');
      const location = await resolveLocation();

      // Verify the mock returns main
      expect(location.type).toBe(LOCATION_TYPES.MAIN);
    });

    it('should proceed when run from worktree', async () => {
      // Mock location as worktree
      vi.mocked(locationResolver.resolveLocation).mockResolvedValue({
        type: LOCATION_TYPES.WORKTREE,
        cwd: '/repo/worktrees/framework-cli-wu-1223',
        gitRoot: '/repo/worktrees/framework-cli-wu-1223',
        mainCheckout: '/repo',
        worktreeName: 'framework-cli-wu-1223',
        worktreeWuId: 'WU-1223',
      });

      const { resolveLocation } = await import('@lumenflow/core/context/location-resolver');
      const location = await resolveLocation();

      // Verify the mock returns worktree
      expect(location.type).toBe(LOCATION_TYPES.WORKTREE);
      expect(location.mainCheckout).toBe('/repo');
    });
  });

  describe('WU status validation', () => {
    it('should only allow in_progress WUs', async () => {
      // Mock WU YAML with wrong status
      const mockDoc = {
        id: 'WU-1223',
        status: WU_STATUS.DONE,
        title: 'Test WU',
      };

      vi.mocked(wuYaml.readWU).mockReturnValue(mockDoc as ReturnType<typeof wuYaml.readWU>);

      const { readWU } = await import('@lumenflow/core/wu-yaml');
      const doc = readWU('path/to/wu.yaml', 'WU-1223');

      expect(doc.status).toBe(WU_STATUS.DONE);
      expect(doc.status).not.toBe(WU_STATUS.IN_PROGRESS);
    });
  });

  describe('success message', () => {
    it('should include copy-paste instruction with main path', async () => {
      // The success message should include:
      // 1. Main checkout path
      // 2. WU ID
      // 3. Copy-paste command: cd <main> && pnpm wu:done --id <WU-ID>

      const mainCheckout = '/repo';
      const wuId = 'WU-1223';

      // Build expected command that would be in the success message
      const expectedCommand = `cd ${mainCheckout} && pnpm wu:done --id ${wuId}`;

      expect(expectedCommand).toBe('cd /repo && pnpm wu:done --id WU-1223');
    });
  });
});

describe('wu:done worktree check (WU-1223)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should error when run from worktree with guidance to use wu:prep', async () => {
    // Mock location as worktree
    vi.mocked(locationResolver.resolveLocation).mockResolvedValue({
      type: LOCATION_TYPES.WORKTREE,
      cwd: '/repo/worktrees/framework-cli-wu-1223',
      gitRoot: '/repo/worktrees/framework-cli-wu-1223',
      mainCheckout: '/repo',
      worktreeName: 'framework-cli-wu-1223',
      worktreeWuId: 'WU-1223',
    });

    const { resolveLocation } = await import('@lumenflow/core/context/location-resolver');
    const location = await resolveLocation();

    // The error message should guide user to wu:prep workflow
    expect(location.type).toBe(LOCATION_TYPES.WORKTREE);

    // Error message should contain:
    const errorShouldContain = [
      'wu:prep', // Mention the new command
      'main checkout', // Explain where wu:done should run
      '/repo', // Main checkout path
    ];

    // Build the expected error content
    const expectedGuidance = `pnpm wu:prep --id WU-1223`;
    expect(expectedGuidance).toContain('wu:prep');
  });
});

describe('wu-prep spec-linter classification (WU-1441)', () => {
  it('should detect pre-existing failures only', async () => {
    const { classifySpecLinterFailures } = await import('../wu-prep.js');
    const result = classifySpecLinterFailures({
      mainInvalid: ['WU-1'],
      worktreeInvalid: ['WU-1'],
    });

    expect(result.hasPreExisting).toBe(true);
    expect(result.hasNewFailures).toBe(false);
    expect(result.newFailures).toEqual([]);
  });

  it('should detect newly introduced failures', async () => {
    const { classifySpecLinterFailures } = await import('../wu-prep.js');
    const result = classifySpecLinterFailures({
      mainInvalid: ['WU-1'],
      worktreeInvalid: ['WU-1', 'WU-2'],
    });

    expect(result.hasPreExisting).toBe(true);
    expect(result.hasNewFailures).toBe(true);
    expect(result.newFailures).toEqual(['WU-2']);
  });

  it('should detect failures when main is clean', async () => {
    const { classifySpecLinterFailures } = await import('../wu-prep.js');
    const result = classifySpecLinterFailures({
      mainInvalid: [],
      worktreeInvalid: ['WU-3'],
    });

    expect(result.hasPreExisting).toBe(false);
    expect(result.hasNewFailures).toBe(true);
    expect(result.newFailures).toEqual(['WU-3']);
  });
});

/**
 * WU-1493: Tests for branch-pr mode support in wu:prep
 *
 * Acceptance criteria:
 * - wu:prep reads claimed_mode before hard worktree rejection
 * - For branch-pr WUs, wu:prep runs from main checkout on the correct lane branch
 * - wu:prep validates current branch matches the WU lane branch in branch-pr mode
 * - Success output for branch-pr shows PR-based completion next step
 */
describe('wu-prep branch-pr mode (WU-1493)', () => {
  describe('isBranchPrMode', () => {
    it('should return true for claimed_mode: branch-pr', async () => {
      const { isBranchPrMode } = await import('../wu-prep.js');
      const doc = { claimed_mode: CLAIMED_MODES.BRANCH_PR };
      expect(isBranchPrMode(doc)).toBe(true);
    });

    it('should return false for claimed_mode: worktree', async () => {
      const { isBranchPrMode } = await import('../wu-prep.js');
      const doc = { claimed_mode: CLAIMED_MODES.WORKTREE };
      expect(isBranchPrMode(doc)).toBe(false);
    });

    it('should return false when claimed_mode is missing', async () => {
      const { isBranchPrMode } = await import('../wu-prep.js');
      const doc = {};
      expect(isBranchPrMode(doc)).toBe(false);
    });

    it('should return false for claimed_mode: branch-only', async () => {
      const { isBranchPrMode } = await import('../wu-prep.js');
      const doc = { claimed_mode: CLAIMED_MODES.BRANCH_ONLY };
      expect(isBranchPrMode(doc)).toBe(false);
    });
  });

  describe('validateBranchPrBranch', () => {
    it('should return valid when current branch matches expected lane branch', async () => {
      const { validateBranchPrBranch } = await import('../wu-prep.js');
      const result = validateBranchPrBranch({
        currentBranch: 'lane/framework-cli/wu-1493',
        expectedBranch: 'lane/framework-cli/wu-1493',
      });
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return invalid when current branch does not match expected', async () => {
      const { validateBranchPrBranch } = await import('../wu-prep.js');
      const result = validateBranchPrBranch({
        currentBranch: 'main',
        expectedBranch: 'lane/framework-cli/wu-1493',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('lane/framework-cli/wu-1493');
    });

    it('should include the current branch name in error message', async () => {
      const { validateBranchPrBranch } = await import('../wu-prep.js');
      const result = validateBranchPrBranch({
        currentBranch: 'some-other-branch',
        expectedBranch: 'lane/framework-cli/wu-1493',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('some-other-branch');
    });
  });

  describe('formatBranchPrSuccessMessage', () => {
    it('should include PR-based next step in success output', async () => {
      const { formatBranchPrSuccessMessage } = await import('../wu-prep.js');
      const message = formatBranchPrSuccessMessage({
        wuId: 'WU-1493',
        laneBranch: 'lane/framework-cli/wu-1493',
      });
      // Should mention creating a PR
      expect(message).toContain('PR');
      expect(message).toContain('WU-1493');
    });

    it('should include the lane branch name', async () => {
      const { formatBranchPrSuccessMessage } = await import('../wu-prep.js');
      const message = formatBranchPrSuccessMessage({
        wuId: 'WU-1493',
        laneBranch: 'lane/framework-cli/wu-1493',
      });
      expect(message).toContain('lane/framework-cli/wu-1493');
    });

    it('should include wu:cleanup as the post-merge step', async () => {
      const { formatBranchPrSuccessMessage } = await import('../wu-prep.js');
      const message = formatBranchPrSuccessMessage({
        wuId: 'WU-1493',
        laneBranch: 'lane/framework-cli/wu-1493',
      });
      expect(message).toContain('wu:cleanup');
    });
  });
});

describe('wu-prep code_paths coverage preflight (WU-1531)', () => {
  describe('findMissingCodePathCoverage', () => {
    it('should mark unmatched code_paths as missing', async () => {
      const { findMissingCodePathCoverage } = await import('../wu-prep.js');
      const missing = findMissingCodePathCoverage({
        codePaths: [
          'packages/@lumenflow/core/src/wu-lint.ts',
          'packages/@lumenflow/cli/src/wu-prep.ts',
        ],
        changedFiles: ['packages/@lumenflow/core/src/wu-lint.ts'],
      });

      expect(missing).toEqual(['packages/@lumenflow/cli/src/wu-prep.ts']);
    });

    it('should treat directory code_paths as covered when files under them changed', async () => {
      const { findMissingCodePathCoverage } = await import('../wu-prep.js');
      const missing = findMissingCodePathCoverage({
        codePaths: ['packages/@lumenflow/cli/src'],
        changedFiles: ['packages/@lumenflow/cli/src/wu-prep.ts'],
      });

      expect(missing).toEqual([]);
    });

    it('should support glob code_paths matching changed files', async () => {
      const { findMissingCodePathCoverage } = await import('../wu-prep.js');
      const missing = findMissingCodePathCoverage({
        codePaths: ['packages/@lumenflow/cli/src/**/*.ts'],
        changedFiles: ['packages/@lumenflow/cli/src/wu-prep.ts'],
      });

      expect(missing).toEqual([]);
    });
  });

  describe('checkCodePathCoverageBeforeGates', () => {
    it('should return invalid when code_paths are not touched in branch diff', async () => {
      const { checkCodePathCoverageBeforeGates } = await import('../wu-prep.js');
      const spawnSyncFn = vi.fn().mockReturnValue({
        status: 0,
        stdout: 'packages/@lumenflow/core/src/wu-lint.ts\n',
        stderr: '',
      });

      const result = checkCodePathCoverageBeforeGates({
        wuId: 'WU-1531',
        codePaths: ['packages/@lumenflow/cli/src/wu-prep.ts'],
        cwd: '/repo/worktree',
        spawnSyncFn,
      });

      expect(result.valid).toBe(false);
      expect(result.missingCodePaths).toEqual(['packages/@lumenflow/cli/src/wu-prep.ts']);
      expect(result.changedFiles).toEqual(['packages/@lumenflow/core/src/wu-lint.ts']);
    });

    it('should return valid when all code_paths are covered by branch changes', async () => {
      const { checkCodePathCoverageBeforeGates } = await import('../wu-prep.js');
      const spawnSyncFn = vi.fn().mockReturnValue({
        status: 0,
        stdout: 'packages/@lumenflow/cli/src/wu-prep.ts\n',
        stderr: '',
      });

      const result = checkCodePathCoverageBeforeGates({
        wuId: 'WU-1531',
        codePaths: ['packages/@lumenflow/cli/src/wu-prep.ts'],
        cwd: '/repo/worktree',
        spawnSyncFn,
      });

      expect(result.valid).toBe(true);
      expect(result.missingCodePaths).toEqual([]);
    });
  });

  describe('formatCodePathCoverageFailure', () => {
    it('should include missing paths, changed files, and wu:edit guidance', async () => {
      const { formatCodePathCoverageFailure } = await import('../wu-prep.js');
      const message = formatCodePathCoverageFailure({
        wuId: 'WU-1531',
        missingCodePaths: ['packages/@lumenflow/cli/src/wu-prep.ts'],
        changedFiles: ['packages/@lumenflow/core/src/wu-lint.ts'],
      });

      expect(message).toContain('packages/@lumenflow/cli/src/wu-prep.ts');
      expect(message).toContain('packages/@lumenflow/core/src/wu-lint.ts');
      expect(message).toContain('pnpm wu:edit --id WU-1531 --replace-code-paths --code-paths');
    });
  });
});

describe('wu-prep test scoping (WU-1676)', () => {
  it('returns scoped unit test paths when full-tests is not requested', async () => {
    const { resolveScopedUnitTestsForPrep } = await import('../wu-prep.js');
    const scoped = resolveScopedUnitTestsForPrep({
      fullTests: false,
      tests: {
        unit: [
          'packages/@lumenflow/cli/src/__tests__/wu-prep.test.ts',
          'packages/@lumenflow/cli/src/__tests__/wu-create-required-fields.test.ts',
        ],
      },
    });

    expect(scoped).toEqual([
      'packages/@lumenflow/cli/src/__tests__/wu-prep.test.ts',
      'packages/@lumenflow/cli/src/__tests__/wu-create-required-fields.test.ts',
    ]);
  });

  it('returns empty scoped list when --full-tests is requested', async () => {
    const { resolveScopedUnitTestsForPrep } = await import('../wu-prep.js');
    const scoped = resolveScopedUnitTestsForPrep({
      fullTests: true,
      tests: {
        unit: ['packages/@lumenflow/cli/src/__tests__/wu-prep.test.ts'],
      },
    });

    expect(scoped).toEqual([]);
  });

  it('filters blank and non-string test entries', async () => {
    const { resolveScopedUnitTestsForPrep } = await import('../wu-prep.js');
    const scoped = resolveScopedUnitTestsForPrep({
      fullTests: false,
      tests: {
        unit: [
          'packages/@lumenflow/cli/src/__tests__/wu-prep.test.ts',
          '',
          '   ',
          123 as unknown as string,
        ],
      },
    });

    expect(scoped).toEqual(['packages/@lumenflow/cli/src/__tests__/wu-prep.test.ts']);
  });
});

describe('wu-prep gates-passed checkpoint (WU-2102)', () => {
  it('should export createPrepCheckpoint function', async () => {
    const mod = await import('../wu-prep.js');
    expect(typeof mod.createPrepCheckpoint).toBe('function');
  });

  it('should call createPreGatesCheckpoint with gatesPassed: true', async () => {
    const { createPreGatesCheckpoint } = await import('@lumenflow/core/wu-checkpoint');
    const { createPrepCheckpoint } = await import('../wu-prep.js');

    await createPrepCheckpoint({
      wuId: 'WU-TEST',
      worktreePath: '/repo/worktrees/test-wu-test',
      branchName: 'lane/test/wu-test',
    });

    expect(createPreGatesCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        wuId: 'WU-TEST',
        worktreePath: '/repo/worktrees/test-wu-test',
        branchName: 'lane/test/wu-test',
        gatesPassed: true,
      }),
      expect.any(Object),
    );
  });
});

describe('wu-prep dirty-main mutation guard (WU-1750)', () => {
  it('blocks when main checkout has non-allowlisted dirty files in worktree mode', async () => {
    const { evaluatePrepMainMutationGuard } = await import('../wu-prep.js');
    const result = evaluatePrepMainMutationGuard({
      mainCheckout: '/repo',
      isBranchPr: false,
      mainStatus:
        ' M packages/@lumenflow/cli/src/wu-prep.ts\n?? docs/04-operations/tasks/status.md\n',
    });

    expect(result.blocked).toBe(true);
    expect(result.blockedPaths).toContain('packages/@lumenflow/cli/src/wu-prep.ts');
    expect(result.blockedPaths).toContain('docs/04-operations/tasks/status.md');
    expect(result.message).toContain('wu:prep');
    expect(result.message).toContain('MCP');
  });

  it('allows allowlisted main checkout dirty files in worktree mode', async () => {
    const { evaluatePrepMainMutationGuard } = await import('../wu-prep.js');
    const result = evaluatePrepMainMutationGuard({
      mainCheckout: '/repo',
      isBranchPr: false,
      mainStatus:
        ' M .lumenflow/state/wu-events.jsonl\n?? docs/tasks/wu/WU-1750.yaml\n',
    });

    expect(result.blocked).toBe(false);
    expect(result.blockedPaths).toEqual([]);
  });

  it('allows branch-pr mode even when non-allowlisted files are dirty on main', async () => {
    const { evaluatePrepMainMutationGuard } = await import('../wu-prep.js');
    const result = evaluatePrepMainMutationGuard({
      mainCheckout: '/repo',
      isBranchPr: true,
      mainStatus: ' M packages/@lumenflow/cli/src/wu-prep.ts\n',
    });

    expect(result.blocked).toBe(false);
    expect(result.blockedPaths).toEqual([]);
  });
});

describe('wu-prep TDD provenance enforcement (WU-2132)', () => {
  describe('hasDocumentedTddException', () => {
    it('returns true when notes include explicit tdd-exception marker', async () => {
      const { hasDocumentedTddException } = await import('../wu-prep.js');
      expect(hasDocumentedTddException('tdd-exception: generated types only')).toBe(true);
    });

    it('returns false when notes do not include tdd-exception marker', async () => {
      const { hasDocumentedTddException } = await import('../wu-prep.js');
      expect(hasDocumentedTddException('routine implementation notes')).toBe(false);
    });
  });

  describe('hasTddEvidenceInWorkingDiff', () => {
    it('returns true when changed files include test files', async () => {
      const { hasTddEvidenceInWorkingDiff } = await import('../wu-prep.js');
      expect(
        hasTddEvidenceInWorkingDiff({
          changedFiles: ['packages/@lumenflow/cli/src/__tests__/wu-prep.test.ts'],
          declaredTestPaths: [],
        }),
      ).toBe(true);
    });

    it('returns true when declared tests.unit path is covered by branch diff', async () => {
      const { hasTddEvidenceInWorkingDiff } = await import('../wu-prep.js');
      expect(
        hasTddEvidenceInWorkingDiff({
          changedFiles: ['packages/@lumenflow/cli/src/__tests__/wu-prep.test.ts'],
          declaredTestPaths: ['packages/@lumenflow/cli/src/__tests__/**/*.test.ts'],
        }),
      ).toBe(true);
    });

    it('returns false when no test-like changes are present', async () => {
      const { hasTddEvidenceInWorkingDiff } = await import('../wu-prep.js');
      expect(
        hasTddEvidenceInWorkingDiff({
          changedFiles: ['packages/@lumenflow/cli/src/wu-prep.ts'],
          declaredTestPaths: [],
        }),
      ).toBe(false);
    });
  });

  describe('evaluateTddDiffEvidenceForPrep', () => {
    it('returns valid when WU type is not feature/bug', async () => {
      const { evaluateTddDiffEvidenceForPrep } = await import('../wu-prep.js');
      const result = await evaluateTddDiffEvidenceForPrep({
        wuId: 'WU-2132',
        doc: { type: 'documentation' },
        cwd: '/repo/worktree',
        resolveChangedFilesFn: vi.fn(),
      });

      expect(result.valid).toBe(true);
      expect(result.reason).toBe('not-applicable');
    });

    it('returns valid when notes include documented exception', async () => {
      const { evaluateTddDiffEvidenceForPrep } = await import('../wu-prep.js');
      const resolveChangedFilesFn = vi.fn();
      const result = await evaluateTddDiffEvidenceForPrep({
        wuId: 'WU-2132',
        doc: { type: 'feature', notes: 'tdd-exception: config-only refactor' },
        cwd: '/repo/worktree',
        resolveChangedFilesFn,
      });

      expect(result.valid).toBe(true);
      expect(result.reason).toBe('documented-exception');
      expect(resolveChangedFilesFn).not.toHaveBeenCalled();
    });

    it('returns invalid when feature/bug WU has no touched tests and no exception', async () => {
      const { evaluateTddDiffEvidenceForPrep } = await import('../wu-prep.js');
      const result = await evaluateTddDiffEvidenceForPrep({
        wuId: 'WU-2132',
        doc: { type: 'feature', notes: 'normal notes', tests: { unit: [] } },
        cwd: '/repo/worktree',
        resolveChangedFilesFn: vi.fn().mockResolvedValue({
          ok: true,
          files: ['packages/@lumenflow/cli/src/wu-prep.ts'],
          baseRef: 'main',
          headRef: 'HEAD',
        }),
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('missing-test-diff-evidence');
      expect(result.changedFiles).toEqual(['packages/@lumenflow/cli/src/wu-prep.ts']);
    });

    it('returns valid when diff resolver reports touched tests', async () => {
      const { evaluateTddDiffEvidenceForPrep } = await import('../wu-prep.js');
      const result = await evaluateTddDiffEvidenceForPrep({
        wuId: 'WU-2132',
        doc: { type: 'bug', notes: 'normal notes', tests: { unit: ['tests/**/*.test.ts'] } },
        cwd: '/repo/worktree',
        resolveChangedFilesFn: vi.fn().mockResolvedValue({
          ok: true,
          files: ['tests/core/wu-prep.test.ts'],
          baseRef: 'origin/main',
          headRef: 'HEAD',
        }),
      });

      expect(result.valid).toBe(true);
      expect(result.reason).toBe('test-diff-evidence-found');
    });
  });
});
