// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * State Doctor Fix Operations (WU-1230, WU-1420)
 *
 * Provides fix dependencies for state:doctor --fix that use micro-worktree
 * isolation for all tracked file changes. This ensures:
 *
 * 1. No direct file modifications on main branch
 * 2. Removal of stale WU references from backlog.md and status.md
 * 3. All changes pushed via merge, not direct file modification
 * 4. WU-1362: Retry logic for push failures (inherited from withMicroWorktree)
 * 5. WU-1420: Emit corrective events to reconcile YAML vs state store mismatches
 *
 * Retry behavior is configured via workspace.yaml git.push_retry section.
 * Default: 3 retries with exponential backoff and jitter.
 *
 * @see {@link ./state-doctor.ts} - Main CLI that uses these deps
 * @see {@link @lumenflow/core/micro-worktree} - Micro-worktree infrastructure with retry logic
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import type { StateDoctorDeps, EmitEventPayload } from '@lumenflow/core/state-doctor-core';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { emitCorrectiveEvent } from './state-emit.js';

/**
 * Operation name for micro-worktree isolation
 */
const OPERATION_NAME = 'state-doctor';

/**
 * Log prefix for state:doctor output
 */
const LOG_PREFIX = '[state:doctor]';

// WU-1539/WU-1548: Use centralized LUMENFLOW_PATHS.MEMORY_SIGNALS and LUMENFLOW_PATHS.WU_EVENTS

/**
 * Backlog file path (WU-1301: uses config-based paths)
 */
const BACKLOG_FILE = WU_PATHS.BACKLOG();

/**
 * Status file path (WU-1301: uses config-based paths)
 */
const STATUS_FILE = WU_PATHS.STATUS();

/**
 * Remove lines containing a WU reference from markdown content
 *
 * @param content - Markdown file content
 * @param wuId - WU ID to remove (e.g., 'WU-999')
 * @returns Updated content with lines containing WU ID removed
 */
function removeWuReferences(content: string, wuId: string): string {
  const lines = content.split('\n');
  const filtered = lines.filter((line) => !line.includes(wuId));
  return filtered.join('\n');
}

/**
 * Read file content safely, returning empty string if file doesn't exist
 */
async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Create fix dependencies for state:doctor --fix that use micro-worktree isolation.
 *
 * WU-1230: All file modifications happen in a micro-worktree and are pushed
 * to origin/main via merge. This prevents direct modifications to local main.
 *
 * WU-1420: Includes emitEvent for fixing status mismatches by emitting
 * corrective events (release, complete) to reconcile state store with YAML.
 *
 * @param baseDir - Project base directory
 * @returns Partial StateDoctorDeps with fix operations
 */
export function createStateDoctorFixDeps(
  _baseDir: string,
): Pick<StateDoctorDeps, 'removeSignal' | 'removeEvent' | 'createStamp' | 'emitEvent'> {
  return {
    /**
     * Remove a signal by ID using micro-worktree isolation
     */
    removeSignal: async (id: string): Promise<void> => {
      await withMicroWorktree({
        operation: OPERATION_NAME,
        id: `remove-signal-${id}`,
        logPrefix: LOG_PREFIX,
        pushOnly: true,
        execute: async ({ worktreePath }) => {
          const signalsPath = path.join(worktreePath, LUMENFLOW_PATHS.MEMORY_SIGNALS);
          const content = await readFileSafe(signalsPath);

          if (!content) {
            return { commitMessage: `fix: no signals file found`, files: [] };
          }

          const lines = content.split('\n').filter((line) => {
            if (!line.trim()) return false;
            try {
              const signal = JSON.parse(line) as { id?: string };
              return signal.id !== id;
            } catch {
              return true; // Keep malformed lines
            }
          });

          await fs.writeFile(signalsPath, lines.join('\n') + '\n', 'utf-8');

          return {
            commitMessage: `fix(state-doctor): remove dangling signal ${id}`,
            files: [LUMENFLOW_PATHS.MEMORY_SIGNALS],
          };
        },
      });
    },

    /**
     * Remove events for a WU and clean up stale references from backlog.md and status.md
     * using micro-worktree isolation.
     *
     * WU-1230: Also removes references to the WU from backlog.md and status.md
     * to prevent stale WU links.
     */
    removeEvent: async (wuId: string): Promise<void> => {
      await withMicroWorktree({
        operation: OPERATION_NAME,
        id: `remove-event-${wuId.toLowerCase()}`,
        logPrefix: LOG_PREFIX,
        pushOnly: true,
        execute: async ({ worktreePath }) => {
          const modifiedFiles: string[] = [];

          // 1. Remove events for this WU
          const eventsPath = path.join(worktreePath, LUMENFLOW_PATHS.WU_EVENTS);
          const eventsContent = await readFileSafe(eventsPath);

          if (eventsContent) {
            const lines = eventsContent.split('\n').filter((line) => {
              if (!line.trim()) return false;
              try {
                const event = JSON.parse(line) as { wuId?: string };
                return event.wuId !== wuId;
              } catch {
                return true; // Keep malformed lines
              }
            });

            await fs.writeFile(eventsPath, lines.join('\n') + '\n', 'utf-8');
            modifiedFiles.push(LUMENFLOW_PATHS.WU_EVENTS);
          }

          // 2. Remove stale WU references from backlog.md
          const backlogPath = path.join(worktreePath, BACKLOG_FILE);
          const backlogContent = await readFileSafe(backlogPath);

          if (backlogContent && backlogContent.includes(wuId)) {
            const updatedBacklog = removeWuReferences(backlogContent, wuId);

            await fs.writeFile(backlogPath, updatedBacklog, 'utf-8');
            modifiedFiles.push(BACKLOG_FILE);
          }

          // 3. Remove stale WU references from status.md
          const statusPath = path.join(worktreePath, STATUS_FILE);
          const statusContent = await readFileSafe(statusPath);

          if (statusContent && statusContent.includes(wuId)) {
            const updatedStatus = removeWuReferences(statusContent, wuId);

            await fs.writeFile(statusPath, updatedStatus, 'utf-8');
            modifiedFiles.push(STATUS_FILE);
          }

          return {
            commitMessage: `fix(state-doctor): remove broken events and references for ${wuId}`,
            files: modifiedFiles,
          };
        },
      });
    },

    /**
     * Create a stamp for a WU using micro-worktree isolation
     */
    createStamp: async (wuId: string, title: string): Promise<void> => {
      await withMicroWorktree({
        operation: OPERATION_NAME,
        id: `create-stamp-${wuId.toLowerCase()}`,
        logPrefix: LOG_PREFIX,
        pushOnly: true,
        execute: async ({ worktreePath }) => {
          const stampsDir = path.join(worktreePath, LUMENFLOW_PATHS.STAMPS_DIR);

          await fs.mkdir(stampsDir, { recursive: true });

          // Create stamp file in micro-worktree
          const stampPath = path.join(worktreePath, WU_PATHS.STAMP(wuId));
          const stampContent = `# ${wuId} Done\n\nTitle: ${title}\nCreated by: state:doctor --fix\nTimestamp: ${new Date().toISOString()}\n`;

          await fs.writeFile(stampPath, stampContent, 'utf-8');

          return {
            commitMessage: `fix(state-doctor): create missing stamp for ${wuId}`,
            files: [WU_PATHS.STAMP(wuId)],
          };
        },
      });
    },

    /**
     * Emit a corrective event to fix status mismatch (WU-1420, WU-2241)
     *
     * Uses emitCorrectiveEvent from state-emit.ts internally for event
     * construction and validation, wrapped in micro-worktree for atomicity.
     */
    emitEvent: async (event: EmitEventPayload): Promise<void> => {
      await withMicroWorktree({
        operation: OPERATION_NAME,
        id: `emit-event-${event.wuId.toLowerCase()}-${event.type}`,
        logPrefix: LOG_PREFIX,
        pushOnly: true,
        execute: async ({ worktreePath }) => {
          const eventsPath = path.join(worktreePath, LUMENFLOW_PATHS.WU_EVENTS);
          const auditLogPath = path.join(worktreePath, LUMENFLOW_PATHS.AUDIT_LOG);

          await emitCorrectiveEvent({
            type: event.type,
            wuId: event.wuId,
            reason: event.reason ?? `state:doctor --fix: reconciling state for ${event.wuId}`,
            eventsFilePath: eventsPath,
            auditLogPath,
            lane: event.lane,
            title: event.title,
          });

          return {
            commitMessage: `fix(state-doctor): emit ${event.type} event for ${event.wuId} to reconcile state`,
            files: [LUMENFLOW_PATHS.WU_EVENTS],
          };
        },
      });
    },
  };
}
