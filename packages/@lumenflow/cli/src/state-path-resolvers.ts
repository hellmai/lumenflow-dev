// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file state-path-resolvers.ts
 * @description Shared resolvers for state store directory and wu-events path.
 *
 * WU-2099: Extracted from wu-done.ts, wu-block.ts, wu-claim-state.ts,
 * wu-release.ts, wu-unblock.ts, wu-recover.ts to eliminate duplication.
 *
 * All resolvers use getConfig() with try/catch fallback to LUMENFLOW_PATHS
 * constants for graceful degradation when config is unavailable (e.g., in
 * micro-worktrees or hook contexts).
 */

import path from 'node:path';
import { getConfig } from '@lumenflow/core/config';
import { LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { WU_EVENTS_FILE_NAME } from '@lumenflow/core/wu-state-store';

/**
 * Resolve the absolute state store directory for a given project root.
 *
 * @param projectRoot - Absolute path to the project (or micro-worktree) root
 * @returns Absolute path to the state directory
 */
export function resolveStateDir(projectRoot: string): string {
  try {
    return path.join(projectRoot, getConfig({ projectRoot }).state.stateDir);
  } catch {
    return path.join(projectRoot, LUMENFLOW_PATHS.STATE_DIR);
  }
}

/**
 * Resolve the relative wu-events path (for git add operations).
 *
 * Returns a forward-slash-separated relative path suitable for `git add`.
 * Uses path.posix.join to guarantee forward slashes on all platforms.
 *
 * @param projectRoot - Absolute path to the project (or micro-worktree) root
 * @returns Relative path like `.lumenflow/state/wu-events.jsonl`
 */
export function resolveWuEventsRelativePath(projectRoot: string): string {
  try {
    const stateDir = getConfig({ projectRoot }).state.stateDir;
    return path.posix.join(stateDir.replace(/\\/g, '/'), WU_EVENTS_FILE_NAME);
  } catch {
    return LUMENFLOW_PATHS.WU_EVENTS;
  }
}
