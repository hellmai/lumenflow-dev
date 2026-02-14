/**
 * @file wu-lifecycle-arg-validators.test.ts
 * @description Tests for WU lifecycle CLI arg validation using shared schemas (WU-1454)
 */

import { describe, it, expect } from 'vitest';

import {
  validateWuBlockArgs,
  validateWuUnblockArgs,
  validateWuEditArgs,
  validateWuReleaseArgs,
  validateWuRecoverArgs,
  validateWuRepairArgs,
  validateWuDepsArgs,
  validateWuPrepArgs,
  validateWuPreflightArgs,
  validateWuPruneArgs,
  validateWuDeleteArgs,
  validateWuCleanupArgs,
  validateWuSpawnArgs,
  validateWuValidateArgs,
  validateWuInferLaneArgs,
  validateWuUnlockLaneArgs,
} from '../schemas/wu-lifecycle-arg-validators.js';

describe('WU Lifecycle CLI Argument Validation (WU-1454)', () => {
  // ==========================================================================
  // wu:block
  // ==========================================================================

  describe('validateWuBlockArgs', () => {
    it('should reject missing required fields', () => {
      const result = validateWuBlockArgs({});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('id is required');
      expect(result.errors).toContain('reason is required');
    });

    it('should accept valid args', () => {
      const result = validateWuBlockArgs({
        id: 'WU-1234',
        reason: 'Blocked on dependency',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ==========================================================================
  // wu:unblock
  // ==========================================================================

  describe('validateWuUnblockArgs', () => {
    it('should reject missing id', () => {
      const result = validateWuUnblockArgs({});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('id is required');
    });

    it('should accept valid args', () => {
      const result = validateWuUnblockArgs({ id: 'WU-1234' });
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // wu:edit
  // ==========================================================================

  describe('validateWuEditArgs', () => {
    it('should reject missing id', () => {
      const result = validateWuEditArgs({});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('id is required');
    });

    it('should accept valid args', () => {
      const result = validateWuEditArgs({ id: 'WU-1234' });
      expect(result.valid).toBe(true);
    });

    it('should validate priority enum', () => {
      const result = validateWuEditArgs({
        id: 'WU-1234',
        priority: 'invalid',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('priority'))).toBe(true);
    });
  });

  // ==========================================================================
  // wu:release
  // ==========================================================================

  describe('validateWuReleaseArgs', () => {
    it('should reject missing id', () => {
      const result = validateWuReleaseArgs({});
      expect(result.valid).toBe(false);
    });

    it('should accept valid args', () => {
      const result = validateWuReleaseArgs({ id: 'WU-1234' });
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // wu:recover
  // ==========================================================================

  describe('validateWuRecoverArgs', () => {
    it('should reject missing id', () => {
      const result = validateWuRecoverArgs({});
      expect(result.valid).toBe(false);
    });

    it('should accept valid args with action', () => {
      const result = validateWuRecoverArgs({
        id: 'WU-1234',
        action: 'resume',
      });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid action', () => {
      const result = validateWuRecoverArgs({
        id: 'WU-1234',
        action: 'bad_action',
      });
      expect(result.valid).toBe(false);
    });
  });

  // ==========================================================================
  // wu:repair
  // ==========================================================================

  describe('validateWuRepairArgs', () => {
    it('should accept empty args', () => {
      const result = validateWuRepairArgs({});
      expect(result.valid).toBe(true);
    });

    it('should accept all flags', () => {
      const result = validateWuRepairArgs({
        id: 'WU-1234',
        check: true,
        all: true,
      });
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // wu:deps
  // ==========================================================================

  describe('validateWuDepsArgs', () => {
    it('should reject missing id', () => {
      const result = validateWuDepsArgs({});
      expect(result.valid).toBe(false);
    });

    it('should accept valid args with format', () => {
      const result = validateWuDepsArgs({
        id: 'WU-1234',
        format: 'mermaid',
      });
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // wu:prep
  // ==========================================================================

  describe('validateWuPrepArgs', () => {
    it('should reject missing id', () => {
      const result = validateWuPrepArgs({});
      expect(result.valid).toBe(false);
    });

    it('should accept valid args', () => {
      const result = validateWuPrepArgs({ id: 'WU-1234' });
      expect(result.valid).toBe(true);
    });

    it('should accept full_tests flag', () => {
      const result = validateWuPrepArgs({ id: 'WU-1234', full_tests: true });
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // wu:preflight
  // ==========================================================================

  describe('validateWuPreflightArgs', () => {
    it('should reject missing id', () => {
      const result = validateWuPreflightArgs({});
      expect(result.valid).toBe(false);
    });

    it('should accept valid args', () => {
      const result = validateWuPreflightArgs({ id: 'WU-1234' });
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // wu:prune
  // ==========================================================================

  describe('validateWuPruneArgs', () => {
    it('should accept empty args', () => {
      const result = validateWuPruneArgs({});
      expect(result.valid).toBe(true);
    });

    it('should accept execute flag', () => {
      const result = validateWuPruneArgs({ execute: true });
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // wu:delete
  // ==========================================================================

  describe('validateWuDeleteArgs', () => {
    it('should reject missing id', () => {
      const result = validateWuDeleteArgs({});
      expect(result.valid).toBe(false);
    });

    it('should accept valid args', () => {
      const result = validateWuDeleteArgs({ id: 'WU-1234' });
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // wu:cleanup
  // ==========================================================================

  describe('validateWuCleanupArgs', () => {
    it('should reject missing id', () => {
      const result = validateWuCleanupArgs({});
      expect(result.valid).toBe(false);
    });

    it('should accept valid args', () => {
      const result = validateWuCleanupArgs({ id: 'WU-1234' });
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // wu:spawn
  // ==========================================================================

  describe('validateWuSpawnArgs', () => {
    it('should reject missing id', () => {
      const result = validateWuSpawnArgs({});
      expect(result.valid).toBe(false);
    });

    it('should accept valid args with all options', () => {
      const result = validateWuSpawnArgs({
        id: 'WU-1234',
        client: 'claude-code',
        thinking: true,
        budget: 10000,
      });
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // wu:validate
  // ==========================================================================

  describe('validateWuValidateArgs', () => {
    it('should reject missing id', () => {
      const result = validateWuValidateArgs({});
      expect(result.valid).toBe(false);
    });

    it('should accept valid args', () => {
      const result = validateWuValidateArgs({ id: 'WU-1234' });
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // wu:infer-lane
  // ==========================================================================

  describe('validateWuInferLaneArgs', () => {
    it('should accept empty args', () => {
      const result = validateWuInferLaneArgs({});
      expect(result.valid).toBe(true);
    });

    it('should accept all options', () => {
      const result = validateWuInferLaneArgs({
        id: 'WU-1234',
        paths: ['src/file.ts'],
        desc: 'Description',
      });
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // wu:unlock-lane
  // ==========================================================================

  describe('validateWuUnlockLaneArgs', () => {
    it('should accept empty args', () => {
      const result = validateWuUnlockLaneArgs({});
      expect(result.valid).toBe(true);
    });

    it('should accept lane with options', () => {
      const result = validateWuUnlockLaneArgs({
        lane: 'Framework: Core',
        reason: 'Stuck',
        force: true,
      });
      expect(result.valid).toBe(true);
    });
  });
});
