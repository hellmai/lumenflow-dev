/**
 * @fileoverview Tests for wu-done-paths module
 *
 * WU-1490: Tests for detectWorkspaceMode() with branch-pr claimed mode.
 * WU-1589: Tests for claimed_branch schema, defaultBranchFrom() resolver precedence.
 *
 * Tests cover:
 * - detectWorkspaceMode returns branch-pr for claimed_mode: branch-pr
 * - detectWorkspaceMode treats branch-pr as non-worktree (same return type as branch-only)
 * - detectWorkspaceMode still defaults to worktree when claimed_mode is missing
 * - claimed_branch schema field acceptance and backward compatibility
 * - defaultBranchFrom() prefers claimed_branch over lane-derived naming
 *
 * @module __tests__/wu-done-paths.test
 */

import { describe, it, expect } from 'vitest';
import { detectWorkspaceMode, defaultBranchFrom } from '../wu-done-paths.js';
import { CLAIMED_MODES } from '../wu-constants.js';
import { WUSchema } from '../wu-schema.js';

describe('wu-done-paths', () => {
  describe('detectWorkspaceMode', () => {
    it('should return worktree for claimed_mode: worktree', () => {
      const doc = { claimed_mode: CLAIMED_MODES.WORKTREE };
      expect(detectWorkspaceMode(doc)).toBe(CLAIMED_MODES.WORKTREE);
    });

    it('should return branch-only for claimed_mode: branch-only', () => {
      const doc = { claimed_mode: CLAIMED_MODES.BRANCH_ONLY };
      expect(detectWorkspaceMode(doc)).toBe(CLAIMED_MODES.BRANCH_ONLY);
    });

    it('should return branch-pr for claimed_mode: branch-pr', () => {
      const doc = { claimed_mode: CLAIMED_MODES.BRANCH_PR };
      expect(detectWorkspaceMode(doc)).toBe(CLAIMED_MODES.BRANCH_PR);
    });

    it('should treat branch-pr as non-worktree mode', () => {
      const doc = { claimed_mode: CLAIMED_MODES.BRANCH_PR };
      const mode = detectWorkspaceMode(doc);
      // branch-pr should NOT return worktree mode
      expect(mode).not.toBe(CLAIMED_MODES.WORKTREE);
    });

    it('should default to worktree when claimed_mode is missing', () => {
      const doc = {};
      expect(detectWorkspaceMode(doc)).toBe(CLAIMED_MODES.WORKTREE);
    });

    it('should default to worktree when claimed_mode is undefined', () => {
      const doc = { claimed_mode: undefined };
      expect(detectWorkspaceMode(doc)).toBe(CLAIMED_MODES.WORKTREE);
    });
  });

  // WU-1589: AC2 - defaultBranchFrom() resolver precedence
  describe('defaultBranchFrom (WU-1589)', () => {
    it('should prefer claimed_branch when present', () => {
      const doc = {
        id: 'WU-1589',
        lane: 'Framework: Core Lifecycle',
        claimed_branch: 'feature/my-custom-branch',
      };
      expect(defaultBranchFrom(doc)).toBe('feature/my-custom-branch');
    });

    it('should fall back to lane-derived branch when claimed_branch is absent', () => {
      const doc = {
        id: 'WU-1589',
        lane: 'Framework: Core Lifecycle',
      };
      expect(defaultBranchFrom(doc)).toBe('lane/framework-core-lifecycle/wu-1589');
    });

    it('should fall back to lane-derived branch when claimed_branch is empty string', () => {
      const doc = {
        id: 'WU-1589',
        lane: 'Framework: Core Lifecycle',
        claimed_branch: '',
      };
      expect(defaultBranchFrom(doc)).toBe('lane/framework-core-lifecycle/wu-1589');
    });

    it('should fall back to lane-derived branch when claimed_branch is undefined', () => {
      const doc = {
        id: 'WU-1589',
        lane: 'Framework: Core Lifecycle',
        claimed_branch: undefined,
      };
      expect(defaultBranchFrom(doc)).toBe('lane/framework-core-lifecycle/wu-1589');
    });

    it('should return null when both lane and id are empty', () => {
      const doc = { lane: '', id: '' };
      expect(defaultBranchFrom(doc)).toBeNull();
    });

    it('should use claimed_branch even when lane is empty', () => {
      const doc = {
        id: 'WU-1589',
        lane: '',
        claimed_branch: 'refs/heads/codex/my-branch',
      };
      expect(defaultBranchFrom(doc)).toBe('refs/heads/codex/my-branch');
    });
  });

  // WU-1589: AC1 - claimed_branch schema field
  describe('WU schema claimed_branch (WU-1589)', () => {
    /** Minimal valid WU data for schema testing */
    const minimalWU = {
      id: 'WU-9999',
      title: 'Test WU for schema validation',
      lane: 'Framework: Core',
      type: 'feature',
      status: 'ready',
      priority: 'P1',
      created: '2026-02-06',
      description:
        'Context: test. Problem: test problem statement. Solution: test solution that is long enough to meet the minimum.',
      acceptance: ['Acceptance criterion one'],
    };

    it('should accept WU with claimed_branch string', () => {
      const data = { ...minimalWU, claimed_branch: 'feature/cloud-branch' };
      const result = WUSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.claimed_branch).toBe('feature/cloud-branch');
      }
    });

    it('should accept WU without claimed_branch (backward compatibility)', () => {
      const data = { ...minimalWU };
      const result = WUSchema.safeParse(data);
      expect(result.success).toBe(true);
      // claimed_branch should be undefined when not provided
      if (result.success) {
        expect(result.data.claimed_branch).toBeUndefined();
      }
    });

    it('should accept WU with both claimed_branch and claimed_mode', () => {
      const data = {
        ...minimalWU,
        claimed_branch: 'codex/feature-branch',
        claimed_mode: 'branch-pr',
      };
      const result = WUSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.claimed_branch).toBe('codex/feature-branch');
        expect(result.data.claimed_mode).toBe('branch-pr');
      }
    });
  });

  describe('WU schema claimed_mode: branch-pr', () => {
    /** Minimal valid WU data for schema testing */
    const minimalWU = {
      id: 'WU-9999',
      title: 'Test WU for schema validation',
      lane: 'Framework: Core',
      type: 'feature',
      status: 'ready',
      priority: 'P1',
      created: '2026-02-06',
      description:
        'Context: test. Problem: test problem statement. Solution: test solution that is long enough to meet the minimum.',
      acceptance: ['Acceptance criterion one'],
    };

    it('should accept claimed_mode: branch-pr in WU schema', () => {
      const data = { ...minimalWU, claimed_mode: 'branch-pr' };
      const result = WUSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept claimed_mode: worktree in WU schema', () => {
      const data = { ...minimalWU, claimed_mode: 'worktree' };
      const result = WUSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept claimed_mode: branch-only in WU schema', () => {
      const data = { ...minimalWU, claimed_mode: 'branch-only' };
      const result = WUSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject invalid claimed_mode values', () => {
      const data = { ...minimalWU, claimed_mode: 'invalid-mode' };
      const result = WUSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });
});
