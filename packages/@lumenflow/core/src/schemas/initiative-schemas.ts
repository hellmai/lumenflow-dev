/**
 * @file initiative-schemas.ts
 * @description Shared Zod schemas for Initiative commands (WU-1455)
 *
 * These schemas are the single source of truth for initiative command validation.
 * Both CLI argument parsing and MCP inputSchema derivation use these schemas.
 *
 * This file covers the 8 initiative commands that were previously hand-coded
 * in MCP and CLI separately. Combined with the schemas from command-schemas.ts
 * (WU-1431) and wu-lifecycle-schemas.ts (WU-1454), this provides full shared
 * schema coverage for all LumenFlow commands.
 *
 * Design decisions:
 * - Use snake_case for property names (MCP convention, JSON Schema friendly)
 * - Include descriptions for each field (used in both CLI help and MCP tool descriptions)
 * - CLI-only aliases are NOT defined here (handled in arg-validators)
 * - Initiative status enum values match INIT_STATUSES from @lumenflow/initiatives
 * - Phase status enum values match PHASE_STATUSES from @lumenflow/initiatives
 */

import { z } from 'zod';

// =============================================================================
// Shared Enums
// =============================================================================

/**
 * Initiative status values (matches INIT_STATUSES from initiative-constants.ts)
 */
export const initiativeStatusEnum = z.enum(['draft', 'open', 'in_progress', 'done', 'archived']);
export type InitiativeStatus = z.infer<typeof initiativeStatusEnum>;

/**
 * Phase status values (matches PHASE_STATUSES from initiative-constants.ts)
 */
export const phaseStatusEnum = z.enum(['pending', 'in_progress', 'done', 'blocked']);
export type PhaseStatus = z.infer<typeof phaseStatusEnum>;

/**
 * Output format values used by initiative:list and initiative:status
 */
export const outputFormatEnum = z.enum(['table', 'json']);

// =============================================================================
// initiative:create Schema
// =============================================================================

/**
 * Schema for initiative:create command
 *
 * Required: id, slug, title
 * Optional: priority, owner, target_date
 */
export const initiativeCreateSchema = z.object({
  id: z.string().describe('Initiative ID (e.g., INIT-001)'),
  slug: z.string().describe('Initiative slug (kebab-case, e.g., my-initiative)'),
  title: z.string().describe('Initiative title'),
  priority: z.string().optional().describe('Priority level (P0, P1, P2, P3)'),
  owner: z.string().optional().describe('Owner email or name'),
  target_date: z.string().optional().describe('Target completion date (YYYY-MM-DD)'),
});

export type InitiativeCreateInput = z.infer<typeof initiativeCreateSchema>;

// =============================================================================
// initiative:edit Schema
// =============================================================================

/**
 * Schema for initiative:edit command
 *
 * Required: id
 * Optional: status, blocked_by, blocked_reason, unblock, add_lane, remove_lane,
 *           notes, description, add_phase, add_success_metric, phase_id, phase_status, phase_title,
 *           created
 */
export const initiativeEditSchema = z.object({
  id: z.string().describe('Initiative ID to edit'),
  status: initiativeStatusEnum.optional().describe('New initiative status'),
  blocked_by: z.string().optional().describe('Initiative ID that blocks this initiative'),
  blocked_reason: z.string().optional().describe('Reason for blocking'),
  unblock: z.boolean().optional().describe('Remove blocked_by and blocked_reason fields'),
  add_lane: z.array(z.string()).optional().describe('Lanes to add (repeatable)'),
  remove_lane: z.array(z.string()).optional().describe('Lanes to remove (repeatable)'),
  notes: z.string().optional().describe('Note to append to notes array'),
  description: z.string().optional().describe('Replace the initiative description field'),
  add_phase: z.array(z.string()).optional().describe('Phase titles to add (repeatable)'),
  add_success_metric: z
    .array(z.string())
    .optional()
    .describe('Success metrics to add (repeatable, deduplicated)'),
  phase_id: z.string().optional().describe('Phase ID to update (use with phase_status)'),
  phase_status: phaseStatusEnum.optional().describe('New phase status'),
  phase_title: z.string().optional().describe('New phase title'),
  created: z.string().optional().describe('Set created date (YYYY-MM-DD format)'),
});

export type InitiativeEditInput = z.infer<typeof initiativeEditSchema>;

// =============================================================================
// initiative:list Schema
// =============================================================================

/**
 * Schema for initiative:list command
 *
 * No required fields
 * Optional: status, format, color
 */
export const initiativeListSchema = z.object({
  status: z.string().optional().describe('Filter by initiative status'),
  format: outputFormatEnum.optional().describe('Output format (table, json)'),
  color: z.boolean().optional().describe('Enable colored output'),
});

export type InitiativeListInput = z.infer<typeof initiativeListSchema>;

// =============================================================================
// initiative:status Schema
// =============================================================================

/**
 * Schema for initiative:status command
 *
 * Required: id
 * Optional: format, color
 */
export const initiativeStatusSchema = z.object({
  id: z.string().describe('Initiative ID or slug'),
  format: outputFormatEnum.optional().describe('Output format (table, json)'),
  color: z.boolean().optional().describe('Enable colored output'),
});

export type InitiativeStatusInput = z.infer<typeof initiativeStatusSchema>;

// =============================================================================
// initiative:add-wu Schema
// =============================================================================

/**
 * Schema for initiative:add-wu command
 *
 * Required: initiative, wu
 * Optional: phase
 */
export const initiativeAddWuSchema = z.object({
  initiative: z.string().describe('Initiative ID to link WU to'),
  wu: z.string().describe('WU ID to add (or array for batch)'),
  phase: z.number().optional().describe('Phase number to assign (1-based)'),
});

export type InitiativeAddWuInput = z.infer<typeof initiativeAddWuSchema>;

// =============================================================================
// initiative:remove-wu Schema
// =============================================================================

/**
 * Schema for initiative:remove-wu command
 *
 * Required: initiative, wu
 */
export const initiativeRemoveWuSchema = z.object({
  initiative: z.string().describe('Initiative ID to unlink WU from'),
  wu: z.string().describe('WU ID to remove'),
});

export type InitiativeRemoveWuInput = z.infer<typeof initiativeRemoveWuSchema>;

// =============================================================================
// initiative:bulk-assign Schema
// =============================================================================

/**
 * Schema for initiative:bulk-assign command
 *
 * No required fields (defaults to dry-run)
 * Optional: config, apply, sync_from_initiative
 */
export const initiativeBulkAssignSchema = z.object({
  config: z.string().optional().describe('Path to lane bucket configuration file'),
  apply: z.boolean().optional().describe('Apply changes (default is dry-run)'),
  sync_from_initiative: z.string().optional().describe('Reconcile WUs from a specific initiative'),
});

export type InitiativeBulkAssignInput = z.infer<typeof initiativeBulkAssignSchema>;

// =============================================================================
// initiative:plan Schema
// =============================================================================

/**
 * Schema for initiative:plan command
 *
 * Required: initiative
 * Optional: plan, create
 */
export const initiativePlanSchema = z.object({
  initiative: z.string().describe('Initiative ID to link plan to'),
  plan: z.string().optional().describe('Path to existing plan file (markdown)'),
  create: z.boolean().optional().describe('Create a new plan template instead of linking'),
});

export type InitiativePlanInput = z.infer<typeof initiativePlanSchema>;

// =============================================================================
// Initiative Schema Registry
// =============================================================================

/**
 * Registry of all initiative command schemas for validation and parity checking.
 * These complement the schemas in command-schemas.ts (WU-1431) and
 * wu-lifecycle-schemas.ts (WU-1454).
 */
export const initiativeCommandSchemas = {
  'initiative:create': initiativeCreateSchema,
  'initiative:edit': initiativeEditSchema,
  'initiative:list': initiativeListSchema,
  'initiative:status': initiativeStatusSchema,
  'initiative:add-wu': initiativeAddWuSchema,
  'initiative:remove-wu': initiativeRemoveWuSchema,
  'initiative:bulk-assign': initiativeBulkAssignSchema,
  'initiative:plan': initiativePlanSchema,
} as const;

export type InitiativeCommandName = keyof typeof initiativeCommandSchemas;
