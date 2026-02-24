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
import { createWUParser, createError, ErrorCodes } from '@lumenflow/core';
import {
  WorkspaceControlPlaneConfigSchema,
  type WorkspaceControlPlaneConfig,
  type WorkspaceControlPlanePolicyMode,
} from '@lumenflow/kernel';
import YAML from 'yaml';
import {
  buildWorkspaceConfig,
  CANONICAL_BOOTSTRAP_COMMAND,
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
const LEGACY_MARKER = 'legacy';
const LEGACY_ONBOARD_ENTRYPOINT = 'onboard';
const LEGACY_ONBOARD_ALIAS = 'lumenflow-onboard';
const LEGACY_ONBOARD_CONNECT_ENTRYPOINT = `${LEGACY_ONBOARD_ENTRYPOINT} connect`;
const CANONICAL_CLOUD_CONNECT_COMMAND = 'npx lumenflow cloud connect';
const LEGACY_ONBOARD_MESSAGE_PREFIX = `${LOG_PREFIX} ${LEGACY_MARKER} entrypoint`;

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
const ONBOARD_SUBCOMMAND_CONNECT = 'connect';
const CLOUD_CONNECT_LOG_PREFIX = '[cloud connect]';
const CLOUD_CONNECT_DEFAULT_TOKEN_ENV = 'LUMENFLOW_CONTROL_PLANE_TOKEN';
const CLOUD_CONNECT_DEFAULT_SYNC_INTERVAL_SECONDS = 30;
const CLOUD_CONNECT_POLICY_MODES = {
  AUTHORITATIVE: 'authoritative',
  TIGHTEN_ONLY: 'tighten-only',
  DEV_OVERRIDE: 'dev-override',
} as const;
const CLOUD_CONNECT_DEFAULT_POLICY_MODE = CLOUD_CONNECT_POLICY_MODES.TIGHTEN_ONLY;
const CLOUD_CONNECT_ALLOWED_POLICY_MODES = new Set<WorkspaceControlPlanePolicyMode>([
  CLOUD_CONNECT_POLICY_MODES.AUTHORITATIVE,
  CLOUD_CONNECT_POLICY_MODES.TIGHTEN_ONLY,
  CLOUD_CONNECT_POLICY_MODES.DEV_OVERRIDE,
]);
const CLOUD_CONNECT_ALLOWED_POLICY_MODE_NAMES = new Set<string>([
  ...CLOUD_CONNECT_ALLOWED_POLICY_MODES,
]);
const CLOUD_CONNECT_SECURE_PROTOCOL = 'https:';
const CLOUD_CONNECT_LOCAL_PROTOCOL = 'http:';
const CLOUD_CONNECT_LOCAL_HOSTS = new Set<string>(['localhost', '127.0.0.1', '::1']);
const CLOUD_CONNECT_ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const CLOUD_CONNECT_HELP_HINT =
  'Example: npx lumenflow cloud connect --endpoint https://cp.example --org-id org-1 --project-id project-1 --token-env LUMENFLOW_CONTROL_PLANE_TOKEN';
const YAML_TRAILING_NEWLINE = '\n';

export function buildLegacyOnboardGuidance(entrypoint = LEGACY_ONBOARD_ENTRYPOINT): string {
  return (
    `${LEGACY_ONBOARD_MESSAGE_PREFIX} "${entrypoint}" is retired. ` +
    `Use "${CANONICAL_BOOTSTRAP_COMMAND}" for bootstrap-all onboarding.`
  );
}

function buildLegacyCloudConnectGuidance(entrypoint = LEGACY_ONBOARD_CONNECT_ENTRYPOINT): string {
  return (
    `${LEGACY_ONBOARD_MESSAGE_PREFIX} "${entrypoint}" is retired. ` +
    `Use "${CANONICAL_CLOUD_CONNECT_COMMAND}" instead.`
  );
}

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

export interface CloudConnectInput {
  targetDir: string;
  endpoint: string;
  orgId: string;
  projectId: string;
  tokenEnv: string;
  policyMode: WorkspaceControlPlanePolicyMode;
  syncInterval: number;
  force?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface CloudConnectResult {
  success: boolean;
  workspacePath?: string;
  controlPlaneConfig?: WorkspaceControlPlaneConfig;
  error?: string;
}

const CLOUD_CONNECT_OPTIONS = {
  endpoint: {
    name: 'endpoint',
    flags: '--endpoint <url>',
    description: 'Cloud control-plane endpoint URL',
  },
  orgId: {
    name: 'orgId',
    flags: '--org-id <id>',
    description: 'Cloud organization identifier',
  },
  projectId: {
    name: 'projectId',
    flags: '--project-id <id>',
    description: 'Cloud project identifier',
  },
  tokenEnv: {
    name: 'tokenEnv',
    flags: '--token-env <name>',
    description: `Environment variable containing cloud auth token (default: ${CLOUD_CONNECT_DEFAULT_TOKEN_ENV})`,
  },
  policyMode: {
    name: 'policyMode',
    flags: '--policy-mode <mode>',
    description: 'Policy mode: authoritative, tighten-only, dev-override',
  },
  syncInterval: {
    name: 'syncInterval',
    flags: '--sync-interval <seconds>',
    description: 'Control-plane sync interval in seconds (positive integer)',
  },
  output: {
    name: 'output',
    flags: '--output, -o <dir>',
    description: 'Workspace root directory (default: current directory)',
  },
  force: {
    name: 'force',
    flags: '--force, -f',
    description: 'Overwrite existing control_plane section in workspace.yaml',
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parsePositiveInt(value: unknown, fieldName: string): number {
  const parsedValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw createError(
      ErrorCodes.INVALID_ARGUMENT,
      `${CLOUD_CONNECT_LOG_PREFIX} Invalid ${fieldName}: expected a positive integer`,
    );
  }
  return parsedValue;
}

function parsePolicyMode(value: unknown): WorkspaceControlPlanePolicyMode {
  if (typeof value !== 'string' || !CLOUD_CONNECT_ALLOWED_POLICY_MODE_NAMES.has(value)) {
    const allowedValues = [...CLOUD_CONNECT_ALLOWED_POLICY_MODES].join(', ');
    throw createError(
      ErrorCodes.INVALID_ARGUMENT,
      `${CLOUD_CONNECT_LOG_PREFIX} Invalid --policy-mode "${String(value)}". Valid values: ${allowedValues}`,
    );
  }

  return value as WorkspaceControlPlanePolicyMode;
}

function validateEndpoint(endpoint: string): string {
  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw createError(
      ErrorCodes.INVALID_ARGUMENT,
      `${CLOUD_CONNECT_LOG_PREFIX} Invalid endpoint "${endpoint}": expected a valid URL`,
    );
  }

  const isSecureProtocol = parsedEndpoint.protocol === CLOUD_CONNECT_SECURE_PROTOCOL;
  const isLocalHost = CLOUD_CONNECT_LOCAL_HOSTS.has(parsedEndpoint.hostname);
  const isLocalHttp =
    parsedEndpoint.protocol === CLOUD_CONNECT_LOCAL_PROTOCOL && isLocalHost === true;

  if (!isSecureProtocol && !isLocalHttp) {
    throw createError(
      ErrorCodes.INVALID_ARGUMENT,
      `${CLOUD_CONNECT_LOG_PREFIX} Endpoint must use https (or http for localhost only): ${endpoint}`,
    );
  }

  const normalizedEndpoint = parsedEndpoint.toString();
  return normalizedEndpoint.endsWith('/')
    ? normalizedEndpoint.slice(0, normalizedEndpoint.length - 1)
    : normalizedEndpoint;
}

function validateTokenEnvName(tokenEnv: string): string {
  if (!CLOUD_CONNECT_ENV_NAME_PATTERN.test(tokenEnv)) {
    throw createError(
      ErrorCodes.INVALID_ARGUMENT,
      `${CLOUD_CONNECT_LOG_PREFIX} Invalid --token-env "${tokenEnv}": expected an uppercase environment variable name`,
    );
  }
  return tokenEnv;
}

function ensureTokenValue(tokenEnv: string, env: NodeJS.ProcessEnv): string {
  const tokenValue = env[tokenEnv];
  if (!tokenValue || tokenValue.trim().length === 0) {
    throw createError(
      ErrorCodes.INVALID_ARGUMENT,
      `${CLOUD_CONNECT_LOG_PREFIX} Missing token env "${tokenEnv}". Export it before connect. ${CLOUD_CONNECT_HELP_HINT}`,
    );
  }
  return tokenValue;
}

function parseCloudConnectCliOptions(): CloudConnectInput {
  const opts = createWUParser({
    name: 'cloud-connect',
    description: 'Connect workspace.yaml to LumenFlow cloud control plane',
    options: [
      CLOUD_CONNECT_OPTIONS.endpoint,
      CLOUD_CONNECT_OPTIONS.orgId,
      CLOUD_CONNECT_OPTIONS.projectId,
      CLOUD_CONNECT_OPTIONS.tokenEnv,
      CLOUD_CONNECT_OPTIONS.policyMode,
      CLOUD_CONNECT_OPTIONS.syncInterval,
      CLOUD_CONNECT_OPTIONS.output,
      CLOUD_CONNECT_OPTIONS.force,
    ],
    required: [
      CLOUD_CONNECT_OPTIONS.endpoint.name,
      CLOUD_CONNECT_OPTIONS.orgId.name,
      CLOUD_CONNECT_OPTIONS.projectId.name,
    ],
  });

  const tokenEnvRaw = (opts.tokenEnv as string | undefined) ?? CLOUD_CONNECT_DEFAULT_TOKEN_ENV;
  const policyModeRaw =
    (opts.policyMode as string | undefined) ?? CLOUD_CONNECT_DEFAULT_POLICY_MODE;
  const syncIntervalRaw =
    (opts.syncInterval as string | number | undefined) ??
    CLOUD_CONNECT_DEFAULT_SYNC_INTERVAL_SECONDS;

  return {
    targetDir: ((opts.output as string | undefined) ?? process.cwd()).trim(),
    endpoint: validateEndpoint(String(opts.endpoint)),
    orgId: String(opts.orgId).trim(),
    projectId: String(opts.projectId).trim(),
    tokenEnv: validateTokenEnvName(tokenEnvRaw.trim()),
    policyMode: parsePolicyMode(policyModeRaw),
    syncInterval: parsePositiveInt(syncIntervalRaw, '--sync-interval'),
    force: Boolean(opts.force),
  };
}

function validateWorkspaceRootPath(targetDir: string): string {
  if (!targetDir || targetDir.trim().length === 0) {
    throw createError(
      ErrorCodes.INVALID_ARGUMENT,
      `${CLOUD_CONNECT_LOG_PREFIX} Invalid --output: path must be non-empty`,
    );
  }

  return path.resolve(targetDir);
}

function readWorkspaceDocument(workspacePath: string): Record<string, unknown> {
  if (!fs.existsSync(workspacePath)) {
    throw createError(
      ErrorCodes.WORKSPACE_NOT_FOUND,
      `${CLOUD_CONNECT_LOG_PREFIX} ${WORKSPACE_FILENAME} not found at ${workspacePath}. Run "lumenflow init" first to bootstrap a workspace.`,
    );
  }

  const rawContent = fs.readFileSync(workspacePath, 'utf-8');
  const parsedYaml = YAML.parse(rawContent) as unknown;
  if (!isRecord(parsedYaml)) {
    throw createError(
      ErrorCodes.WORKSPACE_MALFORMED,
      `${CLOUD_CONNECT_LOG_PREFIX} ${WORKSPACE_FILENAME} is malformed: expected YAML object at document root`,
    );
  }

  return parsedYaml;
}

function buildControlPlaneConfig(input: CloudConnectInput): WorkspaceControlPlaneConfig {
  const controlPlaneCandidate = {
    endpoint: input.endpoint,
    org_id: input.orgId,
    project_id: input.projectId,
    sync_interval: input.syncInterval,
    policy_mode: input.policyMode,
    auth: {
      token_env: input.tokenEnv,
    },
  };

  return WorkspaceControlPlaneConfigSchema.parse(controlPlaneCandidate);
}

export async function connectWorkspaceToCloud(
  options: CloudConnectInput,
): Promise<CloudConnectResult> {
  try {
    const workspaceRoot = validateWorkspaceRootPath(options.targetDir);
    const workspacePath = path.join(workspaceRoot, WORKSPACE_FILENAME);
    const workspaceDoc = readWorkspaceDocument(workspacePath);
    const runtimeEnv = options.env ?? process.env;

    ensureTokenValue(options.tokenEnv, runtimeEnv);

    if (workspaceDoc.control_plane && !options.force) {
      return {
        success: false,
        workspacePath,
        error:
          `${CLOUD_CONNECT_LOG_PREFIX} ${WORKSPACE_FILENAME} already has control_plane configuration. ` +
          'Use --force to overwrite.',
      };
    }

    const controlPlaneConfig = buildControlPlaneConfig(options);
    workspaceDoc.control_plane = controlPlaneConfig;

    const serializedWorkspace = YAML.stringify(workspaceDoc);
    const normalizedYaml = serializedWorkspace.endsWith(YAML_TRAILING_NEWLINE)
      ? serializedWorkspace
      : `${serializedWorkspace}${YAML_TRAILING_NEWLINE}`;
    fs.writeFileSync(workspacePath, normalizedYaml, 'utf-8');

    return {
      success: true,
      workspacePath,
      controlPlaneConfig,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runCloudConnectCli(): Promise<void> {
  const connectOptions = parseCloudConnectCliOptions();
  const result = await connectWorkspaceToCloud(connectOptions);

  if (!result.success) {
    console.error(result.error ?? `${CLOUD_CONNECT_LOG_PREFIX} Cloud connect failed`);
    process.exit(1);
  }

  console.log(`${CLOUD_CONNECT_LOG_PREFIX} Updated ${WORKSPACE_FILENAME}`);
  console.log(`${CLOUD_CONNECT_LOG_PREFIX} Endpoint: ${connectOptions.endpoint}`);
  console.log(`${CLOUD_CONNECT_LOG_PREFIX} Org ID: ${connectOptions.orgId}`);
  console.log(`${CLOUD_CONNECT_LOG_PREFIX} Project ID: ${connectOptions.projectId}`);
  console.log(`${CLOUD_CONNECT_LOG_PREFIX} Token env: ${connectOptions.tokenEnv}`);
}

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
async function _runInteractiveOnboard(targetDir: string, force: boolean): Promise<void> {
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

/**
 * CLI main entry point for lumenflow onboard
 */
export async function main(): Promise<void> {
  const invokedBinary = path.basename(process.argv[1] ?? LEGACY_ONBOARD_ENTRYPOINT, '.js');
  const invokedEntrypoint =
    invokedBinary === LEGACY_ONBOARD_ALIAS ? LEGACY_ONBOARD_ALIAS : LEGACY_ONBOARD_ENTRYPOINT;
  const subcommand = process.argv[2];
  if (subcommand === ONBOARD_SUBCOMMAND_CONNECT) {
    console.warn(
      buildLegacyCloudConnectGuidance(`${invokedEntrypoint} ${ONBOARD_SUBCOMMAND_CONNECT}`),
    );
    process.argv.splice(2, 1);
    await runCloudConnectCli();
    return;
  }

  console.warn(buildLegacyOnboardGuidance(invokedEntrypoint));
}

// Run if executed directly
if (import.meta.main) {
  void runCLI(main);
}
