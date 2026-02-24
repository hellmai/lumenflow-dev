// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file path-utils.ts
 * Path normalization and allowlist utilities for enforcement hooks.
 *
 * Single responsibility: normalize file paths and check allowlist membership.
 * Split from enforcement-checks.ts (WU-2127).
 */

import * as path from 'node:path';

const GIT_STATUS_QUOTE = '"';
const PATH_PREFIX_CURRENT_DIR = './';
const PATH_SEPARATOR_WINDOWS = '\\';
const PATH_SEPARATOR_POSIX = '/';

export function normalizeDirectorySegment(value: string, fallback: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return normalized.length > 0 ? normalized : fallback;
}

export function ensureRepoRelativePrefix(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return normalized.length > 0 ? `${normalized}/` : '';
}

export function stripWrappingQuotes(value: string): string {
  if (value.startsWith(GIT_STATUS_QUOTE) && value.endsWith(GIT_STATUS_QUOTE) && value.length >= 2) {
    return value.slice(1, -1);
  }
  return value;
}

export function normalizeRepoRelativePath(value: string): string {
  const withoutQuotes = stripWrappingQuotes(value.trim());
  const normalizedSeparators = withoutQuotes
    .split(PATH_SEPARATOR_WINDOWS)
    .join(PATH_SEPARATOR_POSIX);
  if (normalizedSeparators.startsWith(PATH_PREFIX_CURRENT_DIR)) {
    return normalizedSeparators.slice(PATH_PREFIX_CURRENT_DIR.length);
  }
  return normalizedSeparators;
}

/**
 * Check if a resolved path matches the main-write allowlist.
 *
 * @param resolvedPath - Absolute resolved path to check
 * @param mainRepoPath - Absolute path to the main repo root
 * @param allowlistPrefixes - List of repo-relative prefixes that are allowed
 * @returns True if the path is in the allowlist
 */
export function isAllowlistedPath(
  resolvedPath: string,
  mainRepoPath: string,
  allowlistPrefixes: readonly string[],
): boolean {
  const repoPrefix = mainRepoPath + path.sep;
  if (!resolvedPath.startsWith(repoPrefix)) {
    return false;
  }
  const relativePath = resolvedPath.slice(repoPrefix.length);

  return allowlistPrefixes.some((prefix) => relativePath.startsWith(prefix));
}
