#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CLI helper for bash hooks to check if branch is an agent branch.
 * Uses the same isAgentBranch() logic as TypeScript code.
 *
 * Now async to support registry pattern lookup with fetch + cache.
 *
 * Usage: node dist/cli/is-agent-branch.js [branch-name]
 * Exit codes: 0 = agent branch (allowed), 1 = not agent branch (protected)
 *
 * @module cli/is-agent-branch
 */

import { isAgentBranch } from '../branch-check.js';
import { EXIT_CODES } from '../wu-constants.js';
import { ProcessExitError, getErrorMessage } from '../error-handler.js';

const BRANCH_ARG_INDEX = 2;
const AGENT_BRANCH_DETECTED_MESSAGE = 'Agent branch detected';
const NOT_AGENT_BRANCH_MESSAGE = 'Not an agent branch';
export const AGENT_BRANCH_CHECK_FAILURE_MESSAGE = 'Error checking agent branch:';

async function main(): Promise<void> {
  const branch = process.argv[BRANCH_ARG_INDEX] || null;
  const result = await isAgentBranch(branch);

  // Exit 0 = agent branch (truthy), Exit 1 = not agent branch
  // WU-1538: Throw ProcessExitError instead of calling process.exit directly
  throw new ProcessExitError(
    result ? AGENT_BRANCH_DETECTED_MESSAGE : NOT_AGENT_BRANCH_MESSAGE,
    result ? EXIT_CODES.SUCCESS : EXIT_CODES.ERROR,
  );
}

// Export main for testability (WU-1538)
export { main };

export interface IsAgentBranchCliDeps {
  runMain: () => Promise<void>;
  setExitCode: (exitCode: number) => void;
  logError: (...args: unknown[]) => void;
}

const DEFAULT_IS_AGENT_BRANCH_CLI_DEPS: IsAgentBranchCliDeps = {
  runMain: main,
  setExitCode: (exitCode) => {
    process.exitCode = exitCode;
  },
  logError: console.error,
};

export async function runIsAgentBranchCli(
  deps: IsAgentBranchCliDeps = DEFAULT_IS_AGENT_BRANCH_CLI_DEPS,
): Promise<void> {
  try {
    await deps.runMain();
  } catch (error) {
    if (error instanceof ProcessExitError) {
      deps.setExitCode(error.exitCode);
      return;
    }

    deps.logError(AGENT_BRANCH_CHECK_FAILURE_MESSAGE, getErrorMessage(error));
    // Fail-closed: error = not allowed
    deps.setExitCode(EXIT_CODES.ERROR);
  }
}

if (import.meta.main) {
  void runIsAgentBranchCli();
}
