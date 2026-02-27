// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file public-manifest.ts
 * Public CLI Manifest - Source of Truth for Public Commands (WU-1432)
 *
 * This file defines which CLI commands are part of the public API surface.
 * All public commands must be listed here. Commands not listed are considered
 * internal/maintainer-only and should not be published in package.json bin.
 *
 * The manifest is the single source of truth for:
 * - commands.ts (registry derives from this)
 * - package.json bin (should only include public commands)
 * - MCP parity metrics (INIT-MCP-FULL)
 */

/**
 * A public CLI command definition
 */
export type CommandSurface = 'primary' | 'alias' | 'legacy';
export type CommandAudience = 'general' | 'advanced' | 'maintainer';
export type CommandStatus = 'stable' | 'preview' | 'deprecated';

export interface PublicCommand {
  /** User-facing command name with colon notation (e.g., 'wu:create') */
  name: string;
  /** Binary name for package.json (e.g., 'wu-create') */
  binName: string;
  /** Path to the compiled JS file relative to dist/ */
  binPath: string;
  /** Brief description of what the command does */
  description: string;
  /** Category for grouping in docs/registry */
  category: string;
  /** Docs surface selection: primary command, alias, or legacy entrypoint */
  surface?: CommandSurface;
  /** Optional audience hint for curated docs */
  audience?: CommandAudience;
  /** Optional stability hint for curated docs */
  status?: CommandStatus;
}

/**
 * Command categories matching the structure in commands.ts
 */
export const COMMAND_CATEGORIES = {
  WU_LIFECYCLE: 'WU Lifecycle',
  WU_MAINTENANCE: 'WU Maintenance',
  GATES_QUALITY: 'Gates & Quality',
  MEMORY_SESSIONS: 'Memory & Sessions',
  INITIATIVES: 'Initiatives',
  PLANS: 'Plans',
  ORCHESTRATION: 'Orchestration',
  SETUP_DEVELOPMENT: 'Setup & Development',
  METRICS_FLOW: 'Metrics & Flow',
  STATE_MANAGEMENT: 'State Management',
  PACKS: 'Packs',
} as const;

const CANONICAL_BOOTSTRAP_COMMAND = 'npx lumenflow';
const LEGACY_COMMAND_PREFIX = 'Legacy entrypoint';
const LEGACY_ONBOARD_DESCRIPTION = `${LEGACY_COMMAND_PREFIX}; use "${CANONICAL_BOOTSTRAP_COMMAND}" for bootstrap-all onboarding`;
const LEGACY_WORKSPACE_INIT_DESCRIPTION = LEGACY_ONBOARD_DESCRIPTION;

/**
 * The public CLI manifest - all user-facing commands
 *
 * To add a new public command:
 * 1. Add it here with all required fields
 * 2. Run tests to verify alignment
 * 3. The bin entry will be validated against this manifest
 *
 * Internal commands (guards, validators, session internals, trace tools)
 * should NOT be added here - they remain internal only.
 */
export const PUBLIC_MANIFEST: PublicCommand[] = [
  // ============================================================================
  // WU Lifecycle - Core workflow commands
  // ============================================================================
  {
    name: 'wu:create',
    binName: 'wu-create',
    binPath: './dist/wu-create.js',
    description: 'Create new WU spec',
    category: COMMAND_CATEGORIES.WU_LIFECYCLE,
  },
  {
    name: 'wu:claim',
    binName: 'wu-claim',
    binPath: './dist/wu-claim.js',
    description: 'Claim WU and create worktree',
    category: COMMAND_CATEGORIES.WU_LIFECYCLE,
  },
  {
    name: 'wu:sandbox',
    binName: 'wu-sandbox',
    binPath: './dist/wu-sandbox.js',
    description: 'Run command through hardened WU sandbox backend',
    category: COMMAND_CATEGORIES.WU_LIFECYCLE,
  },
  {
    name: 'wu:prep',
    binName: 'wu-prep',
    binPath: './dist/wu-prep.js',
    description: 'Run gates in worktree, prep for wu:done',
    category: COMMAND_CATEGORIES.WU_LIFECYCLE,
  },
  {
    name: 'wu:done',
    binName: 'wu-done',
    binPath: './dist/wu-done.js',
    description: 'Complete WU (merge, stamp, cleanup) from main',
    category: COMMAND_CATEGORIES.WU_LIFECYCLE,
  },
  {
    name: 'wu:edit',
    binName: 'wu-edit',
    binPath: './dist/wu-edit.js',
    description: 'Edit WU spec fields',
    category: COMMAND_CATEGORIES.WU_LIFECYCLE,
  },
  {
    name: 'wu:block',
    binName: 'wu-block',
    binPath: './dist/wu-block.js',
    description: 'Block WU with reason',
    category: COMMAND_CATEGORIES.WU_LIFECYCLE,
  },
  {
    name: 'wu:unblock',
    binName: 'wu-unblock',
    binPath: './dist/wu-unblock.js',
    description: 'Unblock WU',
    category: COMMAND_CATEGORIES.WU_LIFECYCLE,
  },
  {
    name: 'wu:release',
    binName: 'wu-release',
    binPath: './dist/wu-release.js',
    description: 'Release orphaned WU (in_progress to ready)',
    category: COMMAND_CATEGORIES.WU_LIFECYCLE,
  },
  {
    name: 'wu:status',
    binName: 'wu-status',
    binPath: './dist/wu-status.js',
    description: 'Show WU status, location, valid commands',
    category: COMMAND_CATEGORIES.WU_LIFECYCLE,
  },
  {
    name: 'wu:brief',
    binName: 'wu-brief',
    binPath: './dist/wu-brief.js',
    description: 'Generate handoff prompt for sub-agent WU execution',
    category: COMMAND_CATEGORIES.WU_LIFECYCLE,
  },
  {
    name: 'wu:delegate',
    binName: 'wu-delegate',
    binPath: './dist/wu-delegate.js',
    description: 'Generate delegation prompt and record explicit lineage intent',
    category: COMMAND_CATEGORIES.WU_LIFECYCLE,
  },
  {
    name: 'wu:validate',
    binName: 'wu-validate',
    binPath: './dist/wu-validate.js',
    description: 'Validate WU spec',
    category: COMMAND_CATEGORIES.WU_LIFECYCLE,
  },
  {
    name: 'wu:recover',
    binName: 'wu-recover',
    binPath: './dist/wu-recover.js',
    description: 'Analyze and fix WU state inconsistencies',
    category: COMMAND_CATEGORIES.WU_LIFECYCLE,
  },
  {
    name: 'wu:escalate',
    binName: 'wu-escalate',
    binPath: './dist/wu-escalate.js',
    description: 'Show or resolve WU escalation status',
    category: COMMAND_CATEGORIES.WU_LIFECYCLE,
  },

  // ============================================================================
  // WU Maintenance - Less frequently used WU commands
  // ============================================================================
  {
    name: 'wu:preflight',
    binName: 'wu-preflight',
    binPath: './dist/wu-preflight.js',
    description: 'Pre-flight checks before wu:done',
    category: COMMAND_CATEGORIES.WU_MAINTENANCE,
  },
  {
    name: 'wu:repair',
    binName: 'wu-repair',
    binPath: './dist/wu-repair.js',
    description: 'Repair WU state issues',
    category: COMMAND_CATEGORIES.WU_MAINTENANCE,
  },
  {
    name: 'wu:prune',
    binName: 'wu-prune',
    binPath: './dist/wu-prune.js',
    description: 'Clean stale worktrees',
    category: COMMAND_CATEGORIES.WU_MAINTENANCE,
  },
  {
    name: 'wu:cleanup',
    binName: 'wu-cleanup',
    binPath: './dist/wu-cleanup.js',
    description: 'Cleanup after PR merge',
    category: COMMAND_CATEGORIES.WU_MAINTENANCE,
  },
  {
    name: 'wu:deps',
    binName: 'wu-deps',
    binPath: './dist/wu-deps.js',
    description: 'Show WU dependencies',
    category: COMMAND_CATEGORIES.WU_MAINTENANCE,
  },
  {
    name: 'wu:infer-lane',
    binName: 'wu-infer-lane',
    binPath: './dist/wu-infer-lane.js',
    description: 'Infer lane from code paths/description',
    category: COMMAND_CATEGORIES.WU_MAINTENANCE,
  },
  {
    name: 'wu:delete',
    binName: 'wu-delete',
    binPath: './dist/wu-delete.js',
    description: 'Delete WU spec and cleanup',
    category: COMMAND_CATEGORIES.WU_MAINTENANCE,
  },
  {
    name: 'wu:unlock-lane',
    binName: 'wu-unlock-lane',
    binPath: './dist/wu-unlock-lane.js',
    description: 'Unlock stuck lane',
    category: COMMAND_CATEGORIES.WU_MAINTENANCE,
  },
  {
    name: 'wu:proto',
    binName: 'wu-proto',
    binPath: './dist/wu-proto.js',
    description: 'Create WU prototype',
    category: COMMAND_CATEGORIES.WU_MAINTENANCE,
  },

  // ============================================================================
  // Gates & Quality
  // ============================================================================
  {
    name: 'gates',
    binName: 'gates',
    binPath: './dist/gates.js',
    description: 'Run all quality gates',
    category: COMMAND_CATEGORIES.GATES_QUALITY,
  },
  {
    name: 'gates:docs',
    binName: 'gates',
    binPath: './dist/gates.js',
    description: 'Run docs-only quality gates (alias)',
    category: COMMAND_CATEGORIES.GATES_QUALITY,
    surface: 'alias',
  },
  {
    name: 'lumenflow-gates',
    binName: 'lumenflow-gates',
    binPath: './dist/gates.js',
    description: 'Run all quality gates (alias)',
    category: COMMAND_CATEGORIES.GATES_QUALITY,
    surface: 'alias',
  },
  {
    name: 'validate',
    binName: 'validate',
    binPath: './dist/validate.js',
    description: 'Run validation checks',
    category: COMMAND_CATEGORIES.GATES_QUALITY,
  },
  {
    name: 'lumenflow-validate',
    binName: 'lumenflow-validate',
    binPath: './dist/validate.js',
    description: 'Run validation checks (alias)',
    category: COMMAND_CATEGORIES.GATES_QUALITY,
    surface: 'alias',
  },
  {
    name: 'lane:edit',
    binName: 'lane-edit',
    binPath: './dist/lane-edit.js',
    description: 'Edit a lane definition (rename, wip-limit, paths, description)',
    category: COMMAND_CATEGORIES.GATES_QUALITY,
  },
  {
    name: 'lane:health',
    binName: 'lane-health',
    binPath: './dist/lane-health.js',
    description: 'Check lane config health',
    category: COMMAND_CATEGORIES.GATES_QUALITY,
  },
  {
    name: 'lane:suggest',
    binName: 'lane-suggest',
    binPath: './dist/lane-suggest.js',
    description: 'Suggest lane for code paths',
    category: COMMAND_CATEGORIES.GATES_QUALITY,
  },
  {
    name: 'lane:status',
    binName: 'lane-status',
    binPath: './dist/lane-status.js',
    description: 'Show lane lifecycle status and next step',
    category: COMMAND_CATEGORIES.GATES_QUALITY,
  },
  {
    name: 'lane:setup',
    binName: 'lane-setup',
    binPath: './dist/lane-setup.js',
    description: 'Create/update draft lane artifacts',
    category: COMMAND_CATEGORIES.GATES_QUALITY,
  },
  {
    name: 'lane:validate',
    binName: 'lane-validate',
    binPath: './dist/lane-validate.js',
    description: 'Validate lane artifacts before lock',
    category: COMMAND_CATEGORIES.GATES_QUALITY,
  },
  {
    name: 'lane:lock',
    binName: 'lane-lock',
    binPath: './dist/lane-lock.js',
    description: 'Lock lane lifecycle for delivery WUs',
    category: COMMAND_CATEGORIES.GATES_QUALITY,
  },

  // ============================================================================
  // Memory & Sessions
  // ============================================================================
  {
    name: 'mem:init',
    binName: 'mem-init',
    binPath: './dist/mem-init.js',
    description: 'Initialize memory for WU',
    category: COMMAND_CATEGORIES.MEMORY_SESSIONS,
  },
  {
    name: 'mem:checkpoint',
    binName: 'mem-checkpoint',
    binPath: './dist/mem-checkpoint.js',
    description: 'Save progress checkpoint',
    category: COMMAND_CATEGORIES.MEMORY_SESSIONS,
  },
  {
    name: 'mem:start',
    binName: 'mem-start',
    binPath: './dist/mem-start.js',
    description: 'Start a memory session',
    category: COMMAND_CATEGORIES.MEMORY_SESSIONS,
  },
  {
    name: 'mem:ready',
    binName: 'mem-ready',
    binPath: './dist/mem-ready.js',
    description: 'Check pending memory nodes',
    category: COMMAND_CATEGORIES.MEMORY_SESSIONS,
  },
  {
    name: 'mem:export',
    binName: 'mem-export',
    binPath: './dist/mem-export.js',
    description: 'Export memory as markdown',
    category: COMMAND_CATEGORIES.MEMORY_SESSIONS,
  },
  {
    name: 'mem:signal',
    binName: 'mem-signal',
    binPath: './dist/mem-signal.js',
    description: 'Broadcast coordination signal',
    category: COMMAND_CATEGORIES.MEMORY_SESSIONS,
  },
  {
    name: 'mem:cleanup',
    binName: 'mem-cleanup',
    binPath: './dist/mem-cleanup.js',
    description: 'Clean up stale memory data',
    category: COMMAND_CATEGORIES.MEMORY_SESSIONS,
  },
  {
    name: 'mem:context',
    binName: 'mem-context',
    binPath: './dist/mem-context.js',
    description: 'Get context for current lane/WU',
    category: COMMAND_CATEGORIES.MEMORY_SESSIONS,
  },
  {
    name: 'mem:create',
    binName: 'mem-create',
    binPath: './dist/mem-create.js',
    description: 'Create memory node (bug discovery)',
    category: COMMAND_CATEGORIES.MEMORY_SESSIONS,
  },
  {
    name: 'mem:inbox',
    binName: 'mem-inbox',
    binPath: './dist/mem-inbox.js',
    description: 'Check coordination signals',
    category: COMMAND_CATEGORIES.MEMORY_SESSIONS,
  },
  {
    name: 'mem:summarize',
    binName: 'mem-summarize',
    binPath: './dist/mem-summarize.js',
    description: 'Summarize memory context',
    category: COMMAND_CATEGORIES.MEMORY_SESSIONS,
  },
  {
    name: 'mem:triage',
    binName: 'mem-triage',
    binPath: './dist/mem-triage.js',
    description: 'Triage discovered bugs',
    category: COMMAND_CATEGORIES.MEMORY_SESSIONS,
  },
  {
    name: 'mem:delete',
    binName: 'mem-delete',
    binPath: './dist/mem-delete.js',
    description: 'Delete/archive a memory node',
    category: COMMAND_CATEGORIES.MEMORY_SESSIONS,
  },
  {
    name: 'mem:recover',
    binName: 'mem-recover',
    binPath: './dist/mem-recover.js',
    description: 'Generate recovery context after compaction',
    category: COMMAND_CATEGORIES.MEMORY_SESSIONS,
  },
  {
    name: 'signal:cleanup',
    binName: 'signal-cleanup',
    binPath: './dist/signal-cleanup.js',
    description: 'Clean up stale signals',
    category: COMMAND_CATEGORIES.MEMORY_SESSIONS,
  },

  // ============================================================================
  // Initiatives
  // ============================================================================
  {
    name: 'initiative:create',
    binName: 'initiative-create',
    binPath: './dist/initiative-create.js',
    description: 'Create new initiative',
    category: COMMAND_CATEGORIES.INITIATIVES,
  },
  {
    name: 'initiative:edit',
    binName: 'initiative-edit',
    binPath: './dist/initiative-edit.js',
    description: 'Edit initiative fields and phase metadata',
    category: COMMAND_CATEGORIES.INITIATIVES,
  },
  {
    name: 'initiative:list',
    binName: 'initiative-list',
    binPath: './dist/initiative-list.js',
    description: 'List all initiatives',
    category: COMMAND_CATEGORIES.INITIATIVES,
  },
  {
    name: 'initiative:status',
    binName: 'initiative-status',
    binPath: './dist/initiative-status.js',
    description: 'Show initiative status',
    category: COMMAND_CATEGORIES.INITIATIVES,
  },
  {
    name: 'initiative:add-wu',
    binName: 'initiative-add-wu',
    binPath: './dist/initiative-add-wu.js',
    description: 'Add WU to initiative',
    category: COMMAND_CATEGORIES.INITIATIVES,
  },
  {
    name: 'initiative:remove-wu',
    binName: 'initiative-remove-wu',
    binPath: './dist/initiative-remove-wu.js',
    description: 'Remove WU from initiative',
    category: COMMAND_CATEGORIES.INITIATIVES,
  },
  {
    name: 'initiative:plan',
    binName: 'initiative-plan',
    binPath: './dist/initiative-plan.js',
    description: 'Link plan to initiative',
    category: COMMAND_CATEGORIES.INITIATIVES,
  },
  {
    name: 'initiative:bulk-assign',
    binName: 'initiative-bulk-assign-wus',
    binPath: './dist/initiative-bulk-assign-wus.js',
    description: 'Bulk assign WUs to initiative',
    category: COMMAND_CATEGORIES.INITIATIVES,
  },

  // ============================================================================
  // Plans
  // ============================================================================
  {
    name: 'plan:create',
    binName: 'plan-create',
    binPath: './dist/plan-create.js',
    description: 'Create a new plan',
    category: COMMAND_CATEGORIES.PLANS,
  },
  {
    name: 'plan:link',
    binName: 'plan-link',
    binPath: './dist/plan-link.js',
    description: 'Link plan to WU or initiative',
    category: COMMAND_CATEGORIES.PLANS,
  },
  {
    name: 'plan:edit',
    binName: 'plan-edit',
    binPath: './dist/plan-edit.js',
    description: 'Edit plan content',
    category: COMMAND_CATEGORIES.PLANS,
  },
  {
    name: 'plan:promote',
    binName: 'plan-promote',
    binPath: './dist/plan-promote.js',
    description: 'Promote plan to WU',
    category: COMMAND_CATEGORIES.PLANS,
  },
  {
    name: 'init:plan',
    binName: 'init-plan',
    binPath: './dist/initiative-plan.js',
    description: 'Link plan to initiative (alias)',
    category: COMMAND_CATEGORIES.PLANS,
    surface: 'alias',
  },

  // ============================================================================
  // Orchestration
  // ============================================================================
  {
    name: 'orchestrate:initiative',
    binName: 'orchestrate-initiative',
    binPath: './dist/orchestrate-initiative.js',
    description: 'Orchestrate initiative execution',
    category: COMMAND_CATEGORIES.ORCHESTRATION,
  },
  {
    name: 'orchestrate:init-status',
    binName: 'orchestrate-init-status',
    binPath: './dist/orchestrate-init-status.js',
    description: 'Compact initiative progress view',
    category: COMMAND_CATEGORIES.ORCHESTRATION,
  },
  {
    name: 'orchestrate:monitor',
    binName: 'orchestrate-monitor',
    binPath: './dist/orchestrate-monitor.js',
    description: 'Monitor spawn/agent activity',
    category: COMMAND_CATEGORIES.ORCHESTRATION,
  },
  {
    name: 'delegation:list',
    binName: 'delegation-list',
    binPath: './dist/delegation-list.js',
    description: 'List active delegation records',
    category: COMMAND_CATEGORIES.ORCHESTRATION,
  },
  {
    name: 'task:claim',
    binName: 'task-claim',
    binPath: './dist/task-claim.js',
    description: 'Claim a task directly through KernelRuntime',
    category: COMMAND_CATEGORIES.ORCHESTRATION,
  },
  {
    name: 'agent:session',
    binName: 'agent-session',
    binPath: './dist/agent-session.js',
    description: 'Start agent session',
    category: COMMAND_CATEGORIES.ORCHESTRATION,
  },
  {
    name: 'agent:session-end',
    binName: 'agent-session-end',
    binPath: './dist/agent-session-end.js',
    description: 'End agent session',
    category: COMMAND_CATEGORIES.ORCHESTRATION,
  },
  {
    name: 'agent:log-issue',
    binName: 'agent-log-issue',
    binPath: './dist/agent-log-issue.js',
    description: 'Log issue during agent session',
    category: COMMAND_CATEGORIES.ORCHESTRATION,
  },
  {
    name: 'agent:issues-query',
    binName: 'agent-issues-query',
    binPath: './dist/agent-issues-query.js',
    description: 'Query GitHub issues for agent work',
    category: COMMAND_CATEGORIES.ORCHESTRATION,
  },

  // ============================================================================
  // Setup & Development
  // ============================================================================
  {
    name: 'lumenflow',
    binName: 'lumenflow',
    binPath: './dist/init.js',
    description: 'Initialize LumenFlow in a project',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
  },
  {
    name: 'lumenflow-init',
    binName: 'lumenflow-init',
    binPath: './dist/init.js',
    description: 'Initialize LumenFlow in a project (alias)',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
    surface: 'alias',
  },
  {
    name: 'lumenflow:init',
    binName: 'lumenflow-init',
    binPath: './dist/init.js',
    description: 'Initialize LumenFlow in a project (alias)',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
    surface: 'alias',
  },
  {
    name: 'lumenflow:doctor',
    binName: 'lumenflow-doctor',
    binPath: './dist/doctor.js',
    description: 'Diagnose LumenFlow configuration',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
  },
  {
    name: 'lumenflow:commands',
    binName: 'lumenflow-commands',
    binPath: './dist/commands.js',
    description: 'List all available CLI commands',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
  },
  {
    name: 'lumenflow:release',
    binName: 'lumenflow-release',
    binPath: './dist/release.js',
    description: 'Run release workflow',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
  },
  {
    name: 'lumenflow:docs-sync',
    binName: 'lumenflow-docs-sync',
    binPath: './dist/docs-sync.js',
    description: 'Sync agent docs (for upgrades)',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
  },
  {
    name: 'docs:sync',
    binName: 'lumenflow-docs-sync',
    binPath: './dist/docs-sync.js',
    description: 'Sync agent docs (for upgrades) (alias)',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
    surface: 'alias',
  },
  {
    name: 'lumenflow:sync-templates',
    binName: 'lumenflow-sync-templates',
    binPath: './dist/sync-templates.js',
    description: 'Sync templates to project',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
  },
  {
    name: 'sync:templates',
    binName: 'sync-templates',
    binPath: './dist/sync-templates.js',
    description: 'Sync templates to project (alias)',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
    surface: 'alias',
  },
  {
    name: 'templates:sync',
    binName: 'templates-sync',
    binPath: './dist/sync-templates.js',
    description: 'Sync templates to project (alias)',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
    surface: 'alias',
  },
  {
    name: 'lumenflow:upgrade',
    binName: 'lumenflow-upgrade',
    binPath: './dist/lumenflow-upgrade.js',
    description: 'Upgrade LumenFlow packages',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
  },
  {
    name: 'lumenflow:integrate',
    binName: 'lumenflow-integrate',
    binPath: './dist/commands/integrate.js',
    description: 'Generate enforcement hooks for client',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
  },
  {
    name: 'backlog:prune',
    binName: 'backlog-prune',
    binPath: './dist/backlog-prune.js',
    description: 'Clean stale backlog entries',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
  },
  {
    name: 'config:set',
    binName: 'config-set',
    binPath: './dist/config-set.js',
    description: 'Safely update workspace.yaml software_delivery via micro-worktree',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
  },
  {
    name: 'config:get',
    binName: 'config-get',
    binPath: './dist/config-get.js',
    description: 'Read and display a value from workspace.yaml software_delivery',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
  },
  {
    name: 'cloud:connect',
    binName: 'cloud-connect',
    binPath: './dist/init.js',
    description: 'Connect workspace.yaml to cloud control plane',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
  },
  {
    name: 'onboard',
    binName: 'onboard',
    binPath: './dist/onboard.js',
    description: LEGACY_ONBOARD_DESCRIPTION,
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
    surface: 'legacy',
    status: 'deprecated',
  },
  {
    name: 'lumenflow-onboard',
    binName: 'lumenflow-onboard',
    binPath: './dist/onboard.js',
    description: LEGACY_ONBOARD_DESCRIPTION,
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
    surface: 'legacy',
    status: 'deprecated',
  },
  {
    name: 'workspace:init',
    binName: 'workspace-init',
    binPath: './dist/workspace-init.js',
    description: LEGACY_WORKSPACE_INIT_DESCRIPTION,
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
    surface: 'legacy',
    status: 'deprecated',
  },

  // ============================================================================
  // Metrics & Flow
  // ============================================================================
  {
    name: 'flow:report',
    binName: 'flow-report',
    binPath: './dist/flow-report.js',
    description: 'Generate flow metrics report',
    category: COMMAND_CATEGORIES.METRICS_FLOW,
  },
  {
    name: 'flow:bottlenecks',
    binName: 'flow-bottlenecks',
    binPath: './dist/flow-bottlenecks.js',
    description: 'Identify flow bottlenecks',
    category: COMMAND_CATEGORIES.METRICS_FLOW,
  },
  {
    name: 'metrics:snapshot',
    binName: 'metrics-snapshot',
    binPath: './dist/metrics-snapshot.js',
    description: 'Capture metrics snapshot',
    category: COMMAND_CATEGORIES.METRICS_FLOW,
  },
  {
    name: 'metrics',
    binName: 'metrics',
    binPath: './dist/metrics-cli.js',
    description: 'View workflow metrics',
    category: COMMAND_CATEGORIES.METRICS_FLOW,
  },
  {
    name: 'lumenflow:metrics',
    binName: 'lumenflow-metrics',
    binPath: './dist/metrics-cli.js',
    description: 'View workflow metrics (alias)',
    category: COMMAND_CATEGORIES.METRICS_FLOW,
    surface: 'alias',
  },

  // ============================================================================
  // State Management
  // ============================================================================
  {
    name: 'state:doctor',
    binName: 'state-doctor',
    binPath: './dist/state-doctor.js',
    description: 'Diagnose state store issues',
    category: COMMAND_CATEGORIES.STATE_MANAGEMENT,
  },
  {
    name: 'state:cleanup',
    binName: 'state-cleanup',
    binPath: './dist/state-cleanup.js',
    description: 'Clean up stale state data',
    category: COMMAND_CATEGORIES.STATE_MANAGEMENT,
  },
  {
    name: 'state:bootstrap',
    binName: 'state-bootstrap',
    binPath: './dist/state-bootstrap.js',
    description: 'Bootstrap state store',
    category: COMMAND_CATEGORIES.STATE_MANAGEMENT,
  },

  // ============================================================================
  // File Operations (for agent-audited file access)
  // ============================================================================
  {
    name: 'file:read',
    binName: 'file-read',
    binPath: './dist/file-read.js',
    description: 'Read file with audit trail',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
  },
  {
    name: 'file:write',
    binName: 'file-write',
    binPath: './dist/file-write.js',
    description: 'Write file with audit trail',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
  },
  {
    name: 'file:edit',
    binName: 'file-edit',
    binPath: './dist/file-edit.js',
    description: 'Edit file with audit trail',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
  },
  {
    name: 'file:delete',
    binName: 'file-delete',
    binPath: './dist/file-delete.js',
    description: 'Delete file with audit trail',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
  },

  // ============================================================================
  // Git Operations (for agent-audited git access)
  // ============================================================================
  {
    name: 'git:status',
    binName: 'git-status',
    binPath: './dist/git-status.js',
    description: 'Show git status with audit trail',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
  },
  {
    name: 'git:diff',
    binName: 'git-diff',
    binPath: './dist/git-diff.js',
    description: 'Show git diff with audit trail',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
  },
  {
    name: 'git:log',
    binName: 'git-log',
    binPath: './dist/git-log.js',
    description: 'Show git log with audit trail',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
  },
  {
    name: 'git:branch',
    binName: 'git-branch',
    binPath: './dist/git-branch.js',
    description: 'Show git branch with audit trail',
    category: COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
  },

  // ============================================================================
  // Packs - Pack authoring and management
  // ============================================================================
  {
    name: 'pack:author',
    binName: 'pack-author',
    binPath: './dist/pack-author.js',
    description: 'Author a secure domain pack from templates',
    category: COMMAND_CATEGORIES.PACKS,
  },
  {
    name: 'pack:scaffold',
    binName: 'pack-scaffold',
    binPath: './dist/pack-scaffold.js',
    description: 'Scaffold a new domain pack',
    category: COMMAND_CATEGORIES.PACKS,
  },
  {
    name: 'pack:validate',
    binName: 'pack-validate',
    binPath: './dist/pack-validate.js',
    description: 'Validate a domain pack for integrity',
    category: COMMAND_CATEGORIES.PACKS,
  },
  {
    name: 'pack:hash',
    binName: 'pack-hash',
    binPath: './dist/pack-hash.js',
    description: 'Compute integrity hash for a domain pack',
    category: COMMAND_CATEGORIES.PACKS,
  },
  {
    name: 'pack:publish',
    binName: 'pack-publish',
    binPath: './dist/pack-publish.js',
    description: 'Publish a domain pack to a registry',
    category: COMMAND_CATEGORIES.PACKS,
  },
  {
    name: 'pack:install',
    binName: 'pack-install',
    binPath: './dist/pack-install.js',
    description: 'Install a domain pack into workspace',
    category: COMMAND_CATEGORIES.PACKS,
  },
  {
    name: 'pack:search',
    binName: 'pack-search',
    binPath: './dist/pack-search.js',
    description: 'Search for domain packs in a registry',
    category: COMMAND_CATEGORIES.PACKS,
  },
];

// ============================================================================
// Internal commands NOT in manifest (documented for clarity)
// ============================================================================
// These commands are used internally by hooks, validators, or are maintainer-only:
//
// - guard-worktree-commit: Pre-commit hook enforcement
// - guard-locked: Pre-push lock enforcement
// - guard-main-branch: Main branch protection
// - deps-add: Maintainer-only wrapper for pnpm add (worktree enforcement)
// - deps-remove: Maintainer-only wrapper for pnpm remove (worktree enforcement)
// - validate-agent-skills: Internal skill validation
// - validate-agent-sync: Internal agent sync validation
// - validate-backlog-sync: Internal backlog sync validation
// - validate-skills-spec: Internal skills spec validation
// - session-coordinator: Internal session management
// - rotate-progress: Internal progress file rotation
// - trace-gen: Internal tracing/debugging tool
// ============================================================================

const DEFAULT_COMMAND_SURFACE: CommandSurface = 'primary';
const DEFAULT_COMMAND_AUDIENCE: CommandAudience = 'general';
const DEFAULT_COMMAND_STATUS: CommandStatus = 'stable';

export interface ResolvedPublicCommand extends PublicCommand {
  surface: CommandSurface;
  audience: CommandAudience;
  status: CommandStatus;
}

export function resolvePublicCommandMetadata(command: PublicCommand): ResolvedPublicCommand {
  return {
    ...command,
    surface: command.surface ?? DEFAULT_COMMAND_SURFACE,
    audience: command.audience ?? DEFAULT_COMMAND_AUDIENCE,
    status: command.status ?? DEFAULT_COMMAND_STATUS,
  };
}

export function getDocsVisibleManifest(options?: {
  includeAliases?: boolean;
  includeLegacy?: boolean;
}): ResolvedPublicCommand[] {
  const includeAliases = options?.includeAliases ?? false;
  const includeLegacy = options?.includeLegacy ?? false;

  return PUBLIC_MANIFEST.map(resolvePublicCommandMetadata).filter((command) => {
    if (command.surface === 'primary') {
      return true;
    }
    if (command.surface === 'alias') {
      return includeAliases;
    }
    if (command.surface === 'legacy') {
      return includeLegacy;
    }
    return false;
  });
}

/**
 * Get the full public manifest
 */
export function getPublicManifest(): PublicCommand[] {
  return PUBLIC_MANIFEST;
}

/**
 * Get all public command names (user-facing names with colons)
 */
export function getPublicCommandNames(): string[] {
  return PUBLIC_MANIFEST.map((cmd) => cmd.name);
}

/**
 * Get all public bin names (hyphenated names for package.json)
 */
export function getPublicBinNames(): string[] {
  return PUBLIC_MANIFEST.map((cmd) => cmd.binName);
}

/**
 * Check if a command name is public
 * @param name - User-facing command name (e.g., 'wu:create') or bin name (e.g., 'wu-create')
 */
export function isPublicCommand(name: string): boolean {
  return PUBLIC_MANIFEST.some((cmd) => cmd.name === name || cmd.binName === name);
}

/**
 * Get commands grouped by category
 */
export function getCommandsByCategory(): Map<string, PublicCommand[]> {
  const byCategory = new Map<string, PublicCommand[]>();

  for (const cmd of PUBLIC_MANIFEST) {
    const existing = byCategory.get(cmd.category) || [];
    existing.push(cmd);
    byCategory.set(cmd.category, existing);
  }

  return byCategory;
}

/**
 * Generate the bin entries for package.json from the manifest
 */
export function generatePackageJsonBin(): Record<string, string> {
  const bin: Record<string, string> = {};
  for (const cmd of PUBLIC_MANIFEST) {
    bin[cmd.binName] = cmd.binPath;
  }
  return bin;
}
