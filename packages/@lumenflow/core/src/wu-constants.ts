/**
 * Work Unit Constants - Barrel Re-export
 *
 * WU-1549: This file was decomposed from a 2,300+ line monolith into
 * domain-specific modules. It now serves as a backward-compatible barrel
 * re-exporting all constants from their domain modules.
 *
 * Domain modules:
 * - wu-statuses.ts: WU status values, groups, exposure types, claimed modes
 * - wu-git-constants.ts: Git branch names, remotes, refs, flags, commands
 * - wu-paths-constants.ts: LumenFlow paths, file system, PIIconfig
 * - wu-cli-constants.ts: CLI flags, gates, tooling, process constants
 * - wu-ui-constants.ts: Display, formatting, UI, box drawing
 * - wu-domain-constants.ts: Patterns, commit formats, defaults, safety tests
 * - wu-context-constants.ts: Context validation, hooks, derived types
 *
 * @see {@link packages/@lumenflow/cli/src/wu-done.ts} - Primary consumer
 * @see {@link packages/@lumenflow/cli/src/wu-claim.ts} - Branch/worktree creation
 * @see {@link packages/@lumenflow/cli/src/lib/wu-schema.ts} - PLACEHOLDER_SENTINEL
 */

// WU Status constants
export {
  WU_STATUS,
  PROTECTED_WU_STATUSES,
  PROGRESSABLE_WU_STATUSES,
  WU_STATUS_GROUPS,
  CLAIMED_MODES,
  INCIDENT_SEVERITY,
  WU_TYPES,
  WU_EXPOSURE,
  WU_EXPOSURE_VALUES,
  TEST_TYPES,
} from './wu-statuses.js';

// Git constants
export {
  BRANCHES,
  REMOTES,
  GIT_REFS,
  GIT,
  REAL_GIT,
  GIT_FLAGS,
  GIT_COMMANDS,
  GIT_COMMAND_STRINGS,
} from './wu-git-constants.js';

// Path and filesystem constants
export {
  FILE_SYSTEM,
  CONFIG_FILES,
  DIRECTORIES,
  BUILD_ARTIFACT_GLOBS,
  BUILD_ARTIFACT_IGNORES,
  SCRIPT_PATHS,
  FILE_EXTENSIONS,
  PATH_PATTERNS,
  PATH_LITERALS,
  PATH_SLICE_LENGTHS,
  LOCK_DIR_NAME,
  LUMENFLOW_PATHS,
  FILE_TOOLS,
  SENSITIVE_DATA_ERRORS,
  SENSITIVE_DATA_CONFIG,
  type NodeFsError,
} from './wu-paths-constants.js';

// CLI and tooling constants
export {
  CLI_FLAGS,
  PKG_FLAGS,
  ESLINT_FLAGS,
  SCRIPTS,
  GATE_NAMES,
  GATE_COMMANDS,
  CLI_MODES,
  PRETTIER_FLAGS,
  PKG_MANAGER,
  PKG_COMMANDS,
  PACKAGES,
  STDIO,
  STDIO_MODES,
  EXIT_CODES,
  STREAM_ERRORS,
  ESLINT_COMMANDS,
  ESLINT_DEFAULTS,
  CACHE_STRATEGIES,
  PRETTIER_ARGS,
  AUDIT_ARGS,
  SHELL_COMMANDS,
  TOOLS,
  GITLEAKS_ARGS,
  KNOWN_PACKAGES,
  ERROR_CODES,
  MICRO_WORKTREE_OPERATIONS,
  TELEMETRY_STEPS,
  SKIP_GATES_REASONS,
  CHECKPOINT_MESSAGES,
  PROCESS_DETECTION,
} from './wu-cli-constants.js';

// UI and display constants
export {
  BACKLOG_SECTIONS,
  BACKLOG_BULLET_FORMAT,
  STATUS_SECTIONS,
  LOG_PREFIX,
  EMOJI,
  BOX,
  UI,
  DISPLAY_LIMITS,
  YAML_OPTIONS,
  ARGV_INDICES,
  STRING_LITERALS,
  READINESS_UI,
} from './wu-ui-constants.js';

// Domain constants and utilities
export {
  PATTERNS,
  COMMIT_FORMATS,
  CONSISTENCY_TYPES,
  CONSISTENCY_MESSAGES,
  WORKTREE_WARNINGS,
  CLEANUP_GUARD,
  SESSION,
  VALIDATION,
  THRESHOLDS,
  DEFAULTS,
  WU_DEFAULTS,
  SAFETY_CRITICAL_TEST_GLOBS,
  LANE_PATH_PATTERNS,
  toKebab,
  getWorktreePath,
  getLaneBranch,
  getProjectRoot,
  discoverSafetyTests,
  validateSafetyTestsExist,
  type DiscoverSafetyTestsOptions,
} from './wu-domain-constants.js';

// Context validation constants and types
export {
  CONTEXT_VALIDATION,
  HOOK_MESSAGES,
  CLAUDE_HOOKS,
  getHookCommand,
  type LocationType,
  type ValidationErrorCode,
  type RecoveryActionType,
  type RecoveryIssueCode,
  type PredicateSeverity,
  type ValidationMode,
} from './wu-context-constants.js';
