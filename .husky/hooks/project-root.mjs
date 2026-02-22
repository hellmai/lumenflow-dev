#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GIT_BINARY = 'git';
const GIT_SHOW_TOPLEVEL_ARGS = ['rev-parse', '--show-toplevel'];
const ROOT_MARKER_FILE = 'workspace.yaml';
const MAX_ASCENT_LEVELS = 10;

function tryResolveGitTopLevel(cwd) {
  try {
    const output = execFileSync(GIT_BINARY, ['-C', cwd, ...GIT_SHOW_TOPLEVEL_ARGS], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

function tryResolveByMarker(startPath) {
  let cursor = resolve(startPath);

  for (let depth = 0; depth < MAX_ASCENT_LEVELS; depth += 1) {
    if (existsSync(join(cursor, ROOT_MARKER_FILE))) {
      return cursor;
    }

    const parent = dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  return null;
}

export function resolveProjectRoot(cwd = process.cwd()) {
  const fromCwdGit = tryResolveGitTopLevel(cwd);
  if (fromCwdGit) {
    return fromCwdGit;
  }

  const hookDir = dirname(fileURLToPath(import.meta.url));
  const fromHookGit = tryResolveGitTopLevel(hookDir);
  if (fromHookGit) {
    return fromHookGit;
  }

  const fromCwdMarker = tryResolveByMarker(cwd);
  if (fromCwdMarker) {
    return fromCwdMarker;
  }

  const fromHookMarker = tryResolveByMarker(hookDir);
  if (fromHookMarker) {
    return fromHookMarker;
  }

  return resolve(cwd);
}
