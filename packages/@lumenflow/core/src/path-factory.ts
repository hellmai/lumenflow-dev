// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PathFactory - Shared path resolution for all packages
 *
 * WU-2124: Consolidates 3 independent path resolution patterns into a single
 * factory with a consistent API:
 * (1) direct __dirname-relative paths (prompt-monitor, prompt-linter, commands-logger)
 * (2) ILocationResolver.resolveRoot() adapter calls
 * (3) inline resolve(__dirname, '../..') patterns
 *
 * Usage:
 * ```ts
 * import { createPathFactory } from './path-factory.js';
 *
 * const paths = createPathFactory({ projectRoot: '/repo' });
 * paths.resolve('.lumenflow/commands.log'); // => '/repo/.lumenflow/commands.log'
 * paths.resolveLumenflowPath('COMMANDS_LOG'); // => '/repo/.lumenflow/commands.log'
 * paths.projectRoot; // => '/repo'
 * ```
 *
 * @module path-factory
 */

import * as path from 'node:path';
import { LUMENFLOW_PATHS } from './wu-paths-constants.js';
import { getProjectRoot as getProjectRootFromConfig } from './lumenflow-config.js';

/**
 * Valid keys for LUMENFLOW_PATHS constant lookups.
 */
export type LumenflowPathKey = keyof typeof LUMENFLOW_PATHS;

/**
 * PathFactory interface: consistent API for resolving project-relative paths.
 */
export interface PathFactory {
  /** Absolute path to the project root directory. */
  readonly projectRoot: string;

  /**
   * Resolve a relative path against projectRoot.
   *
   * If the path is already absolute, it is returned unchanged.
   * If the path is empty, projectRoot is returned.
   *
   * @param relativePath - Path relative to project root
   * @returns Absolute path
   */
  resolve(relativePath: string): string;

  /**
   * Resolve a LUMENFLOW_PATHS constant to an absolute path.
   *
   * @param key - A key from LUMENFLOW_PATHS (e.g., 'COMMANDS_LOG', 'TELEMETRY')
   * @returns Absolute path
   * @throws Error if key is not a valid LUMENFLOW_PATHS key
   */
  resolveLumenflowPath(key: LumenflowPathKey): string;
}

/**
 * Options for creating a PathFactory.
 */
export interface PathFactoryOptions {
  /**
   * Override project root directory.
   * If omitted, uses config-based project root discovery.
   */
  projectRoot?: string;
}

/**
 * Create a PathFactory instance.
 *
 * Consolidates path resolution into one testable boundary.
 * Replaces:
 * - `resolve(__dirname, '../..')` in prompt-monitor.ts, prompt-linter.ts, commands-logger.ts
 * - `getProjectRoot(import.meta.url)` from wu-domain-constants.ts
 * - `resolveFromProjectRoot(relativePath)` from wu-paths.ts
 *
 * @param options - Configuration options
 * @returns PathFactory instance
 */
export function createPathFactory(options: PathFactoryOptions = {}): PathFactory {
  const projectRoot = options.projectRoot ?? getProjectRootFromConfig();

  return {
    get projectRoot(): string {
      return projectRoot;
    },

    resolve(relativePath: string): string {
      if (!relativePath) {
        return projectRoot;
      }
      if (path.isAbsolute(relativePath)) {
        return relativePath;
      }
      return path.join(projectRoot, relativePath);
    },

    resolveLumenflowPath(key: LumenflowPathKey): string {
      const relativePath = LUMENFLOW_PATHS[key];
      if (relativePath === undefined) {
        throw new Error(`Unknown LUMENFLOW_PATHS key: ${String(key)}`);
      }
      return path.join(projectRoot, String(relativePath));
    },
  };
}
