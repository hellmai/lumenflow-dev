#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @file pack-publish.ts
 * Publish a LumenFlow domain pack to a registry (WU-1838)
 *
 * Runs pack:validate, creates a tarball, and uploads to the registry
 * with authentication. Requires a GitHub OAuth token or registry token.
 *
 * Usage:
 *   pnpm pack:publish --id my-pack
 *   pnpm pack:publish --pack-root ./path/to/pack --registry-url https://custom.registry.dev
 *   pnpm pack:publish --id my-pack --token ghp_xxx
 */

import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import YAML from 'yaml';
import {
  DomainPackManifestSchema,
  PACK_MANIFEST_FILE_NAME,
  UTF8_ENCODING,
} from '@lumenflow/kernel';
import { createWUParser, WU_OPTIONS, createError, ErrorCodes } from '@lumenflow/core';
import { validatePack, type ValidationResult } from './pack-validate.js';
import { computePackHash } from './pack-hash.js';
import { runCLI } from './cli-entry-point.js';

export const LOG_PREFIX = '[pack:publish]';

const execFileAsync = promisify(execFile);

// --- Constants ---

const DEFAULT_PACKS_ROOT = 'packages/@lumenflow/packs';
const DEFAULT_REGISTRY_URL = 'https://registry.lumenflow.dev';
const TOKEN_ENV_VAR = 'LUMENFLOW_REGISTRY_TOKEN';
const GITHUB_TOKEN_ENV_VAR = 'GITHUB_TOKEN';

// --- Result types ---

export interface PublishPackResult {
  success: boolean;
  error?: string;
  packId?: string;
  version?: string;
  integrity?: string;
  tarballPath?: string;
  validation?: ValidationResult;
}

// --- Options ---

export interface PublishPackOptions {
  packRoot: string;
  registryUrl: string;
  token: string;
  /** Injectable upload function for testability (hexagonal port). */
  uploadFn: UploadFn;
}

export type UploadFn = (options: {
  registryUrl: string;
  packId: string;
  version: string;
  tarballPath: string;
  token: string;
  integrity: string;
}) => Promise<void>;

// --- Tarball creation ---

export interface CreateTarballOptions {
  packRoot: string;
  outputDir: string;
  packId: string;
  version: string;
}

/**
 * Create a gzipped tarball of the pack directory contents.
 *
 * Uses system `tar` command for simplicity and zero dependencies.
 * The tarball is named `<packId>-<version>.tar.gz`.
 *
 * @returns Absolute path to the created tarball file
 * @throws Error if tar command fails
 */
export async function createPackTarball(options: CreateTarballOptions): Promise<string> {
  const { packRoot, outputDir, packId, version } = options;
  const absolutePackRoot = resolve(packRoot);
  const tarballName = `${packId}-${version}.tar.gz`;
  const tarballPath = resolve(outputDir, tarballName);

  await execFileAsync('tar', ['-czf', tarballPath, '-C', absolutePackRoot, '.']);

  return tarballPath;
}

// --- Core publish function ---

/**
 * Publish a pack to a registry.
 *
 * Steps:
 * 1. Validate the pack using pack:validate
 * 2. Read manifest to get pack ID and version
 * 3. Compute integrity hash
 * 4. Create tarball of pack contents
 * 5. Upload tarball to registry with authentication
 *
 * Returns PublishPackResult with success=false if validation fails,
 * token is missing, or upload fails.
 */
export async function publishPack(options: PublishPackOptions): Promise<PublishPackResult> {
  const { packRoot, registryUrl, token, uploadFn } = options;
  const absolutePackRoot = resolve(packRoot);

  // 0. Validate token
  if (!token) {
    return {
      success: false,
      error: `Authentication token is required. Set ${TOKEN_ENV_VAR} or ${GITHUB_TOKEN_ENV_VAR} environment variable, or pass --token.`,
    };
  }

  // 1. Validate the pack
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
      error: `Pack validation failed. Run pack:validate --pack-root ${absolutePackRoot} for details.`,
      validation,
    };
  }

  // 2. Read manifest for pack ID and version
  let packId: string;
  let version: string;
  try {
    const manifestPath = join(absolutePackRoot, PACK_MANIFEST_FILE_NAME);
    const manifestRaw = await readFile(manifestPath, UTF8_ENCODING);
    const manifest = DomainPackManifestSchema.parse(YAML.parse(manifestRaw) as unknown);
    packId = manifest.id;
    version = manifest.version;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to read manifest: ${message}` };
  }

  // 3. Compute integrity hash
  let integrity: string;
  try {
    integrity = await computePackHash({ packRoot: absolutePackRoot });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Integrity hash computation failed: ${message}` };
  }

  // 4. Create tarball
  let tarballPath: string;
  try {
    const outputDir = join(tmpdir(), `lumenflow-publish-${packId}-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });
    tarballPath = await createPackTarball({
      packRoot: absolutePackRoot,
      outputDir,
      packId,
      version,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Tarball creation failed: ${message}` };
  }

  // 5. Upload to registry
  try {
    await uploadFn({
      registryUrl,
      packId,
      version,
      tarballPath,
      token,
      integrity,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: message,
      packId,
      version,
      integrity,
      tarballPath,
      validation,
    };
  }

  return {
    success: true,
    packId,
    version,
    integrity,
    tarballPath,
    validation,
  };
}

// --- Default upload implementation ---

/**
 * Default upload function using Node.js built-in fetch.
 *
 * Sends a multipart/form-data POST to the registry's publish endpoint:
 *   POST {registryUrl}/api/registry/packs/{packId}/versions/{version}
 *
 * Headers:
 *   Authorization: Bearer {token}
 *
 * Body (multipart/form-data):
 *   tarball: pack tarball file (.tar.gz)
 *   integrity: sha256 hash string
 *   version: semver version string
 */
export async function defaultUploadFn(options: {
  registryUrl: string;
  packId: string;
  version: string;
  tarballPath: string;
  token: string;
  integrity: string;
}): Promise<void> {
  const { registryUrl, packId, version, tarballPath, token, integrity } = options;
  const { readFile: readFileFs } = await import('node:fs/promises');
  const { basename } = await import('node:path');

  const tarballBuffer = await readFileFs(tarballPath);
  const url = `${registryUrl}/api/registry/packs/${packId}/versions/${version}`;

  const formData = new FormData();
  formData.append(
    'tarball',
    new Blob([tarballBuffer], { type: 'application/gzip' }),
    basename(tarballPath),
  );
  formData.append('integrity', integrity);
  formData.append('version', version);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => 'No response body');
    throw createError(
      ErrorCodes.REGISTRY_UPLOAD_FAILED,
      `Registry upload failed: ${String(response.status)} ${response.statusText} - ${body}`,
    );
  }
}

// --- CLI options ---

const PACK_PUBLISH_OPTIONS = {
  packId: {
    name: 'id',
    flags: '--id <packId>',
    description: 'Pack ID to publish (resolves under --packs-root)',
  },
  packsRoot: {
    name: 'packsRoot',
    flags: '--packs-root <dir>',
    description: `Root directory containing packs (default: "${DEFAULT_PACKS_ROOT}")`,
  },
  packRoot: {
    name: 'packRoot',
    flags: '--pack-root <dir>',
    description: 'Direct path to pack directory (overrides --id and --packs-root)',
  },
  registryUrl: {
    name: 'registryUrl',
    flags: '--registry-url <url>',
    description: `Registry URL (default: "${DEFAULT_REGISTRY_URL}")`,
  },
  token: {
    name: 'token',
    flags: '--token <token>',
    description: `Authentication token (default: $${TOKEN_ENV_VAR} or $${GITHUB_TOKEN_ENV_VAR})`,
  },
};

/**
 * CLI main entry point for pack:publish
 */
export async function main(): Promise<void> {
  const opts = createWUParser({
    name: 'pack-publish',
    description: 'Publish a LumenFlow domain pack to a registry',
    options: [
      PACK_PUBLISH_OPTIONS.packId,
      PACK_PUBLISH_OPTIONS.packsRoot,
      PACK_PUBLISH_OPTIONS.packRoot,
      PACK_PUBLISH_OPTIONS.registryUrl,
      PACK_PUBLISH_OPTIONS.token,
      WU_OPTIONS.force,
    ],
  });

  const packId = opts.id as string | undefined;
  const packsRoot = (opts.packsRoot as string | undefined) ?? DEFAULT_PACKS_ROOT;
  const directPackRoot = opts.packRoot as string | undefined;
  const registryUrl = (opts.registryUrl as string | undefined) ?? DEFAULT_REGISTRY_URL;
  const token =
    (opts.token as string | undefined) ??
    process.env[TOKEN_ENV_VAR] ??
    process.env[GITHUB_TOKEN_ENV_VAR] ??
    '';

  let resolvedPackRoot: string;

  if (directPackRoot) {
    resolvedPackRoot = resolve(directPackRoot);
  } else if (packId) {
    resolvedPackRoot = resolve(packsRoot, packId);
  } else {
    console.error(`${LOG_PREFIX} Error: Provide --id <packId> or --pack-root <dir>`);
    process.exit(1);
  }

  console.log(`${LOG_PREFIX} Publishing pack at: ${resolvedPackRoot}`);
  console.log(`${LOG_PREFIX} Registry: ${registryUrl}`);

  const result = await publishPack({
    packRoot: resolvedPackRoot,
    registryUrl,
    token,
    uploadFn: defaultUploadFn,
  });

  if (!result.success) {
    console.error(`${LOG_PREFIX} Publish failed: ${result.error}`);
    process.exit(1);
  }

  console.log(`${LOG_PREFIX} Published "${result.packId}" v${result.version} successfully.`);
  console.log(`${LOG_PREFIX} Integrity: ${result.integrity}`);
  console.log(`${LOG_PREFIX} Tarball: ${result.tarballPath}`);
}

// Run if executed directly
if (import.meta.main) {
  void runCLI(main);
}
