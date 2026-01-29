/**
 * WU-1192: Tests for consolidated wu-spawn prompt generation
 *
 * Acceptance Criteria:
 * 1. Prompt template content lives in @lumenflow/core only
 * 2. CLI wu-spawn.ts is thin wrapper calling core
 * 3. orchestrate:initiative output matches wu:spawn output (same sentinel, same constraints)
 * 4. No duplicate prompt template content between packages
 */

import { describe, it, expect } from 'vitest';

// These imports should work after refactor - currently they will fail (RED phase)
import {
  TRUNCATION_WARNING_BANNER,
  SPAWN_END_SENTINEL,
  generateTestGuidance,
  generateTaskInvocation,
  generateWorktreeBlockRecoverySection,
} from '../wu-spawn.js';
import { SpawnStrategyFactory } from '../spawn-strategy.js';

// Constants for repeated test values (sonarjs/no-duplicate-string)
const TEST_SPAWN_CLIENT = 'claude-code';
const TEST_WORKTREE_PATH = '/path/to/worktree';

describe('WU-1192: Consolidated wu-spawn prompt generation', () => {
  describe('AC1: Prompt template content lives in @lumenflow/core only', () => {
    it('should export TRUNCATION_WARNING_BANNER constant', () => {
      expect(TRUNCATION_WARNING_BANNER).toBeDefined();
      expect(TRUNCATION_WARNING_BANNER).toContain('LUMENFLOW_TRUNCATION_WARNING');
      expect(TRUNCATION_WARNING_BANNER).toContain('DO NOT TRUNCATE');
    });

    it('should export SPAWN_END_SENTINEL constant', () => {
      expect(SPAWN_END_SENTINEL).toBeDefined();
      expect(SPAWN_END_SENTINEL).toBe('<!-- LUMENFLOW_SPAWN_END -->');
    });

    it('should export generateTestGuidance function', () => {
      expect(generateTestGuidance).toBeDefined();
      expect(typeof generateTestGuidance).toBe('function');
    });

    it('should export generateWorktreeBlockRecoverySection function', () => {
      expect(generateWorktreeBlockRecoverySection).toBeDefined();
      expect(typeof generateWorktreeBlockRecoverySection).toBe('function');
    });
  });

  describe('AC3: orchestrate:initiative output matches wu:spawn output', () => {
    const mockWUDoc = {
      title: 'Test WU',
      lane: 'Framework: Core',
      type: 'feature',
      status: 'ready',
      description: 'Test description',
      acceptance: ['AC1', 'AC2'],
      code_paths: ['packages/@lumenflow/core/src/test.ts'],
    };

    it('should include TRUNCATION_WARNING_BANNER at start of output', () => {
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy);

      expect(output).toContain('LUMENFLOW_TRUNCATION_WARNING');
    });

    it('should include SPAWN_END_SENTINEL at end of output', () => {
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy);

      expect(output).toContain('LUMENFLOW_SPAWN_END');
    });

    it('should include constraint #8 SKIP-GATES AUTONOMY', () => {
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy);

      expect(output).toContain('SKIP-GATES AUTONOMY');
      expect(output).toContain('WU-1142');
    });
  });

  describe('generateTestGuidance type-aware output', () => {
    it('should return TDD directive for feature type', () => {
      const guidance = generateTestGuidance('feature');
      expect(guidance).toContain('TDD DIRECTIVE');
      expect(guidance).toContain('FAILING TEST');
    });

    it('should return refactor guidance for refactor type', () => {
      const guidance = generateTestGuidance('refactor');
      expect(guidance).toContain('Refactor Testing');
      expect(guidance).toContain('Existing tests must pass');
    });

    it('should return docs guidance for documentation type', () => {
      const guidance = generateTestGuidance('documentation');
      expect(guidance).toContain('Documentation Standards');
      expect(guidance).toContain('gates --docs-only');
    });
  });

  describe('generateWorktreeBlockRecoverySection', () => {
    it('should include worktree path in output', () => {
      const section = generateWorktreeBlockRecoverySection(TEST_WORKTREE_PATH);
      expect(section).toContain(TEST_WORKTREE_PATH);
      expect(section).toContain('worktree required');
    });

    it('should provide recovery instructions', () => {
      const section = generateWorktreeBlockRecoverySection(TEST_WORKTREE_PATH);
      expect(section).toContain('git worktree list');
      expect(section).toContain('Quick Fix');
    });
  });
});
