// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Backlog.md Update Utilities
 *
 * Centralized backlog.md update functions (extracted from wu-done.ts)
 * Refactored to use BacklogManager (WU-1212) for AST-based manipulation
 *
 * Used by both main wu:done flow AND recovery mode (DRY principle)
 */

import { writeFile } from 'node:fs/promises';
import { LOG_PREFIX } from './wu-constants.js';
import { WUStateStore } from './wu-state-store.js';
// WU-1574: Use backlog generator instead of BacklogManager
import { generateBacklog } from './backlog-generator.js';
import { getStateStoreDirFromBacklog } from './wu-paths.js';

/**
 * Move WU to Done section in backlog.md (idempotent)
 * WU-1574: Simplified to use state store + generator (no BacklogManager)
 *
 * @param {string} backlogPath - Path to backlog.md
 * @param {string} id - WU ID
 * @param {string} title - WU title (unused - state store has it)
 */
export async function moveWUToDoneBacklog(
  backlogPath: string,
  id: string,
  _title: string,
) {
  const PREFIX = LOG_PREFIX.DONE;
  const stateDir = getStateStoreDirFromBacklog(backlogPath);

  // WU-1574: State store is now the single source of truth
  // 1. Mark complete in state store
  // 2. Regenerate backlog.md from state
  const store = new WUStateStore(stateDir);
  await store.load();
  await store.complete(id);
  console.log(`${PREFIX} Complete event appended to state store`);

  // Regenerate backlog.md from state store
  const content = await generateBacklog(store);
  await writeFile(backlogPath, content, 'utf-8');
  console.log(`${PREFIX} Backlog.md regenerated from state store`);
}
