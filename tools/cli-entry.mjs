#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * WU-1356: Config file name
 */
const CONFIG_FILE = '.lumenflow.config.yaml';

const PATH_PARTS = {
  PACKAGES: 'packages',
  SCOPE: '@lumenflow',
  CLI: 'cli',
  DIST: 'dist',
  WORKTREES: 'worktrees',
};

const COMMANDS = {
  PNPM: 'pnpm',
  NPM: 'npm',
  YARN: 'yarn',
  BUN: 'bun',
  FILTER: '--filter',
  BUILD: 'build',
  NODE: 'node',
  RUN: 'run',
  WORKSPACE: '--workspace',
};

/**
 * WU-1356: Default build commands by package manager
 */
const DEFAULT_BUILD_COMMANDS = {
  pnpm: ['pnpm', '--filter', '@lumenflow/cli', 'build'],
  npm: ['npm', 'run', 'build', '--workspace', '@lumenflow/cli'],
  yarn: ['yarn', 'workspace', '@lumenflow/cli', 'build'],
  bun: ['bun', 'run', '--filter', '@lumenflow/cli', 'build'],
};

const EXIT_CODES = {
  OK: 0,
  ERROR: 1,
};

const DEFAULT_ENTRY = 'gates';

/**
 * WU-1356: Parse simple YAML for package_manager and build_command
 *
 * Minimal YAML parser for bootstrap - avoids requiring yaml package before build.
 * Only extracts top-level package_manager and build_command fields.
 *
 * @param {string} content - YAML content
 * @returns {{ packageManager?: string, buildCommand?: string }}
 */
export function parseSimpleConfig(content) {
  const result = {};

  // Extract package_manager: value
  const pmMatch = content.match(/^package_manager:\s*['"]?(\w+)['"]?/m);
  if (pmMatch && ['pnpm', 'npm', 'yarn', 'bun'].includes(pmMatch[1])) {
    result.packageManager = pmMatch[1];
  }

  // Extract build_command: value (handles quoted strings)
  const buildMatch = content.match(/^build_command:\s*['"]?([^'"\n]+)['"]?/m);
  if (buildMatch) {
    result.buildCommand = buildMatch[1].trim();
  }

  return result;
}

/**
 * WU-1356: Get build command from config or defaults
 *
 * @param {string} repoRoot - Repository root path
 * @returns {{ command: string, args: string[] }}
 */
export function getBuildCommand(repoRoot) {
  const configPath = path.join(repoRoot, CONFIG_FILE);

  // Default to pnpm
  let packageManager = 'pnpm';
  let customBuildCommand = null;

  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf8');
      const parsed = parseSimpleConfig(content);

      if (parsed.packageManager) {
        packageManager = parsed.packageManager;
      }
      if (parsed.buildCommand) {
        customBuildCommand = parsed.buildCommand;
      }
    } catch {
      // Ignore config errors, use defaults
    }
  }

  // If custom build command is set, parse it
  if (customBuildCommand) {
    const parts = customBuildCommand.split(/\s+/);
    return { command: parts[0], args: parts.slice(1) };
  }

  // Use default for the package manager
  const defaultCmd = DEFAULT_BUILD_COMMANDS[packageManager] || DEFAULT_BUILD_COMMANDS.pnpm;
  return { command: defaultCmd[0], args: defaultCmd.slice(1) };
}

export function resolveMainRepoFromWorktree(cwd) {
  const normalized = path.resolve(cwd);
  const marker = `${path.sep}${PATH_PARTS.WORKTREES}${path.sep}`;
  const index = normalized.lastIndexOf(marker);
  if (index === -1) {
    return null;
  }
  return normalized.slice(0, index);
}

export function resolveCliDistEntry(repoRoot, entry) {
  return path.join(
    repoRoot,
    PATH_PARTS.PACKAGES,
    PATH_PARTS.SCOPE,
    PATH_PARTS.CLI,
    PATH_PARTS.DIST,
    `${entry}.js`,
  );
}

export function selectCliEntryPath({ repoRoot, entry, mainRepoPath, exists }) {
  const primary = resolveCliDistEntry(repoRoot, entry);
  if (exists(primary)) {
    return primary;
  }

  if (!mainRepoPath) {
    return null;
  }

  const fallback = resolveCliDistEntry(mainRepoPath, entry);
  return exists(fallback) ? fallback : null;
}

export function ensureCliDist({
  repoRoot,
  entry,
  mainRepoPath,
  exists = existsSync,
  spawn = spawnSync,
  logger = console,
}) {
  const entryPath = resolveCliDistEntry(repoRoot, entry);
  if (exists(entryPath)) {
    return { path: entryPath, built: false, source: 'repo' };
  }

  logger.log(`[cli-entry] Missing CLI dist for ${entry}; building...`);

  // WU-1356: Use configured package manager and build command
  const { command, args } = getBuildCommand(repoRoot);
  const buildResult = spawn(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  if (buildResult.status === EXIT_CODES.OK && exists(entryPath)) {
    return { path: entryPath, built: true, source: 'repo' };
  }

  const fallbackPath = selectCliEntryPath({
    repoRoot,
    entry,
    mainRepoPath,
    exists,
  });

  if (fallbackPath) {
    logger.warn(`[cli-entry] Using main repo CLI dist for ${entry}.`);
    return { path: fallbackPath, built: false, source: 'main' };
  }

  return { path: null, built: false, source: 'none' };
}

export function runCliEntry({
  entry = DEFAULT_ENTRY,
  args = process.argv.slice(3),
  cwd = process.cwd(),
  spawn = spawnSync,
  exit = process.exit,
  logger = console,
}) {
  const repoRoot = path.resolve(cwd);
  const mainRepoPath = resolveMainRepoFromWorktree(repoRoot);
  const result = ensureCliDist({ repoRoot, entry, mainRepoPath, spawn, logger });

  if (!result.path) {
    logger.error(`[cli-entry] Unable to locate CLI dist for ${entry}.`);
    exit(EXIT_CODES.ERROR);
    return;
  }

  const runResult = spawn(COMMANDS.NODE, [result.path, ...args], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  exit(runResult.status ?? EXIT_CODES.ERROR);
}

const [, , entry = DEFAULT_ENTRY, ...args] = process.argv;
const isDirectRun = pathToFileURL(process.argv[1] || '').href === import.meta.url;

if (isDirectRun) {
  runCliEntry({ entry, args });
}
