#!/usr/bin/env node
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
import { ProcessExitError } from '../error-handler.js';

async function main(): Promise<void> {
  const branch = process.argv[2] || null;
  const result = await isAgentBranch(branch);

  // Exit 0 = agent branch (truthy), Exit 1 = not agent branch
  // WU-1538: Throw ProcessExitError instead of calling process.exit directly
  throw new ProcessExitError(
    result ? 'Agent branch detected' : 'Not an agent branch',
    result ? 0 : 1,
  );
}

// Export main for testability (WU-1538)
export { main };

main().catch((error) => {
  if (error instanceof ProcessExitError) {
    process.exit(error.exitCode);
  }
  console.error('Error checking agent branch:', error.message);
  // Fail-closed: error = not allowed
  process.exit(1);
});
