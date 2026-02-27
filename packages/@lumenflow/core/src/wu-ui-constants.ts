// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * UI and Display Constants
 *
 * WU-1549: Extracted from wu-constants.ts for domain-specific modularity.
 * Contains backlog sections, status sections, log prefixes, emoji, box drawing,
 * display limits, string literals, YAML options, and readiness UI.
 *
 * @module wu-ui-constants
 */

/**
 * Backlog section headings (with emojis)
 *
 * These match the frontmatter config in backlog.md
 */
export const BACKLOG_SECTIONS = {
  READY: '## 🚀 Ready (pull from here)',
  IN_PROGRESS: '## 🔧 In progress',
  BLOCKED: '## ⛔ Blocked',
  DONE: '## ✅ Done',
};

/**
 * Backlog bullet format types (WU-1444)
 *
 * Used by BacklogManager to format list items in each section.
 * Each format produces a different markdown bullet style.
 */
export const BACKLOG_BULLET_FORMAT = {
  /** Ready format: '- [ ] [WU-ID -- Title](link)' */
  READY: 'ready',
  /** Progress format: '- [WU-ID -- Title](link)' */
  PROGRESS: 'progress',
  /** Blocked format: '- [ ] [WU-ID -- Title](link) -- Reason' */
  BLOCKED: 'blocked',
  /** Done format: '- [x] [WU-ID -- Title](link) (YYYY-MM-DD)' */
  DONE: 'done',
};

/**
 * Status.md section headings (simpler format)
 */
export const STATUS_SECTIONS = {
  IN_PROGRESS: '## In Progress',
  BLOCKED: '## Blocked',
  COMPLETED: '## Completed',
};

/**
 * Log prefixes for wu- scripts
 *
 * Consistent prefixes for console output
 */
export const LOG_PREFIX = {
  DONE: '[wu-done]',
  CLAIM: '[wu-claim]',
  CREATE: '[wu:create]',
  EDIT: '[wu:edit]',
  DELETE: '[wu:delete]',
  BLOCK: '[wu-block]',
  UNBLOCK: '[wu-unblock]',
  UNLOCK_LANE: '[wu-unlock-lane]',
  CLEANUP: '[wu-cleanup]',
  PRUNE: '[wu-prune]',
  REPAIR: '[wu:repair]',
  CONSISTENCY: '[wu-consistency]',
  PREFLIGHT: '[wu-preflight]',
  INITIATIVE_PLAN: '[initiative:plan]',
  PLAN_CREATE: '[plan:create]',
  PLAN_LINK: '[plan:link]',
  PLAN_EDIT: '[plan:edit]',
  PLAN_PROMOTE: '[plan:promote]',
  ESCALATE: '[wu:escalate]',
};

/**
 * Emoji constants for consistent console output
 *
 * WU-1281: Centralized from hardcoded emojis across wu-* scripts
 */
export const EMOJI = {
  SUCCESS: '✅',
  FAILURE: '❌',
  WARNING: '⚠️',
  INFO: 'ℹ️',
  BLOCKED: '⛔',
  ROCKET: '🚀',
  WRENCH: '🔧',
  TARGET: '🎯',
  MEMO: '📝',
  FOLDER: '📍',
};

/**
 * Box drawing characters for console output
 *
 * Emergency fix (Session 2): Centralized to eliminate sonarjs/no-duplicate-string errors
 * Used for recovery dialogs and error boxes in wu-* scripts
 */
export const BOX = {
  /** Top border: ╔══...══╗ (66 chars inside + corners = 68 total) */
  TOP: '╔══════════════════════════════════════════════════════════════════╗',

  /** Middle separator: ╠══...══╣ */
  MID: '╠══════════════════════════════════════════════════════════════════╣',

  /** Bottom border: ╚══...══╝ */
  BOT: '╚══════════════════════════════════════════════════════════════════╝',

  /** Side border for content lines */
  SIDE: '║',
};

/**
 * UI display constants
 *
 * WU-1281: Centralized from hardcoded values in wu-done.ts
 */
export const UI = {
  /** Width for error/info boxes in console output */
  ERROR_BOX_WIDTH: 70,

  /** Number of lines to show in status file preview */
  STATUS_PREVIEW_LINES: 5,
};

/**
 * Display limits for CLI output (WU-1068)
 *
 * Centralized limits for truncating display strings to avoid magic numbers.
 */
export const DISPLAY_LIMITS = {
  /** Maximum items to show in lists before truncating */
  LIST_ITEMS: 5,
  /** Maximum items to show in short lists */
  SHORT_LIST: 3,
  /** Maximum characters for content preview */
  CONTENT_PREVIEW: 200,
  /** Maximum characters for short preview */
  SHORT_PREVIEW: 60,
  /** Maximum characters for title display */
  TITLE: 50,
  /** Maximum characters for truncated title */
  TRUNCATED_TITLE: 40,
  /** Maximum characters for command preview */
  CMD_PREVIEW: 60,
  /** Maximum lines to preview from files */
  FILE_LINES: 10,
  /** Maximum commits to show in lists */
  COMMITS: 50,
  /** Maximum overlaps to display */
  OVERLAPS: 3,
};

/**
 * YAML serialization options
 *
 * Centralized from duplicated { lineWidth: 100 } across wu-* scripts (WU-1256).
 * Use with yaml stringify() options.
 */
export const YAML_OPTIONS = {
  /** Standard line width for YAML dump (100 chars) */
  LINE_WIDTH: 100,

  /** No line wrapping (-1 disables wrapping) */
  NO_WRAP: -1,
};

/**
 * Process argv indices (WU-1068)
 *
 * Centralized indices for process.argv access to eliminate magic numbers.
 * In Node.js: argv[0] = node, argv[1] = script, argv[2+] = args
 */
export const ARGV_INDICES = {
  /** Node executable path */
  NODE: 0,
  /** Script path */
  SCRIPT: 1,
  /** First user argument */
  FIRST_ARG: 2,
  /** Second user argument */
  SECOND_ARG: 3,
};

/**
 * String formatting constants
 *
 * Centralized string literals for consistent formatting across scripts.
 * Eliminates hardcoded '\n', ' ', etc. throughout the codebase.
 */
export const STRING_LITERALS = {
  /** Newline character */
  NEWLINE: '\n',

  /** Double newline (paragraph separator) */
  DOUBLE_NEWLINE: '\n\n',

  /** Space character */
  SPACE: ' ',

  /** Empty string */
  EMPTY: '',

  /** Tab character */
  TAB: '\t',

  /** Comma separator */
  COMMA: ',',

  /** Colon separator */
  COLON: ':',

  /** Dash/hyphen */
  DASH: '-',

  /** Forward slash */
  SLASH: '/',
};

/**
 * Readiness summary UI constants (WU-1620)
 *
 * Constants for the readiness summary box displayed after wu:create and wu:edit.
 * Provides visual feedback on whether WU is ready for wu:claim.
 *
 * @see tools/wu-create.ts - displayReadinessSummary()
 * @see tools/wu-edit.ts - displayReadinessSummary()
 */
export const READINESS_UI = {
  /** Box width (inner content area) */
  BOX_WIDTH: 50,

  /** Box drawing characters */
  BOX: {
    TOP_LEFT: '┌',
    TOP_RIGHT: '┐',
    BOTTOM_LEFT: '└',
    BOTTOM_RIGHT: '┘',
    HORIZONTAL: '─',
    VERTICAL: '│',
  },

  /** Status messages */
  MESSAGES: {
    READY_YES: '✅ Ready to claim: YES',
    READY_NO: '⚠️  Ready to claim: NO',
    MISSING_HEADER: 'Missing:',
    BULLET: '•',
  },

  /** Error truncation length */
  ERROR_MAX_LENGTH: 46,
  ERROR_TRUNCATE_LENGTH: 43,
  TRUNCATION_SUFFIX: '...',

  /** Padding calculations (relative to BOX_WIDTH) */
  PADDING: {
    READY_YES: 27, // 50 - len("... Ready to claim: YES") - 1
    READY_NO: 28, // 50 - len("...  Ready to claim: NO") - 1
    MISSING_HEADER: 41, // 50 - len("Missing:") - 1
    ERROR_BULLET: 45, // 50 - len("  ... ") - 1
  },
};
