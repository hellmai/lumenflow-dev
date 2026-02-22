// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file spawn-constraints-generator.ts
 * WU-2012: Extracted from wu-spawn.ts
 *
 * Generates the constraints block appended at the end of spawn prompts
 * per "Lost in the Middle" research. Also generates Codex-specific constraints.
 *
 * Single responsibility: Generate critical constraints and rules
 * that sub-agents must enforce during WU execution.
 *
 * @module spawn-constraints-generator
 */

import { SPAWN_END_SENTINEL } from './spawn-template-assembler.js';

/**
 * WU-1900: Options for constraints generation
 */
export interface ConstraintsOptions {
  /** Whether to include TDD CHECKPOINT (constraint 1). Default: true */
  includeTddCheckpoint?: boolean;
}

/**
 * Generate the constraints block (appended at end per Lost in the Middle research)
 *
 * WU-2247: Aligned with LumenFlow \u00a77.2 (stop-and-ask) and \u00a77.3 (anti-loop guard).
 * Includes item 6: MEMORY LAYER COORDINATION (WU-1589).
 *
 * WU-1900: TDD CHECKPOINT (constraint 1) is now conditional. It is omitted when:
 * - Work is classified as UI domain (smoke-test methodology)
 * - Policy methodology is 'none'
 *
 * @param {string} id - WU ID
 * @param {ConstraintsOptions} options - Options for conditional constraints
 * @returns {string} Constraints block
 */
export function generateConstraints(id: string, options?: ConstraintsOptions): string {
  const includeTdd = options?.includeTddCheckpoint !== false;

  const tddCheckpointBlock = includeTdd
    ? `
1. TDD CHECKPOINT (VERIFY BEFORE IMPLEMENTATION)
   - Did you write tests BEFORE implementation?
   - Is there at least one failing test for each acceptance criterion?
   - Never skip the RED phase \u2014 failing tests prove the test works

`
    : '';

  // Renumber constraints based on whether TDD is included
  const antiLoopNum = includeTdd ? 2 : 1;
  const stopAskNum = includeTdd ? 3 : 2;
  const verifyNum = includeTdd ? 4 : 3;
  const neverFabNum = includeTdd ? 5 : 4;
  const gitNum = includeTdd ? 6 : 5;
  const memNum = includeTdd ? 7 : 6;
  const skipGatesNum = includeTdd ? 8 : 7;
  const worktreeNum = includeTdd ? 9 : 8;

  return `---

<constraints>
CRITICAL RULES - ENFORCE BEFORE EVERY ACTION:
${tddCheckpointBlock}${antiLoopNum}. ANTI-LOOP GUARD (LumenFlow \u00a77.3)
   - Max 3 attempts per unique error before escalating
   - If same error repeats 3x, STOP and report with full context
   - Retry with different approach, not same command

${stopAskNum}. STOP-AND-ASK TRIGGERS (LumenFlow \u00a77.2 - narrow scope)
   - Policy changes, auth/permissions modifications
   - PII/safety issues, cloud spend, secrets, backups
   - Same error repeats 3x
   - For ordinary errors: fix and retry autonomously (up to 3 attempts)

${verifyNum}. VERIFY COMPLETION before reporting success
   - Run: node packages/@lumenflow/agent/verification ${id} (from shared checkout)
   - Exit 0 = passed, Exit 1 = INCOMPLETE
   - Never report "done" if verification fails

${neverFabNum}. NEVER FABRICATE COMPLETION
   - If blockers remain, report INCOMPLETE
   - If verification fails, summarize failures
   - Honesty over false completion

${gitNum}. GIT WORKFLOW (CRITICAL - GitHub rules reject merge commits)
   - GitHub REJECTS merge commits on main
   - ALWAYS use \`git rebase origin/main\` before push
   - Push to main via \`git push origin lane/...:main\` (fast-forward only)
   - NEVER use \`git merge\` on main branch
   - Use \`pnpm wu:prep\` from worktree, then \`pnpm wu:done\` from main (WU-1223)

${memNum}. MEMORY LAYER COORDINATION (INIT-007)
   - Use \`pnpm mem:checkpoint --wu ${id}\` to save progress before risky operations
   - Check \`pnpm mem:inbox --wu ${id}\` periodically for parallel signals from other agents
   - Checkpoint triggers (WU-1943): checkpoint after each acceptance criterion completed, checkpoint before gates, checkpoint every 30 tool calls

${skipGatesNum}. SKIP-GATES AUTONOMY (WU-1142)
   - If gates fail, first check if failure is pre-existing on main: \`git checkout main && pnpm gates\`
   - If failure exists on main (not your change), use: \`pnpm wu:done --id ${id} --skip-gates --reason "pre-existing on main" --fix-wu WU-XXXX\`
   - Do NOT ask for approval - autonomous skip-gates for pre-existing failures is correct
   - This prevents getting stuck on infrastructure debt

${worktreeNum}. WORKTREE DISCIPLINE (WU-1282)
   - CRITICAL: PreToolUse hooks do not propagate to sub-agents spawned via Task tool
   - BEFORE UnsafeAny Write/Edit operation, manually verify you are in a worktree:
   - Run: \`pwd\` and confirm output contains \`worktrees/\`
   - If not in worktree, STOP and navigate: \`cd worktrees/<lane>-wu-xxx\`
   - Use RELATIVE paths only (never full absolute paths starting with root directory)
   - This constraint exists because Claude Code does not inherit settings.json hooks in sub-agent sessions
</constraints>

${SPAWN_END_SENTINEL}`;
}

/**
 * Generate Codex-specific constraints (simplified version)
 *
 * @param {string} id - WU ID
 * @returns {string} Codex constraints section
 */
export function generateCodexConstraints(id: string): string {
  return `## Constraints (Critical)

1. **TDD checkpoint**: tests BEFORE implementation; never skip RED
2. **Stop on errors**: if UnsafeAny command fails, report BLOCKED (never DONE) with the error
3. **Verify before success**: run \`pnpm gates\` in the worktree, then run \`node packages/@lumenflow/agent/verification ${id}\` (from the shared checkout)
4. **No fabrication**: if blockers remain or verification fails, report INCOMPLETE
5. **Git workflow**: avoid merge commits; use \`wu:prep\` from worktree, then \`wu:done\` from main
6. **Scope discipline**: stay within \`code_paths\`; capture out-of-scope issues via \`pnpm mem:create\`
7. **Worktree discipline (WU-1282)**: BEFORE UnsafeAny Write/Edit, verify \`pwd\` shows \`worktrees/\`; hooks do not propagate to sub-agents`;
}
