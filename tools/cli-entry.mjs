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
  BUILD: 'build',
  NODE: 'node',
  RUN: 'run',
  ARG_SEPARATOR: '--',
};

/**
 * WU-1356: Default build commands by package manager
 */
const DEFAULT_BUILD_COMMANDS = {
  pnpm: [COMMANDS.PNPM, COMMANDS.BUILD, '--filter=@lumenflow/cli'],
  npm: [
    COMMANDS.NPM,
    COMMANDS.RUN,
    COMMANDS.BUILD,
    COMMANDS.ARG_SEPARATOR,
    '--filter=@lumenflow/cli',
  ],
  yarn: [COMMANDS.YARN, COMMANDS.BUILD, '--filter=@lumenflow/cli'],
  bun: [COMMANDS.BUN, COMMANDS.RUN, COMMANDS.BUILD, '--filter=@lumenflow/cli'],
};

const EXIT_CODES = {
  OK: 0,
  ERROR: 1,
};

const DEFAULT_ENTRY = 'gates';

/**
 * Commands that must execute against freshly built dist artifacts.
 *
 * These commands mutate or validate lifecycle state and cannot safely run
 * against stale dist output.
 */
const STRICT_LIFECYCLE_ENTRIES = new Set(['wu-claim', 'wu-done', 'wu-repair', 'state-doctor']);

function buildCliDist({ repoRoot, entryPath, exists, spawn }) {
  const { command, args } = getBuildCommand(repoRoot);
  const buildResult = spawn(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  if (buildResult.status === EXIT_CODES.OK && exists(entryPath)) {
    return { path: entryPath, built: true, source: 'repo' };
  }

  return { path: null, built: false, source: 'none' };
}

function resolveExistingDist({ repoRoot, entry, mainRepoPath, exists }) {
  const repoEntryPath = resolveCliDistEntry(repoRoot, entry);
  if (exists(repoEntryPath)) {
    return { path: repoEntryPath, source: 'repo' };
  }

  if (mainRepoPath) {
    const mainEntryPath = resolveCliDistEntry(mainRepoPath, entry);
    if (exists(mainEntryPath)) {
      return { path: mainEntryPath, source: 'main' };
    }
  }

  return null;
}

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
  const defaultCmd = DEFAULT_BUILD_COMMANDS[packageManager];
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

  if (STRICT_LIFECYCLE_ENTRIES.has(entry)) {
    const existingDist = resolveExistingDist({
      repoRoot,
      entry,
      mainRepoPath,
      exists,
    });

    logger.log(`[cli-entry] ${entry} requires fresh dist; building before execution...`);
    const buildResult = buildCliDist({ repoRoot, entryPath, exists, spawn });
    if (buildResult.path) {
      return buildResult;
    }

    if (existingDist) {
      logger.warn(
        `[cli-entry] ${entry} build failed; falling back to existing CLI dist from ${existingDist.source}.`,
      );
      return { path: existingDist.path, built: false, source: existingDist.source };
    }

    return buildResult;
  }

  if (exists(entryPath)) {
    return { path: entryPath, built: false, source: 'repo' };
  }

  // WU-1366: Check main repo fallback BEFORE attempting build
  // This allows worktrees to use the already-built CLI from main
  // without triggering a potentially slow/failing build
  if (mainRepoPath) {
    const mainFallback = resolveCliDistEntry(mainRepoPath, entry);
    if (exists(mainFallback)) {
      logger.warn(`[cli-entry] Using main repo CLI dist for ${entry}.`);
      return { path: mainFallback, built: false, source: 'main' };
    }
  }

  // No existing dist found - attempt build
  logger.log(`[cli-entry] Missing CLI dist for ${entry}; building...`);
  return buildCliDist({ repoRoot, entryPath, exists, spawn });
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
    logger.error(
      `[cli-entry] Run 'pnpm bootstrap' from the repository root, then retry the command.`,
    );
    exit(EXIT_CODES.ERROR);
    return;
  }

  const runResult = spawn(COMMANDS.NODE, [result.path, ...args], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  exit(runResult.status ?? EXIT_CODES.ERROR);
}

export function maybeRunCliEntry({
  argv = process.argv,
  moduleUrl = import.meta.url,
  run = runCliEntry,
} = {}) {
  const [, , entry = DEFAULT_ENTRY, ...args] = argv;
  const isDirectRun = pathToFileURL(argv[1] || '').href === moduleUrl;

  if (!isDirectRun) {
    return false;
  }

  run({ entry, args });
  return true;
}

maybeRunCliEntry();
