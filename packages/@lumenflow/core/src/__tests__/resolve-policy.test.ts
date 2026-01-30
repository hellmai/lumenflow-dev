/**
 * Tests for resolvePolicy() function
 *
 * WU-1259: Add methodology config schema and resolvePolicy() function
 *
 * Tests the single source of truth for methodology decisions that both
 * wu:spawn and gates use.
 */

import { describe, it, expect } from 'vitest';
import {
  resolvePolicy,
  MethodologyConfigSchema,
  type MethodologyConfig,
  type ResolvePolicyOptions,
  TESTING_METHODOLOGY,
  ARCHITECTURE_METHODOLOGY,
  COVERAGE_MODE,
} from '../resolve-policy.js';
import { parseConfig, type LumenFlowConfig } from '../lumenflow-config-schema.js';

/** Testing methodology literal values - used to avoid string literal duplication */
const TESTING_TDD = 'tdd' as const;
const TESTING_TEST_AFTER = 'test-after' as const;
const _TESTING_NONE = 'none' as const; // Prefixed with _ as unused in these tests

/** Architecture methodology literal value */
const ARCHITECTURE_HEXAGONAL = 'hexagonal' as const;

describe('MethodologyConfigSchema', () => {
  describe('testing methodology', () => {
    it('should accept valid testing values', () => {
      expect(MethodologyConfigSchema.parse({ testing: TESTING_TDD }).testing).toBe(TESTING_TDD);
      expect(MethodologyConfigSchema.parse({ testing: TESTING_TEST_AFTER }).testing).toBe(
        TESTING_TEST_AFTER,
      );
      expect(MethodologyConfigSchema.parse({ testing: 'none' }).testing).toBe('none');
    });

    it('should default to tdd when not specified', () => {
      const result = MethodologyConfigSchema.parse({});
      expect(result.testing).toBe(TESTING_TDD);
    });

    it('should reject invalid testing values', () => {
      expect(() => MethodologyConfigSchema.parse({ testing: 'invalid' })).toThrow();
    });
  });

  describe('architecture methodology', () => {
    it('should accept valid architecture values', () => {
      expect(
        MethodologyConfigSchema.parse({ architecture: ARCHITECTURE_HEXAGONAL }).architecture,
      ).toBe(ARCHITECTURE_HEXAGONAL);
      expect(MethodologyConfigSchema.parse({ architecture: 'layered' }).architecture).toBe(
        'layered',
      );
      expect(MethodologyConfigSchema.parse({ architecture: 'none' }).architecture).toBe('none');
    });

    it('should default to hexagonal when not specified', () => {
      const result = MethodologyConfigSchema.parse({});
      expect(result.architecture).toBe(ARCHITECTURE_HEXAGONAL);
    });

    it('should reject invalid architecture values', () => {
      expect(() => MethodologyConfigSchema.parse({ architecture: 'invalid' })).toThrow();
    });
  });

  describe('overrides', () => {
    it('should accept valid coverage_threshold override', () => {
      const result = MethodologyConfigSchema.parse({
        overrides: { coverage_threshold: 85 },
      });
      expect(result.overrides?.coverage_threshold).toBe(85);
    });

    it('should accept valid coverage_mode override', () => {
      const result = MethodologyConfigSchema.parse({
        overrides: { coverage_mode: 'warn' },
      });
      expect(result.overrides?.coverage_mode).toBe('warn');
    });

    it('should reject invalid coverage_threshold (negative)', () => {
      expect(() =>
        MethodologyConfigSchema.parse({
          overrides: { coverage_threshold: -1 },
        }),
      ).toThrow();
    });

    it('should reject invalid coverage_threshold (> 100)', () => {
      expect(() =>
        MethodologyConfigSchema.parse({
          overrides: { coverage_threshold: 101 },
        }),
      ).toThrow();
    });

    it('should reject invalid coverage_mode', () => {
      expect(() =>
        MethodologyConfigSchema.parse({
          overrides: { coverage_mode: 'invalid' },
        }),
      ).toThrow();
    });
  });
});

describe('resolvePolicy', () => {
  /**
   * Helper to create a config with methodology settings
   * Returns both the parsed config and rawConfig for explicit detection
   */
  function createConfigWithRaw(rawInput: {
    methodology?: Partial<MethodologyConfig>;
    gates?: { minCoverage?: number; enableCoverage?: boolean };
  }): { config: LumenFlowConfig; rawConfig: ResolvePolicyOptions['rawConfig'] } {
    const rawConfig = rawInput;
    const config = parseConfig(rawInput);
    return { config, rawConfig };
  }

  describe('default behavior (preserves strict)', () => {
    it('should return tdd defaults when no config specified', () => {
      const config = parseConfig({});
      const policy = resolvePolicy(config);

      expect(policy.testing).toBe(TESTING_METHODOLOGY.TDD);
      expect(policy.architecture).toBe(ARCHITECTURE_METHODOLOGY.HEXAGONAL);
      expect(policy.coverage_threshold).toBe(90);
      expect(policy.coverage_mode).toBe(COVERAGE_MODE.BLOCK);
      expect(policy.tests_required).toBe(true);
    });

    it('should preserve current strict behavior by default', () => {
      const config = parseConfig({});
      const policy = resolvePolicy(config);

      // These are the current defaults we must preserve
      expect(policy.coverage_threshold).toBe(90);
      expect(policy.coverage_mode).toBe('block');
      expect(policy.tests_required).toBe(true);
    });
  });

  describe('testing methodology templates', () => {
    it('should apply tdd template defaults', () => {
      const { config, rawConfig } = createConfigWithRaw({ methodology: { testing: TESTING_TDD } });
      const policy = resolvePolicy(config, { rawConfig });

      expect(policy.testing).toBe(TESTING_TDD);
      expect(policy.coverage_threshold).toBe(90);
      expect(policy.coverage_mode).toBe('block');
      expect(policy.tests_required).toBe(true);
    });

    it('should apply test-after template defaults', () => {
      const { config, rawConfig } = createConfigWithRaw({
        methodology: { testing: TESTING_TEST_AFTER },
      });
      const policy = resolvePolicy(config, { rawConfig });

      expect(policy.testing).toBe(TESTING_TEST_AFTER);
      expect(policy.coverage_threshold).toBe(70);
      expect(policy.coverage_mode).toBe('warn');
      expect(policy.tests_required).toBe(true);
    });

    it('should apply none template defaults', () => {
      const { config, rawConfig } = createConfigWithRaw({ methodology: { testing: 'none' } });
      const policy = resolvePolicy(config, { rawConfig });

      expect(policy.testing).toBe('none');
      expect(policy.coverage_threshold).toBe(0);
      expect(policy.coverage_mode).toBe('off');
      expect(policy.tests_required).toBe(false);
    });
  });

  describe('architecture methodology', () => {
    it('should set architecture from config', () => {
      const { config: hexConfig, rawConfig: hexRaw } = createConfigWithRaw({
        methodology: { architecture: ARCHITECTURE_HEXAGONAL },
      });
      expect(resolvePolicy(hexConfig, { rawConfig: hexRaw }).architecture).toBe(
        ARCHITECTURE_HEXAGONAL,
      );

      const { config: layeredConfig, rawConfig: layeredRaw } = createConfigWithRaw({
        methodology: { architecture: 'layered' },
      });
      expect(resolvePolicy(layeredConfig, { rawConfig: layeredRaw }).architecture).toBe('layered');

      const { config: noneConfig, rawConfig: noneRaw } = createConfigWithRaw({
        methodology: { architecture: 'none' },
      });
      expect(resolvePolicy(noneConfig, { rawConfig: noneRaw }).architecture).toBe('none');
    });
  });

  describe('methodology overrides', () => {
    it('should allow coverage_threshold override', () => {
      const { config, rawConfig } = createConfigWithRaw({
        methodology: {
          testing: 'tdd',
          overrides: { coverage_threshold: 85 },
        },
      });
      const policy = resolvePolicy(config, { rawConfig });

      expect(policy.testing).toBe(TESTING_TDD);
      expect(policy.coverage_threshold).toBe(85); // Override applied
      expect(policy.coverage_mode).toBe('block'); // Template default kept
    });

    it('should allow coverage_mode override', () => {
      const { config, rawConfig } = createConfigWithRaw({
        methodology: {
          testing: 'tdd',
          overrides: { coverage_mode: 'warn' },
        },
      });
      const policy = resolvePolicy(config, { rawConfig });

      expect(policy.coverage_threshold).toBe(90); // Template default kept
      expect(policy.coverage_mode).toBe('warn'); // Override applied
    });

    it('should allow both overrides together', () => {
      const { config, rawConfig } = createConfigWithRaw({
        methodology: {
          testing: 'test-after',
          overrides: {
            coverage_threshold: 80,
            coverage_mode: 'block',
          },
        },
      });
      const policy = resolvePolicy(config, { rawConfig });

      expect(policy.coverage_threshold).toBe(80);
      expect(policy.coverage_mode).toBe('block');
    });
  });

  describe('precedence: gates.* overrides methodology', () => {
    it('should prefer gates.minCoverage over methodology coverage_threshold', () => {
      const rawInput = {
        methodology: {
          testing: TESTING_TDD, // Default 90%
          overrides: { coverage_threshold: 85 },
        },
        gates: {
          minCoverage: 75, // Explicit gates override
        },
      };
      const config = parseConfig(rawInput);
      const policy = resolvePolicy(config, { rawConfig: rawInput });

      expect(policy.coverage_threshold).toBe(75); // gates.* wins
    });

    it('should prefer gates.enableCoverage: false to disable coverage', () => {
      const rawInput = {
        methodology: {
          testing: TESTING_TDD, // Would normally be block mode
        },
        gates: {
          enableCoverage: false,
        },
      };
      const config = parseConfig(rawInput);
      const policy = resolvePolicy(config, { rawConfig: rawInput });

      expect(policy.coverage_mode).toBe('off');
    });
  });

  describe('ResolvedPolicy type', () => {
    it('should return all required fields', () => {
      const config = parseConfig({});
      const policy = resolvePolicy(config);

      // Type check: all required fields present
      expect(policy).toHaveProperty('testing');
      expect(policy).toHaveProperty('architecture');
      expect(policy).toHaveProperty('coverage_threshold');
      expect(policy).toHaveProperty('coverage_mode');
      expect(policy).toHaveProperty('tests_required');
    });

    it('should return correct types', () => {
      const config = parseConfig({});
      const policy = resolvePolicy(config);

      expect(typeof policy.testing).toBe('string');
      expect(typeof policy.architecture).toBe('string');
      expect(typeof policy.coverage_threshold).toBe('number');
      expect(typeof policy.coverage_mode).toBe('string');
      expect(typeof policy.tests_required).toBe('boolean');
    });
  });

  describe('full precedence chain', () => {
    /**
     * Precedence (highest to lowest):
     * 1. CLI flags (not tested here - handled by command layer)
     * 2. Explicit gates.* configuration
     * 3. methodology.overrides
     * 4. methodology template defaults
     */

    it('should apply full precedence: template < overrides < gates', () => {
      // Template default for test-after: 70%
      // Override: 80%
      // Gates: 60%
      const rawInput = {
        methodology: {
          testing: TESTING_TEST_AFTER, // Template: 70%
          overrides: { coverage_threshold: 80 },
        },
        gates: {
          minCoverage: 60, // Gates override wins
        },
      };
      const config = parseConfig(rawInput);
      const policy = resolvePolicy(config, { rawConfig: rawInput });

      expect(policy.coverage_threshold).toBe(60);
    });

    it('should apply overrides when gates not specified', () => {
      const rawInput = {
        methodology: {
          testing: TESTING_TEST_AFTER, // Template: 70%
          overrides: { coverage_threshold: 80 },
        },
        // No gates.minCoverage specified
      };
      const config = parseConfig(rawInput);
      const policy = resolvePolicy(config, { rawConfig: rawInput });

      expect(policy.coverage_threshold).toBe(80); // Override wins over template
    });

    it('should apply template when nothing specified', () => {
      const rawInput = {
        methodology: {
          testing: TESTING_TEST_AFTER, // Template: 70%
          // No overrides
        },
        // No gates.minCoverage
      };
      const config = parseConfig(rawInput);
      const policy = resolvePolicy(config, { rawConfig: rawInput });

      expect(policy.coverage_threshold).toBe(70); // Template default
    });
  });

  describe('backwards compatibility (no rawConfig)', () => {
    it('should fall back to gates defaults when methodology not specified', () => {
      // Legacy usage without methodology - should get gates defaults
      const config = parseConfig({});
      const policy = resolvePolicy(config);

      // Without methodology and without rawConfig, defaults to tdd template
      expect(policy.testing).toBe(TESTING_TDD);
      expect(policy.coverage_threshold).toBe(90); // gates.minCoverage default
    });
  });
});
