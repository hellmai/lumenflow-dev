// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Cloud Auto-Detection Configuration Schemas
 *
 * Cloud mode auto-detection via environment signals for branch-PR workflows.
 *
 * @module schemas/cloud-config
 */

import { z } from 'zod';

/**
 * WU-1495: Cloud environment signal configuration
 *
 * Defines an environment variable to check during cloud auto-detection.
 * When `equals` is omitted, presence of the variable (non-empty) triggers detection.
 * When `equals` is provided, the variable value must match exactly.
 *
 * All signals are user-configured; no vendor-specific signals are hardcoded.
 *
 * @example
 * ```yaml
 * cloud:
 *   env_signals:
 *     - name: CI                    # presence check
 *     - name: GITHUB_ACTIONS
 *       equals: 'true'              # exact match
 *     - name: CODEX
 * ```
 */
export const CloudEnvSignalSchema = z.object({
  /**
   * Environment variable name to check.
   * Must be non-empty.
   */
  name: z.string().min(1),

  /**
   * Optional exact value to match against.
   * When omitted, presence of a non-empty value is sufficient.
   */
  equals: z.string().optional(),
});

/** WU-1495: TypeScript type for cloud env signal */
export type CloudEnvSignal = z.infer<typeof CloudEnvSignalSchema>;

/**
 * WU-1495: Cloud auto-detection configuration schema
 *
 * Controls opt-in cloud mode auto-detection via environment signals.
 * Explicit activation (--cloud flag or LUMENFLOW_CLOUD=1) always takes
 * precedence over auto-detection, regardless of these settings.
 *
 * Detection precedence:
 * 1. --cloud CLI flag (always wins)
 * 2. LUMENFLOW_CLOUD=1 env var (always wins)
 * 3. env_signals (only when auto_detect=true)
 *
 * @example
 * ```yaml
 * cloud:
 *   auto_detect: true
 *   env_signals:
 *     - name: CI
 *     - name: CODEX
 *     - name: GITHUB_ACTIONS
 *       equals: 'true'
 * ```
 */
export const CloudConfigSchema = z.object({
  /**
   * Enable env-signal auto-detection for cloud mode.
   * When false (default), only explicit activation (--cloud / LUMENFLOW_CLOUD=1) works.
   * When true, env_signals are also checked.
   * @default false
   */
  auto_detect: z.boolean().default(false),

  /**
   * Environment signals to check when auto_detect is true.
   * Each signal defines an environment variable name and optional value constraint.
   * Signals are checked in order; first match activates cloud mode.
   * @default []
   */
  env_signals: z.array(CloudEnvSignalSchema).default([]),
});

/** WU-1495: TypeScript type for cloud config */
export type CloudConfig = z.infer<typeof CloudConfigSchema>;
