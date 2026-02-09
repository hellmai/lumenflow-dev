import path from 'node:path';
import { getConfig } from '@lumenflow/core/config';

/**
 * Centralized path constants for Initiative management scripts.
 *
 * WU-1359: Updated to use getConfig().directories for config-aware paths.
 * This allows projects to use custom docs structures (e.g., simple vs arc42).
 *
 * Mirrors wu-paths.ts pattern. Single source of truth for all
 * initiative-related file paths.
 *
 * @example
 * import { INIT_PATHS } from './lib/initiative-paths.js';
 * const initPath = INIT_PATHS.INITIATIVE('INIT-001'); // path from config
 */
export const INIT_PATHS = {
  /**
   * Get path to Initiative YAML file
   * Uses getConfig().directories.initiativesDir for config-aware resolution.
   *
   * @param {string} id - Initiative ID (e.g., 'INIT-001')
   * @returns {string} Path to Initiative YAML file
   */
  INITIATIVE: (id: string): string => {
    const config = getConfig();
    return path.join(config.directories.initiativesDir, `${id}.yaml`);
  },

  /**
   * Get path to initiatives directory
   * Uses getConfig().directories.initiativesDir for config-aware resolution.
   *
   * @returns {string} Path to initiatives directory
   */
  INITIATIVES_DIR: (): string => {
    const config = getConfig();
    return config.directories.initiativesDir;
  },

  /**
   * Get path to WU directory (for scanning WUs by initiative)
   * Uses getConfig().directories.wuDir for config-aware resolution.
   *
   * @returns {string} Path to WU directory
   */
  WU_DIR: (): string => {
    const config = getConfig();
    return config.directories.wuDir;
  },
};
