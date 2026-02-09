/**
 * Git Constants
 *
 * WU-1549: Extracted from wu-constants.ts for domain-specific modularity.
 * Contains git branch names, remotes, refs, flags, commands, and display constants.
 *
 * @module wu-git-constants
 */

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
  remote: (remoteName: string, branchName: string) => `${remoteName}/${branchName}`,
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
 * infinite recursion: shim -> helper -> git -> shim -> helper -> git -> ...
 *
 * With VS Code extensions making dozens of git calls per second, this causes
 * memory exhaustion within seconds -> OOM crash -> system reboot.
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
