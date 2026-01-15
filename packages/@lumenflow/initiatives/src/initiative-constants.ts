/**
 * Centralized constants for Initiative management scripts.
 *
 * Mirrors wu-constants.mjs pattern. Single source of truth for all
 * initiative-related magic strings, patterns, and enums.
 *
 * @example
 * import { INIT_PATTERNS, INIT_LOG_PREFIX } from './lib/initiative-constants.js';
 * if (!INIT_PATTERNS.INIT_ID.test(id)) die('Invalid ID');
 * console.log(`${INIT_LOG_PREFIX.CREATE} Created initiative`);
 */

/**
 * Initiative lifecycle statuses (matches InitiativeSchema)
 */
export const INIT_STATUSES = ['draft', 'open', 'in_progress', 'done', 'archived'];

/**
 * Phase statuses (matches InitiativePhaseSchema)
 */
export const PHASE_STATUSES = ['pending', 'in_progress', 'done', 'blocked'];

/**
 * Priority levels (matches WU priority)
 */
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];

/**
 * Regex patterns for initiative validation
 */
export const INIT_PATTERNS = {
  /** Initiative ID format (INIT-NNN where NNN is digits or INIT-NAME for named initiatives) */
  INIT_ID: /^INIT-[\dA-Z][\dA-Z-]*$/,

  /** Extract INIT ID from string */
  INIT_ID_EXTRACT: /INIT-[\dA-Z][\dA-Z-]*/,

  /** Kebab-case slug format */
  SLUG: /^[a-z0-9]+(-[a-z0-9]+)*$/,

  /** Date format (YYYY-MM-DD) */
  DATE: /^\d{4}-\d{2}-\d{2}$/,
};

/**
 * Patterns for matching initiative commit messages (used by guards)
 * Co-located with INIT_COMMIT_FORMATS to ensure they stay in sync
 */
export const INIT_COMMIT_PATTERNS = {
  /** Matches initiative create commits: "docs: create init-<id> for <title>" */
  CREATE: /^docs: create init-\d+ for .+$/i,
};

/**
 * Commit message formats for initiative operations
 */
export const INIT_COMMIT_FORMATS = {
  /**
   * Create initiative commit message
   * @param {string} id - Initiative ID
   * @param {string} title - Initiative title
   * @returns {string} Commit message
   */
  CREATE: (id, title) => {
    const shortTitle = title.length > 50 ? `${title.substring(0, 47)}...` : title;
    return `docs: create ${id.toLowerCase()} for ${shortTitle.toLowerCase()}`;
  },

  /**
   * Update initiative commit message
   * @param {string} id - Initiative ID
   * @returns {string} Commit message
   */
  UPDATE: (id) => `docs: update ${id.toLowerCase()}`,

  /**
   * Link WU to initiative commit message
   * @param {string} wuId - WU ID
   * @param {string} initId - Initiative ID
   * @returns {string} Commit message
   */
  LINK_WU: (wuId, initId) => `docs: link ${wuId.toLowerCase()} to ${initId.toLowerCase()}`,

  /**
   * Edit initiative commit message (WU-1451)
   * @param {string} id - Initiative ID
   * @returns {string} Commit message
   */
  EDIT: (id) => `docs: edit ${id.toLowerCase()}`,
};

/**
 * Log prefixes for initiative scripts (auto-detected by die() but useful for info logs)
 */
export const INIT_LOG_PREFIX = {
  CREATE: '[initiative:create]',
  LIST: '[initiative:list]',
  STATUS: '[initiative:status]',
  ADD_WU: '[initiative:add-wu]',
  EDIT: '[initiative:edit]', // WU-1451: Initiative edit operation
};

/**
 * Default values for initiative creation
 */
export const INIT_DEFAULTS = {
  STATUS: 'draft',
  PRIORITY: 'P2',
};

/**
 * Output format options
 */
export const OUTPUT_FORMATS = {
  TABLE: 'table',
  JSON: 'json',
  ASCII: 'ascii',
  MERMAID: 'mermaid',
};
