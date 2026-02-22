// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Operational Configuration Schemas
 *
 * Experimental features, cleanup triggers, telemetry, UI, YAML serialization,
 * package manager, and test runner schemas.
 *
 * @module schemas/operational-config
 */

import { z } from 'zod';

/**
 * WU-1356: Package manager options
 *
 * Supported package managers for LumenFlow CLI operations.
 * Used for build commands, dependency installation, and script execution.
 *
 * @example
 * ```yaml
 * package_manager: npm
 * ```
 */
export const PackageManagerSchema = z.enum(['pnpm', 'npm', 'yarn', 'bun']).default('pnpm');

/** WU-1356: TypeScript type for package manager */
export type PackageManager = z.infer<typeof PackageManagerSchema>;

/**
 * WU-1356: Test runner options
 *
 * Supported test runners for incremental test detection and execution.
 * Determines how changed tests are detected and ignore patterns are derived.
 *
 * @example
 * ```yaml
 * test_runner: jest
 * ```
 */
export const TestRunnerSchema = z.enum(['vitest', 'jest', 'mocha']).default('vitest');

/** WU-1356: TypeScript type for test runner */
export type TestRunner = z.infer<typeof TestRunnerSchema>;

/**
 * UI configuration
 */
export const UiConfigSchema = z.object({
  /** Error box width (default: 70) */
  errorBoxWidth: z.number().int().positive().default(70),

  /** Status preview lines (default: 5) */
  statusPreviewLines: z.number().int().positive().default(5),

  /** Readiness box width (default: 50) */
  readinessBoxWidth: z.number().int().positive().default(50),
});

/**
 * YAML serialization configuration
 */
export const YamlConfigSchema = z.object({
  /** Line width for YAML output (default: 100, -1 for no wrap) */
  lineWidth: z.number().int().default(100),
});

/**
 * Validation mode for context-aware commands
 * WU-1090: Context-aware state machine for WU lifecycle commands
 */
export const ValidationModeSchema = z.enum(['off', 'warn', 'error']).default('warn');

/**
 * Experimental features configuration
 * WU-1090: Feature flags for gradual rollout
 */
export const ExperimentalConfigSchema = z.object({
  /**
   * Enable context-aware validation for wu:* commands
   * When enabled, commands will check location, WU status, and predicates
   * @default true
   */
  context_validation: z.boolean().default(true),

  /**
   * Validation behavior mode
   * - 'off': No validation (legacy behavior)
   * - 'warn': Show warnings but proceed
   * - 'error': Block on validation failures
   * @default 'warn'
   */
  validation_mode: ValidationModeSchema,

  /**
   * Show next steps guidance after successful command completion
   * @default true
   */
  show_next_steps: z.boolean().default(true),

  /**
   * Enable wu:recover command for state recovery
   * @default true
   */
  recovery_command: z.boolean().default(true),
});

/**
 * WU-1270: Methodology telemetry configuration
 *
 * Opt-in telemetry to track which methodology modes are being used.
 * Privacy-preserving: No PII or project-identifying information collected.
 */
export const MethodologyTelemetryConfigSchema = z.object({
  /**
   * Enable methodology telemetry (opt-in).
   * When true, tracks methodology.testing and methodology.architecture values
   * on wu:spawn events. Data is privacy-preserving (no PII/project info).
   * @default false
   */
  enabled: z.boolean().default(false),
});

/**
 * WU-1270: Telemetry configuration
 *
 * Configuration for opt-in telemetry features.
 */
export const TelemetryConfigSchema = z.object({
  /**
   * Methodology telemetry configuration (opt-in).
   * Tracks methodology selection patterns for adoption insights.
   */
  methodology: MethodologyTelemetryConfigSchema.default(() =>
    MethodologyTelemetryConfigSchema.parse({}),
  ),
});

/**
 * WU-1366: Cleanup trigger options
 *
 * Controls when automatic state cleanup runs:
 * - 'on_done': Run after wu:done success (default)
 * - 'on_init': Run during lumenflow init
 * - 'manual': Only run via pnpm state:cleanup
 */
export const CleanupTriggerSchema = z.enum(['on_done', 'on_init', 'manual']).default('on_done');

/** WU-1366: TypeScript type for cleanup trigger */
export type CleanupTrigger = z.infer<typeof CleanupTriggerSchema>;

/**
 * WU-1366: Cleanup configuration schema
 *
 * Controls when and how automatic state cleanup runs.
 *
 * @example
 * ```yaml
 * cleanup:
 *   trigger: on_done  # on_done | on_init | manual
 * ```
 */
export const CleanupConfigSchema = z.object({
  /**
   * When to trigger automatic state cleanup.
   * - 'on_done': Run after wu:done success (default)
   * - 'on_init': Run during lumenflow init
   * - 'manual': Only run via pnpm state:cleanup
   *
   * @default 'on_done'
   */
  trigger: CleanupTriggerSchema,

  /**
   * WU-1542: Commit message for auto-cleanup changes.
   * Consumer repos with strict main-branch guards may reject the default.
   * Configure this to match your repo's allowed commit message patterns.
   *
   * @default 'chore: lumenflow state cleanup [skip ci]'
   *
   * @example
   * ```yaml
   * cleanup:
   *   commit_message: 'chore(repair): auto state cleanup [skip ci]'
   * ```
   */
  commit_message: z.string().default('chore: lumenflow state cleanup [skip ci]'),
});

/** WU-1366: TypeScript type for cleanup config */
export type CleanupConfig = z.infer<typeof CleanupConfigSchema>;

export type UiConfig = z.infer<typeof UiConfigSchema>;
export type YamlConfig = z.infer<typeof YamlConfigSchema>;
export type ExperimentalConfig = z.infer<typeof ExperimentalConfigSchema>;
export type ValidationMode = z.infer<typeof ValidationModeSchema>;
export type MethodologyTelemetryConfig = z.infer<typeof MethodologyTelemetryConfigSchema>;
export type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>;
