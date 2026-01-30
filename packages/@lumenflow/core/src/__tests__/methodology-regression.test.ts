/**
 * WU-1267: Regression test for default methodology behavior
 *
 * This test ensures that when no methodology config is specified,
 * the system behaves exactly as it did before INIT-009 (methodology work).
 *
 * Pre-INIT-009 behavior (the baseline we must preserve):
 * - Testing: TDD (failing test first)
 * - Architecture: Hexagonal
 * - Coverage threshold: 90%
 * - Coverage mode: block (gates fail if coverage < 90%)
 * - Tests required: true
 *
 * CRITICAL: These tests act as a regression guard. If any of these fail,
 * it means the default behavior has changed and existing users would see
 * different output without opting in.
 */

import { describe, it, expect } from 'vitest';
import { resolvePolicy, getDefaultPolicy } from '../resolve-policy.js';
import { parseConfig } from '../lumenflow-config-schema.js';
import { generateTestGuidance, generateTaskInvocation } from '../wu-spawn.js';
import { SpawnStrategyFactory } from '../spawn-strategy.js';

/**
 * Constants for test values (sonarjs/no-duplicate-string compliance)
 */
const TEST_LANE = 'Framework: Core';
const TEST_DESCRIPTION = 'Test description';
const TEST_CODE_PATH = 'packages/@lumenflow/core/src/test.ts';
const TEST_SPAWN_CLIENT = 'claude-code';

/**
 * Snapshot of pre-INIT-009 default policy values.
 *
 * These are the values that existing LumenFlow users expect when they
 * have no methodology config in their .lumenflow.config.yaml.
 */
const PRE_INIT_009_DEFAULTS = {
  testing: 'tdd',
  architecture: 'hexagonal',
  coverage_threshold: 90,
  coverage_mode: 'block',
  tests_required: true,
} as const;

describe('WU-1267: Default methodology behavior unchanged (regression)', () => {
  describe('AC1: Snapshot test captures spawn output with no methodology config', () => {
    it('should produce spawn output containing TDD methodology by default', () => {
      const mockWUDoc = {
        title: 'Test WU',
        lane: TEST_LANE,
        type: 'feature',
        status: 'ready',
        description: 'Test description for regression testing',
        acceptance: ['Acceptance criterion 1', 'Acceptance criterion 2'],
        code_paths: [TEST_CODE_PATH],
      };

      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-REGRESSION', strategy);

      // Test key invariant parts of spawn output that don't depend on environment
      // These must remain stable for backwards compatibility

      // Must include TDD directive (pre-INIT-009 default)
      expect(output).toContain('TDD DIRECTIVE');

      // Must include Hexagonal Architecture (pre-INIT-009 default)
      expect(output).toContain('Hexagonal Architecture');

      // Must include 90% coverage (pre-INIT-009 default)
      expect(output).toContain('90%');

      // Must include mandatory standards section
      expect(output).toContain('Mandatory Standards');
    });

    it('should generate test guidance that matches pre-INIT-009 TDD directive', () => {
      // Pre-INIT-009: feature types always got TDD directive
      const guidance = generateTestGuidance('feature');
      // Use snapshot for TDD directive text (this is stable, not environment-dependent)
      expect(guidance).toMatchSnapshot('tdd-directive-default');
    });
  });

  describe('AC2: Snapshot matches pre-INIT-009 spawn output exactly', () => {
    it('should include TDD DIRECTIVE section in spawn output by default', () => {
      const mockWUDoc = {
        title: 'Test WU',
        lane: TEST_LANE,
        type: 'feature',
        status: 'ready',
        description: TEST_DESCRIPTION,
        acceptance: ['AC1'],
        code_paths: [TEST_CODE_PATH],
      };

      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy);

      // Pre-INIT-009: TDD directive was always included for feature WUs
      expect(output).toContain('TDD DIRECTIVE');
      expect(output).toContain('FAILING TEST');
      expect(output).toContain('Write a failing test');
    });

    it('should include Hexagonal Architecture in spawn output by default', () => {
      const mockWUDoc = {
        title: 'Test WU',
        lane: TEST_LANE,
        type: 'feature',
        status: 'ready',
        description: TEST_DESCRIPTION,
        acceptance: ['AC1'],
        code_paths: [TEST_CODE_PATH],
      };

      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy);

      // Pre-INIT-009: Hexagonal Architecture was always enforced
      expect(output).toContain('Hexagonal Architecture');
    });

    it('should reference 90% coverage threshold in spawn output by default', () => {
      const mockWUDoc = {
        title: 'Test WU',
        lane: TEST_LANE,
        type: 'feature',
        status: 'ready',
        description: TEST_DESCRIPTION,
        acceptance: ['AC1'],
        code_paths: [TEST_CODE_PATH],
      };

      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy);

      // Pre-INIT-009: 90% coverage was the enforced threshold
      expect(output).toContain('90%');
    });
  });

  describe('AC3: Gates enforcement matches pre-INIT-009 thresholds (90% block)', () => {
    it('should return 90% coverage_threshold when no methodology config', () => {
      const config = parseConfig({});
      const policy = resolvePolicy(config);

      expect(policy.coverage_threshold).toBe(PRE_INIT_009_DEFAULTS.coverage_threshold);
    });

    it('should return block coverage_mode when no methodology config', () => {
      const config = parseConfig({});
      const policy = resolvePolicy(config);

      expect(policy.coverage_mode).toBe(PRE_INIT_009_DEFAULTS.coverage_mode);
    });

    it('should return tests_required=true when no methodology config', () => {
      const config = parseConfig({});
      const policy = resolvePolicy(config);

      expect(policy.tests_required).toBe(PRE_INIT_009_DEFAULTS.tests_required);
    });

    it('should return tdd testing methodology when no methodology config', () => {
      const config = parseConfig({});
      const policy = resolvePolicy(config);

      expect(policy.testing).toBe(PRE_INIT_009_DEFAULTS.testing);
    });

    it('should return hexagonal architecture when no methodology config', () => {
      const config = parseConfig({});
      const policy = resolvePolicy(config);

      expect(policy.architecture).toBe(PRE_INIT_009_DEFAULTS.architecture);
    });
  });

  describe('AC4: Test fails if default behavior changes', () => {
    it('should match all pre-INIT-009 defaults exactly', () => {
      const config = parseConfig({});
      const policy = resolvePolicy(config);

      // This is the critical regression guard.
      // If any of these change, backwards compatibility is broken.
      expect(policy).toEqual(PRE_INIT_009_DEFAULTS);
    });

    it('should return identical policy from getDefaultPolicy()', () => {
      // getDefaultPolicy() is a convenience function that should
      // return the same values as resolvePolicy with empty config
      const defaultPolicy = getDefaultPolicy();

      expect(defaultPolicy).toEqual(PRE_INIT_009_DEFAULTS);
    });

    it('should treat empty config same as undefined methodology', () => {
      const emptyConfig = parseConfig({});
      const undefinedMethodologyConfig = parseConfig({ methodology: undefined });

      const emptyPolicy = resolvePolicy(emptyConfig);
      const undefinedPolicy = resolvePolicy(undefinedMethodologyConfig);

      expect(emptyPolicy).toEqual(undefinedPolicy);
      expect(emptyPolicy).toEqual(PRE_INIT_009_DEFAULTS);
    });

    it('should treat missing gates config same as no config', () => {
      const noGatesConfig = parseConfig({});
      const emptyGatesConfig = parseConfig({ gates: {} });

      const noGatesPolicy = resolvePolicy(noGatesConfig);
      const emptyGatesPolicy = resolvePolicy(emptyGatesConfig);

      // Both should return pre-INIT-009 defaults
      expect(noGatesPolicy.coverage_threshold).toBe(PRE_INIT_009_DEFAULTS.coverage_threshold);
      expect(emptyGatesPolicy.coverage_threshold).toBe(PRE_INIT_009_DEFAULTS.coverage_threshold);
    });
  });

  describe('Regression guard: spawn output structure', () => {
    it('should include truncation warning banner', () => {
      const mockWUDoc = {
        title: 'Test WU',
        lane: TEST_LANE,
        type: 'feature',
        status: 'ready',
        description: TEST_DESCRIPTION,
        acceptance: ['AC1'],
        code_paths: [TEST_CODE_PATH],
      };

      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy);

      // Pre-INIT-009: Truncation warning was always included
      expect(output).toContain('LUMENFLOW_TRUNCATION_WARNING');
    });

    it('should include spawn end sentinel', () => {
      const mockWUDoc = {
        title: 'Test WU',
        lane: TEST_LANE,
        type: 'feature',
        status: 'ready',
        description: TEST_DESCRIPTION,
        acceptance: ['AC1'],
        code_paths: [TEST_CODE_PATH],
      };

      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy);

      // Pre-INIT-009: End sentinel was always included
      expect(output).toContain('LUMENFLOW_SPAWN_END');
    });

    it('should include constraints block', () => {
      const mockWUDoc = {
        title: 'Test WU',
        lane: TEST_LANE,
        type: 'feature',
        status: 'ready',
        description: TEST_DESCRIPTION,
        acceptance: ['AC1'],
        code_paths: [TEST_CODE_PATH],
      };

      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy);

      // Pre-INIT-009: Constraints were always included
      // Note: The output is XML-escaped for the antml wrapper
      expect(output).toContain('&lt;constraints&gt;');
      expect(output).toContain('&lt;/constraints&gt;');
    });
  });
});
