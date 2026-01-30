/**
 * Resolve Policy - Single Source of Truth for Methodology Decisions
 *
 * WU-1259: Provides a unified policy resolver that both wu:spawn and gates use.
 *
 * This module:
 * - Defines the methodology.* config schema
 * - Implements resolvePolicy() to produce ResolvedPolicy
 * - Applies precedence: template defaults -> methodology.overrides -> explicit gates.* -> CLI flags
 *
 * @module resolve-policy
 */

import { z } from 'zod';
import type { LumenFlowConfig } from './lumenflow-config-schema.js';

/**
 * Testing methodology options
 */
export const TESTING_METHODOLOGY = {
  TDD: 'tdd',
  TEST_AFTER: 'test-after',
  NONE: 'none',
} as const;

export type TestingMethodology = (typeof TESTING_METHODOLOGY)[keyof typeof TESTING_METHODOLOGY];

/**
 * Architecture methodology options
 */
export const ARCHITECTURE_METHODOLOGY = {
  HEXAGONAL: 'hexagonal',
  LAYERED: 'layered',
  NONE: 'none',
} as const;

export type ArchitectureMethodology =
  (typeof ARCHITECTURE_METHODOLOGY)[keyof typeof ARCHITECTURE_METHODOLOGY];

/**
 * Coverage mode options
 */
export const COVERAGE_MODE = {
  BLOCK: 'block',
  WARN: 'warn',
  OFF: 'off',
} as const;

export type CoverageMode = (typeof COVERAGE_MODE)[keyof typeof COVERAGE_MODE];

/**
 * Zod schema for testing methodology enum
 */
export const TestingMethodologySchema = z.enum(['tdd', 'test-after', 'none']);

/**
 * Zod schema for architecture methodology enum
 */
export const ArchitectureMethodologySchema = z.enum(['hexagonal', 'layered', 'none']);

/**
 * Zod schema for coverage mode enum
 */
export const CoverageModeSchema = z.enum(['block', 'warn', 'off']);

/**
 * Methodology overrides schema
 *
 * These allow tweaking template defaults without changing methodology.
 */
export const MethodologyOverridesSchema = z.object({
  /** Override the default coverage threshold from the testing methodology */
  coverage_threshold: z.number().min(0).max(100).optional(),
  /** Override the default coverage mode from the testing methodology */
  coverage_mode: CoverageModeSchema.optional(),
});

export type MethodologyOverrides = z.infer<typeof MethodologyOverridesSchema>;

/**
 * Main methodology configuration schema
 *
 * Config example in .lumenflow.config.yaml:
 * ```yaml
 * methodology:
 *   testing: 'tdd'              # tdd | test-after | none
 *   architecture: 'hexagonal'   # hexagonal | layered | none
 *   overrides:
 *     coverage_threshold: 85    # Override TDD's default 90%
 *     coverage_mode: 'warn'     # Override TDD's default 'block'
 * ```
 */
export const MethodologyConfigSchema = z.object({
  /** Testing methodology (default: 'tdd') */
  testing: TestingMethodologySchema.default('tdd'),
  /** Architecture methodology (default: 'hexagonal') */
  architecture: ArchitectureMethodologySchema.default('hexagonal'),
  /** Optional overrides for template defaults */
  overrides: MethodologyOverridesSchema.optional(),
});

export type MethodologyConfig = z.infer<typeof MethodologyConfigSchema>;

/**
 * Template defaults by testing methodology
 *
 * These define the baseline behavior for each testing approach.
 *
 * | Methodology | Coverage Threshold | Coverage Mode | Tests Required |
 * |-------------|-------------------|---------------|----------------|
 * | tdd         | 90%               | block         | true           |
 * | test-after  | 70%               | warn          | true           |
 * | none        | 0%                | off           | false          |
 */
interface TestingTemplateDefaults {
  coverage_threshold: number;
  coverage_mode: CoverageMode;
  tests_required: boolean;
}

const TESTING_TEMPLATE_DEFAULTS: Record<TestingMethodology, TestingTemplateDefaults> = {
  tdd: {
    coverage_threshold: 90,
    coverage_mode: 'block',
    tests_required: true,
  },
  'test-after': {
    coverage_threshold: 70,
    coverage_mode: 'warn',
    tests_required: true,
  },
  none: {
    coverage_threshold: 0,
    coverage_mode: 'off',
    tests_required: false,
  },
};

/**
 * The resolved policy used by wu:spawn and gates
 *
 * This is the single source of truth for methodology decisions.
 * All consumers (spawn prompts, gate runners, etc.) should use this type.
 */
export interface ResolvedPolicy {
  /** Active testing methodology */
  testing: TestingMethodology;
  /** Active architecture methodology */
  architecture: ArchitectureMethodology;
  /** Resolved coverage threshold (0-100) */
  coverage_threshold: number;
  /** Resolved coverage mode */
  coverage_mode: CoverageMode;
  /** Whether tests are required for completion */
  tests_required: boolean;
}

/**
 * Options for resolvePolicy
 */
export interface ResolvePolicyOptions {
  /**
   * Raw config object before Zod defaults were applied.
   * Used to detect explicit vs default values for gates.* fields.
   *
   * When provided, only EXPLICIT gates.* settings override methodology.
   * When not provided, any gates.* value (including defaults) overrides methodology.
   */
  rawConfig?: {
    gates?: {
      minCoverage?: number;
      enableCoverage?: boolean;
    };
  };
}

/**
 * Resolve the effective policy from configuration
 *
 * Precedence (highest to lowest):
 * 1. CLI flags (not handled here - handled by command layer)
 * 2. Explicit gates.* configuration (only if rawConfig provided to detect explicit vs default)
 * 3. methodology.overrides
 * 4. methodology template defaults
 *
 * This ensures backwards compatibility: existing users with explicit
 * gates.* config see no change, while new users can use methodology
 * config for a higher-level abstraction.
 *
 * @param config - The full LumenFlow configuration
 * @param options - Options including rawConfig for explicit detection
 * @returns The resolved policy for use by wu:spawn and gates
 *
 * @example
 * ```typescript
 * import { getConfig } from './lumenflow-config.js';
 * import { resolvePolicy } from './resolve-policy.js';
 *
 * const config = getConfig();
 * const policy = resolvePolicy(config);
 *
 * console.log(policy.coverage_threshold); // 90 (or configured value)
 * console.log(policy.testing); // 'tdd' (or configured value)
 * ```
 *
 * @example With raw config for explicit detection
 * ```typescript
 * const rawConfig = { methodology: { testing: 'test-after' } };
 * const config = parseConfig(rawConfig);
 * const policy = resolvePolicy(config, { rawConfig });
 * // policy.coverage_threshold will be 70 (test-after template default)
 * // because gates.minCoverage wasn't EXPLICITLY set
 * ```
 */
export function resolvePolicy(
  config: LumenFlowConfig,
  options: ResolvePolicyOptions = {},
): ResolvedPolicy {
  const { rawConfig } = options;

  // Parse methodology config (provides defaults if not specified)
  const methodology = MethodologyConfigSchema.parse(config.methodology ?? {});

  // Get template defaults based on testing methodology
  const templateDefaults = TESTING_TEMPLATE_DEFAULTS[methodology.testing];

  // Layer 1: Start with template defaults
  let coverage_threshold = templateDefaults.coverage_threshold;
  let coverage_mode = templateDefaults.coverage_mode;
  const tests_required = templateDefaults.tests_required;

  // Layer 2: Apply methodology.overrides (if specified)
  if (methodology.overrides?.coverage_threshold !== undefined) {
    coverage_threshold = methodology.overrides.coverage_threshold;
  }
  if (methodology.overrides?.coverage_mode !== undefined) {
    coverage_mode = methodology.overrides.coverage_mode;
  }

  // Layer 3: Apply explicit gates.* configuration (highest precedence)
  // This ensures backwards compatibility with existing gates config
  //
  // Key insight: We only want EXPLICIT gates.* to override methodology.
  // If rawConfig is provided, we check if gates values were explicitly set.
  // If rawConfig is NOT provided (legacy mode), we check if methodology
  // was specified - if so, methodology controls unless gates differ from default.

  const gates = config.gates;

  // Determine if gates.minCoverage was explicitly set
  const gatesMinCoverageExplicit =
    rawConfig !== undefined ? rawConfig.gates?.minCoverage !== undefined : false;

  // Determine if gates.enableCoverage was explicitly set
  const gatesEnableCoverageExplicit =
    rawConfig !== undefined ? rawConfig.gates?.enableCoverage !== undefined : false;

  // Apply gates.minCoverage only if explicitly set, or if no methodology was specified
  // (for backwards compatibility with pre-methodology configs)
  const methodologySpecified = config.methodology !== undefined;

  if (gatesMinCoverageExplicit || (!methodologySpecified && !rawConfig)) {
    // gates.minCoverage overrides methodology coverage_threshold
    if (gates?.minCoverage !== undefined) {
      coverage_threshold = gates.minCoverage;
    }
  }

  // gates.enableCoverage: false effectively sets coverage_mode to 'off'
  if (gatesEnableCoverageExplicit || (!methodologySpecified && !rawConfig)) {
    if (gates?.enableCoverage === false) {
      coverage_mode = 'off';
    }
  }

  return {
    testing: methodology.testing,
    architecture: methodology.architecture,
    coverage_threshold,
    coverage_mode,
    tests_required,
  };
}

/**
 * Create a default resolved policy
 *
 * Convenience function for when no config is available.
 * Returns strict TDD defaults.
 */
export function getDefaultPolicy(): ResolvedPolicy {
  return {
    testing: 'tdd',
    architecture: 'hexagonal',
    coverage_threshold: 90,
    coverage_mode: 'block',
    tests_required: true,
  };
}
