// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Gates Schemas and Types
 *
 * WU-2037: Extracted from gates-config.ts
 *
 * Zod schema definitions, TypeScript types, and interfaces for gates configuration.
 * This module contains only shape definitions -- no runtime logic.
 *
 * @module gates-schemas
 */

import { z } from 'zod';
import type { CoverageMode } from './resolve-policy.js';

// ---------------------------------------------------------------------------
// Gate command schemas
// ---------------------------------------------------------------------------

/**
 * Schema for a gate command object with options
 */
const GateCommandObjectSchema = z.object({
  /** The shell command to execute */
  command: z.string(),
  /** Whether to continue if this gate fails (default: false) */
  continueOnError: z.boolean().optional(),
  /** Timeout in milliseconds */
  timeout: z.number().int().positive().optional(),
});

/**
 * Schema for a gate command - either a string or an object with options
 */
export const GateCommandConfigSchema = z.union([z.string(), GateCommandObjectSchema]);

/**
 * Type for parsed gate command configuration
 */
export type GateCommandConfig = z.infer<typeof GateCommandConfigSchema>;

/**
 * Schema for the gates execution configuration section
 */
export const GatesExecutionConfigSchema = z.object({
  /** Preset to use for default commands (node, python, go, rust, dotnet) */
  preset: z.string().optional(),
  /** Setup command (e.g., install dependencies) */
  setup: GateCommandConfigSchema.optional(),
  /** Format check command */
  format: GateCommandConfigSchema.optional(),
  /** Lint command */
  lint: GateCommandConfigSchema.optional(),
  /** Type check command */
  typecheck: GateCommandConfigSchema.optional(),
  /** Test command */
  test: GateCommandConfigSchema.optional(),
  /** Coverage configuration */
  coverage: z
    .union([
      z.string(),
      z.object({
        command: z.string(),
        threshold: z.number().min(0).max(100).optional(),
      }),
    ])
    .optional(),
});

/**
 * Type for gates execution configuration
 */
export type GatesExecutionConfig = z.infer<typeof GatesExecutionConfigSchema>;

// ---------------------------------------------------------------------------
// Parsed gate command interface
// ---------------------------------------------------------------------------

/**
 * Parsed gate command ready for execution
 */
export interface ParsedGateCommand {
  /** The shell command to execute */
  command: string;
  /** Whether to continue if this gate fails */
  continueOnError: boolean;
  /** Timeout in milliseconds */
  timeout: number;
}

// ---------------------------------------------------------------------------
// Lane health types
// ---------------------------------------------------------------------------

/**
 * WU-1191: Lane health gate mode
 * Controls how lane health check behaves during gates
 */
export type LaneHealthMode = 'warn' | 'error' | 'off';

/**
 * Schema for lane health mode validation
 */
export const LaneHealthModeSchema = z.enum(['warn', 'error', 'off']);

/**
 * Default lane health mode (advisory by default)
 */
export const DEFAULT_LANE_HEALTH_MODE: LaneHealthMode = 'warn';

// ---------------------------------------------------------------------------
// Coverage / test policy interfaces
// ---------------------------------------------------------------------------

/**
 * WU-1262: Resolved coverage configuration
 * Contains threshold and mode derived from methodology policy
 */
export interface CoverageConfig {
  /** Coverage threshold (0-100) */
  threshold: number;
  /** Coverage mode (block, warn, or off) */
  mode: CoverageMode;
}

/**
 * WU-2020: Focused coverage policy interface (ISP-compliant).
 * Single-responsibility: coverage threshold and enforcement mode.
 */
export interface CoveragePolicy {
  /** Coverage threshold (0-100) */
  threshold: number;
  /** Coverage mode (block, warn, or off) */
  mode: CoverageMode;
}

/**
 * WU-2020: Focused test runner policy interface (ISP-compliant).
 * Single-responsibility: whether tests are mandatory for completion.
 */
export interface TestRunnerPolicy {
  /** Whether tests are required for completion (from methodology.testing) */
  tests_required: boolean;
}

/**
 * WU-1280: Resolved test policy configuration
 * Extends CoverageConfig with tests_required from methodology policy.
 *
 * WU-2020: Now defined as the intersection of CoveragePolicy and
 * TestRunnerPolicy. Consumers that only need coverage or test-runner
 * semantics should prefer the focused interfaces.
 */
export interface TestPolicy extends CoveragePolicy, TestRunnerPolicy {}

// ---------------------------------------------------------------------------
// Gates commands interface
// ---------------------------------------------------------------------------

/**
 * WU-1356: Gates commands configuration type
 */
export interface GatesCommands {
  test_full: string;
  test_docs_only: string;
  test_incremental: string;
  lint?: string;
  typecheck?: string;
  format?: string;
}
