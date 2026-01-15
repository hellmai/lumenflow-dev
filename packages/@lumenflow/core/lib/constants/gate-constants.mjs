/**
 * Gate Configuration Constants
 *
 * Centralizes magic numbers for pre-commit and local gates.
 * Used by gates-pre-commit.mjs and gates-local.mjs.
 */

/** Gate execution configuration */
export const GATE_CONFIG = {
  /** Maximum execution time per gate step (ms) */
  TIMEOUT_MS: 180000,

  /** Maximum file size allowed in commits (bytes) - 5MB */
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024,

  /** Total number of gates (for progress display) */
  TOTAL_GATES: 14,
};
