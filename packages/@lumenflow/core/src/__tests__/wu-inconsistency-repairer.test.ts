// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Unit tests for WU Inconsistency Repairer (WU-2043)
 *
 * Tests the repairer in isolation:
 * - Strategy dispatch via FILE_REPAIR_STRATEGIES and GIT_REPAIR_STRATEGIES
 * - Error categorization (file vs git-only vs non-repairable)
 * - Unknown-type handling (returns skipped)
 * - Strategy map completeness: all CONSISTENCY_TYPES with canAutoRepair have handlers
 * - Dry-run mode
 * - repairWUInconsistency orchestration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FILE_REPAIR_STRATEGIES,
  GIT_REPAIR_STRATEGIES,
  repairWUInconsistency,
} from '../wu-inconsistency-repairer.js';
import { CONSISTENCY_TYPES } from '../wu-constants.js';
import type { ConsistencyError } from '../wu-consistency-detector.js';

// Mock file repair functions
vi.mock('../wu-consistency-file-repairs.js', () => ({
  createStampInWorktree: vi.fn().mockResolvedValue(['stamps/WU-100.done']),
  updateYamlToDoneInWorktree: vi.fn().mockResolvedValue(['wu/WU-100.yaml']),
  removeWUFromSectionInWorktree: vi.fn().mockResolvedValue(['status.md']),
  removeOrphanWorktree: vi.fn().mockResolvedValue({ success: true }),
}));

// Mock micro-worktree
vi.mock('../micro-worktree.js', () => ({
  withMicroWorktree: vi.fn().mockImplementation(async (opts) => {
    // Simulate micro-worktree by calling execute with a fake path
    return opts.execute({ worktreePath: '/tmp/micro-wt' });
  }),
}));

// Mock wu-paths
vi.mock('../wu-paths.js', () => ({
  WU_PATHS: {
    STATUS: () => 'docs/04-operations/tasks/status.md',
    BACKLOG: () => 'docs/04-operations/tasks/backlog.md',
  },
}));

// Helper to create consistency errors
function makeError(overrides: Partial<ConsistencyError>): ConsistencyError {
  return {
    type: CONSISTENCY_TYPES.YAML_DONE_NO_STAMP,
    wuId: 'WU-100',
    canAutoRepair: true,
    ...overrides,
  };
}

describe('FILE_REPAIR_STRATEGIES', () => {
  it('should have a handler for YAML_DONE_NO_STAMP', () => {
    expect(FILE_REPAIR_STRATEGIES[CONSISTENCY_TYPES.YAML_DONE_NO_STAMP]).toBeDefined();
  });

  it('should have a handler for YAML_DONE_STATUS_IN_PROGRESS', () => {
    expect(
      FILE_REPAIR_STRATEGIES[CONSISTENCY_TYPES.YAML_DONE_STATUS_IN_PROGRESS],
    ).toBeDefined();
  });

  it('should have a handler for BACKLOG_DUAL_SECTION', () => {
    expect(FILE_REPAIR_STRATEGIES[CONSISTENCY_TYPES.BACKLOG_DUAL_SECTION]).toBeDefined();
  });

  it('should have a handler for STAMP_EXISTS_YAML_NOT_DONE', () => {
    expect(
      FILE_REPAIR_STRATEGIES[CONSISTENCY_TYPES.STAMP_EXISTS_YAML_NOT_DONE],
    ).toBeDefined();
  });

  describe('YAML_DONE_NO_STAMP strategy', () => {
    it('should call createStampInWorktree and return success with files', async () => {
      const strategy = FILE_REPAIR_STRATEGIES[CONSISTENCY_TYPES.YAML_DONE_NO_STAMP]!;
      const error = makeError({
        type: CONSISTENCY_TYPES.YAML_DONE_NO_STAMP,
        wuId: 'WU-100',
        title: 'Test WU',
      });

      const result = await strategy(error, '/tmp/wt', '/project');

      expect(result.success).toBe(true);
      expect(result.files).toBeDefined();
    });

    it('should use WU ID as fallback title when title is missing', async () => {
      const { createStampInWorktree } = await import(
        '../wu-consistency-file-repairs.js'
      );
      const strategy = FILE_REPAIR_STRATEGIES[CONSISTENCY_TYPES.YAML_DONE_NO_STAMP]!;
      const error = makeError({
        type: CONSISTENCY_TYPES.YAML_DONE_NO_STAMP,
        wuId: 'WU-200',
        title: undefined,
      });

      await strategy(error, '/tmp/wt', '/project');

      expect(createStampInWorktree).toHaveBeenCalledWith(
        'WU-200',
        'WU WU-200',
        '/tmp/wt',
      );
    });
  });
});

describe('GIT_REPAIR_STRATEGIES', () => {
  it('should have a handler for ORPHAN_WORKTREE_DONE', () => {
    expect(GIT_REPAIR_STRATEGIES[CONSISTENCY_TYPES.ORPHAN_WORKTREE_DONE]).toBeDefined();
  });

  describe('ORPHAN_WORKTREE_DONE strategy', () => {
    it('should skip when lane metadata is missing', async () => {
      const strategy = GIT_REPAIR_STRATEGIES[CONSISTENCY_TYPES.ORPHAN_WORKTREE_DONE]!;
      const error = makeError({
        type: CONSISTENCY_TYPES.ORPHAN_WORKTREE_DONE,
        lane: undefined,
      });

      const result = await strategy(error, '/project');

      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('Missing lane metadata');
    });

    it('should call removeOrphanWorktree when lane is present', async () => {
      const { removeOrphanWorktree } = await import(
        '../wu-consistency-file-repairs.js'
      );
      const strategy = GIT_REPAIR_STRATEGIES[CONSISTENCY_TYPES.ORPHAN_WORKTREE_DONE]!;
      const error = makeError({
        type: CONSISTENCY_TYPES.ORPHAN_WORKTREE_DONE,
        wuId: 'WU-100',
        lane: 'Framework: Core',
      });

      await strategy(error, '/project');

      expect(removeOrphanWorktree).toHaveBeenCalledWith(
        'WU-100',
        'Framework: Core',
        '/project',
      );
    });
  });
});

describe('Strategy map completeness', () => {
  it('should have handlers for all auto-repairable CONSISTENCY_TYPES', () => {
    // All CONSISTENCY_TYPES that can be auto-repaired
    const autoRepairableTypes = [
      CONSISTENCY_TYPES.YAML_DONE_NO_STAMP,
      CONSISTENCY_TYPES.YAML_DONE_STATUS_IN_PROGRESS,
      CONSISTENCY_TYPES.BACKLOG_DUAL_SECTION,
      CONSISTENCY_TYPES.STAMP_EXISTS_YAML_NOT_DONE,
      CONSISTENCY_TYPES.ORPHAN_WORKTREE_DONE,
    ];

    for (const type of autoRepairableTypes) {
      const hasFileStrategy = type in FILE_REPAIR_STRATEGIES;
      const hasGitStrategy = type in GIT_REPAIR_STRATEGIES;
      expect(
        hasFileStrategy || hasGitStrategy,
        `Missing handler for auto-repairable type: ${type}`,
      ).toBe(true);
    }
  });

  it('should NOT have MISSING_WORKTREE_CLAIMED in either strategy map (not auto-repairable)', () => {
    expect(
      CONSISTENCY_TYPES.MISSING_WORKTREE_CLAIMED in FILE_REPAIR_STRATEGIES,
    ).toBe(false);
    expect(
      CONSISTENCY_TYPES.MISSING_WORKTREE_CLAIMED in GIT_REPAIR_STRATEGIES,
    ).toBe(false);
  });
});

describe('repairWUInconsistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return zero counts for a valid report', async () => {
    const result = await repairWUInconsistency({ valid: true, errors: [] });

    expect(result).toEqual({ repaired: 0, skipped: 0, failed: 0 });
  });

  it('should count non-repairable errors as skipped', async () => {
    const report = {
      valid: false,
      errors: [
        makeError({
          type: CONSISTENCY_TYPES.MISSING_WORKTREE_CLAIMED,
          canAutoRepair: false,
        }),
      ],
    };

    const result = await repairWUInconsistency(report);

    expect(result.skipped).toBe(1);
  });

  it('should count repairable errors in dry-run mode', async () => {
    const report = {
      valid: false,
      errors: [
        makeError({
          type: CONSISTENCY_TYPES.YAML_DONE_NO_STAMP,
          canAutoRepair: true,
        }),
        makeError({
          type: CONSISTENCY_TYPES.ORPHAN_WORKTREE_DONE,
          canAutoRepair: true,
          lane: 'Framework: Core',
        }),
      ],
    };

    const result = await repairWUInconsistency(report, { dryRun: true });

    expect(result.repaired).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('should handle unknown error types as skipped in file repair', async () => {
    const report = {
      valid: false,
      errors: [
        makeError({
          type: 'UNKNOWN_TYPE',
          canAutoRepair: true,
        }),
      ],
    };

    // When inside micro-worktree, it uses direct mode
    const result = await repairWUInconsistency(report, {
      projectRoot: '/tmp/project',
    });

    expect(result.skipped).toBe(1);
  });

  it('should use direct repair mode when projectRoot is explicitly provided', async () => {
    const { withMicroWorktree } = await import('../micro-worktree.js');

    const report = {
      valid: false,
      errors: [
        makeError({
          type: CONSISTENCY_TYPES.YAML_DONE_NO_STAMP,
          canAutoRepair: true,
        }),
      ],
    };

    await repairWUInconsistency(report, {
      projectRoot: '/tmp/explicit-root',
    });

    // Should NOT use micro-worktree when projectRoot is provided
    expect(withMicroWorktree).not.toHaveBeenCalled();
  });

  it('should use micro-worktree when projectRoot is not provided', async () => {
    const { withMicroWorktree } = await import('../micro-worktree.js');

    const report = {
      valid: false,
      errors: [
        makeError({
          type: CONSISTENCY_TYPES.YAML_DONE_NO_STAMP,
          canAutoRepair: true,
        }),
      ],
    };

    await repairWUInconsistency(report);

    expect(withMicroWorktree).toHaveBeenCalled();
  });
});
