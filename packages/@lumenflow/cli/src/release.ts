#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Release Command
 *
 * Orchestrates npm release for all @lumenflow/* packages.
 *
 * Features:
 * - Validates semver version format
 * - Bumps all @lumenflow/* package versions atomically
 * - Builds all packages via turbo
 * - Validates packed artifacts against package contracts
 * - Publishes to npm with proper auth (requires NPM_TOKEN)
 * - Creates git tag vX.Y.Z
 * - Cleanup-on-failure ensures main is never left dirty (WU-2062)
 *
 * Usage:
 *   pnpm release --release-version 1.3.0
 *   pnpm release --release-version 1.3.0 --dry-run     # Preview without making changes
 *   pnpm release --release-version 1.3.0 --skip-publish # Bump and tag only (no npm publish)
 *
 * WU-1085: The --release-version flag was renamed from --version to avoid conflict
 * with the standard CLI --version flag that shows the CLI version.
 *
 * WU-1074: Add release command for npm publishing
 */

import { Command } from 'commander';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { die, createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { ensureOnMain } from '@lumenflow/core/wu-helpers';
import { REMOTES, FILE_SYSTEM, PKG_MANAGER } from '@lumenflow/core/wu-constants';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { runCLI } from './cli-entry-point.js';

/** Log prefix for console output */
const LOG_PREFIX = '[release]';

/** Directory containing @lumenflow packages */
const LUMENFLOW_PACKAGES_DIR = 'packages/@lumenflow';

/** Path to the bare lumenflow wrapper package (WU-1691) */
const LUMENFLOW_WRAPPER_PACKAGE = 'packages/lumenflow';

/** Relative path to version-policy.yaml truth file (WU-2107) */
export const VERSION_POLICY_RELATIVE_PATH = 'apps/docs/src/data/version-policy.yaml';

/** Semver regex pattern (strict) */
// eslint-disable-next-line security/detect-unsafe-regex -- static semver pattern; no backtracking risk
const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/;

/** JSON indent size for package.json files */
const JSON_INDENT = 2;

/** Default npm registry */
const _NPM_REGISTRY = 'https://registry.npmjs.org';

/** Environment variable for npm authentication token */
const NPM_TOKEN_ENV = 'NPM_TOKEN';

/** Environment variable for alternative npm auth */
const NODE_AUTH_TOKEN_ENV = 'NODE_AUTH_TOKEN';

/** Pattern to detect npm auth token in .npmrc files */
const NPMRC_AUTH_TOKEN_PATTERN = /_authToken=/;

/** Changeset pre.json filename */
const CHANGESET_PRE_JSON = 'pre.json';

/** Changeset directory name */
const CHANGESET_DIR = '.changeset';

/** Environment variable to force bypass hooks */
const LUMENFLOW_FORCE_ENV = 'LUMENFLOW_FORCE';

/** Environment variable to provide reason for force bypass */
const LUMENFLOW_FORCE_REASON_ENV = 'LUMENFLOW_FORCE_REASON';

/** Release phase label for pre-release clean-tree validation */
const RELEASE_CLEAN_CHECK_PHASE_BEFORE_RELEASE = 'before release';

/** Command shown when release fails due to dirty working tree */
const GIT_STATUS_SHORT_COMMAND = 'git status --short';

/** Guidance shown when generated artifacts dirty the repository */
const CLEAN_TREE_RECOVERY_GUIDANCE =
  'Commit, stash, or clean generated files before retrying release.';

/** Package manifest filename */
const PACKAGE_JSON_FILENAME = 'package.json';

/** Source directory name used for build sanity checks */
const SOURCE_DIR_NAME = 'src';

/** Dist directory name used for release artifacts */
const DIST_DIR_NAME = 'dist';

/** Relative path prefix used in package manifests */
const RELATIVE_PATH_PREFIX = './';

/** Previous-pack sanity threshold (current must be >= 10% of previous) */
const PREVIOUS_PACK_MIN_RATIO = 0.1;

/** Path prefix emitted by some pack tools (for example package/dist/index.js) */
const PACK_TOOL_PACKAGE_PREFIX = 'package/';

/** Path prefixes used when normalizing manifest paths */
const NODE_PROTOCOL_PREFIX = 'node:';
const HTTP_PROTOCOL_PREFIX = 'http://';
const HTTPS_PROTOCOL_PREFIX = 'https://';
const PARENT_RELATIVE_PREFIX = '../';

/** Path separator constants for normalization */
const POSIX_PATH_SEPARATOR = '/';
const WINDOWS_PATH_SEPARATOR = '\\';

/** Labels for release logging phases */
const PRE_FLIGHT_LABEL = 'preflight';
const PACK_VALIDATE_LABEL = 'pack:validate';
const PACK_BASELINE_LABEL = 'pack:baseline';

/** Pack validation error messages */
const PACK_EMPTY_OUTPUT_ERROR = 'pack command produced empty output';
const PACK_INVALID_JSON_ERROR = 'pack command produced invalid JSON payload';
const PACK_MISSING_FILES_ARRAY_ERROR = 'pack command JSON missing required files[]';
const PACK_INVALID_FILES_ENTRY_ERROR = 'pack command JSON has invalid files[] entry';
const PACK_ZERO_FILES_ERROR = 'pack dry-run returned zero files';
const DIST_EMPTY_ERROR = 'dist directory has no files after build';
const MISSING_CONTRACT_PREFIX = 'Missing packaged files declared by package.json contract: ';
const RELEASE_VALIDATION_FAILURE_HEADER =
  'Release artifact validation failed. Refusing to publish broken tarballs.';
const RELEASE_VALIDATION_FAILURE_FOOTER =
  'Fix the package exports/build outputs, then re-run release.';
const DIST_BUILD_INCOMPLETE_PREFIX = 'dist has fewer files than src';
const DIST_BUILD_INCOMPLETE_SUFFIX = 'build artifacts look incomplete';
const PACK_COUNT_BELOW_BASELINE_PREFIX = 'packed file count';
const PACK_COUNT_BELOW_BASELINE_MID = 'is below 10% of previous published version';
const SKIP_BUILD_SYMLINK_ERROR_PREFIX = 'Refusing release with --skip-build:';
const SKIP_BUILD_SYMLINK_ERROR_GUIDANCE =
  'Run release without --skip-build so dist can be rebuilt as real files.';

/**
 * Environment variable for WU tool identification (WU-1296)
 * Pre-push hook checks this to allow approved tool operations
 */
const LUMENFLOW_WU_TOOL_ENV = 'LUMENFLOW_WU_TOOL';

/**
 * Release tool identifier for pre-push hook bypass (WU-1296)
 * Added to ALLOWED_WU_TOOLS in pre-push.mjs
 */
export const RELEASE_WU_TOOL = 'release';

/**
 * Operation name for micro-worktree isolation (WU-2219)
 * Used as the operation identifier when creating the micro-worktree.
 */
export const RELEASE_OPERATION_NAME = 'release';

/**
 * Build a micro-worktree ID from a release version (WU-2219)
 *
 * @param version - Semver version string (e.g., "1.3.0")
 * @returns ID string for micro-worktree (e.g., "v1.3.0")
 */
export function buildReleaseWorktreeId(version: string): string {
  return buildTagName(version);
}

/**
 * Execute a function with LUMENFLOW_WU_TOOL set to 'release' (WU-1296)
 *
 * This allows the release command to push to main via micro-worktree
 * without requiring LUMENFLOW_FORCE bypass. The pre-push hook checks
 * LUMENFLOW_WU_TOOL and allows approved tools like 'release'.
 *
 * @param fn - Async function to execute with release env set
 * @returns Result of the function
 */
export async function withReleaseEnv<T>(fn: () => Promise<T>): Promise<T> {
  const originalValue = process.env[LUMENFLOW_WU_TOOL_ENV];

  try {
    process.env[LUMENFLOW_WU_TOOL_ENV] = RELEASE_WU_TOOL;
    return await fn();
  } finally {
    // Restore original value (or delete if it wasn't set)
    if (originalValue === undefined) {
      delete process.env[LUMENFLOW_WU_TOOL_ENV];
    } else {
      process.env[LUMENFLOW_WU_TOOL_ENV] = originalValue;
    }
  }
}

/**
 * Release command options
 * WU-1085: Renamed version to releaseVersion to avoid CLI --version conflict
 */
export interface ReleaseOptions {
  releaseVersion: string;
  dryRun?: boolean;
  skipPublish?: boolean;
  skipBuild?: boolean;
}

/**
 * Minimal git contract for working-tree cleanliness checks.
 */
export interface GitWorkingTreeChecker {
  isClean(): Promise<boolean>;
}

/**
 * Assert the current git working tree is clean.
 *
 * @param git - Git adapter with cleanliness check
 * @param phase - Human-readable release phase label
 */
export async function assertWorkingTreeClean(
  git: GitWorkingTreeChecker,
  phase: string,
): Promise<void> {
  const isClean = await git.isClean();
  if (isClean) {
    return;
  }

  die(
    `Working directory has uncommitted changes ${phase}.\n\n` +
      `Run this command to inspect unexpected artifacts:\n` +
      `  ${GIT_STATUS_SHORT_COMMAND}\n` +
      `${CLEAN_TREE_RECOVERY_GUIDANCE}`,
  );
}

/**
 * Validate that a string is a valid semver version
 *
 * @param version - Version string to validate
 * @returns true if valid semver, false otherwise
 */
export function validateSemver(version: string): boolean {
  if (!version || typeof version !== 'string') {
    return false;
  }
  return SEMVER_REGEX.test(version);
}

/**
 * Find all public @lumenflow/* package.json paths, plus the bare lumenflow wrapper.
 *
 * WU-1691: Also includes packages/lumenflow so the release script bumps its version atomically.
 *
 * @param baseDir - Base directory to search from (defaults to cwd)
 * @returns Array of absolute paths to package.json files
 */
export function findPackageJsonPaths(baseDir: string = process.cwd()): string[] {
  const packagesDir = join(baseDir, LUMENFLOW_PACKAGES_DIR);
  const paths: string[] = [];

  if (existsSync(packagesDir)) {
    const entries = readdirSync(packagesDir);
    for (const entry of entries) {
      const entryPath = join(packagesDir, entry);
      const packageJsonPath = join(entryPath, PACKAGE_JSON_FILENAME);

      if (statSync(entryPath).isDirectory() && existsSync(packageJsonPath)) {
        // Read package.json to check if it's private
        const content = JSON.parse(
          readFileSync(packageJsonPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding }),
        );

        // Only include public packages (not marked private)
        if (!content.private) {
          paths.push(packageJsonPath);
        }
      }
    }
  }

  // WU-1691: Include the bare lumenflow wrapper package
  const wrapperPackageJson = join(baseDir, LUMENFLOW_WRAPPER_PACKAGE, PACKAGE_JSON_FILENAME);
  if (existsSync(wrapperPackageJson)) {
    const content = JSON.parse(
      readFileSync(wrapperPackageJson, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding }),
    );
    if (!content.private) {
      paths.push(wrapperPackageJson);
    }
  }

  return paths;
}

/**
 * Update version in specified package.json files
 *
 * @param paths - Array of package.json paths
 * @param version - New version string
 */
export async function updatePackageVersions(paths: string[], version: string): Promise<void> {
  for (const packagePath of paths) {
    const content = await readFile(packagePath, {
      encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
    });
    const pkg = JSON.parse(content);

    // Update version
    pkg.version = version;

    // Write back with preserved formatting (2-space indent)
    const updated = JSON.stringify(pkg, null, JSON_INDENT) + '\n';
    await writeFile(packagePath, updated, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });
  }
}

/**
 * Update version-policy.yaml with the release version, tag, and current date.
 *
 * WU-2107: Integrates version-policy.yaml into the release flow so the
 * published_stable section stays in sync with each npm release.
 *
 * @param version - Semver version string (e.g., "3.4.0")
 * @param baseDir - Base directory to resolve version-policy.yaml (defaults to cwd)
 * @returns Absolute path to the updated file, or null if file does not exist
 */
export async function updateVersionPolicy(
  version: string,
  baseDir: string = process.cwd(),
): Promise<string | null> {
  const filePath = join(baseDir, VERSION_POLICY_RELATIVE_PATH);

  if (!existsSync(filePath)) {
    return null;
  }

  const raw = await readFile(filePath, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });
  const doc = parseYaml(raw) as {
    version: number;
    published_stable: {
      version: string;
      release_tag: string;
      validated_on: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };

  doc.published_stable.version = version;
  doc.published_stable.release_tag = `v${version}`;
  doc.published_stable.validated_on = new Date().toISOString().slice(0, 10);

  const updated = stringifyYaml(doc, { lineWidth: 0 });
  await writeFile(filePath, updated, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });

  return filePath;
}

export interface PackageManifestContract {
  name?: string;
  exports?: unknown;
  bin?: string | Record<string, string>;
  main?: string;
  types?: string;
  files?: string[];
}

export interface PackedArtifactValidationInput {
  packageName: string;
  packageDir: string;
  manifest: PackageManifestContract;
  packedFiles: string[];
  srcFileCount: number;
  distFileCount: number;
  previousPackedFileCount?: number;
}

export interface PackedArtifactValidationResult {
  ok: boolean;
  packageName: string;
  contractPaths: string[];
  missingContractPaths: string[];
  errors: string[];
}

export interface DistPathMaterializationOptions {
  skipBuild?: boolean;
  dryRun?: boolean;
}

export interface DistPathMaterializationResult {
  checkedCount: number;
  materializedCount: number;
}

interface PackFileEntry {
  path: string;
}

interface PackDryRunMetadata {
  files: PackFileEntry[];
  entryCount?: number;
}

/**
 * Convert manifest file paths (for example "./dist/index.js") into package-relative paths.
 */
function normalizeManifestPath(filePath: string): string | null {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return null;
  }
  if (
    trimmed.startsWith(NODE_PROTOCOL_PREFIX) ||
    trimmed.startsWith(HTTP_PROTOCOL_PREFIX) ||
    trimmed.startsWith(HTTPS_PROTOCOL_PREFIX)
  ) {
    return null;
  }

  if (trimmed.startsWith(RELATIVE_PATH_PREFIX)) {
    return trimmed
      .slice(RELATIVE_PATH_PREFIX.length)
      .replaceAll(WINDOWS_PATH_SEPARATOR, POSIX_PATH_SEPARATOR);
  }

  if (trimmed.startsWith(PARENT_RELATIVE_PREFIX) || trimmed.includes(POSIX_PATH_SEPARATOR)) {
    return trimmed.replaceAll(WINDOWS_PATH_SEPARATOR, POSIX_PATH_SEPARATOR);
  }

  return null;
}

/**
 * Normalize packed tarball paths across npm/pnpm variants.
 *
 * Some pack tools emit "package/dist/index.js" while others emit "dist/index.js".
 * Contract comparisons use package-relative paths, so strip the optional prefix.
 */
function normalizePackedPath(filePath: string): string | null {
  const normalized = normalizeManifestPath(filePath);
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith(PACK_TOOL_PACKAGE_PREFIX)) {
    return normalized.slice(PACK_TOOL_PACKAGE_PREFIX.length);
  }

  return normalized;
}

function buildDistCountMismatchError(distFileCount: number, srcFileCount: number): string {
  return `${DIST_BUILD_INCOMPLETE_PREFIX} (${distFileCount} < ${srcFileCount}), ${DIST_BUILD_INCOMPLETE_SUFFIX}`;
}

function buildPackBaselineThresholdError(
  packedFileCount: number,
  previousPackedFileCount: number,
): string {
  return `${PACK_COUNT_BELOW_BASELINE_PREFIX} ${packedFileCount} ${PACK_COUNT_BELOW_BASELINE_MID} (${previousPackedFileCount})`;
}

function buildSkipBuildSymlinkError(relativeDistPath: string): string {
  return (
    `${SKIP_BUILD_SYMLINK_ERROR_PREFIX} ${relativeDistPath} is a symlink.\n` +
    `${SKIP_BUILD_SYMLINK_ERROR_GUIDANCE}`
  );
}

function buildWorkspacePackDryRunCommand(packageName: string): string {
  return `${PKG_MANAGER} --filter "${packageName}" pack --json --dry-run`;
}

function buildLatestPublishedPackDryRunCommand(packageName: string): string {
  return `npm pack "${packageName}@latest" --json --dry-run`;
}

/**
 * Collect all string leaf values from nested export conditions.
 */
function collectLeafStringValues(value: unknown, collector: string[]): void {
  if (typeof value === 'string') {
    collector.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectLeafStringValues(entry, collector);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectLeafStringValues(entry, collector);
    }
  }
}

/**
 * Derive package-file contract paths from package.json fields.
 *
 * Contract source of truth:
 * - exports map (all subpath leaf values)
 * - main/types
 * - bin targets
 */
export function extractPackageContractPaths(manifest: PackageManifestContract): string[] {
  const rawPaths: string[] = [];

  if (typeof manifest.main === 'string') {
    rawPaths.push(manifest.main);
  }

  if (typeof manifest.types === 'string') {
    rawPaths.push(manifest.types);
  }

  if (typeof manifest.bin === 'string') {
    rawPaths.push(manifest.bin);
  } else if (manifest.bin && typeof manifest.bin === 'object') {
    rawPaths.push(...Object.values(manifest.bin));
  }

  if (manifest.exports !== undefined) {
    collectLeafStringValues(manifest.exports, rawPaths);
  }

  const deduped = new Set<string>();
  for (const rawPath of rawPaths) {
    const normalized = normalizeManifestPath(rawPath);
    if (normalized) {
      deduped.add(normalized);
    }
  }

  return [...deduped];
}

/**
 * Determine if this package publishes dist artifacts.
 */
function packageExpectsDist(manifest: PackageManifestContract, contractPaths: string[]): boolean {
  const files = manifest.files ?? [];
  const includesDistInFiles = files.some((entry) => {
    const normalized = entry
      .trim()
      .replaceAll(WINDOWS_PATH_SEPARATOR, POSIX_PATH_SEPARATOR)
      .replace(/\/+$/, '');
    return normalized === DIST_DIR_NAME || normalized.startsWith(`${DIST_DIR_NAME}/`);
  });

  return (
    includesDistInFiles || contractPaths.some((entry) => entry.startsWith(`${DIST_DIR_NAME}/`))
  );
}

/**
 * Count files recursively for sanity checks.
 */
function countFilesRecursive(pathToCount: string): number {
  if (!existsSync(pathToCount)) {
    return 0;
  }

  const stat = lstatSync(pathToCount);
  if (!stat.isDirectory()) {
    return 0;
  }

  let fileCount = 0;
  const entries = readdirSync(pathToCount, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = join(pathToCount, entry.name);
    if (entry.isDirectory()) {
      fileCount += countFilesRecursive(absolutePath);
    } else if (entry.isFile()) {
      fileCount += 1;
    }
  }

  return fileCount;
}

/**
 * Validate packed artifacts against package contract paths and dynamic sanity checks.
 */
export function validatePackedArtifacts(
  input: PackedArtifactValidationInput,
): PackedArtifactValidationResult {
  const contractPaths = extractPackageContractPaths(input.manifest);
  const normalizedPackedFiles = input.packedFiles
    .map((entry) => normalizePackedPath(entry))
    .filter((entry): entry is string => entry !== null);
  const packedSet = new Set(normalizedPackedFiles);
  const missingContractPaths = contractPaths.filter((entry) => !packedSet.has(entry));
  const errors: string[] = [];

  if (input.packedFiles.length === 0) {
    errors.push(PACK_ZERO_FILES_ERROR);
  }

  if (missingContractPaths.length > 0) {
    errors.push(`${MISSING_CONTRACT_PREFIX}${missingContractPaths.join(', ')}`);
  }

  const expectsDist = packageExpectsDist(input.manifest, contractPaths);
  if (expectsDist) {
    if (input.distFileCount === 0) {
      errors.push(DIST_EMPTY_ERROR);
    } else if (input.srcFileCount > 0 && input.distFileCount < input.srcFileCount) {
      errors.push(buildDistCountMismatchError(input.distFileCount, input.srcFileCount));
    }
  }

  if (input.previousPackedFileCount !== undefined && input.previousPackedFileCount > 0) {
    const minimumExpected = Math.max(
      1,
      Math.ceil(input.previousPackedFileCount * PREVIOUS_PACK_MIN_RATIO),
    );
    if (input.packedFiles.length < minimumExpected) {
      errors.push(
        buildPackBaselineThresholdError(input.packedFiles.length, input.previousPackedFileCount),
      );
    }
  }

  return {
    ok: errors.length === 0,
    packageName: input.packageName,
    contractPaths,
    missingContractPaths,
    errors,
  };
}

/**
 * Replace symlinked dist directories with real directories.
 *
 * This avoids npm pack/publish inconsistencies from cross-worktree dist symlinks.
 */
export function ensureDistPathsMaterialized(
  packageDirs: string[],
  options: DistPathMaterializationOptions = {},
): DistPathMaterializationResult {
  const { skipBuild = false, dryRun = false } = options;
  let checkedCount = 0;
  let materializedCount = 0;

  for (const packageDir of packageDirs) {
    const distPath = join(packageDir, DIST_DIR_NAME);
    if (!existsSync(distPath)) {
      continue;
    }

    const distStat = lstatSync(distPath);
    if (!distStat.isSymbolicLink()) {
      continue;
    }

    checkedCount += 1;
    const relativeDistPath = distPath.replace(`${process.cwd()}/`, '');
    if (skipBuild) {
      die(buildSkipBuildSymlinkError(relativeDistPath));
    }

    if (dryRun) {
      console.log(
        `${LOG_PREFIX} [${PRE_FLIGHT_LABEL}] Would materialize symlinked dist at ${relativeDistPath}`,
      );
      continue;
    }

    rmSync(distPath, { recursive: true, force: true });
    mkdirSync(distPath, { recursive: true });
    materializedCount += 1;
    console.log(
      `${LOG_PREFIX} [${PRE_FLIGHT_LABEL}] Materialized symlinked dist at ${relativeDistPath}`,
    );
  }

  return { checkedCount, materializedCount };
}

/**
 * Build commit message for version bump
 *
 * @param version - New version string
 * @returns Commit message
 */
export function buildCommitMessage(version: string): string {
  return `chore(release): bump all packages to v${version}`;
}

/**
 * Build git tag name from version
 *
 * @param version - Version string
 * @returns Git tag name with 'v' prefix
 */
export function buildTagName(version: string): string {
  return `v${version}`;
}

/**
 * Execute a shell command and handle errors
 *
 * @param cmd - Command to execute
 * @param options - Options for execution
 */
function runCommand(
  cmd: string,
  options: { cwd?: string; dryRun?: boolean; label?: string } = {},
): void {
  const { cwd = process.cwd(), dryRun = false, label } = options;
  const prefix = label ? `[${label}] ` : '';

  if (dryRun) {
    console.log(`${LOG_PREFIX} ${prefix}Would run: ${cmd}`);
    return;
  }

  console.log(`${LOG_PREFIX} ${prefix}Running: ${cmd}`);
  try {
    execSync(cmd, {
      cwd,
      stdio: 'inherit',
      encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
    });
  } catch (error) {
    throw createError(ErrorCodes.COMMAND_EXECUTION_FAILED, `Command failed: ${cmd}`, {
      cause: error,
    });
  }
}

/**
 * Execute a shell command and capture stdout.
 */
function runCommandCapture(cmd: string, options: { cwd?: string; label?: string } = {}): string {
  const { cwd = process.cwd(), label } = options;
  const prefix = label ? `[${label}] ` : '';
  console.log(`${LOG_PREFIX} ${prefix}Running: ${cmd}`);
  try {
    return execSync(cmd, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
    });
  } catch (error) {
    throw createError(ErrorCodes.COMMAND_EXECUTION_FAILED, `Command failed: ${cmd}`, {
      cause: error,
    });
  }
}

/** Characters that can start a valid JSON value from pack commands */
const JSON_ARRAY_START = '[';
const JSON_OBJECT_START = '{';

/**
 * Find the index of the first real JSON-start sequence in a string.
 *
 * pnpm lifecycle scripts can prepend non-JSON output to stdout before the
 * actual JSON payload — including log-style brackets like `[sync:bundled-packs]`.
 * A bare `[` is ambiguous, so this function peeks at the next non-whitespace
 * character to distinguish JSON arrays (`[{`, `["`, `[]`) and objects (`{"`, `{}`)
 * from log prefixes.
 *
 * WU-2062: Replaces naive indexOf('[') which matched log brackets.
 *
 * @returns Index of the first valid JSON start, or 0 if not found (let JSON.parse report the error)
 */
export function findJsonStartIndex(raw: string): number {
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== JSON_ARRAY_START && ch !== JSON_OBJECT_START) {
      continue;
    }

    // Peek past optional whitespace to verify this starts a JSON value,
    // not a log-style bracket like [sync:bundled-packs].
    let j = i + 1;
    while (
      j < raw.length &&
      (raw[j] === ' ' || raw[j] === '\t' || raw[j] === '\n' || raw[j] === '\r')
    ) {
      j++;
    }

    if (j >= raw.length) {
      return i;
    }

    const next = raw[j];
    // Valid JSON array starts: [{ , [" , [] (empty)
    if (ch === JSON_ARRAY_START && (next === JSON_OBJECT_START || next === '"' || next === ']')) {
      return i;
    }
    // Valid JSON object starts: {" , {} (empty)
    if (ch === JSON_OBJECT_START && (next === '"' || next === '}')) {
      return i;
    }
  }

  // Not found — return 0 so JSON.parse reports the actual error
  return 0;
}

/**
 * Parse JSON output from npm/pnpm pack dry runs.
 *
 * pnpm lifecycle scripts (prepack/postpack) can emit non-JSON text to stdout
 * before the actual JSON payload. This function strips such prefix noise by
 * locating the first `[` or `{` character — the start of valid JSON.
 */
export function parsePackDryRunMetadata(rawOutput: string): PackDryRunMetadata {
  const trimmed = rawOutput.trim();
  if (!trimmed) {
    throw createError(ErrorCodes.PARSE_ERROR, PACK_EMPTY_OUTPUT_ERROR);
  }

  // pnpm lifecycle scripts (prepack/postpack) can emit text to stdout before
  // the JSON payload. Strip everything before the first JSON-start character.
  const jsonStartIndex = findJsonStartIndex(trimmed);
  const jsonPayload = jsonStartIndex > 0 ? trimmed.slice(jsonStartIndex) : trimmed;

  const parsed = JSON.parse(jsonPayload) as unknown;
  const normalized = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!normalized || typeof normalized !== 'object') {
    throw createError(ErrorCodes.PARSE_ERROR, PACK_INVALID_JSON_ERROR);
  }

  const files = (normalized as { files?: unknown }).files;
  if (!Array.isArray(files)) {
    throw createError(ErrorCodes.PARSE_ERROR, PACK_MISSING_FILES_ARRAY_ERROR);
  }

  for (const file of files) {
    if (
      !file ||
      typeof file !== 'object' ||
      typeof (file as { path?: unknown }).path !== 'string'
    ) {
      throw createError(ErrorCodes.PARSE_ERROR, PACK_INVALID_FILES_ENTRY_ERROR);
    }
  }

  const entryCount = (normalized as { entryCount?: unknown }).entryCount;
  return {
    files: files as PackFileEntry[],
    entryCount: typeof entryCount === 'number' ? entryCount : undefined,
  };
}

/**
 * Read package manifest for release validation.
 */
function readPackageManifest(packageJsonPath: string): PackageManifestContract {
  return JSON.parse(
    readFileSync(packageJsonPath, {
      encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
    }),
  ) as PackageManifestContract;
}

/**
 * Resolve packed file list for a workspace package via pnpm pack --dry-run.
 */
function getWorkspacePackedFiles(packageName: string): string[] {
  const output = runCommandCapture(buildWorkspacePackDryRunCommand(packageName), {
    label: PACK_VALIDATE_LABEL,
  });
  const metadata = parsePackDryRunMetadata(output);
  return metadata.files
    .map((entry) => normalizePackedPath(entry.path))
    .filter((entry): entry is string => entry !== null);
}

/**
 * Resolve packed file count for the currently published npm version.
 */
function getPreviousPublishedPackFileCount(packageName: string): number | undefined {
  try {
    const output = runCommandCapture(buildLatestPublishedPackDryRunCommand(packageName), {
      label: PACK_BASELINE_LABEL,
    });
    const metadata = parsePackDryRunMetadata(output);
    const entryCount = metadata.entryCount;
    if (typeof entryCount === 'number') {
      return entryCount;
    }
    return metadata.files.length;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `${LOG_PREFIX} [${PACK_BASELINE_LABEL}] Skipping previous-version count for ${packageName}: ${message}`,
    );
    return undefined;
  }
}

/**
 * Validate release package artifacts before tag/publish.
 */
function validateReleaseArtifactsForPublish(packageJsonPaths: string[], dryRun: boolean): void {
  if (dryRun) {
    console.log(
      `${LOG_PREFIX} [${PACK_VALIDATE_LABEL}] Would validate packed artifacts against package contracts`,
    );
    return;
  }

  const failures: PackedArtifactValidationResult[] = [];
  for (const packageJsonPath of packageJsonPaths) {
    const packageDir = dirname(packageJsonPath);
    const manifest = readPackageManifest(packageJsonPath);
    const packageName = manifest.name ?? packageDir;
    const packedFiles = getWorkspacePackedFiles(packageName);
    const previousPackedFileCount = getPreviousPublishedPackFileCount(packageName);
    const srcFileCount = countFilesRecursive(join(packageDir, SOURCE_DIR_NAME));
    const distFileCount = countFilesRecursive(join(packageDir, DIST_DIR_NAME));

    const result = validatePackedArtifacts({
      packageName,
      packageDir,
      manifest,
      packedFiles,
      srcFileCount,
      distFileCount,
      previousPackedFileCount,
    });

    if (!result.ok) {
      failures.push(result);
    }
  }

  if (failures.length > 0) {
    const details = failures
      .map(
        (failure) =>
          `- ${failure.packageName}\n` + failure.errors.map((error) => `  - ${error}`).join('\n'),
      )
      .join('\n');

    die(
      `${RELEASE_VALIDATION_FAILURE_HEADER}\n\n` +
        `${details}\n\n` +
        `${RELEASE_VALIDATION_FAILURE_FOOTER}`,
    );
  }

  console.log(
    `${LOG_PREFIX} ✅ Packed artifact validation passed for ${packageJsonPaths.length} packages`,
  );
}

/**
 * Check if npm authentication is available
 *
 * Checks for auth in this order:
 * 1. NPM_TOKEN environment variable
 * 2. NODE_AUTH_TOKEN environment variable
 * 3. Auth token in specified .npmrc file (or ~/.npmrc by default)
 *
 * @param npmrcPath - Optional path to .npmrc file (defaults to ~/.npmrc)
 * @returns true if UnsafeAny auth method is found
 */
export function hasNpmAuth(npmrcPath?: string): boolean {
  // Check environment variables first
  if (process.env[NPM_TOKEN_ENV] || process.env[NODE_AUTH_TOKEN_ENV]) {
    return true;
  }

  // Check .npmrc file
  const npmrcFile = npmrcPath ?? join(homedir(), '.npmrc');
  if (existsSync(npmrcFile)) {
    try {
      const content = readFileSync(npmrcFile, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
      // Look for authToken lines (e.g., //registry.npmjs.org/:_authToken=...)
      return NPMRC_AUTH_TOKEN_PATTERN.test(content);
    } catch {
      // If we can't read the file, assume no auth
      return false;
    }
  }

  return false;
}

/**
 * Check if the project is in changeset pre-release mode
 *
 * Changeset pre mode is indicated by the presence of .changeset/pre.json
 *
 * @param baseDir - Base directory to check (defaults to cwd)
 * @returns true if in pre-release mode
 */
export function isInChangesetPreMode(baseDir: string = process.cwd()): boolean {
  const preJsonPath = join(baseDir, CHANGESET_DIR, CHANGESET_PRE_JSON);
  return existsSync(preJsonPath);
}

/**
 * Exit changeset pre-release mode by removing .changeset/pre.json
 *
 * This is safe to call even if not in pre mode (no-op if file doesn't exist)
 *
 * @param baseDir - Base directory to operate in (defaults to cwd)
 */
export function exitChangesetPreMode(baseDir: string = process.cwd()): void {
  const preJsonPath = join(baseDir, CHANGESET_DIR, CHANGESET_PRE_JSON);
  if (existsSync(preJsonPath)) {
    unlinkSync(preJsonPath);
  }
}

/**
 * Push a git tag to origin, bypassing pre-push hooks via LUMENFLOW_FORCE
 *
 * This is necessary because the release script runs in a micro-worktree context
 * and pre-push hooks may block tag pushes. The force is logged and requires
 * a reason for audit purposes.
 *
 * @param git - SimpleGit instance
 * @param tagName - Name of the tag to push
 * @param reason - Reason for bypassing hooks (for audit log)
 */
export async function pushTagWithForce(
  git: ReturnType<typeof getGitForCwd>,
  tagName: string,
  reason: string = 'release: tag push from micro-worktree',
): Promise<void> {
  // Set environment variables to bypass hooks
  const originalForce = process.env[LUMENFLOW_FORCE_ENV];
  const originalReason = process.env[LUMENFLOW_FORCE_REASON_ENV];

  try {
    process.env[LUMENFLOW_FORCE_ENV] = '1';
    process.env[LUMENFLOW_FORCE_REASON_ENV] = reason;

    await git.push(REMOTES.ORIGIN, tagName);
  } finally {
    // Restore original environment
    if (originalForce === undefined) {
      delete process.env[LUMENFLOW_FORCE_ENV];
    } else {
      process.env[LUMENFLOW_FORCE_ENV] = originalForce;
    }
    if (originalReason === undefined) {
      delete process.env[LUMENFLOW_FORCE_REASON_ENV];
    } else {
      process.env[LUMENFLOW_FORCE_REASON_ENV] = originalReason;
    }
  }
}

/**
 * Clean up release artifacts after a failed release attempt.
 *
 * WU-2062: Ensures main is never left dirty by a failed release. Handles:
 * 1. Materialized dist directories (symlinks replaced with real dirs by preflight)
 * 2. Generated packs/ directories (from prepack lifecycle scripts)
 * 3. Version-bumped package.json files (from Phase 2)
 *
 * After cleanup, all tracked files are restored to HEAD state and untracked
 * generated files are removed.
 */
/**
 * WU-2086: Remove materialized dist directories so git can restore tracked symlinks.
 *
 * ensureDistPathsMaterialized replaces symlinks with real dirs for build/publish.
 * This function reverses that: deletes real dist dirs while preserving any that
 * are already symlinks.
 */
export function removeMaterializedDistDirs(packageDirs: string[]): void {
  for (const packageDir of packageDirs) {
    const distPath = join(packageDir, DIST_DIR_NAME);
    if (existsSync(distPath) && !lstatSync(distPath).isSymbolicLink()) {
      rmSync(distPath, { recursive: true, force: true });
    }
  }
}

/**
 * Execute the release flow inside a micro-worktree (WU-2219).
 *
 * All file writes (version bumps, build artifacts, formatting) happen inside
 * a temporary micro-worktree. The main checkout is never modified. On failure,
 * the micro-worktree is cleaned up automatically by withMicroWorktree, leaving
 * main completely untouched.
 *
 * Flow:
 * 1. Pre-flight checks on main (read-only: validate version, check auth)
 * 2. withMicroWorktree: version bump, build, validate, publish, commit
 * 3. Tag creation and push (after micro-worktree merges to main)
 *
 * @param opts - Release options (version, dryRun, skipPublish, skipBuild)
 */
export async function executeReleaseInMicroWorktree(opts: ReleaseOptions): Promise<void> {
  const { releaseVersion: version, dryRun, skipPublish, skipBuild } = opts;
  const mainCwd = process.cwd();

  console.log(`${LOG_PREFIX} Using micro-worktree isolation (WU-2219, restoring WU-1077)`);

  // ── Pre-flight (read-only on main) ──────────────────────────────────
  // Find packages before entering micro-worktree so we know what to modify.
  const mainPackagePaths = findPackageJsonPaths(mainCwd);
  if (mainPackagePaths.length === 0) {
    die(`No @lumenflow/* packages found in ${LUMENFLOW_PACKAGES_DIR}`);
  }

  console.log(`${LOG_PREFIX} Found ${mainPackagePaths.length} packages to update:`);
  for (const p of mainPackagePaths) {
    console.log(`  - ${p.replace(mainCwd + '/', '')}`);
  }

  // Check npm authentication for publish (read-only env check)
  if (!skipPublish && !dryRun && !hasNpmAuth()) {
    die(
      `npm authentication not found.\n\n` +
        `Set one of these environment variables:\n` +
        `  export NPM_TOKEN=<your-npm-token>\n` +
        `  export NODE_AUTH_TOKEN=<your-npm-token>\n\n` +
        `Get a token at: https://www.npmjs.com/settings/tokens\n` +
        `Or use --skip-publish to only bump versions and create tag.`,
    );
  }

  if (dryRun) {
    // Dry-run: show what would happen, no micro-worktree needed
    console.log(`${LOG_PREFIX} Would update ${mainPackagePaths.length} package versions`);
    console.log(`${LOG_PREFIX} Would update ${VERSION_POLICY_RELATIVE_PATH}`);
    if (!skipBuild) {
      console.log(`${LOG_PREFIX} Would build packages`);
    }
    if (!skipPublish) {
      console.log(`${LOG_PREFIX} Would validate packed artifacts`);
      console.log(`${LOG_PREFIX} Would publish packages to npm`);
    }
    console.log(`${LOG_PREFIX} Would commit: ${buildCommitMessage(version)}`);
    console.log(`${LOG_PREFIX} Would create tag: ${buildTagName(version)}`);
    console.log(`${LOG_PREFIX} Would push to ${REMOTES.ORIGIN} via micro-worktree`);

    console.log(`\n${LOG_PREFIX} DRY RUN complete`);
    console.log(`  - Run without --dry-run to execute the release`);
    return;
  }

  // Exit changeset pre mode if active (read-only check, write to micro-worktree)
  const changesetPreActive = isInChangesetPreMode(mainCwd);

  // ── Micro-worktree: all writes happen here ──────────────────────────
  await withReleaseEnv(async () => {
    await withMicroWorktree({
      operation: RELEASE_OPERATION_NAME,
      id: buildReleaseWorktreeId(version),
      logPrefix: LOG_PREFIX,
      execute: async ({ worktreePath }) => {
        // Resolve package paths relative to micro-worktree
        const worktreePackagePaths = findPackageJsonPaths(worktreePath);
        const worktreePackageDirs = worktreePackagePaths.map((path) => dirname(path));

        // Exit changeset pre mode in micro-worktree if it was active on main
        if (changesetPreActive) {
          console.log(`${LOG_PREFIX} Detected changeset pre-release mode, exiting...`);
          exitChangesetPreMode(worktreePath);
          console.log(`${LOG_PREFIX} ✅ Exited changeset pre mode`);
        }

        // Phase 1: Materialize dist symlinks and build
        const distPreparation = ensureDistPathsMaterialized(worktreePackageDirs, {
          skipBuild,
          dryRun: false,
        });
        if (distPreparation.materializedCount > 0) {
          console.log(
            `${LOG_PREFIX} [${PRE_FLIGHT_LABEL}] Materialized ${distPreparation.materializedCount} symlinked dist directories`,
          );
        }

        if (!skipBuild) {
          runCommand(`${PKG_MANAGER} build`, { label: 'build', cwd: worktreePath });
          console.log(`${LOG_PREFIX} ✅ Build complete`);
        } else {
          console.log(`${LOG_PREFIX} Skipping build (--skip-build)`);
        }

        // Phase 2: Version bump (inside micro-worktree)
        console.log(`${LOG_PREFIX} Bumping versions to ${version}...`);
        await updatePackageVersions(worktreePackagePaths, version);
        const versionPolicyPath = await updateVersionPolicy(version, worktreePath);
        if (versionPolicyPath) {
          console.log(`${LOG_PREFIX} ✅ Updated ${VERSION_POLICY_RELATIVE_PATH}`);
        }
        console.log(`${LOG_PREFIX} ✅ Versions updated to ${version}`);

        // Phase 3: Validate packed artifacts (after version bump, before publish)
        if (!skipPublish) {
          validateReleaseArtifactsForPublish(worktreePackagePaths, false);
        }

        // Phase 4: Publish to npm (from micro-worktree)
        if (!skipPublish) {
          console.log(`${LOG_PREFIX} Publishing packages to npm...`);
          runCommand(`${PKG_MANAGER} -r publish --access public --no-git-checks`, {
            label: 'publish',
            cwd: worktreePath,
          });
          console.log(`${LOG_PREFIX} ✅ Packages published to npm`);
        } else {
          console.log(`${LOG_PREFIX} Skipping npm publish (--skip-publish)`);
        }

        // Build list of modified files for commit
        const relativePaths = worktreePackagePaths.map((p) => p.replace(worktreePath + '/', ''));

        // Include version-policy.yaml if it exists
        if (existsSync(join(worktreePath, VERSION_POLICY_RELATIVE_PATH))) {
          relativePaths.push(VERSION_POLICY_RELATIVE_PATH);
        }

        // Include changeset pre.json removal if applicable
        if (changesetPreActive) {
          const changesetPrePath = join(CHANGESET_DIR, CHANGESET_PRE_JSON);
          relativePaths.push(changesetPrePath);
        }

        return {
          commitMessage: buildCommitMessage(version),
          files: relativePaths,
        };
      },
    });
  });

  // ── Post micro-worktree: tag and push tag ─────────────────────────
  // The micro-worktree has already merged the version bump commit to main
  // and pushed to origin. Now create and push the git tag.
  const tagName = buildTagName(version);
  const mainGit = getGitForCwd();

  console.log(`${LOG_PREFIX} Creating tag ${tagName}...`);
  await mainGit.raw(['tag', '-a', tagName, '-m', `Release ${tagName}`]);
  console.log(`${LOG_PREFIX} ✅ Tag created: ${tagName}`);

  console.log(`${LOG_PREFIX} Pushing tag ${tagName}...`);
  await pushTagWithForce(mainGit, tagName);
  console.log(`${LOG_PREFIX} ✅ Tag pushed to ${REMOTES.ORIGIN}`);

  // Summary
  console.log(`\n${LOG_PREFIX} Release complete!`);
  console.log(`${LOG_PREFIX} Version: ${version}`);
  console.log(`${LOG_PREFIX} Tag: ${tagName}`);
  if (!skipPublish) {
    console.log(`${LOG_PREFIX} npm: https://www.npmjs.com/org/lumenflow`);
  }

  console.log(`\n${LOG_PREFIX} Next steps:`);
  console.log(
    `  - Create GitHub release: gh release create ${tagName} --title "Release ${tagName}"`,
  );
  if (skipPublish) {
    console.log(`  - Publish to npm: ${PKG_MANAGER} -r publish --access public --no-git-checks`);
  }
  console.log(`  - Verify packages: npm view @lumenflow/cli version`);
}

/**
 * Main release function
 * WU-1085: Renamed --version to --release-version to avoid conflict with CLI --version flag
 * WU-2219: Refactored to use micro-worktree isolation for all writes
 */
export async function main(): Promise<void> {
  const program = new Command()
    .name('lumenflow-release')
    .description('Release @lumenflow/* packages to npm with version bump, tag, and publish')
    .version('1.0.0', '-V, --version', 'Output the CLI version')
    .requiredOption('-v, --release-version <version>', 'Semver version to release (e.g., 1.3.0)')
    .option('--dry-run', 'Preview changes without making them', false)
    .option('--skip-publish', 'Skip npm publish (only bump and tag)', false)
    .option('--skip-build', 'Skip build step (use existing dist)', false)
    .helpOption('-h, --help', 'Display help for command');

  program.parse();
  const opts = program.opts() as ReleaseOptions;
  const { releaseVersion: version, dryRun } = opts;

  console.log(`${LOG_PREFIX} Starting release process for v${version}`);
  if (dryRun) {
    console.log(`${LOG_PREFIX} DRY RUN MODE - no changes will be made`);
  }

  // Validate version format
  if (!validateSemver(version)) {
    die(
      `Invalid semver version: ${version}\n\n` +
        `Expected format: MAJOR.MINOR.PATCH (e.g., 1.3.0)\n` +
        `Optional pre-release suffix: 1.3.0-alpha, 1.3.0-beta.1`,
    );
  }

  // Ensure we're on main branch
  const git = getGitForCwd();
  await ensureOnMain(git);

  // Check for uncommitted changes on main before starting
  await assertWorkingTreeClean(git, RELEASE_CLEAN_CHECK_PHASE_BEFORE_RELEASE);

  // WU-2219: Delegate to micro-worktree based release flow
  await executeReleaseInMicroWorktree(opts);
}

// Guard main() for testability
if (import.meta.main) {
  void runCLI(main);
}
