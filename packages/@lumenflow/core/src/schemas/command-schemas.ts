/**
 * @file command-schemas.ts
 * @description Shared Zod schemas for CLI/MCP parity (WU-1431)
 *
 * These schemas are the single source of truth for command validation.
 * Both CLI argument parsing and MCP inputSchema derivation use these schemas.
 *
 * Design decisions:
 * - Use snake_case for property names (MCP convention, JSON Schema friendly)
 * - Include descriptions for each field (used in both CLI help and MCP tool descriptions)
 * - CLI-only aliases are NOT defined here (they're handled separately in arg-validators.ts)
 */

import { z } from 'zod';

// =============================================================================
// Shared Enums
// =============================================================================

/**
 * Exposure type enum (ui, api, backend-only, documentation)
 */
export const exposureEnum = z.enum(['ui', 'api', 'backend-only', 'documentation']);
export type Exposure = z.infer<typeof exposureEnum>;

/**
 * WU status enum
 */
export const wuStatusEnum = z.enum(['ready', 'in_progress', 'blocked', 'waiting', 'done']);
export type WuStatus = z.infer<typeof wuStatusEnum>;

// =============================================================================
// wu:create Schema
// =============================================================================

/**
 * Schema for wu:create command
 *
 * Required: lane, title
 * Optional: id (auto-generated if omitted), description, acceptance, code_paths, exposure, etc.
 */
export const wuCreateSchema = z.object({
  id: z.string().optional().describe('WU ID (e.g., WU-1234). Auto-generated if omitted.'),
  lane: z.string().describe('Lane name (e.g., "Framework: Core")'),
  title: z.string().describe('Work Unit title'),
  description: z
    .string()
    .optional()
    .describe('WU description (Context: ... Problem: ... Solution: ...)'),
  acceptance: z.array(z.string()).optional().describe('Acceptance criteria (array of strings)'),
  code_paths: z.array(z.string()).optional().describe('Code paths affected by this WU'),
  test_paths_unit: z.array(z.string()).optional().describe('Unit test file paths'),
  test_paths_e2e: z.array(z.string()).optional().describe('E2E test file paths'),
  test_paths_manual: z.array(z.string()).optional().describe('Manual test descriptions'),
  exposure: exposureEnum
    .optional()
    .describe('Exposure level (ui, api, backend-only, documentation)'),
  spec_refs: z.array(z.string()).optional().describe('Spec/plan references (lumenflow:// URIs)'),
  initiative: z.string().optional().describe('Parent initiative (INIT-XXX or slug)'),
  phase: z.number().int().positive().optional().describe('Phase number within initiative'),
  priority: z.string().optional().describe('Priority level (P0, P1, P2, P3)'),
  type: z.string().optional().describe('WU type (feature, bug, refactor, documentation)'),
});

export type WuCreateInput = z.infer<typeof wuCreateSchema>;

// =============================================================================
// wu:claim Schema
// =============================================================================

/**
 * Schema for wu:claim command
 *
 * Required: id, lane
 * Optional: cloud, branch_only, pr_mode (WU-1491: mode selection flags)
 */
export const wuClaimSchema = z.object({
  id: z.string().describe('WU ID to claim (e.g., WU-1234)'),
  lane: z.string().describe('Lane for the WU'),
  cloud: z
    .boolean()
    .optional()
    .describe('Use cloud/branch-pr mode (no worktree, PR-based completion for cloud agents)'),
  branch_only: z
    .boolean()
    .optional()
    .describe('Use branch-only mode (no worktree, direct branch work)'),
  pr_mode: z.boolean().optional().describe('Use PR mode (create PR instead of auto-merge)'),
});

export type WuClaimInput = z.infer<typeof wuClaimSchema>;

// =============================================================================
// wu:status Schema
// =============================================================================

/**
 * Schema for wu:status command
 *
 * Optional: id (auto-detect from current directory if omitted)
 */
export const wuStatusSchema = z.object({
  id: z.string().optional().describe('WU ID to check status for'),
  json: z.boolean().optional().describe('Output as JSON'),
});

export type WuStatusInput = z.infer<typeof wuStatusSchema>;

// =============================================================================
// wu:done Schema
// =============================================================================

/**
 * Schema for wu:done command
 *
 * Required: id
 * Optional: skip_gates (requires reason and fix_wu)
 *
 * Note: skip_gates validation (requires reason) is handled in arg-validators.ts
 * via refinement logic since it involves conditional requirements.
 */
export const wuDoneSchema = z.object({
  id: z.string().describe('WU ID to complete'),
  skip_gates: z.boolean().optional().describe('Skip gates check (requires reason and fix_wu)'),
  reason: z.string().optional().describe('Reason for skipping gates'),
  fix_wu: z.string().optional().describe('WU ID that will fix the skipped issue'),
});

export type WuDoneInput = z.infer<typeof wuDoneSchema>;

// =============================================================================
// gates Schema
// =============================================================================

/**
 * Schema for gates command
 *
 * Optional: docs_only
 */
export const gatesSchema = z.object({
  docs_only: z.boolean().optional().describe('Run docs-only gates (skip lint/typecheck/tests)'),
  full_lint: z.boolean().optional().describe('Run full lint instead of incremental'),
  full_tests: z.boolean().optional().describe('Run full test suite instead of incremental'),
  full_coverage: z
    .boolean()
    .optional()
    .describe('Force full test suite and coverage gate (implies full_tests)'),
  coverage_mode: z.string().optional().describe('Coverage gate mode: "warn" or "block"'),
  verbose: z
    .boolean()
    .optional()
    .describe('Stream output in agent mode instead of logging to file'),
});

export type GatesInput = z.infer<typeof gatesSchema>;

// =============================================================================
// Schema Registry
// =============================================================================

/**
 * Registry of all command schemas for validation and parity checking
 */
export const commandSchemas = {
  'wu:create': wuCreateSchema,
  'wu:claim': wuClaimSchema,
  'wu:status': wuStatusSchema,
  'wu:done': wuDoneSchema,
  gates: gatesSchema,
} as const;

export type CommandName = keyof typeof commandSchemas;
