#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @file pack-install.ts
 * Install a LumenFlow domain pack into workspace.yaml (WU-1827, WU-1875)
 *
 * Adds a PackPin entry to workspace.yaml, validates the pack using
 * pack:validate, and pins the computed integrity hash.
 *
 * WU-1875: Added registry HTTP fetch path with SHA-256 integrity
 * verification and FetchFn port for testability.
 *
 * Usage:
 *   pnpm pack:install --id my-pack --source local --version 1.0.0
 *   pnpm pack:install --id my-pack --source git --url https://github.com/org/repo.git --version 1.0.0
 *   pnpm pack:install --id my-pack --source registry --version 1.0.0 --registry-url https://custom.registry.dev
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import YAML from 'yaml';
import { WORKSPACE_FILE_NAME } from '@lumenflow/kernel';
import type { PackPin } from '@lumenflow/kernel';
import { createWUParser, WU_OPTIONS, createError, ErrorCodes } from '@lumenflow/core';
import { validatePack, type ValidationResult } from './pack-validate.js';
import { computePackHash } from './pack-hash.js';
import { runCLI } from './cli-entry-point.js';

const execFileAsync = promisify(execFile);

export const LOG_PREFIX = '[pack:install]';

// --- Constants ---

const PACK_SOURCE_VALUES = ['local', 'git', 'registry'] as const;
type PackSource = (typeof PACK_SOURCE_VALUES)[number];

const UTF8 = 'utf-8' as const;
export const DEFAULT_REGISTRY_URL = 'https://registry.lumenflow.dev';
const REGISTRY_PACKS_API_PATH = '/api/registry/packs';
const SHA256_INTEGRITY_PATTERN = /^sha256:[a-f0-9]{64}$/;

// --- FetchFn port (WU-1875) ---

/**
 * Injectable fetch function port for testability.
 * Matches the global `fetch` signature for the subset we use.
 */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

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

// --- Registry install options (WU-1875) ---

export interface RegistryInstallOptions {
  workspaceRoot: string;
  packId: string;
  version: string;
  /** Registry base URL (e.g., https://registry.lumenflow.dev). */
  registryUrl: string;
  /** Expected SHA-256 integrity in "sha256:<hex>" format (optional: auto-resolve from registry). */
  integrity?: string;
  /** Injectable fetch function for testability. */
  fetchFn: FetchFn;
}

interface RegistryPackVersion {
  version: string;
  integrity: string;
}

interface ParsedPackDetail {
  latestVersion?: string;
  versions: RegistryPackVersion[];
}

interface ResolveRegistryIntegrityResult {
  success: boolean;
  error?: string;
  resolvedVersion?: string;
  resolvedIntegrity?: string;
}

// --- Workspace file I/O ---

interface WorkspaceData {
  packs: PackPin[];
  [key: string]: unknown;
}

async function readWorkspaceFile(workspaceRoot: string): Promise<WorkspaceData> {
  const workspacePath = join(workspaceRoot, WORKSPACE_FILE_NAME);

  if (!existsSync(workspacePath)) {
    throw createError(
      ErrorCodes.WORKSPACE_NOT_FOUND,
      `${WORKSPACE_FILE_NAME} not found at ${workspacePath}. ` +
        'Run "lumenflow init" to create a workspace first.',
    );
  }

  const content = await readFile(workspacePath, UTF8);
  const parsed = YAML.parse(content) as WorkspaceData;

  if (!parsed || typeof parsed !== 'object') {
    throw createError(
      ErrorCodes.WORKSPACE_MALFORMED,
      `${WORKSPACE_FILE_NAME} is empty or malformed.`,
    );
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

// --- Registry fetch + install (WU-1875) ---

/**
 * Build the registry tarball URL for a given pack and version.
 *
 * Format: {registryUrl}/api/registry/packs/{packId}/versions/{version}/tarball
 */
function buildRegistryTarballUrl(registryUrl: string, packId: string, version: string): string {
  const base = registryUrl.replace(/\/+$/, '');
  return `${base}${REGISTRY_PACKS_API_PATH}/${encodeURIComponent(packId)}/versions/${encodeURIComponent(version)}/tarball`;
}

function buildRegistryPackDetailUrl(registryUrl: string, packId: string): string {
  const base = registryUrl.replace(/\/+$/, '');
  return `${base}${REGISTRY_PACKS_API_PATH}/${encodeURIComponent(packId)}`;
}

function isLocalRegistryHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function validateRegistryUrl(registryUrl: string): {
  valid: boolean;
  normalizedUrl?: string;
  error?: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(registryUrl);
  } catch {
    return { valid: false, error: `Invalid --registry-url: "${registryUrl}"` };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      error: 'Registry URL must not include username/password credentials',
    };
  }

  const usesHttps = parsed.protocol === 'https:';
  const allowsInsecureLocalhost =
    parsed.protocol === 'http:' && isLocalRegistryHost(parsed.hostname);

  if (!usesHttps && !allowsInsecureLocalhost) {
    return {
      valid: false,
      error: 'Registry URL must use HTTPS unless host is localhost, 127.0.0.1, or ::1',
    };
  }

  return { valid: true, normalizedUrl: parsed.toString().replace(/\/+$/, '') };
}

function parsePackDetailResponse(data: unknown): ParsedPackDetail | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const maybeRecord = data as Record<string, unknown>;
  const packRaw =
    'pack' in maybeRecord && maybeRecord.pack && typeof maybeRecord.pack === 'object'
      ? (maybeRecord.pack as Record<string, unknown>)
      : maybeRecord;

  const latestVersion =
    typeof packRaw.latestVersion === 'string' ? packRaw.latestVersion : undefined;
  const versionsRaw = packRaw.versions;

  if (!Array.isArray(versionsRaw)) {
    return null;
  }

  const versions: RegistryPackVersion[] = [];
  for (const entry of versionsRaw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const maybeVersion = (entry as Record<string, unknown>).version;
    const maybeIntegrity = (entry as Record<string, unknown>).integrity;
    if (typeof maybeVersion === 'string' && typeof maybeIntegrity === 'string') {
      versions.push({ version: maybeVersion, integrity: maybeIntegrity });
    }
  }

  return { latestVersion, versions };
}

export async function resolveRegistryIntegrity(options: {
  packId: string;
  version: string;
  registryUrl: string;
  fetchFn: FetchFn;
}): Promise<ResolveRegistryIntegrityResult> {
  const registryValidation = validateRegistryUrl(options.registryUrl);
  if (!registryValidation.valid || !registryValidation.normalizedUrl) {
    return {
      success: false,
      error: registryValidation.error ?? `Invalid registry URL: ${options.registryUrl}`,
    };
  }

  const detailUrl = buildRegistryPackDetailUrl(registryValidation.normalizedUrl, options.packId);

  let detailResponse: Response;
  try {
    detailResponse = await options.fetchFn(detailUrl);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Failed to fetch registry metadata for "${options.packId}": ${message}`,
    };
  }

  if (!detailResponse.ok) {
    const body = await detailResponse.text().catch(() => 'No response body');
    return {
      success: false,
      error:
        `Registry metadata lookup returned ${String(detailResponse.status)} ` +
        `${detailResponse.statusText} for "${options.packId}": ${body}`,
    };
  }

  let detailJson: unknown;
  try {
    detailJson = await detailResponse.json();
  } catch {
    return {
      success: false,
      error: `Failed to parse registry metadata JSON for "${options.packId}"`,
    };
  }

  const parsedDetail = parsePackDetailResponse(detailJson);
  if (!parsedDetail || parsedDetail.versions.length === 0) {
    return {
      success: false,
      error: `Registry metadata for "${options.packId}" did not include any versions`,
    };
  }

  const targetVersion =
    options.version === 'latest'
      ? (parsedDetail.latestVersion ??
        parsedDetail.versions[parsedDetail.versions.length - 1]?.version)
      : options.version;

  if (!targetVersion) {
    return {
      success: false,
      error: `Registry metadata for "${options.packId}" is missing latestVersion`,
    };
  }

  const versionEntry = parsedDetail.versions.find((entry) => entry.version === targetVersion);
  if (!versionEntry) {
    return {
      success: false,
      error: `Version "${targetVersion}" not found for pack "${options.packId}"`,
    };
  }

  if (!SHA256_INTEGRITY_PATTERN.test(versionEntry.integrity)) {
    return {
      success: false,
      error: `Registry returned invalid integrity for "${options.packId}@${targetVersion}"`,
    };
  }

  return {
    success: true,
    resolvedVersion: versionEntry.version,
    resolvedIntegrity: versionEntry.integrity,
  };
}

/**
 * Verify SHA-256 integrity of a buffer against an expected hash.
 *
 * @param buffer - The data to hash
 * @param expectedIntegrity - Expected hash in "sha256:<hex>" format
 * @returns Object with `valid` boolean and `actual` hash string
 */
function verifySha256Integrity(
  buffer: ArrayBuffer,
  expectedIntegrity: string,
): { valid: boolean; actual: string; expected: string } {
  const data = Buffer.from(buffer);
  const actualHex = createHash('sha256').update(data).digest('hex');
  const actualIntegrity = `sha256:${actualHex}`;
  return {
    valid: actualIntegrity === expectedIntegrity,
    actual: actualIntegrity,
    expected: expectedIntegrity,
  };
}

/**
 * Extract a gzipped tarball to a target directory.
 *
 * @param tarballPath - Path to the .tar.gz file
 * @param targetDir - Directory to extract into
 */
async function extractTarball(tarballPath: string, targetDir: string): Promise<void> {
  mkdirSync(targetDir, { recursive: true });
  await execFileAsync('tar', ['-xzf', tarballPath, '-C', targetDir]);
}

/**
 * Install a pack from a registry into workspace.yaml (WU-1875).
 *
 * Steps:
 * 1. Fetch tarball from registry API endpoint
 * 2. Verify SHA-256 integrity of downloaded tarball
 * 3. Extract tarball to a temp directory
 * 4. Validate the extracted pack using pack:validate
 * 5. Compute integrity hash of extracted pack contents
 * 6. Build PackPin and upsert into workspace.yaml
 *
 * Returns InstallPackResult with success=false on any failure.
 */
export async function installPackFromRegistry(
  options: RegistryInstallOptions,
): Promise<InstallPackResult> {
  const { workspaceRoot, packId, version, registryUrl, integrity, fetchFn } = options;

  const registryValidation = validateRegistryUrl(registryUrl);
  if (!registryValidation.valid || !registryValidation.normalizedUrl) {
    return {
      success: false,
      error: registryValidation.error ?? `Invalid registry URL: ${registryUrl}`,
    };
  }
  const normalizedRegistryUrl = registryValidation.normalizedUrl;

  let resolvedVersion = version;
  let resolvedIntegrity = integrity?.trim() ?? '';

  if (resolvedIntegrity.length > 0 && !SHA256_INTEGRITY_PATTERN.test(resolvedIntegrity)) {
    return {
      success: false,
      error: `Invalid integrity format for "${packId}@${resolvedVersion}". Expected sha256:<hex>`,
    };
  }

  if (resolvedIntegrity.length === 0) {
    const integrityResult = await resolveRegistryIntegrity({
      packId,
      version: resolvedVersion,
      registryUrl: normalizedRegistryUrl,
      fetchFn,
    });

    if (
      !integrityResult.success ||
      !integrityResult.resolvedIntegrity ||
      !integrityResult.resolvedVersion
    ) {
      return {
        success: false,
        error:
          integrityResult.error ?? `Failed to resolve integrity for "${packId}@${resolvedVersion}"`,
      };
    }

    resolvedVersion = integrityResult.resolvedVersion;
    resolvedIntegrity = integrityResult.resolvedIntegrity;
  }

  // 1. Fetch tarball from registry
  const tarballUrl = buildRegistryTarballUrl(normalizedRegistryUrl, packId, resolvedVersion);
  let response: Response;
  try {
    response = await fetchFn(tarballUrl);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Registry fetch failed for "${packId}@${resolvedVersion}": ${message}`,
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => 'No response body');
    return {
      success: false,
      error:
        `Registry returned ${String(response.status)} ${response.statusText} ` +
        `for "${packId}@${resolvedVersion}": ${body}`,
    };
  }

  // 2. Verify SHA-256 integrity
  let tarballBuffer: ArrayBuffer;
  try {
    tarballBuffer = await response.arrayBuffer();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Failed to read tarball response body: ${message}`,
    };
  }

  const integrityCheck = verifySha256Integrity(tarballBuffer, resolvedIntegrity);
  if (!integrityCheck.valid) {
    return {
      success: false,
      error:
        `Integrity mismatch for "${packId}@${resolvedVersion}". ` +
        `Expected: ${integrityCheck.expected}, Got: ${integrityCheck.actual}`,
    };
  }

  // 3. Extract tarball to temp directory
  const tempBase = join(tmpdir(), `lumenflow-registry-install-${packId}-${Date.now()}`);
  const tarballPath = join(tempBase, `${packId}-${resolvedVersion}.tar.gz`);
  const extractDir = join(tempBase, 'pack');

  try {
    mkdirSync(tempBase, { recursive: true });
    await writeFile(tarballPath, Buffer.from(tarballBuffer));
    await extractTarball(tarballPath, extractDir);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Failed to extract tarball for "${packId}@${resolvedVersion}": ${message}`,
    };
  }

  // 4-6. Delegate to existing installPack with extracted directory as packRoot
  return installPack({
    workspaceRoot,
    packId,
    source: 'registry',
    version: resolvedVersion,
    registryUrl: normalizedRegistryUrl,
    packRoot: extractDir,
  });
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
  integrity: {
    name: 'integrity',
    flags: '--integrity <hash>',
    description: 'Expected SHA-256 integrity hash in "sha256:<hex>" format (optional)',
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
      PACK_INSTALL_OPTIONS.integrity,
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

  const workspaceRoot = resolve('.');

  console.log(`${LOG_PREFIX} Installing pack "${packId}" v${version} (source: ${source})...`);

  let result: InstallPackResult;

  if (source === 'registry') {
    // Registry source: fetch tarball from registry API (WU-1875)
    const resolvedRegistryUrl = registryUrl ?? DEFAULT_REGISTRY_URL;
    const integrityFlag = opts.integrity as string | undefined;
    const registryValidation = validateRegistryUrl(resolvedRegistryUrl);
    if (!registryValidation.valid || !registryValidation.normalizedUrl) {
      console.error(`${LOG_PREFIX} Error: ${registryValidation.error}`);
      process.exit(1);
    }

    result = await installPackFromRegistry({
      workspaceRoot,
      packId,
      version,
      registryUrl: registryValidation.normalizedUrl,
      integrity: integrityFlag,
      fetchFn: globalThis.fetch,
    });
  } else {
    // Local or git source: use existing path-based install
    const packRoot = resolvePackRootFromCli({ directPackRoot, packId, packsRoot });

    result = await installPack({
      workspaceRoot,
      packId,
      source,
      version,
      url,
      registryUrl,
      packRoot,
    });
  }

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
