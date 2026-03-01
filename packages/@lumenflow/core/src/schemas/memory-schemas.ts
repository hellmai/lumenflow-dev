// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file memory-schemas.ts
 * @description Shared Zod schemas for Memory commands (WU-1456)
 *
 * These schemas are the single source of truth for memory command validation.
 * Both CLI argument parsing and MCP inputSchema derivation use these schemas.
 *
 * This file covers the 13 memory commands that were previously hand-coded
 * in MCP and CLI separately. Combined with the schemas from command-schemas.ts
 * (WU-1431), wu-lifecycle-schemas.ts (WU-1454), and initiative-schemas.ts
 * (WU-1455), this provides full shared schema coverage for all LumenFlow commands.
 *
 * Design decisions:
 * - Use snake_case for property names (MCP convention, JSON Schema friendly)
 * - Include descriptions for each field (used in both CLI help and MCP tool descriptions)
 * - CLI-only options (base_dir, quiet) are NOT included here (transport-specific)
 * - Schemas reflect the semantic parameters visible to both CLI and MCP consumers
 */

import { z } from 'zod';

// =============================================================================
// mem:init Schema
// =============================================================================

/**
 * Schema for mem:init command
 *
 * No required fields - initializes memory layer in current directory
 */
export const memInitSchema = z.object({
  wu: z.string().optional().describe('WU ID to initialize memory for'),
});

export type MemInitInput = z.infer<typeof memInitSchema>;

// =============================================================================
// mem:start Schema
// =============================================================================

/**
 * Schema for mem:start command
 *
 * Required: wu
 * Optional: lane, agent_type, context_tier
 */
export const memStartSchema = z.object({
  wu: z.string().describe('WU ID to start session for'),
  lane: z.string().optional().describe('Lane name'),
  agent_type: z
    .string()
    .optional()
    .describe('Agent type (e.g., general-purpose, explore, test-engineer)'),
  context_tier: z.string().optional().describe('Context tier (core, full, minimal)'),
});

export type MemStartInput = z.infer<typeof memStartSchema>;

// =============================================================================
// mem:ready Schema
// =============================================================================

/**
 * Schema for mem:ready command
 *
 * Required: wu
 * Optional: type, format
 */
export const memReadySchema = z.object({
  wu: z.string().describe('WU ID to check pending nodes for'),
  type: z.string().optional().describe('Filter by node type'),
  format: z.enum(['json', 'human']).optional().describe('Output format'),
});

export type MemReadyInput = z.infer<typeof memReadySchema>;

// =============================================================================
// mem:checkpoint Schema
// =============================================================================

/**
 * Schema for mem:checkpoint command
 *
 * Required: wu
 * Optional: message, session, progress, next_steps, trigger
 */
export const memCheckpointSchema = z.object({
  wu: z.string().describe('WU ID to checkpoint'),
  message: z.string().optional().describe('Checkpoint message'),
  session: z.string().optional().describe('Session ID to link checkpoint to (UUID)'),
  progress: z.string().optional().describe('Progress summary'),
  next_steps: z.string().optional().describe('Next steps description'),
  trigger: z.string().optional().describe('Handoff trigger type (e.g., clear, handoff)'),
});

export type MemCheckpointInput = z.infer<typeof memCheckpointSchema>;

// =============================================================================
// mem:cleanup Schema
// =============================================================================

/**
 * Schema for mem:cleanup command
 *
 * No required fields
 * Optional: dry_run, ttl, session_id
 */
export const memCleanupSchema = z.object({
  dry_run: z.boolean().optional().describe('Preview cleanup without making changes'),
  ttl: z.string().optional().describe('Remove nodes older than duration (e.g., 30d, 7d, 24h)'),
  session_id: z.string().optional().describe('Session ID to consider closed'),
});

export type MemCleanupInput = z.infer<typeof memCleanupSchema>;

// =============================================================================
// mem:context Schema
// =============================================================================

/**
 * Schema for mem:context command
 *
 * Required: wu
 * Optional: lane, max_size, max_recent_summaries, max_project_nodes, format
 */
export const memContextSchema = z.object({
  wu: z.string().describe('WU ID to get context for'),
  lane: z.string().optional().describe('Filter by lane'),
  max_size: z.number().optional().describe('Maximum context size in bytes'),
  max_recent_summaries: z.number().optional().describe('Maximum number of recent summaries'),
  max_project_nodes: z.number().optional().describe('Maximum number of project nodes'),
  format: z.enum(['json', 'human']).optional().describe('Output format'),
});

export type MemContextInput = z.infer<typeof memContextSchema>;

// =============================================================================
// mem:create Schema
// =============================================================================

/**
 * Schema for mem:create command
 *
 * Required: message
 * Optional: wu, type, tags, discovered_from, session, priority
 */
export const memCreateSchema = z.object({
  message: z.string().describe('Memory node message'),
  wu: z.string().optional().describe('WU ID to associate with'),
  type: z.string().optional().describe('Node type (e.g., discovery, session, checkpoint, note)'),
  tags: z.array(z.string()).optional().describe('Tags for the node'),
  discovered_from: z.string().optional().describe('Parent node ID for provenance tracking'),
  session: z.string().optional().describe('Session ID to link node to (UUID)'),
  priority: z.string().optional().describe('Priority level (P0, P1, P2, P3)'),
});

export type MemCreateInput = z.infer<typeof memCreateSchema>;

// =============================================================================
// mem:delete Schema
// =============================================================================

/**
 * Schema for mem:delete command
 *
 * Required: id
 * Optional: tag, older_than, dry_run
 */
export const memDeleteSchema = z.object({
  id: z.string().describe('Memory node ID to delete'),
  tag: z.string().optional().describe('Delete all nodes matching this tag'),
  older_than: z.string().optional().describe('Delete nodes older than duration (e.g., 30d)'),
  dry_run: z.boolean().optional().describe('Preview deletion without making changes'),
});

export type MemDeleteInput = z.infer<typeof memDeleteSchema>;

// =============================================================================
// mem:export Schema
// =============================================================================

/**
 * Schema for mem:export command
 *
 * Required: wu
 * Optional: format, type, lifecycle
 */
export const memExportSchema = z.object({
  wu: z.string().describe('WU ID to export'),
  format: z.enum(['markdown', 'json']).optional().describe('Export format'),
  type: z.string().optional().describe('Filter by node type'),
  lifecycle: z
    .string()
    .optional()
    .describe('Filter by lifecycle (ephemeral, session, wu, project)'),
});

export type MemExportInput = z.infer<typeof memExportSchema>;

// =============================================================================
// mem:inbox Schema
// =============================================================================

/**
 * Schema for mem:inbox command
 *
 * No required fields
 * Optional: since, wu, lane
 */
export const memInboxSchema = z.object({
  since: z.string().optional().describe('Time filter (e.g., "30m", "1h")'),
  wu: z.string().optional().describe('Filter by WU ID'),
  lane: z.string().optional().describe('Filter by lane'),
});

export type MemInboxInput = z.infer<typeof memInboxSchema>;

// =============================================================================
// mem:signal Schema
// =============================================================================

/**
 * Schema for mem:signal command
 *
 * Required: message, wu
 * Optional: type, sender, target_agent, origin, remote_id
 */
export const memSignalSchema = z.object({
  message: z.string().describe('Signal message'),
  wu: z.string().describe('WU ID to associate with'),
  type: z.string().optional().describe('Signal type (e.g., handoff, unblock, alert)'),
  sender: z.string().optional().describe('Sender identifier (agent/session)'),
  target_agent: z.string().optional().describe('Target agent identifier'),
  origin: z.string().optional().describe('Signal origin context (e.g., cli, mcp, remote)'),
  remote_id: z.string().optional().describe('Remote signal ID for cross-system correlation'),
});

export type MemSignalInput = z.infer<typeof memSignalSchema>;

// =============================================================================
// mem:summarize Schema
// =============================================================================

/**
 * Schema for mem:summarize command
 *
 * Required: wu
 * Optional: dry_run
 */
export const memSummarizeSchema = z.object({
  wu: z.string().describe('WU ID to summarize'),
  dry_run: z.boolean().optional().describe('Preview summary without making changes'),
});

export type MemSummarizeInput = z.infer<typeof memSummarizeSchema>;

// =============================================================================
// mem:triage Schema
// =============================================================================

/**
 * Schema for mem:triage command
 *
 * No required fields
 * Optional: wu, promote, lane, archive, reason
 */
export const memTriageSchema = z.object({
  wu: z.string().optional().describe('WU ID to triage discoveries for'),
  promote: z.string().optional().describe('Memory node ID to promote to Bug WU'),
  lane: z.string().optional().describe('Lane for promoted Bug WU'),
  archive: z.string().optional().describe('Memory node ID to archive'),
  reason: z.string().optional().describe('Reason for archiving'),
});

export type MemTriageInput = z.infer<typeof memTriageSchema>;

// =============================================================================
// Memory Schema Registry
// =============================================================================

/**
 * Registry of all memory command schemas for validation and parity checking.
 * These complement the schemas in command-schemas.ts (WU-1431),
 * wu-lifecycle-schemas.ts (WU-1454), and initiative-schemas.ts (WU-1455).
 */
export const memoryCommandSchemas = {
  'mem:init': memInitSchema,
  'mem:start': memStartSchema,
  'mem:ready': memReadySchema,
  'mem:checkpoint': memCheckpointSchema,
  'mem:cleanup': memCleanupSchema,
  'mem:context': memContextSchema,
  'mem:create': memCreateSchema,
  'mem:delete': memDeleteSchema,
  'mem:export': memExportSchema,
  'mem:inbox': memInboxSchema,
  'mem:signal': memSignalSchema,
  'mem:summarize': memSummarizeSchema,
  'mem:triage': memTriageSchema,
} as const;

export type MemoryCommandName = keyof typeof memoryCommandSchemas;
