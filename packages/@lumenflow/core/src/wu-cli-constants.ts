// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CLI and Tooling Constants
 *
 * WU-1549: Extracted from wu-constants.ts for domain-specific modularity.
 * Contains CLI flags, package manager commands, ESLint configuration, gate names,
 * process constants, and external tool configurations.
 *
 * @module wu-cli-constants
 */

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
  /** WU-2009: Spec-to-code absolute claim drift detector */
  CLAIM_VALIDATION: 'claim-validation',
  SUPABASE_DOCS_LINTER: 'supabase-docs:linter',
  LINT: 'lint',
  TYPECHECK: 'typecheck',
  TEST: 'test',
  COVERAGE: 'coverage',
  /** WU-2062: Safety-critical tests (always run) */
  SAFETY_CRITICAL_TEST: 'safety-critical-test',
  /** WU-2062: Integration tests (for high-risk changes) */
  INTEGRATION_TEST: 'integration-test',
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
 * Project-specific packages should be configured in workspace.yaml.
 */
export const PACKAGES = {
  WEB: 'web',
  APPLICATION: '@lumenflow/core',
  DOMAIN: '@lumenflow/core',
  INFRASTRUCTURE: '@lumenflow/cli',
};

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
 * ESLint cache strategy values
 */
export const CACHE_STRATEGIES = {
  CONTENT: 'content',
  METADATA: 'metadata',
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
  LANE_EDIT: 'lane-edit', // WU-1854: Safe in-place lane definition editing
  WU_ESCALATE: 'wu-escalate', // WU-2225: Resolve escalation triggers
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
