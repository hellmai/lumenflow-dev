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

import { getConfig } from '@lumenflow/core/config';
import { cleanupState, type StateCleanupResult } from '@lumenflow/core/state-cleanup-core';
import { cleanupSignals } from '@lumenflow/memory/signal-cleanup-core';
import { cleanupMemory } from '@lumenflow/memory/cleanup';
import { archiveWuEvents } from '@lumenflow/core/wu-events-cleanup';
import { getGitForCwd } from '@lumenflow/core/git-adapter';
import fg from 'fast-glob';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import path from 'node:path';
import { LOG_PREFIX, EMOJI, PROTECTED_WU_STATUSES, BRANCHES } from '@lumenflow/core/wu-constants';

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

        if (wu.id && wu.status && PROTECTED_WU_STATUSES.includes(wu.status)) {
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
 * WU-1533: Uses reload: true to re-read config from disk after merge.
 * This ensures that a merged cleanup.trigger change (e.g., 'manual')
 * is respected even though config was cached earlier in the process.
 *
 * @returns true if cleanup.trigger is 'on_done' or not set (default)
 */
export function shouldRunAutoCleanup(): boolean {
  try {
    const config = getConfig({ reload: true });
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
 * WU-1533: State file path prefix that auto-cleanup may modify.
 * WU-1553: Archive prefix added — archiveWuEvents() writes to .lumenflow/archive/.
 * Both prefixes are auto-committed after cleanup to prevent leaving main dirty.
 */
const STATE_FILE_PREFIX = '.lumenflow/state/';
const ARCHIVE_FILE_PREFIX = '.lumenflow/archive/';

/**
 * WU-1542: Default commit message for auto-cleanup.
 * Uses plain 'chore:' without scope to be compatible with consumer main-branch guards.
 * The previous 'chore(lumenflow):' scope was rejected by repos that only allow
 * specific scopes like wu(...), docs:, chore(repair):.
 */
const DEFAULT_CLEANUP_COMMIT_MESSAGE = 'chore: lumenflow state cleanup [skip ci]';

/**
 * WU-1542: Read the cleanup commit message from config, falling back to default.
 *
 * @returns Commit message string
 */
function getCleanupCommitMessage(): string {
  try {
    const config = getConfig({ reload: true });
    return config.cleanup?.commit_message || DEFAULT_CLEANUP_COMMIT_MESSAGE;
  } catch {
    return DEFAULT_CLEANUP_COMMIT_MESSAGE;
  }
}

/**
 * WU-1533: Commit and push any dirty state files left by auto-cleanup.
 *
 * After cleanup runs, tracked files like wu-events.jsonl may be modified.
 * This function detects those changes, commits them with a housekeeping
 * message, and pushes to prevent leaving main dirty.
 *
 * WU-1542: Commit message is configurable via cleanup.commit_message config.
 * Default changed from 'chore(lumenflow):' to plain 'chore:' for consumer compatibility.
 *
 * Non-fatal: errors are logged but never thrown.
 */
interface CommitCleanupChangesOptions {
  targetBranch?: string;
}

export async function commitCleanupChanges(
  options: CommitCleanupChangesOptions = {},
): Promise<void> {
  try {
    const git = getGitForCwd();
    const status = await git.getStatus();
    const targetBranch = options.targetBranch || BRANCHES.MAIN;

    if (!status) {
      return;
    }

    // Parse porcelain status lines to find dirty state/archive files
    // WU-1553: Include .lumenflow/archive/ files created by archiveWuEvents()
    const lines = status.split('\n').filter((line) => line.length >= 4);
    const cleanupFiles = lines
      .map((line) => line.slice(3).trim())
      .filter(
        (filePath) =>
          filePath.startsWith(STATE_FILE_PREFIX) || filePath.startsWith(ARCHIVE_FILE_PREFIX),
      );

    if (cleanupFiles.length === 0) {
      return;
    }

    // WU-1542: Use configurable commit message
    const commitMessage = getCleanupCommitMessage();

    // Stage only cleanup files, commit, pull --rebase, push
    await git.add(cleanupFiles);
    await git.commit(commitMessage);
    await git.raw(['pull', '--rebase', '--autostash', 'origin', targetBranch]);
    await git.push('origin', targetBranch);

    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Committed cleanup changes: ${cleanupFiles.join(', ')}`,
    );
  } catch (err) {
    // Non-fatal: log warning but don't throw
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not commit cleanup changes: ${message}`,
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
