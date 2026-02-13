/**
 * Shared utilities and constants for initiative orchestration.
 *
 * Contains helpers and constants used across multiple orchestration domain modules.
 *
 * @module orchestrator/shared
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Wave manifest directory path (gitignored).
 */
export const WAVE_MANIFEST_DIR = '.lumenflow/artifacts/waves';

/**
 * Stamps directory path.
 */
export const STAMPS_DIR = '.lumenflow/stamps';

/**
 * Log prefix for orchestrator messages.
 */
export const LOG_PREFIX = '[orchestrate:initiative]';

/**
 * Default reason string for deferred WUs when no specific reason is provided.
 * Extracted to constant to avoid sonarjs/no-duplicate-string lint warnings.
 */
export const DEFAULT_DEFERRED_REASON = 'waiting for dependencies';

/**
 * Check if a stamp file exists for a WU.
 *
 * @param {string} wuId - WU ID (e.g., 'WU-001')
 * @returns {boolean} True if stamp exists
 */
export function hasStamp(wuId: string): boolean {
  const stampPath = join(STAMPS_DIR, `${wuId}.done`);
  return existsSync(stampPath);
}

/**
 * WU-1251: Helper to get all dependencies from a WU doc.
 *
 * Combines both `blocked_by` and `dependencies` arrays for dependency resolution.
 * The WU YAML schema supports both:
 * - `blocked_by`: Legacy/explicit blockers
 * - `dependencies`: Semantic dependencies on other WUs
 *
 * Both arrays represent the same concept: WUs that must complete before this WU can start.
 *
 * @param {object} doc - WU document
 * @returns {string[]} Combined list of all dependency WU IDs (deduplicated)
 */
export function getAllDependencies(doc: {
  blocked_by?: string[];
  dependencies?: string[];
}): string[] {
  const blockedBy = doc.blocked_by ?? [];
  const dependencies = doc.dependencies ?? [];

  // Combine and deduplicate
  const allDeps = new Set([...blockedBy, ...dependencies]);
  return Array.from(allDeps);
}
