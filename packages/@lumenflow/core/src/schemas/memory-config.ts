// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Memory Layer Configuration Schemas
 *
 * Memory, progress signals, signal cleanup, auto-checkpoint, enforcement,
 * and decay policy schemas.
 *
 * @module schemas/memory-config
 */

import { z } from 'zod';
import { DURATION_MS } from '../constants/duration-constants.js';

/**
 * WU-1203: Progress signals configuration for sub-agent coordination
 *
 * When enabled, spawn prompts will include mandatory progress signal directives
 * at configurable triggers (milestone completion, tests pass, before gates, when blocked).
 * Frequency-based signals (every N tool calls) also supported.
 *
 * Addresses sub-agent coordination needs without unnecessary token waste.
 */
export const ProgressSignalsConfigSchema = z.object({
  /**
   * Enable mandatory progress signals in spawn prompts.
   * When true, spawn prompts show "Progress Signals (Required at Milestones)"
   * When false, spawn prompts show "Progress Signals (Optional)"
   * @default false
   */
  enabled: z.boolean().default(false),

  /**
   * Send progress signals every N tool calls.
   * Set to 0 to disable frequency-based signals.
   * @default 0
   */
  frequency: z.number().int().nonnegative().default(0),

  /**
   * Signal after each acceptance criterion is completed.
   * @default true
   */
  on_milestone: z.boolean().default(true),

  /**
   * Signal when tests first pass.
   * @default true
   */
  on_tests_pass: z.boolean().default(true),

  /**
   * Signal before running gates.
   * @default true
   */
  before_gates: z.boolean().default(true),

  /**
   * Signal when work is blocked.
   * @default true
   */
  on_blocked: z.boolean().default(true),

  /**
   * Automatically checkpoint memory at signal milestones.
   * @default false
   */
  auto_checkpoint: z.boolean().default(false),
});

/**
 * Signal cleanup configuration (WU-1204)
 *
 * Configures TTL-based cleanup for signals in .lumenflow/memory/signals.jsonl
 * to prevent unbounded growth.
 */
export const SignalCleanupConfigSchema = z.object({
  /**
   * TTL for read signals in milliseconds (default: 7 days).
   * Read signals older than this are removed during cleanup.
   */
  ttl: z.number().int().positive().default(DURATION_MS.SEVEN_DAYS),

  /**
   * TTL for unread signals in milliseconds (default: 30 days).
   * Unread signals get a longer TTL to ensure important signals aren't missed.
   */
  unreadTtl: z.number().int().positive().default(DURATION_MS.THIRTY_DAYS),

  /**
   * Maximum number of signals to retain (default: 500).
   * When exceeded, oldest signals are removed first (keeping newest).
   * Active WU signals are always retained regardless of this limit.
   */
  maxEntries: z.number().int().positive().default(500),
});

/**
 * WU-1471: Auto-checkpoint configuration
 *
 * Controls automatic checkpointing behavior via Claude Code hooks.
 * When enabled and hooks are active, PostToolUse and SubagentStop hooks
 * create checkpoints at configurable intervals.
 *
 * @example
 * ```yaml
 * memory:
 *   enforcement:
 *     auto_checkpoint:
 *       enabled: true
 *       interval_tool_calls: 30
 * ```
 */
export const AutoCheckpointConfigSchema = z.object({
  /**
   * Enable auto-checkpoint hooks.
   * When true (and hooks master switch is enabled), generates PostToolUse
   * and SubagentStop hooks that create checkpoints automatically.
   * @default false
   */
  enabled: z.boolean().default(false),

  /**
   * Number of tool calls between automatic checkpoints.
   * The hook script tracks a per-WU counter and checkpoints
   * when the counter reaches this interval.
   * @default 30
   */
  interval_tool_calls: z.number().int().positive().default(30),
});

/** WU-1471: TypeScript type for auto-checkpoint config */
export type AutoCheckpointConfig = z.infer<typeof AutoCheckpointConfigSchema>;

/**
 * WU-1471: Memory enforcement configuration
 *
 * Controls enforcement of memory layer practices:
 * - Auto-checkpointing via hooks
 * - Checkpoint gate on wu:done
 *
 * @example
 * ```yaml
 * memory:
 *   enforcement:
 *     auto_checkpoint:
 *       enabled: true
 *       interval_tool_calls: 30
 *     require_checkpoint_for_done: warn
 * ```
 */
export const MemoryEnforcementConfigSchema = z.object({
  /**
   * Auto-checkpoint configuration.
   * Controls automatic checkpointing via hooks.
   */
  auto_checkpoint: AutoCheckpointConfigSchema.default(() => AutoCheckpointConfigSchema.parse({})),

  /**
   * Checkpoint requirement for wu:done.
   * - 'off': No checkpoint check during wu:done
   * - 'warn': Warn if no checkpoints exist (default, fail-open)
   * - 'block': Block wu:done if no checkpoints exist
   * @default 'warn'
   */
  require_checkpoint_for_done: z.enum(['off', 'warn', 'block']).default('warn'),
});

/** WU-1471: TypeScript type for memory enforcement config */
export type MemoryEnforcementConfig = z.infer<typeof MemoryEnforcementConfigSchema>;

/**
 * WU-1474: Memory decay policy configuration
 *
 * Controls automated archival of stale memory nodes during lifecycle events.
 * When enabled with trigger=on_done, wu:done will invoke decay archival
 * using the configured threshold and half-life parameters.
 *
 * Fail-open: archival errors never block wu:done completion.
 *
 * @example
 * ```yaml
 * memory:
 *   decay:
 *     enabled: true
 *     threshold: 0.1
 *     half_life_days: 30
 *     trigger: on_done
 * ```
 */
export const MemoryDecayConfigSchema = z.object({
  /**
   * Enable decay-based archival.
   * When false, no automatic archival is triggered.
   * @default false
   */
  enabled: z.boolean().default(false),

  /**
   * Decay score threshold below which nodes are archived.
   * Nodes with a decay score below this value are marked as archived.
   * Must be between 0 and 1 inclusive.
   * @default 0.1
   */
  threshold: z.number().min(0).max(1).default(0.1),

  /**
   * Half-life for decay scoring in days.
   * Controls how quickly nodes lose relevance over time.
   * Must be a positive integer.
   * @default 30
   */
  half_life_days: z.number().int().positive().default(30),

  /**
   * When to trigger decay archival.
   * - 'on_done': Run during wu:done completion lifecycle
   * - 'manual': Only run via pnpm mem:cleanup
   * @default 'on_done'
   */
  trigger: z.enum(['on_done', 'manual']).default('on_done'),
});

/** WU-1474: TypeScript type for memory decay config */
export type MemoryDecayConfig = z.infer<typeof MemoryDecayConfigSchema>;

const MEMORY_CONFIG_ERRORS = {
  DEPRECATED_SPAWN_CONTEXT_MAX_SIZE:
    'memory.spawn_context_max_size is no longer supported. Use memory.delegation_context_max_size instead.',
} as const;

/**
 * Memory layer configuration
 */
export const MemoryConfigSchema = z.object({
  /** Memory directory (default: 'memory-bank/') */
  directory: z.string().default('memory-bank/'),

  /** Session TTL in milliseconds (default: 7 days) */
  sessionTtl: z.number().int().positive().default(DURATION_MS.SEVEN_DAYS),

  /** Checkpoint TTL in milliseconds (default: 30 days) */
  checkpointTtl: z.number().int().positive().default(DURATION_MS.THIRTY_DAYS),

  /** Enable auto-cleanup (default: true) */
  enableAutoCleanup: z.boolean().default(true),

  /**
   * WU-1203: Progress signals configuration for sub-agent coordination.
   * Optional - when not provided, spawn prompts show "Progress Signals (Optional)".
   */
  progress_signals: ProgressSignalsConfigSchema.optional(),

  /**
   * WU-1204: Signal cleanup configuration
   * Controls TTL-based cleanup for signals.jsonl to prevent unbounded growth.
   */
  signalCleanup: SignalCleanupConfigSchema.default(() => SignalCleanupConfigSchema.parse({})),

  /**
   * WU-1674: Maximum size in bytes for delegation memory context.
   * Controls the maximum size of memory context injected into delegation prompts.
   * Larger values include more context but increase token usage.
   * @default 4096 (4KB)
   */
  delegation_context_max_size: z.number().int().positive().default(4096),

  /**
   * Deprecated key hard-fail for clean-slate cutover.
   * Keep this as an explicit validator so users get a direct migration message.
   */
  spawn_context_max_size: z
    .unknown()
    .optional()
    .refine((value) => value === undefined, {
      message: MEMORY_CONFIG_ERRORS.DEPRECATED_SPAWN_CONTEXT_MAX_SIZE,
    }),

  /**
   * WU-1471: Memory enforcement configuration.
   * Controls auto-checkpointing and checkpoint requirements for wu:done.
   * Optional - when not provided, existing WU-1943 warn behavior applies.
   */
  enforcement: MemoryEnforcementConfigSchema.optional(),

  /**
   * WU-1474: Decay policy configuration.
   * Controls automated archival of stale memory nodes during lifecycle events.
   * Optional - when not provided, no automatic decay archival runs.
   */
  decay: MemoryDecayConfigSchema.optional(),
});

export type ProgressSignalsConfig = z.infer<typeof ProgressSignalsConfigSchema>;
export type SignalCleanupConfig = z.infer<typeof SignalCleanupConfigSchema>;
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
