/**
 * @file validation-schemas.ts
 * @description Shared Zod schemas for Validation commands (WU-1457)
 *
 * These schemas are the single source of truth for validation command validation.
 * Both CLI argument parsing and MCP inputSchema derivation use these schemas.
 *
 * This file covers the 5 validation commands that were previously hand-coded
 * in MCP and CLI separately.
 *
 * Design decisions:
 * - Use snake_case for property names (MCP convention, JSON Schema friendly)
 * - Include descriptions for each field (used in both CLI help and MCP tool descriptions)
 * - CLI-only aliases are NOT defined here (handled in arg-validators)
 */

import { z } from 'zod';

// =============================================================================
// validate Schema
// =============================================================================

/**
 * Schema for validate command (WU YAML validation)
 *
 * No required fields
 * Optional: id, strict, done_only
 */
export const validateSchema = z.object({
  id: z.string().optional().describe('Specific WU ID to validate'),
  strict: z.boolean().optional().describe('Fail on warnings too'),
  done_only: z.boolean().optional().describe('Only validate done WUs'),
});

export type ValidateInput = z.infer<typeof validateSchema>;

// =============================================================================
// validate:agent-skills Schema
// =============================================================================

/**
 * Schema for validate:agent-skills command
 *
 * No required fields
 * Optional: skill
 */
export const validateAgentSkillsSchema = z.object({
  skill: z.string().optional().describe('Specific skill to validate (e.g., "wu-lifecycle")'),
});

export type ValidateAgentSkillsInput = z.infer<typeof validateAgentSkillsSchema>;

// =============================================================================
// validate:agent-sync Schema
// =============================================================================

/**
 * Schema for validate:agent-sync command
 *
 * No parameters
 */
export const validateAgentSyncSchema = z.object({});

export type ValidateAgentSyncInput = z.infer<typeof validateAgentSyncSchema>;

// =============================================================================
// validate:backlog-sync Schema
// =============================================================================

/**
 * Schema for validate:backlog-sync command
 *
 * No parameters
 */
export const validateBacklogSyncSchema = z.object({});

export type ValidateBacklogSyncInput = z.infer<typeof validateBacklogSyncSchema>;

// =============================================================================
// validate:skills-spec Schema
// =============================================================================

/**
 * Schema for validate:skills-spec command
 *
 * No parameters
 */
export const validateSkillsSpecSchema = z.object({});

export type ValidateSkillsSpecInput = z.infer<typeof validateSkillsSpecSchema>;

// =============================================================================
// Validation Schema Registry
// =============================================================================

/**
 * Registry of all validation command schemas for validation and parity checking.
 * These complement the schemas in command-schemas.ts (WU-1431),
 * wu-lifecycle-schemas.ts (WU-1454), initiative-schemas.ts (WU-1455),
 * memory-schemas.ts (WU-1456), and flow-schemas.ts (WU-1457).
 */
export const validationCommandSchemas = {
  validate: validateSchema,
  'validate:agent-skills': validateAgentSkillsSchema,
  'validate:agent-sync': validateAgentSyncSchema,
  'validate:backlog-sync': validateBacklogSyncSchema,
  'validate:skills-spec': validateSkillsSpecSchema,
} as const;

export type ValidationCommandName = keyof typeof validationCommandSchemas;
