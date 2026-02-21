#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @file onboard.ts
 * Interactive setup wizard for lumenflow onboard (WU-1927)
 *
 * Target: produces a working workspace in 60 seconds.
 * Detects env, chooses domain, generates workspace.yaml,
 * installs pack, launches dashboard, first task walkthrough.
 *
 * Uses @clack/prompts for interactive UI.
 *
 * Usage:
 *   lumenflow onboard               # Interactive mode
 *   lumenflow onboard --yes         # Accept all defaults (software-delivery)
 *   lumenflow onboard --domain infra # Skip domain prompt
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createWUParser } from '@lumenflow/core';
import YAML from 'yaml';
import {
  buildWorkspaceConfig,
  DEFAULT_DENY_OVERLAYS,
  DEFAULT_LANE_TITLE,
  DEFAULT_PROJECT_NAME,
  DEFAULT_SANDBOX_NETWORK_PROFILE,
  WORKSPACE_FILENAME,
  generateWorkspaceYaml,
} from './workspace-init.js';
import { DEFAULT_REGISTRY_URL, installPackFromRegistry, type FetchFn } from './pack-install.js';
import { runCLI } from './cli-entry-point.js';

// --- Constants ---

export const LOG_PREFIX = '[onboard]';

const NODE_BINARY = 'node';
const GIT_BINARY = 'git';
const DEFAULT_DOMAIN_PACK_VERSION = 'latest';
const DOMAIN_IDS = {
  SOFTWARE_DELIVERY: 'software-delivery',
  INFRA: 'infra',
  CUSTOM: 'custom',
} as const;
const DOMAIN_PACK_IDS = {
  SOFTWARE_DELIVERY: 'software-delivery',
  INFRA: 'infra',
} as const;
const DEFAULT_ONBOARD_LANE_TITLE = DEFAULT_LANE_TITLE;
const DOMAIN_DEFAULT_PACKS: Readonly<Record<DomainChoice, readonly string[]>> = {
  [DOMAIN_IDS.SOFTWARE_DELIVERY]: [DOMAIN_PACK_IDS.SOFTWARE_DELIVERY],
  [DOMAIN_IDS.INFRA]: [DOMAIN_PACK_IDS.INFRA],
  [DOMAIN_IDS.CUSTOM]: [],
} as const;
const DOMAIN_DEFAULT_LANES: Readonly<Record<DomainChoice, readonly string[]>> = {
  [DOMAIN_IDS.SOFTWARE_DELIVERY]: ['Backend', 'Frontend', 'DevOps'],
  [DOMAIN_IDS.INFRA]: ['Provisioning', 'Networking', 'Security'],
  [DOMAIN_IDS.CUSTOM]: [DEFAULT_ONBOARD_LANE_TITLE],
} as const;
const DOMAIN_EMPTY_PACK_ID = 'none';
const ONBOARD_DEFAULT_DOMAIN = DOMAIN_IDS.SOFTWARE_DELIVERY;
const ONBOARD_FALLBACK_PROJECT_NAME = DEFAULT_PROJECT_NAME;

/** Domain pack IDs mapped to human-readable descriptions */
export const DOMAIN_CHOICES = [
  {
    value: DOMAIN_IDS.SOFTWARE_DELIVERY,
    label: 'Software Delivery',
    hint: 'Git tools, worktree isolation, quality gates, lane locking',
  },
  {
    value: DOMAIN_IDS.INFRA,
    label: 'Infrastructure',
    hint: 'Terraform, Ansible, cloud resource management',
  },
  {
    value: DOMAIN_IDS.CUSTOM,
    label: 'Custom (empty)',
    hint: 'Start with an empty workspace and add packs manually',
  },
] as const;

export type DomainChoice = (typeof DOMAIN_CHOICES)[number]['value'];

// --- Environment detection (AC1) ---

export interface ToolDetection {
  available: boolean;
  version: string;
}

export interface EnvironmentInfo {
  node: ToolDetection;
  git: ToolDetection;
  existingWorkspace: boolean;
}

/**
 * Get version of a CLI tool by running it with a version flag.
 * Returns 'not found' if the tool is not available.
 */
function getToolVersion(binary: string, args: string[]): string {
  try {
    const output = execFileSync(binary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    })
      .toString()
      .trim();
    // Extract version number (e.g., "v22.0.0" -> "22.0.0", "git version 2.43.0" -> "2.43.0")
    const match = output.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : output;
  } catch {
    return 'not found';
  }
}

/**
 * AC1: Detect Node.js, git, and existing workspace.
 *
 * @param targetDir - Directory to check for existing workspace
 * @returns Environment detection results
 */
export async function detectEnvironment(targetDir: string): Promise<EnvironmentInfo> {
  const nodeVersion = getToolVersion(NODE_BINARY, ['--version']);
  const gitVersion = getToolVersion(GIT_BINARY, ['--version']);

  const workspacePath = path.join(targetDir, WORKSPACE_FILENAME);
  const existingWorkspace = fs.existsSync(workspacePath);

  return {
    node: {
      available: nodeVersion !== 'not found',
      version: nodeVersion,
    },
    git: {
      available: gitVersion !== 'not found',
      version: gitVersion,
    },
    existingWorkspace,
  };
}

// --- Workspace generation (AC3) ---

export interface GenerateWorkspaceOptions {
  projectName: string;
  domain: DomainChoice;
  force?: boolean;
}

export interface GenerateWorkspaceResult {
  success: boolean;
  workspacePath?: string;
  error?: string;
}

/**
 * Build pack configuration for a given domain.
 *
 * @param domain - The selected domain
 * @returns Array of pack IDs to include
 */
function getPacksForDomain(domain: DomainChoice): string[] {
  return [...DOMAIN_DEFAULT_PACKS[domain]];
}

/**
 * Build lane configuration for a given domain.
 *
 * @param domain - The selected domain
 * @returns Array of lane titles
 */
function getLanesForDomain(domain: DomainChoice): string[] {
  return [...DOMAIN_DEFAULT_LANES[domain]];
}

/**
 * Convert a string to kebab-case.
 */
function toKebabCase(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * AC3: Generate workspace.yaml with the selected domain pack.
 *
 * @param targetDir - Directory to write workspace.yaml into
 * @param options - Generation options including project name and domain
 * @returns Result of workspace generation
 */
export async function generateWorkspaceForDomain(
  targetDir: string,
  options: GenerateWorkspaceOptions,
): Promise<GenerateWorkspaceResult> {
  const workspacePath = path.join(targetDir, WORKSPACE_FILENAME);

  // Check for existing file
  if (fs.existsSync(workspacePath) && !options.force) {
    return {
      success: false,
      error: `${WORKSPACE_FILENAME} already exists at ${workspacePath}. Use --force to overwrite.`,
    };
  }

  const lanes = getLanesForDomain(options.domain);
  const projectId = toKebabCase(options.projectName);

  // Build the workspace config using the existing buildWorkspaceConfig helper
  const config = buildWorkspaceConfig({
    projectName: options.projectName,
    lanes,
    sandboxProfile: DEFAULT_SANDBOX_NETWORK_PROFILE,
    deniedPaths: [...DEFAULT_DENY_OVERLAYS],
    cloudConnect: false,
  });

  // Installable packs are added in AC4 via installDomainPack.
  // Keep generated workspace valid and placeholder-free.
  config.packs = [];

  // Update ID and namespace to match project name
  config.id = projectId;
  config.memory_namespace = projectId;
  config.event_namespace = projectId;

  // Ensure target directory exists
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Generate and write the YAML
  const yamlContent = generateWorkspaceYaml(config);
  fs.writeFileSync(workspacePath, yamlContent, 'utf-8');

  return {
    success: true,
    workspacePath,
  };
}

// --- Pack installation (AC4) ---

export interface InstallDomainPackOptions {
  domain: DomainChoice;
  skipInstall?: boolean;
  registryUrl?: string;
  fetchFn?: FetchFn;
}

export interface InstallDomainPackResult {
  packId: string;
  skipped: boolean;
  reason?: string;
  error?: string;
  version?: string;
  integrity?: string;
}

/**
 * AC4: Install the domain pack for the selected domain.
 *
 * For software-delivery and infra, delegates to pack:install.
 * For custom, skips installation (no pack to install).
 *
 * @param targetDir - Workspace root directory
 * @param options - Install options including domain and skipInstall flag
 * @returns Installation result
 */
export async function installDomainPack(
  targetDir: string,
  options: InstallDomainPackOptions,
): Promise<InstallDomainPackResult> {
  const packs = getPacksForDomain(options.domain);

  if (packs.length === 0) {
    return {
      packId: DOMAIN_EMPTY_PACK_ID,
      skipped: true,
      reason: `No packs to install for custom domain. Add packs manually with: pnpm pack:install --id <pack-id>`,
    };
  }

  const packId = packs[0];

  if (options.skipInstall) {
    return {
      packId,
      skipped: true,
      reason: 'Installation skipped (--skip-pack-install or test mode)',
    };
  }

  const registryUrl = options.registryUrl ?? DEFAULT_REGISTRY_URL;
  const installResult = await installPackFromRegistry({
    workspaceRoot: targetDir,
    packId,
    version: DEFAULT_DOMAIN_PACK_VERSION,
    registryUrl,
    fetchFn: options.fetchFn ?? globalThis.fetch,
  });

  if (!installResult.success) {
    return {
      packId,
      skipped: true,
      error: installResult.error,
      reason:
        `Registry install unavailable for "${packId}" (${installResult.error}). ` +
        `Continue now and retry later with: pnpm pack:install --id ${packId} --source registry --version ${DEFAULT_DOMAIN_PACK_VERSION}`,
    };
  }

  // Extract the resolved version/integrity from workspace.yaml after install.
  let installedVersion: string | undefined;
  let installedIntegrity: string | undefined;
  try {
    const workspacePath = path.join(targetDir, WORKSPACE_FILENAME);
    const workspaceRaw = fs.readFileSync(workspacePath, 'utf-8');
    const parsed = YAML.parse(workspaceRaw) as {
      packs?: Array<{ id?: string; version?: string; integrity?: string }>;
    };
    const installedPack = (parsed.packs ?? []).find((entry) => entry.id === packId);
    installedVersion = installedPack?.version;
    installedIntegrity = installedPack?.integrity;
  } catch {
    // Best-effort enrichment only; install already succeeded.
  }

  return {
    packId,
    skipped: false,
    version: installedVersion,
    integrity: installedIntegrity ?? installResult.integrity,
  };
}

// --- Dashboard launch (AC5) ---

export interface LaunchDashboardOptions {
  dryRun?: boolean;
}

export interface LaunchDashboardResult {
  launched: boolean;
  instruction: string;
}

/**
 * AC5: Launch the web dashboard.
 *
 * The dashboard (apps/web/) may not be available yet.
 * Returns instructions for how to start it.
 *
 * @param targetDir - Workspace root directory
 * @param options - Launch options
 * @returns Dashboard launch result with instruction
 */
export async function launchDashboard(
  targetDir: string,
  options: LaunchDashboardOptions = {},
): Promise<LaunchDashboardResult> {
  // Check if apps/web exists (indicates dashboard is available)
  const dashboardDir = path.join(targetDir, 'apps', 'web');
  const hasDashboard = fs.existsSync(dashboardDir);

  if (options.dryRun || !hasDashboard) {
    return {
      launched: false,
      instruction: hasDashboard
        ? 'Run "pnpm dev" in apps/web/ to start the dashboard at http://localhost:3000'
        : 'Dashboard not yet installed. Run "pnpm add @lumenflow/dashboard" to add it, then "pnpm dev" to start.',
    };
  }

  // In production, would start the dev server
  return {
    launched: false,
    instruction: 'Run "pnpm dev" in apps/web/ to start the dashboard at http://localhost:3000',
  };
}

// --- Full onboard orchestration ---

export interface OnboardOptions {
  targetDir: string;
  nonInteractive?: boolean;
  projectName?: string;
  domain?: DomainChoice;
  force?: boolean;
  skipPackInstall?: boolean;
  skipDashboard?: boolean;
  registryUrl?: string;
  fetchFn?: FetchFn;
}

export interface OnboardResult {
  success: boolean;
  environment?: EnvironmentInfo;
  workspaceGenerated?: boolean;
  packInstalled?: boolean;
  dashboardLaunched?: boolean;
  errors: string[];
}

/**
 * Run the full onboard wizard.
 *
 * Orchestrates all 5 acceptance criteria:
 * 1. Detect environment (Node, git, existing workspace)
 * 2. Choose domain (interactive or --domain flag)
 * 3. Generate workspace.yaml
 * 4. Install domain pack
 * 5. Launch dashboard
 *
 * @param options - Onboard options
 * @returns Onboard result
 */
export async function runOnboard(options: OnboardOptions): Promise<OnboardResult> {
  const {
    targetDir,
    projectName = ONBOARD_FALLBACK_PROJECT_NAME,
    domain = ONBOARD_DEFAULT_DOMAIN,
    force = false,
    skipPackInstall = false,
    skipDashboard = false,
    registryUrl = DEFAULT_REGISTRY_URL,
    fetchFn = globalThis.fetch,
  } = options;

  const errors: string[] = [];
  const result: OnboardResult = {
    success: false,
    errors,
  };

  // Step 1: Detect environment (AC1)
  const env = await detectEnvironment(targetDir);
  result.environment = env;

  if (!env.node.available) {
    errors.push(
      'Node.js is required but not found. Install Node.js >= 22 from https://nodejs.org/',
    );
  }

  if (!env.git.available) {
    errors.push('Git is required but not found. Install Git from https://git-scm.com/');
  }

  if (errors.length > 0) {
    return result;
  }

  // Step 2: Domain selection (AC2)
  // runOnboard always uses the provided domain parameter.
  // Interactive domain selection is handled by runInteractiveOnboard().
  const selectedDomain: DomainChoice = domain;

  // Step 3: Generate workspace.yaml (AC3)
  const genResult = await generateWorkspaceForDomain(targetDir, {
    projectName,
    domain: selectedDomain,
    force,
  });

  if (!genResult.success) {
    errors.push(genResult.error ?? 'Failed to generate workspace.yaml');
    return result;
  }

  result.workspaceGenerated = true;

  // Step 4: Install domain pack (AC4)
  if (!skipPackInstall) {
    const installResult = await installDomainPack(targetDir, {
      domain: selectedDomain,
      skipInstall: skipPackInstall,
      registryUrl,
      fetchFn,
    });
    result.packInstalled = !installResult.skipped;
  } else {
    result.packInstalled = false;
  }

  // Step 5: Launch dashboard (AC5)
  if (!skipDashboard) {
    const dashResult = await launchDashboard(targetDir, { dryRun: true });
    result.dashboardLaunched = dashResult.launched;
  }

  result.success = errors.length === 0;
  return result;
}

// --- Interactive mode with @clack/prompts ---

/**
 * Run the interactive onboard wizard using @clack/prompts.
 *
 * This is the main entry point for interactive mode.
 */
async function runInteractiveOnboard(targetDir: string, force: boolean): Promise<void> {
  // Dynamic import to avoid loading @clack/prompts in non-interactive mode
  const clack = await import('@clack/prompts');

  clack.intro('Welcome to LumenFlow');

  // Step 1: Detect environment
  const spinner = clack.spinner();
  spinner.start('Detecting environment...');

  const env = await detectEnvironment(targetDir);

  if (!env.node.available || !env.git.available) {
    spinner.stop('Environment check failed');
    const missing: string[] = [];
    if (!env.node.available) missing.push('Node.js >= 22');
    if (!env.git.available) missing.push('Git >= 2.0');
    clack.cancel(`Missing requirements: ${missing.join(', ')}`);
    process.exit(1);
  }

  spinner.stop(
    `Node.js ${env.node.version} and Git ${env.git.version} detected` +
      (env.existingWorkspace ? ' (existing workspace found)' : ''),
  );

  // Step 2: Project name
  const projectName = await clack.text({
    message: 'Project name',
    placeholder: ONBOARD_FALLBACK_PROJECT_NAME,
    defaultValue: ONBOARD_FALLBACK_PROJECT_NAME,
    validate: (value: string | undefined) => {
      if (!value?.trim()) return 'Project name is required';
      return undefined;
    },
  });

  if (clack.isCancel(projectName)) {
    clack.cancel('Onboarding cancelled');
    process.exit(0);
  }

  // Step 3: Domain choice (AC2)
  const domain = await clack.select({
    message: 'Choose your domain',
    options: DOMAIN_CHOICES.map((c) => ({
      value: c.value,
      label: c.label,
      hint: c.hint,
    })),
  });

  if (clack.isCancel(domain)) {
    clack.cancel('Onboarding cancelled');
    process.exit(0);
  }

  // Step 4: Generate workspace (AC3)
  spinner.start('Generating workspace.yaml...');

  const genResult = await generateWorkspaceForDomain(targetDir, {
    projectName: projectName as string,
    domain: domain as DomainChoice,
    force,
  });

  if (!genResult.success) {
    spinner.stop('Failed');
    clack.cancel(genResult.error ?? 'Failed to generate workspace.yaml');
    process.exit(1);
  }

  spinner.stop('workspace.yaml created');

  // Step 5: Install pack (AC4)
  if (domain !== DOMAIN_IDS.CUSTOM) {
    spinner.start(`Installing ${domain} pack...`);

    const installResult = await installDomainPack(targetDir, {
      domain: domain as DomainChoice,
    });

    if (installResult.skipped && installResult.reason) {
      spinner.stop(installResult.reason);
    } else {
      spinner.stop(`Pack "${installResult.packId}" installed`);
    }
  }

  // Step 6: Dashboard (AC5)
  const dashResult = await launchDashboard(targetDir);

  // Final summary
  clack.note(
    [
      `Workspace: ${WORKSPACE_FILENAME}`,
      `Domain: ${domain}`,
      `Dashboard: ${dashResult.instruction}`,
      '',
      'Next steps:',
      '  1. Run "lumenflow init" to scaffold agent config files',
      `  2. Create your first task: pnpm wu:create --lane "${DEFAULT_LANE_TITLE}" --title "My first task"`,
      '  3. Claim it: pnpm wu:claim --id WU-1',
    ].join('\n'),
    'Setup complete',
  );

  clack.outro('Happy building!');
}

// --- CLI entry point ---

const ONBOARD_OPTIONS = {
  yes: {
    name: 'yes',
    flags: '--yes, -y',
    description: 'Accept all defaults non-interactively',
  },
  domain: {
    name: 'domain',
    flags: '--domain <domain>',
    description: 'Domain pack: software-delivery, infra, or custom',
  },
  projectName: {
    name: 'projectName',
    flags: '--project-name <name>',
    description: 'Project name (default: directory name or "my-project")',
  },
  output: {
    name: 'output',
    flags: '--output, -o <dir>',
    description: 'Output directory (default: current directory)',
  },
  force: {
    name: 'force',
    flags: '--force, -f',
    description: 'Overwrite existing workspace.yaml',
  },
  skipPackInstall: {
    name: 'skipPackInstall',
    flags: '--skip-pack-install',
    description: 'Skip pack installation step',
  },
  skipDashboard: {
    name: 'skipDashboard',
    flags: '--skip-dashboard',
    description: 'Skip dashboard launch step',
  },
};

/**
 * CLI main entry point for lumenflow onboard
 */
export async function main(): Promise<void> {
  const opts = createWUParser({
    name: 'onboard',
    description: 'Interactive setup wizard for LumenFlow workspace',
    options: [
      ONBOARD_OPTIONS.yes,
      ONBOARD_OPTIONS.domain,
      ONBOARD_OPTIONS.projectName,
      ONBOARD_OPTIONS.output,
      ONBOARD_OPTIONS.force,
      ONBOARD_OPTIONS.skipPackInstall,
      ONBOARD_OPTIONS.skipDashboard,
    ],
  });

  const targetDir = (opts.output as string | undefined) ?? process.cwd();
  const force = Boolean(opts.force);
  const useDefaults = Boolean(opts.yes);
  const domain = (opts.domain as DomainChoice | undefined) ?? ONBOARD_DEFAULT_DOMAIN;
  const projectName =
    (opts.projectName as string | undefined) ?? path.basename(path.resolve(targetDir));
  const skipPackInstall = Boolean(opts.skipPackInstall);
  const skipDashboard = Boolean(opts.skipDashboard);

  if (useDefaults) {
    // Non-interactive mode
    const result = await runOnboard({
      targetDir,
      nonInteractive: true,
      projectName,
      domain,
      force,
      skipPackInstall,
      skipDashboard,
    });

    if (!result.success) {
      console.error(`${LOG_PREFIX} Onboarding failed:`);
      for (const error of result.errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }

    console.log(`${LOG_PREFIX} Workspace created at ${targetDir}/${WORKSPACE_FILENAME}`);
    console.log(`${LOG_PREFIX} Domain: ${domain}`);
    if (!skipPackInstall && result.packInstalled === false) {
      console.warn(
        `${LOG_PREFIX} Warning: Pack install did not complete. Retry with: pnpm pack:install --id ${domain} --source registry --version ${DEFAULT_DOMAIN_PACK_VERSION}`,
      );
    }
    console.log(`${LOG_PREFIX} Next: run "lumenflow init" to scaffold agent config files`);
  } else {
    // Interactive mode with @clack/prompts
    await runInteractiveOnboard(targetDir, force);
  }
}

// Run if executed directly
if (import.meta.main) {
  void runCLI(main);
}
