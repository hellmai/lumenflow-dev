#!/usr/bin/env node
/**
 * @file pack-install.ts
 * Install a LumenFlow domain pack into workspace.yaml (WU-1827)
 *
 * Adds a PackPin entry to workspace.yaml, validates the pack using
 * pack:validate, and pins the computed integrity hash.
 *
 * Usage:
 *   pnpm pack:install --id my-pack --source local --version 1.0.0
 *   pnpm pack:install --id my-pack --source git --url https://github.com/org/repo.git --version 1.0.0
 *   pnpm pack:install --id my-pack --source registry --version 1.0.0 --registry-url https://custom.registry.dev
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import YAML from 'yaml';
import { WORKSPACE_FILE_NAME } from '@lumenflow/kernel';
import type { PackPin } from '@lumenflow/kernel';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core';
import { validatePack, type ValidationResult } from './pack-validate.js';
import { computePackHash } from './pack-hash.js';
import { runCLI } from './cli-entry-point.js';

export const LOG_PREFIX = '[pack:install]';

// --- Constants ---

const PACK_SOURCE_VALUES = ['local', 'git', 'registry'] as const;
type PackSource = (typeof PACK_SOURCE_VALUES)[number];

const UTF8 = 'utf-8' as const;

// --- Result types ---

export interface InstallPackResult {
  success: boolean;
  error?: string;
  integrity?: string;
  validation?: ValidationResult;
}

// --- Options ---

export interface InstallPackOptions {
  workspaceRoot: string;
  packId: string;
  source: PackSource;
  version: string;
  url?: string;
  registryUrl?: string;
  /** Direct path to the resolved pack directory on disk (for validation and hashing). */
  packRoot: string;
}

// --- Workspace file I/O ---

interface WorkspaceData {
  packs: PackPin[];
  [key: string]: unknown;
}

async function readWorkspaceFile(workspaceRoot: string): Promise<WorkspaceData> {
  const workspacePath = join(workspaceRoot, WORKSPACE_FILE_NAME);

  if (!existsSync(workspacePath)) {
    throw new Error(
      `${WORKSPACE_FILE_NAME} not found at ${workspacePath}. ` +
        'Run "lumenflow init" to create a workspace first.',
    );
  }

  const content = await readFile(workspacePath, UTF8);
  const parsed = YAML.parse(content) as WorkspaceData;

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${WORKSPACE_FILE_NAME} is empty or malformed.`);
  }

  // Ensure packs array exists
  if (!Array.isArray(parsed.packs)) {
    parsed.packs = [];
  }

  return parsed;
}

async function writeWorkspaceFile(workspaceRoot: string, data: WorkspaceData): Promise<void> {
  const workspacePath = join(workspaceRoot, WORKSPACE_FILE_NAME);
  const content = YAML.stringify(data, { lineWidth: 120 });
  await writeFile(workspacePath, content, UTF8);
}

// --- Build PackPin ---

function buildPackPin(options: {
  packId: string;
  version: string;
  source: PackSource;
  integrity: string;
  url?: string;
  registryUrl?: string;
}): PackPin {
  const pin: PackPin = {
    id: options.packId,
    version: options.version,
    integrity: options.integrity,
    source: options.source,
  };

  if (options.url) {
    pin.url = options.url;
  }

  if (options.registryUrl) {
    pin.registry_url = options.registryUrl;
  }

  return pin;
}

// --- Upsert PackPin into packs array ---

function upsertPackPin(packs: PackPin[], newPin: PackPin): PackPin[] {
  const existingIndex = packs.findIndex((p) => p.id === newPin.id);

  if (existingIndex >= 0) {
    // Replace existing entry
    const updated = [...packs];
    updated[existingIndex] = newPin;
    return updated;
  }

  // Append new entry
  return [...packs, newPin];
}

// --- Core install function ---

/**
 * Install a pack into workspace.yaml.
 *
 * Steps:
 * 1. Read workspace.yaml
 * 2. Validate the pack at packRoot using pack:validate
 * 3. Compute integrity hash
 * 4. Build PackPin and upsert into workspace.yaml packs array
 * 5. Write updated workspace.yaml
 *
 * Returns InstallPackResult with success=false if validation fails.
 */
export async function installPack(options: InstallPackOptions): Promise<InstallPackResult> {
  const { workspaceRoot, packId, source, version, url, registryUrl, packRoot } = options;
  const absolutePackRoot = resolve(packRoot);

  // 1. Read workspace.yaml
  let workspace: WorkspaceData;
  try {
    workspace = await readWorkspaceFile(workspaceRoot);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }

  // 2. Validate the pack
  let validation: ValidationResult;
  try {
    validation = await validatePack({ packRoot: absolutePackRoot });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Pack validation failed: ${message}` };
  }

  if (!validation.allPassed) {
    return {
      success: false,
      error: `Pack validation failed for "${packId}". Run pack:validate --pack-root ${absolutePackRoot} for details.`,
      validation,
    };
  }

  // 3. Compute integrity hash
  let integrity: string;
  try {
    integrity = await computePackHash({ packRoot: absolutePackRoot });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Integrity hash computation failed: ${message}` };
  }

  // 4. Build PackPin and upsert
  const pin = buildPackPin({ packId, version, source, integrity, url, registryUrl });
  workspace.packs = upsertPackPin(workspace.packs, pin);

  // 5. Write updated workspace.yaml
  try {
    await writeWorkspaceFile(workspaceRoot, workspace);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to write ${WORKSPACE_FILE_NAME}: ${message}` };
  }

  return {
    success: true,
    integrity,
    validation,
  };
}

// --- CLI options ---

const DEFAULT_PACKS_ROOT = 'packages/@lumenflow/packs';

const PACK_INSTALL_OPTIONS = {
  packId: {
    name: 'id',
    flags: '--id <packId>',
    description: 'Pack ID to install',
  },
  source: {
    name: 'source',
    flags: '--source <source>',
    description: 'Pack source: local, git, or registry',
  },
  version: {
    name: 'version',
    flags: '--version <version>',
    description: 'Pack version in semver format',
  },
  url: {
    name: 'url',
    flags: '--url <url>',
    description: 'Git repository URL (required for source: git)',
  },
  registryUrl: {
    name: 'registryUrl',
    flags: '--registry-url <url>',
    description: 'Registry base URL (for source: registry)',
  },
  packRoot: {
    name: 'packRoot',
    flags: '--pack-root <dir>',
    description: 'Direct path to resolved pack directory on disk (overrides default resolution)',
  },
  packsRoot: {
    name: 'packsRoot',
    flags: '--packs-root <dir>',
    description: `Root directory containing packs (default: "${DEFAULT_PACKS_ROOT}")`,
  },
};

/**
 * Resolve pack root from CLI options.
 * Priority: --pack-root > --packs-root/<id>
 */
function resolvePackRootFromCli(options: {
  directPackRoot?: string;
  packId: string;
  packsRoot: string;
}): string {
  if (options.directPackRoot) {
    return resolve(options.directPackRoot);
  }
  return resolve(options.packsRoot, options.packId);
}

/**
 * CLI main entry point for pack:install
 */
export async function main(): Promise<void> {
  const opts = createWUParser({
    name: 'pack-install',
    description: 'Install a LumenFlow domain pack into workspace.yaml',
    options: [
      PACK_INSTALL_OPTIONS.packId,
      PACK_INSTALL_OPTIONS.source,
      PACK_INSTALL_OPTIONS.version,
      PACK_INSTALL_OPTIONS.url,
      PACK_INSTALL_OPTIONS.registryUrl,
      PACK_INSTALL_OPTIONS.packRoot,
      PACK_INSTALL_OPTIONS.packsRoot,
      WU_OPTIONS.force,
    ],
    required: ['id', 'source', 'version'],
  });

  const packId = opts.id as string;
  const source = opts.source as PackSource;
  const version = opts.version as string;
  const url = opts.url as string | undefined;
  const registryUrl = opts.registryUrl as string | undefined;
  const directPackRoot = opts.packRoot as string | undefined;
  const packsRoot = (opts.packsRoot as string | undefined) ?? DEFAULT_PACKS_ROOT;

  // Validate source
  if (!PACK_SOURCE_VALUES.includes(source)) {
    console.error(
      `${LOG_PREFIX} Error: Invalid source "${source}". Must be one of: ${PACK_SOURCE_VALUES.join(', ')}`,
    );
    process.exit(1);
  }

  // Validate git source requires url
  if (source === 'git' && !url) {
    console.error(`${LOG_PREFIX} Error: --url is required when --source is "git"`);
    process.exit(1);
  }

  const packRoot = resolvePackRootFromCli({ directPackRoot, packId, packsRoot });
  const workspaceRoot = resolve('.');

  console.log(`${LOG_PREFIX} Installing pack "${packId}" v${version} (source: ${source})...`);

  const result = await installPack({
    workspaceRoot,
    packId,
    source,
    version,
    url,
    registryUrl,
    packRoot,
  });

  if (!result.success) {
    console.error(`${LOG_PREFIX} Installation failed: ${result.error}`);
    process.exit(1);
  }

  console.log(`${LOG_PREFIX} Pack "${packId}" v${version} installed successfully.`);
  console.log(`${LOG_PREFIX} Integrity: ${result.integrity}`);
  console.log(`${LOG_PREFIX} workspace.yaml updated.`);
}

// Run if executed directly
if (import.meta.main) {
  void runCLI(main);
}
