/**
 * WU Status Constants
 *
 * WU-1549: Extracted from wu-constants.ts for domain-specific modularity.
 * Contains WU status values, groups, exposure types, claimed modes, and incident severity.
 *
 * @module wu-statuses
 */

/**
 * WU status values
 *
 * Centralized status strings to avoid magic strings in wu-* scripts.
 * Includes both canonical statuses and legacy variants found in YAML files.
 */
export const WU_STATUS = {
  // Unclaimed statuses (not yet entered state machine)
  // WU-1374: Legacy backlog status value
  TODO: 'todo',
  READY: 'ready', // Canonical unclaimed status
  BACKLOG: 'backlog', // Legacy variant of ready

  // Active statuses (in state machine)
  IN_PROGRESS: 'in_progress',
  BLOCKED: 'blocked',

  // Terminal statuses (work finished, no further transitions)
  DONE: 'done', // Canonical terminal status
  COMPLETED: 'completed', // Legacy variant of done
  CANCELLED: 'cancelled',
  ABANDONED: 'abandoned',
  DEFERRED: 'deferred',
  CLOSED: 'closed',
  SUPERSEDED: 'superseded',
};

export type WUStatus = (typeof WU_STATUS)[keyof typeof WU_STATUS];

/**
 * Display-only fallback labels for non-canonical status values.
 */
export const WU_STATUS_FALLBACK = {
  UNKNOWN: 'unknown',
} as const;

export type WUStatusDisplay = WUStatus | (typeof WU_STATUS_FALLBACK)[keyof typeof WU_STATUS_FALLBACK];

const WU_STATUS_SET = new Set<string>(Object.values(WU_STATUS));

/**
 * Type guard for canonical WU statuses.
 */
export function isWUStatus(value: unknown): value is WUStatus {
  return typeof value === 'string' && WU_STATUS_SET.has(value);
}

/**
 * Resolve arbitrary status values to canonical WU statuses.
 */
export function resolveWUStatus(value: unknown, fallback: WUStatus = WU_STATUS.READY): WUStatus {
  return isWUStatus(value) ? value : fallback;
}

/**
 * Resolve status values for logs/UI where unknown is an allowed display state.
 */
export function getWUStatusDisplay(value: unknown): WUStatusDisplay {
  return isWUStatus(value) ? value : WU_STATUS_FALLBACK.UNKNOWN;
}

/**
 * WU-1540: Protected WU statuses for cleanup and signal protection.
 *
 * WUs in these statuses should NOT have their signals, memory, or state
 * cleaned up. Both in_progress and blocked WUs need protection because
 * blocked WUs will resume work after the blocker is resolved.
 *
 * Used by: wu-done-auto-cleanup.ts, signal-cleanup.ts, state-cleanup.ts
 */
export const PROTECTED_WU_STATUSES: readonly string[] = [
  WU_STATUS.IN_PROGRESS,
  WU_STATUS.BLOCKED,
] as const;

/**
 * WU-1540: Progressable WU statuses for initiative advancement.
 *
 * Only WUs in these statuses indicate active work that should trigger
 * initiative status progression (e.g., draft -> in_progress).
 * Blocked WUs are explicitly excluded because a blocked WU does not
 * represent forward progress on the initiative.
 *
 * Used by: initiative-validation.ts (shouldProgressInitiativeStatus)
 */
export const PROGRESSABLE_WU_STATUSES: readonly string[] = [WU_STATUS.IN_PROGRESS] as const;

/**
 * WU status groups for state management (WU-1742)
 *
 * Used by state-bootstrap.ts to categorize YAML statuses.
 */
export const WU_STATUS_GROUPS = {
  /** Statuses representing unclaimed work (not tracked in state store) */
  UNCLAIMED: [WU_STATUS.READY, WU_STATUS.TODO, WU_STATUS.BACKLOG],

  /** Terminal statuses (all map to 'done' in state store) */
  TERMINAL: [
    WU_STATUS.DONE,
    WU_STATUS.COMPLETED,
    WU_STATUS.CANCELLED,
    WU_STATUS.ABANDONED,
    WU_STATUS.DEFERRED,
    WU_STATUS.CLOSED,
    WU_STATUS.SUPERSEDED,
  ],
};

/**
 * WU claimed workspace modes
 *
 * Centralized workspace mode strings for wu:claim operations.
 */
export const CLAIMED_MODES = {
  /** Standard worktree mode (isolated worktree per WU) */
  WORKTREE: 'worktree',

  /** Branch-only mode (no worktree, direct branch work) */
  BRANCH_ONLY: 'branch-only',

  /** Worktree PR mode (worktree with manual PR workflow) */
  WORKTREE_PR: 'worktree-pr',

  /** Branch PR mode (no worktree, PR-based completion for cloud agents) */
  BRANCH_PR: 'branch-pr',
};

/**
 * Agent incident severity levels
 *
 * Centralized severity strings for agent incident reporting.
 */
export const INCIDENT_SEVERITY = {
  BLOCKER: 'blocker',
  MAJOR: 'major',
  MINOR: 'minor',
  INFO: 'info',
};

/**
 * WU type values
 *
 * WU-1281: Centralized from hardcoded strings in validators
 */
export const WU_TYPES = {
  DOCUMENTATION: 'documentation',
  PROCESS: 'process',
  FEATURE: 'feature',
  TOOLING: 'tooling',
  BUG: 'bug',
};

/**
 * WU exposure values (WU-1998)
 *
 * Defines how a WU exposes its functionality to users.
 * Used to ensure backend features have corresponding UI coverage.
 *
 * @see {@link packages/@lumenflow/cli/src/lib/wu-schema.ts} - Schema validation
 * @see {@link packages/linters/wu-schema-linter.ts} - Linter validation
 */
export const WU_EXPOSURE = {
  /** User-facing UI changes (pages, components, widgets) */
  UI: 'ui',

  /** API endpoints that are called by UI or external clients */
  API: 'api',

  /** Backend-only changes (no user visibility) */
  BACKEND_ONLY: 'backend-only',

  /** Documentation changes only */
  DOCUMENTATION: 'documentation',
} as const;

/**
 * Array of valid exposure values for schema validation
 * Note: Defined as tuple for Zod enum compatibility
 */
export const WU_EXPOSURE_VALUES = ['ui', 'api', 'backend-only', 'documentation'] as const;

/**
 * Test type keys
 *
 * WU-1281: Centralized from hardcoded keys in validators
 */
export const TEST_TYPES = {
  UNIT: 'unit',
  E2E: 'e2e',
  MANUAL: 'manual',
  INTEGRATION: 'integration',
};
