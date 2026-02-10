/**
 * Centralized constants for Initiative management scripts.
 *
 * Mirrors wu-constants.ts pattern. Single source of truth for all
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
export const INIT_STATUSES = ['draft', 'open', 'in_progress', 'done', 'archived'] as const;

/**
 * Phase statuses (matches InitiativePhaseSchema)
 */
export const PHASE_STATUSES = ['pending', 'in_progress', 'done', 'blocked'] as const;

/**
 * Priority levels (matches WU priority)
 */
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;

/**
 * Regex patterns for initiative validation
 */
export const INIT_PATTERNS = {
  /** Initiative ID format (INIT-NNN where NNN is digits or INIT-NAME for named initiatives) */
  INIT_ID: /^INIT-[\dA-Z][\dA-Z-]*$/,

  /** Extract INIT ID from string */
  INIT_ID_EXTRACT: /INIT-[\dA-Z][\dA-Z-]*/,

  /** Kebab-case slug format */
  // eslint-disable-next-line security/detect-unsafe-regex -- static slug pattern; no backtracking risk
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
   * @param id - Initiative ID
   * @param title - Initiative title
   * @returns Commit message
   */
  CREATE: (id: string, title: string): string => {
    const shortTitle = title.length > 50 ? `${title.substring(0, 47)}...` : title;
    return `docs: create ${id.toLowerCase()} for ${shortTitle.toLowerCase()}`;
  },

  /**
   * Update initiative commit message
   * @param id - Initiative ID
   * @returns Commit message
   */
  UPDATE: (id: string): string => `docs: update ${id.toLowerCase()}`,

  /**
   * Link WU to initiative commit message
   * @param wuId - WU ID
   * @param initId - Initiative ID
   * @returns Commit message
   */
  LINK_WU: (wuId: string, initId: string): string =>
    `docs: link ${wuId.toLowerCase()} to ${initId.toLowerCase()}`,

  /**
   * Unlink WU from initiative commit message (WU-1328)
   * @param wuId - WU ID
   * @param initId - Initiative ID
   * @returns Commit message
   */
  UNLINK_WU: (wuId: string, initId: string): string =>
    `docs: unlink ${wuId.toLowerCase()} from ${initId.toLowerCase()}`,

  /**
   * Edit initiative commit message (WU-1451)
   * @param id - Initiative ID
   * @returns Commit message
   */
  EDIT: (id: string): string => `docs: edit ${id.toLowerCase()}`,
};

/**
 * Log prefixes for initiative scripts (auto-detected by die() but useful for info logs)
 */
export const INIT_LOG_PREFIX = {
  CREATE: '[initiative:create]',
  LIST: '[initiative:list]',
  STATUS: '[initiative:status]',
  ADD_WU: '[initiative:add-wu]',
  REMOVE_WU: '[initiative:remove-wu]', // WU-1328: Remove WU from initiative
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
