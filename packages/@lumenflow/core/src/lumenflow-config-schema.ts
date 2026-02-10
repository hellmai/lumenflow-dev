/**
 * LumenFlow Configuration Schema
 *
 * Zod schemas for LumenFlow configuration.
 * All paths and settings are configurable via .lumenflow.config.yaml
 *
 * @module lumenflow-config-schema
 */

import { z } from 'zod';

// WU-1067: Import gates execution schema from canonical source
import { GatesExecutionConfigSchema } from './gates-config.js';
// WU-1259: Import methodology config schema for resolvePolicy()
import { MethodologyConfigSchema } from './resolve-policy.js';
import { LUMENFLOW_CLIENT_IDS } from './wu-context-constants.js';

/**
 * WU-1356: Package manager options
 *
 * Supported package managers for LumenFlow CLI operations.
 * Used for build commands, dependency installation, and script execution.
 *
 * @example
 * ```yaml
 * package_manager: npm
 * ```
 */
export const PackageManagerSchema = z.enum(['pnpm', 'npm', 'yarn', 'bun']).default('pnpm');

/** WU-1356: TypeScript type for package manager */
export type PackageManager = z.infer<typeof PackageManagerSchema>;

/**
 * WU-1356: Test runner options
 *
 * Supported test runners for incremental test detection and execution.
 * Determines how changed tests are detected and ignore patterns are derived.
 *
 * @example
 * ```yaml
 * test_runner: jest
 * ```
 */
export const TestRunnerSchema = z.enum(['vitest', 'jest', 'mocha']).default('vitest');

/** WU-1356: TypeScript type for test runner */
export type TestRunner = z.infer<typeof TestRunnerSchema>;

/**
 * WU-1356: Gates commands configuration
 *
 * Configurable test commands for gates execution.
 * Replaces hard-coded turbo/vitest commands with user-configurable alternatives.
 *
 * @example
 * ```yaml
 * gates:
 *   commands:
 *     test_full: 'npm test'
 *     test_docs_only: 'npm test -- --testPathPattern=docs'
 *     test_incremental: 'npm test -- --onlyChanged'
 * ```
 */
export const GatesCommandsConfigSchema = z.object({
  /**
   * Command to run full test suite.
   * Default: 'pnpm turbo run test'
   */
  test_full: z.string().default('pnpm turbo run test'),

  /**
   * Command to run tests in docs-only mode.
   * Default: empty (skip tests in docs-only mode)
   */
  test_docs_only: z.string().default(''),

  /**
   * Command to run incremental tests (changed files only).
   * Default: 'pnpm vitest run --changed origin/main'
   */
  test_incremental: z.string().default('pnpm vitest run --changed origin/main'),

  /**
   * Command to run lint checks.
   * Default: 'pnpm lint'
   */
  lint: z.string().optional(),

  /**
   * Command to run type checks.
   * Default: 'pnpm typecheck'
   */
  typecheck: z.string().optional(),

  /**
   * Command to run format checks.
   * Default: 'pnpm format:check'
   */
  format: z.string().optional(),
});

/** WU-1356: TypeScript type for gates commands config */
export type GatesCommandsConfig = z.infer<typeof GatesCommandsConfigSchema>;

/**
 * WU-1325: Lock policy for lane-level WIP enforcement
 *
 * Controls how lane locks behave:
 * - 'all' (default): Lock acquired on claim, held through block, released on done
 * - 'active': Lock acquired on claim, released on block, re-acquired on unblock
 * - 'none': No lock files created, WIP checking disabled
 *
 * @example
 * ```yaml
 * lanes:
 *   definitions:
 *     - name: 'Content: Documentation'
 *       wip_limit: 4
 *       lock_policy: 'none'  # Docs don't need lock coordination
 * ```
 */
export const LockPolicySchema = z.enum(['all', 'active', 'none']).default('all');

/** WU-1325: TypeScript type for lock policy */
export type LockPolicy = z.infer<typeof LockPolicySchema>;

/**
 * Event archival configuration (WU-1207)
 *
 * Configures archival of old WU events from .lumenflow/state/wu-events.jsonl
 * to .lumenflow/archive/wu-events-YYYY-MM.jsonl to prevent unbounded growth.
 */
export const EventArchivalConfigSchema = z.object({
  /**
   * Archive events older than this duration in milliseconds (default: 90 days).
   * Completed WU events older than this are moved to monthly archive files.
   * Active WU events (in_progress/blocked/waiting) are never archived.
   */
  archiveAfter: z
    .number()
    .int()
    .positive()
    .default(90 * 24 * 60 * 60 * 1000),

  /**
   * Whether to keep archive files (default: true).
   * When true, archived events are preserved in monthly archive files.
   * When false, archived events are deleted (not recommended for audit trails).
   */
  keepArchives: z.boolean().default(true),
});

/**
 * Directory paths configuration
 */
export const DirectoriesSchema = z.object({
  /** Working directory for web app (default: 'apps/web/') */
  appsWeb: z.string().default('apps/web/'),

  /** Worktrees directory (default: 'worktrees/') */
  worktrees: z.string().default('worktrees/'),

  /** AI assets directory (default: 'ai/') */
  ai: z.string().default('ai/'),

  /** Claude configuration directory (default: '.claude/') */
  claude: z.string().default('.claude/'),

  /** Documentation root (default: 'docs/') */
  docs: z.string().default('docs/'),

  /** Packages directory (default: 'packages/') */
  packages: z.string().default('packages/'),

  /** Tools directory (default: 'tools/') */
  tools: z.string().default('tools/'),

  /** Memory bank directory (default: 'memory-bank/') */
  memoryBank: z.string().default('memory-bank/'),

  /** WU YAML files directory (default: 'docs/04-operations/tasks/wu') */
  wuDir: z.string().default('docs/04-operations/tasks/wu'),

  /** Initiatives directory (default: 'docs/04-operations/tasks/initiatives') */
  initiativesDir: z.string().default('docs/04-operations/tasks/initiatives'),

  /** Backlog file path (default: 'docs/04-operations/tasks/backlog.md') */
  backlogPath: z.string().default('docs/04-operations/tasks/backlog.md'),

  /** Status file path (default: 'docs/04-operations/tasks/status.md') */
  statusPath: z.string().default('docs/04-operations/tasks/status.md'),

  /** Skills directory (default: '.claude/skills') */
  skillsDir: z.string().default('.claude/skills'),

  /** Agents directory (default: '.claude/agents') */
  agentsDir: z.string().default('.claude/agents'),

  /** Plans directory (default: 'docs/04-operations/plans') - WU-1301 */
  plansDir: z.string().default('docs/04-operations/plans'),

  /** Templates directory (default: '.lumenflow/templates') - WU-1310 */
  templatesDir: z.string().default('.lumenflow/templates'),

  /** Onboarding directory (default: 'docs/04-operations/_frameworks/lumenflow/agent/onboarding') - WU-1310 */
  onboardingDir: z.string().default('docs/04-operations/_frameworks/lumenflow/agent/onboarding'),
});

/**
 * State paths configuration (.lumenflow directory structure)
 */
export const StatePathsSchema = z.object({
  /** Base state directory (default: '.lumenflow') */
  base: z.string().default('.lumenflow'),

  /** State directory (default: '.lumenflow/state') */
  stateDir: z.string().default('.lumenflow/state'),

  /** Archive directory (default: '.lumenflow/archive') */
  archiveDir: z.string().default('.lumenflow/archive'),

  /** Stamps directory (default: '.lumenflow/stamps') */
  stampsDir: z.string().default('.lumenflow/stamps'),

  /** Merge lock file (default: '.lumenflow/merge.lock') */
  mergeLock: z.string().default('.lumenflow/merge.lock'),

  /** Telemetry directory (default: '.lumenflow/telemetry') */
  telemetry: z.string().default('.lumenflow/telemetry'),

  /** Flow log file (default: '.lumenflow/flow.log') */
  flowLog: z.string().default('.lumenflow/flow.log'),

  /** Sessions directory (default: '.lumenflow/sessions') */
  sessions: z.string().default('.lumenflow/sessions'),

  /** Incidents directory (default: '.lumenflow/incidents') */
  incidents: z.string().default('.lumenflow/incidents'),

  /** Commands log file (default: '.lumenflow/commands.log') */
  commandsLog: z.string().default('.lumenflow/commands.log'),

  /**
   * WU-1207: Event archival configuration
   * Controls archival of old WU events to prevent unbounded growth.
   */
  eventArchival: EventArchivalConfigSchema.default(() => EventArchivalConfigSchema.parse({})),
});

/**
 * WU-1332: Push retry configuration for micro-worktree operations
 *
 * When non-fast-forward push errors occur (origin/main moved during operation),
 * retry with exponential backoff. Uses p-retry for robust retry behavior.
 */
export const PushRetryConfigSchema = z.object({
  /**
   * Enable push retry with rebase on non-fast-forward errors.
   * When true, failed pushes trigger automatic rebase and retry.
   * When false, the original error is thrown immediately.
   * @default true
   */
  enabled: z.boolean().default(true),

  /**
   * Maximum number of retry attempts (including the initial attempt).
   * After this many failures, the operation fails with clear guidance.
   * @default 3
   */
  retries: z.number().int().positive().default(3),

  /**
   * Minimum delay in milliseconds between retries.
   * Used as the base for exponential backoff.
   * @default 100
   */
  min_delay_ms: z.number().int().nonnegative().default(100),

  /**
   * Maximum delay in milliseconds between retries.
   * Caps the exponential backoff to prevent excessive waits.
   * @default 1000
   */
  max_delay_ms: z.number().int().positive().default(1000),

  /**
   * Add randomization to retry delays (recommended for concurrent agents).
   * Helps prevent thundering herd when multiple agents retry simultaneously.
   * @default true
   */
  jitter: z.boolean().default(true),
});

/**
 * Git configuration
 */
export const GitConfigSchema = z.object({
  /** Main branch name (default: 'main') */
  mainBranch: z.string().default('main'),

  /** Default remote name (default: 'origin') */
  defaultRemote: z.string().default('origin'),

  /** Lane branch prefix (default: 'lane/') */
  laneBranchPrefix: z.string().default('lane/'),

  /** Temporary branch prefix (default: 'tmp/') */
  tempBranchPrefix: z.string().default('tmp/'),

  /** Real git executable path (default: '/usr/bin/git') */
  realGitPath: z.string().default('/usr/bin/git'),

  /** Maximum commits behind main before requiring rebase */
  maxBranchDrift: z.number().int().positive().default(20),

  /** Warning threshold for branch drift */
  branchDriftWarning: z.number().int().positive().default(15),

  /** Info threshold for branch drift */
  branchDriftInfo: z.number().int().positive().default(10),

  /**
   * WU-1302: Require a remote repository for wu:create and wu:claim.
   * When true (default), operations fail if no remote 'origin' exists.
   * When false, operations can proceed locally without pushing.
   *
   * Use `git.requireRemote: false` for:
   * - Local-only development before remote is set up
   * - Air-gapped environments
   * - Testing/evaluation of LumenFlow
   *
   * @default true
   *
   * @example
   * ```yaml
   * git:
   *   requireRemote: false  # Allow offline/local mode
   * ```
   */
  requireRemote: z.boolean().default(true),

  /**
   * Agent branch patterns to MERGE with the registry patterns.
   * These patterns are merged with patterns from lumenflow.dev/registry/agent-patterns.json.
   * Use this to add custom patterns that should work alongside the standard vendor patterns.
   * Protected branches (mainBranch + 'master') are NEVER bypassed.
   *
   * WU-1089: Changed default from ['agent/*'] to [] to allow registry to be used by default.
   *
   * @example
   * ```yaml
   * git:
   *   agentBranchPatterns:
   *     - 'my-custom-agent/*'
   *     - 'internal-tool/*'
   * ```
   */
  agentBranchPatterns: z.array(z.string()).default([]),

  /**
   * Agent branch patterns that REPLACE the registry patterns entirely.
   * When set, these patterns are used instead of fetching from the registry.
   * The agentBranchPatterns field is ignored when this is set.
   *
   * Use this for strict control over which agent patterns are allowed.
   *
   * @example
   * ```yaml
   * git:
   *   agentBranchPatternsOverride:
   *     - 'claude/*'
   *     - 'codex/*'
   * ```
   */
  agentBranchPatternsOverride: z.array(z.string()).optional(),

  /**
   * Disable fetching agent patterns from the registry (airgapped mode).
   * When true, only uses agentBranchPatterns from config or defaults to ['agent/*'].
   * Useful for environments without network access or strict security requirements.
   *
   * @default false
   *
   * @example
   * ```yaml
   * git:
   *   disableAgentPatternRegistry: true
   *   agentBranchPatterns:
   *     - 'claude/*'
   *     - 'cursor/*'
   * ```
   */
  disableAgentPatternRegistry: z.boolean().default(false),

  /**
   * WU-1332: Push retry configuration for micro-worktree operations.
   * When push fails due to non-fast-forward (origin moved), automatically
   * rebase and retry with exponential backoff.
   *
   * @example
   * ```yaml
   * git:
   *   push_retry:
   *     enabled: true
   *     retries: 5        # Try 5 times total
   *     min_delay_ms: 200 # Start with 200ms delay
   *     max_delay_ms: 2000 # Cap at 2 second delay
   *     jitter: true      # Add randomization
   * ```
   */
  push_retry: PushRetryConfigSchema.default(() => PushRetryConfigSchema.parse({})),
});

/**
 * WU (Work Unit) configuration
 */
export const WuConfigSchema = z.object({
  /** WU ID pattern (regex string, default: '^WU-\\d+$') */
  idPattern: z.string().default('^WU-\\d+$'),

  /** Minimum description length (default: 50) */
  minDescriptionLength: z.number().int().nonnegative().default(50),

  /** Maximum commit subject length (default: 100) */
  maxCommitSubject: z.number().int().positive().default(100),

  /** Default priority (default: 'P2') */
  defaultPriority: z.string().default('P2'),

  /** Default status (default: 'ready') */
  defaultStatus: z.string().default('ready'),

  /** Default type (default: 'feature') */
  defaultType: z.string().default('feature'),
});

/**
 * Gates configuration
 * Note: GatesExecutionConfigSchema is imported from gates-config.ts
 */
export const GatesConfigSchema = z.object({
  /** Maximum ESLint warnings allowed (default: 100) */
  maxEslintWarnings: z.number().int().nonnegative().default(100),

  /** Enable coverage gate (default: true) */
  enableCoverage: z.boolean().default(true),

  /** Minimum coverage percentage (default: 90) */
  minCoverage: z.number().min(0).max(100).default(90),

  /** Enable safety-critical tests (default: true) */
  enableSafetyCriticalTests: z.boolean().default(true),

  /** Enable invariants check (default: true) */
  enableInvariants: z.boolean().default(true),

  /**
   * WU-1067: Config-driven gates execution
   * Custom commands for each gate, with optional preset expansion.
   * When set, gates runner uses these instead of hardcoded commands.
   */
  execution: GatesExecutionConfigSchema.optional(),

  /**
   * WU-1356: Configurable gate commands
   * Replaces hard-coded turbo/vitest commands with user-configurable alternatives.
   * Enables LumenFlow to work with npm/yarn/bun, Nx/plain scripts, Jest/Mocha, etc.
   */
  commands: GatesCommandsConfigSchema.default(() => GatesCommandsConfigSchema.parse({})),

  /**
   * WU-1356: Ignore patterns for test runners
   * Patterns to ignore when detecting changed tests.
   * Default: ['.turbo'] for vitest (derived from test_runner if not specified)
   */
  ignore_patterns: z.array(z.string()).optional(),

  /**
   * WU-1191: Lane health gate mode
   * Controls how lane health check behaves during gates.
   * - 'warn': Log warning if issues found (default)
   * - 'error': Fail gates if issues found
   * - 'off': Skip lane health check
   */
  lane_health: z.enum(['warn', 'error', 'off']).default('warn'),
});

/**
 * WU-1203: Progress signals configuration for sub-agent coordination
 *
 * When enabled, spawn prompts will include mandatory progress signal directives
 * at configurable triggers (milestone completion, tests pass, before gates, when blocked).
 * Frequency-based signals (every N tool calls) also supported.
 *
 * Addresses sub-agent coordination needs without unnecessary token waste.
 */
export const ProgressSignalsConfigSchema = z.object({
  /**
   * Enable mandatory progress signals in spawn prompts.
   * When true, spawn prompts show "Progress Signals (Required at Milestones)"
   * When false, spawn prompts show "Progress Signals (Optional)"
   * @default false
   */
  enabled: z.boolean().default(false),

  /**
   * Send progress signals every N tool calls.
   * Set to 0 to disable frequency-based signals.
   * @default 0
   */
  frequency: z.number().int().nonnegative().default(0),

  /**
   * Signal after each acceptance criterion is completed.
   * @default true
   */
  on_milestone: z.boolean().default(true),

  /**
   * Signal when tests first pass.
   * @default true
   */
  on_tests_pass: z.boolean().default(true),

  /**
   * Signal before running gates.
   * @default true
   */
  before_gates: z.boolean().default(true),

  /**
   * Signal when work is blocked.
   * @default true
   */
  on_blocked: z.boolean().default(true),

  /**
   * Automatically checkpoint memory at signal milestones.
   * @default false
   */
  auto_checkpoint: z.boolean().default(false),
});

/**
 * Signal cleanup configuration (WU-1204)
 *
 * Configures TTL-based cleanup for signals in .lumenflow/memory/signals.jsonl
 * to prevent unbounded growth.
 */
export const SignalCleanupConfigSchema = z.object({
  /**
   * TTL for read signals in milliseconds (default: 7 days).
   * Read signals older than this are removed during cleanup.
   */
  ttl: z
    .number()
    .int()
    .positive()
    .default(7 * 24 * 60 * 60 * 1000),

  /**
   * TTL for unread signals in milliseconds (default: 30 days).
   * Unread signals get a longer TTL to ensure important signals aren't missed.
   */
  unreadTtl: z
    .number()
    .int()
    .positive()
    .default(30 * 24 * 60 * 60 * 1000),

  /**
   * Maximum number of signals to retain (default: 500).
   * When exceeded, oldest signals are removed first (keeping newest).
   * Active WU signals are always retained regardless of this limit.
   */
  maxEntries: z.number().int().positive().default(500),
});

/**
 * WU-1471: Auto-checkpoint configuration
 *
 * Controls automatic checkpointing behavior via Claude Code hooks.
 * When enabled and hooks are active, PostToolUse and SubagentStop hooks
 * create checkpoints at configurable intervals.
 *
 * @example
 * ```yaml
 * memory:
 *   enforcement:
 *     auto_checkpoint:
 *       enabled: true
 *       interval_tool_calls: 30
 * ```
 */
export const AutoCheckpointConfigSchema = z.object({
  /**
   * Enable auto-checkpoint hooks.
   * When true (and hooks master switch is enabled), generates PostToolUse
   * and SubagentStop hooks that create checkpoints automatically.
   * @default false
   */
  enabled: z.boolean().default(false),

  /**
   * Number of tool calls between automatic checkpoints.
   * The hook script tracks a per-WU counter and checkpoints
   * when the counter reaches this interval.
   * @default 30
   */
  interval_tool_calls: z.number().int().positive().default(30),
});

/** WU-1471: TypeScript type for auto-checkpoint config */
export type AutoCheckpointConfig = z.infer<typeof AutoCheckpointConfigSchema>;

/**
 * WU-1471: Memory enforcement configuration
 *
 * Controls enforcement of memory layer practices:
 * - Auto-checkpointing via hooks
 * - Checkpoint gate on wu:done
 *
 * @example
 * ```yaml
 * memory:
 *   enforcement:
 *     auto_checkpoint:
 *       enabled: true
 *       interval_tool_calls: 30
 *     require_checkpoint_for_done: warn
 * ```
 */
export const MemoryEnforcementConfigSchema = z.object({
  /**
   * Auto-checkpoint configuration.
   * Controls automatic checkpointing via hooks.
   */
  auto_checkpoint: AutoCheckpointConfigSchema.default(() => AutoCheckpointConfigSchema.parse({})),

  /**
   * Checkpoint requirement for wu:done.
   * - 'off': No checkpoint check during wu:done
   * - 'warn': Warn if no checkpoints exist (default, fail-open)
   * - 'block': Block wu:done if no checkpoints exist
   * @default 'warn'
   */
  require_checkpoint_for_done: z.enum(['off', 'warn', 'block']).default('warn'),
});

/** WU-1471: TypeScript type for memory enforcement config */
export type MemoryEnforcementConfig = z.infer<typeof MemoryEnforcementConfigSchema>;

/**
 * WU-1474: Memory decay policy configuration
 *
 * Controls automated archival of stale memory nodes during lifecycle events.
 * When enabled with trigger=on_done, wu:done will invoke decay archival
 * using the configured threshold and half-life parameters.
 *
 * Fail-open: archival errors never block wu:done completion.
 *
 * @example
 * ```yaml
 * memory:
 *   decay:
 *     enabled: true
 *     threshold: 0.1
 *     half_life_days: 30
 *     trigger: on_done
 * ```
 */
export const MemoryDecayConfigSchema = z.object({
  /**
   * Enable decay-based archival.
   * When false, no automatic archival is triggered.
   * @default false
   */
  enabled: z.boolean().default(false),

  /**
   * Decay score threshold below which nodes are archived.
   * Nodes with a decay score below this value are marked as archived.
   * Must be between 0 and 1 inclusive.
   * @default 0.1
   */
  threshold: z.number().min(0).max(1).default(0.1),

  /**
   * Half-life for decay scoring in days.
   * Controls how quickly nodes lose relevance over time.
   * Must be a positive integer.
   * @default 30
   */
  half_life_days: z.number().int().positive().default(30),

  /**
   * When to trigger decay archival.
   * - 'on_done': Run during wu:done completion lifecycle
   * - 'manual': Only run via pnpm mem:cleanup
   * @default 'on_done'
   */
  trigger: z.enum(['on_done', 'manual']).default('on_done'),
});

/** WU-1474: TypeScript type for memory decay config */
export type MemoryDecayConfig = z.infer<typeof MemoryDecayConfigSchema>;

/**
 * Memory layer configuration
 */
export const MemoryConfigSchema = z.object({
  /** Memory directory (default: 'memory-bank/') */
  directory: z.string().default('memory-bank/'),

  /** Session TTL in milliseconds (default: 7 days) */
  sessionTtl: z
    .number()
    .int()
    .positive()
    .default(7 * 24 * 60 * 60 * 1000),

  /** Checkpoint TTL in milliseconds (default: 30 days) */
  checkpointTtl: z
    .number()
    .int()
    .positive()
    .default(30 * 24 * 60 * 60 * 1000),

  /** Enable auto-cleanup (default: true) */
  enableAutoCleanup: z.boolean().default(true),

  /**
   * WU-1203: Progress signals configuration for sub-agent coordination.
   * Optional - when not provided, spawn prompts show "Progress Signals (Optional)".
   */
  progress_signals: ProgressSignalsConfigSchema.optional(),

  /**
   * WU-1204: Signal cleanup configuration
   * Controls TTL-based cleanup for signals.jsonl to prevent unbounded growth.
   */
  signalCleanup: SignalCleanupConfigSchema.default(() => SignalCleanupConfigSchema.parse({})),

  /**
   * WU-1289: Maximum size in bytes for spawn memory context.
   * Controls the maximum size of memory context injected into wu:spawn prompts.
   * Larger values include more context but increase token usage.
   * @default 4096 (4KB)
   */
  spawn_context_max_size: z.number().int().positive().default(4096),

  /**
   * WU-1471: Memory enforcement configuration.
   * Controls auto-checkpointing and checkpoint requirements for wu:done.
   * Optional - when not provided, existing WU-1943 warn behavior applies.
   */
  enforcement: MemoryEnforcementConfigSchema.optional(),

  /**
   * WU-1474: Decay policy configuration.
   * Controls automated archival of stale memory nodes during lifecycle events.
   * Optional - when not provided, no automatic decay archival runs.
   */
  decay: MemoryDecayConfigSchema.optional(),
});

/**
 * UI configuration
 */
export const UiConfigSchema = z.object({
  /** Error box width (default: 70) */
  errorBoxWidth: z.number().int().positive().default(70),

  /** Status preview lines (default: 5) */
  statusPreviewLines: z.number().int().positive().default(5),

  /** Readiness box width (default: 50) */
  readinessBoxWidth: z.number().int().positive().default(50),
});

/**
 * YAML serialization configuration
 */
/**
 * YAML serialization configuration
 */
export const YamlConfigSchema = z.object({
  /** Line width for YAML output (default: 100, -1 for no wrap) */
  lineWidth: z.number().int().default(100),
});

/**
 * Methodology defaults (agent-facing project defaults)
 */
export const DEFAULT_METHODOLOGY_PRINCIPLES = [
  'TDD',
  'Hexagonal Architecture',
  'SOLID',
  'DRY',
  'YAGNI',
  'KISS',
  'Library-First',
];

export const MethodologyDefaultsSchema = z.object({
  /** Enable or disable project defaults output */
  enabled: z.boolean().default(true),

  /** Whether defaults are required or recommended */
  enforcement: z.enum(['required', 'recommended']).default('required'),

  /** Default methodology principles to apply */
  principles: z.array(z.string()).default(DEFAULT_METHODOLOGY_PRINCIPLES),

  /** Optional notes appended to Project Defaults */
  notes: z.string().optional(),
});

/**
 * Client-specific blocks (agent-facing spawn blocks)
 */
export const ClientBlockSchema = z.object({
  /** Block title */
  title: z.string(),

  /** Block content (markdown allowed) */
  content: z.string(),
});

/**
 * Client-specific skills guidance
 */
export const ClientSkillsSchema = z.object({
  /** Optional skills selection guidance text */
  instructions: z.string().optional(),

  /** Recommended skills to load for this client */
  recommended: z.array(z.string()).default([]),

  /**
   * WU-1142: Lane-specific skills to recommend
   * Maps lane names to arrays of skill names
   * @example
   * byLane:
   *   'Framework: Core': ['tdd-workflow', 'lumenflow-gates']
   *   'Content: Documentation': ['worktree-discipline']
   */
  byLane: z.record(z.string(), z.array(z.string())).optional(),
});

/**
 * WU-1367: Client enforcement configuration
 *
 * Configures workflow compliance enforcement via Claude Code hooks.
 * When enabled, hooks block non-compliant operations instead of relying
 * on agents to remember workflow rules.
 *
 * @example
 * ```yaml
 * agents:
 *   clients:
 *     claude-code:
 *       enforcement:
 *         hooks: true
 *         block_outside_worktree: true
 *         require_wu_for_edits: true
 *         warn_on_stop_without_wu_done: true
 * ```
 */
export const ClientEnforcementSchema = z.object({
  /**
   * Enable enforcement hooks.
   * When true, hooks are generated in .claude/hooks/
   * @default false
   */
  hooks: z.boolean().default(false),

  /**
   * Block Write/Edit operations when cwd is not a worktree.
   * Prevents accidental edits to main checkout.
   * @default false
   */
  block_outside_worktree: z.boolean().default(false),

  /**
   * Require a claimed WU for Write/Edit operations.
   * Ensures all edits are associated with tracked work.
   * @default false
   */
  require_wu_for_edits: z.boolean().default(false),

  /**
   * Warn when session ends without wu:done being called.
   * Reminds agents to complete their work properly.
   * @default false
   */
  warn_on_stop_without_wu_done: z.boolean().default(false),
});

/** WU-1367: TypeScript type for client enforcement config */
export type ClientEnforcement = z.infer<typeof ClientEnforcementSchema>;

/**
 * Client configuration (per-client settings)
 */
export const ClientConfigSchema = z.object({
  /** Preamble file path (e.g. 'CLAUDE.md') or false to disable */
  preamble: z.union([z.string(), z.boolean()]).optional(),

  /** Skills directory path */
  skillsDir: z.string().optional(),

  /** Agents directory path */
  agentsDir: z.string().optional(),

  /** Client-specific blocks injected into wu:spawn output */
  blocks: z.array(ClientBlockSchema).default([]),

  /** Client-specific skills guidance for wu:spawn */
  skills: ClientSkillsSchema.optional(),

  /**
   * WU-1367: Enforcement configuration for Claude Code hooks.
   * When enabled, generates hooks that enforce workflow compliance.
   */
  enforcement: ClientEnforcementSchema.optional(),
});

/**
 * Agents configuration
 */
export const AgentsConfigSchema = z.object({
  /** Default client to use if not specified (default: 'claude-code') */
  defaultClient: z.string().default(LUMENFLOW_CLIENT_IDS.CLAUDE_CODE),

  /** Client-specific configurations */
  clients: z.record(z.string(), ClientConfigSchema).default({}),

  /** Project methodology defaults (agent-facing) */
  methodology: MethodologyDefaultsSchema.default(() => MethodologyDefaultsSchema.parse({})),
});

/**
 * Validation mode for context-aware commands
 * WU-1090: Context-aware state machine for WU lifecycle commands
 */
export const ValidationModeSchema = z.enum(['off', 'warn', 'error']).default('warn');

/**
 * Experimental features configuration
 * WU-1090: Feature flags for gradual rollout
 */
export const ExperimentalConfigSchema = z.object({
  /**
   * Enable context-aware validation for wu:* commands
   * When enabled, commands will check location, WU status, and predicates
   * @default true
   */
  context_validation: z.boolean().default(true),

  /**
   * Validation behavior mode
   * - 'off': No validation (legacy behavior)
   * - 'warn': Show warnings but proceed
   * - 'error': Block on validation failures
   * @default 'warn'
   */
  validation_mode: ValidationModeSchema,

  /**
   * Show next steps guidance after successful command completion
   * @default true
   */
  show_next_steps: z.boolean().default(true),

  /**
   * Enable wu:recover command for state recovery
   * @default true
   */
  recovery_command: z.boolean().default(true),
});

/**
 * WU-1270: Methodology telemetry configuration
 *
 * Opt-in telemetry to track which methodology modes are being used.
 * Privacy-preserving: No PII or project-identifying information collected.
 */
export const MethodologyTelemetryConfigSchema = z.object({
  /**
   * Enable methodology telemetry (opt-in).
   * When true, tracks methodology.testing and methodology.architecture values
   * on wu:spawn events. Data is privacy-preserving (no PII/project info).
   * @default false
   */
  enabled: z.boolean().default(false),
});

/**
 * WU-1270: Telemetry configuration
 *
 * Configuration for opt-in telemetry features.
 */
export const TelemetryConfigSchema = z.object({
  /**
   * Methodology telemetry configuration (opt-in).
   * Tracks methodology selection patterns for adoption insights.
   */
  methodology: MethodologyTelemetryConfigSchema.default(() =>
    MethodologyTelemetryConfigSchema.parse({}),
  ),
});

/**
 * WU-1366: Cleanup trigger options
 *
 * Controls when automatic state cleanup runs:
 * - 'on_done': Run after wu:done success (default)
 * - 'on_init': Run during lumenflow init
 * - 'manual': Only run via pnpm state:cleanup
 */
export const CleanupTriggerSchema = z.enum(['on_done', 'on_init', 'manual']).default('on_done');

/** WU-1366: TypeScript type for cleanup trigger */
export type CleanupTrigger = z.infer<typeof CleanupTriggerSchema>;

/**
 * WU-1366: Cleanup configuration schema
 *
 * Controls when and how automatic state cleanup runs.
 *
 * @example
 * ```yaml
 * cleanup:
 *   trigger: on_done  # on_done | on_init | manual
 * ```
 */
export const CleanupConfigSchema = z.object({
  /**
   * When to trigger automatic state cleanup.
   * - 'on_done': Run after wu:done success (default)
   * - 'on_init': Run during lumenflow init
   * - 'manual': Only run via pnpm state:cleanup
   *
   * @default 'on_done'
   */
  trigger: CleanupTriggerSchema,

  /**
   * WU-1542: Commit message for auto-cleanup changes.
   * Consumer repos with strict main-branch guards may reject the default.
   * Configure this to match your repo's allowed commit message patterns.
   *
   * @default 'chore: lumenflow state cleanup [skip ci]'
   *
   * @example
   * ```yaml
   * cleanup:
   *   commit_message: 'chore(repair): auto state cleanup [skip ci]'
   * ```
   */
  commit_message: z.string().default('chore: lumenflow state cleanup [skip ci]'),
});

/** WU-1366: TypeScript type for cleanup config */
export type CleanupConfig = z.infer<typeof CleanupConfigSchema>;

/**
 * WU-1495: Cloud environment signal configuration
 *
 * Defines an environment variable to check during cloud auto-detection.
 * When `equals` is omitted, presence of the variable (non-empty) triggers detection.
 * When `equals` is provided, the variable value must match exactly.
 *
 * All signals are user-configured; no vendor-specific signals are hardcoded.
 *
 * @example
 * ```yaml
 * cloud:
 *   env_signals:
 *     - name: CI                    # presence check
 *     - name: GITHUB_ACTIONS
 *       equals: 'true'              # exact match
 *     - name: CODEX
 * ```
 */
export const CloudEnvSignalSchema = z.object({
  /**
   * Environment variable name to check.
   * Must be non-empty.
   */
  name: z.string().min(1),

  /**
   * Optional exact value to match against.
   * When omitted, presence of a non-empty value is sufficient.
   */
  equals: z.string().optional(),
});

/** WU-1495: TypeScript type for cloud env signal */
export type CloudEnvSignal = z.infer<typeof CloudEnvSignalSchema>;

/**
 * WU-1495: Cloud auto-detection configuration schema
 *
 * Controls opt-in cloud mode auto-detection via environment signals.
 * Explicit activation (--cloud flag or LUMENFLOW_CLOUD=1) always takes
 * precedence over auto-detection, regardless of these settings.
 *
 * Detection precedence:
 * 1. --cloud CLI flag (always wins)
 * 2. LUMENFLOW_CLOUD=1 env var (always wins)
 * 3. env_signals (only when auto_detect=true)
 *
 * @example
 * ```yaml
 * cloud:
 *   auto_detect: true
 *   env_signals:
 *     - name: CI
 *     - name: CODEX
 *     - name: GITHUB_ACTIONS
 *       equals: 'true'
 * ```
 */
export const CloudConfigSchema = z.object({
  /**
   * Enable env-signal auto-detection for cloud mode.
   * When false (default), only explicit activation (--cloud / LUMENFLOW_CLOUD=1) works.
   * When true, env_signals are also checked.
   * @default false
   */
  auto_detect: z.boolean().default(false),

  /**
   * Environment signals to check when auto_detect is true.
   * Each signal defines an environment variable name and optional value constraint.
   * Signals are checked in order; first match activates cloud mode.
   * @default []
   */
  env_signals: z.array(CloudEnvSignalSchema).default([]),
});

/** WU-1495: TypeScript type for cloud config */
export type CloudConfig = z.infer<typeof CloudConfigSchema>;

/**
 * WU-1345: Lane enforcement configuration schema
 *
 * Controls how lane format validation behaves.
 */
export const LanesEnforcementSchema = z.object({
  /**
   * When true, lanes MUST use "Parent: Sublane" format if parent has taxonomy.
   * @default true
   */
  require_parent: z.boolean().default(true),

  /**
   * When false, only lanes in the taxonomy are allowed.
   * When true, custom lanes can be used.
   * @default false
   */
  allow_custom: z.boolean().default(false),
});

/**
 * WU-1322: Lane definition schema for .lumenflow.config.yaml
 *
 * Extends the existing lane configuration with lock_policy field.
 * Compatible with WU-1016 (wip_limit) and WU-1187 (wip_justification).
 */
export const LaneDefinitionSchema = z.object({
  /** Lane name in "Parent: Sublane" format (e.g., "Framework: Core") */
  name: z.string(),

  /** WU-1016: Maximum WUs allowed in progress concurrently for this lane */
  wip_limit: z.number().int().positive().optional(),

  /** WU-1187: Required justification when wip_limit > 1 */
  wip_justification: z.string().optional(),

  /**
   * WU-1322: Lock policy for this lane.
   * - 'all': Lock lane for all other agents (default)
   * - 'active': Lock only for agents with overlapping code_paths
   * - 'none': No locking (suitable for documentation lanes)
   *
   * @default 'all'
   *
   * @example
   * ```yaml
   * lanes:
   *   definitions:
   *     - name: 'Content: Documentation'
   *       wip_limit: 4
   *       lock_policy: 'none'  # Docs can be worked in parallel
   * ```
   */
  lock_policy: LockPolicySchema.default('all'),

  /** Code paths associated with this lane (glob patterns) */
  code_paths: z.array(z.string()).optional(),
});

/**
 * WU-1345: Complete lanes configuration schema
 *
 * Supports three formats:
 * 1. definitions array (recommended)
 * 2. engineering + business arrays (legacy/alternate)
 * 3. flat array (simple format - parsed as definitions)
 *
 * @example
 * ```yaml
 * lanes:
 *   enforcement:
 *     require_parent: true
 *     allow_custom: false
 *   definitions:
 *     - name: 'Framework: Core'
 *       wip_limit: 1
 *       code_paths:
 *         - 'packages/@lumenflow/core/**'
 * ```
 */
export const LanesConfigSchema = z.object({
  /** Lane enforcement configuration (validation rules) */
  enforcement: LanesEnforcementSchema.optional(),

  /** Primary lane definitions array (recommended format) */
  definitions: z.array(LaneDefinitionSchema).optional(),

  /** Engineering lanes (alternate format) */
  engineering: z.array(LaneDefinitionSchema).optional(),

  /** Business lanes (alternate format) */
  business: z.array(LaneDefinitionSchema).optional(),
});

/**
 * Complete LumenFlow configuration schema
 */
export const LumenFlowConfigSchema = z.object({
  /** Schema version for future migrations */
  version: z.string().default('1.0.0'),

  /** Directory paths */
  directories: DirectoriesSchema.default(() => DirectoriesSchema.parse({})),

  /** State paths (.lumenflow directory structure) */
  state: StatePathsSchema.default(() => StatePathsSchema.parse({})),

  /** Git configuration */
  git: GitConfigSchema.default(() => GitConfigSchema.parse({})),

  /** WU configuration */
  wu: WuConfigSchema.default(() => WuConfigSchema.parse({})),

  /** Gates configuration */
  gates: GatesConfigSchema.default(() => GatesConfigSchema.parse({})),

  /** Memory layer configuration */
  memory: MemoryConfigSchema.default(() => MemoryConfigSchema.parse({})),

  /** UI configuration */
  ui: UiConfigSchema.default(() => UiConfigSchema.parse({})),

  /** YAML configuration */
  yaml: YamlConfigSchema.default(() => YamlConfigSchema.parse({})),

  /** Agents configuration */
  agents: AgentsConfigSchema.default(() => AgentsConfigSchema.parse({})),

  /** Experimental features (WU-1090) */
  experimental: ExperimentalConfigSchema.default(() => ExperimentalConfigSchema.parse({})),

  /**
   * WU-1366: Cleanup configuration
   * Controls when automatic state cleanup runs.
   *
   * @example
   * ```yaml
   * cleanup:
   *   trigger: on_done  # on_done | on_init | manual
   * ```
   */
  cleanup: CleanupConfigSchema.default(() => CleanupConfigSchema.parse({})),

  /**
   * WU-1270: Telemetry configuration
   * Opt-in telemetry features for adoption tracking.
   */
  telemetry: TelemetryConfigSchema.default(() => TelemetryConfigSchema.parse({})),

  /**
   * WU-1259: Methodology configuration
   * Single source of truth for testing/architecture methodology decisions.
   * Used by both wu:spawn (prompt assembly) and gates (enforcement).
   *
   * @example
   * ```yaml
   * methodology:
   *   testing: 'tdd'              # tdd | test-after | none
   *   architecture: 'hexagonal'   # hexagonal | layered | none
   *   overrides:
   *     coverage_threshold: 85    # Override TDD's default 90%
   *     coverage_mode: 'warn'     # Override TDD's default 'block'
   * ```
   */
  methodology: MethodologyConfigSchema.optional(),

  /**
   * WU-1495: Cloud auto-detection configuration
   * Controls opt-in cloud mode detection via environment signals.
   * Explicit activation (--cloud / LUMENFLOW_CLOUD=1) always takes precedence.
   *
   * @example
   * ```yaml
   * cloud:
   *   auto_detect: true
   *   env_signals:
   *     - name: CI
   *     - name: CODEX
   *     - name: GITHUB_ACTIONS
   *       equals: 'true'
   * ```
   */
  cloud: CloudConfigSchema.default(() => CloudConfigSchema.parse({})),

  /**
   * WU-1345: Lanes configuration
   * Defines delivery lanes with WIP limits, code paths, and lock policies.
   * Required for resolveLaneConfigsFromConfig() to work with getConfig().
   *
   * @example
   * ```yaml
   * lanes:
   *   enforcement:
   *     require_parent: true
   *     allow_custom: false
   *   definitions:
   *     - name: 'Framework: Core'
   *       wip_limit: 1
   *       code_paths:
   *         - 'packages/@lumenflow/core/**'
   * ```
   */
  lanes: LanesConfigSchema.optional(),

  /**
   * WU-1356: Package manager for CLI operations
   * Determines which package manager is used for build commands,
   * dependency installation, and script execution.
   *
   * @default 'pnpm'
   *
   * @example
   * ```yaml
   * package_manager: npm
   * ```
   */
  package_manager: PackageManagerSchema,

  /**
   * WU-1356: Test runner for incremental test detection
   * Determines how changed tests are detected and which ignore patterns to use.
   *
   * @default 'vitest'
   *
   * @example
   * ```yaml
   * test_runner: jest
   * ```
   */
  test_runner: TestRunnerSchema,

  /**
   * WU-1356: Custom build command for CLI bootstrap
   * Overrides the default build command used in cli-entry.mjs.
   *
   * @default 'pnpm --filter @lumenflow/cli build'
   *
   * @example
   * ```yaml
   * build_command: 'npm run build'
   * ```
   */
  build_command: z.string().default('pnpm --filter @lumenflow/cli build'),
});

/**
 * TypeScript types inferred from schemas
 */
export type Directories = z.infer<typeof DirectoriesSchema>;
export type StatePaths = z.infer<typeof StatePathsSchema>;
export type PushRetryConfig = z.infer<typeof PushRetryConfigSchema>;
export type GitConfig = z.infer<typeof GitConfigSchema>;
export type WuConfig = z.infer<typeof WuConfigSchema>;
export type GatesConfig = z.infer<typeof GatesConfigSchema>;
// GatesExecutionConfig exported from gates-config.js
export type ProgressSignalsConfig = z.infer<typeof ProgressSignalsConfigSchema>;
export type SignalCleanupConfig = z.infer<typeof SignalCleanupConfigSchema>;
export type EventArchivalConfig = z.infer<typeof EventArchivalConfigSchema>;
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
export type UiConfig = z.infer<typeof UiConfigSchema>;

export type YamlConfig = z.infer<typeof YamlConfigSchema>;
export type MethodologyDefaults = z.infer<typeof MethodologyDefaultsSchema>;
export type ClientBlock = z.infer<typeof ClientBlockSchema>;
export type ClientSkills = z.infer<typeof ClientSkillsSchema>;
export type ClientConfig = z.infer<typeof ClientConfigSchema>;
export type AgentsConfig = z.infer<typeof AgentsConfigSchema>;
export type ExperimentalConfig = z.infer<typeof ExperimentalConfigSchema>;
export type ValidationMode = z.infer<typeof ValidationModeSchema>;
export type MethodologyTelemetryConfig = z.infer<typeof MethodologyTelemetryConfigSchema>;
export type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>;
export type LumenFlowConfig = z.infer<typeof LumenFlowConfigSchema>;
// WU-1322: Lane definition type (LockPolicy already exported by WU-1325)
export type LaneDefinition = z.infer<typeof LaneDefinitionSchema>;
// WU-1345: Lanes configuration types
export type LanesEnforcement = z.infer<typeof LanesEnforcementSchema>;
export type LanesConfig = z.infer<typeof LanesConfigSchema>;
// WU-1356: Package manager, test runner, and gates commands types
// Note: Types already exported via their schema definitions above
// WU-1259: Re-export methodology types from resolve-policy
export type { MethodologyConfig, MethodologyOverrides } from './resolve-policy.js';

/**
 * Validate configuration data
 *
 * @param data - Configuration data to validate
 * @returns Validation result with parsed config or errors
 */

export function validateConfig(data: unknown) {
  return LumenFlowConfigSchema.safeParse(data);
}

/**
 * Parse configuration with defaults
 *
 * @param data - Partial configuration data
 * @returns Complete configuration with defaults applied
 * @throws ZodError if validation fails
 */
export function parseConfig(data: unknown = {}): LumenFlowConfig {
  return LumenFlowConfigSchema.parse(data);
}

/**
 * Get default configuration
 *
 * @returns Default LumenFlow configuration
 */
export function getDefaultConfig(): LumenFlowConfig {
  return LumenFlowConfigSchema.parse({});
}
