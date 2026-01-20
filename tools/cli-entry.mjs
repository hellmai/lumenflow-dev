#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PATH_PARTS = {
  PACKAGES: 'packages',
  SCOPE: '@lumenflow',
  CLI: 'cli',
  DIST: 'dist',
  WORKTREES: 'worktrees',
};

const COMMANDS = {
  PNPM: 'pnpm',
  FILTER: '--filter',
  BUILD: 'build',
  NODE: 'node',
};

const EXIT_CODES = {
  OK: 0,
  ERROR: 1,
};

const DEFAULT_ENTRY = 'gates';

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
  const buildResult = spawn(
    COMMANDS.PNPM,
    [COMMANDS.FILTER, `${PATH_PARTS.SCOPE}/${PATH_PARTS.CLI}`, COMMANDS.BUILD],
    {
      cwd: repoRoot,
      stdio: 'inherit',
    },
  );

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
