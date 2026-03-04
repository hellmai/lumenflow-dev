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

import { BRANCHES, DIRECTORIES, REMOTES } from './wu-constants.js';
import { SPAWN_END_SENTINEL } from './spawn-template-assembler.js';

const DEFAULT_MAIN_REF = `${REMOTES.ORIGIN}/${BRANCHES.MAIN}`;
const DEFAULT_WORKTREES_DIR_SEGMENT = DIRECTORIES.WORKTREES.replace(/\/+$/g, '');

/**
 * WU-1900: Options for constraints generation
 */
export interface ConstraintsOptions {
  /** Whether to include TDD CHECKPOINT (constraint 1). Default: true */
  includeTddCheckpoint?: boolean;
  /** Main branch ref shown in git workflow guidance (default: origin/main) */
  mainRef?: string;
  /** Worktrees directory hint shown in worktree discipline guidance */
  worktreesDirSegment?: string;
}

function normalizeWorktreesDirSegment(value: string | undefined): string {
  const normalized = (value ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return normalized.length > 0 ? normalized : DEFAULT_WORKTREES_DIR_SEGMENT;
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
  const mainRef = options?.mainRef ?? DEFAULT_MAIN_REF;
  const worktreesDirSegment = normalizeWorktreesDirSegment(options?.worktreesDirSegment);

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
   - ALWAYS use \`git rebase ${mainRef}\` before push
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
   - Run: \`pwd\` and confirm output contains \`${worktreesDirSegment}/\`
   - If not in worktree, STOP and navigate: \`cd ${worktreesDirSegment}/<lane>-wu-xxx\`
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
export function generateCodexConstraints(id: string, options?: ConstraintsOptions): string {
  const includeTdd = options?.includeTddCheckpoint !== false;
  const worktreesDirSegment = normalizeWorktreesDirSegment(options?.worktreesDirSegment);
  const tddLine = includeTdd
    ? '1. **TDD checkpoint**: tests BEFORE implementation; never skip RED'
    : '';
  const stopNum = includeTdd ? 2 : 1;
  const verifyNum = includeTdd ? 3 : 2;
  const fabricateNum = includeTdd ? 4 : 3;
  const gitNum = includeTdd ? 5 : 4;
  const scopeNum = includeTdd ? 6 : 5;
  const worktreeNum = includeTdd ? 7 : 6;

  return `## Constraints (Critical)

${tddLine}${tddLine ? '\n' : ''}${stopNum}. **Stop on errors**: if UnsafeAny command fails, report BLOCKED (never DONE) with the error
${verifyNum}. **Verify before success**: run \`pnpm gates\` in the worktree, then run \`node packages/@lumenflow/agent/verification ${id}\` (from the shared checkout)
${fabricateNum}. **No fabrication**: if blockers remain or verification fails, report INCOMPLETE
${gitNum}. **Git workflow**: avoid merge commits; use \`wu:prep\` from worktree, then \`wu:done\` from main
${scopeNum}. **Scope discipline**: stay within \`code_paths\`; capture out-of-scope issues via \`pnpm mem:create\`
${worktreeNum}. **Worktree discipline (WU-1282)**: BEFORE UnsafeAny Write/Edit, verify \`pwd\` shows \`${worktreesDirSegment}/\`; hooks do not propagate to sub-agents`;
}
