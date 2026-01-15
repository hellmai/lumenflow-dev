/**
 * WU-2278: Cleanup Install Configuration
 *
 * Provides configuration for pnpm install during wu:done cleanup.
 * - 60 second timeout to prevent indefinite hangs
 * - CI=true for non-interactive mode
 * - frozen-lockfile to prevent lockfile mutations
 *
 * @module cleanup-install-config
 */

import { PKG_MANAGER, PKG_COMMANDS, PKG_FLAGS } from './wu-constants.js';

/**
 * Timeout for cleanup install operation (ms)
 * @constant {number}
 */
export const CLEANUP_INSTALL_TIMEOUT_MS = 60000; // 60 seconds

/**
 * Get configuration for cleanup pnpm install
 *
 * Returns command and options suitable for execAsync:
 * - CI=true environment variable for non-interactive mode
 * - 60 second timeout to prevent hangs
 * - frozen-lockfile flag to prevent mutations
 *
 * @returns {{ command: string, timeout: number, env: object }}
 */
export function getCleanupInstallConfig() {
  const command = `${PKG_MANAGER} ${PKG_COMMANDS.INSTALL} ${PKG_FLAGS.FROZEN_LOCKFILE}`;

  return {
    command,
    timeout: CLEANUP_INSTALL_TIMEOUT_MS,
    env: {
      ...process.env,
      CI: 'true', // Non-interactive mode
    },
  };
}
