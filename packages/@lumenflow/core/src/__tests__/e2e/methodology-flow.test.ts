/**
 * E2E Test: Methodology Config -> Spawn -> Gates Flow
 *
 * WU-1266: End-to-end test that validates the full methodology configurability flow:
 * config file -> resolvePolicy() -> wu:spawn template selection -> gates enforcement
 *
 * Tests all three methodology modes (tdd, test-after, none) with expected behaviors.
 *
 * @module e2e/methodology-flow
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as yaml from 'yaml';

// Core modules under test
import { resolvePolicy } from '../../resolve-policy.js';
import { parseConfig } from '../../lumenflow-config-schema.js';
import { resolveCoverageConfig } from '../../gates-config.js';
import {
  generatePolicyBasedTestGuidance,
  generateEnforcementSummary,
  buildTemplateContextWithPolicy,
} from '../../wu-spawn.js';

/**
 * Constants to avoid duplicate string literals
 */
const METHODOLOGY_TDD = 'tdd' as const;
const METHODOLOGY_TEST_AFTER = 'test-after' as const;
const METHODOLOGY_NONE = 'none' as const;
const WU_TYPE_FEATURE = 'feature' as const;
const TEST_LANE = 'Framework: Core';
const TDD_DIRECTIVE_TEXT = 'TDD DIRECTIVE';

/**
 * Test fixture: creates a temporary directory with a .lumenflow.config.yaml file
 */
interface TestFixture {
  tmpDir: string;
  configPath: string;
  cleanup: () => void;
}

function createTestFixture(): TestFixture {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-e2e-'));
  const configPath = path.join(tmpDir, '.lumenflow.config.yaml');

  return {
    tmpDir,
    configPath,
    cleanup: (): void => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

/**
 * Write a methodology config to the test fixture
 */
function writeMethodologyConfig(
  fixture: TestFixture,
  methodology: {
    testing?: 'tdd' | 'test-after' | 'none';
    architecture?: 'hexagonal' | 'layered' | 'none';
    overrides?: {
      coverage_threshold?: number;
      coverage_mode?: 'block' | 'warn' | 'off';
    };
  },
): void {
  const config = {
    version: '2.0',
    methodology,
  };

  fs.writeFileSync(fixture.configPath, yaml.stringify(config), 'utf-8');
}

describe('E2E: Methodology Config -> Spawn -> Gates Flow', () => {
  let fixture: TestFixture;

  beforeEach(() => {
    fixture = createTestFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  describe('TDD Methodology (testing: tdd)', () => {
    /**
     * AC: E2E test covers tdd methodology with 90% coverage enforcement
     */
    it('should resolve TDD defaults when methodology.testing is "tdd"', () => {
      // Arrange: Write config with TDD methodology
      writeMethodologyConfig(fixture, { testing: METHODOLOGY_TDD });

      // Act: Parse config and resolve policy
      const rawConfig = yaml.parse(fs.readFileSync(fixture.configPath, 'utf-8'));
      const config = parseConfig(rawConfig);
      const policy = resolvePolicy(config, { rawConfig });

      // Assert: TDD defaults
      expect(policy.testing).toBe(METHODOLOGY_TDD);
      expect(policy.coverage_threshold).toBe(90);
      expect(policy.coverage_mode).toBe('block');
      expect(policy.tests_required).toBe(true);
    });

    it('should generate TDD test guidance in spawn output', () => {
      // Arrange
      writeMethodologyConfig(fixture, { testing: METHODOLOGY_TDD });
      const rawConfig = yaml.parse(fs.readFileSync(fixture.configPath, 'utf-8'));
      const config = parseConfig(rawConfig);
      const policy = resolvePolicy(config, { rawConfig });

      // Act: Generate spawn output
      const testGuidance = generatePolicyBasedTestGuidance(WU_TYPE_FEATURE, policy);

      // Assert: TDD directive is present
      expect(testGuidance).toContain(TDD_DIRECTIVE_TEXT);
      expect(testGuidance).toContain('Test-First Workflow');
      expect(testGuidance).toContain('Write a failing test');
    });

    it('should set coverage to 90% blocking mode in gates', () => {
      // Arrange
      writeMethodologyConfig(fixture, { testing: METHODOLOGY_TDD });

      // Act: Resolve coverage config from project root
      const coverageConfig = resolveCoverageConfig(fixture.tmpDir);

      // Assert: TDD coverage enforcement
      expect(coverageConfig.threshold).toBe(90);
      expect(coverageConfig.mode).toBe('block');
    });

    it('should include enforcement summary in spawn output', () => {
      // Arrange
      writeMethodologyConfig(fixture, { testing: METHODOLOGY_TDD });
      const rawConfig = yaml.parse(fs.readFileSync(fixture.configPath, 'utf-8'));
      const config = parseConfig(rawConfig);
      const policy = resolvePolicy(config, { rawConfig });

      // Act
      const summary = generateEnforcementSummary(policy);

      // Assert - output uses markdown bold formatting: **Testing**: tdd (tests required)
      expect(summary).toContain('**Testing**: tdd');
      expect(summary).toContain('tests required');
      expect(summary).toContain('90%');
      expect(summary).toContain('blocking');
    });
  });

  describe('Test-After Methodology (testing: test-after)', () => {
    /**
     * AC: E2E test covers test-after methodology with 70% coverage warning
     */
    it('should resolve test-after defaults when methodology.testing is "test-after"', () => {
      // Arrange
      writeMethodologyConfig(fixture, { testing: METHODOLOGY_TEST_AFTER });

      // Act
      const rawConfig = yaml.parse(fs.readFileSync(fixture.configPath, 'utf-8'));
      const config = parseConfig(rawConfig);
      const policy = resolvePolicy(config, { rawConfig });

      // Assert: test-after defaults
      expect(policy.testing).toBe(METHODOLOGY_TEST_AFTER);
      expect(policy.coverage_threshold).toBe(70);
      expect(policy.coverage_mode).toBe('warn');
      expect(policy.tests_required).toBe(true);
    });

    it('should generate test-after guidance in spawn output', () => {
      // Arrange
      writeMethodologyConfig(fixture, { testing: METHODOLOGY_TEST_AFTER });
      const rawConfig = yaml.parse(fs.readFileSync(fixture.configPath, 'utf-8'));
      const config = parseConfig(rawConfig);
      const policy = resolvePolicy(config, { rawConfig });

      // Act
      const testGuidance = generatePolicyBasedTestGuidance(WU_TYPE_FEATURE, policy);

      // Assert: Test-after directive (not TDD)
      expect(testGuidance).toContain('Test-After Methodology');
      expect(testGuidance).toContain('Write implementation first');
      expect(testGuidance).not.toContain(TDD_DIRECTIVE_TEXT);
    });

    it('should set coverage to 70% warning mode in gates', () => {
      // Arrange
      writeMethodologyConfig(fixture, { testing: METHODOLOGY_TEST_AFTER });

      // Act
      const coverageConfig = resolveCoverageConfig(fixture.tmpDir);

      // Assert: test-after coverage enforcement
      expect(coverageConfig.threshold).toBe(70);
      expect(coverageConfig.mode).toBe('warn');
    });

    it('should include enforcement summary with warn mode', () => {
      // Arrange
      writeMethodologyConfig(fixture, { testing: METHODOLOGY_TEST_AFTER });
      const rawConfig = yaml.parse(fs.readFileSync(fixture.configPath, 'utf-8'));
      const config = parseConfig(rawConfig);
      const policy = resolvePolicy(config, { rawConfig });

      // Act
      const summary = generateEnforcementSummary(policy);

      // Assert - output uses markdown bold formatting: **Testing**: test-after (tests required)
      expect(summary).toContain('**Testing**: test-after');
      expect(summary).toContain('70%');
      expect(summary).toContain('warn only');
    });
  });

  describe('None Methodology (testing: none)', () => {
    /**
     * AC: E2E test covers none methodology with no coverage check
     */
    it('should resolve none defaults when methodology.testing is "none"', () => {
      // Arrange
      writeMethodologyConfig(fixture, { testing: METHODOLOGY_NONE });

      // Act
      const rawConfig = yaml.parse(fs.readFileSync(fixture.configPath, 'utf-8'));
      const config = parseConfig(rawConfig);
      const policy = resolvePolicy(config, { rawConfig });

      // Assert: none defaults
      expect(policy.testing).toBe(METHODOLOGY_NONE);
      expect(policy.coverage_threshold).toBe(0);
      expect(policy.coverage_mode).toBe('off');
      expect(policy.tests_required).toBe(false);
    });

    it('should generate testing optional guidance in spawn output', () => {
      // Arrange
      writeMethodologyConfig(fixture, { testing: METHODOLOGY_NONE });
      const rawConfig = yaml.parse(fs.readFileSync(fixture.configPath, 'utf-8'));
      const config = parseConfig(rawConfig);
      const policy = resolvePolicy(config, { rawConfig });

      // Act
      const testGuidance = generatePolicyBasedTestGuidance(WU_TYPE_FEATURE, policy);

      // Assert: Testing optional
      expect(testGuidance).toContain('Testing Optional');
      expect(testGuidance).toContain('Tests are not required');
      expect(testGuidance).not.toContain(TDD_DIRECTIVE_TEXT);
      expect(testGuidance).not.toContain('Test-After');
    });

    it('should disable coverage check in gates', () => {
      // Arrange
      writeMethodologyConfig(fixture, { testing: METHODOLOGY_NONE });

      // Act
      const coverageConfig = resolveCoverageConfig(fixture.tmpDir);

      // Assert: No coverage enforcement
      expect(coverageConfig.threshold).toBe(0);
      expect(coverageConfig.mode).toBe('off');
    });

    it('should include enforcement summary showing disabled coverage', () => {
      // Arrange
      writeMethodologyConfig(fixture, { testing: METHODOLOGY_NONE });
      const rawConfig = yaml.parse(fs.readFileSync(fixture.configPath, 'utf-8'));
      const config = parseConfig(rawConfig);
      const policy = resolvePolicy(config, { rawConfig });

      // Act
      const summary = generateEnforcementSummary(policy);

      // Assert - output uses markdown bold formatting: **Testing**: none (tests optional)
      expect(summary).toContain('**Testing**: none');
      expect(summary).toContain('tests optional');
      expect(summary).toContain('disabled');
    });
  });

  describe('Methodology Overrides', () => {
    it('should allow overriding TDD coverage threshold', () => {
      // Arrange: TDD with custom threshold
      writeMethodologyConfig(fixture, {
        testing: METHODOLOGY_TDD,
        overrides: { coverage_threshold: 85 },
      });

      // Act
      const rawConfig = yaml.parse(fs.readFileSync(fixture.configPath, 'utf-8'));
      const config = parseConfig(rawConfig);
      const policy = resolvePolicy(config, { rawConfig });

      // Assert: Custom threshold, TDD mode preserved
      expect(policy.testing).toBe(METHODOLOGY_TDD);
      expect(policy.coverage_threshold).toBe(85);
      expect(policy.coverage_mode).toBe('block'); // TDD default
    });

    it('should allow overriding TDD coverage mode to warn', () => {
      // Arrange: TDD with warn mode
      writeMethodologyConfig(fixture, {
        testing: METHODOLOGY_TDD,
        overrides: { coverage_mode: 'warn' },
      });

      // Act
      const rawConfig = yaml.parse(fs.readFileSync(fixture.configPath, 'utf-8'));
      const config = parseConfig(rawConfig);
      const policy = resolvePolicy(config, { rawConfig });

      // Assert
      expect(policy.testing).toBe(METHODOLOGY_TDD);
      expect(policy.coverage_threshold).toBe(90); // TDD default
      expect(policy.coverage_mode).toBe('warn');
    });

    it('should allow overriding test-after threshold to stricter value', () => {
      // Arrange
      writeMethodologyConfig(fixture, {
        testing: METHODOLOGY_TEST_AFTER,
        overrides: { coverage_threshold: 80, coverage_mode: 'block' },
      });

      // Act
      const rawConfig = yaml.parse(fs.readFileSync(fixture.configPath, 'utf-8'));
      const config = parseConfig(rawConfig);
      const policy = resolvePolicy(config, { rawConfig });

      // Assert
      expect(policy.testing).toBe(METHODOLOGY_TEST_AFTER);
      expect(policy.coverage_threshold).toBe(80);
      expect(policy.coverage_mode).toBe('block');
    });
  });

  describe('Template Context with Policy', () => {
    it('should include policy fields in template context for tdd', () => {
      // Arrange
      writeMethodologyConfig(fixture, { testing: METHODOLOGY_TDD, architecture: 'hexagonal' });
      const rawConfig = yaml.parse(fs.readFileSync(fixture.configPath, 'utf-8'));
      const config = parseConfig(rawConfig);
      const policy = resolvePolicy(config, { rawConfig });

      const doc = {
        lane: TEST_LANE,
        type: WU_TYPE_FEATURE,
        title: 'Test WU',
      };

      // Act
      const context = buildTemplateContextWithPolicy(doc, 'WU-1234', policy);

      // Assert: Policy fields available for template conditions
      expect(context['policy.testing']).toBe(METHODOLOGY_TDD);
      expect(context['policy.architecture']).toBe('hexagonal');
    });

    it('should include policy fields in template context for test-after', () => {
      // Arrange
      writeMethodologyConfig(fixture, { testing: METHODOLOGY_TEST_AFTER, architecture: 'layered' });
      const rawConfig = yaml.parse(fs.readFileSync(fixture.configPath, 'utf-8'));
      const config = parseConfig(rawConfig);
      const policy = resolvePolicy(config, { rawConfig });

      const doc = {
        lane: TEST_LANE,
        type: WU_TYPE_FEATURE,
        title: 'Test WU',
      };

      // Act
      const context = buildTemplateContextWithPolicy(doc, 'WU-1234', policy);

      // Assert
      expect(context['policy.testing']).toBe(METHODOLOGY_TEST_AFTER);
      expect(context['policy.architecture']).toBe('layered');
    });

    it('should include policy fields in template context for none', () => {
      // Arrange
      writeMethodologyConfig(fixture, { testing: METHODOLOGY_NONE, architecture: 'none' });
      const rawConfig = yaml.parse(fs.readFileSync(fixture.configPath, 'utf-8'));
      const config = parseConfig(rawConfig);
      const policy = resolvePolicy(config, { rawConfig });

      const doc = {
        lane: TEST_LANE,
        type: WU_TYPE_FEATURE,
        title: 'Test WU',
      };

      // Act
      const context = buildTemplateContextWithPolicy(doc, 'WU-1234', policy);

      // Assert
      expect(context['policy.testing']).toBe(METHODOLOGY_NONE);
      expect(context['policy.architecture']).toBe(METHODOLOGY_NONE);
    });
  });

  describe('Full Flow Integration', () => {
    /**
     * Validates the complete flow: config file -> resolvePolicy() -> spawn output -> gates enforcement
     */
    it('should maintain consistency across config, policy, spawn, and gates for TDD', () => {
      // Arrange: TDD config
      writeMethodologyConfig(fixture, { testing: METHODOLOGY_TDD, architecture: 'hexagonal' });

      // Step 1: Load and parse config (as lumenflow-config.ts does)
      const rawConfig = yaml.parse(fs.readFileSync(fixture.configPath, 'utf-8'));
      const config = parseConfig(rawConfig);

      // Step 2: Resolve policy (used by both spawn and gates)
      const policy = resolvePolicy(config, { rawConfig });

      // Step 3: Generate spawn output components
      const testGuidance = generatePolicyBasedTestGuidance(WU_TYPE_FEATURE, policy);
      const enforcement = generateEnforcementSummary(policy);

      // Step 4: Resolve gates coverage config
      const coverageConfig = resolveCoverageConfig(fixture.tmpDir);

      // Assert: All components are consistent
      // Policy
      expect(policy.testing).toBe(METHODOLOGY_TDD);
      expect(policy.coverage_threshold).toBe(90);
      expect(policy.coverage_mode).toBe('block');

      // Spawn output reflects policy
      expect(testGuidance).toContain('TDD');
      expect(enforcement).toContain('90%');
      expect(enforcement).toContain('blocking');

      // Gates use same policy values
      expect(coverageConfig.threshold).toBe(policy.coverage_threshold);
      expect(coverageConfig.mode).toBe(policy.coverage_mode);
    });

    it('should maintain consistency across config, policy, spawn, and gates for test-after', () => {
      // Arrange: test-after config
      writeMethodologyConfig(fixture, { testing: METHODOLOGY_TEST_AFTER });

      // Step 1-4: Full flow
      const rawConfig = yaml.parse(fs.readFileSync(fixture.configPath, 'utf-8'));
      const config = parseConfig(rawConfig);
      const policy = resolvePolicy(config, { rawConfig });
      const testGuidance = generatePolicyBasedTestGuidance(WU_TYPE_FEATURE, policy);
      const enforcement = generateEnforcementSummary(policy);
      const coverageConfig = resolveCoverageConfig(fixture.tmpDir);

      // Assert: Consistency
      expect(policy.testing).toBe(METHODOLOGY_TEST_AFTER);
      expect(policy.coverage_threshold).toBe(70);
      expect(policy.coverage_mode).toBe('warn');
      expect(testGuidance).toContain('Test-After');
      expect(enforcement).toContain('70%');
      expect(enforcement).toContain('warn');
      expect(coverageConfig.threshold).toBe(policy.coverage_threshold);
      expect(coverageConfig.mode).toBe(policy.coverage_mode);
    });

    it('should maintain consistency across config, policy, spawn, and gates for none', () => {
      // Arrange: none config
      writeMethodologyConfig(fixture, { testing: METHODOLOGY_NONE });

      // Step 1-4: Full flow
      const rawConfig = yaml.parse(fs.readFileSync(fixture.configPath, 'utf-8'));
      const config = parseConfig(rawConfig);
      const policy = resolvePolicy(config, { rawConfig });
      const testGuidance = generatePolicyBasedTestGuidance(WU_TYPE_FEATURE, policy);
      const enforcement = generateEnforcementSummary(policy);
      const coverageConfig = resolveCoverageConfig(fixture.tmpDir);

      // Assert: Consistency
      expect(policy.testing).toBe(METHODOLOGY_NONE);
      expect(policy.coverage_threshold).toBe(0);
      expect(policy.coverage_mode).toBe('off');
      expect(testGuidance).toContain('Testing Optional');
      expect(enforcement).toContain('disabled');
      expect(coverageConfig.threshold).toBe(policy.coverage_threshold);
      expect(coverageConfig.mode).toBe(policy.coverage_mode);
    });
  });

  describe('Default Behavior (No methodology config)', () => {
    it('should default to TDD when no methodology is specified', () => {
      // Arrange: Config without methodology section
      const config = { version: '2.0' };
      fs.writeFileSync(fixture.configPath, yaml.stringify(config), 'utf-8');

      // Act
      const rawConfig = yaml.parse(fs.readFileSync(fixture.configPath, 'utf-8'));
      const parsedConfig = parseConfig(rawConfig);
      const policy = resolvePolicy(parsedConfig, { rawConfig });

      // Assert: TDD defaults
      expect(policy.testing).toBe(METHODOLOGY_TDD);
      expect(policy.coverage_threshold).toBe(90);
      expect(policy.coverage_mode).toBe('block');
      expect(policy.tests_required).toBe(true);
    });

    it('should default to TDD when config file does not exist', () => {
      // Arrange: No config file (fixture has empty tmpDir)
      fs.rmSync(fixture.configPath, { force: true });

      // Act
      const parsedConfig = parseConfig({});
      const policy = resolvePolicy(parsedConfig);
      const coverageConfig = resolveCoverageConfig(fixture.tmpDir);

      // Assert: TDD defaults
      expect(policy.testing).toBe(METHODOLOGY_TDD);
      expect(coverageConfig.threshold).toBe(90);
      expect(coverageConfig.mode).toBe('block');
    });
  });
});
