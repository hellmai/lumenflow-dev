/**
 * Path and File System Constants
 *
 * WU-1549: Extracted from wu-constants.ts for domain-specific modularity.
 * Contains LumenFlow directory paths, file extensions, config files, filesystem
 * constants, build artifacts, PIIconfiguration, and path manipulation helpers.
 *
 * @module wu-paths-constants
 */

import path from 'node:path';
import { tmpdir } from 'node:os';

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
 * Script file paths
 *
 * Centralized paths to validation scripts.
 */
export const SCRIPT_PATHS = {
  /** Prompt registry validation */
  VALIDATE_PROMPT_REGISTRY: 'tools/validate-prompt-registry.js',
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
 * Path patterns for WU-related files
 */
export const PATH_PATTERNS = {
  /** Matches WU YAML paths in both legacy and current locations */
  WU_YAML: /(?:memory-bank|docs\/04-operations)\/tasks\/wu\/(WU-\d+)\.ya?ml$/i,

  /** Matches stamp file paths */
  STAMP: /\.lumenflow\/stamps\/(WU-\d+)\.done$/i,
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

  /** WU-1539: Memory signals JSONL file */
  MEMORY_SIGNALS: '.lumenflow/memory/signals.jsonl',

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
 * PII(Protected Health Information) error codes (WU-1404)
 *
 * Error codes for PIIdetection in file tools.
 * Used by file:write and file:edit to block PIIleakage.
 *
 * WU-1068: PII scanning is regulated-specific functionality.
 * Enable via SENSITIVE_DATA_CONFIG.ENABLED flag or .lumenflow.config.yaml sensitive_scan.enabled: true
 */
export const SENSITIVE_DATA_ERRORS = {
  /** PIIdetected in content - write blocked */
  SENSITIVE_DATA_DETECTED: 'SENSITIVE_DATA_DETECTED',

  /** PIIoverride requested - audit logged */
  SENSITIVE_DATA_OVERRIDE_ALLOWED: 'SENSITIVE_DATA_OVERRIDE_ALLOWED',
};

/**
 * PII scanning configuration (WU-1068)
 *
 * Controls whether PII(Protected Health Information) scanning is enabled.
 * This is regulated-specific functionality (national ID numbers, UK postcodes)
 * that should only be enabled for regulated projects.
 *
 * Projects can enable via:
 * 1. Setting SENSITIVE_DATA_CONFIG.ENABLED = true in code
 * 2. Setting LUMENFLOW_SENSITIVE_SCAN_ENABLED=1 environment variable
 * 3. Adding sensitive_scan.enabled: true to .lumenflow.config.yaml
 */
export const SENSITIVE_DATA_CONFIG = {
  /**
   * Whether PII scanning is enabled
   * Default: false - projects must explicitly opt-in
   */
  ENABLED: process.env.LUMENFLOW_SENSITIVE_SCAN_ENABLED === '1',

  /**
   * Whether to block on PIIdetection (true) or just warn (false)
   */
  BLOCKING: process.env.LUMENFLOW_SENSITIVE_SCAN_BLOCKING === '1',
};
