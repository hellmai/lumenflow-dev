/**
 * @file init.ts
 * LumenFlow project scaffolding command (WU-1045)
 * WU-1006: Library-First - use core defaults for config generation
 * WU-1028: Vendor-agnostic core + vendor overlays
 * WU-1085: Added createWUParser for proper --help support
 * WU-1171: Added --merge mode, --client flag, AGENTS.md, updated vendor paths
 * WU-1362: Added branch guard to check branch before writing tracked files
 * WU-1643: Extracted template constants into init-templates.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  getDefaultConfig,
  createWUParser,
  WU_OPTIONS,
  CLAUDE_HOOKS,
  LUMENFLOW_CLIENT_IDS,
} from '@lumenflow/core';
// WU-1067: Import GATE_PRESETS for --preset support
import { GATE_PRESETS } from '@lumenflow/core/gates-config';
// WU-1171: Import merge block utilities
import { updateMergeBlock } from './merge-block.js';
// WU-1362: Import worktree guard utilities for branch checking
import { isMainBranch, isInWorktree } from '@lumenflow/core/core/worktree-guard';
// WU-1386: Import doctor for auto-run after init
import { runDoctorForInit } from './doctor.js';
// WU-1505: Use shared SessionStart hook generator (vendor wrappers stay thin)
import { generateSessionStartRecoveryScript } from './hooks/enforcement-generator.js';
// WU-1576: Import integrate to fold enforcement hooks into init for Claude
import { integrateClaudeCode, type IntegrateEnforcementConfig } from './commands/integrate.js';
// WU-1433: Import public manifest to derive scripts (no hardcoded subset)
import { getPublicManifest } from './public-manifest.js';
import { runCLI } from './cli-entry-point.js';
// WU-1643: Import template constants from dedicated data module
import {
  DEFAULT_LANE_DEFINITIONS,
  AGENTS_MD_TEMPLATE,
  LUMENFLOW_MD_TEMPLATE,
  CONSTRAINTS_MD_TEMPLATE,
  CLAUDE_MD_TEMPLATE,
  CLAUDE_SETTINGS_TEMPLATE,
  CURSOR_RULES_TEMPLATE,
  WINDSURF_RULES_TEMPLATE,
  CLINE_RULES_TEMPLATE,
  AIDER_CONF_TEMPLATE,
  MCP_JSON_TEMPLATE,
  BACKLOG_TEMPLATE,
  STATUS_TEMPLATE,
  WU_TEMPLATE_YAML,
  FRAMEWORK_HINT_TEMPLATE,
  FRAMEWORK_OVERLAY_TEMPLATE,
  QUICK_REF_COMMANDS_TEMPLATE,
  FIRST_WU_MISTAKES_TEMPLATE,
  TROUBLESHOOTING_WU_DONE_TEMPLATE,
  AGENT_SAFETY_CARD_TEMPLATE,
  LANE_INFERENCE_TEMPLATE,
  STARTING_PROMPT_TEMPLATE,
  WU_CREATE_CHECKLIST_TEMPLATE,
  FIRST_15_MINS_TEMPLATE,
  LOCAL_ONLY_TEMPLATE,
  LANE_INFERENCE_DOC_TEMPLATE,
  WU_SIZING_GUIDE_TEMPLATE,
  WU_LIFECYCLE_SKILL_TEMPLATE,
  WORKTREE_DISCIPLINE_SKILL_TEMPLATE,
  LUMENFLOW_GATES_SKILL_TEMPLATE,
  GITIGNORE_TEMPLATE,
  PRETTIERIGNORE_TEMPLATE,
  SAFE_GIT_TEMPLATE,
  PRE_COMMIT_TEMPLATE,
  GATE_STUB_SCRIPTS,
  SCRIPT_ARG_OVERRIDES,
} from './init-templates.js';

/**
 * WU-1085: CLI option definitions for init command
 * WU-1171: Added --merge and --client options
 */
const INIT_OPTIONS = {
  full: {
    name: 'full',
    flags: '--full',
    description: 'Add docs + agent onboarding + task scaffolding (default: true)',
  },
  minimal: {
    name: 'minimal',
    flags: '--minimal',
    description: 'Skip agent onboarding docs (only core files)',
  },
  framework: {
    name: 'framework',
    flags: '--framework <name>',
    description: 'Add framework hint + overlay docs',
  },
  // WU-1171: --client is the new primary flag (wu:spawn vocabulary)
  client: {
    name: 'client',
    flags: '--client <type>',
    description: 'Client type (claude, cursor, windsurf, codex, all, none)',
  },
  // WU-1171: --vendor kept as backward-compatible alias
  vendor: {
    name: 'vendor',
    flags: '--vendor <type>',
    description: 'Alias for --client (deprecated)',
  },
  // WU-1171: --merge mode for safe insertion into existing files
  merge: {
    name: 'merge',
    flags: '--merge',
    description: 'Merge LumenFlow config into existing files using bounded markers',
  },
  preset: {
    name: 'preset',
    flags: '--preset <preset>',
    description: 'Gate preset for config (node, python, go, rust, dotnet)',
  },
  force: WU_OPTIONS.force,
};

/**
 * WU-1085: Parse init command options using createWUParser
 * WU-1171: Added --merge, --client options
 * Provides proper --help, --version, and option parsing
 */
export function parseInitOptions(): {
  force: boolean;
  full: boolean;
  merge: boolean;
  framework?: string;
  client?: ClientType;
  vendor?: ClientType; // Alias for backwards compatibility
  preset?: GatePresetType;
} {
  // WU-1378: Description includes subcommand hint
  const opts = createWUParser({
    name: 'lumenflow-init',
    description:
      'Initialize LumenFlow in a project\n\n' +
      'Subcommands:\n' +
      '  lumenflow commands    List all available CLI commands',
    options: Object.values(INIT_OPTIONS),
  });

  // WU-1171: --client takes precedence, --vendor is alias
  const clientValue = opts.client || opts.vendor;

  // WU-1286: --full is now the default (true), use --minimal to disable
  // --minimal explicitly sets full to false, otherwise full defaults to true
  const fullMode = opts.minimal ? false : (opts.full ?? true);

  return {
    force: opts.force ?? false,
    full: fullMode,
    merge: opts.merge ?? false,
    framework: opts.framework,
    client: clientValue as ClientType | undefined,
    vendor: clientValue as ClientType | undefined,
    preset: opts.preset as GatePresetType | undefined,
  };
}

/**
 * Supported client/vendor integrations
 * WU-1171: Added 'windsurf' and 'codex', renamed primary type to ClientType
 * WU-1177: Added 'cline' support
 */
export type ClientType =
  | 'claude'
  | 'cursor'
  | 'windsurf'
  | 'codex'
  | 'cline'
  | 'aider'
  | 'all'
  | 'none';

/**
 * Detected IDE type from environment
 * WU-1177: Auto-detection support
 */
export type DetectedIDE = 'claude' | 'cursor' | 'windsurf' | 'vscode' | undefined;

/** @deprecated Use ClientType instead */
// eslint-disable-next-line sonarjs/redundant-type-aliases -- Intentional backwards compatibility
export type VendorType = ClientType;

const DEFAULT_CLIENT_CLAUDE = LUMENFLOW_CLIENT_IDS.CLAUDE_CODE;

export type DefaultClient = typeof DEFAULT_CLIENT_CLAUDE | 'none';

/**
 * WU-1171: File creation mode
 */
export type FileMode = 'skip' | 'merge' | 'force';

// WU-1067: Supported gate presets for config-driven gates
export type GatePresetType = 'node' | 'python' | 'go' | 'rust' | 'dotnet';

/** WU-1300: Docs structure type for scaffolding */
export type DocsStructureType = 'simple' | 'arc42';

/**
 * WU-1309: Docs paths for different structure types
 */
export interface DocsPathConfig {
  /** Base operations directory */
  operations: string;
  /** Tasks directory */
  tasks: string;
  /** Agent onboarding docs directory */
  onboarding: string;
  /** Quick-ref link for AGENTS.md */
  quickRefLink: string;
}

/**
 * WU-1309: Get docs paths based on structure type
 */
export function getDocsPath(structure: DocsStructureType): DocsPathConfig {
  if (structure === 'simple') {
    return {
      operations: 'docs',
      tasks: 'docs/tasks',
      onboarding: 'docs/_frameworks/lumenflow/agent/onboarding',
      quickRefLink: 'docs/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md',
    };
  }
  // arc42 structure
  return {
    operations: 'docs/04-operations',
    tasks: 'docs/04-operations/tasks',
    onboarding: 'docs/04-operations/_frameworks/lumenflow/agent/onboarding',
    quickRefLink: 'docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md',
  };
}

/**
 * WU-1309: Detect existing docs structure or return default
 * Auto-detects arc42 when docs/04-operations or any numbered dir (01-*, 02-*, etc.) exists
 */
export function detectDocsStructure(targetDir: string): DocsStructureType {
  const docsDir = path.join(targetDir, 'docs');

  if (!fs.existsSync(docsDir)) {
    return 'simple';
  }

  // Check for arc42 numbered directories (01-*, 02-*, ..., 04-operations, etc.)
  const entries = fs.readdirSync(docsDir);
  const hasNumberedDir = entries.some((entry) => /^\d{2}-/.test(entry));

  if (hasNumberedDir) {
    return 'arc42';
  }

  return 'simple';
}

export interface ScaffoldOptions {
  force: boolean;
  full: boolean;
  /** WU-1171: Enable merge mode for safe insertion into existing files */
  merge?: boolean;
  framework?: string;
  /** WU-1171: Primary client flag (replaces vendor) */
  client?: ClientType;
  /** @deprecated Use client instead */
  vendor?: ClientType;
  defaultClient?: DefaultClient;
  /** WU-1067: Gate preset to populate in gates.execution */
  gatePreset?: GatePresetType;
  /** WU-1300: Docs structure (simple or arc42). Auto-detects if not specified. */
  docsStructure?: DocsStructureType;
}

export interface ScaffoldResult {
  created: string[];
  skipped: string[];
  /** WU-1171: Files that were merged (not overwritten) */
  merged?: string[];
  /** WU-1171: Warnings encountered during scaffolding */
  warnings?: string[];
  /** WU-1576: Files created by client integration adapters (enforcement hooks etc.) */
  integrationFiles?: string[];
}

const CONFIG_FILE_NAME = '.lumenflow.config.yaml';
const FRAMEWORK_HINT_FILE = '.lumenflow.framework.yaml';
const LUMENFLOW_DIR = '.lumenflow';
const LUMENFLOW_AGENTS_DIR = `${LUMENFLOW_DIR}/agents`;
const CLAUDE_DIR = '.claude';
const CLAUDE_AGENTS_DIR = path.join(CLAUDE_DIR, 'agents');

/**
 * WU-1362: Check branch guard before writing tracked files
 *
 * Warns (but does not block) if:
 * - On main branch AND
 * - Not in a worktree directory AND
 * - Git repository exists (has .git)
 *
 * This prevents accidental main branch pollution during init operations.
 * Uses warning instead of error to allow initial project setup.
 *
 * @param targetDir - Directory where files will be written
 * @param result - ScaffoldResult to add warnings to
 */
async function checkBranchGuard(targetDir: string, result: ScaffoldResult): Promise<void> {
  result.warnings = result.warnings ?? [];

  // Only check if target is a git repository
  const gitDir = path.join(targetDir, '.git');
  if (!fs.existsSync(gitDir)) {
    // Not a git repo - allow scaffold (initial setup)
    return;
  }

  // Check if we're in a worktree (always allow)
  if (isInWorktree({ cwd: targetDir })) {
    return;
  }

  // Check if on main branch
  try {
    const onMain = await isMainBranch();
    if (onMain) {
      result.warnings.push(
        'Running init on main branch in main checkout. ' +
          'Consider using a worktree for changes to tracked files.',
      );
    }
  } catch {
    // Git error (e.g., not initialized) - silently allow
  }
}

/**
 * WU-1177: Detect IDE environment from environment variables
 * Auto-detects which AI coding assistant is running
 */
export function detectIDEEnvironment(): DetectedIDE {
  // Claude Code detection (highest priority - most specific)
  if (process.env.CLAUDE_PROJECT_DIR || process.env.CLAUDE_CODE) {
    return 'claude';
  }

  // Cursor detection
  const cursorVars = Object.keys(process.env).filter((key) => key.startsWith('CURSOR_'));
  if (cursorVars.length > 0) {
    return 'cursor';
  }

  // Windsurf detection
  const windsurfVars = Object.keys(process.env).filter((key) => key.startsWith('WINDSURF_'));
  if (windsurfVars.length > 0) {
    return 'windsurf';
  }

  // VS Code detection (lowest priority - most generic)
  const vscodeVars = Object.keys(process.env).filter((key) => key.startsWith('VSCODE_'));
  if (vscodeVars.length > 0) {
    return 'vscode';
  }

  return undefined;
}

/**
 * WU-1177: Prerequisite check result
 */
export interface PrerequisiteResult {
  passed: boolean;
  version: string;
  required: string;
  message?: string;
}

/**
 * WU-1177: All prerequisite results
 */
export interface PrerequisiteResults {
  node: PrerequisiteResult;
  pnpm: PrerequisiteResult;
  git: PrerequisiteResult;
}

/**
 * Get command version safely using execFileSync
 */
function getCommandVersion(command: string, args: string[]): string {
  try {
    const output = execFileSync(command, args, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return output;
  } catch {
    return 'not found';
  }
}

/**
 * Parse semver version string to compare
 */
function parseVersion(versionStr: string): number[] {
  // Extract version numbers using a non-backtracking pattern
  // eslint-disable-next-line security/detect-unsafe-regex -- static semver pattern; no backtracking risk
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(versionStr);
  if (!match) {
    return [0, 0, 0];
  }
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3] || '0', 10)];
}

/**
 * Compare versions: returns true if actual >= required
 */
function compareVersions(actual: string, required: string): boolean {
  const actualParts = parseVersion(actual);
  const requiredParts = parseVersion(required);

  for (let i = 0; i < 3; i++) {
    if (actualParts[i] > requiredParts[i]) {
      return true;
    }
    if (actualParts[i] < requiredParts[i]) {
      return false;
    }
  }
  return true;
}

/**
 * WU-1177: Check prerequisite versions
 * Non-blocking - returns results but doesn't fail init
 */
export function checkPrerequisites(): PrerequisiteResults {
  const nodeVersion = getCommandVersion('node', ['--version']);
  const pnpmVersion = getCommandVersion('pnpm', ['--version']);
  const gitVersion = getCommandVersion('git', ['--version']);

  const requiredNode = '22.0.0';
  const requiredPnpm = '9.0.0';
  const requiredGit = '2.0.0';

  const nodeOk = nodeVersion !== 'not found' && compareVersions(nodeVersion, requiredNode);
  const pnpmOk = pnpmVersion !== 'not found' && compareVersions(pnpmVersion, requiredPnpm);
  const gitOk = gitVersion !== 'not found' && compareVersions(gitVersion, requiredGit);

  return {
    node: {
      passed: nodeOk,
      version: nodeVersion,
      required: `>=${requiredNode}`,
      message: nodeOk ? undefined : `Node.js ${requiredNode}+ required`,
    },
    pnpm: {
      passed: pnpmOk,
      version: pnpmVersion,
      required: `>=${requiredPnpm}`,
      message: pnpmOk ? undefined : `pnpm ${requiredPnpm}+ required`,
    },
    git: {
      passed: gitOk,
      version: gitVersion,
      required: `>=${requiredGit}`,
      message: gitOk ? undefined : `Git ${requiredGit}+ required`,
    },
  };
}

/**
 * Generate YAML configuration with header comment
 * WU-1067: Supports --preset option for config-driven gates
 * WU-1307: Includes default lane definitions for onboarding
 * WU-1364: Supports git config overrides (requireRemote)
 * WU-1383: Adds enforcement hooks config for Claude client by default
 */
function generateLumenflowConfigYaml(
  gatePreset?: GatePresetType,
  gitConfigOverride?: { requireRemote: boolean } | null,
  client?: ClientType,
): string {
  // WU-1382: Add managed file header to prevent manual edits
  const header = `# ============================================================================
# LUMENFLOW MANAGED FILE - DO NOT EDIT MANUALLY
# ============================================================================
# Generated by: lumenflow init
# Regenerate with: pnpm exec lumenflow init --force
#
# This file is managed by LumenFlow tooling. Manual edits may be overwritten.
# To customize, use the CLI commands or edit the appropriate source templates.
# ============================================================================

# LumenFlow Configuration
# Customize paths based on your project structure

`;
  const config = getDefaultConfig();
  config.directories.agentsDir = LUMENFLOW_AGENTS_DIR;

  // WU-1067: Add gates.execution section with preset if specified
  if (gatePreset && GATE_PRESETS[gatePreset]) {
    const presetConfig = GATE_PRESETS[gatePreset];
    (config.gates as Record<string, unknown>).execution = {
      preset: gatePreset,
      ...presetConfig,
    };
  }

  // WU-1307: Add default lane definitions
  (config as Record<string, unknown>).lanes = {
    definitions: DEFAULT_LANE_DEFINITIONS,
  };

  // WU-1364: Add git config overrides (e.g., requireRemote: false for local-only)
  if (gitConfigOverride) {
    (config as Record<string, unknown>).git = {
      requireRemote: gitConfigOverride.requireRemote,
    };
  }

  // WU-1383: Add enforcement hooks for Claude client by default
  // This prevents agents from working on main and editing config files manually
  if (client === 'claude') {
    (config as Record<string, unknown>).agents = {
      clients: {
        [DEFAULT_CLIENT_CLAUDE]: {
          enforcement: {
            hooks: true,
            block_outside_worktree: true,
            require_wu_for_edits: true,
            warn_on_stop_without_wu_done: true,
          },
        },
      },
    };
  }

  return header + yaml.stringify(config);
}

/**
 * Get current date in YYYY-MM-DD format
 */
function getCurrentDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Normalize a framework name into display + slug
 */
function normalizeFrameworkName(framework: string): { name: string; slug: string } {
  const name = framework.trim();
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    // Remove leading dashes and trailing dashes separately (explicit precedence)
    .replace(/^-+/, '')

    .replace(/-+$/, '');

  if (!slug) {
    throw new Error(`Invalid framework name: "${framework}"`);
  }

  return { name, slug };
}

/**
 * Process template content by replacing placeholders
 */
function processTemplate(content: string, tokens: Record<string, string>): string {
  let output = content;
  for (const [key, value] of Object.entries(tokens)) {
    // eslint-disable-next-line security/detect-non-literal-regexp -- key is from internal token map, not user input
    output = output.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return output;
}

function getRelativePath(targetDir: string, filePath: string): string {
  return path.relative(targetDir, filePath).split(path.sep).join('/');
}

/**
 * Detect default client from environment
 */
function detectDefaultClient(): DefaultClient {
  if (process.env.CLAUDE_PROJECT_DIR || process.env.CLAUDE_CODE) {
    return DEFAULT_CLIENT_CLAUDE;
  }
  return 'none';
}

/**
 * WU-1171: Resolve client type from options
 * --client takes precedence over --vendor (backwards compat)
 */
function resolveClientType(
  client: ClientType | undefined,
  vendor: ClientType | undefined,
  defaultClient: DefaultClient,
): ClientType {
  // Explicit --client or --vendor takes precedence
  if (client) {
    return client;
  }
  if (vendor) {
    return vendor;
  }
  // Default based on environment
  return defaultClient === DEFAULT_CLIENT_CLAUDE ? 'claude' : 'none';
}

/**
 * WU-1171: Determine file mode from options
 */
function getFileMode(options: ScaffoldOptions): FileMode {
  if (options.force) {
    return 'force';
  }
  if (options.merge) {
    return 'merge';
  }
  return 'skip';
}

/**
 * WU-1364: Check if directory is a git repository
 */
function isGitRepo(targetDir: string): boolean {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: targetDir,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * WU-1364: Check if git repo has any commits
 */
function hasGitCommits(targetDir: string): boolean {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: targetDir,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * WU-1364: Check if git repo has an origin remote
 */
function hasOriginRemote(targetDir: string): boolean {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    const result = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: targetDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * WU-1576: Run client-specific integrations (enforcement hooks) based on config.
 *
 * Reads the just-scaffolded .lumenflow.config.yaml and runs integration for any
 * client that has enforcement.hooks enabled. This is vendor-agnostic: when new
 * clients add enforcement support, register them in CLIENT_INTEGRATIONS.
 *
 * Must run BEFORE the initial commit so all generated files are included.
 */

// Vendor-agnostic dispatch map: client key in config → integration adapter.
// Each adapter runs integration and returns relative paths of files it created.
// init.ts has zero knowledge of client-specific paths — adapters own that.
type ClientIntegrationAdapter = (
  projectDir: string,
  enforcement: IntegrateEnforcementConfig,
) => Promise<string[]>;

interface ClientIntegration {
  run: ClientIntegrationAdapter;
}

const CLIENT_INTEGRATIONS: Record<string, ClientIntegration> = {
  [LUMENFLOW_CLIENT_IDS.CLAUDE_CODE]: {
    run: (projectDir, enforcement) => integrateClaudeCode(projectDir, { enforcement }),
  },
  // When new clients gain enforcement: add adapter entry here.
};

async function runClientIntegrations(targetDir: string, result: ScaffoldResult): Promise<string[]> {
  const integrationFiles: string[] = [];
  const configPath = path.join(targetDir, CONFIG_FILE_NAME);
  if (!fs.existsSync(configPath)) return integrationFiles;

  let config: Record<string, unknown> | null;
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    config = yaml.parse(content) as Record<string, unknown> | null;
  } catch {
    return integrationFiles; // Config unreadable — skip silently
  }
  if (!config) return integrationFiles;

  const agents = config.agents as Record<string, unknown> | undefined;
  const clients = agents?.clients as Record<string, Record<string, unknown>> | undefined;
  if (!clients) return integrationFiles;

  for (const [clientKey, clientConfig] of Object.entries(clients)) {
    const enforcement = clientConfig.enforcement as IntegrateEnforcementConfig | undefined;
    if (!enforcement?.hooks) continue;

    const integration = CLIENT_INTEGRATIONS[clientKey];
    if (!integration) continue;

    const createdFiles = await integration.run(targetDir, enforcement);
    integrationFiles.push(...createdFiles);
  }

  result.created.push(...integrationFiles);
  result.integrationFiles = integrationFiles;
  return integrationFiles;
}

/**
 * WU-1364: Create initial commit if git repo has no commits
 */
function createInitialCommitIfNeeded(targetDir: string): boolean {
  if (!isGitRepo(targetDir) || hasGitCommits(targetDir)) {
    return false;
  }

  try {
    // Stage all files

    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    execFileSync('git', ['add', '.'], { cwd: targetDir, stdio: 'pipe' });
    // Create initial commit

    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    execFileSync('git', ['commit', '-m', 'chore: initialize LumenFlow project'], {
      cwd: targetDir,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * WU-1497: Rename master branch to main if git init defaulted to master.
 *
 * Many git installations still default to "master" as the initial branch name.
 * LumenFlow requires "main" for consistency. This renames the branch automatically
 * so users do not need to run `git branch -m master main` manually.
 *
 * Safe to call at any point: only renames when current branch is exactly "master".
 */
export function renameMasterToMainIfNeeded(targetDir: string): boolean {
  if (!isGitRepo(targetDir)) {
    return false;
  }

  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    const currentBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: targetDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();

    if (currentBranch !== 'master') {
      return false;
    }

    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    execFileSync('git', ['branch', '-m', 'master', 'main'], {
      cwd: targetDir,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * WU-1364: Detect git state and return config overrides
 * Returns requireRemote: false if no origin remote is configured
 */
interface GitStateConfig {
  requireRemote: boolean;
}

function detectGitStateConfig(targetDir: string): GitStateConfig | null {
  // If not a git repo, default to local-only mode for safety
  if (!isGitRepo(targetDir)) {
    return { requireRemote: false };
  }

  // If git repo but no origin remote, set requireRemote: false
  if (!hasOriginRemote(targetDir)) {
    return { requireRemote: false };
  }

  // Has origin remote - use default (requireRemote: true)
  return null;
}

/**
 * WU-1171: Get templates directory path
 */
function getTemplatesDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Check for dist/templates (production) or ../templates (development)
  const distTemplates = path.join(__dirname, '..', 'templates');
  if (fs.existsSync(distTemplates)) {
    return distTemplates;
  }

  throw new Error(`Templates directory not found at ${distTemplates}`);
}

/**
 * WU-1171: Load a template file
 */
function loadTemplate(templatePath: string): string {
  const templatesDir = getTemplatesDir();
  const fullPath = path.join(templatesDir, templatePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  return fs.readFileSync(fullPath, 'utf-8');
}

/**
 * Scaffold a new LumenFlow project
 * WU-1171: Added AGENTS.md, --merge mode, updated vendor/client handling
 * WU-1362: Added branch guard to prevent main branch pollution
 */
export async function scaffoldProject(
  targetDir: string,
  options: ScaffoldOptions,
): Promise<ScaffoldResult> {
  const result: ScaffoldResult = {
    created: [],
    skipped: [],
    merged: [],
    warnings: [],
  };

  // WU-1362: Check branch before writing tracked files
  // Only block if we're on main branch AND not in a worktree
  // This allows scaffold to run in worktrees and during initial setup
  await checkBranchGuard(targetDir, result);

  const defaultClient = options.defaultClient ?? detectDefaultClient();
  // WU-1171: Use resolveClientType with both client and vendor (vendor is deprecated but kept for backwards compat)

  const client = resolveClientType(options.client, options.vendor, defaultClient);
  const fileMode = getFileMode(options);

  // Ensure target directory exists
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // WU-1309: Detect or use specified docs structure
  const docsStructure = options.docsStructure ?? detectDocsStructure(targetDir);
  const docsPaths = getDocsPath(docsStructure);

  // WU-1364: Detect git state for config generation
  const gitConfigOverride = detectGitStateConfig(targetDir);

  const tokenDefaults = {
    DATE: getCurrentDate(),
    PROJECT_ROOT: '<project-root>', // WU-1309: Use portable placeholder
    QUICK_REF_LINK: docsPaths.quickRefLink,
    DOCS_OPERATIONS_PATH: docsPaths.operations, // WU-1309: For framework overlay
    DOCS_TASKS_PATH: docsPaths.tasks,
    DOCS_ONBOARDING_PATH: docsPaths.onboarding,
  };

  // Create .lumenflow.config.yaml (WU-1067: includes gate preset if specified)
  // WU-1364: Includes git config overrides (e.g., requireRemote: false for local-only)
  // WU-1383: Includes enforcement hooks for Claude client
  // Note: Config files don't use merge mode (always skip or force)
  const configPath = path.join(targetDir, CONFIG_FILE_NAME);

  // WU-1383: Warn if config already exists to discourage manual editing
  if (fs.existsSync(configPath) && !options.force) {
    result.warnings = result.warnings ?? [];
    result.warnings.push(
      `${CONFIG_FILE_NAME} already exists. ` +
        'To modify configuration, use CLI commands (e.g., pnpm lumenflow:init --force) ' +
        'instead of manual editing.',
    );
  }

  await createFile(
    configPath,
    generateLumenflowConfigYaml(options.gatePreset, gitConfigOverride, client),
    options.force ? 'force' : 'skip',
    result,
    targetDir,
  );

  // WU-1171: Create AGENTS.md (universal entry point for all agents)
  try {
    const agentsTemplate = loadTemplate('core/AGENTS.md.template');
    await createFile(
      path.join(targetDir, 'AGENTS.md'),
      processTemplate(agentsTemplate, tokenDefaults),
      fileMode,
      result,
      targetDir,
    );
  } catch {
    // Fallback to hardcoded template if template file not found
    await createFile(
      path.join(targetDir, 'AGENTS.md'),
      processTemplate(AGENTS_MD_TEMPLATE, tokenDefaults),
      fileMode,
      result,
      targetDir,
    );
  }

  // Create LUMENFLOW.md (main entry point)
  await createFile(
    path.join(targetDir, 'LUMENFLOW.md'),
    processTemplate(LUMENFLOW_MD_TEMPLATE, tokenDefaults),
    fileMode,
    result,
    targetDir,
  );

  // Create .lumenflow/constraints.md
  await createFile(
    path.join(targetDir, LUMENFLOW_DIR, 'constraints.md'),
    processTemplate(CONSTRAINTS_MD_TEMPLATE, tokenDefaults),
    fileMode,
    result,
    targetDir,
  );

  // Create .lumenflow/agents directory with .gitkeep
  await createDirectory(path.join(targetDir, LUMENFLOW_AGENTS_DIR), result, targetDir);
  await createFile(
    path.join(targetDir, LUMENFLOW_AGENTS_DIR, '.gitkeep'),
    '',
    options.force ? 'force' : 'skip',
    result,
    targetDir,
  );

  // WU-1342: Create .gitignore with required exclusions
  await scaffoldGitignore(targetDir, options, result);

  // WU-1517: Create .prettierignore so format:check passes immediately after init
  await scaffoldPrettierignore(targetDir, options, result);

  // WU-1408: Scaffold safe-git wrapper and pre-commit hook
  // These are core safety components needed for all projects
  await scaffoldSafetyScripts(targetDir, options, result);

  // Optional: full docs scaffolding
  if (options.full) {
    await scaffoldFullDocs(targetDir, options, result, tokenDefaults);
  }

  // Optional: framework overlay
  if (options.framework) {
    await scaffoldFrameworkOverlay(targetDir, options, result, tokenDefaults);
  }

  // Scaffold client-specific files (WU-1171: renamed from vendor)
  await scaffoldClientFiles(targetDir, options, result, tokenDefaults, client);

  // WU-1300: Inject LumenFlow scripts into package.json
  if (options.full) {
    await injectPackageJsonScripts(targetDir, options, result);
  }

  // WU-1576: Run client integrations (enforcement hooks) BEFORE initial commit.
  // Reads the just-scaffolded config, dispatches to registered adapters per client.
  // Vendor-agnostic: init.ts has zero knowledge of client-specific file paths.
  await runClientIntegrations(targetDir, result);

  // WU-1364: Create initial commit if git repo has no commits
  // This must be done after all files are created
  const createdInitialCommit = createInitialCommitIfNeeded(targetDir);
  if (createdInitialCommit) {
    result.created.push('Initial git commit');
  }

  // WU-1497: Rename master branch to main if git init defaulted to master
  // Must run after initial commit so the branch ref exists for rename
  const renamedBranch = renameMasterToMainIfNeeded(targetDir);
  if (renamedBranch) {
    result.created.push('Renamed branch master -> main');
  }

  return result;
}

/** Gitignore file name constant to avoid duplicate string lint error */
const GITIGNORE_FILE_NAME = '.gitignore';

/**
 * WU-1342: Scaffold .gitignore file with LumenFlow exclusions
 * Supports merge mode to add exclusions to existing .gitignore
 */
async function scaffoldGitignore(
  targetDir: string,
  options: ScaffoldOptions,
  result: ScaffoldResult,
): Promise<void> {
  const gitignorePath = path.join(targetDir, GITIGNORE_FILE_NAME);
  const fileMode = getFileMode(options);

  if (fileMode === 'merge' && fs.existsSync(gitignorePath)) {
    // Merge mode: append LumenFlow exclusions if not already present
    const existingContent = fs.readFileSync(gitignorePath, 'utf-8');
    const linesToAdd: string[] = [];

    // Check each required exclusion
    // WU-1519: Replaced .lumenflow/state with .lumenflow/telemetry
    const requiredExclusions = [
      { pattern: 'node_modules', line: 'node_modules/' },
      { pattern: '.lumenflow/telemetry', line: '.lumenflow/telemetry/' },
      { pattern: 'worktrees', line: 'worktrees/' },
    ];

    for (const { pattern, line } of requiredExclusions) {
      if (!existingContent.includes(pattern)) {
        linesToAdd.push(line);
      }
    }

    if (linesToAdd.length > 0) {
      const separator = existingContent.endsWith('\n') ? '' : '\n';
      const lumenflowBlock = `${separator}
# LumenFlow (auto-added)
${linesToAdd.join('\n')}
`;
      fs.writeFileSync(gitignorePath, existingContent + lumenflowBlock);
      result.merged?.push(GITIGNORE_FILE_NAME);
    } else {
      result.skipped.push(GITIGNORE_FILE_NAME);
    }
    return;
  }

  // Skip or force mode
  await createFile(gitignorePath, GITIGNORE_TEMPLATE, fileMode, result, targetDir);
}

/** Prettierignore file name constant to avoid duplicate string lint error */
const PRETTIERIGNORE_FILE_NAME = '.prettierignore';

/**
 * WU-1517: Scaffold .prettierignore file with sane defaults
 * This is a core file scaffolded in all modes (full and minimal)
 * because it's required for format:check gate to pass.
 */
async function scaffoldPrettierignore(
  targetDir: string,
  options: ScaffoldOptions,
  result: ScaffoldResult,
): Promise<void> {
  const prettierignorePath = path.join(targetDir, PRETTIERIGNORE_FILE_NAME);
  const fileMode = getFileMode(options);

  await createFile(prettierignorePath, PRETTIERIGNORE_TEMPLATE, fileMode, result, targetDir);
}

/**
 * WU-1307: LumenFlow scripts to inject into package.json
 * WU-1342: Expanded to include essential commands
 * WU-1433: Now derived from the public CLI manifest (WU-1432) instead of
 * hardcoded list. Ensures all public commands are exposed and avoids drift.
 */
function generateLumenflowScripts(): Record<string, string> {
  const scripts: Record<string, string> = {};
  const manifest = getPublicManifest();

  for (const cmd of manifest) {
    // Use override if defined, otherwise map to the binary name
    scripts[cmd.name] = SCRIPT_ARG_OVERRIDES[cmd.name] ?? cmd.binName;
  }

  return scripts;
}

/** WU-1408: Safety script path constants */
const SCRIPTS_DIR = 'scripts';
const SAFE_GIT_FILE = 'safe-git';
const HUSKY_DIR = '.husky';
const PRE_COMMIT_FILE = 'pre-commit';
const SAFE_GIT_TEMPLATE_PATH = 'core/scripts/safe-git.template';
const PRE_COMMIT_TEMPLATE_PATH = 'core/.husky/pre-commit.template';

/**
 * WU-1408: Scaffold safety scripts (safe-git wrapper and pre-commit hook)
 * These are core safety components needed for LumenFlow enforcement:
 * - scripts/safe-git: Blocks dangerous git operations (e.g., manual worktree remove)
 * - .husky/pre-commit: Blocks direct commits to main/master, enforces WU workflow
 *
 * Both scripts are scaffolded in all modes (full and minimal) because they are
 * required for lumenflow-doctor to pass.
 */
async function scaffoldSafetyScripts(
  targetDir: string,
  options: ScaffoldOptions,
  result: ScaffoldResult,
): Promise<void> {
  const fileMode = getFileMode(options);

  // Scaffold scripts/safe-git
  const safeGitPath = path.join(targetDir, SCRIPTS_DIR, SAFE_GIT_FILE);
  try {
    const safeGitTemplate = loadTemplate(SAFE_GIT_TEMPLATE_PATH);
    await createExecutableScript(safeGitPath, safeGitTemplate, fileMode, result, targetDir);
  } catch {
    // Fallback to hardcoded template if template file not found
    await createExecutableScript(safeGitPath, SAFE_GIT_TEMPLATE, fileMode, result, targetDir);
  }

  // Scaffold .husky/pre-commit
  const preCommitPath = path.join(targetDir, HUSKY_DIR, PRE_COMMIT_FILE);
  try {
    const preCommitTemplate = loadTemplate(PRE_COMMIT_TEMPLATE_PATH);
    await createExecutableScript(preCommitPath, preCommitTemplate, fileMode, result, targetDir);
  } catch {
    // Fallback to hardcoded template if template file not found
    await createExecutableScript(preCommitPath, PRE_COMMIT_TEMPLATE, fileMode, result, targetDir);
  }
}

/**
 * WU-1517: Prettier version to add to devDependencies.
 * Uses caret range to allow minor/patch updates.
 */
const PRETTIER_VERSION = '^3.8.0';

/** WU-1517: Prettier package name constant */
const PRETTIER_PACKAGE_NAME = 'prettier';

/** WU-1517: Format script names */
const FORMAT_SCRIPT_NAME = 'format';
const FORMAT_CHECK_SCRIPT_NAME = 'format:check';

/** WU-1517: Format script commands using prettier */
const FORMAT_SCRIPT_COMMAND = 'prettier --write .';
const FORMAT_CHECK_SCRIPT_COMMAND = 'prettier --check .';

/**
 * WU-1300: Inject LumenFlow scripts into package.json
 * WU-1517: Also adds prettier devDependency and format/format:check scripts
 * WU-1518: Also adds gate stub scripts (spec:linter, lint, typecheck)
 * - Creates package.json if it doesn't exist
 * - Preserves existing scripts (doesn't overwrite unless --force)
 * - Adds missing LumenFlow scripts
 * - Adds prettier to devDependencies
 * - Adds format and format:check scripts
 * - Adds gate stub scripts for spec:linter, lint, typecheck
 */
async function injectPackageJsonScripts(
  targetDir: string,
  options: ScaffoldOptions,
  result: ScaffoldResult,
): Promise<void> {
  const packageJsonPath = path.join(targetDir, 'package.json');
  let packageJson: Record<string, unknown>;

  if (fs.existsSync(packageJsonPath)) {
    // Read existing package.json
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    packageJson = JSON.parse(content) as Record<string, unknown>;
  } else {
    // Create minimal package.json
    packageJson = {
      name: path.basename(targetDir),
      version: '0.0.1',
      private: true,
    };
  }

  // Ensure scripts object exists
  if (!packageJson.scripts || typeof packageJson.scripts !== 'object') {
    packageJson.scripts = {};
  }

  const scripts = packageJson.scripts as Record<string, string>;
  let modified = false;

  // WU-1433: Derive scripts from public manifest (not hardcoded)
  const lumenflowScripts = generateLumenflowScripts();
  for (const [scriptName, scriptCommand] of Object.entries(lumenflowScripts)) {
    if (options.force || !(scriptName in scripts)) {
      if (!(scriptName in scripts)) {
        scripts[scriptName] = scriptCommand;
        modified = true;
      }
    }
  }

  // WU-1517: Add format and format:check scripts
  const formatScripts: Record<string, string> = {
    [FORMAT_SCRIPT_NAME]: FORMAT_SCRIPT_COMMAND,
    [FORMAT_CHECK_SCRIPT_NAME]: FORMAT_CHECK_SCRIPT_COMMAND,
  };
  for (const [scriptName, scriptCommand] of Object.entries(formatScripts)) {
    if (options.force || !(scriptName in scripts)) {
      if (!(scriptName in scripts)) {
        scripts[scriptName] = scriptCommand;
        modified = true;
      }
    }
  }

  // WU-1518: Add gate stub scripts (spec:linter, lint, typecheck)
  // These stubs let `pnpm gates` pass on a fresh project without manual script additions.
  // Projects replace them with real tooling when ready.
  for (const [scriptName, scriptCommand] of Object.entries(GATE_STUB_SCRIPTS)) {
    if (options.force) {
      scripts[scriptName] = scriptCommand;
      modified = true;
    } else if (!(scriptName in scripts)) {
      scripts[scriptName] = scriptCommand;
      modified = true;
    }
  }

  // WU-1517: Add prettier to devDependencies
  if (!packageJson.devDependencies || typeof packageJson.devDependencies !== 'object') {
    packageJson.devDependencies = {};
  }
  const devDeps = packageJson.devDependencies as Record<string, string>;
  if (options.force || !(PRETTIER_PACKAGE_NAME in devDeps)) {
    if (!(PRETTIER_PACKAGE_NAME in devDeps)) {
      devDeps[PRETTIER_PACKAGE_NAME] = PRETTIER_VERSION;
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    result.created.push('package.json (scripts updated)');
  }
}

async function scaffoldFullDocs(
  targetDir: string,
  options: ScaffoldOptions,
  result: ScaffoldResult,
  tokens: Record<string, string>,
): Promise<void> {
  // WU-1309: Use docs structure from tokens (computed in scaffoldProject)
  const tasksPath = tokens.DOCS_TASKS_PATH;
  const tasksDir = path.join(targetDir, tasksPath);
  const wuDir = path.join(tasksDir, 'wu');
  const templatesDir = path.join(tasksDir, 'templates');

  await createDirectory(wuDir, result, targetDir);
  await createDirectory(templatesDir, result, targetDir);
  await createFile(path.join(wuDir, '.gitkeep'), '', options.force, result, targetDir);

  await createFile(
    path.join(tasksDir, 'backlog.md'),
    BACKLOG_TEMPLATE,
    options.force,
    result,
    targetDir,
  );

  await createFile(
    path.join(tasksDir, 'status.md'),
    STATUS_TEMPLATE,
    options.force,
    result,
    targetDir,
  );

  await createFile(
    path.join(templatesDir, 'wu-template.yaml'),
    processTemplate(WU_TEMPLATE_YAML, tokens),
    options.force,
    result,
    targetDir,
  );

  // WU-1300: Scaffold lane inference configuration
  await scaffoldLaneInference(targetDir, options, result, tokens);

  // WU-1083: Scaffold agent onboarding docs with --full
  await scaffoldAgentOnboardingDocs(targetDir, options, result, tokens);
}

/**
 * WU-1307: Scaffold lane inference configuration
 * Uses hierarchical Parent→Sublane format required by lane-inference.ts
 */
async function scaffoldLaneInference(
  targetDir: string,
  options: ScaffoldOptions,
  result: ScaffoldResult,
  tokens: Record<string, string>,
): Promise<void> {
  // WU-1307: Add framework-specific lanes in hierarchical format if framework is provided
  let frameworkLanes = '';
  if (options.framework) {
    const { name, slug } = normalizeFrameworkName(options.framework);
    // Add framework lanes in hierarchical format (indentation matters in YAML)
    frameworkLanes = `
# Framework-specific lanes (added with --framework ${name})
  ${name}:
    description: '${name} framework-specific code'
    code_paths:
      - 'src/${slug}/**'
      - 'packages/${slug}/**'
    keywords:
      - '${slug}'
      - '${name.toLowerCase()}'
`;
  }

  const laneInferenceContent = processTemplate(LANE_INFERENCE_TEMPLATE, {
    ...tokens,
    FRAMEWORK_LANES: frameworkLanes,
  });

  await createFile(
    path.join(targetDir, '.lumenflow.lane-inference.yaml'),
    laneInferenceContent,
    options.force ? 'force' : 'skip',
    result,
    targetDir,
  );
}

/**
 * WU-1083: Scaffold agent onboarding documentation
 * WU-1300: Added starting-prompt.md
 * WU-1309: Added first-15-mins.md, local-only.md, lane-inference.md; use dynamic docs path
 */
async function scaffoldAgentOnboardingDocs(
  targetDir: string,
  options: ScaffoldOptions,
  result: ScaffoldResult,
  tokens: Record<string, string>,
): Promise<void> {
  // WU-1309: Use dynamic onboarding path from tokens
  const onboardingDir = path.join(targetDir, tokens.DOCS_ONBOARDING_PATH);

  await createDirectory(onboardingDir, result, targetDir);

  // WU-1300: Add starting-prompt.md as first file
  await createFile(
    path.join(onboardingDir, 'starting-prompt.md'),
    processTemplate(STARTING_PROMPT_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  // WU-1309: Add first-15-mins.md
  await createFile(
    path.join(onboardingDir, 'first-15-mins.md'),
    processTemplate(FIRST_15_MINS_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  // WU-1309: Add local-only.md
  await createFile(
    path.join(onboardingDir, 'local-only.md'),
    processTemplate(LOCAL_ONLY_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  // WU-1309: Add lane-inference.md
  await createFile(
    path.join(onboardingDir, 'lane-inference.md'),
    processTemplate(LANE_INFERENCE_DOC_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  await createFile(
    path.join(onboardingDir, 'quick-ref-commands.md'),
    processTemplate(QUICK_REF_COMMANDS_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  await createFile(
    path.join(onboardingDir, 'first-wu-mistakes.md'),
    processTemplate(FIRST_WU_MISTAKES_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  await createFile(
    path.join(onboardingDir, 'troubleshooting-wu-done.md'),
    processTemplate(TROUBLESHOOTING_WU_DONE_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  await createFile(
    path.join(onboardingDir, 'agent-safety-card.md'),
    processTemplate(AGENT_SAFETY_CARD_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  await createFile(
    path.join(onboardingDir, 'wu-create-checklist.md'),
    processTemplate(WU_CREATE_CHECKLIST_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  // WU-1385: Add wu-sizing-guide.md to onboarding docs
  await createFile(
    path.join(onboardingDir, 'wu-sizing-guide.md'),
    processTemplate(WU_SIZING_GUIDE_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );
}

/**
 * WU-1083: Scaffold Claude skills
 */
async function scaffoldClaudeSkills(
  targetDir: string,
  options: ScaffoldOptions,
  result: ScaffoldResult,
  tokens: Record<string, string>,
): Promise<void> {
  const skillsDir = path.join(targetDir, '.claude', 'skills');

  // wu-lifecycle skill
  const wuLifecycleDir = path.join(skillsDir, 'wu-lifecycle');
  await createDirectory(wuLifecycleDir, result, targetDir);
  await createFile(
    path.join(wuLifecycleDir, 'SKILL.md'),
    processTemplate(WU_LIFECYCLE_SKILL_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  // worktree-discipline skill
  const worktreeDir = path.join(skillsDir, 'worktree-discipline');
  await createDirectory(worktreeDir, result, targetDir);
  await createFile(
    path.join(worktreeDir, 'SKILL.md'),
    processTemplate(WORKTREE_DISCIPLINE_SKILL_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );

  // lumenflow-gates skill
  const gatesDir = path.join(skillsDir, 'lumenflow-gates');
  await createDirectory(gatesDir, result, targetDir);
  await createFile(
    path.join(gatesDir, 'SKILL.md'),
    processTemplate(LUMENFLOW_GATES_SKILL_TEMPLATE, tokens),
    options.force,
    result,
    targetDir,
  );
}

async function scaffoldFrameworkOverlay(
  targetDir: string,
  options: ScaffoldOptions,
  result: ScaffoldResult,
  tokens: Record<string, string>,
): Promise<void> {
  if (!options.framework) {
    return;
  }

  const { name, slug } = normalizeFrameworkName(options.framework);
  const frameworkTokens = {
    ...tokens,
    FRAMEWORK_NAME: name,
    FRAMEWORK_SLUG: slug,
  };

  await createFile(
    path.join(targetDir, FRAMEWORK_HINT_FILE),
    processTemplate(FRAMEWORK_HINT_TEMPLATE, frameworkTokens),
    options.force,
    result,
    targetDir,
  );

  // WU-1309: Use dynamic operations path from tokens
  const overlayDir = path.join(targetDir, tokens.DOCS_OPERATIONS_PATH, '_frameworks', slug);
  await createDirectory(overlayDir, result, targetDir);

  await createFile(
    path.join(overlayDir, 'README.md'),
    processTemplate(FRAMEWORK_OVERLAY_TEMPLATE, frameworkTokens),
    options.force,
    result,
    targetDir,
  );
}

/**
 * WU-1171: Scaffold client-specific files based on --client option
 * Updated paths: Cursor uses .cursor/rules/lumenflow.md, Windsurf uses .windsurf/rules/lumenflow.md
 */
async function scaffoldClientFiles(
  targetDir: string,
  options: ScaffoldOptions,
  result: ScaffoldResult,
  tokens: Record<string, string>,
  client: ClientType,
): Promise<void> {
  const fileMode = getFileMode(options);

  // Claude Code
  if (client === 'claude' || client === 'all') {
    // WU-1171: Single CLAUDE.md at root only (no .claude/CLAUDE.md duplication)
    await createFile(
      path.join(targetDir, 'CLAUDE.md'),
      processTemplate(CLAUDE_MD_TEMPLATE, tokens),
      fileMode,
      result,
      targetDir,
    );

    await createDirectory(path.join(targetDir, CLAUDE_AGENTS_DIR), result, targetDir);
    await createFile(
      path.join(targetDir, CLAUDE_AGENTS_DIR, '.gitkeep'),
      '',
      options.force ? 'force' : 'skip',
      result,
      targetDir,
    );

    // WU-1394: Load settings.json from template (includes PreCompact/SessionStart hooks)
    let settingsContent: string;
    try {
      settingsContent = loadTemplate(CLAUDE_HOOKS.TEMPLATES.SETTINGS);
    } catch {
      settingsContent = CLAUDE_SETTINGS_TEMPLATE;
    }

    await createFile(
      path.join(targetDir, CLAUDE_DIR, 'settings.json'),
      settingsContent,
      options.force ? 'force' : 'skip',
      result,
      targetDir,
    );

    // WU-1413: Scaffold .mcp.json for MCP server integration
    let mcpJsonContent: string;
    try {
      mcpJsonContent = loadTemplate('core/.mcp.json.template');
    } catch {
      mcpJsonContent = MCP_JSON_TEMPLATE;
    }
    await createFile(
      path.join(targetDir, '.mcp.json'),
      mcpJsonContent,
      fileMode,
      result,
      targetDir,
    );

    // WU-1394: Scaffold recovery hook scripts with executable permissions
    const hooksDir = path.join(targetDir, CLAUDE_DIR, 'hooks');
    await createDirectory(hooksDir, result, targetDir);

    // Load and write pre-compact-checkpoint.sh
    try {
      const preCompactScript = loadTemplate(CLAUDE_HOOKS.TEMPLATES.PRE_COMPACT);
      await createExecutableScript(
        path.join(hooksDir, CLAUDE_HOOKS.SCRIPTS.PRE_COMPACT_CHECKPOINT),
        preCompactScript,
        options.force ? 'force' : 'skip',
        result,
        targetDir,
      );
    } catch {
      // Template not found - hook won't be scaffolded
    }

    // WU-1505: Generate session-start script from shared logic source.
    const sessionStartScript = generateSessionStartRecoveryScript();
    await createExecutableScript(
      path.join(hooksDir, CLAUDE_HOOKS.SCRIPTS.SESSION_START_RECOVERY),
      sessionStartScript,
      options.force ? 'force' : 'skip',
      result,
      targetDir,
    );

    // WU-1083: Scaffold Claude skills
    await scaffoldClaudeSkills(targetDir, options, result, tokens);

    // WU-1083: Scaffold agent onboarding docs for Claude vendor (even without --full)
    await scaffoldAgentOnboardingDocs(targetDir, options, result, tokens);
  }

  // WU-1171: Cursor uses .cursor/rules/lumenflow.md (not .cursor/rules.md)
  if (client === 'cursor' || client === 'all') {
    const cursorRulesDir = path.join(targetDir, '.cursor', 'rules');
    await createDirectory(cursorRulesDir, result, targetDir);

    // Try to load from template, fallback to hardcoded
    let cursorContent: string;
    try {
      cursorContent = loadTemplate('vendors/cursor/.cursor/rules/lumenflow.md.template');
    } catch {
      cursorContent = CURSOR_RULES_TEMPLATE;
    }

    await createFile(
      path.join(cursorRulesDir, 'lumenflow.md'),
      processTemplate(cursorContent, tokens),
      fileMode,
      result,
      targetDir,
    );
  }

  // WU-1171: Windsurf uses .windsurf/rules/lumenflow.md (not .windsurfrules)
  if (client === 'windsurf' || client === 'all') {
    const windsurfRulesDir = path.join(targetDir, '.windsurf', 'rules');
    await createDirectory(windsurfRulesDir, result, targetDir);

    // Try to load from template, fallback to hardcoded
    let windsurfContent: string;
    try {
      windsurfContent = loadTemplate('vendors/windsurf/.windsurf/rules/lumenflow.md.template');
    } catch {
      windsurfContent = WINDSURF_RULES_TEMPLATE;
    }

    await createFile(
      path.join(windsurfRulesDir, 'lumenflow.md'),
      processTemplate(windsurfContent, tokens),
      fileMode,
      result,
      targetDir,
    );
  }

  // WU-1171: Codex reads AGENTS.md directly - minimal extra config needed
  // AGENTS.md is always created, so nothing extra needed for codex

  // WU-1177: Cline uses .clinerules file at project root
  if (client === 'cline' || client === 'all') {
    // Try to load from template, fallback to hardcoded
    let clineContent: string;
    try {
      clineContent = loadTemplate('vendors/cline/.clinerules.template');
    } catch {
      clineContent = CLINE_RULES_TEMPLATE;
    }

    await createFile(
      path.join(targetDir, '.clinerules'),
      processTemplate(clineContent, tokens),
      fileMode,
      result,
      targetDir,
    );
  }

  // Aider
  if (client === 'aider' || client === 'all') {
    await createFile(
      path.join(targetDir, '.aider.conf.yml'),
      AIDER_CONF_TEMPLATE,
      fileMode,
      result,
      targetDir,
    );
  }
}

/**
 * Create a directory if missing
 */
async function createDirectory(
  dirPath: string,
  result: ScaffoldResult,
  targetDir: string,
): Promise<void> {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    result.created.push(getRelativePath(targetDir, dirPath));
  }
}

/**
 * WU-1171: Create a file with support for skip, merge, and force modes
 *
 * @param filePath - Path to the file to create
 * @param content - Content to write (or merge block content in merge mode)
 * @param mode - 'skip' (default), 'merge', or 'force'
 * @param result - ScaffoldResult to track created/skipped/merged files
 * @param targetDir - Target directory for relative path calculation
 */
async function createFile(
  filePath: string,
  content: string,
  mode: FileMode | boolean,
  result: ScaffoldResult,
  targetDir: string,
): Promise<void> {
  const relativePath = getRelativePath(targetDir, filePath);

  // Handle boolean for backwards compatibility (true = force, false = skip)
  const resolvedMode = resolveBooleanToFileMode(mode);

  // Ensure merged/warnings arrays exist
  result.merged = result.merged ?? [];
  result.warnings = result.warnings ?? [];

  const fileExists = fs.existsSync(filePath);

  if (fileExists && resolvedMode === 'skip') {
    result.skipped.push(relativePath);
    return;
  }

  if (fileExists && resolvedMode === 'merge') {
    handleMergeMode(filePath, content, result, relativePath);
    return;
  }

  // Force mode or file doesn't exist: write new content
  writeNewFile(filePath, content, result, relativePath);
}

/**
 * Convert boolean or FileMode to FileMode
 */
function resolveBooleanToFileMode(mode: FileMode | boolean): FileMode {
  if (typeof mode === 'boolean') {
    return mode ? 'force' : 'skip';
  }
  return mode;
}

/**
 * Handle merge mode file update
 */
function handleMergeMode(
  filePath: string,
  content: string,
  result: ScaffoldResult,
  relativePath: string,
): void {
  const existingContent = fs.readFileSync(filePath, 'utf-8');
  const mergeResult = updateMergeBlock(existingContent, content);

  if (mergeResult.unchanged) {
    result.skipped.push(relativePath);
    return;
  }

  if (mergeResult.warning) {
    result.warnings?.push(`${relativePath}: ${mergeResult.warning}`);
  }

  fs.writeFileSync(filePath, mergeResult.content);
  result.merged?.push(relativePath);
}

/**
 * Write a new file, creating parent directories if needed
 */
function writeNewFile(
  filePath: string,
  content: string,
  result: ScaffoldResult,
  relativePath: string,
): void {
  const parentDir = path.dirname(filePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  fs.writeFileSync(filePath, content);
  result.created.push(relativePath);
}

/**
 * WU-1394: Create an executable script file with proper permissions
 * Similar to createFile but sets 0o755 mode for shell scripts
 */
async function createExecutableScript(
  filePath: string,
  content: string,
  mode: FileMode | boolean,
  result: ScaffoldResult,
  targetDir: string,
): Promise<void> {
  const relativePath = getRelativePath(targetDir, filePath);
  const resolvedMode = resolveBooleanToFileMode(mode);

  result.merged = result.merged ?? [];
  result.warnings = result.warnings ?? [];

  const fileExists = fs.existsSync(filePath);

  if (fileExists && resolvedMode === 'skip') {
    result.skipped.push(relativePath);
    return;
  }

  // Write file with executable permissions
  const parentDir = path.dirname(filePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  fs.writeFileSync(filePath, content, { mode: 0o755 });
  result.created.push(relativePath);
}

/**
 * CLI entry point
 * WU-1085: Updated to use parseInitOptions for proper --help support
 * WU-1171: Added --merge and --client support
 * WU-1378: Added subcommand routing for 'commands' subcommand
 */
export async function main(): Promise<void> {
  // WU-1378: Check for subcommands before parsing init options
  const subcommand = process.argv[2];

  if (subcommand === 'commands') {
    // Route to commands subcommand
    const { main: commandsMain } = await import('./commands.js');
    // Remove 'commands' from argv so the subcommand parser sees clean args
    process.argv.splice(2, 1);
    await commandsMain();
    return;
  }

  const opts = parseInitOptions();
  const targetDir = process.cwd();

  console.log('[lumenflow init] Scaffolding LumenFlow project...');
  console.log(`  Mode: ${opts.full ? 'full' : 'minimal'}${opts.merge ? ' (merge)' : ''}`);
  console.log(`  Framework: ${opts.framework ?? 'none'}`);
  console.log(`  Client: ${opts.client ?? 'auto'}`);
  console.log(`  Gate preset: ${opts.preset ?? 'none (manual config)'}`);

  // WU-1177: Check prerequisites (non-blocking)
  const prereqs = checkPrerequisites();
  const failingPrereqs = Object.entries(prereqs)
    .filter(([, check]) => !check.passed)
    .map(([name, check]) => `${name}: ${check.version} (requires ${check.required})`);

  if (failingPrereqs.length > 0) {
    console.log('\nPrerequisite warnings (non-blocking):');
    failingPrereqs.forEach((msg) => console.log(`  ! ${msg}`));
    console.log('  Run "lumenflow doctor" for details.\n');
  }

  const result = await scaffoldProject(targetDir, {
    force: opts.force,
    full: opts.full,
    merge: opts.merge,
    client: opts.client,
    vendor: opts.vendor, // Backwards compatibility
    framework: opts.framework,
    gatePreset: opts.preset,
  });

  if (result.created.length > 0) {
    console.log('\nCreated:');
    result.created.forEach((f) => console.log(`  + ${f}`));
  }

  if (result.merged && result.merged.length > 0) {
    console.log('\nMerged (LumenFlow block inserted/updated):');
    result.merged.forEach((f) => console.log(`  ~ ${f}`));
  }

  if (result.skipped.length > 0) {
    console.log('\nSkipped (already exists, use --force to overwrite or --merge to insert block):');
    result.skipped.forEach((f) => console.log(`  - ${f}`));
  }

  if (result.warnings && result.warnings.length > 0) {
    console.log('\nWarnings:');
    result.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }

  // WU-1386: Run doctor auto-check (non-blocking)
  // This provides feedback on workflow health without failing init
  try {
    const doctorResult = await runDoctorForInit(targetDir);
    if (doctorResult.output) {
      console.log('');
      console.log(doctorResult.output);
    }
  } catch {
    // Doctor check is non-blocking - if it fails, continue with init
  }

  // WU-1359: Show complete lifecycle with auto-ID (no --id flag required)
  // WU-1364: Added initiative-first guidance for product visions
  // WU-1576: Show enforcement hooks status — vendor-agnostic (any adapter that produced files)
  console.log('\n[lumenflow init] Done! Next steps:');
  console.log('  1. Review AGENTS.md and LUMENFLOW.md for workflow documentation');
  console.log(`  2. Edit ${CONFIG_FILE_NAME} to match your project structure`);
  if (result.integrationFiles && result.integrationFiles.length > 0) {
    console.log('  \u2713 Enforcement hooks installed — regenerate with: pnpm lumenflow:integrate');
  }
  console.log('');
  console.log('  For a product vision (multi-phase work):');
  console.log('     pnpm initiative:create --id INIT-001 --title "Project Name" \\');
  console.log('       --phase "Phase 1: MVP" --phase "Phase 2: Polish"');
  console.log('');
  console.log('  For a single WU:');
  console.log('     pnpm wu:create --lane <lane> --title "First WU" \\');
  console.log('       --description "Context: ... Problem: ... Solution: ..." \\');
  console.log('       --acceptance "Criterion 1" --code-paths "src/..." --exposure backend-only');
  console.log('');
  console.log('     # Or for rapid prototyping (minimal validation):');
  console.log('     pnpm wu:proto --lane <lane> --title "Quick experiment"');
  console.log('');
  console.log('  Full lifecycle: wu:create -> wu:claim -> wu:prep -> wu:done');
}

// WU-1297: Use import.meta.main instead of exporting main() without calling it
// This ensures main() runs when the script is executed as a CLI entry point
// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
