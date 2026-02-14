/**
 * @file setup-schemas.ts
 * @description Shared Zod schemas for Setup, Agent, Orchestration, Delegation, and Coordination commands (WU-1457)
 *
 * These schemas are the single source of truth for command validation.
 * Both CLI argument parsing and MCP inputSchema derivation use these schemas.
 *
 * This file covers the 18 commands that were previously hand-coded
 * in MCP and CLI separately:
 * - 8 setup/lumenflow commands
 * - 4 agent commands
 * - 3 orchestration commands
 * - 1 delegation command
 * - 2 coordination commands
 *
 * Design decisions:
 * - Use snake_case for property names (MCP convention, JSON Schema friendly)
 * - Include descriptions for each field (used in both CLI help and MCP tool descriptions)
 * - CLI-only aliases are NOT defined here (handled in arg-validators)
 */

import { z } from 'zod';

// =============================================================================
// Setup / LumenFlow Commands
// =============================================================================

/**
 * Schema for lumenflow:init command
 *
 * No required fields
 * Optional: client, merge, full, minimal, framework
 */
export const lumenflowInitSchema = z.object({
  client: z
    .string()
    .optional()
    .describe('Client type (claude, cursor, windsurf, codex, all, none)'),
  merge: z.boolean().optional().describe('Merge into existing files using bounded markers'),
  full: z.boolean().optional().describe('Add docs + agent onboarding + task scaffolding'),
  minimal: z.boolean().optional().describe('Skip agent onboarding docs (only core files)'),
  framework: z.string().optional().describe('Add framework hint + overlay docs'),
});

export type LumenflowInitInput = z.infer<typeof lumenflowInitSchema>;

/**
 * Schema for lumenflow:doctor command
 *
 * No parameters
 */
export const lumenflowDoctorSchema = z.object({});

export type LumenflowDoctorInput = z.infer<typeof lumenflowDoctorSchema>;

/**
 * Schema for lumenflow:integrate command
 *
 * Required: client
 */
export const lumenflowIntegrateSchema = z.object({
  client: z.string().describe('Client name (claude-code, cursor, etc.)'),
});

export type LumenflowIntegrateInput = z.infer<typeof lumenflowIntegrateSchema>;

/**
 * Schema for lumenflow:upgrade command
 *
 * No parameters
 */
export const lumenflowUpgradeSchema = z.object({});

export type LumenflowUpgradeInput = z.infer<typeof lumenflowUpgradeSchema>;

/**
 * Schema for lumenflow:commands (lumenflow commands) command
 *
 * No parameters
 */
export const lumenflowCommandsSchema = z.object({});

export type LumenflowCommandsInput = z.infer<typeof lumenflowCommandsSchema>;

/**
 * Schema for docs:sync command
 *
 * No parameters
 */
export const docsSyncSchema = z.object({});

export type DocsSyncInput = z.infer<typeof docsSyncSchema>;

/**
 * Schema for release command
 *
 * No required fields
 * Optional: dry_run
 */
export const releaseSchema = z.object({
  dry_run: z.boolean().optional().describe('Preview release without publishing'),
});

export type ReleaseInput = z.infer<typeof releaseSchema>;

/**
 * Schema for sync:templates command
 *
 * No parameters
 */
export const syncTemplatesSchema = z.object({});

export type SyncTemplatesInput = z.infer<typeof syncTemplatesSchema>;

// =============================================================================
// Agent Commands
// =============================================================================

/**
 * Schema for agent:session command
 *
 * Required: wu, tier
 * Optional: agent_type
 */
export const agentSessionSchema = z.object({
  wu: z.string().describe('WU ID to work on (e.g., WU-1234)'),
  tier: z.number().min(1).max(3).describe('Context tier (1, 2, or 3)'),
  agent_type: z.string().optional().describe('Agent type (default: claude-code)'),
});

export type AgentSessionInput = z.infer<typeof agentSessionSchema>;

/**
 * Schema for agent:session:end command
 *
 * No parameters
 */
export const agentSessionEndSchema = z.object({});

export type AgentSessionEndInput = z.infer<typeof agentSessionEndSchema>;

/**
 * Schema for agent:log-issue command
 *
 * Required: category, severity, title, description
 * Optional: resolution, tags, step, files
 */
export const agentLogIssueSchema = z.object({
  category: z
    .enum(['workflow', 'tooling', 'confusion', 'violation', 'error'])
    .describe('Issue category'),
  severity: z.enum(['blocker', 'major', 'minor', 'info']).describe('Severity level'),
  title: z.string().describe('Short description (5-100 chars)'),
  description: z.string().describe('Detailed context (10-2000 chars)'),
  resolution: z.string().optional().describe('How the issue was resolved'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
  step: z.string().optional().describe('Current workflow step (e.g., wu:done, gates)'),
  files: z.array(z.string()).optional().describe('Related file paths'),
});

export type AgentLogIssueInput = z.infer<typeof agentLogIssueSchema>;

/**
 * Schema for agent:issues-query command
 *
 * No required fields
 * Optional: since, category, severity
 */
export const agentIssuesQuerySchema = z.object({
  since: z.number().optional().describe('Days to include (default: 7)'),
  category: z.string().optional().describe('Filter by category'),
  severity: z
    .enum(['blocker', 'major', 'minor', 'trivial'])
    .optional()
    .describe('Filter by severity'),
});

export type AgentIssuesQueryInput = z.infer<typeof agentIssuesQuerySchema>;

// =============================================================================
// Orchestration Commands
// =============================================================================

/**
 * Schema for orchestrate:initiative command
 *
 * Required: initiative
 * Optional: dry_run, progress, checkpoint_per_wave
 */
export const orchestrateInitiativeSchema = z.object({
  initiative: z.string().describe('Initiative ID to orchestrate (e.g., INIT-001)'),
  dry_run: z.boolean().optional().describe('Show execution plan without spawning agents'),
  progress: z.boolean().optional().describe('Show current progress only'),
  checkpoint_per_wave: z.boolean().optional().describe('Spawn next wave then exit (no polling)'),
});

export type OrchestrateInitiativeInput = z.infer<typeof orchestrateInitiativeSchema>;

/**
 * Schema for orchestrate:init-status command
 *
 * Required: initiative
 */
export const orchestrateInitStatusSchema = z.object({
  initiative: z.string().describe('Initiative ID or slug (e.g., INIT-001)'),
});

export type OrchestrateInitStatusInput = z.infer<typeof orchestrateInitStatusSchema>;

/**
 * Schema for orchestrate:monitor command
 *
 * No required fields
 * Optional: threshold, recover, dry_run, since, wu, signals_only
 */
export const orchestrateMonitorSchema = z.object({
  threshold: z.number().optional().describe('Stuck detection threshold in minutes (default: 30)'),
  recover: z.boolean().optional().describe('Run recovery actions for stuck spawns'),
  dry_run: z.boolean().optional().describe('Show what would be done without taking action'),
  since: z.string().optional().describe('Show signals since (e.g., 30m, 1h)'),
  wu: z.string().optional().describe('Filter by WU ID'),
  signals_only: z.boolean().optional().describe('Only show signals (skip spawn analysis)'),
});

export type OrchestrateMonitorInput = z.infer<typeof orchestrateMonitorSchema>;

// =============================================================================
// Delegation Commands
// =============================================================================

/**
 * Schema for delegation:list command
 *
 * No required fields
 * Optional: wu, initiative, json
 */
export const delegationListSchema = z.object({
  wu: z.string().optional().describe('WU ID to show delegations for (e.g., WU-1234)'),
  initiative: z
    .string()
    .optional()
    .describe('Initiative ID to show all delegations for (e.g., INIT-001)'),
  json: z.boolean().optional().describe('Output as JSON'),
});

export type DelegationListInput = z.infer<typeof delegationListSchema>;

// =============================================================================
// Coordination Commands
// =============================================================================

/**
 * Schema for session:coordinator command
 *
 * No required fields (subcommand is positional in CLI)
 * Optional: command, wu, agent, reason
 */
export const sessionCoordinatorSchema = z.object({
  command: z
    .enum(['start', 'stop', 'status', 'handoff'])
    .optional()
    .describe('Session subcommand (start, stop, status, handoff)'),
  wu: z.string().optional().describe('WU ID to work on'),
  agent: z.string().optional().describe('Agent name/type'),
  reason: z.string().optional().describe('Reason for stopping session'),
});

export type SessionCoordinatorInput = z.infer<typeof sessionCoordinatorSchema>;

/**
 * Schema for rotate:progress command
 *
 * No required fields
 * Optional: dry_run, limit
 */
export const rotateProgressSchema = z.object({
  dry_run: z.boolean().optional().describe('Show changes without writing'),
  limit: z.number().optional().describe('Maximum number of WUs to rotate'),
});

export type RotateProgressInput = z.infer<typeof rotateProgressSchema>;

// =============================================================================
// Setup Schema Registry
// =============================================================================

/**
 * Registry of all setup, agent, orchestration, delegation, and coordination command
 * schemas for validation and parity checking.
 * These complement the schemas in command-schemas.ts (WU-1431),
 * wu-lifecycle-schemas.ts (WU-1454), initiative-schemas.ts (WU-1455),
 * memory-schemas.ts (WU-1456), flow-schemas.ts (WU-1457),
 * and validation-schemas.ts (WU-1457).
 */
export const setupCommandSchemas = {
  // Setup commands
  'lumenflow:init': lumenflowInitSchema,
  'lumenflow:doctor': lumenflowDoctorSchema,
  'lumenflow:integrate': lumenflowIntegrateSchema,
  'lumenflow:upgrade': lumenflowUpgradeSchema,
  'lumenflow:commands': lumenflowCommandsSchema,
  'docs:sync': docsSyncSchema,
  release: releaseSchema,
  'sync:templates': syncTemplatesSchema,
  // Agent commands
  'agent:session': agentSessionSchema,
  'agent:session:end': agentSessionEndSchema,
  'agent:log-issue': agentLogIssueSchema,
  'agent:issues-query': agentIssuesQuerySchema,
  // Orchestration commands
  'orchestrate:initiative': orchestrateInitiativeSchema,
  'orchestrate:init-status': orchestrateInitStatusSchema,
  'orchestrate:monitor': orchestrateMonitorSchema,
  // Delegation commands
  'delegation:list': delegationListSchema,
  // Coordination commands
  'session:coordinator': sessionCoordinatorSchema,
  'rotate:progress': rotateProgressSchema,
} as const;

export type SetupCommandName = keyof typeof setupCommandSchemas;
