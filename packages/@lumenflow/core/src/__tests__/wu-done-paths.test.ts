/**
 * @fileoverview Tests for wu-done-paths module
 *
 * WU-1490: Tests for detectWorkspaceMode() with branch-pr claimed mode.
 *
 * Tests cover:
 * - detectWorkspaceMode returns branch-pr for claimed_mode: branch-pr
 * - detectWorkspaceMode treats branch-pr as non-worktree (same return type as branch-only)
 * - detectWorkspaceMode still defaults to worktree when claimed_mode is missing
 *
 * @module __tests__/wu-done-paths.test
 */

import { describe, it, expect } from 'vitest';
import { detectWorkspaceMode } from '../wu-done-paths.js';
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
