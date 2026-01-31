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
const TEST_LANE = 'Framework: Core';
const TEST_TYPE_FEATURE = 'feature';
const TEST_METHODOLOGY_TEST_AFTER = 'test-after';
const TEST_TDD_DIRECTIVE = 'TDD DIRECTIVE';
const TEST_DESCRIPTION = 'Test description';
const TEST_CODE_PATH = 'packages/@lumenflow/core/src/test.ts';
const TEST_FAILING_TEST = 'FAILING TEST';
const TEST_ARCH_LAYERED = 'layered';
const TEST_ARCH_NONE = 'none';
const TEST_METHODOLOGY_NONE = 'none';
const TEST_AFTER_LABEL = 'Test-After';
const TEST_HEXAGONAL_ARCH = 'Hexagonal Architecture';
// Regex pattern for extracting Mandatory Standards section
const MANDATORY_STANDARDS_REGEX = /## Mandatory Standards[\s\S]*?(?=---|\n##|$)/;

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
      lane: TEST_LANE,
      type: TEST_TYPE_FEATURE,
      status: 'ready',
      description: TEST_DESCRIPTION,
      acceptance: ['AC1', 'AC2'],
      code_paths: [TEST_CODE_PATH],
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
      const guidance = generateTestGuidance(TEST_TYPE_FEATURE);
      expect(guidance).toContain(TEST_TDD_DIRECTIVE);
      expect(guidance).toContain(TEST_FAILING_TEST);
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

    it('should include Test Ratchet Rule (WU-1253) in TDD directive', () => {
      const guidance = generateTestGuidance(TEST_TYPE_FEATURE);
      expect(guidance).toContain('Test Ratchet Rule');
      expect(guidance).toContain('WU-1253');
      expect(guidance).toContain('.lumenflow/test-baseline.json');
      expect(guidance).toContain('NEW failures');
      expect(guidance).toContain('Pre-existing failures');
      expect(guidance).toContain('ratchet forward');
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

/**
 * WU-1261: Tests for integrating resolvePolicy() with wu:spawn template assembly
 *
 * Acceptance Criteria:
 * 1. wu:spawn calls resolvePolicy() to determine template selection
 * 2. Methodology template selected based on policy.testing value
 * 3. Architecture template selected based on policy.architecture value
 * 4. Spawn prompt includes generated enforcement summary from resolved policy
 * 5. Existing spawn output unchanged when using default methodology (tdd, hexagonal)
 */
import {
  generatePolicyBasedTestGuidance,
  generatePolicyBasedArchitectureGuidance,
  generateEnforcementSummary,
  buildTemplateContextWithPolicy,
} from '../wu-spawn.js';
import { resolvePolicy } from '../resolve-policy.js';
import { parseConfig } from '../lumenflow-config-schema.js';

describe('WU-1261: Integrate resolvePolicy() with wu:spawn template assembly', () => {
  describe('AC1: wu:spawn calls resolvePolicy() to determine template selection', () => {
    it('should export generatePolicyBasedTestGuidance function', () => {
      expect(generatePolicyBasedTestGuidance).toBeDefined();
      expect(typeof generatePolicyBasedTestGuidance).toBe('function');
    });

    it('should export buildTemplateContextWithPolicy function', () => {
      expect(buildTemplateContextWithPolicy).toBeDefined();
      expect(typeof buildTemplateContextWithPolicy).toBe('function');
    });

    it('should build template context with policy.testing and policy.architecture', () => {
      const config = parseConfig({
        methodology: {
          testing: TEST_METHODOLOGY_TEST_AFTER,
          architecture: 'layered',
        },
      });
      const doc = { lane: TEST_LANE, type: 'feature' };
      const policy = resolvePolicy(config);
      const context = buildTemplateContextWithPolicy(doc, 'WU-TEST', policy);

      expect(context['policy.testing']).toBe(TEST_METHODOLOGY_TEST_AFTER);
      expect(context['policy.architecture']).toBe('layered');
    });
  });

  describe('AC2: Methodology template selected based on policy.testing value', () => {
    it('should return TDD directive when policy.testing is "tdd"', () => {
      const config = parseConfig({ methodology: { testing: 'tdd' } });
      const policy = resolvePolicy(config);
      const guidance = generatePolicyBasedTestGuidance(TEST_TYPE_FEATURE, policy);

      expect(guidance).toContain(TEST_TDD_DIRECTIVE);
      expect(guidance).toContain(TEST_FAILING_TEST);
    });

    it('should return test-after directive when policy.testing is "test-after"', () => {
      const config = parseConfig({ methodology: { testing: TEST_METHODOLOGY_TEST_AFTER } });
      const policy = resolvePolicy(config);
      const guidance = generatePolicyBasedTestGuidance(TEST_TYPE_FEATURE, policy);

      expect(guidance).toContain(TEST_AFTER_LABEL);
      expect(guidance).not.toContain(TEST_TDD_DIRECTIVE);
      expect(guidance).toContain('implementation first');
    });

    it('should return minimal guidance when policy.testing is "none"', () => {
      const config = parseConfig({ methodology: { testing: TEST_METHODOLOGY_NONE } });
      const policy = resolvePolicy(config);
      const guidance = generatePolicyBasedTestGuidance(TEST_TYPE_FEATURE, policy);

      expect(guidance).not.toContain(TEST_TDD_DIRECTIVE);
      expect(guidance).not.toContain(TEST_AFTER_LABEL);
      expect(guidance).toContain('Testing Optional');
    });

    it('should still respect type overrides (documentation) regardless of policy', () => {
      const config = parseConfig({ methodology: { testing: 'tdd' } });
      const policy = resolvePolicy(config);
      const guidance = generatePolicyBasedTestGuidance('documentation', policy);

      expect(guidance).toContain('Documentation Standards');
      expect(guidance).not.toContain(TEST_TDD_DIRECTIVE);
    });
  });

  describe('AC3: Architecture template selected based on policy.architecture value', () => {
    it('should export generatePolicyBasedArchitectureGuidance function', () => {
      expect(generatePolicyBasedArchitectureGuidance).toBeDefined();
      expect(typeof generatePolicyBasedArchitectureGuidance).toBe('function');
    });

    it('should return hexagonal guidance when policy.architecture is "hexagonal"', () => {
      const config = parseConfig({ methodology: { architecture: 'hexagonal' } });
      const policy = resolvePolicy(config);
      const guidance = generatePolicyBasedArchitectureGuidance(policy);

      expect(guidance).toContain(TEST_HEXAGONAL_ARCH);
      expect(guidance).toContain('Ports');
    });

    it('should return layered guidance when policy.architecture is "layered"', () => {
      const config = parseConfig({ methodology: { architecture: TEST_ARCH_LAYERED } });
      const policy = resolvePolicy(config);
      const guidance = generatePolicyBasedArchitectureGuidance(policy);

      expect(guidance).toContain('Layered Architecture');
      expect(guidance).not.toContain('Hexagonal');
    });

    it('should return empty string when policy.architecture is "none"', () => {
      const config = parseConfig({ methodology: { architecture: TEST_ARCH_NONE } });
      const policy = resolvePolicy(config);
      const guidance = generatePolicyBasedArchitectureGuidance(policy);

      expect(guidance).toBe('');
    });
  });

  describe('AC4: Spawn prompt includes generated enforcement summary from resolved policy', () => {
    it('should export generateEnforcementSummary function', () => {
      expect(generateEnforcementSummary).toBeDefined();
      expect(typeof generateEnforcementSummary).toBe('function');
    });

    it('should include coverage threshold from policy', () => {
      const config = parseConfig({
        methodology: { testing: 'tdd' },
      });
      const policy = resolvePolicy(config);
      const summary = generateEnforcementSummary(policy);

      expect(summary).toContain('90%');
      expect(summary).toContain('Coverage');
    });

    it('should include coverage mode from policy', () => {
      const config = parseConfig({
        methodology: {
          testing: TEST_METHODOLOGY_TEST_AFTER,
          overrides: { coverage_mode: 'warn' },
        },
      });
      const policy = resolvePolicy(config);
      const summary = generateEnforcementSummary(policy);

      expect(summary).toContain('warn');
    });

    it('should show tests_required status', () => {
      const config = parseConfig({ methodology: { testing: TEST_METHODOLOGY_NONE } });
      const policy = resolvePolicy(config);
      const summary = generateEnforcementSummary(policy);

      expect(summary).toContain('optional');
    });

    it('should include "You will be judged by" section header', () => {
      const config = parseConfig({});
      const policy = resolvePolicy(config);
      const summary = generateEnforcementSummary(policy);

      expect(summary).toContain('You will be judged by');
    });
  });

  describe('AC5: Existing spawn output unchanged when using default methodology', () => {
    const mockWUDoc = {
      title: 'Test WU',
      lane: TEST_LANE,
      type: TEST_TYPE_FEATURE,
      status: 'ready',
      description: TEST_DESCRIPTION,
      acceptance: ['AC1', 'AC2'],
      code_paths: [TEST_CODE_PATH],
    };

    it('should include TDD directive by default', () => {
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy);

      expect(output).toContain(TEST_TDD_DIRECTIVE);
    });

    it('should include Hexagonal Architecture in mandatory standards by default', () => {
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy);

      expect(output).toContain(TEST_HEXAGONAL_ARCH);
    });

    it('should include 90% coverage reference by default', () => {
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy);

      expect(output).toContain('90%');
    });
  });
});

/**
 * WU-1279: Wire methodology policy into spawn prompt generation
 *
 * Acceptance Criteria:
 * 1. Spawn prompts use resolved methodology policy
 * 2. Coverage thresholds come from policy not hardcoded
 * 3. methodology.testing: none produces warn-only guidance
 */
describe('WU-1279: Wire methodology policy into spawn prompt generation', () => {
  const mockWUDoc = {
    title: 'Test WU',
    lane: TEST_LANE,
    type: TEST_TYPE_FEATURE,
    status: 'ready',
    description: TEST_DESCRIPTION,
    acceptance: ['AC1', 'AC2'],
    code_paths: [TEST_CODE_PATH],
  };

  describe('AC1: Spawn prompts use resolved methodology policy', () => {
    it('should use generatePolicyBasedTestGuidance in generateTaskInvocation when config passed', () => {
      const config = parseConfig({ methodology: { testing: TEST_METHODOLOGY_TEST_AFTER } });
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy, { config });

      // Test-after methodology should NOT include TDD directive
      expect(output).not.toContain(TEST_TDD_DIRECTIVE);
      expect(output).toContain(TEST_AFTER_LABEL);
    });

    it('should use resolved architecture policy in spawn output', () => {
      const config = parseConfig({ methodology: { architecture: TEST_ARCH_LAYERED } });
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy, { config });

      // Should NOT contain hexagonal architecture when layered is configured
      expect(output).not.toContain(TEST_HEXAGONAL_ARCH);
      expect(output).toContain('Layered');
    });

    it('should include enforcement summary from resolved policy', () => {
      const config = parseConfig({
        methodology: { testing: 'tdd', architecture: 'hexagonal' },
      });
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy, { config });

      expect(output).toContain('You will be judged by');
    });
  });

  describe('AC2: Coverage thresholds come from policy not hardcoded', () => {
    it('should use TDD template default (90%) when methodology.testing is tdd', () => {
      const config = parseConfig({ methodology: { testing: 'tdd' } });
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy, { config });

      expect(output).toContain('90%');
    });

    it('should use test-after template default (70%) when methodology.testing is test-after', () => {
      const config = parseConfig({ methodology: { testing: TEST_METHODOLOGY_TEST_AFTER } });
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy, { config });

      expect(output).toContain('70%');
    });

    it('should use overridden coverage threshold when specified', () => {
      const config = parseConfig({
        methodology: {
          testing: 'tdd',
          overrides: { coverage_threshold: 85 },
        },
      });
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy, { config });

      expect(output).toContain('85%');
      // Should NOT contain the default 90%
      expect(output).not.toMatch(/90%\+? coverage/);
    });
  });

  describe('AC3: methodology.testing: none produces warn-only guidance', () => {
    it('should produce testing optional guidance when methodology.testing is none', () => {
      const config = parseConfig({ methodology: { testing: TEST_METHODOLOGY_NONE } });
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy, { config });

      expect(output).toContain('Testing Optional');
      expect(output).not.toContain(TEST_TDD_DIRECTIVE);
      expect(output).not.toContain(TEST_FAILING_TEST);
    });

    it('should show tests as optional in enforcement summary when testing is none', () => {
      const config = parseConfig({ methodology: { testing: TEST_METHODOLOGY_NONE } });
      const policy = resolvePolicy(config);
      const summary = generateEnforcementSummary(policy);

      expect(summary).toContain('optional');
      expect(policy.tests_required).toBe(false);
    });

    it('should show coverage as disabled in enforcement summary when testing is none', () => {
      const config = parseConfig({ methodology: { testing: TEST_METHODOLOGY_NONE } });
      const policy = resolvePolicy(config);
      const summary = generateEnforcementSummary(policy);

      expect(summary).toContain('disabled');
      expect(policy.coverage_mode).toBe('off');
    });
  });

  describe('Mandatory Standards section uses resolved policy', () => {
    it('should not include hardcoded TDD reference when methodology is test-after', () => {
      const config = parseConfig({ methodology: { testing: TEST_METHODOLOGY_TEST_AFTER } });
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy, { config });

      // The "Mandatory Standards" section should not have hardcoded TDD
      // when the methodology is test-after
      const mandatoryStandardsSection = MANDATORY_STANDARDS_REGEX.exec(output)?.[0];
      expect(mandatoryStandardsSection).toBeDefined();
      expect(mandatoryStandardsSection).not.toContain('Failing test first');
    });

    it('should not include hardcoded 90%+ when methodology has different coverage', () => {
      const config = parseConfig({
        methodology: {
          testing: TEST_METHODOLOGY_TEST_AFTER,
          overrides: { coverage_threshold: 75 },
        },
      });
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy, { config });

      // Should not contain "90%+" in the Mandatory Standards
      const mandatoryStandardsSection = MANDATORY_STANDARDS_REGEX.exec(output)?.[0];
      expect(mandatoryStandardsSection).not.toContain('90%+');
    });

    it('should not include architecture guidance when architecture is none', () => {
      const config = parseConfig({ methodology: { architecture: TEST_ARCH_NONE } });
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy, { config });

      // Should not contain architecture-specific references
      const mandatoryStandardsSection = MANDATORY_STANDARDS_REGEX.exec(output)?.[0];
      expect(mandatoryStandardsSection).not.toContain(TEST_HEXAGONAL_ARCH);
      expect(mandatoryStandardsSection).not.toContain('Ports-first');
    });
  });
});

/**
 * WU-1282: Task-spawned sub-agents bypass PreToolUse hooks
 *
 * Root Cause: Claude Code Task tool spawns sub-agents in a new session context
 * that does NOT inherit PreToolUse hooks from the parent session. This is a Claude
 * Code platform limitation.
 *
 * Workaround: Include explicit worktree discipline instructions in spawn prompt
 * constraints block so sub-agents manually verify worktree discipline before
 * Write/Edit operations.
 *
 * Acceptance Criteria:
 * 1. Spawn constraints include WORKTREE DISCIPLINE (WU-1282) rule
 * 2. Constraint instructs agents to verify worktree location before Write/Edit
 * 3. Root cause is documented in constraints block
 */
describe('WU-1282: Task-spawned sub-agents must verify worktree discipline', () => {
  const mockWUDoc = {
    title: 'Test WU',
    lane: TEST_LANE,
    type: TEST_TYPE_FEATURE,
    status: 'ready',
    description: TEST_DESCRIPTION,
    acceptance: ['AC1', 'AC2'],
    code_paths: [TEST_CODE_PATH],
  };

  describe('AC1: Spawn constraints include WORKTREE DISCIPLINE rule', () => {
    it('should include WORKTREE DISCIPLINE constraint in spawn output', () => {
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy);

      expect(output).toContain('WORKTREE DISCIPLINE');
      expect(output).toContain('WU-1282');
    });

    it('should include constraint number 9 for WORKTREE DISCIPLINE', () => {
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy);

      // Constraint should be numbered (after SKIP-GATES AUTONOMY which is #8)
      expect(output).toMatch(/9\.\s+WORKTREE DISCIPLINE/);
    });
  });

  describe('AC2: Constraint instructs agents to verify worktree location', () => {
    it('should instruct agents to verify worktree location before Write/Edit', () => {
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy);

      // Should include verification instructions
      expect(output).toContain('BEFORE any Write/Edit');
      expect(output).toContain('worktrees/');
    });

    it('should warn about hook bypass in sub-agents', () => {
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy);

      // Should mention that hooks do not propagate to sub-agents
      expect(output).toContain('hooks do not propagate');
    });

    it('should provide verification command', () => {
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy);

      // Should include command to verify working directory
      expect(output).toContain('Run:');
    });
  });

  describe('AC3: Root cause is documented in constraints block', () => {
    it('should explain Task-spawned sub-agents context', () => {
      const strategy = SpawnStrategyFactory.create(TEST_SPAWN_CLIENT);
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy);

      // Should mention sub-agent context
      expect(output).toMatch(/sub-agent/i);
    });
  });
});

/**
 * WU-1290: Update Codex spawn prompt to reflect methodology policy
 *
 * Acceptance Criteria:
 * 1. Codex spawn prompt reflects resolved policy.testing and policy.architecture
 * 2. Enforcement summary in Codex prompt uses policy coverage_threshold and coverage_mode
 * 3. policy.testing=none yields warn-only guidance (no TDD directive)
 * 4. wu:spawn --client codex-cli output matches policy config
 */
import { generateCodexPrompt } from '../wu-spawn.js';

describe('WU-1290: Update Codex spawn prompt to reflect methodology policy', () => {
  const mockWUDoc = {
    title: 'Test WU',
    lane: TEST_LANE,
    type: TEST_TYPE_FEATURE,
    status: 'ready',
    description: TEST_DESCRIPTION,
    acceptance: ['AC1', 'AC2'],
    code_paths: [TEST_CODE_PATH],
  };

  describe('AC1: Codex spawn prompt reflects resolved policy.testing and policy.architecture', () => {
    it('should use test-after methodology when configured', () => {
      const config = parseConfig({ methodology: { testing: TEST_METHODOLOGY_TEST_AFTER } });
      const strategy = SpawnStrategyFactory.create('codex-cli');
      const output = generateCodexPrompt(mockWUDoc, 'WU-TEST', strategy, { config });

      // Should NOT contain TDD directive
      expect(output).not.toContain(TEST_TDD_DIRECTIVE);
      // Should contain test-after guidance
      expect(output).toContain(TEST_AFTER_LABEL);
    });

    it('should use layered architecture when configured', () => {
      const config = parseConfig({ methodology: { architecture: TEST_ARCH_LAYERED } });
      const strategy = SpawnStrategyFactory.create('codex-cli');
      const output = generateCodexPrompt(mockWUDoc, 'WU-TEST', strategy, { config });

      // Should NOT contain hexagonal architecture
      expect(output).not.toContain(TEST_HEXAGONAL_ARCH);
      // Should contain layered architecture reference
      expect(output).toContain('Layered');
    });

    it('should use TDD methodology by default (no config override)', () => {
      const config = parseConfig({});
      const strategy = SpawnStrategyFactory.create('codex-cli');
      const output = generateCodexPrompt(mockWUDoc, 'WU-TEST', strategy, { config });

      // Should contain TDD directive
      expect(output).toContain(TEST_TDD_DIRECTIVE);
    });
  });

  describe('AC2: Enforcement summary in Codex prompt uses policy coverage_threshold and coverage_mode', () => {
    it('should include enforcement summary with coverage threshold', () => {
      const config = parseConfig({
        methodology: { testing: 'tdd' },
      });
      const strategy = SpawnStrategyFactory.create('codex-cli');
      const output = generateCodexPrompt(mockWUDoc, 'WU-TEST', strategy, { config });

      // Should contain enforcement summary section
      expect(output).toContain('You will be judged by');
      expect(output).toContain('90%');
    });

    it('should use custom coverage threshold from config', () => {
      const config = parseConfig({
        methodology: {
          testing: 'tdd',
          overrides: { coverage_threshold: 85 },
        },
      });
      const strategy = SpawnStrategyFactory.create('codex-cli');
      const output = generateCodexPrompt(mockWUDoc, 'WU-TEST', strategy, { config });

      expect(output).toContain('85%');
    });

    it('should include coverage mode from config', () => {
      const config = parseConfig({
        methodology: {
          testing: TEST_METHODOLOGY_TEST_AFTER,
          overrides: { coverage_mode: 'warn' },
        },
      });
      const strategy = SpawnStrategyFactory.create('codex-cli');
      const output = generateCodexPrompt(mockWUDoc, 'WU-TEST', strategy, { config });

      expect(output).toContain('warn');
    });
  });

  describe('AC3: policy.testing=none yields warn-only guidance (no TDD directive)', () => {
    it('should produce testing optional guidance when methodology.testing is none', () => {
      const config = parseConfig({ methodology: { testing: TEST_METHODOLOGY_NONE } });
      const strategy = SpawnStrategyFactory.create('codex-cli');
      const output = generateCodexPrompt(mockWUDoc, 'WU-TEST', strategy, { config });

      // Should NOT contain TDD directive
      expect(output).not.toContain(TEST_TDD_DIRECTIVE);
      expect(output).not.toContain(TEST_FAILING_TEST);
      // Should contain testing optional guidance
      expect(output).toContain('Testing Optional');
    });

    it('should show tests as optional in enforcement summary when testing is none', () => {
      const config = parseConfig({ methodology: { testing: TEST_METHODOLOGY_NONE } });
      const strategy = SpawnStrategyFactory.create('codex-cli');
      const output = generateCodexPrompt(mockWUDoc, 'WU-TEST', strategy, { config });

      expect(output).toContain('optional');
    });

    it('should show coverage as disabled in enforcement summary when testing is none', () => {
      const config = parseConfig({ methodology: { testing: TEST_METHODOLOGY_NONE } });
      const strategy = SpawnStrategyFactory.create('codex-cli');
      const output = generateCodexPrompt(mockWUDoc, 'WU-TEST', strategy, { config });

      expect(output).toContain('disabled');
    });
  });

  describe('AC4: wu:spawn --client codex-cli output matches policy config', () => {
    it('should include mandatory standards section reflecting policy', () => {
      const config = parseConfig({
        methodology: { testing: TEST_METHODOLOGY_TEST_AFTER, architecture: TEST_ARCH_LAYERED },
      });
      const strategy = SpawnStrategyFactory.create('codex-cli');
      const output = generateCodexPrompt(mockWUDoc, 'WU-TEST', strategy, { config });

      // Should contain mandatory standards section
      expect(output).toContain('Mandatory Standards');
      // Should NOT contain hexagonal when layered is configured
      expect(output).not.toMatch(/hexagonal/i);
    });

    it('should omit architecture guidance when architecture is none', () => {
      const config = parseConfig({ methodology: { architecture: TEST_ARCH_NONE } });
      const strategy = SpawnStrategyFactory.create('codex-cli');
      const output = generateCodexPrompt(mockWUDoc, 'WU-TEST', strategy, { config });

      // Should NOT contain hexagonal or layered architecture references in standards
      const mandatoryStandardsSection = MANDATORY_STANDARDS_REGEX.exec(output)?.[0];
      if (mandatoryStandardsSection) {
        expect(mandatoryStandardsSection).not.toContain(TEST_HEXAGONAL_ARCH);
        expect(mandatoryStandardsSection).not.toContain('Layered Architecture');
      }
    });
  });
});

/**
 * WU-1291: Decide on spawn template system (activate or remove)
 *
 * Decision: ACTIVATE template system with graceful degradation
 *
 * The template system (template-loader.ts) is now integrated into wu:spawn.
 * When templates exist in .lumenflow/templates/, they are used.
 * If template loading fails, the hardcoded fallback functions are used.
 *
 * This test verifies the integration is working correctly.
 */
import { tryAssembleSpawnTemplates, buildTemplateContext } from '../wu-spawn.js';

describe('WU-1291: Spawn template system activation', () => {
  describe('tryAssembleSpawnTemplates integration', () => {
    it('should be exported from wu-spawn', () => {
      expect(tryAssembleSpawnTemplates).toBeDefined();
      expect(typeof tryAssembleSpawnTemplates).toBe('function');
    });

    it('should be exported from wu-spawn (buildTemplateContext)', () => {
      expect(buildTemplateContext).toBeDefined();
      expect(typeof buildTemplateContext).toBe('function');
    });

    it('should return null when templates directory does not exist', () => {
      const context = {
        WU_ID: 'WU-TEST',
        LANE: TEST_LANE,
        TYPE: TEST_TYPE_FEATURE,
      };
      // Use a non-existent directory
      const result = tryAssembleSpawnTemplates('/nonexistent/path', 'claude-code', context);
      expect(result).toBeNull();
    });

    it('should build correct template context from WU doc', () => {
      const doc = {
        lane: 'Framework: Core',
        type: 'feature',
        title: 'Test WU',
        description: 'A test WU',
        worktree_path: '/path/to/worktree',
      };

      const context = buildTemplateContext(doc, 'WU-1234');

      expect(context.WU_ID).toBe('WU-1234');
      expect(context.LANE).toBe('Framework: Core');
      expect(context.TYPE).toBe('feature');
      expect(context.TITLE).toBe('Test WU');
      expect(context.DESCRIPTION).toBe('A test WU');
      expect(context.WORKTREE_PATH).toBe('/path/to/worktree');
      expect(context.laneParent).toBe('Framework');
    });

    it('should extract laneParent correctly', () => {
      const doc = { lane: 'Operations: Tooling', type: 'feature' };
      const context = buildTemplateContext(doc, 'WU-1234');

      expect(context.laneParent).toBe('Operations');
    });

    it('should handle missing lane gracefully', () => {
      const doc = { type: 'feature' };
      const context = buildTemplateContext(doc, 'WU-1234');

      expect(context.LANE).toBe('');
      expect(context.laneParent).toBe('');
    });
  });

  describe('Template fallback behavior', () => {
    it('should use hardcoded sections when templates unavailable', () => {
      const mockWUDoc = {
        title: 'Test WU',
        lane: TEST_LANE,
        type: TEST_TYPE_FEATURE,
        status: 'ready',
        description: TEST_DESCRIPTION,
        acceptance: ['AC1'],
        code_paths: [TEST_CODE_PATH],
      };
      const strategy = SpawnStrategyFactory.create('claude-code');
      const output = generateTaskInvocation(mockWUDoc, 'WU-TEST', strategy, {});

      // Should still contain all expected sections from hardcoded functions
      expect(output).toContain('TDD DIRECTIVE');
      expect(output).toContain('LUMENFLOW_SPAWN_END');
      expect(output).toContain('Effort Scaling');
      expect(output).toContain('Bug Discovery');
    });
  });
});
