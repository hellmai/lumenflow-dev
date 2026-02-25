// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Context Validation Constants
 *
 * WU-1549: Extracted from wu-constants.ts for domain-specific modularity.
 * Contains context validation, hook messages, Claude Code hook constants,
 * and derived types for context validation.
 *
 * @module wu-context-constants
 */

import { LUMENFLOW_CLIENT_IDS, type LumenflowClientId } from './client-ids.js';
import { DOCS_LAYOUT_PRESETS } from './docs-layout-presets.js';
import { getConfig } from './lumenflow-config.js';

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function getWorktreesDirHint(): string {
  try {
    return ensureTrailingSlash(getConfig().directories.worktrees);
  } catch {
    return 'worktree/';
  }
}

function getOnboardingDirHint(): string {
  try {
    return ensureTrailingSlash(getConfig().directories.onboardingDir);
  } catch {
    return 'onboarding/';
  }
}

function getSizingGuideRef(): string {
  try {
    return getConfig().directories.sizingGuidePath;
  } catch {
    return DOCS_LAYOUT_PRESETS.simple.sizingGuidePath;
  }
}

/**
 * Context validation constants (WU-1090)
 *
 * Constants for the context-aware state machine for WU lifecycle commands.
 * Supports unified context model, declarative command requirements,
 * smart validation, and recovery paths.
 */
export const CONTEXT_VALIDATION = {
  /** Location types for WU operations */
  LOCATION_TYPES: {
    /** Main checkout (not a worktree) */
    MAIN: 'main',
    /** Inside a worktree */
    WORKTREE: 'worktree',
    /** Detached HEAD state */
    DETACHED: 'detached',
    /** Unknown location (not a git repo or error) */
    UNKNOWN: 'unknown',
  } as const,

  /** Validation error codes */
  ERROR_CODES: {
    /** Command run from wrong location type */
    WRONG_LOCATION: 'WRONG_LOCATION',
    /** Target WU does not exist */
    WU_NOT_FOUND: 'WU_NOT_FOUND',
    /** WU with this ID already exists */
    WU_ALREADY_EXISTS: 'WU_ALREADY_EXISTS',
    /** WU in unexpected status for command */
    WRONG_WU_STATUS: 'WRONG_WU_STATUS',
    /** Lane already has WU in progress */
    LANE_OCCUPIED: 'LANE_OCCUPIED',
    /** Worktree already exists for WU */
    WORKTREE_EXISTS: 'WORKTREE_EXISTS',
    /** Expected worktree not found */
    WORKTREE_MISSING: 'WORKTREE_MISSING',
    /** Gates haven't run or failed */
    GATES_NOT_PASSED: 'GATES_NOT_PASSED',
    /** Uncommitted changes exist */
    DIRTY_GIT: 'DIRTY_GIT',
    /** Cannot reach origin remote */
    REMOTE_UNAVAILABLE: 'REMOTE_UNAVAILABLE',
    /** YAML and state store disagree */
    INCONSISTENT_STATE: 'INCONSISTENT_STATE',
  } as const,

  /** Recovery action types */
  RECOVERY_ACTIONS: {
    /** Reconcile state and continue working (preserves work) */
    RESUME: 'resume',
    /** Discard worktree, reset WU to ready */
    RESET: 'reset',
    /** Remove all artifacts completely (requires --force) */
    NUKE: 'nuke',
    /** Remove leftover worktree (for done WUs) */
    CLEANUP: 'cleanup',
    /** Complete a WU that is already merged but not stamped (WU-1746) */
    COMPLETE: 'complete',
  } as const,

  /** Recovery issue codes */
  RECOVERY_ISSUES: {
    /** Worktree exists but WU status is "ready" */
    PARTIAL_CLAIM: 'PARTIAL_CLAIM',
    /** WU is "in_progress" but worktree does not exist */
    ORPHAN_CLAIM: 'ORPHAN_CLAIM',
    /** YAML status differs from state store */
    INCONSISTENT_STATE: 'INCONSISTENT_STATE',
    /** Branch exists but worktree does not */
    ORPHAN_BRANCH: 'ORPHAN_BRANCH',
    /** Lock file from different WU */
    STALE_LOCK: 'STALE_LOCK',
    /** WU is done but worktree was not cleaned up */
    LEFTOVER_WORKTREE: 'LEFTOVER_WORKTREE',
    /** WU branch is merged to main but WU is not stamped as done (WU-1746) */
    MERGED_NOT_DONE: 'MERGED_NOT_DONE',
  } as const,

  /** Predicate severity levels */
  SEVERITY: {
    /** Blocks command execution */
    ERROR: 'error',
    /** Shows warning but allows execution */
    WARNING: 'warning',
  } as const,

  /** Performance thresholds */
  THRESHOLDS: {
    /** Max context computation time (ms) - acceptance criterion */
    CONTEXT_COMPUTATION_MS: 100,
    /** Max stale lock age (hours) */
    STALE_LOCK_HOURS: 24,
  },

  /** Feature flag keys for workspace.yaml */
  FEATURE_FLAGS: {
    /** Enable context-aware validation */
    CONTEXT_VALIDATION: 'context_validation',
    /** Validation behavior: 'off' | 'warn' | 'error' */
    VALIDATION_MODE: 'validation_mode',
    /** Show next steps after successful commands */
    SHOW_NEXT_STEPS: 'show_next_steps',
    /** Enable wu:recover command */
    RECOVERY_COMMAND: 'recovery_command',
  } as const,

  /** Validation modes */
  VALIDATION_MODES: {
    /** No validation (legacy behavior) */
    OFF: 'off',
    /** Show warnings but proceed */
    WARN: 'warn',
    /** Block on validation failures */
    ERROR: 'error',
  } as const,

  /** Command names for the registry */
  COMMANDS: {
    WU_CREATE: 'wu:create',
    WU_CLAIM: 'wu:claim',
    WU_PREP: 'wu:prep',
    WU_DONE: 'wu:done',
    WU_BLOCK: 'wu:block',
    WU_UNBLOCK: 'wu:unblock',
    WU_STATUS: 'wu:status',
    WU_RECOVER: 'wu:recover',
    GATES: 'gates',
  } as const,
} as const;

/**
 * Git hook error messages (WU-1357)
 *
 * Educational, structured messages for git hook blocks.
 * Follows the "message bag" pattern: TITLE, WHY, ACTIONS, HELP, BYPASS.
 *
 * Design principles:
 * - Explain WHY before showing WHAT to do
 * - Provide multiple paths forward (not just one command)
 * - Put emergency bypass LAST with clear warnings
 * - Include help resources for learning
 *
 * @see .husky/hooks/pre-commit.mjs - Primary consumer
 */
export const HOOK_MESSAGES = {
  /**
   * Main branch protection block message components
   */
  MAIN_BRANCH_BLOCK: {
    /** Box drawing for visual structure */
    BOX: {
      TOP: '══════════════════════════════════════════════════════════════',
      DIVIDER: '──────────────────────────────────────────────────────────────',
    },

    /** Title shown at the top */
    TITLE: (branch: string) => `DIRECT COMMIT TO ${branch.toUpperCase()} BLOCKED`,

    /** Educational explanation of WHY the block exists */
    WHY: {
      HEADER: 'WHY THIS HAPPENS',
      LINES: [
        'LumenFlow protects main from direct commits to ensure:',
        '  • All work is tracked in Work Units (WUs)',
        '  • Changes can be reviewed and coordinated',
        '  • Parallel work across lanes stays isolated',
      ],
    },

    /** Action paths - multiple ways forward */
    ACTIONS: {
      HEADER: 'WHAT TO DO',
      HAVE_WU: {
        HEADER: '1. If you have a Work Unit to implement:',
        get COMMANDS() {
          return [
            'pnpm wu:claim --id WU-XXXX --lane "<Lane>"',
            `cd ${getWorktreesDirHint()}<lane>-wu-xxxx`,
          ];
        },
        NOTE: 'Then make your commits there',
      },
      NEED_WU: {
        HEADER: '2. If you need to create a new Work Unit:',
        COMMANDS: ['pnpm wu:create --lane "<Lane>" --title "Your task"'],
        NOTE: 'This generates a WU ID, then claim it as above',
      },
      LIST_LANES: {
        HEADER: '3. Not sure what lane to use?',
        COMMANDS: ['pnpm wu:list-lanes'],
      },
    },

    /** Help resources */
    HELP: {
      HEADER: 'NEED HELP?',
      get RESOURCES() {
        return [
          '• Read: LUMENFLOW.md (workflow overview)',
          `• Read: ${getOnboardingDirHint()}`,
          '• Run:  pnpm wu:help',
        ];
      },
    },

    /** Emergency bypass (shown last, with warnings) */
    BYPASS: {
      HEADER: 'EMERGENCY BYPASS (logged, use sparingly)',
      WARNING: 'Bypasses are audit-logged. Only use for genuine emergencies.',
      COMMAND: 'LUMENFLOW_FORCE=1 LUMENFLOW_FORCE_REASON="<reason>" git commit ...',
    },
  },

  /**
   * Worktree discipline block message components
   */
  WORKTREE_BLOCK: {
    TITLE: 'LANE BRANCH WORK SHOULD BE IN WORKTREE',
    WHY: 'Worktrees provide isolation for parallel work. Working on a lane branch from the main checkout bypasses this isolation.',
  },
} as const;

/**
 * Canonical LUMENFLOW_* environment variable names (WU-2113)
 *
 * All LUMENFLOW_ prefixed env var string literals should reference this
 * constant instead of using raw strings. The path-literal-guard enforces
 * this via a banned-pattern rule with ratcheting baseline.
 *
 * @example
 * // Instead of: process.env.LUMENFLOW_HEADLESS
 * // Use:        process.env[ENV_VARS.HEADLESS]
 */
export const ENV_VARS = {
  /** Headless mode for non-interactive execution */
  HEADLESS: 'LUMENFLOW_HEADLESS',
  /** Admin mode for elevated operations */
  ADMIN: 'LUMENFLOW_ADMIN',
  /** Force bypass for git hooks */
  FORCE: 'LUMENFLOW_FORCE',
  /** Reason for force bypass (audit trail) */
  FORCE_REASON: 'LUMENFLOW_FORCE_REASON',
  /** Identifies the WU tool performing a git operation */
  WU_TOOL: 'LUMENFLOW_WU_TOOL',
  /** Allows worktree removal operations */
  WORKTREE_REMOVE_ALLOWED: 'LUMENFLOW_WORKTREE_REMOVE_ALLOWED',
  /** Claude Code agent detection */
  CLAUDE_CODE: 'CLAUDE_CODE',
  /** Cloud mode for branch-PR workflows */
  CLOUD: 'LUMENFLOW_CLOUD',
  /** LumenFlow home directory override */
  HOME: 'LUMENFLOW_HOME',
  /** Test baseline path override */
  TEST_BASELINE: 'LUMENFLOW_TEST_BASELINE',
  /** Legacy rollback mode */
  LEGACY_ROLLBACK: 'LUMENFLOW_LEGACY_ROLLBACK',
  /** Git shim recursion guard */
  GIT_SHIM_ACTIVE: 'LUMENFLOW_GIT_SHIM_ACTIVE',
  /** pnpm shim recursion guard */
  PNPM_SHIM_ACTIVE: 'LUMENFLOW_PNPM_SHIM_ACTIVE',
  /** Agent session identifier */
  AGENT_SESSION: 'LUMENFLOW_AGENT_SESSION',
  /** MCP project root override */
  PROJECT_ROOT: 'LUMENFLOW_PROJECT_ROOT',
  /** MCP log level override */
  MCP_LOG_LEVEL: 'LUMENFLOW_MCP_LOG_LEVEL',
  /** MCP migration compatibility mode */
  MCP_MIGRATION_COMPAT_MODE: 'LUMENFLOW_MCP_MIGRATION_COMPAT_MODE',
  /** Sandbox allow unsandboxed override */
  SANDBOX_ALLOW_UNSANDBOXED: 'LUMENFLOW_SANDBOX_ALLOW_UNSANDBOXED',
  /** Control plane auth token */
  CONTROL_PLANE_TOKEN: 'LUMENFLOW_CONTROL_PLANE_TOKEN',
  /** Custom git binary path */
  GIT_BINARY: 'LUMENFLOW_GIT_BINARY',
  /** Registry auth token for pack publishing */
  REGISTRY_TOKEN: 'LUMENFLOW_REGISTRY_TOKEN',
  /** Agent log directory override */
  LOG_DIR: 'LUMENFLOW_LOG_DIR',
} as const;

/** Type for ENV_VARS keys */
export type EnvVarKey = keyof typeof ENV_VARS;

/** Type for ENV_VARS values */
export type EnvVarName = (typeof ENV_VARS)[EnvVarKey];

/**
 * WU sizing guide reference path (WU-2155).
 *
 * Used in sizing advisory warning messages. Derived from configured
 * sizingGuidePath to avoid layout-coupled runtime literals.
 */
export const SIZING_GUIDE_REF = getSizingGuideRef();

export { LUMENFLOW_CLIENT_IDS, type LumenflowClientId };

/**
 * Claude Code hook script constants (WU-1394)
 *
 * Centralized constants for Claude Code enforcement and recovery hooks.
 * Used by enforcement-generator.ts, enforcement-sync.ts, and init.ts.
 *
 * @see packages/@lumenflow/cli/src/hooks/enforcement-generator.ts
 * @see packages/@lumenflow/cli/src/hooks/enforcement-sync.ts
 */
export const CLAUDE_HOOKS = {
  /** Hook script filenames */
  SCRIPTS: {
    ENFORCE_WORKTREE: 'enforce-worktree.sh',
    REQUIRE_WU: 'require-wu.sh',
    WARN_INCOMPLETE: 'warn-incomplete.sh',
    PRE_COMPACT_CHECKPOINT: 'pre-compact-checkpoint.sh',
    SESSION_START_RECOVERY: 'session-start-recovery.sh',
    /** WU-1471: Auto-checkpoint hook for PostToolUse and SubagentStop events */
    AUTO_CHECKPOINT: 'auto-checkpoint.sh',
  },

  /** Hook command path prefix (uses Claude Code's $CLAUDE_PROJECT_DIR variable) */
  PATH_PREFIX: '$CLAUDE_PROJECT_DIR/.claude/hooks',

  /** Hook matchers for settings.json */
  MATCHERS: {
    ALL: '.*',
    WRITE_EDIT: 'Write|Edit',
    COMPACT: 'compact',
    RESUME: 'resume',
    CLEAR: 'clear',
    /** WU-1471: Matcher for SubagentStop hook event */
    SUBAGENT_STOP: '.*',
    /** WU-1502: Matcher for Bash tool PostToolUse */
    BASH: 'Bash',
  },

  /** Template paths (relative to templates directory) */
  TEMPLATES: {
    SETTINGS: 'vendors/claude/.claude/settings.json.template',
    PRE_COMPACT: 'vendors/claude/.claude/hooks/pre-compact-checkpoint.sh',
    SESSION_START: 'vendors/claude/.claude/hooks/session-start-recovery.sh',
  },
} as const;

/** Build full hook command path from script name */
export const getHookCommand = (scriptName: string): string =>
  `${CLAUDE_HOOKS.PATH_PREFIX}/${scriptName}`;

/** Type for location types */
export type LocationType =
  (typeof CONTEXT_VALIDATION.LOCATION_TYPES)[keyof typeof CONTEXT_VALIDATION.LOCATION_TYPES];

/** Type for validation error codes */
export type ValidationErrorCode =
  (typeof CONTEXT_VALIDATION.ERROR_CODES)[keyof typeof CONTEXT_VALIDATION.ERROR_CODES];

/** Type for recovery action types */
export type RecoveryActionType =
  (typeof CONTEXT_VALIDATION.RECOVERY_ACTIONS)[keyof typeof CONTEXT_VALIDATION.RECOVERY_ACTIONS];

/** Type for recovery issue codes */
export type RecoveryIssueCode =
  (typeof CONTEXT_VALIDATION.RECOVERY_ISSUES)[keyof typeof CONTEXT_VALIDATION.RECOVERY_ISSUES];

/** Type for predicate severity levels */
export type PredicateSeverity =
  (typeof CONTEXT_VALIDATION.SEVERITY)[keyof typeof CONTEXT_VALIDATION.SEVERITY];

/** Type for validation modes */
export type ValidationMode =
  (typeof CONTEXT_VALIDATION.VALIDATION_MODES)[keyof typeof CONTEXT_VALIDATION.VALIDATION_MODES];
