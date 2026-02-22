// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Git Configuration Schemas
 *
 * Git settings including branch policies, remote configuration, and push retry.
 *
 * @module schemas/git-config
 */

import { z } from 'zod';

/**
 * WU-1332: Push retry configuration for micro-worktree operations
 *
 * When non-fast-forward push errors occur (origin/main moved during operation),
 * retry with exponential backoff. Uses p-retry for robust retry behavior.
 */
export const PushRetryConfigSchema = z.object({
  /**
   * Enable push retry with rebase on non-fast-forward errors.
   * When true, failed pushes trigger automatic rebase and retry.
   * When false, the original error is thrown immediately.
   * @default true
   */
  enabled: z.boolean().default(true),

  /**
   * Maximum number of retry attempts (including the initial attempt).
   * After this many failures, the operation fails with clear guidance.
   * @default 3
   */
  retries: z.number().int().positive().default(3),

  /**
   * Minimum delay in milliseconds between retries.
   * Used as the base for exponential backoff.
   * @default 100
   */
  min_delay_ms: z.number().int().nonnegative().default(100),

  /**
   * Maximum delay in milliseconds between retries.
   * Caps the exponential backoff to prevent excessive waits.
   * @default 1000
   */
  max_delay_ms: z.number().int().positive().default(1000),

  /**
   * Add randomization to retry delays (recommended for concurrent agents).
   * Helps prevent thundering herd when multiple agents retry simultaneously.
   * @default true
   */
  jitter: z.boolean().default(true),
});

/**
 * Git configuration
 */
export const GitConfigSchema = z.object({
  /** Main branch name (default: 'main') */
  mainBranch: z.string().default('main'),

  /** Default remote name (default: 'origin') */
  defaultRemote: z.string().default('origin'),

  /** Lane branch prefix (default: 'lane/') */
  laneBranchPrefix: z.string().default('lane/'),

  /** Temporary branch prefix (default: 'tmp/') */
  tempBranchPrefix: z.string().default('tmp/'),

  /** Real git executable path (default: '/usr/bin/git') */
  realGitPath: z.string().default('/usr/bin/git'),

  /** Maximum commits behind main before requiring rebase */
  maxBranchDrift: z.number().int().positive().default(20),

  /** Warning threshold for branch drift */
  branchDriftWarning: z.number().int().positive().default(15),

  /** Info threshold for branch drift */
  branchDriftInfo: z.number().int().positive().default(10),

  /**
   * WU-1302: Require a remote repository for wu:create and wu:claim.
   * When true (default), operations fail if no remote 'origin' exists.
   * When false, operations can proceed locally without pushing.
   *
   * Use `git.requireRemote: false` for:
   * - Local-only development before remote is set up
   * - Air-gapped environments
   * - Testing/evaluation of LumenFlow
   *
   * @default true
   *
   * @example
   * ```yaml
   * git:
   *   requireRemote: false  # Allow offline/local mode
   * ```
   */
  requireRemote: z.boolean().default(true),

  /**
   * Agent branch patterns to MERGE with the registry patterns.
   * These patterns are merged with patterns from lumenflow.dev/registry/agent-patterns.json.
   * Use this to add custom patterns that should work alongside the standard vendor patterns.
   * Protected branches (mainBranch + 'master') are NEVER bypassed.
   *
   * WU-1089: Changed default from ['agent/*'] to [] to allow registry to be used by default.
   *
   * @example
   * ```yaml
   * git:
   *   agentBranchPatterns:
   *     - 'my-custom-agent/*'
   *     - 'internal-tool/*'
   * ```
   */
  agentBranchPatterns: z.array(z.string()).default([]),

  /**
   * Agent branch patterns that REPLACE the registry patterns entirely.
   * When set, these patterns are used instead of fetching from the registry.
   * The agentBranchPatterns field is ignored when this is set.
   *
   * Use this for strict control over which agent patterns are allowed.
   *
   * @example
   * ```yaml
   * git:
   *   agentBranchPatternsOverride:
   *     - 'claude/*'
   *     - 'codex/*'
   * ```
   */
  agentBranchPatternsOverride: z.array(z.string()).optional(),

  /**
   * Disable fetching agent patterns from the registry (airgapped mode).
   * When true, only uses agentBranchPatterns from config or defaults to ['agent/*'].
   * Useful for environments without network access or strict security requirements.
   *
   * @default false
   *
   * @example
   * ```yaml
   * git:
   *   disableAgentPatternRegistry: true
   *   agentBranchPatterns:
   *     - 'claude/*'
   *     - 'cursor/*'
   * ```
   */
  disableAgentPatternRegistry: z.boolean().default(false),

  /**
   * WU-1332: Push retry configuration for micro-worktree operations.
   * When push fails due to non-fast-forward (origin moved), automatically
   * rebase and retry with exponential backoff.
   *
   * @example
   * ```yaml
   * git:
   *   push_retry:
   *     enabled: true
   *     retries: 5        # Try 5 times total
   *     min_delay_ms: 200 # Start with 200ms delay
   *     max_delay_ms: 2000 # Cap at 2 second delay
   *     jitter: true      # Add randomization
   * ```
   */
  push_retry: PushRetryConfigSchema.default(() => PushRetryConfigSchema.parse({})),
});

export type PushRetryConfig = z.infer<typeof PushRetryConfigSchema>;
export type GitConfig = z.infer<typeof GitConfigSchema>;
