/**
 * WU-1366: Auto cleanup after wu:done success
 *
 * Provides functions to run state cleanup automatically after successful wu:done.
 * Cleanup is non-fatal: errors are logged but do not block completion.
 *
 * The cleanup.trigger config option controls when cleanup runs:
 * - 'on_done': Run after wu:done success (default)
 * - 'on_init': Run during lumenflow init
 * - 'manual': Only run via pnpm state:cleanup
 *
 * @see {@link packages/@lumenflow/core/src/state-cleanup-core.ts} - Core cleanup orchestration
 * @see {@link packages/@lumenflow/core/src/lumenflow-config-schema.ts} - CleanupConfigSchema
 */

/* eslint-disable no-console -- CLI module requires console output for user feedback */

import { getConfig } from '@lumenflow/core/dist/lumenflow-config.js';
import { cleanupState, type StateCleanupResult } from '@lumenflow/core/dist/state-cleanup-core.js';
import { cleanupSignals } from '@lumenflow/memory/dist/signal-cleanup-core.js';
import { cleanupMemory } from '@lumenflow/memory/dist/mem-cleanup-core.js';
import { archiveWuEvents } from '@lumenflow/core/dist/wu-events-cleanup.js';
import fg from 'fast-glob';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import path from 'node:path';
import { LOG_PREFIX, EMOJI } from '@lumenflow/core/dist/wu-constants.js';

/**
 * Active WU statuses that should protect signals
 */
const ACTIVE_WU_STATUSES = ['in_progress', 'blocked'];

/**
 * Get active WU IDs (in_progress or blocked) by scanning WU YAML files.
 *
 * @param baseDir - Base directory
 * @returns Set of active WU IDs
 */
async function getActiveWuIds(baseDir: string): Promise<Set<string>> {
  const activeIds = new Set<string>();

  try {
    const config = getConfig({ projectRoot: baseDir });
    const wuDir = path.join(baseDir, config.directories.wuDir);

    // Find all WU YAML files
    const wuFiles = await fg('WU-*.yaml', { cwd: wuDir });

    for (const file of wuFiles) {
      try {
        const filePath = path.join(wuDir, file);
        const content = await readFile(filePath, 'utf-8');
        const wu = parseYaml(content) as { id?: string; status?: string };

        if (wu.id && wu.status && ACTIVE_WU_STATUSES.includes(wu.status)) {
          activeIds.add(wu.id);
        }
      } catch {
        // Skip files that fail to parse
        continue;
      }
    }
  } catch {
    // If we can't read WU files, return empty set (safer to remove nothing)
  }

  return activeIds;
}

/**
 * Check if auto cleanup should run based on config.
 *
 * @returns true if cleanup.trigger is 'on_done' or not set (default)
 */
export function shouldRunAutoCleanup(): boolean {
  try {
    const config = getConfig();
    const trigger = config.cleanup?.trigger;

    // Default to 'on_done' if not set
    if (!trigger) {
      return true;
    }

    return trigger === 'on_done';
  } catch {
    // If config can't be loaded, default to running cleanup
    return true;
  }
}

/**
 * Run state cleanup automatically after wu:done success.
 *
 * This function is non-fatal: errors are logged as warnings but do not throw.
 * Cleanup respects the config.cleanup.trigger setting.
 *
 * @param baseDir - Base directory for cleanup operations
 * @returns Promise that resolves when cleanup completes (or is skipped)
 */
export async function runAutoCleanupAfterDone(baseDir: string): Promise<void> {
  // Check if cleanup should run
  if (!shouldRunAutoCleanup()) {
    return;
  }

  try {
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.INFO} Running auto state cleanup...`);

    const result: StateCleanupResult = await cleanupState(baseDir, {
      dryRun: false,
      // Inject real cleanup functions
      cleanupSignals: async (dir, opts) =>
        cleanupSignals(dir, {
          dryRun: opts.dryRun,
          getActiveWuIds: () => getActiveWuIds(dir),
        }),
      cleanupMemory: async (dir, opts) =>
        cleanupMemory(dir, {
          dryRun: opts.dryRun,
        }),
      archiveEvents: async (dir, opts) =>
        archiveWuEvents(dir, {
          dryRun: opts.dryRun,
        }),
    });

    if (result.success) {
      const typesStr = result.summary.typesExecuted.join(', ');
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} State cleanup complete: ` +
          `${formatBytes(result.summary.totalBytesFreed)} freed [${typesStr}]`,
      );
    } else {
      // Partial success - some cleanups failed
      const errorMsgs = result.errors.map((e) => `${e.type}: ${e.message}`).join(', ');
      console.warn(`${LOG_PREFIX.DONE} ${EMOJI.WARNING} State cleanup partial: ${errorMsgs}`);
    }
  } catch (err) {
    // Non-fatal: log warning but don't throw
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not run auto state cleanup: ${message}`,
    );
  }
}

/**
 * Format bytes as human-readable string
 */
function formatBytes(bytes: number): string {
  const BYTES_PER_KB = 1024;
  if (bytes < BYTES_PER_KB) {
    return `${bytes} B`;
  }
  const kb = (bytes / BYTES_PER_KB).toFixed(1);
  return `${kb} KB`;
}
