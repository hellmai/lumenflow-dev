// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file git-status-parser.ts
 * Parse and filter dirty paths from git status output.
 *
 * Single responsibility: extract and classify file paths from `git status`
 * porcelain output.
 * Split from enforcement-checks.ts (WU-2127).
 */

import { normalizeRepoRelativePath } from './path-utils.js';

const GIT_STATUS_PREFIX_LENGTH = 3;
const GIT_STATUS_RENAME_SEPARATOR = ' -> ';
const MAX_BLOCKED_PATHS_IN_MESSAGE = 10;

function parsePathFromStatusLine(line: string): string | null {
  if (line.length < GIT_STATUS_PREFIX_LENGTH) {
    return null;
  }

  const pathField = line.slice(GIT_STATUS_PREFIX_LENGTH).trim();
  if (pathField.length === 0) {
    return null;
  }

  // For renames, git status emits "old -> new". We care about the destination path.
  const renameSegments = pathField.split(GIT_STATUS_RENAME_SEPARATOR);
  const destinationPath = renameSegments[renameSegments.length - 1];
  const normalizedPath = normalizeRepoRelativePath(destinationPath);
  return normalizedPath.length > 0 ? normalizedPath : null;
}

export function parseDirtyPathsFromStatus(mainStatus: string): string[] {
  const uniquePaths = new Set<string>();

  for (const line of mainStatus.split('\n')) {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) {
      continue;
    }

    const parsed = parsePathFromStatusLine(trimmed);
    if (parsed) {
      uniquePaths.add(parsed);
    }
  }

  return Array.from(uniquePaths);
}

export function getNonAllowlistedDirtyPaths(
  mainStatus: string,
  allowlistPrefixes: readonly string[],
): string[] {
  return parseDirtyPathsFromStatus(mainStatus).filter(
    (relativePath) => !allowlistPrefixes.some((prefix) => relativePath.startsWith(prefix)),
  );
}

export function formatBlockedPaths(paths: string[]): string {
  const displayed = paths.slice(0, MAX_BLOCKED_PATHS_IN_MESSAGE);
  const lines = displayed.map((dirtyPath) => `  - ${dirtyPath}`);
  const remainder = paths.length - displayed.length;

  if (remainder > 0) {
    lines.push(`  - ... and ${remainder} more`);
  }

  return lines.join('\n');
}

export function formatMainDirtyMutationGuardMessage(options: {
  commandName: string;
  mainCheckout: string;
  blockedPaths: string[];
  allowlistPrefixes: readonly string[];
}): string {
  const { commandName, mainCheckout, blockedPaths, allowlistPrefixes } = options;
  const allowlistLines = allowlistPrefixes.map((prefix) => `  - ${prefix}`).join('\n');
  return (
    `${commandName} blocked: main checkout has non-allowlisted dirty files while a worktree WU is active.\n\n` +
    `Dirty paths:\n${formatBlockedPaths(blockedPaths)}\n\n` +
    `Allowed dirty prefixes on main:\n${allowlistLines}\n\n` +
    `How to resolve:\n` +
    `  1. Move edits into the active worktree (recommended)\n` +
    `  2. Revert or commit unintended main edits\n` +
    `  3. If writes came from MCP/tools, rerun them in the worktree path\n` +
    `  4. Retry ${commandName}\n\n` +
    `Main checkout: ${mainCheckout}`
  );
}
