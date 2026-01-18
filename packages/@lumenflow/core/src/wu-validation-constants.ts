/**
 * WU Validation Constants (WU-1243)
 *
 * Centralizes magic numbers for lane inference and incident validation.
 * Extracted from lane-inference.mjs and agent-incidents.mjs for DRY compliance.
 *
 * @module wu-validation-constants
 */

/**
 * Lane inference scoring weights.
 * Code path matches are weighted higher than keywords because
 * file paths are more reliable signals for lane classification.
 *
 * The 10:3 ratio (~3.3x) reflects that a code path match is approximately
 * 3x more indicative of the correct lane than a keyword match.
 */
export const WEIGHTS = {
  /** Weight for code path pattern matches (more reliable signal) */
  CODE_PATH_MATCH: 10,
  /** Weight for keyword matches in description (less specific signal) */
  KEYWORD_MATCH: 3,
};

/**
 * Confidence score configuration for lane inference.
 *
 * WU-2438: Changed from percentage-based (0-100) to absolute scoring.
 * Raw scores (sum of WEIGHTS) are now returned directly.
 * Higher score = better match, regardless of config size.
 */
export const CONFIDENCE = {
  /** Minimum confidence value (no matches) */
  MIN: 0,
  /** Maximum confidence value (legacy, kept for backward compatibility) */
  MAX: 100,
  /**
   * Minimum confidence threshold to return a suggestion.
   * Set to 0 to always return best match (even low confidence).
   * Note: With absolute scoring, this threshold is compared against raw scores.
   */
  THRESHOLD: 0,
};

/**
 * String length validation limits for incident logging.
 * Prevents abuse while allowing meaningful content.
 */
export const VALIDATION_LIMITS = {
  /** Minimum title length (prevents truncated/empty titles) */
  TITLE_MIN: 5,
  /** Maximum title length (keeps logs readable) */
  TITLE_MAX: 100,
  /** Minimum description length (prevents one-liners) */
  DESCRIPTION_MIN: 10,
  /** Maximum description length (prevents unbounded logging) */
  DESCRIPTION_MAX: 2000,
};

/**
 * Valid incident categories for agent issue logging.
 * Duplicated from agent-incidents.mjs z.enum for use in default arrays.
 */
export const INCIDENT_CATEGORIES = [
  'workflow',
  'tooling',
  'confusion',
  'violation',
  'error',
] as const;
