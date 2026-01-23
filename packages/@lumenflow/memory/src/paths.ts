/**
 * Memory Package Path Constants
 *
 * Defines paths used by the memory layer locally to avoid circular
 * dependencies with @lumenflow/core (which imports from memory).
 *
 * These values MUST match LUMENFLOW_PATHS in @lumenflow/core/wu-constants.ts.
 * When updating paths, update both locations.
 *
 * @see {@link packages/@lumenflow/core/src/wu-constants.ts} - Source of truth
 */

/**
 * Path constants for LumenFlow memory layer.
 * Duplicated here to avoid circular dependency with @lumenflow/core.
 *
 * Note: Named LUMENFLOW_MEMORY_PATHS to avoid conflict with
 * MEMORY_PATHS exported from mem-init-core.ts
 */
export const LUMENFLOW_MEMORY_PATHS = {
  /** Base directory for all LumenFlow runtime data */
  BASE: '.lumenflow',

  /** WU state store directory */
  STATE_DIR: '.lumenflow/state',

  /** Memory layer directory */
  MEMORY_DIR: '.lumenflow/memory',

  /** Current session file */
  SESSION_CURRENT: '.lumenflow/sessions/current.json',
} as const;
