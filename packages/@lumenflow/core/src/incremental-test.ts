// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file incremental-test.ts
 * @description Helpers for Vitest --changed execution
 *
 * WU-1920: Add incremental test execution to gates
 * WU-2504: Use Vitest --changed instead of custom file diff logic
 */

import { GIT_REFS } from './wu-constants.js';

/**
 * Glob patterns to exclude slow integration/golden tests from changed runs.
 * @type {string[]}
 */
export const VITEST_CHANGED_EXCLUDES = Object.freeze(['**/*.integration.*', '**/golden-*.test.*']);

/**
 * File extensions considered executable code for test runs.
 * @type {string[]}
 */
export const CODE_FILE_EXTENSIONS = Object.freeze([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.js',
  '.cjs',
  '.mts',
  '.cts',
]);

/**
 * Check if a path points to a code file that should trigger full tests.
 *
 * @param {string} filePath - Path to check
 * @returns {boolean} True if the path has a code extension
 */
export function isCodeFilePath(filePath: string) {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }

  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return CODE_FILE_EXTENSIONS.some((ext) => normalized.endsWith(ext));
}

/**
 * Options for building Vitest changed args
 */
interface BuildVitestChangedArgsOptions {
  /** Base branch for diff */
  baseBranch?: string;
}

/**
 * Build Vitest CLI args for --changed runs.
 *
 * @param {BuildVitestChangedArgsOptions} [options]
 * @returns {string[]} Vitest args for changed test runs
 */
export function buildVitestChangedArgs(options: BuildVitestChangedArgsOptions = {}) {
  const { baseBranch = GIT_REFS.ORIGIN_MAIN } = options;
  const args = [
    '--changed',
    baseBranch,
    '--run',
    '--passWithNoTests',
    '--maxWorkers=1',
    '--teardownTimeout=30000',
  ];

  for (const pattern of VITEST_CHANGED_EXCLUDES) {
    args.push(`--exclude='${pattern}'`);
  }

  return args;
}
