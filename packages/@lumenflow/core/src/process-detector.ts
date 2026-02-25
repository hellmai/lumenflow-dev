// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Background Process Detector (WU-1381)
 *
 * Detects running background processes that might interfere with wu:done
 * gates execution. Warns agents when pnpm/node processes are running
 * in the worktree directory to prevent confusion from mixed output.
 *
 * This is a NON-BLOCKING pre-flight check - it warns but doesn't fail wu:done.
 *
 * @see {@link packages/@lumenflow/cli/src/wu-done.ts} - Integrates this as pre-flight check
 * @see {@link packages/@lumenflow/cli/src/lib/wu-constants.ts} - Constants for log prefixes
 */

import psList from 'ps-list';
import { LOG_PREFIX, EMOJI, PROCESS_DETECTION, STRING_LITERALS } from './wu-constants.js';

/** Process info from ps-list */
interface ProcessEntry {
  pid: number;
  name: string;
  cmd?: string;
}

/**
 * Re-export interfering process names for external consumers.
 * Source of truth is PROCESS_DETECTION.INTERFERING_NAMES in wu-constants.ts
 */
export const INTERFERING_PROCESS_NAMES = PROCESS_DETECTION.INTERFERING_NAMES;

/**
 * Filter processes that might interfere with wu:done in a specific worktree.
 *
 * A process is considered interfering if:
 * 1. Its command contains the worktree path (directly running in worktree)
 * 2. Its name matches known interfering process names (may affect gates)
 *
 * @param {Array<{pid: number, name: string, cmd?: string}>} processes - Process list from ps-list
 * @param {string|null|undefined} worktreePath - Path to the worktree directory
 * @returns {Array<{pid: number, name: string, cmd?: string}>} Filtered processes
 *
 * @example
 * const processes = await psList();
 * const interfering = filterProcessesForWorktree(processes, '/path/to/worktree');
 */
export function filterProcessesForWorktree(
  processes: readonly ProcessEntry[],
  worktreePath: string | null | undefined,
): ProcessEntry[] {
  // Handle null/undefined worktree path
  if (!worktreePath) {
    return [];
  }

  // Handle empty processes array
  if (!processes || processes.length === 0) {
    return [];
  }

  return processes.filter((proc: ProcessEntry) => {
    const cmd = proc.cmd || '';

    // Include only processes running in the worktree (cmd contains worktree path)
    // We require worktree context to avoid flagging unrelated system processes
    return cmd.includes(worktreePath);
  });
}

/**
 * Build a warning message for detected background processes.
 *
 * @param {Array<{pid: number, name: string, cmd?: string}>} processes - Detected processes
 * @returns {string} Formatted warning message
 */
export function buildWarningMessage(processes: readonly ProcessEntry[]): string {
  if (!processes || processes.length === 0) {
    return '';
  }

  const processCount = processes.length;
  const cmdLimit = PROCESS_DETECTION.CMD_DISPLAY_LIMIT;
  const processList = processes
    .map((p: ProcessEntry) => {
      const cmd = p.cmd
        ? ` (${p.cmd.slice(0, cmdLimit)}${p.cmd.length > cmdLimit ? '...' : ''})`
        : '';
      return `    - PID ${p.pid}: ${p.name}${cmd}`;
    })
    .join(STRING_LITERALS.NEWLINE);

  const killCommands = processes.map((p: ProcessEntry) => `kill ${p.pid}`).join(' && ');

  return `
${EMOJI.WARNING} BACKGROUND PROCESSES DETECTED ${EMOJI.WARNING}

Found ${processCount} process(es) that may interfere with wu:done:

${processList}

These processes may cause:
  - Mixed stdout/stderr output (confusing errors)
  - File lock conflicts during tests
  - Resource contention affecting gate performance

Options:
  1. Wait for processes to complete naturally
  2. Kill interfering processes:
     ${killCommands}
  3. Proceed anyway (output may be mixed)

This is a NON-BLOCKING warning. wu:done will continue.
`;
}

/**
 * Detect background processes that might interfere with wu:done.
 *
 * Queries running processes and filters for those that might cause
 * issues during gates execution. Returns detection result with
 * warning messages suitable for display.
 *
 * @param {string} worktreePath - Path to the worktree directory
 * @returns {Promise<{hasProcesses: boolean, processes: Array, warnings: string[], error?: string}>}
 *
 * @example
 * const result = await detectBackgroundProcesses('/path/to/worktree');
 * if (result.hasProcesses) {
 *   console.warn(result.warnings.join('\n'));
 * }
 */
export async function detectBackgroundProcesses(worktreePath: string | null | undefined) {
  const noProcessesResult = {
    hasProcesses: false,
    processes: [],
    warnings: [],
  };

  // Handle invalid worktree path
  if (!worktreePath) {
    return noProcessesResult;
  }

  try {
    // Get all running processes
    const allProcesses = await psList();

    // Filter for worktree-related interfering processes
    const interferingProcesses = filterProcessesForWorktree(allProcesses, worktreePath);

    // Exclude the current process (wu-done itself)
    const currentPid = process.pid;
    const externalProcesses = interferingProcesses.filter(
      (p: ProcessEntry) => p.pid !== currentPid,
    );

    if (externalProcesses.length === 0) {
      return noProcessesResult;
    }

    // Build warning message
    const warningMessage = buildWarningMessage(externalProcesses);

    return {
      hasProcesses: true,
      processes: externalProcesses,
      warnings: [warningMessage],
    };
  } catch (error: unknown) {
    // Handle ps-list errors gracefully (permission issues, etc.)
    // Don't block wu:done on process detection failure
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not detect background processes: ${errorMessage}`,
    );
    return {
      ...noProcessesResult,
      error: errorMessage,
    };
  }
}

/**
 * Run background process detection as a pre-flight check.
 *
 * This is the main entry point for wu-done.ts integration.
 * Logs warnings if background processes are detected but does NOT fail.
 *
 * @param {string} worktreePath - Path to the worktree directory
 * @returns {Promise<void>}
 *
 * @example
 * // In wu-done.ts pre-flight checks:
 * await runBackgroundProcessCheck(worktreePath);
 */
export async function runBackgroundProcessCheck(worktreePath: string) {
  console.log(`${LOG_PREFIX.DONE} Checking for background processes...`);

  const result = await detectBackgroundProcesses(worktreePath);

  if (result.hasProcesses) {
    // Log warning but don't fail
    console.warn(`\n${LOG_PREFIX.DONE} ${result.warnings.join(STRING_LITERALS.NEWLINE)}`);
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.INFO} Proceeding with wu:done despite background processes`,
    );
  } else {
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} No interfering background processes detected`);
  }
}
