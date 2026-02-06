/**
 * @file auto-checkpoint-utils.ts
 * Utilities for auto-checkpoint enforcement hooks (WU-1471)
 *
 * Provides:
 * - checkAutoCheckpointWarning: Detects config mismatch (policy enabled, hooks disabled)
 * - cleanupHookCounters: Removes per-WU counter files on wu:done completion
 */

import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { LUMENFLOW_PATHS } from '@lumenflow/core';

/**
 * WU-1471 AC5: Check if auto-checkpoint policy is enabled but hooks master switch is disabled.
 * When this mismatch exists, tooling should emit a warning that enforcement is advisory-only.
 *
 * @param params - Configuration state
 * @param params.hooksEnabled - Whether the hooks master switch is enabled
 * @param params.autoCheckpointEnabled - Whether auto_checkpoint.enabled is true
 * @returns Warning result with message if applicable
 */
export function checkAutoCheckpointWarning(params: {
  hooksEnabled: boolean;
  autoCheckpointEnabled: boolean;
}): { warning: boolean; message?: string } {
  if (params.autoCheckpointEnabled && !params.hooksEnabled) {
    return {
      warning: true,
      message:
        'Auto-checkpoint policy is enabled but hooks master switch is disabled. ' +
        'Checkpointing remains advisory-only. Enable agents.clients.claude-code.enforcement.hooks ' +
        'to activate automatic checkpointing.',
    };
  }

  return { warning: false };
}

/**
 * WU-1471 AC4: Remove per-WU hook counter file on wu:done completion.
 * Called during wu:done cleanup to remove .lumenflow/state/hook-counters/<WU_ID>.json.
 *
 * Fail-safe: does not throw if the file or directory does not exist.
 *
 * @param projectDir - Project root directory
 * @param wuId - WU identifier (e.g., 'WU-1471')
 */
export function cleanupHookCounters(projectDir: string, wuId: string): void {
  try {
    const counterFile = join(projectDir, LUMENFLOW_PATHS.HOOK_COUNTERS_DIR, `${wuId}.json`);
    if (existsSync(counterFile)) {
      unlinkSync(counterFile);
    }
  } catch {
    // Fail-safe: counter cleanup failure should never block wu:done
  }
}
