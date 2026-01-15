/**
 * Linter Configuration Constants
 *
 * Centralizes magic numbers for spec-linter and related validation tools.
 * Used by packages/linters/spec-linter.mjs.
 */

/** Spec linter configuration */
export const LINTER_CONFIG = {
  /** Watchdog timeout for long-running linter operations (ms) */
  WATCHDOG_TIMEOUT_MS: 55000,

  /**
   * Maximum allowed glass surfaces in UI components.
   * Per Beacon spec glass cap artifacts rule.
   */
  MAX_GLASS_SURFACES: 6,
};
