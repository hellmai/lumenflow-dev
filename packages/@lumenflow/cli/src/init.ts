#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @file init.ts
 * LumenFlow project scaffolding command (WU-1045)
 * WU-1006: Library-First - use core defaults for config generation
 * WU-1028: Vendor-agnostic core + vendor overlays
 * WU-1085: Added createWUParser for proper --help support
 * WU-1171: Added --merge mode, --client flag, AGENTS.md, updated vendor paths
 * WU-1362: Added branch guard to check branch before writing tracked files
 * WU-1643: Extracted template constants into init-templates.ts
 * WU-1644: Extracted detection helpers into init-detection.ts,
 *           scaffolding helpers into init-scaffolding.ts
 * WU-1748: Deferred lane lifecycle - init no longer finalizes lane artifacts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { execFileSync } from 'node:child_process';
import {
  getDefaultConfig,
  createWUParser,
  WU_OPTIONS,
  CLAUDE_HOOKS,
  LUMENFLOW_CLIENT_IDS,
  createError,
  ErrorCodes,
} from '@lumenflow/core';
import { GIT_DIRECTORY_NAME } from '@lumenflow/core/config';
import { WORKSPACE_V2_KEYS } from '@lumenflow/core/config-schema';
// WU-1067: Import GATE_PRESETS for --preset support
import { GATE_PRESETS } from '@lumenflow/core/gates-config';
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
import { buildInitLaneLifecycleMessage, LANE_LIFECYCLE_STATUS } from './lane-lifecycle-process.js';
// WU-1643: Import template constants from dedicated data module
import {
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
  REQUIRED_GITIGNORE_EXCLUSIONS,
  PRETTIERIGNORE_TEMPLATE,
  SAFE_GIT_TEMPLATE,
  PRE_COMMIT_TEMPLATE,
  GATE_STUB_SCRIPTS,
  SCRIPT_ARG_OVERRIDES,
  DEFAULT_LANE_DEFINITIONS,
} from './init-templates.js';
// WU-1644: Import detection helpers from dedicated module
import {
  getDocsPath,
  detectDocsStructure,
  detectDefaultClient,
  isGitRepo,
  hasGitCommits,
  detectGitStateConfig,
} from './init-detection.js';
// WU-1644: Re-export detection types for backwards compatibility
export type {
  DetectedIDE,
  PrerequisiteResult,
  PrerequisiteResults,
  DocsStructureType,
  DocsPathConfig,
  DefaultClient,
  GitStateConfig,
} from './init-detection.js';
// WU-1644: Re-export detection functions for backwards compatibility
export {
  detectIDEEnvironment,
  checkPrerequisites,
  getDocsPath,
  detectDocsStructure,
} from './init-detection.js';
// WU-1644: Import scaffolding helpers from dedicated module
import {
  processTemplate,
  loadTemplate,
  createFile,
  createDirectory,
  createExecutableScript,
} from './init-scaffolding.js';
import type { DomainChoice, OnboardResult } from './onboard.js';
import {
  CANONICAL_BOOTSTRAP_COMMAND,
  DEFAULT_PROJECT_NAME,
  getDefaultWorkspaceConfig,
  WORKSPACE_FILENAME,
} from './workspace-init.js';
import type { FetchFn } from './pack-install.js';
// WU-1644: Re-export scaffolding types for backwards compatibility
export type { FileMode, ScaffoldResult } from './init-scaffolding.js';

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
  bootstrapDomain: {
    name: 'bootstrapDomain',
    flags: '--bootstrap-domain <domain>',
    description: 'Bootstrap domain: software-delivery, infra, or custom',
  },
  skipBootstrap: {
    name: 'skipBootstrap',
    flags: '--skip-bootstrap',
    description: 'Skip workspace bootstrap-all flow (workspace.yaml + pack install)',
  },
  skipBootstrapPackInstall: {
    name: 'skipBootstrapPackInstall',
    flags: '--skip-bootstrap-pack-install',
    description: 'Skip registry pack install during bootstrap',
  },
  force: WU_OPTIONS.force,
};

function parseBootstrapDomain(rawDomain: string | undefined): DomainChoice {
  if (!rawDomain) {
    return BOOTSTRAP_DEFAULT_DOMAIN;
  }

  if (BOOTSTRAP_VALID_DOMAINS.has(rawDomain as DomainChoice)) {
    return rawDomain as DomainChoice;
  }

  const validDomains = Array.from(BOOTSTRAP_VALID_DOMAINS).join(', ');
  throw createError(
    ErrorCodes.INVALID_ARGUMENT,
    `${BOOTSTRAP_ERROR_PREFIX} Invalid --bootstrap-domain "${rawDomain}". Valid values: ${validDomains}`,
  );
}

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
  bootstrapDomain: DomainChoice;
  skipBootstrap: boolean;
  skipBootstrapPackInstall: boolean;
} {
  // WU-1378: Description includes subcommand hint
  const opts = createWUParser({
    name: 'lumenflow-init',
    description:
      'Initialize LumenFlow in a project\n\n' +
      'Subcommands:\n' +
      '  lumenflow commands         List all available CLI commands\n' +
      '  lumenflow cloud connect    Configure cloud control-plane access',
    options: Object.values(INIT_OPTIONS),
  });

  // WU-1171: --client takes precedence, --vendor is alias
  const clientValue = opts.client || opts.vendor;

  // WU-1286: --full is now the default (true), use --minimal to disable
  // --minimal explicitly sets full to false, otherwise full defaults to true
  const fullMode = opts.minimal ? false : (opts.full ?? true);
  const bootstrapDomain = parseBootstrapDomain(opts.bootstrapDomain as string | undefined);

  return {
    force: opts.force ?? false,
    full: fullMode,
    merge: opts.merge ?? false,
    framework: opts.framework,
    client: clientValue as ClientType | undefined,
    vendor: clientValue as ClientType | undefined,
    preset: opts.preset as GatePresetType | undefined,
    bootstrapDomain,
    skipBootstrap: Boolean(opts.skipBootstrap),
    skipBootstrapPackInstall: Boolean(opts.skipBootstrapPackInstall),
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

/** @deprecated Use ClientType instead */
// eslint-disable-next-line sonarjs/redundant-type-aliases -- Intentional backwards compatibility
export type VendorType = ClientType;

// WU-1067: Supported gate presets for config-driven gates
export type GatePresetType = 'node' | 'python' | 'go' | 'rust' | 'dotnet';

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
  defaultClient?: import('./init-detection.js').DefaultClient;
  /** WU-1067: Gate preset to populate in gates.execution */
  gatePreset?: GatePresetType;
  /** WU-1300: Docs structure (simple or arc42). Auto-detects if not specified. */
  docsStructure?: import('./init-detection.js').DocsStructureType;
}

const DEFAULT_CLIENT_CLAUDE = LUMENFLOW_CLIENT_IDS.CLAUDE_CODE;
const BOOTSTRAP_DEFAULT_DOMAIN: DomainChoice = 'software-delivery';
const BOOTSTRAP_INFRA_DOMAIN: DomainChoice = 'infra';
const BOOTSTRAP_CUSTOM_DOMAIN: DomainChoice = 'custom';
const BOOTSTRAP_VALID_DOMAINS = new Set<DomainChoice>([
  BOOTSTRAP_DEFAULT_DOMAIN,
  BOOTSTRAP_INFRA_DOMAIN,
  BOOTSTRAP_CUSTOM_DOMAIN,
]);
const BOOTSTRAP_SKIP_REASON_FLAG = '--skip-bootstrap';
const BOOTSTRAP_SKIP_REASON_EXISTING_WORKSPACE = `${WORKSPACE_FILENAME} already exists`;
const BOOTSTRAP_ERROR_PREFIX = '[lumenflow bootstrap]';
const INIT_SUBCOMMANDS = {
  COMMANDS: 'commands',
  CLOUD: 'cloud',
} as const;
const LEGACY_SUBCOMMANDS = {
  ONBOARD: 'onboard',
  WORKSPACE_INIT_COLON: 'workspace:init',
  WORKSPACE_INIT_DASH: 'workspace-init',
} as const;
const CLOUD_SUBCOMMANDS = {
  CONNECT: 'connect',
} as const;
const CLOUD_CONNECT_BIN = 'cloud-connect';
const INIT_ERROR_PREFIX = '[lumenflow init]';
const INIT_CLOUD_CONNECT_HELP =
  'Usage: lumenflow cloud connect --endpoint <url> --org-id <id> --project-id <id> [--token-env <name>]';
const LEGACY_SUBCOMMAND_ERROR_PREFIX = `${INIT_ERROR_PREFIX} Legacy onboarding subcommand`;
const LEGACY_SUBCOMMAND_GUIDANCE = `Use "${CANONICAL_BOOTSTRAP_COMMAND}" for bootstrap-all onboarding`;
const LEGACY_SUBCOMMAND_HELP_HINT = `Run "${CANONICAL_BOOTSTRAP_COMMAND} --help" for supported options`;

const CONFIG_FILE_NAME = WORKSPACE_FILENAME;
const SOFTWARE_DELIVERY_KEY = WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY;
const SOFTWARE_DELIVERY_CONFIG_KEYS = {
  AGENTS: 'agents',
  CLIENTS: 'clients',
  ENFORCEMENT: 'enforcement',
} as const;
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
async function checkBranchGuard(
  targetDir: string,
  result: import('./init-scaffolding.js').ScaffoldResult,
): Promise<void> {
  result.warnings = result.warnings ?? [];

  // Only check if target is a git repository
  const gitDir = path.join(targetDir, GIT_DIRECTORY_NAME);
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
 * WU-1965: Detected project tooling from package.json
 * Used to override config defaults so gates reference actually-installed tools.
 */
interface DetectedTooling {
  testRunner?: 'vitest' | 'jest' | 'mocha';
  hasTurbo: boolean;
  packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun';
}

/**
 * WU-1965: Detect installed test runner and build tool from package.json
 * Reads devDependencies and dependencies to find what's actually installed.
 * Returns defaults that match the project, not hardcoded vitest/turbo.
 */
function detectProjectTooling(targetDir: string): DetectedTooling {
  const packageJsonPath = path.join(targetDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return { hasTurbo: false };
  }

  try {
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content) as Record<string, unknown>;
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
    const allDeps = { ...deps, ...devDeps };

    // Detect test runner
    let testRunner: DetectedTooling['testRunner'];
    if ('vitest' in allDeps) {
      testRunner = 'vitest';
    } else if ('jest' in allDeps) {
      testRunner = 'jest';
    } else if ('mocha' in allDeps) {
      testRunner = 'mocha';
    }

    // Detect turbo
    const hasTurbo = 'turbo' in allDeps;

    // Detect package manager from packageManager field
    let packageManager: DetectedTooling['packageManager'];
    const pkgManager = pkg.packageManager as string | undefined;
    if (pkgManager?.startsWith('pnpm')) {
      packageManager = 'pnpm';
    } else if (pkgManager?.startsWith('yarn')) {
      packageManager = 'yarn';
    } else if (pkgManager?.startsWith('bun')) {
      packageManager = 'bun';
    } else if (pkgManager?.startsWith('npm')) {
      packageManager = 'npm';
    }

    return { testRunner, hasTurbo, packageManager };
  } catch {
    return { hasTurbo: false };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mergeConfigDefaults(
  defaults: Record<string, unknown>,
  existing: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...defaults };

  for (const [key, existingValue] of Object.entries(existing)) {
    const defaultValue = merged[key];
    const existingRecord = asRecord(existingValue);
    const defaultRecord = asRecord(defaultValue);
    if (defaultRecord && existingRecord) {
      merged[key] = mergeConfigDefaults(defaultRecord, existingRecord);
      continue;
    }
    merged[key] = existingValue;
  }

  return merged;
}

function toWorkspaceId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function loadWorkspaceDocument(targetDir: string): {
  exists: boolean;
  workspace: Record<string, unknown>;
} {
  const workspacePath = path.join(targetDir, CONFIG_FILE_NAME);
  if (!fs.existsSync(workspacePath)) {
    const projectName = resolveBootstrapProjectName(targetDir);
    const projectId = toWorkspaceId(projectName);
    const workspace = {
      ...getDefaultWorkspaceConfig(),
      id: projectId,
      name: projectName,
      memory_namespace: projectId,
      event_namespace: projectId,
    } as Record<string, unknown>;
    return { exists: false, workspace };
  }

  const content = fs.readFileSync(workspacePath, 'utf-8');
  const workspace = asRecord(yaml.parse(content));
  if (!workspace) {
    throw createError(
      ErrorCodes.WORKSPACE_MALFORMED,
      `${INIT_ERROR_PREFIX} ${CONFIG_FILE_NAME} exists but is not a valid YAML object. ` +
        `Fix ${CONFIG_FILE_NAME} and re-run init.`,
    );
  }

  return { exists: true, workspace };
}

function upsertWorkspaceSoftwareDelivery(
  targetDir: string,
  softwareDeliveryConfig: Record<string, unknown>,
  result: import('./init-scaffolding.js').ScaffoldResult,
): void {
  const workspacePath = path.join(targetDir, CONFIG_FILE_NAME);
  const { exists, workspace } = loadWorkspaceDocument(targetDir);
  const existingSoftwareDelivery = asRecord(workspace[SOFTWARE_DELIVERY_KEY]) ?? {};
  workspace[SOFTWARE_DELIVERY_KEY] = mergeConfigDefaults(
    softwareDeliveryConfig,
    existingSoftwareDelivery,
  );

  fs.writeFileSync(workspacePath, yaml.stringify(workspace), 'utf-8');
  if (exists) {
    result.overwritten = result.overwritten ?? [];
    if (!result.overwritten.includes(CONFIG_FILE_NAME)) {
      result.overwritten.push(CONFIG_FILE_NAME);
    }
    return;
  }
  result.created.push(CONFIG_FILE_NAME);
}

/**
 * Build software_delivery configuration defaults
 * WU-1067: Supports --preset option for config-driven gates
 * WU-1307: Includes default lane definitions for onboarding
 * WU-1364: Supports git config overrides (requireRemote)
 * WU-1383: Adds enforcement hooks config for Claude client by default
 * WU-1965: Detects installed tooling from package.json for config defaults
 */
function buildSoftwareDeliveryConfig(
  gatePreset?: GatePresetType,
  gitConfigOverride?: { requireRemote: boolean } | null,
  client?: ClientType,
  docsPaths?: import('./init-detection.js').DocsPathConfig,
  targetDir?: string,
): Record<string, unknown> {
  const config = getDefaultConfig();
  config.directories.agentsDir = LUMENFLOW_AGENTS_DIR;

  // WU-2105: Write ALL directory paths explicitly from detected docs structure.
  // Schema defaults are consumer-simple. For arc42 repos, docsPaths provides
  // the correct values. Either way, workspace.yaml gets explicit paths — no
  // reliance on schema defaults for layout-sensitive keys.
  if (docsPaths) {
    config.directories.wuDir = `${docsPaths.tasks}/wu`;
    config.directories.initiativesDir = `${docsPaths.tasks}/initiatives`;
    config.directories.backlogPath = `${docsPaths.tasks}/backlog.md`;
    config.directories.statusPath = `${docsPaths.tasks}/status.md`;
    config.directories.plansDir = `${docsPaths.operations}/plans`;
    config.directories.onboardingDir = docsPaths.onboarding;
    config.directories.completeGuidePath = docsPaths.completeGuidePath;
    config.directories.quickRefPath = docsPaths.quickRefPath;
    config.directories.startingPromptPath = docsPaths.startingPromptPath;
    config.directories.governancePath = docsPaths.governancePath;
  }

  // WU-1067: Add gates.execution section with preset if specified
  if (gatePreset && GATE_PRESETS[gatePreset]) {
    const presetConfig = GATE_PRESETS[gatePreset];
    (config.gates as Record<string, unknown>).execution = {
      preset: gatePreset,
      ...presetConfig,
    };
  }

  // WU-1748: Initialize explicit lifecycle status without final lane artifacts
  (config as Record<string, unknown>).lanes = {
    lifecycle: {
      status: LANE_LIFECYCLE_STATUS.UNCONFIGURED,
    },
  };

  // WU-1364: Add git config overrides (e.g., requireRemote: false for local-only)
  if (gitConfigOverride) {
    (config as Record<string, unknown>).git = {
      requireRemote: gitConfigOverride.requireRemote,
    };
  }

  // WU-1965: Override config defaults based on detected project tooling.
  // Prevents generating vitest/turbo references when those tools are not installed.
  if (targetDir) {
    const tooling = detectProjectTooling(targetDir);

    // Override test_runner if we detected one (otherwise leave schema default)
    if (tooling.testRunner) {
      (config as Record<string, unknown>).test_runner = tooling.testRunner;
    } else {
      // No test runner found in package.json -- use a neutral default
      // that won't fail when gates run. Remove vitest default.
      (config as Record<string, unknown>).test_runner = 'jest';
    }

    // Override gates commands based on available tooling
    const pm = tooling.packageManager ?? 'pnpm';
    const commands: Record<string, string> = {};

    if (tooling.hasTurbo) {
      commands.test_full = `${pm} turbo run test`;
    } else {
      commands.test_full = `${pm} test`;
    }

    if (tooling.testRunner === 'vitest') {
      commands.test_incremental = `${pm} vitest run --changed origin/main`;
    } else if (tooling.testRunner === 'jest') {
      commands.test_incremental = `${pm} jest --onlyChanged`;
    } else {
      commands.test_incremental = `${pm} test`;
    }

    // Override gates commands to match detected tooling (always overwrite schema defaults)
    (config.gates as Record<string, unknown>).commands = {
      ...config.gates.commands,
      ...commands,
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

  return config as Record<string, unknown>;
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
    throw createError(ErrorCodes.INVALID_ARGUMENT, `Invalid framework name: "${framework}"`);
  }

  return { name, slug };
}

/**
 * WU-1171: Resolve client type from options
 * --client takes precedence over --vendor (backwards compat)
 */
function resolveClientType(
  client: ClientType | undefined,
  vendor: ClientType | undefined,
  defaultClient: import('./init-detection.js').DefaultClient,
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
function getFileMode(options: ScaffoldOptions): import('./init-scaffolding.js').FileMode {
  if (options.force) {
    return 'force';
  }
  if (options.merge) {
    return 'merge';
  }
  return 'skip';
}

/**
 * WU-1576: Run client-specific integrations (enforcement hooks) based on config.
 *
 * Reads workspace.yaml software_delivery and runs integration for UnsafeAny
 * client that has enforcement.hooks enabled. This is vendor-agnostic: when new
 * clients add enforcement support, register them in CLIENT_INTEGRATIONS.
 *
 * Must run BEFORE the initial commit so all generated files are included.
 */

// Vendor-agnostic dispatch map: client key in config -> integration adapter.
// Each adapter runs integration and returns relative paths of files it created.
// init.ts has zero knowledge of client-specific paths -- adapters own that.
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

async function runClientIntegrations(
  targetDir: string,
  result: import('./init-scaffolding.js').ScaffoldResult,
): Promise<string[]> {
  const integrationFiles: string[] = [];
  const configPath = path.join(targetDir, CONFIG_FILE_NAME);
  if (!fs.existsSync(configPath)) return integrationFiles;

  let softwareDeliveryConfig: Record<string, unknown> | null;
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const workspaceConfig = asRecord(yaml.parse(content));
    softwareDeliveryConfig = workspaceConfig
      ? asRecord(workspaceConfig[SOFTWARE_DELIVERY_KEY])
      : null;
  } catch {
    return integrationFiles; // Config unreadable -- skip silently
  }
  if (!softwareDeliveryConfig) return integrationFiles;

  const agents = asRecord(softwareDeliveryConfig[SOFTWARE_DELIVERY_CONFIG_KEYS.AGENTS]);
  const clients = asRecord(agents?.[SOFTWARE_DELIVERY_CONFIG_KEYS.CLIENTS]);
  if (!clients) return integrationFiles;

  for (const [clientKey, unsafeClientConfig] of Object.entries(clients)) {
    const clientConfig = asRecord(unsafeClientConfig);
    if (!clientConfig) {
      continue;
    }
    const enforcement = asRecord(
      clientConfig[SOFTWARE_DELIVERY_CONFIG_KEYS.ENFORCEMENT],
    ) as IntegrateEnforcementConfig | null;
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
 * Safe to call at UnsafeAny point: only renames when current branch is exactly "master".
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
 * Scaffold a new LumenFlow project
 * WU-1171: Added AGENTS.md, --merge mode, updated vendor/client handling
 * WU-1362: Added branch guard to prevent main branch pollution
 */
export async function scaffoldProject(
  targetDir: string,
  options: ScaffoldOptions,
): Promise<import('./init-scaffolding.js').ScaffoldResult> {
  const result: import('./init-scaffolding.js').ScaffoldResult = {
    created: [],
    skipped: [],
    merged: [],
    warnings: [],
    overwritten: [],
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
    DOCS_WU_DIR_PATH: `${docsPaths.tasks}/wu`,
    DOCS_TEMPLATES_DIR_PATH: `${docsPaths.tasks}/templates`,
    DOCS_BACKLOG_PATH: `${docsPaths.tasks}/backlog.md`,
    DOCS_STATUS_PATH: `${docsPaths.tasks}/status.md`,
  };

  // Upsert workspace.yaml software_delivery defaults (WU-2006 hard cut)
  upsertWorkspaceSoftwareDelivery(
    targetDir,
    buildSoftwareDeliveryConfig(
      options.gatePreset,
      gitConfigOverride,
      client,
      docsPaths,
      targetDir,
    ),
    result,
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
  // WU-2230: Always inject scripts and devDependencies, not just in full mode.
  // Without this, CLI commands (wu:create, gates, etc.) don't resolve after init.
  await injectPackageJsonScripts(targetDir, options, result);

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

  // WU-1852: Display lane naming format requirement and valid parents
  // so users learn the "Parent: Sublane" format before reaching lane:validate.
  const uniqueParents = [
    ...new Set(DEFAULT_LANE_DEFINITIONS.map((lane) => lane.name.split(':')[0].trim())),
  ];
  console.log('');
  console.log(
    '  Lane naming format: "Parent: Sublane" (e.g., "Framework: Core", "Content: Documentation")',
  );
  console.log(`  Valid parent names: ${uniqueParents.join(', ')}`);

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
  result: import('./init-scaffolding.js').ScaffoldResult,
): Promise<void> {
  const gitignorePath = path.join(targetDir, GITIGNORE_FILE_NAME);
  const fileMode = getFileMode(options);

  // WU-1965: Auto-merge lumenflow entries when .gitignore exists, regardless of mode.
  // Previously only merge mode triggered merging; skip mode would skip the entire file,
  // risking accidental commits of .lumenflow/telemetry, worktrees, etc.
  if ((fileMode === 'merge' || fileMode === 'skip') && fs.existsSync(gitignorePath)) {
    // Merge mode or skip mode with existing file: append LumenFlow exclusions if not already present
    const existingContent = fs.readFileSync(gitignorePath, 'utf-8');
    const linesToAdd: string[] = [];

    // WU-1969: Use shared constant so merge path and full template cannot drift
    for (const { pattern, line } of REQUIRED_GITIGNORE_EXCLUSIONS) {
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
      result.merged = result.merged ?? [];
      result.merged.push(GITIGNORE_FILE_NAME);
    } else {
      result.skipped.push(GITIGNORE_FILE_NAME);
    }
    return;
  }

  // Force mode or file doesn't exist: write full template
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
  result: import('./init-scaffolding.js').ScaffoldResult,
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
  result: import('./init-scaffolding.js').ScaffoldResult,
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

/**
 * WU-1963: @lumenflow/cli version to add to devDependencies.
 * Uses caret range to allow minor/patch updates within the major version.
 * This ensures `pnpm wu:create`, `pnpm gates`, etc. resolve after `pnpm install`.
 */
const CLI_PACKAGE_VERSION = '^3.0.0';

/** WU-1963: CLI package name constant */
const CLI_PACKAGE_NAME = '@lumenflow/cli';

/**
 * WU-1300: Inject LumenFlow scripts into package.json
 * WU-1517: Also adds prettier devDependency
 * WU-1518: Also adds gate stub scripts (spec:linter, lint, typecheck)
 * WU-1747: format and format:check are now part of GATE_STUB_SCRIPTS
 * WU-1963: Also adds @lumenflow/cli devDependency so binary scripts resolve
 * - Creates package.json if it doesn't exist
 * - Preserves existing scripts (doesn't overwrite unless --force)
 * - Adds missing LumenFlow scripts
 * - Adds @lumenflow/cli to devDependencies (provides wu-create, gates, etc. binaries)
 * - Adds prettier to devDependencies
 * - Adds gate stub scripts for spec:linter, lint, typecheck, format, format:check
 */
async function injectPackageJsonScripts(
  targetDir: string,
  options: ScaffoldOptions,
  result: import('./init-scaffolding.js').ScaffoldResult,
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

  // WU-1518: Add gate stub scripts (spec:linter, lint, typecheck, format, format:check)
  // WU-1747: format and format:check are now part of GATE_STUB_SCRIPTS with
  // auto-detection of prettier availability, so they pass immediately after init.
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

  // Ensure devDependencies object exists
  if (!packageJson.devDependencies || typeof packageJson.devDependencies !== 'object') {
    packageJson.devDependencies = {};
  }
  const devDeps = packageJson.devDependencies as Record<string, string>;

  // WU-1963: Add @lumenflow/cli to devDependencies so binary scripts resolve after pnpm install
  if (options.force || !(CLI_PACKAGE_NAME in devDeps)) {
    if (options.force && CLI_PACKAGE_NAME in devDeps) {
      devDeps[CLI_PACKAGE_NAME] = CLI_PACKAGE_VERSION;
      modified = true;
    } else if (!(CLI_PACKAGE_NAME in devDeps)) {
      devDeps[CLI_PACKAGE_NAME] = CLI_PACKAGE_VERSION;
      modified = true;
    }
  }

  // WU-1517: Add prettier to devDependencies
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

/**
 * WU-2230: Detect the project's package manager and return the install command.
 * Used after scaffolding to ensure devDependencies are actually installed.
 */
type PackageManagerType = 'pnpm' | 'npm' | 'yarn' | 'bun';

interface PostScaffoldInstallResult {
  packageManager: PackageManagerType;
  command: string;
  skipped: boolean;
  error?: string;
}

export async function runPostScaffoldInstall(
  targetDir: string,
  options?: { dryRun?: boolean },
): Promise<PostScaffoldInstallResult> {
  const packageJsonPath = path.join(targetDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return { packageManager: 'npm', command: 'npm install', skipped: true };
  }

  // Detect package manager
  let pm: PackageManagerType = 'npm'; // default fallback
  try {
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content) as Record<string, unknown>;
    const pkgManager = pkg.packageManager as string | undefined;

    if (pkgManager?.startsWith('pnpm')) {
      pm = 'pnpm';
    } else if (pkgManager?.startsWith('yarn')) {
      pm = 'yarn';
    } else if (pkgManager?.startsWith('bun')) {
      pm = 'bun';
    } else if (pkgManager?.startsWith('npm')) {
      pm = 'npm';
    } else {
      // No packageManager field — detect from lockfiles
      if (fs.existsSync(path.join(targetDir, 'pnpm-lock.yaml'))) {
        pm = 'pnpm';
      } else if (fs.existsSync(path.join(targetDir, 'yarn.lock'))) {
        pm = 'yarn';
      } else if (fs.existsSync(path.join(targetDir, 'bun.lockb')) || fs.existsSync(path.join(targetDir, 'bun.lock'))) {
        pm = 'bun';
      }
      // else default to npm
    }
  } catch {
    // If package.json is malformed, default to npm
  }

  const command = `${pm} install`;

  if (options?.dryRun) {
    return { packageManager: pm, command, skipped: false };
  }

  try {
    console.log(`\n[lumenflow init] Installing dependencies (${command})...`);
    execFileSync(pm, ['install'], {
      cwd: targetDir,
      stdio: 'inherit',
    });
    console.log('[lumenflow init] \u2713 Dependencies installed');
    return { packageManager: pm, command, skipped: false };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn(`[lumenflow init] \u26A0 ${command} failed: ${errorMessage}`);
    console.warn(`[lumenflow init] Run "${command}" manually to install dependencies.`);
    return { packageManager: pm, command, skipped: false, error: errorMessage };
  }
}

async function scaffoldFullDocs(
  targetDir: string,
  options: ScaffoldOptions,
  result: import('./init-scaffolding.js').ScaffoldResult,
  tokens: Record<string, string>,
): Promise<void> {
  // WU-1309: Use config-derived docs paths from tokens (computed in scaffoldProject)
  const wuDir = path.join(targetDir, tokens.DOCS_WU_DIR_PATH);
  const templatesDir = path.join(targetDir, tokens.DOCS_TEMPLATES_DIR_PATH);

  await createDirectory(wuDir, result, targetDir);
  await createDirectory(templatesDir, result, targetDir);
  await createFile(path.join(wuDir, '.gitkeep'), '', options.force, result, targetDir);

  await createFile(
    path.join(targetDir, tokens.DOCS_BACKLOG_PATH),
    BACKLOG_TEMPLATE,
    options.force,
    result,
    targetDir,
  );

  await createFile(
    path.join(targetDir, tokens.DOCS_STATUS_PATH),
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

  // WU-1083: Scaffold agent onboarding docs with --full
  await scaffoldAgentOnboardingDocs(targetDir, options, result, tokens);
}

/**
 * WU-1083: Scaffold agent onboarding documentation
 * WU-1300: Added starting-prompt.md
 * WU-1309: Added first-15-mins.md, local-only.md, lane-inference.md; use dynamic docs path
 */
async function scaffoldAgentOnboardingDocs(
  targetDir: string,
  options: ScaffoldOptions,
  result: import('./init-scaffolding.js').ScaffoldResult,
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
  result: import('./init-scaffolding.js').ScaffoldResult,
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
  result: import('./init-scaffolding.js').ScaffoldResult,
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
  result: import('./init-scaffolding.js').ScaffoldResult,
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
    // WU-1965: Guard with !options.full to prevent duplicate scaffolding.
    // When full=true, scaffoldFullDocs() already called scaffoldAgentOnboardingDocs().
    // Only call here for non-full (minimal) mode so Claude client still gets onboarding docs.
    if (!options.full) {
      await scaffoldAgentOnboardingDocs(targetDir, options, result, tokens);
    }
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

interface InitBootstrapOptions {
  targetDir: string;
  force: boolean;
  bootstrapDomain: DomainChoice;
  skipBootstrap: boolean;
  skipBootstrapPackInstall: boolean;
  fetchFn?: FetchFn;
}

interface InitBootstrapResult {
  skipped: boolean;
  reason?: string;
  workspaceGenerated: boolean;
  packInstalled: boolean;
  /** WU-2230: Warning message when pack install fails non-fatally */
  warning?: string;
}

function resolveBootstrapProjectName(targetDir: string): string {
  const basename = path.basename(path.resolve(targetDir)).trim();
  return basename.length > 0 ? basename : DEFAULT_PROJECT_NAME;
}

export async function runInitBootstrap(
  options: InitBootstrapOptions,
): Promise<InitBootstrapResult> {
  if (options.skipBootstrap) {
    return {
      skipped: true,
      reason: BOOTSTRAP_SKIP_REASON_FLAG,
      workspaceGenerated: false,
      packInstalled: false,
    };
  }

  const workspacePath = path.join(options.targetDir, WORKSPACE_FILENAME);
  const hasExistingWorkspace = fs.existsSync(workspacePath);

  if (hasExistingWorkspace && !options.force) {
    return {
      skipped: true,
      reason: BOOTSTRAP_SKIP_REASON_EXISTING_WORKSPACE,
      workspaceGenerated: false,
      packInstalled: false,
    };
  }

  const onboardModule = await import('./onboard.js');
  const onboardResult = (await onboardModule.runOnboard({
    targetDir: options.targetDir,
    nonInteractive: true,
    projectName: resolveBootstrapProjectName(options.targetDir),
    domain: options.bootstrapDomain,
    force: options.force,
    skipPackInstall: options.skipBootstrapPackInstall,
    skipDashboard: true,
    fetchFn: options.fetchFn ?? globalThis.fetch,
  })) as OnboardResult;

  if (!onboardResult.success) {
    const failureReason = onboardResult.errors.join('; ') || 'unknown onboarding error';
    throw createError(ErrorCodes.ONBOARD_FAILED, `${BOOTSTRAP_ERROR_PREFIX} ${failureReason}`);
  }

  // WU-2230: Pack install failure is non-blocking — warn instead of throwing.
  // New users hitting a registry issue shouldn't have their entire init fail.
  const packFailed =
    !options.skipBootstrapPackInstall &&
    options.bootstrapDomain !== BOOTSTRAP_CUSTOM_DOMAIN &&
    onboardResult.packInstalled !== true;

  const warning = packFailed
    ? `${BOOTSTRAP_ERROR_PREFIX} failed to install ${options.bootstrapDomain} pack with integrity metadata. ` +
      `Continuing without pack. Retry later with: pnpm pack:install --id ${options.bootstrapDomain}`
    : undefined;

  if (warning) {
    console.warn(`\n\u26A0 ${warning}\n`);
  }

  return {
    skipped: false,
    workspaceGenerated: onboardResult.workspaceGenerated === true,
    packInstalled: onboardResult.packInstalled === true,
    warning,
  };
}

/**
 * CLI entry point
 * WU-1085: Updated to use parseInitOptions for proper --help support
 * WU-1171: Added --merge and --client support
 * WU-1378: Added subcommand routing for 'commands' subcommand
 */
export async function main(): Promise<void> {
  // WU-1378: Check for subcommands before parsing init options
  const invokedBinary = path.basename(process.argv[1] ?? '', '.js');
  const subcommand = process.argv[2];

  if (invokedBinary === CLOUD_CONNECT_BIN) {
    const { runCloudConnectCli } = await import('./onboard.js');
    await runCloudConnectCli();
    return;
  }

  if (subcommand === INIT_SUBCOMMANDS.COMMANDS) {
    // Route to commands subcommand
    const { main: commandsMain } = await import('./commands.js');
    // Remove 'commands' from argv so the subcommand parser sees clean args
    process.argv.splice(2, 1);
    await commandsMain();
    return;
  }

  if (
    subcommand === LEGACY_SUBCOMMANDS.ONBOARD ||
    subcommand === LEGACY_SUBCOMMANDS.WORKSPACE_INIT_COLON ||
    subcommand === LEGACY_SUBCOMMANDS.WORKSPACE_INIT_DASH
  ) {
    throw createError(
      ErrorCodes.DEPRECATED_API,
      `${LEGACY_SUBCOMMAND_ERROR_PREFIX} "${subcommand}". ${LEGACY_SUBCOMMAND_GUIDANCE}. ${LEGACY_SUBCOMMAND_HELP_HINT}.`,
    );
  }

  if (subcommand === INIT_SUBCOMMANDS.CLOUD) {
    const cloudSubcommand = process.argv[3];
    if (cloudSubcommand !== CLOUD_SUBCOMMANDS.CONNECT) {
      throw createError(
        ErrorCodes.INVALID_ARGUMENT,
        `${INIT_ERROR_PREFIX} Unknown cloud subcommand "${cloudSubcommand ?? ''}". ${INIT_CLOUD_CONNECT_HELP}`,
      );
    }

    const { runCloudConnectCli } = await import('./onboard.js');
    process.argv.splice(2, 2);
    await runCloudConnectCli();
    return;
  }

  const opts = parseInitOptions();
  const targetDir = process.cwd();

  console.log('[lumenflow init] Scaffolding LumenFlow project...');
  console.log(`  Mode: ${opts.full ? 'full' : 'minimal'}${opts.merge ? ' (merge)' : ''}`);
  console.log(`  Framework: ${opts.framework ?? 'none'}`);
  console.log(`  Client: ${opts.client ?? 'auto'}`);
  console.log(`  Gate preset: ${opts.preset ?? 'none (manual config)'}`);
  console.log(`  Bootstrap domain: ${opts.bootstrapDomain}`);
  console.log(
    `  Bootstrap pack install: ${opts.skipBootstrapPackInstall ? 'skipped (--skip-bootstrap-pack-install)' : 'required'}`,
  );

  // WU-1968: Removed separate checkPrerequisites() call here.
  // runDoctorForInit() (called after scaffolding) already checks prerequisites
  // and displays results, avoiding duplicate output.

  const bootstrapResult = await runInitBootstrap({
    targetDir,
    force: opts.force,
    bootstrapDomain: opts.bootstrapDomain,
    skipBootstrap: opts.skipBootstrap,
    skipBootstrapPackInstall: opts.skipBootstrapPackInstall,
  });

  if (bootstrapResult.skipped) {
    console.log(`  Bootstrap: skipped (${bootstrapResult.reason})`);
  } else {
    console.log(
      `  Bootstrap: workspace=${bootstrapResult.workspaceGenerated ? 'created' : 'unchanged'}, pack=${bootstrapResult.packInstalled ? 'installed' : 'skipped'}`,
    );
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

  // WU-1965: Report overwritten files when --force replaces existing files
  if (result.overwritten && result.overwritten.length > 0) {
    console.log('\nOverwritten (existing file replaced with --force):');
    result.overwritten.forEach((f) => console.log(`  ! ${f}`));
  }

  if (result.skipped.length > 0) {
    console.log('\nSkipped (already exists, use --force to overwrite or --merge to insert block):');
    result.skipped.forEach((f) => console.log(`  - ${f}`));
  }

  if (result.warnings && result.warnings.length > 0) {
    console.log('\nWarnings:');
    result.warnings.forEach((w) => console.log(`  \u26A0 ${w}`));
  }

  // WU-2230: Auto-install dependencies so CLI commands work immediately after init.
  // Without this, users must manually run `pnpm install` before any `pnpm wu:*` commands.
  await runPostScaffoldInstall(targetDir);

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
  // WU-1576: Show enforcement hooks status -- vendor-agnostic (UnsafeAny adapter that produced files)
  console.log('\n[lumenflow init] Done! Next steps:');
  console.log('  1. Review AGENTS.md and LUMENFLOW.md for workflow documentation');
  console.log(
    `  2. Review ${CONFIG_FILE_NAME} ${SOFTWARE_DELIVERY_KEY} settings for project defaults`,
  );
  console.log('');
  console.log(`  ${buildInitLaneLifecycleMessage(LANE_LIFECYCLE_STATUS.UNCONFIGURED)}`);
  if (result.integrationFiles && result.integrationFiles.length > 0) {
    console.log(
      '  \u2713 Enforcement hooks installed -- regenerate with: pnpm lumenflow:integrate',
    );
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
// WU-1929: Show branded header for init command
if (import.meta.main) {
  void runCLI(main, { showHeader: true });
}
