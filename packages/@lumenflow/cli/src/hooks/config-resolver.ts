// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file config-resolver.ts
 * Configuration-driven path resolution for enforcement hooks.
 *
 * Single responsibility: resolve worktree directories and allowlist prefixes
 * from LumenFlow configuration.
 * Split from enforcement-checks.ts (WU-2127).
 */

import { createWuPaths } from '@lumenflow/core/wu-paths';
import { DIRECTORIES } from '@lumenflow/core/wu-constants';
import { normalizeDirectorySegment, ensureRepoRelativePrefix } from './path-utils.js';

/**
 * Paths that are always safe to write on main checkout.
 * These are scaffold/state paths that are written by lifecycle commands
 * and must not require a worktree.
 */
const MAIN_WRITE_STATIC_ALLOWLIST_PREFIXES = ['.lumenflow/', '.claude/', 'plan/'] as const;

const DEFAULT_WORKTREES_DIR_SEGMENT = DIRECTORIES.WORKTREES.replace(/\/+$/g, '');
const DEFAULT_WU_ALLOWLIST_PREFIX = `${DIRECTORIES.WU_DIR.replace(/\/+$/g, '')}/`;

export function resolveWorktreesDirSegment(mainRepoPath: string): string {
  try {
    const configuredPath = createWuPaths({ projectRoot: mainRepoPath }).WORKTREES_DIR();
    return normalizeDirectorySegment(configuredPath, DEFAULT_WORKTREES_DIR_SEGMENT);
  } catch {
    return DEFAULT_WORKTREES_DIR_SEGMENT;
  }
}

export function resolveWuAllowlistPrefix(mainRepoPath: string): string {
  try {
    const configuredPath = createWuPaths({ projectRoot: mainRepoPath }).WU_DIR();
    return ensureRepoRelativePrefix(configuredPath);
  } catch {
    return DEFAULT_WU_ALLOWLIST_PREFIX;
  }
}

export function resolveMainWriteAllowlistPrefixes(mainRepoPath: string): readonly string[] {
  return [resolveWuAllowlistPrefix(mainRepoPath), ...MAIN_WRITE_STATIC_ALLOWLIST_PREFIXES];
}
