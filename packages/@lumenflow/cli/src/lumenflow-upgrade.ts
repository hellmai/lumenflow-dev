#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LumenFlow Upgrade CLI Command
 *
 * Updates all @lumenflow/* packages to a specified version or latest.
 * Uses micro-worktree pattern for atomic changes to main without requiring
 * users to be in a worktree.
 *
 * WU-1112: INIT-003 Phase 6 - Migrate remaining Tier 1 tools
 * WU-1127: Use micro-worktree isolation pattern (fixes user blocking issue)
 *
 * Key requirements:
 * - Uses micro-worktree pattern (atomic changes, no user worktree needed)
 * - Runs from main checkout (not inside a worktree)
 * - Checks all 7 @lumenflow/* packages
 *
 * Usage:
 *   pnpm lumenflow:upgrade --version 1.5.0
 *   pnpm lumenflow:upgrade --latest
 *   pnpm lumenflow:upgrade --latest --dry-run
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import YAML from 'yaml';
import {
  STDIO_MODES,
  EXIT_CODES,
  PKG_MANAGER,
  PKG_COMMANDS,
  PKG_FLAGS,
  DEFAULTS,
  BRANCHES,
  FILE_SYSTEM,
} from '@lumenflow/core/wu-constants';
import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { findProjectRoot } from '@lumenflow/core/config';
import {
  parseConfig,
  WORKSPACE_V2_KEYS,
  WorkspaceV2ExtensionsSchema,
} from '@lumenflow/core/config-schema';
import { normalizeConfigKeys } from '@lumenflow/core/normalize-config-keys';
import { runCLI } from './cli-entry-point.js';
import { getDefaultWorkspaceConfig } from './workspace-init.js';

/** Log prefix for console output */
const LOG_PREFIX = '[lumenflow:upgrade]';

/** Operation name for micro-worktree */
const OPERATION_NAME = 'lumenflow-upgrade';

/** Subcommand name for migrating legacy config into workspace.yaml */
export const MIGRATE_WORKSPACE_SUBCOMMAND = 'config:migrate-workspace';

/** Canonical config file names */
export const LEGACY_CONFIG_FILE_NAME = '.lumenflow.config.yaml';
export const WORKSPACE_CONFIG_FILE_NAME = 'workspace.yaml';

/** CLI argument names used by migration mode */
const ARG_HELP = '--help';
const ARG_HELP_SHORT = '-h';
const ARG_VERSION = '--version';
const ARG_VERSION_SHORT = '-v';
const ARG_LATEST = '--latest';
const ARG_LATEST_SHORT = '-l';
const ARG_DRY_RUN = '--dry-run';
const ARG_DRY_RUN_SHORT = '-n';
const ARG_LEGACY_PATH = '--legacy';
const ARG_WORKSPACE_PATH = '--workspace';

/** Workspace keys and migration output constants */
const WORKSPACE_SOFTWARE_DELIVERY_KEY = WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY;
const WORKSPACE_CONTROL_PLANE_KEY = WORKSPACE_V2_KEYS.CONTROL_PLANE;
const WORKSPACE_ID_KEY = 'id';
const WORKSPACE_NAME_KEY = 'name';
const WORKSPACE_PACKS_KEY = 'packs';
const WORKSPACE_LANES_KEY = 'lanes';
const WORKSPACE_SECURITY_KEY = 'security';
const WORKSPACE_MEMORY_NAMESPACE_KEY = 'memory_namespace';
const WORKSPACE_EVENT_NAMESPACE_KEY = 'event_namespace';
const MIGRATION_LOG_PREFIX = '[config:migrate-workspace]';
const YES_LABEL = 'yes';
const NO_LABEL = 'no';
const YAML_ENCODING = FILE_SYSTEM.UTF8 as BufferEncoding;

/** Deterministic warning strings for migration summary output */
const WARNING_SOFTWARE_DELIVERY_REPLACED =
  'Existing workspace software_delivery block will be replaced with migrated legacy config.';
const WARNING_INVALID_EXISTING_WORKSPACE =
  'Existing workspace.yaml is invalid for runtime schema; using default workspace skeleton.';
const WARNING_CONTROL_PLANE_REPLACED =
  'Existing workspace control_plane block will be replaced with migrated legacy control_plane config.';
const WARNING_CONTROL_PLANE_INVALID =
  'Legacy control_plane block is invalid for workspace schema and was skipped.';

/**
 * All @lumenflow/* packages that should be upgraded together
 *
 * WU-1112: Must include all 7 packages (not just 4 as before)
 * Kept in alphabetical order for consistency
 */
export const LUMENFLOW_PACKAGES = [
  '@lumenflow/agent',
  '@lumenflow/cli',
  '@lumenflow/core',
  '@lumenflow/initiatives',
  '@lumenflow/memory',
  '@lumenflow/metrics',
  '@lumenflow/shims',
] as const;

/**
 * Arguments for lumenflow-upgrade command
 */
export interface UpgradeArgs {
  /** Specific version to upgrade to (e.g., '1.5.0') */
  version?: string;
  /** Upgrade to latest version */
  latest?: boolean;
  /** Dry run - show commands without executing */
  dryRun?: boolean;
  /** Show help */
  help?: boolean;
  /** Run legacy config -> workspace migration mode */
  migrateWorkspace?: boolean;
  /** Optional legacy config path (defaults to .lumenflow.config.yaml in project root) */
  legacyPath?: string;
  /** Optional workspace target path (defaults to workspace.yaml in project root) */
  workspacePath?: string;
}

/**
 * Result of building upgrade commands
 */
export interface UpgradeResult {
  /** The pnpm add command to run */
  addCommand: string;
  /** Version specifier used */
  versionSpec: string;
}

export interface WorkspaceMigrationSummary {
  sourcePath: string;
  targetPath: string;
  workspaceCreated: boolean;
  softwareDeliveryKeyCount: number;
  softwareDeliveryKeys: string[];
  controlPlaneMigrated: boolean;
  warnings: string[];
}

export interface WorkspaceMigrationPlan {
  workspace: Record<string, unknown>;
  summary: WorkspaceMigrationSummary;
}

interface WorkspaceMigrationPlanInput {
  legacyConfig: Record<string, unknown>;
  existingWorkspace?: Record<string, unknown>;
  sourcePath?: string;
  targetPath?: string;
}

/**
 * Result of main checkout validation
 */
export interface MainCheckoutValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Error message if validation failed */
  error?: string;
  /** Suggested fix command */
  fixCommand?: string;
}

/**
 * Parse command line arguments for lumenflow-upgrade
 *
 * @param argv - Process argv array
 * @returns Parsed arguments
 */
export function parseUpgradeArgs(argv: string[]): UpgradeArgs {
  const args: UpgradeArgs = {};

  // Skip node and script name
  const cliArgs = argv.slice(2);

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];

    if (arg === MIGRATE_WORKSPACE_SUBCOMMAND) {
      args.migrateWorkspace = true;
    } else if (arg === ARG_HELP || arg === ARG_HELP_SHORT) {
      args.help = true;
    } else if (arg === ARG_VERSION || arg === ARG_VERSION_SHORT) {
      args.version = cliArgs[++i];
    } else if (arg === ARG_LATEST || arg === ARG_LATEST_SHORT) {
      args.latest = true;
    } else if (arg === ARG_DRY_RUN || arg === ARG_DRY_RUN_SHORT) {
      args.dryRun = true;
    } else if (arg === ARG_LEGACY_PATH) {
      args.legacyPath = cliArgs[++i];
    } else if (arg === ARG_WORKSPACE_PATH) {
      args.workspacePath = cliArgs[++i];
    }
  }

  return args;
}

/**
 * Build the upgrade commands based on arguments
 *
 * Creates pnpm add command for all @lumenflow/* packages.
 * Uses --save-dev since these are development dependencies.
 *
 * @param args - Parsed upgrade arguments
 * @returns Object containing the commands to run
 */
export function buildUpgradeCommands(args: UpgradeArgs): UpgradeResult {
  // Determine version specifier
  const versionSpec = args.latest ? 'latest' : args.version || 'latest';

  // Build package list with version
  const packages = LUMENFLOW_PACKAGES.map((pkg) => `${pkg}@${versionSpec}`);

  // Build pnpm add command using array pattern (matches deps-add.ts convention)
  // WU-1527: -w required for pnpm monorepo workspace root installs
  const parts: string[] = [
    PKG_MANAGER,
    PKG_COMMANDS.ADD,
    PKG_FLAGS.SAVE_DEV,
    PKG_FLAGS.WORKSPACE_ROOT,
    ...packages,
  ];

  return {
    addCommand: parts.join(' '),
    versionSpec,
  };
}

/**
 * WU-1127: Validate that the command is run from main checkout
 *
 * The micro-worktree pattern requires the command to be run from the main
 * checkout (not inside a worktree). This is the inverse of the old behavior
 * which required users to be IN a worktree.
 *
 * @returns Validation result with error and fix command if invalid
 */
export async function validateMainCheckout(): Promise<MainCheckoutValidationResult> {
  const cwd = process.cwd();
  const worktreesDir = `/${DEFAULTS.WORKTREES_DIR}/`;

  // Check if we're inside a worktree directory
  if (cwd.includes(worktreesDir)) {
    return {
      valid: false,
      error:
        `Cannot run lumenflow:upgrade from inside a worktree.\n\n` +
        `This command must be run from main checkout because it uses\n` +
        `micro-worktree isolation to atomically update package.json and lockfile.`,
      fixCommand: `cd to main checkout and re-run:\n  cd <main-checkout>\n  pnpm lumenflow:upgrade --latest`,
    };
  }

  // Check if we're on main branch
  try {
    const git = getGitForCwd();
    const currentBranch = await git.raw(['rev-parse', '--abbrev-ref', 'HEAD']);
    const branchName = currentBranch.trim();

    if (branchName !== BRANCHES.MAIN) {
      return {
        valid: false,
        error:
          `lumenflow:upgrade must be run from main checkout (on main branch).\n\n` +
          `Current branch: ${branchName}\n` +
          `Expected branch: main`,
        fixCommand: `Switch to main branch:\n  git checkout main\n  pnpm lumenflow:upgrade --latest`,
      };
    }
  } catch (error) {
    // If git fails, assume we're not in a valid git repo
    return {
      valid: false,
      error: `Failed to detect git branch. Ensure you're in a git repository.`,
    };
  }

  return { valid: true };
}

interface ControlPlaneMigrationResult {
  controlPlane?: Record<string, unknown>;
  migrated: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasValidWorkspaceShape(workspace: Record<string, unknown>): boolean {
  return (
    typeof workspace[WORKSPACE_ID_KEY] === 'string' &&
    (workspace[WORKSPACE_ID_KEY] as string).length > 0 &&
    typeof workspace[WORKSPACE_NAME_KEY] === 'string' &&
    (workspace[WORKSPACE_NAME_KEY] as string).length > 0 &&
    Array.isArray(workspace[WORKSPACE_PACKS_KEY]) &&
    Array.isArray(workspace[WORKSPACE_LANES_KEY]) &&
    isRecord(workspace[WORKSPACE_SECURITY_KEY]) &&
    typeof workspace[WORKSPACE_MEMORY_NAMESPACE_KEY] === 'string' &&
    (workspace[WORKSPACE_MEMORY_NAMESPACE_KEY] as string).length > 0 &&
    typeof workspace[WORKSPACE_EVENT_NAMESPACE_KEY] === 'string' &&
    (workspace[WORKSPACE_EVENT_NAMESPACE_KEY] as string).length > 0
  );
}

function readYamlRecord(filePath: string, label: string): Record<string, unknown> {
  const raw = readFileSync(filePath, YAML_ENCODING);
  const parsed = YAML.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error(`${MIGRATION_LOG_PREFIX} ${label} must contain a YAML object root.`);
  }
  return parsed;
}

function resolveBaseWorkspace(
  existingWorkspace: Record<string, unknown> | undefined,
  warnings: string[],
): { workspace: Record<string, unknown>; workspaceCreated: boolean } {
  if (!existingWorkspace) {
    return {
      workspace: getDefaultWorkspaceConfig() as unknown as Record<string, unknown>,
      workspaceCreated: true,
    };
  }

  if (hasValidWorkspaceShape(existingWorkspace)) {
    return {
      workspace: existingWorkspace,
      workspaceCreated: false,
    };
  }

  warnings.push(WARNING_INVALID_EXISTING_WORKSPACE);
  return {
    workspace: getDefaultWorkspaceConfig() as unknown as Record<string, unknown>,
    workspaceCreated: true,
  };
}

function resolveControlPlaneMigration(
  legacyConfig: Record<string, unknown>,
  baseWorkspace: Record<string, unknown>,
  warnings: string[],
): ControlPlaneMigrationResult {
  const existingControlPlaneRaw = baseWorkspace[WORKSPACE_CONTROL_PLANE_KEY];
  const existingControlPlane = isRecord(existingControlPlaneRaw)
    ? existingControlPlaneRaw
    : undefined;
  const legacyControlPlaneRaw = legacyConfig[WORKSPACE_CONTROL_PLANE_KEY];

  if (legacyControlPlaneRaw === undefined) {
    return {
      controlPlane: existingControlPlane,
      migrated: false,
    };
  }

  if (!isRecord(legacyControlPlaneRaw)) {
    warnings.push(WARNING_CONTROL_PLANE_INVALID);
    return {
      controlPlane: existingControlPlane,
      migrated: false,
    };
  }

  const validationResult = WorkspaceV2ExtensionsSchema.safeParse({
    [WORKSPACE_SOFTWARE_DELIVERY_KEY]: {},
    [WORKSPACE_CONTROL_PLANE_KEY]: legacyControlPlaneRaw,
  });

  if (!validationResult.success) {
    warnings.push(WARNING_CONTROL_PLANE_INVALID);
    return {
      controlPlane: existingControlPlane,
      migrated: false,
    };
  }

  const migratedControlPlane = validationResult.data[WORKSPACE_CONTROL_PLANE_KEY] as Record<
    string,
    unknown
  >;

  if (existingControlPlane && !isDeepStrictEqual(existingControlPlane, migratedControlPlane)) {
    warnings.push(WARNING_CONTROL_PLANE_REPLACED);
  }

  return {
    controlPlane: migratedControlPlane,
    migrated: true,
  };
}

export function buildWorkspaceMigrationPlan(
  input: WorkspaceMigrationPlanInput,
): WorkspaceMigrationPlan {
  const {
    legacyConfig,
    existingWorkspace,
    sourcePath = LEGACY_CONFIG_FILE_NAME,
    targetPath = WORKSPACE_CONFIG_FILE_NAME,
  } = input;

  if (!isRecord(legacyConfig)) {
    throw new Error(`${MIGRATION_LOG_PREFIX} Legacy config must be a YAML object.`);
  }

  const warnings: string[] = [];
  const normalizedLegacy = normalizeConfigKeys(legacyConfig);
  const softwareDeliveryConfig = parseConfig(normalizedLegacy) as unknown as Record<
    string,
    unknown
  >;

  const { workspace: baseWorkspace, workspaceCreated } = resolveBaseWorkspace(
    existingWorkspace,
    warnings,
  );
  const existingSoftwareDelivery = baseWorkspace[WORKSPACE_SOFTWARE_DELIVERY_KEY];

  if (
    !workspaceCreated &&
    isRecord(existingSoftwareDelivery) &&
    !isDeepStrictEqual(existingSoftwareDelivery, softwareDeliveryConfig)
  ) {
    warnings.push(WARNING_SOFTWARE_DELIVERY_REPLACED);
  }

  const controlPlaneMigration = resolveControlPlaneMigration(legacyConfig, baseWorkspace, warnings);
  const migratedWorkspace: Record<string, unknown> = {
    ...baseWorkspace,
    [WORKSPACE_SOFTWARE_DELIVERY_KEY]: softwareDeliveryConfig,
  };

  if (controlPlaneMigration.controlPlane) {
    migratedWorkspace[WORKSPACE_CONTROL_PLANE_KEY] = controlPlaneMigration.controlPlane;
  }

  if (!hasValidWorkspaceShape(migratedWorkspace)) {
    throw new Error(
      `${MIGRATION_LOG_PREFIX} Generated workspace is invalid. Ensure required workspace keys exist before retrying migration.`,
    );
  }
  const softwareDeliveryKeys = Object.keys(softwareDeliveryConfig).sort();

  return {
    workspace: migratedWorkspace,
    summary: {
      sourcePath,
      targetPath,
      workspaceCreated,
      softwareDeliveryKeyCount: softwareDeliveryKeys.length,
      softwareDeliveryKeys,
      controlPlaneMigrated: controlPlaneMigration.migrated,
      warnings,
    },
  };
}

export function formatWorkspaceMigrationSummary(summary: WorkspaceMigrationSummary): string {
  const softwareDeliveryKeySummary =
    summary.softwareDeliveryKeys.length > 0 ? ` (${summary.softwareDeliveryKeys.join(', ')})` : '';
  const lines = [
    `${MIGRATION_LOG_PREFIX} Migration summary`,
    `  source: ${summary.sourcePath}`,
    `  target: ${summary.targetPath}`,
    `  workspace_created: ${summary.workspaceCreated ? YES_LABEL : NO_LABEL}`,
    `  software_delivery_keys: ${summary.softwareDeliveryKeyCount}${softwareDeliveryKeySummary}`,
    `  control_plane_migrated: ${summary.controlPlaneMigrated ? YES_LABEL : NO_LABEL}`,
    `  warnings: ${summary.warnings.length}`,
  ];

  if (summary.warnings.length > 0) {
    summary.warnings.forEach((warning, index) => {
      lines.push(`  warning_${index + 1}: ${warning}`);
    });
  }

  return lines.join('\n');
}

export function executeWorkspaceMigration(args: UpgradeArgs): void {
  const projectRoot = findProjectRoot();
  const legacyPath = path.resolve(projectRoot, args.legacyPath ?? LEGACY_CONFIG_FILE_NAME);
  const workspacePath = path.resolve(projectRoot, args.workspacePath ?? WORKSPACE_CONFIG_FILE_NAME);

  if (!existsSync(legacyPath)) {
    throw new Error(`${MIGRATION_LOG_PREFIX} Legacy config not found: ${legacyPath}`);
  }

  const legacyConfig = readYamlRecord(legacyPath, LEGACY_CONFIG_FILE_NAME);
  const existingWorkspace = existsSync(workspacePath)
    ? readYamlRecord(workspacePath, WORKSPACE_CONFIG_FILE_NAME)
    : undefined;

  const migrationPlan = buildWorkspaceMigrationPlan({
    legacyConfig,
    existingWorkspace,
    sourcePath: legacyPath,
    targetPath: workspacePath,
  });

  console.log(formatWorkspaceMigrationSummary(migrationPlan.summary));

  if (args.dryRun) {
    console.log(`${MIGRATION_LOG_PREFIX} DRY RUN - no files written.`);
    return;
  }

  writeFileSync(workspacePath, YAML.stringify(migrationPlan.workspace), YAML_ENCODING);
  console.log(`${MIGRATION_LOG_PREFIX} Wrote migrated workspace config to ${workspacePath}`);
}

/**
 * WU-1127: Execute the upgrade in a micro-worktree
 *
 * Uses the shared micro-worktree pattern (like wu:create, wu:edit) to:
 * 1. Create a temporary worktree without switching main checkout
 * 2. Run pnpm add in the temporary worktree
 * 3. Commit the changes
 * 4. FF-only merge to main
 * 5. Push to origin
 * 6. Cleanup
 *
 * @param args - Parsed upgrade arguments
 * @returns Promise resolving when upgrade is complete
 */
export async function executeUpgradeInMicroWorktree(args: UpgradeArgs): Promise<void> {
  const { addCommand, versionSpec } = buildUpgradeCommands(args);

  // Generate unique ID for this upgrade operation using timestamp
  const upgradeId = `upgrade-${Date.now()}`;

  console.log(`${LOG_PREFIX} Using micro-worktree isolation (WU-1127)`);
  console.log(`${LOG_PREFIX} Upgrading @lumenflow/* packages to ${versionSpec}`);
  console.log(`${LOG_PREFIX} Packages: ${LUMENFLOW_PACKAGES.length} packages`);

  await withMicroWorktree({
    operation: OPERATION_NAME,
    id: upgradeId,
    logPrefix: LOG_PREFIX,
    execute: async ({ worktreePath }) => {
      console.log(`${LOG_PREFIX} Running: ${addCommand}`);

      // Execute pnpm add in the micro-worktree
      execSync(addCommand, {
        stdio: STDIO_MODES.INHERIT,
        cwd: worktreePath,
      });

      console.log(`${LOG_PREFIX} Package installation complete`);

      // Return files to stage and commit message
      return {
        commitMessage: `chore: upgrade @lumenflow packages to ${versionSpec}`,
        files: ['package.json', 'pnpm-lock.yaml'],
      };
    },
  });

  // WU-1622: Sync main checkout's node_modules after merge.
  // The micro-worktree updated package.json + lockfile and merged to main,
  // but main's node_modules still has the old packages. Without this step,
  // git hooks (pre-push, pre-commit) that import from @lumenflow/* would
  // crash because they resolve from the stale node_modules.
  // Note: execSync is safe here — no user input in the command string.
  console.log(`${LOG_PREFIX} Syncing node_modules with updated lockfile...`);
  execSync(`${PKG_MANAGER} install --frozen-lockfile`, {
    stdio: STDIO_MODES.INHERIT,
  });
  console.log(`${LOG_PREFIX} ✅ node_modules synced`);

  console.log(`\n${LOG_PREFIX} Upgrade complete!`);
  console.log(`${LOG_PREFIX} Upgraded to ${versionSpec}`);
  console.log(`\n${LOG_PREFIX} Next steps:`);
  console.log(`  1. Run 'pnpm build' to rebuild with new versions`);
  console.log(`  2. Run 'pnpm gates' to verify everything works`);
}

/**
 * Print help message for lumenflow-upgrade
 */
/* istanbul ignore next -- CLI entry point */
function printHelp(): void {
  console.log(`
Usage: lumenflow-upgrade [options]
       lumenflow-upgrade ${MIGRATE_WORKSPACE_SUBCOMMAND} [options]

Subcommands:
  (default)                    Upgrade all @lumenflow/* packages
  ${MIGRATE_WORKSPACE_SUBCOMMAND}  Migrate legacy config to workspace.yaml v2

Options:
  -v, --version <ver>        Upgrade to specific version (e.g., 1.5.0)
  -l, --latest               Upgrade to latest version
  -n, --dry-run              Show commands without executing
      --legacy <path>        Legacy config path for migration mode
      --workspace <path>     Workspace target path for migration mode
  -h, --help            Show this help message

Packages upgraded (all 7):
${LUMENFLOW_PACKAGES.map((p) => `  - ${p}`).join('\n')}

Examples:
  lumenflow:upgrade --version 1.5.0    # Upgrade to specific version
  lumenflow:upgrade --latest           # Upgrade to latest
  lumenflow:upgrade --latest --dry-run # Preview upgrade commands
  lumenflow-upgrade ${MIGRATE_WORKSPACE_SUBCOMMAND}
  lumenflow-upgrade ${MIGRATE_WORKSPACE_SUBCOMMAND} --dry-run
  lumenflow-upgrade ${MIGRATE_WORKSPACE_SUBCOMMAND} --legacy legacy.yaml --workspace workspace.yaml

Micro-Worktree Pattern (WU-1127):
  This command uses micro-worktree isolation to atomically update
  package.json and pnpm-lock.yaml without requiring you to claim a WU.

  Run from your main checkout (NOT from inside a worktree):
    cd /path/to/main
    pnpm lumenflow:upgrade --latest
`);
}

/**
 * Main entry point for lumenflow-upgrade command
 */
/* istanbul ignore next -- CLI entry point */
async function main(): Promise<void> {
  const args = parseUpgradeArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(EXIT_CODES.SUCCESS);
  }

  if (args.migrateWorkspace) {
    try {
      executeWorkspaceMigration(args);
      process.exit(EXIT_CODES.SUCCESS);
    } catch (error) {
      console.error(
        `${MIGRATION_LOG_PREFIX} ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(EXIT_CODES.ERROR);
    }
  }

  // Require either --version or --latest
  if (!args.version && !args.latest) {
    console.error(`${LOG_PREFIX} Error: Must specify --version <ver> or --latest`);
    printHelp();
    process.exit(EXIT_CODES.ERROR);
  }

  // WU-1127: Validate we're on main checkout (not in a worktree)
  const validation = await validateMainCheckout();
  if (!validation.valid) {
    console.error(`${LOG_PREFIX} ${validation.error}`);
    if (validation.fixCommand) {
      console.error(`\nTo fix:\n${validation.fixCommand}`);
    }
    process.exit(EXIT_CODES.ERROR);
  }

  // Build upgrade commands for dry-run display
  const { addCommand, versionSpec } = buildUpgradeCommands(args);

  if (args.dryRun) {
    console.log(`${LOG_PREFIX} DRY RUN - Commands that would be executed:`);
    console.log(`  ${addCommand}`);
    console.log(`\n${LOG_PREFIX} Packages: ${LUMENFLOW_PACKAGES.length}`);
    console.log(`${LOG_PREFIX} Version: ${versionSpec}`);
    console.log(`\n${LOG_PREFIX} No changes made.`);
    process.exit(EXIT_CODES.SUCCESS);
  }

  // Execute upgrade using micro-worktree
  try {
    await executeUpgradeInMicroWorktree(args);
  } catch (error) {
    console.error(`\n${LOG_PREFIX} Upgrade failed`);
    console.error(`${LOG_PREFIX} ${error instanceof Error ? error.message : String(error)}`);
    process.exit(EXIT_CODES.ERROR);
  }
}

// Run main if executed directly
if (import.meta.main) {
  void runCLI(main);
}
