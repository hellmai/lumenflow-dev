#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @file workspace-init.ts
 * Interactive wizard for generating workspace.yaml (WU-1871)
 *
 * Scaffolds a valid workspace.yaml via 5 interactive questions or --yes defaults.
 * Uses init-scaffolding.ts template infrastructure (processTemplate, createFile).
 * Generated YAML validates against WorkspaceSpecSchema from @lumenflow/kernel.
 *
 * Usage:
 *   pnpm workspace:init                # Interactive mode
 *   pnpm workspace:init --yes          # Accept all defaults
 *   pnpm workspace:init --output ./    # Specify output directory
 */

import * as readline from 'node:readline';
import * as path from 'node:path';
import YAML from 'yaml';
import type { PackPin, WorkspaceSpec } from '@lumenflow/kernel';
import { WORKSPACE_CONFIG_FILE_NAME } from '@lumenflow/core/config';
import { createFile, type ScaffoldResult } from './init-scaffolding.js';
import { runCLI } from './cli-entry-point.js';

export const LOG_PREFIX = '[workspace:init]';

export const WORKSPACE_FILENAME = WORKSPACE_CONFIG_FILE_NAME;
export const DEFAULT_WORKSPACE_ID = 'default';
export const DEFAULT_WORKSPACE_NAME = 'My Project';
export const DEFAULT_PROJECT_NAME = 'my-project';
export const DEFAULT_LANE_TITLE = 'Default';
export const DEFAULT_NAMESPACE = DEFAULT_WORKSPACE_ID;
export const CANONICAL_BOOTSTRAP_COMMAND = 'npx lumenflow';
const LEGACY_WORKSPACE_INIT_ENTRYPOINT = 'workspace-init';
const LEGACY_ENTRYPOINT_MARKER = 'legacy';
const LEGACY_ENTRYPOINT_MESSAGE_PREFIX = `${LOG_PREFIX} ${LEGACY_ENTRYPOINT_MARKER} entrypoint`;
export const DEFAULT_DENY_OVERLAYS = ['~/.ssh', '~/.aws', '~/.gnupg', '.env'] as const;
export const DEFAULT_DENY_OVERLAYS_PROMPT = DEFAULT_DENY_OVERLAYS.join(', ');
export const SANDBOX_NETWORK_PROFILE = {
  OFF: 'off',
  FULL: 'full',
} as const;
export type SandboxNetworkProfile =
  (typeof SANDBOX_NETWORK_PROFILE)[keyof typeof SANDBOX_NETWORK_PROFILE];
export const DEFAULT_SANDBOX_NETWORK_PROFILE = SANDBOX_NETWORK_PROFILE.OFF;
export const CLOUD_CONNECT_RESPONSE = {
  YES: 'yes',
  NO: 'no',
  SHORT_YES: 'y',
  BOOLEAN_TRUE: 'true',
} as const;
const CLOUD_CONNECT_TRUTHY = new Set<string>([
  CLOUD_CONNECT_RESPONSE.YES,
  CLOUD_CONNECT_RESPONSE.SHORT_YES,
  CLOUD_CONNECT_RESPONSE.BOOLEAN_TRUE,
]);
/**
 * Well-known pack constants for the software-delivery pack.
 * These mirror the canonical values in packages/@lumenflow/packs/software-delivery/constants.ts.
 * WU-2193: Used to auto-pin SD pack in default workspace configuration.
 */
const SD_PACK_ID = 'software-delivery' as const;
const SD_PACK_VERSION = '0.1.0' as const;

const EMPTY_SOFTWARE_DELIVERY_CONFIG: WorkspaceSpec['software_delivery'] = Object.freeze({});

function createEmptySoftwareDeliveryConfig(): WorkspaceSpec['software_delivery'] {
  return { ...EMPTY_SOFTWARE_DELIVERY_CONFIG };
}

/**
 * Default pack pin for the software-delivery pack.
 * WU-2193: Pinned by default so the software_delivery config block
 * is always backed by an explicitly pinned pack.
 */
export const DEFAULT_SOFTWARE_DELIVERY_PACK_PIN: PackPin = Object.freeze({
  id: SD_PACK_ID,
  version: SD_PACK_VERSION,
  integrity: 'dev' as const,
  source: 'local' as const,
});

function createDefaultPackPins(): PackPin[] {
  return [{ ...DEFAULT_SOFTWARE_DELIVERY_PACK_PIN }];
}

// --- Question definitions ---

export interface WorkspaceQuestion {
  name: string;
  prompt: string;
  defaultValue: string;
}

/**
 * AC1: 5 interactive questions for workspace configuration
 */
export const WORKSPACE_QUESTIONS: WorkspaceQuestion[] = [
  {
    name: 'projectName',
    prompt: 'Project name',
    defaultValue: DEFAULT_PROJECT_NAME,
  },
  {
    name: 'lanes',
    prompt: 'Work lanes (comma-separated, e.g., Backend, Frontend, DevOps)',
    defaultValue: DEFAULT_LANE_TITLE,
  },
  {
    name: 'sandboxProfile',
    prompt: 'Sandbox network profile (off | full)',
    defaultValue: DEFAULT_SANDBOX_NETWORK_PROFILE,
  },
  {
    name: 'deniedPaths',
    prompt: 'Denied paths (comma-separated, e.g., ~/.ssh, ~/.aws, .env)',
    defaultValue: DEFAULT_DENY_OVERLAYS_PROMPT,
  },
  {
    name: 'cloudConnect',
    prompt: 'Enable cloud agent support? (yes | no)',
    defaultValue: CLOUD_CONNECT_RESPONSE.NO,
  },
];

// --- Answer parsing ---

export interface WorkspaceConfigInput {
  projectName: string;
  lanes: string[];
  sandboxProfile: SandboxNetworkProfile;
  deniedPaths: string[];
  cloudConnect: boolean;
}

export function buildLegacyWorkspaceInitGuidance(
  entrypoint = LEGACY_WORKSPACE_INIT_ENTRYPOINT,
): string {
  return (
    `${LEGACY_ENTRYPOINT_MESSAGE_PREFIX} "${entrypoint}" is retired. ` +
    `Use "${CANONICAL_BOOTSTRAP_COMMAND}" for bootstrap-all onboarding.`
  );
}

/**
 * Parse raw string answers from interactive prompts into typed config inputs.
 */
export function parseAnswers(answers: Record<string, string>): WorkspaceConfigInput {
  const lanes = answers.lanes
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);

  const deniedPaths = answers.deniedPaths
    ? answers.deniedPaths
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
    : [];

  const cloudConnect = CLOUD_CONNECT_TRUTHY.has(answers.cloudConnect.toLowerCase());

  const sandboxProfile =
    answers.sandboxProfile === SANDBOX_NETWORK_PROFILE.FULL
      ? SANDBOX_NETWORK_PROFILE.FULL
      : SANDBOX_NETWORK_PROFILE.OFF;

  return {
    projectName: answers.projectName,
    lanes,
    sandboxProfile,
    deniedPaths,
    cloudConnect,
  };
}

// --- Config builders ---

/**
 * Convert a title string to a kebab-case ID.
 */
function toKebabCase(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Get default workspace configuration.
 * Used by --yes mode and as a baseline.
 */
export function getDefaultWorkspaceConfig(): WorkspaceSpec {
  return {
    id: DEFAULT_WORKSPACE_ID,
    name: DEFAULT_WORKSPACE_NAME,
    packs: createDefaultPackPins(),
    lanes: [
      {
        id: DEFAULT_WORKSPACE_ID,
        title: DEFAULT_LANE_TITLE,
        allowed_scopes: [],
      },
    ],
    policies: {},
    security: {
      allowed_scopes: [],
      network_default: DEFAULT_SANDBOX_NETWORK_PROFILE,
      deny_overlays: [...DEFAULT_DENY_OVERLAYS],
    },
    software_delivery: createEmptySoftwareDeliveryConfig(),
    memory_namespace: DEFAULT_NAMESPACE,
    event_namespace: DEFAULT_NAMESPACE,
  };
}

/**
 * Build a workspace configuration from user-provided answers.
 */
export function buildWorkspaceConfig(input: WorkspaceConfigInput): WorkspaceSpec {
  const lanes = input.lanes.map((title) => ({
    id: toKebabCase(title),
    title,
    allowed_scopes: [],
  }));

  return {
    id: toKebabCase(input.projectName),
    name: input.projectName,
    packs: createDefaultPackPins(),
    lanes,
    policies: {},
    security: {
      allowed_scopes: [],
      network_default: input.sandboxProfile,
      deny_overlays: input.deniedPaths,
    },
    software_delivery: createEmptySoftwareDeliveryConfig(),
    memory_namespace: toKebabCase(input.projectName),
    event_namespace: toKebabCase(input.projectName),
  };
}

// --- YAML generation with comments ---

/**
 * AC4: Generate workspace.yaml content with helpful YAML comments
 * explaining each section.
 */
export function generateWorkspaceYaml(config: WorkspaceSpec): string {
  // Build commented YAML manually for maximum readability
  const lines: string[] = [];

  lines.push('# LumenFlow Workspace Configuration');
  lines.push('# Generated by workspace:init');
  lines.push('');
  lines.push('# Workspace ID - unique identifier for this workspace');
  lines.push(`id: ${YAML.stringify(config.id).trim()}`);
  lines.push('');
  lines.push('# Human-readable project name');
  lines.push(`name: ${YAML.stringify(config.name).trim()}`);
  lines.push('');
  lines.push('# Domain packs - plugins that add tools, policies, and task types');
  lines.push('# Add packs with: pnpm pack:install --id <pack-id>');
  if (config.packs.length === 0) {
    lines.push('packs: []');
  } else {
    lines.push('packs:');
    for (const pack of config.packs) {
      lines.push(`  - id: ${YAML.stringify(pack.id).trim()}`);
      lines.push(`    version: ${YAML.stringify(pack.version).trim()}`);
      lines.push(`    integrity: ${YAML.stringify(pack.integrity).trim()}`);
      lines.push(`    source: ${YAML.stringify(pack.source).trim()}`);
    }
  }
  lines.push('');
  lines.push('# Work lanes - partitions for parallel work streams');
  lines.push('# Each lane has an ID, title, and optional scope restrictions');
  lines.push('lanes:');
  for (const lane of config.lanes) {
    lines.push(`  - id: ${YAML.stringify(lane.id).trim()}`);
    lines.push(`    title: ${YAML.stringify(lane.title).trim()}`);
    lines.push(`    allowed_scopes: ${YAML.stringify(lane.allowed_scopes).trim()}`);
  }
  lines.push('');
  lines.push('# Security configuration');
  lines.push('security:');
  lines.push('  # Workspace-level scope restrictions');
  lines.push(`  allowed_scopes: ${YAML.stringify(config.security.allowed_scopes).trim()}`);
  lines.push(
    `  # Network access default for sandbox (${SANDBOX_NETWORK_PROFILE.OFF} = no network, ${SANDBOX_NETWORK_PROFILE.FULL} = unrestricted)`,
  );
  lines.push(`  network_default: ${config.security.network_default}`);
  lines.push('  # Paths denied to agent sandbox via deny overlays');
  lines.push('  deny_overlays:');
  if (config.security.deny_overlays.length === 0) {
    lines.pop(); // Remove "deny_overlays:" and replace with inline
    lines.push('  deny_overlays: []');
  } else {
    for (const overlay of config.security.deny_overlays) {
      lines.push(`    - ${YAML.stringify(overlay).trim()}`);
    }
  }
  lines.push('');
  lines.push('# Software delivery config extensions (required workspace v2 block)');
  lines.push(`software_delivery: ${YAML.stringify(config.software_delivery).trim()}`);
  lines.push('');
  lines.push('# Memory namespace for session tracking and context recovery');
  lines.push(`memory_namespace: ${YAML.stringify(config.memory_namespace).trim()}`);
  lines.push('');
  lines.push('# Event namespace for kernel event storage');
  lines.push(`event_namespace: ${YAML.stringify(config.event_namespace).trim()}`);
  lines.push('');

  return lines.join('\n');
}

// --- File writing ---

/**
 * AC5: Write workspace.yaml using init-scaffolding.ts createFile infrastructure.
 *
 * @param targetDir - Directory to write workspace.yaml into
 * @param config - WorkspaceSpec configuration
 * @param force - If true, overwrite existing file (default: false = skip)
 * @returns ScaffoldResult tracking created/skipped files
 */
export async function writeWorkspaceFile(
  targetDir: string,
  config: WorkspaceSpec,
  force = false,
): Promise<ScaffoldResult> {
  const result: ScaffoldResult = {
    created: [],
    skipped: [],
    merged: [],
    warnings: [],
  };

  const yamlContent = generateWorkspaceYaml(config);
  const filePath = path.join(targetDir, WORKSPACE_FILENAME);

  await createFile(filePath, yamlContent, force, result, targetDir);

  return result;
}

// --- Non-interactive mode ---

/**
 * AC2: Run workspace:init in non-interactive mode (--yes flag).
 * Generates workspace.yaml with all defaults, no prompts.
 */
export async function runNonInteractive(targetDir: string, force = false): Promise<ScaffoldResult> {
  const config = getDefaultWorkspaceConfig();
  return writeWorkspaceFile(targetDir, config, force);
}

// --- Interactive mode ---

/**
 * Ask a single question via readline and return the answer.
 */
function askQuestion(rl: readline.Interface, question: WorkspaceQuestion): Promise<string> {
  return new Promise((resolve) => {
    const prompt = question.defaultValue
      ? `${question.prompt} [${question.defaultValue}]: `
      : `${question.prompt}: `;

    rl.question(prompt, (answer: string) => {
      resolve(answer.trim() || question.defaultValue);
    });
  });
}

/**
 * AC1: Run workspace:init interactively, prompting 5 questions.
 */
export async function runInteractive(targetDir: string, force = false): Promise<ScaffoldResult> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log(`${LOG_PREFIX} Workspace configuration wizard`);
    console.log(`${LOG_PREFIX} Answer the following questions (press Enter for defaults):\n`);

    const answers: Record<string, string> = {};
    for (const question of WORKSPACE_QUESTIONS) {
      answers[question.name] = await askQuestion(rl, question);
    }

    const input = parseAnswers(answers);
    const config = buildWorkspaceConfig(input);
    const result = await writeWorkspaceFile(targetDir, config, force);

    console.log(`\n${LOG_PREFIX} Workspace configuration complete!`);
    if (result.created.length > 0) {
      console.log(`${LOG_PREFIX} Created: ${result.created.join(', ')}`);
    }
    if (result.skipped.length > 0) {
      console.log(`${LOG_PREFIX} Skipped (already exists): ${result.skipped.join(', ')}`);
    }

    return result;
  } finally {
    rl.close();
  }
}

// --- CLI entry point ---

/**
 * CLI main entry point for workspace:init
 */
export async function main(): Promise<void> {
  const invokedEntryPoint = path.basename(
    process.argv[1] ?? LEGACY_WORKSPACE_INIT_ENTRYPOINT,
    '.js',
  );
  console.warn(buildLegacyWorkspaceInitGuidance(invokedEntryPoint));
}

// Run if executed directly
if (import.meta.main) {
  void runCLI(main);
}
