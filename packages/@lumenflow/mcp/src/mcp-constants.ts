/**
 * @file mcp-constants.ts
 * @description Typed source-of-truth constants for MCP governed literal families.
 *
 * Governed families:
 * 1. CLI command names — canonical map of all commands dispatched via runCliCommand/executeViaPack
 * 2. Cross-boundary metadata keys — keys used in ExecutionContext.metadata across modules
 *
 * Scoping rule: CLI flags are governed in tools-shared.ts (CliArgs). Only flags
 * appearing in 3 or more tool definitions are centralized there. Tool-local flags
 * (< 3 uses) remain as local string literals.
 *
 * WU-1851: Initial governance module.
 */

// ============================================================================
// CLI Command Names
// ============================================================================

/**
 * Canonical CLI command name constants.
 *
 * Every string passed to `runCliCommand()`, `executeViaPack()`, or used in
 * `fallback.command` MUST reference a value from this object.
 *
 * Organized by domain to match tool file groupings.
 */
export const CliCommands = {
  // -- WU lifecycle (wu-tools.ts) --
  WU_STATUS: 'wu:status',
  WU_CREATE: 'wu:create',
  WU_CLAIM: 'wu:claim',
  WU_SANDBOX: 'wu:sandbox',
  WU_DONE: 'wu:done',
  WU_BLOCK: 'wu:block',
  WU_UNBLOCK: 'wu:unblock',
  WU_EDIT: 'wu:edit',
  WU_RELEASE: 'wu:release',
  WU_RECOVER: 'wu:recover',
  WU_REPAIR: 'wu:repair',
  WU_DEPS: 'wu:deps',
  WU_PREP: 'wu:prep',
  WU_PREFLIGHT: 'wu:preflight',
  WU_PRUNE: 'wu:prune',
  WU_DELETE: 'wu:delete',
  WU_CLEANUP: 'wu:cleanup',
  WU_BRIEF: 'wu:brief',
  WU_DELEGATE: 'wu:delegate',
  WU_VALIDATE: 'wu:validate',
  WU_INFER_LANE: 'wu:infer-lane',
  WU_UNLOCK_LANE: 'wu:unlock-lane',
  WU_PROTO: 'wu:proto',
  WU_LIST: 'wu:list',

  // -- Gates (wu-tools.ts, parity-tools.ts) --
  GATES: 'gates',

  // -- State (parity-tools.ts) --
  STATE_BOOTSTRAP: 'state:bootstrap',
  STATE_CLEANUP: 'state:cleanup',
  STATE_DOCTOR: 'state:doctor',

  // -- Parity (parity-tools.ts) --
  BACKLOG_PRUNE: 'backlog:prune',
  DOCS_SYNC: 'docs:sync',
  SYNC_TEMPLATES: 'sync:templates',
  LUMENFLOW: 'lumenflow',
  LANE_HEALTH: 'lane:health',
  LANE_SUGGEST: 'lane:suggest',
  SIGNAL_CLEANUP: 'signal:cleanup',
  CONFIG_SET: 'config:set',
  CONFIG_GET: 'config:get',

  // -- File operations (parity-tools.ts) --
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_EDIT: 'file:edit',
  FILE_DELETE: 'file:delete',

  // -- Git operations (parity-tools.ts) --
  GIT_STATUS: 'git:status',
  GIT_DIFF: 'git:diff',
  GIT_LOG: 'git:log',
  GIT_BRANCH: 'git:branch',

  // -- Plan operations (parity-tools.ts) --
  INIT_PLAN: 'init:plan',
  PLAN_CREATE: 'plan:create',
  PLAN_EDIT: 'plan:edit',
  PLAN_LINK: 'plan:link',
  PLAN_PROMOTE: 'plan:promote',

  // -- Setup (setup-tools.ts) --
  LUMENFLOW_DOCTOR: 'lumenflow:doctor',
  LUMENFLOW_INTEGRATE: 'lumenflow:integrate',
  LUMENFLOW_UPGRADE: 'lumenflow:upgrade',
  LUMENFLOW_RELEASE: 'lumenflow:release',

  // -- Validation (validation-tools.ts) --
  LUMENFLOW_VALIDATE: 'lumenflow:validate',
  VALIDATE: 'validate',
  VALIDATE_AGENT_SKILLS: 'validate:agent-skills',
  VALIDATE_AGENT_SYNC: 'validate:agent-sync',
  VALIDATE_BACKLOG_SYNC: 'validate:backlog-sync',
  VALIDATE_SKILLS_SPEC: 'validate:skills-spec',

  // -- Initiatives (initiative-tools.ts) --
  INITIATIVE_LIST: 'initiative:list',
  INITIATIVE_STATUS: 'initiative:status',
  INITIATIVE_CREATE: 'initiative:create',
  INITIATIVE_EDIT: 'initiative:edit',
  INITIATIVE_ADD_WU: 'initiative:add-wu',
  INITIATIVE_REMOVE_WU: 'initiative:remove-wu',
  INITIATIVE_BULK_ASSIGN: 'initiative:bulk-assign',
  INITIATIVE_PLAN: 'initiative:plan',

  // -- Orchestration (orchestration-tools.ts) --
  ORCHESTRATE_INITIATIVE: 'orchestrate:initiative',
  ORCHESTRATE_INIT_STATUS: 'orchestrate:init-status',
  ORCHESTRATE_MONITOR: 'orchestrate:monitor',
  DELEGATION_LIST: 'delegation:list',

  // -- Agent (agent-tools.ts) --
  AGENT_SESSION: 'agent:session',
  AGENT_SESSION_END: 'agent:session-end',
  AGENT_LOG_ISSUE: 'agent:log-issue',
  AGENT_ISSUES_QUERY: 'agent:issues-query',

  // -- Memory (memory-tools.ts) --
  MEM_INIT: 'mem:init',
  MEM_START: 'mem:start',
  MEM_READY: 'mem:ready',
  MEM_CHECKPOINT: 'mem:checkpoint',
  MEM_CLEANUP: 'mem:cleanup',
  MEM_CONTEXT: 'mem:context',
  MEM_CREATE: 'mem:create',
  MEM_DELETE: 'mem:delete',
  MEM_EXPORT: 'mem:export',
  MEM_INBOX: 'mem:inbox',
  MEM_SIGNAL: 'mem:signal',
  MEM_SUMMARIZE: 'mem:summarize',
  MEM_TRIAGE: 'mem:triage',
  MEM_RECOVER: 'mem:recover',

  // -- Context (context-tools.ts) --
  CONTEXT_GET: 'context:get',

  // -- Flow & Metrics (flow-tools.ts) --
  FLOW_BOTTLENECKS: 'flow:bottlenecks',
  FLOW_REPORT: 'flow:report',
  METRICS_SNAPSHOT: 'metrics:snapshot',
  LUMENFLOW_METRICS: 'lumenflow:metrics',
  METRICS: 'metrics',
} as const;

export type CliCommandName = (typeof CliCommands)[keyof typeof CliCommands];

// ============================================================================
// Cross-Boundary Metadata Keys
// ============================================================================

/**
 * Metadata key constants used in ExecutionContext.metadata across MCP modules.
 * These cross module boundaries and must be consistent.
 */
export const MetadataKeys = {
  PROJECT_ROOT: 'project_root',
  INVOCATION_MODE: 'invocation_mode',
} as const;

export type MetadataKey = (typeof MetadataKeys)[keyof typeof MetadataKeys];
