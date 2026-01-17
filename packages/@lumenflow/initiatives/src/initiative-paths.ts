import path from 'node:path';

/**
 * Centralized path constants for Initiative management scripts.
 *
 * Mirrors wu-paths.mjs pattern. Single source of truth for all
 * initiative-related file paths.
 *
 * @example
 * import { INIT_PATHS } from './lib/initiative-paths.js';
 * const initPath = INIT_PATHS.INITIATIVE('INIT-001'); // 'docs/04-operations/tasks/initiatives/INIT-001.yaml'
 */
export const INIT_PATHS = {
  /**
   * Get path to Initiative YAML file
   * @param {string} id - Initiative ID (e.g., 'INIT-001')
   * @returns {string} Path to Initiative YAML file
   */
  INITIATIVE: (id: string) => path.join('docs', '04-operations', 'tasks', 'initiatives', `${id}.yaml`),

  /**
   * Get path to initiatives directory
   * @returns {string} Path to initiatives directory
   */
  INITIATIVES_DIR: () => path.join('docs', '04-operations', 'tasks', 'initiatives'),

  /**
   * Get path to WU directory (for scanning WUs by initiative)
   * @returns {string} Path to WU directory
   */
  WU_DIR: () => path.join('docs', '04-operations', 'tasks', 'wu'),
};
