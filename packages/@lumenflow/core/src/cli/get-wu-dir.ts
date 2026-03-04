#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CLI helper for bash hooks and scripts to resolve the configured wuDir.
 * Single source of truth — reads workspace.yaml via getConfig().
 *
 * Usage: node dist/cli/get-wu-dir.js [project-root]
 * Outputs: the configured wuDir path (relative, e.g. "docs/04-operations/tasks/wu")
 * Exit codes: 0 = success (wuDir on stdout), 1 = error (nothing on stdout)
 *
 * WU-2310: Created to eliminate hardcoded wuDir paths in shell hooks and scripts.
 *
 * @module cli/get-wu-dir
 */

import { getConfig } from '../lumenflow-config.js';
import { EXIT_CODES } from '../wu-constants.js';
import { ProcessExitError, getErrorMessage } from '../error-handler.js';

const PROJECT_ROOT_ARG_INDEX = 2;

export function getWuDirFromConfig(projectRoot?: string): string {
  const config = getConfig(projectRoot ? { projectRoot } : {});
  return config.directories.wuDir;
}

function main(): void {
  const projectRoot = process.argv[PROJECT_ROOT_ARG_INDEX] || undefined;
  const wuDir = getWuDirFromConfig(projectRoot);
  process.stdout.write(wuDir);
  process.exitCode = EXIT_CODES.SUCCESS;
}

export { main };

export interface GetWuDirCliDeps {
  runMain: () => void;
  setExitCode: (exitCode: number) => void;
  logError: (...args: unknown[]) => void;
}

const DEFAULT_DEPS: GetWuDirCliDeps = {
  runMain: main,
  setExitCode: (exitCode) => {
    process.exitCode = exitCode;
  },
  logError: console.error,
};

export function runGetWuDirCli(deps: GetWuDirCliDeps = DEFAULT_DEPS): void {
  try {
    deps.runMain();
  } catch (error) {
    if (error instanceof ProcessExitError) {
      deps.setExitCode(error.exitCode);
      return;
    }
    deps.logError('Error resolving wuDir:', getErrorMessage(error));
    deps.setExitCode(EXIT_CODES.ERROR);
  }
}

if (import.meta.main) {
  runGetWuDirCli();
}
