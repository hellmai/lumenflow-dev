/**
 * WU spawn status checking for initiative orchestration.
 *
 * Provides functions to determine if WUs have been actually spawned (agent launched)
 * vs just queued in wave manifests.
 *
 * @module orchestrator/spawn-status
 */

import { existsSync, readFileSync } from 'node:fs';
import type { WUEntry } from '../initiative-yaml.js';
import { WU_STATUS } from '@lumenflow/core/wu-constants';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { parseYAML } from '@lumenflow/core/wu-yaml';

/**
 * WU-1200: Wave manifest WU status constant.
 *
 * Changed from 'spawned' to 'queued' to prevent confusion.
 * 'spawned' implies an agent was launched, but the manifest is written
 * BEFORE an agent is actually invoked (when the prompt is output, not when
 * the user copies and executes it).
 *
 * Using 'queued' makes it clear the WU is ready to be spawned but not yet running.
 */
const MANIFEST_WU_STATUS = 'queued';

/**
 * WU-1200: Get the status string used in wave manifests for WUs.
 *
 * Returns 'queued' instead of 'spawned' to prevent confusion.
 * A WU is 'queued' in the manifest when the spawn prompt is output,
 * but it's not actually 'spawned' until an agent claims it.
 *
 * @returns {string} The manifest WU status ('queued')
 */
export function getManifestWUStatus(): string {
  return MANIFEST_WU_STATUS;
}

/**
 * WU-1200: Check if a WU has actually been spawned (agent launched).
 *
 * This checks the WU YAML status, not the wave manifest. A WU is considered
 * "actually spawned" only if:
 * - Its YAML status is 'in_progress' (agent has claimed it)
 * - OR its YAML status is 'done' (agent has completed it)
 *
 * Wave manifests can have stale 'spawned' statuses from previous runs where
 * the prompt was output but no agent was ever invoked. This function provides
 * the authoritative check based on YAML status.
 *
 * @param {string} wuId - WU ID (e.g., 'WU-001')
 * @returns {boolean} True if the WU is actually in progress or done
 */
export function isWUActuallySpawned(wuId: string): boolean {
  const wuPath = WU_PATHS.WU(wuId);

  if (!existsSync(wuPath)) {
    // WU file not found - can't determine status, assume not spawned
    return false;
  }

  try {
    const text = readFileSync(wuPath, 'utf8');
    const doc = parseYAML(text);
    const status = doc.status ?? 'unknown';

    // WU is "actually spawned" if status indicates active or completed work
    return status === WU_STATUS.IN_PROGRESS || status === WU_STATUS.DONE;
  } catch {
    // Error reading/parsing WU file - assume not spawned
    return false;
  }
}

/**
 * WU-1200: Get spawn candidates with YAML status verification.
 *
 * Filters WUs to find candidates that can be spawned, checking YAML status
 * instead of relying solely on wave manifests. This prevents stale manifests
 * from blocking new orchestration runs.
 *
 * A WU is a spawn candidate if:
 * - Its YAML status is 'ready' (not in_progress, done, blocked, etc.)
 * - It's in the provided WU list (part of the initiative)
 *
 * This function ignores wave manifest status because:
 * - Manifests can be stale (prompt output but agent never launched)
 * - YAML status is the authoritative source of truth
 *
 * @param {string} _initId - Initiative ID (for logging/context, not used for filtering)
 * @param {Array<{id: string, doc: object}>} wus - WUs to filter
 * @returns {Array<{id: string, doc: object}>} WUs that can be spawned
 */
export function getSpawnCandidatesWithYAMLCheck(_initId: string, wus: WUEntry[]): WUEntry[] {
  // Filter to only 'ready' status WUs based on YAML, not manifest
  return wus.filter((wu) => {
    const status = wu.doc.status ?? 'unknown';
    return status === WU_STATUS.READY;
  });
}
