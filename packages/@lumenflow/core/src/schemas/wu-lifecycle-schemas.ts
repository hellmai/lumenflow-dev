/**
 * @file wu-lifecycle-schemas.ts
 * @description Shared Zod schemas for WU lifecycle commands (WU-1454)
 *
 * These schemas are the single source of truth for WU lifecycle command validation.
 * Both CLI argument parsing and MCP inputSchema derivation use these schemas.
 *
 * This file covers the 16 WU lifecycle commands that were previously hand-coded
 * in MCP and CLI. Combined with the 5 schemas from command-schemas.ts (WU-1431),
 * this provides full shared schema coverage.
 *
 * Design decisions:
 * - Use snake_case for property names (MCP convention, JSON Schema friendly)
 * - Include descriptions for each field (used in both CLI help and MCP tool descriptions)
 * - CLI-only aliases are NOT defined here (handled in arg-validators)
 */

import { z } from 'zod';

// =============================================================================
// wu:block Schema
// =============================================================================

/**
 * Schema for wu:block command
 *
 * Required: id, reason
 * Optional: remove_worktree
 */
export const wuBlockSchema = z.object({
  id: z.string().describe('WU ID to block'),
  reason: z.string().describe('Reason for blocking'),
  remove_worktree: z.boolean().optional().describe('Remove worktree when blocking'),
});

export type WuBlockInput = z.infer<typeof wuBlockSchema>;

// =============================================================================
// wu:unblock Schema
// =============================================================================

/**
 * Schema for wu:unblock command
 *
 * Required: id
 * Optional: reason, create_worktree
 */
export const wuUnblockSchema = z.object({
  id: z.string().describe('WU ID to unblock'),
  reason: z.string().optional().describe('Reason for unblocking'),
  create_worktree: z.boolean().optional().describe('Create worktree when unblocking'),
});

export type WuUnblockInput = z.infer<typeof wuUnblockSchema>;

// =============================================================================
// wu:edit Schema
// =============================================================================

/**
 * Schema for wu:edit command
 *
 * Required: id
 * Optional: all editable fields
 */
export const wuEditSchema = z.object({
  id: z.string().describe('WU ID to edit'),
  description: z.string().optional().describe('New description text'),
  acceptance: z.array(z.string()).optional().describe('Acceptance criteria to add'),
  notes: z.string().optional().describe('Notes text to add'),
  code_paths: z.array(z.string()).optional().describe('Code paths to add'),
  lane: z.string().optional().describe('New lane assignment'),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional().describe('New priority'),
  initiative: z.string().optional().describe('Initiative ID'),
  phase: z.number().optional().describe('Phase number within initiative'),
  no_strict: z.boolean().optional().describe('Bypass strict validation'),
});

export type WuEditInput = z.infer<typeof wuEditSchema>;

// =============================================================================
// wu:release Schema
// =============================================================================

/**
 * Schema for wu:release command
 *
 * Required: id
 * Optional: reason
 */
export const wuReleaseSchema = z.object({
  id: z.string().describe('WU ID to release'),
  reason: z.string().optional().describe('Reason for releasing'),
});

export type WuReleaseInput = z.infer<typeof wuReleaseSchema>;

// =============================================================================
// wu:recover Schema
// =============================================================================

/**
 * Schema for wu:recover command
 *
 * Required: id
 * Optional: action, force, json
 */
export const wuRecoverSchema = z.object({
  id: z.string().describe('WU ID to recover'),
  action: z
    .enum(['resume', 'reset', 'nuke', 'cleanup'])
    .optional()
    .describe('Recovery action to take'),
  force: z.boolean().optional().describe('Required for destructive actions like nuke'),
  json: z.boolean().optional().describe('Output as JSON'),
});

export type WuRecoverInput = z.infer<typeof wuRecoverSchema>;

// =============================================================================
// wu:repair Schema
// =============================================================================

/**
 * Schema for wu:repair command
 *
 * No required fields - all optional mode flags
 */
export const wuRepairSchema = z.object({
  id: z.string().optional().describe('WU ID to check/repair'),
  check: z.boolean().optional().describe('Audit only, no changes'),
  all: z.boolean().optional().describe('Check/repair all WUs'),
  claim: z.boolean().optional().describe('Claim repair mode'),
  admin: z.boolean().optional().describe('Admin repair mode'),
  repair_state: z.boolean().optional().describe('State repair mode'),
});

export type WuRepairInput = z.infer<typeof wuRepairSchema>;

// =============================================================================
// wu:deps Schema
// =============================================================================

/**
 * Schema for wu:deps command
 *
 * Required: id
 * Optional: format, depth, direction
 */
export const wuDepsSchema = z.object({
  id: z.string().describe('WU ID to analyze'),
  format: z.enum(['table', 'json', 'ascii', 'mermaid']).optional().describe('Output format'),
  depth: z.number().optional().describe('Maximum traversal depth'),
  direction: z.enum(['up', 'down', 'both']).optional().describe('Graph direction'),
});

export type WuDepsInput = z.infer<typeof wuDepsSchema>;

// =============================================================================
// wu:prep Schema
// =============================================================================

/**
 * Schema for wu:prep command
 *
 * Required: id
 * Optional: docs_only, full_tests
 */
export const wuPrepSchema = z.object({
  id: z.string().describe('WU ID to prepare'),
  docs_only: z.boolean().optional().describe('Run docs-only gates'),
  full_tests: z
    .boolean()
    .optional()
    .describe('Run full incremental test suite instead of tests.unit scoped execution'),
});

export type WuPrepInput = z.infer<typeof wuPrepSchema>;

// =============================================================================
// wu:preflight Schema
// =============================================================================

/**
 * Schema for wu:preflight command
 *
 * Required: id
 * Optional: worktree
 */
export const wuPreflightSchema = z.object({
  id: z.string().describe('WU ID to preflight'),
  worktree: z.string().optional().describe('Override worktree path'),
});

export type WuPreflightInput = z.infer<typeof wuPreflightSchema>;

// =============================================================================
// wu:prune Schema
// =============================================================================

/**
 * Schema for wu:prune command
 *
 * No required fields
 */
export const wuPruneSchema = z.object({
  execute: z.boolean().optional().describe('Execute cleanup (default is dry-run)'),
});

export type WuPruneInput = z.infer<typeof wuPruneSchema>;

// =============================================================================
// wu:delete Schema
// =============================================================================

/**
 * Schema for wu:delete command
 *
 * Required: id
 * Optional: dry_run, batch
 */
export const wuDeleteSchema = z.object({
  id: z.string().describe('WU ID to delete'),
  dry_run: z.boolean().optional().describe('Show what would be deleted without making changes'),
  batch: z.string().optional().describe('Delete multiple WUs (comma-separated)'),
});

export type WuDeleteInput = z.infer<typeof wuDeleteSchema>;

// =============================================================================
// wu:cleanup Schema
// =============================================================================

/**
 * Schema for wu:cleanup command
 *
 * Required: id
 * Optional: artifacts
 */
export const wuCleanupSchema = z.object({
  id: z.string().describe('WU ID to cleanup'),
  artifacts: z.boolean().optional().describe('Remove build artifacts'),
});

export type WuCleanupInput = z.infer<typeof wuCleanupSchema>;

// =============================================================================
// wu:spawn Schema
// =============================================================================

/**
 * Schema for wu:spawn command
 *
 * Required: id
 * Optional: client, thinking, budget, parent_wu, no_context
 */
export const wuSpawnSchema = z.object({
  id: z.string().describe('WU ID to spawn'),
  client: z.string().optional().describe('Client name (claude-code, gemini-cli, etc)'),
  thinking: z.boolean().optional().describe('Enable extended thinking'),
  budget: z.number().optional().describe('Token budget for extended thinking'),
  parent_wu: z.string().optional().describe('Parent WU ID for orchestrator context'),
  no_context: z.boolean().optional().describe('Skip memory context injection'),
});

export type WuSpawnInput = z.infer<typeof wuSpawnSchema>;

// =============================================================================
// wu:validate Schema
// =============================================================================

/**
 * Schema for wu:validate command
 *
 * Required: id
 * Optional: no_strict
 */
export const wuValidateSchema = z.object({
  id: z.string().describe('WU ID to validate'),
  no_strict: z.boolean().optional().describe('Bypass strict validation'),
});

export type WuValidateInput = z.infer<typeof wuValidateSchema>;

// =============================================================================
// wu:infer-lane Schema
// =============================================================================

/**
 * Schema for wu:infer-lane command
 *
 * No required fields - can provide id, paths, or desc
 */
export const wuInferLaneSchema = z.object({
  id: z.string().optional().describe('WU ID to analyze (reads YAML)'),
  paths: z.array(z.string()).optional().describe('Code paths to analyze'),
  desc: z.string().optional().describe('WU description/title text'),
});

export type WuInferLaneInput = z.infer<typeof wuInferLaneSchema>;

// =============================================================================
// wu:unlock-lane Schema
// =============================================================================

/**
 * Schema for wu:unlock-lane command
 *
 * No required fields - lane is needed unless --list is used
 */
export const wuUnlockLaneSchema = z.object({
  lane: z.string().optional().describe('Lane name to unlock'),
  reason: z.string().optional().describe('Reason for unlocking'),
  force: z.boolean().optional().describe('Force operation'),
  list: z.boolean().optional().describe('List all current lane locks'),
  status: z.boolean().optional().describe('Show detailed status for the lane'),
});

export type WuUnlockLaneInput = z.infer<typeof wuUnlockLaneSchema>;

// =============================================================================
// Lifecycle Schema Registry
// =============================================================================

/**
 * Registry of all WU lifecycle command schemas for validation and parity checking.
 * These complement the 5 schemas in command-schemas.ts (wu:create, wu:claim,
 * wu:status, wu:done, gates).
 */
export const lifecycleCommandSchemas = {
  'wu:block': wuBlockSchema,
  'wu:unblock': wuUnblockSchema,
  'wu:edit': wuEditSchema,
  'wu:release': wuReleaseSchema,
  'wu:recover': wuRecoverSchema,
  'wu:repair': wuRepairSchema,
  'wu:deps': wuDepsSchema,
  'wu:prep': wuPrepSchema,
  'wu:preflight': wuPreflightSchema,
  'wu:prune': wuPruneSchema,
  'wu:delete': wuDeleteSchema,
  'wu:cleanup': wuCleanupSchema,
  'wu:brief': wuSpawnSchema,
  'wu:spawn': wuSpawnSchema,
  'wu:validate': wuValidateSchema,
  'wu:infer-lane': wuInferLaneSchema,
  'wu:unlock-lane': wuUnlockLaneSchema,
} as const;

export type LifecycleCommandName = keyof typeof lifecycleCommandSchemas;
