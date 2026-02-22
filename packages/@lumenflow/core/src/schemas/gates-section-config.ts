// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Gates Section Configuration Schemas
 *
 * Quality gates configuration including commands, coverage, and lane health.
 * Note: GatesExecutionConfigSchema is imported from the top-level gates-config.ts
 * (owned by WU-1067).
 *
 * @module schemas/gates-section-config
 */

import { z } from 'zod';
// WU-1067: Import gates execution schema from canonical source
import { GatesExecutionConfigSchema } from '../gates-config.js';
import { DEFAULT_MIN_COVERAGE, DEFAULT_MAX_ESLINT_WARNINGS } from '../constants/gate-constants.js';

/**
 * WU-1356: Gates commands configuration
 *
 * Configurable test commands for gates execution.
 * Replaces hard-coded turbo/vitest commands with user-configurable alternatives.
 *
 * @example
 * ```yaml
 * gates:
 *   commands:
 *     test_full: 'npm test'
 *     test_docs_only: 'npm test -- --testPathPattern=docs'
 *     test_incremental: 'npm test -- --onlyChanged'
 * ```
 */
export const GatesCommandsConfigSchema = z.object({
  /**
   * Command to run full test suite.
   * Default: 'pnpm turbo run test'
   */
  test_full: z.string().default('pnpm turbo run test'),

  /**
   * Command to run tests in docs-only mode.
   * Default: empty (skip tests in docs-only mode)
   */
  test_docs_only: z.string().default(''),

  /**
   * Command to run incremental tests (changed files only).
   * Default: 'pnpm vitest run --changed origin/main'
   */
  test_incremental: z.string().default('pnpm vitest run --changed origin/main'),

  /**
   * Command to run lint checks.
   * Default: 'pnpm lint'
   */
  lint: z.string().optional(),

  /**
   * Command to run type checks.
   * Default: 'pnpm typecheck'
   */
  typecheck: z.string().optional(),

  /**
   * Command to run format checks.
   * Default: 'pnpm format:check'
   */
  format: z.string().optional(),
});

/** WU-1356: TypeScript type for gates commands config */
export type GatesCommandsConfig = z.infer<typeof GatesCommandsConfigSchema>;

/**
 * Gates configuration
 * Note: GatesExecutionConfigSchema is imported from gates-config.ts
 */
export const GatesConfigSchema = z.object({
  /** Maximum ESLint warnings allowed (default: 100) */
  maxEslintWarnings: z.number().int().nonnegative().default(DEFAULT_MAX_ESLINT_WARNINGS),

  /** Enable coverage gate (default: true) */
  enableCoverage: z.boolean().default(true),

  /** Minimum coverage percentage (default: 90) */
  minCoverage: z.number().min(0).max(100).default(DEFAULT_MIN_COVERAGE),

  /** Enable safety-critical tests (default: true) */
  enableSafetyCriticalTests: z.boolean().default(true),

  /** Enable invariants check (default: true) */
  enableInvariants: z.boolean().default(true),

  /**
   * WU-1067: Config-driven gates execution
   * Custom commands for each gate, with optional preset expansion.
   * When set, gates runner uses these instead of hardcoded commands.
   */
  execution: GatesExecutionConfigSchema.optional(),

  /**
   * WU-1356: Configurable gate commands
   * Replaces hard-coded turbo/vitest commands with user-configurable alternatives.
   * Enables LumenFlow to work with npm/yarn/bun, Nx/plain scripts, Jest/Mocha, etc.
   */
  commands: GatesCommandsConfigSchema.default(() => GatesCommandsConfigSchema.parse({})),

  /**
   * WU-1356: Ignore patterns for test runners
   * Patterns to ignore when detecting changed tests.
   * Default: ['.turbo'] for vitest (derived from test_runner if not specified)
   */
  ignore_patterns: z.array(z.string()).optional(),

  /**
   * WU-1191: Lane health gate mode
   * Controls how lane health check behaves during gates.
   * - 'warn': Log warning if issues found (default)
   * - 'error': Fail gates if issues found
   * - 'off': Skip lane health check
   */
  lane_health: z.enum(['warn', 'error', 'off']).default('warn'),
});

export type GatesConfig = z.infer<typeof GatesConfigSchema>;
