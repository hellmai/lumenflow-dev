/**
 * Work Unit Constants
 *
 * Centralized constants for wu- scripts to ensure consistency and DRY compliance.
 * Single source of truth for magic strings, section headings, and patterns.
 *
 * Part of WU-1214: Extract hardcoded strings to wu-constants.ts
 * Part of WU-1240: Consolidated toKebab using change-case library
 *
 * @see {@link packages/@lumenflow/cli/src/wu-done.ts} - Primary consumer
 * @see {@link packages/@lumenflow/cli/src/wu-claim.ts} - Branch/worktree creation
 * @see {@link packages/@lumenflow/cli/src/lib/wu-schema.ts} - PLACEHOLDER_SENTINEL (already centralized)
 */

import path from 'node:path';
import { tmpdir } from 'node:os';
import { kebabCase } from 'change-case';

/**
 * Git branch names
 */
export const BRANCHES = {
  MAIN: 'main',
  MASTER: 'master', // Legacy default branch name (defensive check)
  /** Temporary branch prefix for micro-worktree operations */
  TEMP_PREFIX: 'tmp/',
};

/**
 * Git remote names
 *
 * WU-1302: Centralized to eliminate hardcoded 'origin' strings
 */
export const REMOTES = {
  ORIGIN: 'origin',
};

/**
 * Git ref construction helpers
 *
 * Centralized to eliminate hardcoded 'origin/main' strings
 */
export const GIT_REFS = {
  /** Construct remote ref like 'origin/main' */
  remote: (remoteName, branchName) => `${remoteName}/${branchName}`,
  /** Shortcut for origin/main */
  ORIGIN_MAIN: 'origin/main',
  /** Current HEAD ref */
  HEAD: 'HEAD',
  /** Upstream ref */
  UPSTREAM: '@{u}',
  /** Range of upstream..HEAD */
  UPSTREAM_RANGE: '@{u}..HEAD',
  /** Fetch head ref */
  FETCH_HEAD: 'FETCH_HEAD',
};

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

// Note: PATHS object removed in WU-1240 - use WU_PATHS from wu-paths.ts instead

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
  /** Ready format: '- [ ] [WU-ID — Title](link)' */
  READY: 'ready',
  /** Progress format: '- [WU-ID — Title](link)' */
  PROGRESS: 'progress',
  /** Blocked format: '- [ ] [WU-ID — Title](link) — Reason' */
  BLOCKED: 'blocked',
  /** Done format: '- [x] [WU-ID — Title](link) (YYYY-MM-DD)' */
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
 * Regex patterns for WU operations
 *
 * Note: WU_ID pattern is also in wu-schema.ts for Zod validation
 */
export const PATTERNS = {
  /** WU identifier format: WU-123 */
  WU_ID: /^WU-\d+$/,

  /** Extract WU ID from text: captures "WU-123" */
  WU_ID_EXTRACT: /WU-\d+/,

  /**
   * Extract WU ID from worktree paths (case-insensitive)
   *
   * WU-1090: Worktree names use lowercase like 'framework-core-wu-1090'
   * This pattern matches both 'WU-123' and 'wu-123' to support
   * extracting WU IDs from worktree paths.
   */
  WU_ID_EXTRACT_CI: /wu-\d+/i,

  /** Lane branch format: lane/<lane-kebab>/wu-<id> */
  LANE_BRANCH: /^lane\/[\w-]+\/wu-\d+$/,

  /** Worktree path format: worktrees/<lane-kebab>-wu-<id> */
  WORKTREE_PATH: /^worktrees\/[\w-]+-wu-\d+$/,
};

/**
 * Commit message formats
 *
 * These are functions that generate properly formatted commit messages
 */
export const COMMIT_FORMATS = {
  /**
   * wu:claim commit message
   * @param {string} id - WU ID (e.g., 'wu-123')
   * @param {string} laneKebab - Lane in kebab-case (e.g., 'operations-tooling')
   * @returns {string} Commit message
   */
  CLAIM: (id, laneKebab) => `wu(${id}): claim for ${laneKebab} lane`,

  /**
   * wu:done commit message
   * @param {string} id - WU ID (e.g., 'wu-123')
   * @param {string} title - WU title (will be truncated if needed)
   * @returns {string} Commit message
   */
  DONE: (id, title) => `wu(${id}): done - ${title}`,

  /**
   * wu:create commit message
   * @param {string} id - WU ID (e.g., 'wu-123')
   * @param {string} title - WU title (will be truncated if needed)
   * @returns {string} Commit message
   */
  CREATE: (id, title) => `docs: create ${id.toLowerCase()} for ${title}`,

  /**
   * wu:edit commit message (for ready WUs via micro-worktree)
   * @param {string} id - WU ID (e.g., 'wu-123')
   * @returns {string} Commit message
   */
  EDIT: (id) => `docs: edit ${id.toLowerCase()} spec`,

  /**
   * wu:edit spec update commit message (for in_progress WUs in active worktree)
   * WU-1365: Worktree-aware editing applies edits directly in the worktree
   * @param {string} id - WU ID (e.g., 'wu-123')
   * @returns {string} Commit message
   */
  SPEC_UPDATE: (id) => `wu(${id.toLowerCase()}): spec update`,

  /**
   * wu:block commit message
   * @param {string} id - WU ID (e.g., 'wu-123')
   * @returns {string} Commit message
   */
  BLOCK: (id) => `wu(${id}): block`,

  /**
   * wu:unblock commit message
   * @param {string} id - WU ID (e.g., 'wu-123')
   * @returns {string} Commit message
   */
  UNBLOCK: (id) => `wu(${id}): unblock`,

  /**
   * wu:repair commit message
   * @param {string} id - WU ID (e.g., 'wu-123')
   * @returns {string} Commit message
   */
  REPAIR: (id) => `fix(${id}): repair state inconsistency`,

  /**
   * Rebase artifact cleanup commit message
   * WU-1371: Used when rebasing brings in completion artifacts from main
   * @param {string} id - WU ID (e.g., 'wu-123')
   * @returns {string} Commit message
   */
  REBASE_ARTIFACT_CLEANUP: (id) =>
    `chore(${id.toLowerCase()}): remove rebased completion artifacts`,

  /**
   * Backlog repair commit message
   * WU-1506: Used when backlog invariant repair removes duplicates after rebase
   * @param {string} id - WU ID (e.g., 'wu-123')
   * @returns {string} Commit message
   */
  BACKLOG_REPAIR: (id) => `chore(repair): repair backlog duplicates for ${id.toLowerCase()}`,
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
};

/**
 * Consistency check types (WU-1276)
 *
 * Layer 2 defense-in-depth: detect and repair WU state inconsistencies
 */
export const CONSISTENCY_TYPES = {
  /** WU YAML has status 'done' but WU appears in status.md In Progress section */
  YAML_DONE_STATUS_IN_PROGRESS: 'YAML_DONE_STATUS_IN_PROGRESS',

  /** WU appears in both Done AND In Progress sections of backlog.md */
  BACKLOG_DUAL_SECTION: 'BACKLOG_DUAL_SECTION',

  /** WU YAML has status 'done' but no stamp file exists */
  YAML_DONE_NO_STAMP: 'YAML_DONE_NO_STAMP',

  /** WU has status 'done' but still has an associated worktree */
  ORPHAN_WORKTREE_DONE: 'ORPHAN_WORKTREE_DONE',

  /** Stamp file exists but WU YAML status is not 'done' (partial wu:done failure) */
  STAMP_EXISTS_YAML_NOT_DONE: 'STAMP_EXISTS_YAML_NOT_DONE',

  /** WU is claimed but its worktree directory is missing */
  MISSING_WORKTREE_CLAIMED: 'MISSING_WORKTREE_CLAIMED',
};

/**
 * Consistency check messages
 */
export const CONSISTENCY_MESSAGES = {
  MISSING_WORKTREE_CLAIMED: (id, status, worktreePath) =>
    `WU ${id} is '${status}' but worktree path is missing (${worktreePath})`,
  MISSING_WORKTREE_CLAIMED_REPAIR: 'Recover worktree or re-claim WU',
};

/**
 * Worktree warning messages
 */
export const WORKTREE_WARNINGS = {
  MISSING_TRACKED_HEADER: 'Tracked worktrees missing on disk (possible manual deletion):',
  MISSING_TRACKED_LINE: (worktreePath) => `Missing: ${worktreePath}`,
};

/**
 * File system constants
 *
 * WU-923: Centralized to eliminate hardcoded strings
 */
export const FILE_SYSTEM = {
  /** Standard file encoding */
  ENCODING: 'utf8',

  /** UTF-8 encoding (alias for compatibility) */
  UTF8: 'utf8',
};

/**
 * Build artifact cleanup globs
 *
 * Centralized glob patterns for worktree artifact cleanup.
 */
export const BUILD_ARTIFACT_GLOBS = {
  /** Common dist directories inside worktrees */
  DIST_DIRS: [
    'packages/*/dist',
    'packages/**/dist',
    'apps/*/dist',
    'apps/**/dist',
    'tools/*/dist',
    'tools/**/dist',
  ],

  /** TypeScript build info files */
  TSBUILDINFO_FILES: ['**/*.tsbuildinfo'],
};

/**
 * Build artifact cleanup ignore patterns
 *
 * Centralized ignore globs for artifact cleanup.
 */
export const BUILD_ARTIFACT_IGNORES = ['**/node_modules/**', '**/.git/**', '**/.turbo/**'];

/**
 * Process stdio constants
 *
 * Standard values for child_process execSync stdio option.
 */
export const STDIO = {
  /** Pipe stdout/stderr (capture output) */
  PIPE: 'pipe',
  /** Inherit stdio from parent process */
  INHERIT: 'inherit',
  /** Ignore stdio (silent execution) */
  IGNORE: 'ignore',
} as const;

/**
 * Configuration file paths
 *
 * WU-923: Centralized config file names
 */
export const CONFIG_FILES = {
  /** LumenFlow main config */
  LUMENFLOW_CONFIG: '.lumenflow.config.yaml',

  /** Lane inference taxonomy */
  LANE_INFERENCE: '.lumenflow.lane-inference.yaml',
};

/**
 * Micro-worktree operation identifiers
 *
 * WU-923: Centralized operation names for withMicroWorktree()
 */
export const MICRO_WORKTREE_OPERATIONS = {
  WU_CREATE: 'wu-create',
  WU_EDIT: 'wu-edit',
  WU_DELETE: 'wu-delete', // WU-1809: Safe WU deletion
  WU_DONE: 'wu-done',
  WU_BLOCK: 'wu-block',
  WU_UNBLOCK: 'wu-unblock',
  WU_CLAIM: 'wu-claim',
  ORPHAN_REPAIR: 'orphan-repair', // WU-1437: Pre-claim orphan WU repair
  INITIATIVE_EDIT: 'initiative-edit', // WU-1451: Initiative edit operation
  INITIATIVE_BULK_ASSIGN: 'initiative-bulk-assign', // WU-2553: Bulk WU assignment
};

/**
 * Telemetry step identifiers
 *
 * WU-1584: Centralized telemetry step names to eliminate string literals.
 */
export const TELEMETRY_STEPS = {
  GATES: 'gates',
  /** WU-1467: COS_GATES removed -- was a stub (exit 0), not an authoritative step */
  PARALLEL_DETECTION: 'parallel_detection',
  PARALLEL_AUTO_REBASE: 'parallel_auto_rebase',
};

/**
 * WU-1747: Skip gates reason constants
 */
export const SKIP_GATES_REASONS = {
  CHECKPOINT_VALID: 'checkpoint_valid',
};

/**
 * WU-1747: Checkpoint-related log messages
 */
export const CHECKPOINT_MESSAGES = {
  SKIPPING_GATES_VALID: 'Skipping gates - valid checkpoint found',
  CHECKPOINT_LABEL: 'Checkpoint',
  GATES_PASSED_AT: 'Gates passed at',
  COULD_NOT_CREATE: 'Could not create WU-1747 checkpoint',
};

/**
 * Default values
 */
export const DEFAULTS = {
  /** Default worktrees directory */
  WORKTREES_DIR: 'worktrees',

  /** Maximum commit subject length (commitlint default) */
  MAX_COMMIT_SUBJECT: 100,

  /** Parent directory traversal depth from tools/lib to project root */
  PROJECT_ROOT_DEPTH: 2,

  /**
   * Default email domain for username -> email conversion
   * WU-1068: Made configurable, no longer hardcoded to exampleapp.co.uk
   * @see user-normalizer.ts - Infers from git config first
   */
  EMAIL_DOMAIN: 'example.com',
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
 * Cleanup guard constants
 */
export const CLEANUP_GUARD = {
  REASONS: {
    UNCOMMITTED_CHANGES: 'UNCOMMITTED_CHANGES',
    UNPUSHED_COMMITS: 'UNPUSHED_COMMITS',
    STATUS_NOT_DONE: 'STATUS_NOT_DONE',
    MISSING_STAMP: 'MISSING_STAMP',
    PR_NOT_MERGED: 'PR_NOT_MERGED',
  },
  TITLES: {
    BLOCKED: 'CLEANUP BLOCKED',
    NEXT_STEPS: 'Next steps:',
  },
  MESSAGES: {
    UNCOMMITTED_CHANGES: 'Worktree has uncommitted changes. Refusing to delete.',
    UNPUSHED_COMMITS: 'Worktree has unpushed commits. Refusing to delete.',
    STATUS_NOT_DONE: 'WU YAML status is not done. Refusing to delete.',
    MISSING_STAMP: 'WU stamp is missing. Refusing to delete.',
    PR_NOT_MERGED: 'PR is not merged (or cannot be verified). Refusing to delete.',
  },
  /* eslint-disable sonarjs/no-duplicate-string -- Intentional: cleanup instructions repeated for each error type for readability */
  NEXT_STEPS: {
    DEFAULT: [
      { text: '1. Resolve the issue above', appendId: false },
      { text: '2. Re-run: pnpm wu:cleanup --id', appendId: true },
    ],
    UNCOMMITTED_CHANGES: [
      { text: '1. Commit or stash changes in the worktree', appendId: false },
      { text: '2. Re-run: pnpm wu:cleanup --id', appendId: true },
    ],
    UNPUSHED_COMMITS: [
      { text: '1. Push the lane branch to origin', appendId: false },
      { text: '2. Re-run: pnpm wu:cleanup --id', appendId: true },
    ],
    STATUS_NOT_DONE: [
      {
        text: `1. Complete the WU with ${LOG_PREFIX.DONE} (creates stamp + done status)`,
        appendId: false,
      },
      { text: '2. Re-run: pnpm wu:cleanup --id', appendId: true },
    ],
    MISSING_STAMP: [
      { text: '1. Run wu:done to create the stamp file', appendId: false },
      { text: '2. Re-run: pnpm wu:cleanup --id', appendId: true },
    ],
    PR_NOT_MERGED: [
      { text: '1. Merge the PR in GitHub', appendId: false },
      { text: '2. Re-run: pnpm wu:cleanup --id', appendId: true },
    ],
  },
  /* eslint-enable sonarjs/no-duplicate-string */
  PR_CHECK: {
    START: 'Verifying PR merge status...',
    RESULT: 'PR merge verification via',
  },
};

/**
 * Git display constants
 *
 * Emergency fix (Session 2): Centralized from hardcoded magic numbers
 * Used for display truncation of SHAs and session IDs
 */
export const GIT = {
  /** Standard length for displaying short SHA hashes (e.g., "abc12345") */
  SHA_SHORT_LENGTH: 8,
  /** Max number of commits to inspect in git log lookbacks */
  LOG_MAX_COUNT: 50,
};

/**
 * Real git executable path - MUST bypass tools/shims to prevent recursion.
 *
 * CRITICAL: The git shim (tools/shims/git) calls functions that need to run git
 * commands. If those functions use 'git' (which resolves to the shim), we get
 * infinite recursion: shim → helper → git → shim → helper → git → ...
 *
 * With VS Code extensions making dozens of git calls per second, this causes
 * memory exhaustion within seconds → OOM crash → system reboot.
 *
 * P0 incident: 2025-12-10 server crash due to recursive fork bomb.
 *
 * @see tools/shims/git - The git shim that blocks destructive commands
 * @see tools/lib/wu-helpers.ts - Uses REAL_GIT to avoid recursion
 */
export const REAL_GIT = '/usr/bin/git';

/**
 * Git command flags
 *
 * Centralized git flag constants to eliminate hardcoded strings.
 * Used by git-adapter.ts and other git operation utilities.
 */
export const GIT_FLAGS = {
  /** Show abbreviated ref names (for branch name resolution) */
  ABBREV_REF: '--abbrev-ref',

  /** Porcelain format (machine-readable output) */
  PORCELAIN: '--porcelain',

  /** Create new branch and switch to it */
  BRANCH: '-b',

  /** Force flag (long form) */
  FORCE: '--force',

  /** Force flag (short form) */
  FORCE_SHORT: '-f',

  /** Fast-forward only merge */
  FF_ONLY: '--ff-only',

  /** Rebase local commits on top of fetched branch */
  REBASE: '--rebase',

  /** Check ancestry without output (merge-base) */
  IS_ANCESTOR: '--is-ancestor',

  /** Set upstream tracking */
  UPSTREAM: '-u',

  /** Delete branch (safe - only if merged) */
  DELETE: '-d',

  /** Delete branch (force - even if not merged) */
  DELETE_FORCE: '-D',

  /** Delete remote branch flag (for git push --delete) */
  DELETE_REMOTE: '--delete',

  /** Hard reset flag */
  HARD: '--hard',

  /** Soft reset flag */
  SOFT: '--soft',

  /** fd flags for clean (force delete directories) */
  FD_SHORT: '-fd',

  /** df flags for clean (delete force directories) */
  DF_SHORT: '-df',

  /** No verify flag (skip pre-commit/commit-msg hooks) */
  NO_VERIFY: '--no-verify',

  /** No GPG sign flag (skip commit signing) */
  NO_GPG_SIGN: '--no-gpg-sign',

  /** One-line log format */
  ONELINE: '--oneline',

  /** List heads only (for ls-remote) */
  HEADS: '--heads',

  /** Path separator (separates git options from file paths) */
  PATH_SEPARATOR: '--',
};

/**
 * Git commands
 *
 * Centralized git command strings to eliminate hardcoded strings.
 * Used for direct git command execution via execSync/execa.
 */
export const GIT_COMMANDS = {
  /** Git binary */
  GIT: 'git',

  /** Git reset command */
  RESET: 'reset',

  /** List tree objects (check file existence on branch) */
  LS_TREE: 'ls-tree',

  /** List remote references */
  LS_REMOTE: 'ls-remote',

  /** Push command */
  PUSH: 'push',

  /** Pull command */
  PULL: 'pull',

  /** Git diff command */
  DIFF: 'diff',

  /** Git log command */
  LOG: 'log',

  /** Git merge-base command */
  MERGE_BASE: 'merge-base',

  /** Git rev-parse command */
  REV_PARSE: 'rev-parse',

  /** Git diff flags */
  CACHED: '--cached',
  NAME_ONLY: '--name-only',
  DIFF_FILTER_ACM: '--diff-filter=ACM',
};

/**
 * Session display constants
 *
 * Emergency fix (Session 2): Centralized from hardcoded magic numbers
 */
export const SESSION = {
  /** Standard length for displaying session ID prefix (e.g., "sess-123") */
  ID_DISPLAY_LENGTH: 8,
};

/**
 * Validation constants
 *
 * WU-1281: Centralized from local constants in validators
 */
export const VALIDATION = {
  /** Minimum description length for WU spec completeness */
  MIN_DESCRIPTION_LENGTH: 50,
};

/**
 * Threshold constants for pre-flight checks
 *
 * WU-1302: Centralized to eliminate magic numbers
 * WU-1370: Added graduated drift thresholds for early warnings
 */
export const THRESHOLDS = {
  /** Info threshold: commits behind main to suggest rebasing (WU-1370) */
  BRANCH_DRIFT_INFO: 10,

  /** Warning threshold: commits behind main where rebase is recommended (WU-1370) */
  BRANCH_DRIFT_WARNING: 15,

  /** Maximum commits behind main before requiring rebase (WU-755 pre-flight) */
  BRANCH_DRIFT_MAX: 20,
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

/**
 * Safety-critical test glob patterns
 *
 * WU-2242: Centralized list of glob patterns for safety tests that MUST exist.
 * Gates fail if any of these patterns find no matches.
 *
 * These patterns identify tests for:
 * - PHI (Protected Health Information) protection
 * - Escalation triggers
 * - Privacy detection
 * - Constitutional enforcement
 * - Safe prompt wrapping
 * - Crisis/emergency handling
 *
 * @type {string[]}
 */
export const SAFETY_CRITICAL_TEST_GLOBS = Object.freeze([
  // PHI protection tests
  'apps/web/src/**/*PHI*.test.{ts,tsx}',
  'apps/web/src/**/*phi*.test.{ts,tsx}',

  // Escalation trigger tests
  'apps/web/src/**/*escalation*.test.{ts,tsx}',
  'apps/web/src/**/*Escalation*.test.{ts,tsx}',

  // Privacy detection tests
  'apps/web/src/**/*privacy*.test.{ts,tsx}',
  'apps/web/src/**/*Privacy*.test.{ts,tsx}',

  // Constitutional enforcer tests
  'apps/web/src/**/*constitutional*.test.{ts,tsx}',
  'apps/web/src/**/*Constitutional*.test.{ts,tsx}',

  // Safe prompt wrapper tests
  'apps/web/src/**/*safePrompt*.test.{ts,tsx}',
  'apps/web/src/**/*SafePrompt*.test.{ts,tsx}',

  // Crisis/emergency handling tests
  'apps/web/src/**/*crisis*.test.{ts,tsx}',
  'apps/web/src/**/*Crisis*.test.{ts,tsx}',
]);

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
 * Default values for WU YAML fields
 *
 * WU-1337: Centralized defaults for auto-repair in schema validation
 * DRY principle: Single source of truth for optional field defaults
 *
 * Used by wu-schema.ts Zod transformations to provide sensible defaults
 * when agents omit optional fields, reducing validation errors.
 */
export const WU_DEFAULTS = {
  /** Default priority level (medium priority) */
  priority: 'P2',

  /** Default status for new WUs */
  status: 'ready',

  /** Default work type */
  type: 'feature',

  /** Default code paths (empty until populated) */
  code_paths: [],

  /** Default test structure (includes all test types) */
  tests: { manual: [], unit: [], integration: [], e2e: [] },

  /** Default artifacts (empty - wu:done adds stamp) */
  artifacts: [],

  /** Default dependencies (no blockers) */
  dependencies: [],

  /** Default risks (none identified) */
  risks: [],

  /** Default notes (empty string, not undefined) */
  notes: '',

  /** Default review requirement (agent-completed WUs) */
  requires_review: false,
};

/**
 * Lane-to-code_paths validation patterns (WU-1372)
 *
 * Advisory patterns to warn when a WU's lane doesn't match its code_paths.
 * Each lane parent can define paths to exclude (paths that shouldn't appear
 * for that lane) and paths that are exceptionally allowed.
 *
 * Validation is advisory only - never blocks wu:claim or wu:done.
 *
 * WU-1068: Removed hardcoded @exampleapp references. These patterns
 * should be configured in .lumenflow.config.yaml per-project.
 *
 * @see {@link packages/@lumenflow/cli/src/lib/lane-validator.ts} - Validation logic
 */
export const LANE_PATH_PATTERNS = {
  /**
   * Operations lane should not touch prompt-related paths.
   * These paths belong to the Intelligence lane.
   */
  Operations: {
    exclude: ['ai/prompts/**', 'apps/web/src/lib/prompts/**'],
    allowExceptions: [],
  },

  /**
   * Intelligence lane should not touch tooling paths.
   * Exception: tools/lib/prompt-* files are Intelligence-owned.
   */
  Intelligence: {
    exclude: ['tools/**'],
    allowExceptions: ['tools/lib/prompt-*', 'tools/prompts-eval/**'],
  },
};

/**
 * Process detection constants for background process warning (WU-1381)
 *
 * Used by process-detector.ts to identify processes that may interfere
 * with wu:done gates execution.
 */
export const PROCESS_DETECTION = {
  /**
   * Process names that commonly interfere with gates execution.
   * These processes may:
   * - Write to stdout/stderr (causing mixed output)
   * - Hold file locks that may cause test failures
   * - Consume resources that affect gate performance
   */
  INTERFERING_NAMES: ['node', 'pnpm', 'npm', 'vitest', 'tsx', 'eslint', 'prettier', 'tsc', 'turbo'],

  /** Maximum characters to display for command in warnings */
  CMD_DISPLAY_LIMIT: 60,
};

/**
 * CLI argument flags
 *
 * Centralized command-line argument strings to eliminate hardcoded flags.
 * Used across wu-* scripts, gates, and validation tools.
 */
export const CLI_FLAGS = {
  // Common flags
  DRY_RUN: '--dry-run',
  EXECUTE: '--execute',
  HELP: '--help',
  HELP_SHORT: '-h',
  VERBOSE: '--verbose',
  FIX: '--fix',
  JSON: '--json',
  FORCE: '--force',

  // Gate-specific flags
  DOCS_ONLY: '--docs-only',
  FULL_LINT: '--full-lint',
  FULL_TESTS: '--full-tests', // WU-1920: Force full test suite
  FULL_COVERAGE: '--full-coverage', // WU-2244: Force full coverage (deterministic)
  COVERAGE_MODE: '--coverage-mode=',

  // WU-specific flags
  WU: '--wu',
  ID: '--id',
  ALL: '--all',
  CHECK: '--check',
  TIER: '--tier',
  AGENT_TYPE: '--agent-type',
  DESCRIPTION: '--description',
  ACCEPTANCE: '--acceptance',
  VALIDATE: '--validate',
  REASON: '--reason',
  WEEK: '--week',
  SINCE: '--since',
};

/**
 * pnpm/npm command flags
 *
 * Centralized package manager flag strings.
 */
export const PKG_FLAGS = {
  FILTER: '--filter',
  FROZEN_LOCKFILE: '--frozen-lockfile',
  /** WU-1527: Required for pnpm add at workspace root in monorepos */
  WORKSPACE_ROOT: '-w',
  SAVE_DEV: '--save-dev',
  SAVE_EXACT: '--save-exact',
};

/**
 * ESLint command flags
 *
 * Centralized ESLint CLI flag strings.
 */
export const ESLINT_FLAGS = {
  MAX_WARNINGS: '--max-warnings',
  NO_WARN_IGNORED: '--no-warn-ignored',
  CACHE: '--cache',
  CACHE_STRATEGY: '--cache-strategy',
  CACHE_LOCATION: '--cache-location',
  PASS_ON_UNPRUNED: '--pass-on-unpruned-suppressions',
};

/**
 * pnpm script names
 *
 * Centralized script names for package.json commands.
 */
export const SCRIPTS = {
  LINT: 'lint',
  TEST: 'test',
  TEST_UNIT: 'test:unit',
  BUILD: 'build',
  FORMAT: 'format',
  FORMAT_CHECK: 'format:check',
  TYPECHECK: 'typecheck',
  DEV: 'dev',
  SPEC_LINTER: 'spec:linter',
  /** WU-1467: Stub script -- not an enforced gate. Retained for script surface only. */
  PROMPTS_LINT: 'prompts:lint',
  RUN: 'run',
  GATES: 'gates',
  /** WU-1467: Stub script -- not an enforced gate. Retained for script surface only. */
  COS_GATES: 'cos:gates',
  PRETTIER: 'prettier',
  /** WU-1467: Root script surface for tasks:validate (delegates to wu:validate --all) */
  TASKS_VALIDATE: 'tasks:validate',
};

/**
 * Gate names for quality gates
 *
 * Centralized gate identifiers for gates.ts and telemetry.
 */
export const GATE_NAMES = {
  /** WU-2252: Invariants check (runs first, non-bypassable) */
  INVARIANTS: 'invariants',
  FORMAT_CHECK: 'format:check',
  SPEC_LINTER: 'spec:linter',
  /** WU-1467: PROMPTS_LINT removed -- was a stub (exit 0), not an authoritative gate */
  BACKLOG_SYNC: 'backlog-sync',
  SUPABASE_DOCS_LINTER: 'supabase-docs:linter',
  LINT: 'lint',
  TYPECHECK: 'typecheck',
  TEST: 'test',
  COVERAGE: 'coverage',
  /** WU-2062: Safety-critical tests (always run) */
  SAFETY_CRITICAL_TEST: 'safety-critical-test',
  /** WU-2062: Integration tests (for high-risk changes) */
  INTEGRATION_TEST: 'integration-test',
  /** WU-2315: System map validation (warn-only until orphan docs are indexed) */
  SYSTEM_MAP_VALIDATE: 'system-map:validate',
  /** WU-1191: Lane health check (overlap detection) */
  LANE_HEALTH: 'lane-health',
  /** WU-1315: Onboarding smoke test (init + wu:create validation) */
  ONBOARDING_SMOKE_TEST: 'onboarding-smoke-test',
};

/**
 * Gate command sentinels (special values for non-shell commands)
 *
 * These are not shell commands but trigger special handling in gates.ts.
 */
export const GATE_COMMANDS = {
  /** WU-2252: Triggers invariants check */
  INVARIANTS: 'invariants',
  /** Triggers incremental lint (only changed files) */
  INCREMENTAL: 'incremental',
  /** Triggers incremental tests (only tests related to changed files) - WU-1920 */
  INCREMENTAL_TEST: 'incremental-test',
  /** Triggers coverage gate check */
  COVERAGE_GATE: 'coverage-gate',
  /** WU-2062: Triggers safety-critical tests (always run) */
  SAFETY_CRITICAL_TEST: 'safety-critical-test',
  /** WU-2062: Triggers tiered test execution based on risk */
  TIERED_TEST: 'tiered-test',
  /** WU-1315: Triggers onboarding smoke test */
  ONBOARDING_SMOKE_TEST: 'onboarding-smoke-test',
};

/**
 * CLI mode flags
 *
 * Command-line mode arguments.
 */
export const CLI_MODES = {
  LOCAL: '--mode=local',
};

/**
 * Prettier command flags
 *
 * Centralized prettier CLI flag strings.
 */
export const PRETTIER_FLAGS = {
  WRITE: '--write',
};

/**
 * Package manager commands
 *
 * Centralized pnpm command strings.
 */
export const PKG_MANAGER = 'pnpm';

/**
 * Package manager subcommands
 *
 * Centralized pnpm subcommand strings.
 */
export const PKG_COMMANDS = {
  INSTALL: 'install',
  /** WU-1527: Used by lumenflow-upgrade and deps-add */
  ADD: 'add',
  REMOVE: 'remove',
};

/**
 * Package names (monorepo workspaces)
 *
 * Centralized package names for --filter usage.
 * WU-1068: Changed from @exampleapp to @lumenflow for framework reusability.
 * Project-specific packages should be configured in .lumenflow.config.yaml.
 */
export const PACKAGES = {
  WEB: 'web',
  APPLICATION: '@lumenflow/core',
  DOMAIN: '@lumenflow/core',
  INFRASTRUCTURE: '@lumenflow/cli',
};

/**
 * Directory paths within the monorepo
 *
 * Centralized directory path strings.
 */
export const DIRECTORIES = {
  APPS_WEB: 'apps/web/',
  WORKTREES: 'worktrees/',
  AI: 'ai/',
  CLAUDE: '.claude/',
  CLAUDE_HOOKS: '.claude/hooks/',
  DOCS: 'docs/',
  PACKAGES: 'packages/',
  TOOLS: 'tools/',
  MEMORY_BANK: 'memory-bank/',
  WU_DIR: 'docs/04-operations/tasks/wu',
  INITIATIVES_DIR: 'docs/04-operations/tasks/initiatives',
  // WU-1814: Paths for active WU detection
  BACKLOG_PATH: 'docs/04-operations/tasks/backlog.md',
  STATUS_PATH: 'docs/04-operations/tasks/status.md',
};

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
    /** WU-1502: PostToolUse Bash hook for dirty-main warning */
    WARN_DIRTY_MAIN: 'warn-dirty-main.sh',
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

/**
 * ESLint cache strategy values
 */
export const CACHE_STRATEGIES = {
  CONTENT: 'content',
  METADATA: 'metadata',
};

/**
 * Process stdio modes
 *
 * Centralized stdio configuration values for child_process operations.
 */
export const STDIO_MODES = {
  /** Inherit stdio from parent process (shows output in console) */
  INHERIT: 'inherit',
  /** Pipe stdio to parent process (capture output) */
  PIPE: 'pipe',
  /** Ignore stdio (discard output) */
  IGNORE: 'ignore',
} as const;

/**
 * Process exit codes
 *
 * Standard exit code values for CLI scripts.
 */
export const EXIT_CODES = {
  /** Success exit code */
  SUCCESS: 0,
  /** Generic error exit code */
  ERROR: 1,
  /** Fatal or distinct failure exit code */
  FAILURE: 2,
};

/**
 * Stream error codes
 *
 * WU-1233: Error codes for stream operations (stdout/stderr).
 * Used by StreamErrorHandler for graceful pipe closure handling.
 */
export const STREAM_ERRORS = {
  /**
   * EPIPE error code
   *
   * Occurs when writing to a pipe whose read end has been closed.
   * This is normal behavior when CLI output is piped through head/tail.
   * Unix convention: exit with code 0 on EPIPE (consumer got what it needed).
   */
  EPIPE: 'EPIPE',
} as const;

/**
 * ESLint command names
 *
 * Centralized ESLint command strings.
 */
export const ESLINT_COMMANDS = {
  /** ESLint CLI command */
  ESLINT: 'eslint',
};

/**
 * ESLint default values
 *
 * Default configuration values for ESLint operations.
 */
export const ESLINT_DEFAULTS = {
  /**
   * Maximum allowed warnings
   *
   * WU-1866: Temporarily increased from 0 to 100 to unblock gates.
   * There are ~82 pre-existing warnings that need proper fixes.
   */
  MAX_WARNINGS: '100',
};

/**
 * Git command combinations
 *
 * Full git command strings for common operations.
 */
export const GIT_COMMAND_STRINGS = {
  /** Get diff of cached (staged) files */
  DIFF_CACHED: 'git diff --cached',

  /** Get names of cached files */
  DIFF_CACHED_NAMES: 'git diff --cached --name-only',

  /** Get names of cached files (added, copied, modified) */
  DIFF_CACHED_ACM: 'git diff --cached --name-only --diff-filter=ACM',

  /** Get cached diff with zero context (used for hook validation) */
  DIFF_CACHED_UNIFIED_ZERO: 'git diff --cached -U0',

  /** Get current branch name */
  REV_PARSE_ABBREV_REF_HEAD: 'git rev-parse --abbrev-ref HEAD',
};

/**
 * Path patterns for WU-related files
 */
export const PATH_PATTERNS = {
  /** Matches WU YAML paths in both legacy and current locations */
  WU_YAML: /(?:memory-bank|docs\/04-operations)\/tasks\/wu\/(WU-\d+)\.ya?ml$/i,

  /** Matches stamp file paths */
  STAMP: /\.lumenflow\/stamps\/(WU-\d+)\.done$/i,
};

/**
 * Common shell commands
 *
 * Centralized command names for child_process operations.
 */
export const SHELL_COMMANDS = {
  /** Which command (check if executable exists) */
  WHICH: 'which',

  /** Cat command (concatenate files) */
  CAT: 'cat',

  /** Node.js executable */
  NODE: 'node',
};

/**
 * External tool commands
 *
 * Centralized tool command names.
 */
export const TOOLS = {
  /** Gitleaks secret scanner */
  GITLEAKS: 'gitleaks',

  /** ESLint linter */
  ESLINT: 'eslint',

  /** Prettier formatter */
  PRETTIER: 'prettier',

  /** TypeScript compiler */
  TSC: 'tsc',
};

/**
 * Gitleaks command arguments
 *
 * Centralized gitleaks CLI arguments.
 */
export const GITLEAKS_ARGS = {
  /** Protect mode (scan staged files) */
  PROTECT: 'protect',

  /** Staged flag */
  STAGED: '--staged',

  /** Verbose output */
  VERBOSE: '--verbose',
};

/**
 * Prettier command arguments
 *
 * Centralized prettier CLI arguments.
 */
export const PRETTIER_ARGS = {
  /** Check formatting without writing */
  CHECK: '--check',
  /** List files with formatting differences */
  LIST_DIFFERENT: '--list-different',
};

/**
 * Audit command arguments
 *
 * Centralized pnpm audit CLI arguments.
 */
export const AUDIT_ARGS = {
  /** Audit subcommand */
  AUDIT: 'audit',

  /** Audit level flag */
  AUDIT_LEVEL_MODERATE: '--audit-level=moderate',

  /** Ignore registry errors */
  IGNORE_REGISTRY_ERRORS: '--ignore-registry-errors',

  /** Auto-fix flag */
  FIX: '--fix',
};

/**
 * Script file paths
 *
 * Centralized paths to validation scripts.
 */
export const SCRIPT_PATHS = {
  /** Prompt registry validation */
  VALIDATE_PROMPT_REGISTRY: 'tools/validate-prompt-registry.js',
};

/**
 * Known package names for vulnerability tracking
 *
 * Package identifiers used in dependency auditing.
 */
export const KNOWN_PACKAGES = {
  /** node-forge crypto library */
  NODE_FORGE: 'node-forge',

  /** Next.js framework */
  NEXT: 'next',

  /** jsPDF PDF generation library */
  JSPDF: 'jspdf',
};

/**
 * Error codes and messages
 *
 * Centralized error identifiers for consistency.
 */
export const ERROR_CODES = {
  /** Socket timeout error */
  ERR_SOCKET_TIMEOUT: 'ERR_SOCKET_TIMEOUT',

  /** Timeout error code */
  ETIMEDOUT: 'ETIMEDOUT',
};

/**
 * WU-1174: Lock directory name constant
 *
 * Defined separately so it can be used both in LUMENFLOW_PATHS.LOCK_DIR
 * and for test isolation in cleanup-lock.ts/merge-lock.ts.
 */
export const LOCK_DIR_NAME = '.lumenflow-locks';

/**
 * LumenFlow directory paths
 *
 * Centralized paths for .lumenflow directory structure to eliminate hardcoded strings.
 * Used by telemetry, agent-session, agent-incidents, memory, and commands-logger modules.
 */
export const LUMENFLOW_PATHS = {
  /** Base directory for all LumenFlow runtime data */
  BASE: '.lumenflow',

  /** WU state store directory */
  STATE_DIR: '.lumenflow/state',

  /** Stamp directory (WU completion markers) */
  STAMPS_DIR: '.lumenflow/stamps',

  /** Archive directory for old WU events (WU-1430) */
  ARCHIVE_DIR: '.lumenflow/archive',

  /** Merge lock file (runtime coordination, WU-1747) */
  MERGE_LOCK: '.lumenflow/merge.lock',

  /** Base telemetry directory */
  TELEMETRY: '.lumenflow/telemetry',

  /** Flow log file (WU flow events) */
  FLOW_LOG: '.lumenflow/flow.log',

  /** Agent sessions directory */
  SESSIONS: '.lumenflow/sessions',

  /** Agent incidents directory */
  INCIDENTS: '.lumenflow/incidents',

  /** Git commands log file */
  COMMANDS_LOG: '.lumenflow/commands.log',

  /** Memory layer directory */
  MEMORY_DIR: '.lumenflow/memory',

  /** Memory layer JSONL file */
  MEMORY_JSONL: '.lumenflow/memory/memory.jsonl',

  /** Audit log for tool calls */
  AUDIT_LOG: '.lumenflow/telemetry/tools.ndjson',

  /** Feedback drafts directory */
  FEEDBACK_DRAFTS: '.lumenflow/feedback-drafts',

  /** Feedback index file */
  FEEDBACK_INDEX: '.lumenflow/feedback-index.ndjson',

  /** Current session file */
  SESSION_CURRENT: '.lumenflow/sessions/current.json',

  /** WU events log */
  WU_EVENTS: '.lumenflow/state/wu-events.jsonl',

  /** Lock files directory (lane locks - persisted) */
  LOCKS_DIR: '.lumenflow/locks',

  /** Force bypass audit log */
  FORCE_BYPASSES: '.lumenflow/force-bypasses.log',

  /** Test baseline file for ratchet pattern (WU-1430) */
  TEST_BASELINE: '.lumenflow/test-baseline.json',

  /** Templates directory (WU-1430) */
  TEMPLATES_DIR: '.lumenflow/templates',

  /** Spawn prompt templates (WU-1430) */
  SPAWN_PROMPT_DIR: '.lumenflow/templates/spawn-prompt',

  /** Template manifest file (WU-1430) */
  TEMPLATE_MANIFEST: '.lumenflow/templates/manifest.yaml',

  /** Skills directory for agent skills (WU-1430) */
  SKILLS_DIR: '.lumenflow/skills',

  /** Agents directory for agent definitions (WU-1430) */
  AGENTS_DIR: '.lumenflow/agents',

  /** Methodology log for spawn telemetry (WU-1430) */
  METHODOLOGY_LOG: '.lumenflow/telemetry/methodology.ndjson',

  /** Prompt metrics cache (WU-1430) */
  PROMPT_METRICS: '.lumenflow/telemetry/prompt-metrics.json',

  /** Prompt lint results (WU-1430) */
  PROMPT_LINT: '.lumenflow/telemetry/prompt-lint.ndjson',

  /** Recovery markers directory (WU-1430) */
  RECOVERY_DIR: '.lumenflow/recovery',

  /** Checkpoints directory (WU-1430) */
  CHECKPOINTS_DIR: '.lumenflow/checkpoints',

  /** WU-1471: Hook counters directory for auto-checkpoint interval tracking */
  HOOK_COUNTERS_DIR: '.lumenflow/state/hook-counters',

  /** Cache directory under user home (WU-1430) */
  HOME_CACHE: 'cache',

  /**
   * WU-1174: Runtime lock directory for merge/cleanup locks
   *
   * These locks are transient and should NOT be created in the main checkout
   * because wu:done runs from main. Using os.tmpdir() ensures:
   * 1. Locks don't pollute the git working tree
   * 2. Locks work across processes on the same machine
   * 3. No "Working tree is not clean" errors if process crashes
   *
   * Note: Lane locks still use LOCKS_DIR (.lumenflow/locks) because they need
   * to persist across sessions and be visible to other agents.
   */
  LOCK_DIR: path.join(tmpdir(), LOCK_DIR_NAME),
};

/**
 * File extensions
 *
 * Centralized file extension strings to avoid magic strings.
 */
export const FILE_EXTENSIONS = {
  /** Newline-delimited JSON format */
  NDJSON: '.ndjson',

  /** Markdown format */
  MARKDOWN: '.md',

  /** YAML format */
  YAML: '.yaml',

  /** Log format */
  LOG: '.log',

  /** Stamp files (completion markers) */
  STAMP: '.done',
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
 * Path-related constants
 *
 * WU-1062: Centralized path literals for lumenflow-home and spec-branch operations.
 */
export const PATH_LITERALS = {
  /** Tilde prefix for home directory expansion (e.g., ~/path) */
  TILDE_PREFIX: '~/',

  /** Tilde character for home directory */
  TILDE: '~',

  /** Plan file suffix for WU plans */
  PLAN_FILE_SUFFIX: '-plan.md',

  /** Trailing slash regex pattern */
  TRAILING_SLASH_REGEX: /\/+$/,

  /** .lumenflow path prefix for internal path detection (WU-1430) */
  LUMENFLOW_PREFIX: '.lumenflow/',

  /** Current directory prefix for repo-internal paths (WU-1430) */
  CURRENT_DIR_PREFIX: './',
};

/**
 * Slice lengths for path operations
 *
 * WU-1062: Magic numbers extracted for path manipulation.
 */
export const PATH_SLICE_LENGTHS = {
  /** Length of '~/' prefix for tilde expansion */
  TILDE_PREFIX_LENGTH: 2,

  /** Length of '/' for leading slash removal */
  LEADING_SLASH_LENGTH: 1,
};

/**
 * Convert lane name to kebab-case using change-case library
 *
 * Provides null-safe wrapper around paramCase for lane naming.
 * Handles sub-lanes with colon separator and special characters.
 *
 * @param {string|null|undefined} lane - Lane name (e.g., 'Operations: Tooling')
 * @returns {string} Kebab-case lane (e.g., 'operations-tooling')
 *
 * @example
 * toKebab('Operations: Tooling') // 'operations-tooling'
 * toKebab('Core Systems') // 'core-systems'
 * toKebab('Intelligence') // 'intelligence'
 * toKebab(null) // ''
 * toKebab(undefined) // ''
 */
export function toKebab(lane) {
  // Null safety: kebabCase throws on null/undefined
  if (lane == null) return '';
  const normalized = String(lane).trim();
  if (normalized === '') return '';
  return kebabCase(normalized);
}

/**
 * Generate worktree path from lane and WU ID
 *
 * @param {string} lane - Lane name
 * @param {string} id - WU ID
 * @returns {string} Worktree path (e.g., 'worktrees/operations-tooling-wu-123')
 */
export function getWorktreePath(lane, id) {
  const laneKebab = toKebab(lane);
  const idLower = id.toLowerCase();
  return `${DEFAULTS.WORKTREES_DIR}/${laneKebab}-${idLower}`;
}

/**
 * Generate lane branch name from lane and WU ID
 *
 * @param {string} lane - Lane name
 * @param {string} id - WU ID
 * @returns {string} Branch name (e.g., 'lane/operations-tooling/wu-123')
 */
export function getLaneBranch(lane, id) {
  const laneKebab = toKebab(lane);
  const idLower = id.toLowerCase();
  return `lane/${laneKebab}/${idLower}`;
}

// Note: getWuYamlPath and getStampPath removed in WU-1240
// Use WU_PATHS.WU(id) and WU_PATHS.STAMP(id) from wu-paths.ts instead

/**
 * File tool constants (WU-1403)
 *
 * Centralized strings for file:read, file:write, file:edit tools.
 * Prevents duplicate string literals and hardcoded magic values.
 */
export const FILE_TOOLS = {
  /** Tool name prefixes */
  NAMES: {
    READ: 'file:read',
    WRITE: 'file:write',
    EDIT: 'file:edit',
    DELETE: 'file:delete',
  },

  /** Tool domain */
  DOMAIN: 'file',

  /** Permission levels */
  PERMISSIONS: {
    READ: 'read',
    WRITE: 'write',
  },

  /** Worktree instruction templates (WU-1403: provides reusable instruction strings) */
  WORKTREE_INSTRUCTIONS: {
    CLAIM_COMMAND: 'pnpm wu:claim --id <wu-id> --lane "<lane>"',
    CD_COMMAND: 'cd worktrees/<lane>-<wu-id>/',
    DOC_REFERENCE: 'CLAUDE.md §2 (Worktree Discipline)',
  },
};

/**
 * PHI (Protected Health Information) error codes (WU-1404)
 *
 * Error codes for PHI detection in file tools.
 * Used by file:write and file:edit to block PHI leakage.
 *
 * WU-1068: PHI scanning is healthcare-specific functionality.
 * Enable via PHI_CONFIG.ENABLED flag or .lumenflow.config.yaml phi.enabled: true
 */
export const PHI_ERRORS = {
  /** PHI detected in content - write blocked */
  PHI_DETECTED: 'PHI_DETECTED',

  /** PHI override requested - audit logged */
  PHI_OVERRIDE_ALLOWED: 'PHI_OVERRIDE_ALLOWED',
};

/**
 * PHI scanning configuration (WU-1068)
 *
 * Controls whether PHI (Protected Health Information) scanning is enabled.
 * This is healthcare-specific functionality (NHS numbers, UK postcodes)
 * that should only be enabled for healthcare projects.
 *
 * Projects can enable via:
 * 1. Setting PHI_CONFIG.ENABLED = true in code
 * 2. Setting LUMENFLOW_PHI_ENABLED=1 environment variable
 * 3. Adding phi.enabled: true to .lumenflow.config.yaml
 */
export const PHI_CONFIG = {
  /**
   * Whether PHI scanning is enabled
   * Default: false - projects must explicitly opt-in
   */
  ENABLED: process.env.LUMENFLOW_PHI_ENABLED === '1',

  /**
   * Whether to block on PHI detection (true) or just warn (false)
   */
  BLOCKING: process.env.LUMENFLOW_PHI_BLOCKING === '1',
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
    READY_YES: 27, // 50 - len("✅ Ready to claim: YES") - 1
    READY_NO: 28, // 50 - len("⚠️  Ready to claim: NO") - 1
    MISSING_HEADER: 41, // 50 - len("Missing:") - 1
    ERROR_BULLET: 45, // 50 - len("  • ") - 1
  },
};

/**
 * Get project root directory from a module URL
 *
 * WU-923: Centralized path resolution to eliminate '../..' magic strings
 *
 * @param {string} moduleUrl - import.meta.url of the calling module
 * @returns {string} Absolute path to project root
 *
 * @example
 * import { getProjectRoot } from './lib/wu-constants.js';
 * const projectRoot = getProjectRoot(import.meta.url);
 */
export function getProjectRoot(moduleUrl) {
  const { dirname } = path;
  const currentDir = dirname(new URL(moduleUrl).pathname);

  // Traverse up from tools/lib to project root
  let root = currentDir;
  for (let i = 0; i < DEFAULTS.PROJECT_ROOT_DEPTH; i++) {
    root = dirname(root);
  }
  return root;
}

/**
 * Options for discovering safety tests
 */
export interface DiscoverSafetyTestsOptions {
  /** Project root directory */
  projectRoot?: string;
}

/**
 * Discover safety-critical test files
 *
 * WU-2242: Scans for test files matching safety-critical patterns.
 * Uses glob to find all matching files.
 *
 * @param {DiscoverSafetyTestsOptions} options - Discovery options
 * @returns {Promise<string[]>} List of discovered test file paths
 */
export async function discoverSafetyTests(options: DiscoverSafetyTestsOptions = {}) {
  const { projectRoot = process.cwd() } = options;
  const { glob } = await import('glob');
  const foundFiles = [];

  for (const pattern of SAFETY_CRITICAL_TEST_GLOBS) {
    try {
      const matches = await glob(pattern, {
        cwd: projectRoot,
        absolute: false,
      });
      foundFiles.push(...matches);
    } catch {
      // Pattern may not match anything, that's fine
    }
  }

  return [...new Set(foundFiles)]; // Deduplicate
}

/**
 * Validate that required safety-critical tests exist
 *
 * WU-2242: Checks that each pattern category has at least one matching test file.
 * Returns a validation result with missing patterns and found files.
 *
 * @param {DiscoverSafetyTestsOptions} options - Validation options
 * @returns {Promise<{valid: boolean, missingTests: string[], foundTests: string[], error?: string}>}
 */
export async function validateSafetyTestsExist(options: DiscoverSafetyTestsOptions = {}) {
  const { projectRoot = process.cwd() } = options;
  const { glob } = await import('glob');

  const missingTests = [];
  const foundTests = [];

  // Group patterns by category (every 2 patterns form a category)
  const categories = [
    { name: 'PHI protection', patterns: SAFETY_CRITICAL_TEST_GLOBS.slice(0, 2) },
    { name: 'Escalation', patterns: SAFETY_CRITICAL_TEST_GLOBS.slice(2, 4) },
    { name: 'Privacy detection', patterns: SAFETY_CRITICAL_TEST_GLOBS.slice(4, 6) },
    { name: 'Constitutional', patterns: SAFETY_CRITICAL_TEST_GLOBS.slice(6, 8) },
    { name: 'Safe prompt wrapper', patterns: SAFETY_CRITICAL_TEST_GLOBS.slice(8, 10) },
    { name: 'Crisis handling', patterns: SAFETY_CRITICAL_TEST_GLOBS.slice(10, 12) },
  ];

  for (const category of categories) {
    let categoryHasTests = false;

    for (const pattern of category.patterns) {
      try {
        const matches = await glob(pattern, {
          cwd: projectRoot,
          absolute: false,
        });
        if (matches.length > 0) {
          categoryHasTests = true;
          foundTests.push(...matches);
        }
      } catch {
        // Pattern error, treat as no matches
      }
    }

    if (!categoryHasTests) {
      missingTests.push(`${category.name}: ${category.patterns.join(', ')}`);
    }
  }

  const valid = missingTests.length === 0;

  return {
    valid,
    missingTests,
    foundTests: [...new Set(foundTests)],
    error: valid ? undefined : `Missing safety-critical tests: ${missingTests.join('; ')}`,
  };
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

  /** Feature flag keys for .lumenflow.config.yaml */
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
        COMMANDS: ['pnpm wu:claim --id WU-XXXX --lane "<Lane>"', 'cd worktrees/<lane>-wu-xxxx'],
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
      RESOURCES: [
        '• Read: LUMENFLOW.md (workflow overview)',
        '• Read: docs/04-operations/_frameworks/lumenflow/agent/onboarding/',
        '• Run:  pnpm wu:help',
      ],
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
