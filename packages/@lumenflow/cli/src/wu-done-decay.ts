/**
 * WU-1474: Decay policy runner for wu:done completion lifecycle
 *
 * Invokes decay-based archival during wu:done when configured.
 * Fail-open: archival errors are captured but never block wu:done.
 *
 * @see {@link packages/@lumenflow/memory/src/decay/archival.ts} - Archival implementation
 * @see {@link packages/@lumenflow/core/src/lumenflow-config-schema.ts} - Config schema
 */

import { archiveByDecay } from '@lumenflow/memory/decay/archival';

import type { MemoryDecayConfig } from '@lumenflow/core/config-schema';
import { LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import path from 'node:path';

/**
 * Milliseconds per day for converting half_life_days to halfLifeMs
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Reason strings for skipped decay runs
 */
const SKIP_REASONS = {
  NO_CONFIG: 'no_config',
  DISABLED: 'disabled',
  TRIGGER_MISMATCH: 'trigger_mismatch',
} as const;

/**
 * Trigger value that activates decay during wu:done
 */
const ON_DONE_TRIGGER = 'on_done';

// WU-1548: Using LUMENFLOW_PATHS.MEMORY_DIR from wu-constants (consolidated)

/**
 * Result of running decay during wu:done
 */
export interface DecayOnDoneResult {
  /** Whether decay archival actually ran */
  ran: boolean;
  /** Number of nodes archived (0 if not ran) */
  archivedCount: number;
  /** Reason for skipping (only set when ran=false and no error) */
  skippedReason?: string;
  /** Error message if decay failed (fail-open) */
  error?: string;
}

/**
 * Run decay-based archival during wu:done completion lifecycle.
 *
 * Behavior:
 * - If config is undefined or decay is disabled: skip silently
 * - If trigger is not 'on_done': skip with reason
 * - If enabled with trigger=on_done: invoke archiveByDecay
 * - On any error: capture but never throw (fail-open)
 *
 * @param baseDir - Repository root directory
 * @param decayConfig - Memory decay configuration (from .lumenflow.config.yaml)
 * @returns Result indicating whether decay ran and how many nodes were archived
 *
 * @example
 * const result = await runDecayOnDone(baseDir, config.memory?.decay);
 * if (result.ran) {
 *   console.log(`Archived ${result.archivedCount} stale memory nodes`);
 * }
 */
export async function runDecayOnDone(
  baseDir: string,
  decayConfig: MemoryDecayConfig | undefined,
): Promise<DecayOnDoneResult> {
  // No config provided - skip
  if (!decayConfig) {
    return { ran: false, archivedCount: 0, skippedReason: SKIP_REASONS.NO_CONFIG };
  }

  // Decay disabled - skip
  if (!decayConfig.enabled) {
    return { ran: false, archivedCount: 0, skippedReason: SKIP_REASONS.DISABLED };
  }

  // Wrong trigger - skip
  if (decayConfig.trigger !== ON_DONE_TRIGGER) {
    return { ran: false, archivedCount: 0, skippedReason: SKIP_REASONS.TRIGGER_MISMATCH };
  }

  // Run decay archival with fail-open behavior
  try {
    const memoryDir = path.join(baseDir, LUMENFLOW_PATHS.MEMORY_DIR);
    const halfLifeMs = decayConfig.half_life_days * MS_PER_DAY;

    const result = await archiveByDecay(memoryDir, {
      threshold: decayConfig.threshold,
      halfLifeMs,
    });

    return {
      ran: true,
      archivedCount: result.archivedIds.length,
    };
  } catch (err) {
    // Fail-open: capture error but never throw
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      ran: false,
      archivedCount: 0,
      error: errorMessage,
    };
  }
}
