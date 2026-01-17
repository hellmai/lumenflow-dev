/**
 * LumenFlow Configuration Schema
 *
 * Zod schemas for LumenFlow configuration.
 * All paths and settings are configurable via .lumenflow.config.yaml
 *
 * @module lumenflow-config-schema
 */

import { z } from 'zod';

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
});

/**
 * Beacon paths configuration (.beacon directory structure)
 */
export const BeaconPathsSchema = z.object({
  /** Base beacon directory (default: '.beacon') */
  base: z.string().default('.beacon'),

  /** State directory (default: '.beacon/state') */
  stateDir: z.string().default('.beacon/state'),

  /** Stamps directory (default: '.beacon/stamps') */
  stampsDir: z.string().default('.beacon/stamps'),

  /** Merge lock file (default: '.beacon/merge.lock') */
  mergeLock: z.string().default('.beacon/merge.lock'),

  /** Telemetry directory (default: '.beacon/telemetry') */
  telemetry: z.string().default('.beacon/telemetry'),

  /** Flow log file (default: '.beacon/flow.log') */
  flowLog: z.string().default('.beacon/flow.log'),

  /** Sessions directory (default: '.beacon/sessions') */
  sessions: z.string().default('.beacon/sessions'),

  /** Incidents directory (default: '.beacon/incidents') */
  incidents: z.string().default('.beacon/incidents'),

  /** Commands log file (default: '.beacon/commands.log') */
  commandsLog: z.string().default('.beacon/commands.log'),
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
});

/**
 * Memory layer configuration
 */
export const MemoryConfigSchema = z.object({
  /** Memory directory (default: 'memory-bank/') */
  directory: z.string().default('memory-bank/'),

  /** Session TTL in milliseconds (default: 7 days) */
  sessionTtl: z.number().int().positive().default(7 * 24 * 60 * 60 * 1000),

  /** Checkpoint TTL in milliseconds (default: 30 days) */
  checkpointTtl: z.number().int().positive().default(30 * 24 * 60 * 60 * 1000),

  /** Enable auto-cleanup (default: true) */
  enableAutoCleanup: z.boolean().default(true),
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
export const YamlConfigSchema = z.object({
  /** Line width for YAML output (default: 100, -1 for no wrap) */
  lineWidth: z.number().int().default(100),
});

/**
 * Complete LumenFlow configuration schema
 */
export const LumenFlowConfigSchema = z.object({
  /** Schema version for future migrations */
  version: z.string().default('1.0.0'),

  /** Directory paths */
  directories: DirectoriesSchema.default(() => DirectoriesSchema.parse({})),

  /** Beacon paths */
  beacon: BeaconPathsSchema.default(() => BeaconPathsSchema.parse({})),

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
});

/**
 * TypeScript types inferred from schemas
 */
export type Directories = z.infer<typeof DirectoriesSchema>;
export type BeaconPaths = z.infer<typeof BeaconPathsSchema>;
export type GitConfig = z.infer<typeof GitConfigSchema>;
export type WuConfig = z.infer<typeof WuConfigSchema>;
export type GatesConfig = z.infer<typeof GatesConfigSchema>;
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
export type UiConfig = z.infer<typeof UiConfigSchema>;
export type YamlConfig = z.infer<typeof YamlConfigSchema>;
export type LumenFlowConfig = z.infer<typeof LumenFlowConfigSchema>;

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
