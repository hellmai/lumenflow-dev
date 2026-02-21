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
import { createWUParser } from '@lumenflow/core';
import type { WorkspaceSpec } from '@lumenflow/kernel';
import { createFile, type ScaffoldResult } from './init-scaffolding.js';
import { runCLI } from './cli-entry-point.js';

export const LOG_PREFIX = '[workspace:init]';

const WORKSPACE_FILENAME = 'workspace.yaml';
const DEFAULT_WORKSPACE_ID = 'default';
const DEFAULT_WORKSPACE_NAME = 'My Project';
const DEFAULT_PROJECT_NAME = 'my-project';
const DEFAULT_LANE_TITLE = 'Default';
const DEFAULT_NAMESPACE = 'default';
const DEFAULT_DENY_OVERLAYS = ['~/.ssh', '~/.aws', '~/.gnupg', '.env'] as const;

function createEmptySoftwareDeliveryConfig(): WorkspaceSpec['software_delivery'] {
  return {};
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
    defaultValue: 'off',
  },
  {
    name: 'deniedPaths',
    prompt: 'Denied paths (comma-separated, e.g., ~/.ssh, ~/.aws, .env)',
    defaultValue: '~/.ssh, ~/.aws, ~/.gnupg, .env',
  },
  {
    name: 'cloudConnect',
    prompt: 'Enable cloud agent support? (yes | no)',
    defaultValue: 'no',
  },
];

// --- Answer parsing ---

export interface WorkspaceConfigInput {
  projectName: string;
  lanes: string[];
  sandboxProfile: 'off' | 'full';
  deniedPaths: string[];
  cloudConnect: boolean;
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

  const cloudConnect =
    answers.cloudConnect.toLowerCase() === 'yes' ||
    answers.cloudConnect.toLowerCase() === 'y' ||
    answers.cloudConnect.toLowerCase() === 'true';

  const sandboxProfile = answers.sandboxProfile === 'full' ? 'full' : 'off';

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
    packs: [],
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
      network_default: 'off',
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
    packs: [],
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
  lines.push(`packs: ${YAML.stringify(config.packs).trim()}`);
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
  lines.push('  # Network access default for sandbox (off = no network, full = unrestricted)');
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

const WORKSPACE_INIT_OPTIONS = {
  yes: {
    name: 'yes',
    flags: '--yes, -y',
    description: 'Accept all defaults non-interactively',
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
};

/**
 * CLI main entry point for workspace:init
 */
export async function main(): Promise<void> {
  const opts = createWUParser({
    name: 'workspace-init',
    description: 'Initialize a LumenFlow workspace configuration (workspace.yaml)',
    options: [
      WORKSPACE_INIT_OPTIONS.yes,
      WORKSPACE_INIT_OPTIONS.output,
      WORKSPACE_INIT_OPTIONS.force,
    ],
  });

  const targetDir = (opts.output as string | undefined) ?? process.cwd();
  const force = Boolean(opts.force);
  const useDefaults = Boolean(opts.yes);

  if (useDefaults) {
    const result = await runNonInteractive(targetDir, force);
    if (result.created.length > 0) {
      console.log(`${LOG_PREFIX} Created ${WORKSPACE_FILENAME} with default settings`);
    } else if (result.skipped.length > 0) {
      console.log(`${LOG_PREFIX} ${WORKSPACE_FILENAME} already exists. Use --force to overwrite.`);
    }
  } else {
    await runInteractive(targetDir, force);
  }
}

// Run if executed directly
if (import.meta.main) {
  void runCLI(main);
}
