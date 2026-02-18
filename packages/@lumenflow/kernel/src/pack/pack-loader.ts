// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { builtinModules } from 'node:module';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import YAML from 'yaml';
import { KERNEL_EVENT_KINDS } from '../event-kinds.js';
import type { PackPin, WorkspaceSpec } from '../kernel.schemas.js';
import {
  LUMENFLOW_DIR_NAME,
  PACK_MANIFEST_FILE_NAME,
  SHA256_INTEGRITY_PREFIX,
  UTF8_ENCODING,
} from '../shared-constants.js';
import { computeDeterministicPackHash, listPackFiles } from './hash.js';
import { DomainPackManifestSchema, type DomainPackManifest } from './manifest.js';

/**
 * Port interface for git operations used by PackLoader.
 *
 * Consumers must provide an implementation (e.g. wrapping simple-git)
 * so that PackLoader remains testable without real git operations.
 */
export interface GitClient {
  /** Clone a repository to the target directory. */
  clone(url: string, targetDir: string): Promise<void>;
  /** Pull latest changes in an existing repository. */
  pull(repoDir: string): Promise<void>;
  /** Checkout a specific tag or ref. */
  checkout(repoDir: string, ref: string): Promise<void>;
  /** Check whether a directory is an existing git repository. */
  isRepo(dir: string): Promise<boolean>;
}

const PACK_CACHE_DIR_NAME = 'pack-cache' as const;
const VERSION_TAG_PREFIX = 'v' as const;

export interface WorkspaceWarningEvent {
  schema_version: 1;
  kind: typeof KERNEL_EVENT_KINDS.WORKSPACE_WARNING;
  timestamp: string;
  message: string;
}

export interface PackLoaderOptions {
  packsRoot: string;
  manifestFileName?: string;
  hashExclusions?: string[];
  runtimeEnvironment?: string;
  allowDevIntegrityInProduction?: boolean;
  /** Directory for caching git-sourced packs. Defaults to ~/.lumenflow/pack-cache/ */
  packCacheDir?: string;
  /** Git client for resolving packs with source: git. Required when loading git packs. */
  gitClient?: GitClient;
}

export interface PackLoadInput {
  workspaceSpec: WorkspaceSpec;
  packId: string;
  onWorkspaceWarning?: (event: WorkspaceWarningEvent) => void;
}

export interface LoadedDomainPack {
  pin: PackPin;
  manifest: DomainPackManifest;
  packRoot: string;
  integrity: string;
}

const NODE_BUILTINS = new Set(builtinModules.map((moduleName) => moduleName.replace(/^node:/, '')));
const ALLOWED_BARE_IMPORT_SPECIFIERS = new Set(['simple-git']);
const IMPORT_SPECIFIER_PATTERNS = [
  /\bimport\s+(?:[^'"]*?\sfrom\s*)?["']([^"']+)["']/,
  /\bexport\s+[^'"]*?\sfrom\s*["']([^"']+)["']/,
  /\bimport\(\s*["']([^"']+)["']\s*\)/,
] as const;

/**
 * Best-effort import boundary scanner.
 *
 * LIMITATION: regex matching cannot fully parse JavaScript/TypeScript and can miss
 * dynamic require/template-string patterns. This is an additional guard, not a
 * replacement for sandboxing/runtime policy enforcement.
 */

function isWithinRoot(root: string, candidatePath: string): boolean {
  const relative = path.relative(root, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isRuntimeSourceFile(relativePath: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  const extension = path.extname(normalizedPath);
  const isCodeFile = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'].includes(extension);
  if (!isCodeFile) {
    return false;
  }

  if (normalizedPath.includes('/__tests__/')) {
    return false;
  }

  return !/\.(test|spec)\.[cm]?[jt]sx?$/.test(normalizedPath);
}

function parseToolEntry(entry: string): { modulePath: string; exportName?: string } {
  const separator = entry.indexOf('#');
  const modulePath = separator < 0 ? entry : entry.slice(0, separator);
  const exportName = separator < 0 ? undefined : entry.slice(separator + 1);

  if (modulePath.trim().length === 0) {
    throw new Error(`Pack tool entry "${entry}" is missing a module path.`);
  }
  if (exportName !== undefined && exportName.trim().length === 0) {
    throw new Error(`Pack tool entry "${entry}" has an empty export fragment.`);
  }

  return {
    modulePath,
    exportName,
  };
}

export function resolvePackToolEntryPath(packRoot: string, entry: string): string {
  const absolutePackRoot = path.resolve(packRoot);
  const { modulePath, exportName } = parseToolEntry(entry);
  const absoluteModulePath = path.resolve(absolutePackRoot, modulePath);

  if (!isWithinRoot(absolutePackRoot, absoluteModulePath)) {
    throw new Error(`Pack tool entry "${entry}" resolves outside pack root.`);
  }

  return exportName ? `${absoluteModulePath}#${exportName}` : absoluteModulePath;
}

function extractImportSpecifiers(sourceCode: string): string[] {
  const specifiers = new Set<string>();
  for (const pattern of IMPORT_SPECIFIER_PATTERNS) {
    // Create a fresh global matcher per call to avoid shared RegExp state.
    const globalPattern = new RegExp(pattern.source, 'g');
    for (const match of sourceCode.matchAll(globalPattern)) {
      if (match[1]) {
        specifiers.add(match[1]);
      }
    }
  }
  return [...specifiers];
}

function isAllowedKernelImport(specifier: string): boolean {
  return specifier === '@lumenflow/kernel' || specifier.startsWith('@lumenflow/kernel/');
}

function validateImportSpecifier(options: {
  specifier: string;
  sourceFilePath: string;
  packRoot: string;
}): void {
  const { specifier, sourceFilePath, packRoot } = options;

  if (specifier.startsWith('node:')) {
    return;
  }

  if (NODE_BUILTINS.has(specifier)) {
    return;
  }

  if (isAllowedKernelImport(specifier)) {
    return;
  }

  if (specifier.startsWith('@lumenflow/')) {
    throw new Error(
      `Import "${specifier}" in ${sourceFilePath} is not allowed; only @lumenflow/kernel and Node built-ins are permitted.`,
    );
  }

  if (path.isAbsolute(specifier)) {
    throw new Error(`Import "${specifier}" in ${sourceFilePath} resolves outside pack root.`);
  }

  if (specifier.startsWith('.')) {
    const absoluteFilePath = path.resolve(packRoot, sourceFilePath);
    const resolvedImport = path.resolve(path.dirname(absoluteFilePath), specifier);
    if (!isWithinRoot(packRoot, resolvedImport)) {
      throw new Error(`Import "${specifier}" in ${sourceFilePath} resolves outside pack root.`);
    }
    return;
  }

  if (ALLOWED_BARE_IMPORT_SPECIFIERS.has(specifier)) {
    return;
  }

  throw new Error(
    `Bare package import "${specifier}" in ${sourceFilePath} is not allowed; only relative imports, @lumenflow/kernel, and Node built-ins are permitted.`,
  );
}

async function validatePackImportBoundaries(
  packRoot: string,
  hashExclusions?: string[],
): Promise<void> {
  const files = await listPackFiles(packRoot, hashExclusions);
  const candidateFiles = files.filter((relativePath) => isRuntimeSourceFile(relativePath));

  for (const relativePath of candidateFiles) {
    const sourceCode = await readFile(path.join(packRoot, relativePath), UTF8_ENCODING);
    const importSpecifiers = extractImportSpecifiers(sourceCode);
    for (const specifier of importSpecifiers) {
      validateImportSpecifier({
        specifier,
        sourceFilePath: relativePath,
        packRoot,
      });
    }
  }
}

function resolvePackPin(workspaceSpec: WorkspaceSpec, packId: string): PackPin {
  const pin = workspaceSpec.packs.find((candidate) => candidate.id === packId);
  if (!pin) {
    throw new Error(`Pack "${packId}" is not present in workspace PackPin entries.`);
  }
  return pin;
}

export class PackLoader {
  private readonly packsRoot: string;
  private readonly manifestFileName: string;
  private readonly hashExclusions?: string[];
  private readonly runtimeEnvironment: string;
  private readonly allowDevIntegrityInProduction: boolean;
  private readonly packCacheDir: string;
  private readonly gitClient?: GitClient;

  constructor(options: PackLoaderOptions) {
    this.packsRoot = path.resolve(options.packsRoot);
    this.manifestFileName = options.manifestFileName || PACK_MANIFEST_FILE_NAME;
    this.hashExclusions = options.hashExclusions;
    this.runtimeEnvironment = options.runtimeEnvironment ?? process.env.NODE_ENV ?? 'development';
    this.allowDevIntegrityInProduction = options.allowDevIntegrityInProduction ?? false;
    this.packCacheDir =
      options.packCacheDir ?? path.join(homedir(), LUMENFLOW_DIR_NAME, PACK_CACHE_DIR_NAME);
    this.gitClient = options.gitClient;
  }

  async load(input: PackLoadInput): Promise<LoadedDomainPack> {
    const pin = resolvePackPin(input.workspaceSpec, input.packId);
    const packRoot = await this.resolvePackRoot(pin);
    return this.loadFromDisk(pin, packRoot, input);
  }

  /**
   * Resolve the pack root directory based on the pin source.
   * For local packs, resolves relative to packsRoot.
   * For git packs, clones/pulls to the pack cache and checks out the version tag.
   */
  private async resolvePackRoot(pin: PackPin): Promise<string> {
    if (pin.source === 'git') {
      return this.resolveGitPackRoot(pin);
    }
    return path.resolve(this.packsRoot, pin.id);
  }

  /**
   * Resolve a git-sourced pack by cloning or pulling to the pack cache,
   * then checking out the version tag.
   */
  private async resolveGitPackRoot(pin: PackPin): Promise<string> {
    if (!pin.url) {
      throw new Error(
        `Pack "${pin.id}" has source: git but no url field. ` +
          'Add a url field to the PackPin to specify the git repository.',
      );
    }

    if (!this.gitClient) {
      throw new Error(
        `Pack "${pin.id}" has source: git but no gitClient was provided to PackLoader. ` +
          'Pass a gitClient in PackLoaderOptions to load git-sourced packs.',
      );
    }

    const packCachePath = path.join(this.packCacheDir, `${pin.id}@${pin.version}`);

    await mkdir(this.packCacheDir, { recursive: true });

    const alreadyCached = await this.gitClient.isRepo(packCachePath);

    if (alreadyCached) {
      await this.gitClient.pull(packCachePath);
    } else {
      await this.gitClient.clone(pin.url, packCachePath);
    }

    const versionTag = `${VERSION_TAG_PREFIX}${pin.version}`;
    await this.gitClient.checkout(packCachePath, versionTag);

    return packCachePath;
  }

  /**
   * Load pack from a resolved on-disk directory.
   * Handles manifest parsing, tool entry validation, import boundary checks,
   * integrity verification, and dev-mode warnings.
   */
  private async loadFromDisk(
    pin: PackPin,
    packRoot: string,
    input: PackLoadInput,
  ): Promise<LoadedDomainPack> {
    const manifestPath = path.join(packRoot, this.manifestFileName);
    const manifestRaw = await readFile(manifestPath, UTF8_ENCODING);
    const manifest = DomainPackManifestSchema.parse(YAML.parse(manifestRaw));

    if (manifest.id !== pin.id) {
      throw new Error(`Pack manifest id mismatch: expected ${pin.id}, got ${manifest.id}`);
    }
    if (manifest.version !== pin.version) {
      throw new Error(
        `Pack manifest version mismatch: expected ${pin.version}, got ${manifest.version}`,
      );
    }

    for (const tool of manifest.tools) {
      resolvePackToolEntryPath(packRoot, tool.entry);
    }

    await validatePackImportBoundaries(packRoot, this.hashExclusions);

    const integrity = await computeDeterministicPackHash({
      packRoot,
      exclusions: this.hashExclusions,
    });

    if (pin.integrity === 'dev') {
      if (this.runtimeEnvironment === 'production' && !this.allowDevIntegrityInProduction) {
        throw new Error(
          `Pack ${pin.id}@${pin.version} uses integrity: dev is not allowed in production.`,
        );
      }

      input.onWorkspaceWarning?.({
        schema_version: 1,
        kind: KERNEL_EVENT_KINDS.WORKSPACE_WARNING,
        timestamp: new Date().toISOString(),
        message: `Pack ${pin.id}@${pin.version} loaded with integrity: dev (verification skipped).`,
      });
      return {
        pin,
        manifest,
        packRoot,
        integrity,
      };
    }

    const expectedIntegrity = pin.integrity.startsWith(SHA256_INTEGRITY_PREFIX)
      ? pin.integrity.slice(SHA256_INTEGRITY_PREFIX.length)
      : pin.integrity;
    if (integrity !== expectedIntegrity) {
      throw new Error(
        `Pack integrity mismatch for ${pin.id}: expected ${expectedIntegrity}, got ${integrity}`,
      );
    }

    return {
      pin,
      manifest,
      packRoot,
      integrity,
    };
  }
}
