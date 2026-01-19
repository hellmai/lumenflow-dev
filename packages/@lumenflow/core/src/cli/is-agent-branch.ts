#!/usr/bin/env node
/**
 * CLI helper for bash hooks to check if branch is an agent branch.
 * Uses the same isAgentBranch() logic as TypeScript code.
 *
 * Usage: node dist/cli/is-agent-branch.js [branch-name]
 * Exit codes: 0 = agent branch (allowed), 1 = not agent branch (protected)
 *
 * @module cli/is-agent-branch
 */

import { isAgentBranch } from '../branch-check.js';

const branch = process.argv[2] || null;
const result = isAgentBranch(branch);

// Exit 0 = agent branch (truthy), Exit 1 = not agent branch
process.exit(result ? 0 : 1);
