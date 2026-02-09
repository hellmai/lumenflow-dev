#!/usr/bin/env node
/**
 * @file guard-worktree-commit.ts
 * @description Guard that prevents WU commits from main checkout (WU-1111)
 *
 * Validates that WU-related commits are only made from worktrees, not main.
 * Used by git commit-msg hooks to enforce worktree discipline.
 *
 * Usage:
 *   guard-worktree-commit "commit message"
 *   guard-worktree-commit --message "commit message"
 *
 * Exit codes:
 *   0 - Commit allowed
 *   1 - Commit blocked (WU commit from main)
 *
 * @see {@link docs/04-operations/_frameworks/lumenflow/lumenflow-complete.md} - Worktree discipline
 */

import { isInWorktree, isMainBranch } from '@lumenflow/core/core/worktree-guard';
import { runCLI } from './cli-entry-point.js';

const LOG_PREFIX = '[guard-worktree-commit]';

/**
 * Patterns that indicate a WU-related commit message
 */
const WU_COMMIT_PATTERNS = [
  /^wu\(/i, // wu(WU-123): message
  /\(wu-\d+\)/i, // feat(WU-123): message
  /\(WU-\d+\)/i, // Same with uppercase
  /^WU-\d+:/i, // WU-123: message
  /^wu-\d+:/i, // wu-123: message
];

/**
 * Result of commit block check
 */
export interface CommitBlockResult {
  /** Whether the commit should be blocked */
  blocked: boolean;
  /** Reason for blocking (if blocked) */
  reason?: string;
}

/**
 * Check if a commit should be blocked
 *
 * @param options - Check options
 * @param options.commitMessage - The commit message
 * @param options.isMainCheckout - Whether in main checkout
 * @param options.isInWorktree - Whether in a worktree
 * @returns Whether commit should be blocked and why
 *
 * @example
 * const result = shouldBlockCommit({
 *   commitMessage: 'wu(WU-123): add feature',
 *   isMainCheckout: true,
 *   isInWorktree: false,
 * });
 * if (result.blocked) {
 *   console.error(result.reason);
 *   process.exit(1);
 * }
 */
export function shouldBlockCommit(options: {
  commitMessage: string;
  isMainCheckout: boolean;
  isInWorktree: boolean;
}): CommitBlockResult {
  const { commitMessage, isMainCheckout, isInWorktree } = options;

  // Allow all commits from worktrees
  if (isInWorktree) {
    return { blocked: false };
  }

  // Check if commit message indicates WU work
  const isWUCommit = WU_COMMIT_PATTERNS.some((pattern) => pattern.test(commitMessage));

  // Block WU commits from main checkout
  if (isWUCommit && isMainCheckout) {
    return {
      blocked: true,
      reason: `${LOG_PREFIX} BLOCKED: WU commits must be made from a worktree.

You are attempting to commit WU work from the main checkout.

To fix:
  1. Navigate to your worktree:
     cd worktrees/<lane>-wu-xxx/

  2. Make your commit there:
     git add . && git commit -m "${commitMessage}"

  3. Complete the WU from main:
     cd ../.. && pnpm wu:done --id WU-XXX

For more information:
  See docs/04-operations/_frameworks/lumenflow/lumenflow-complete.md
  See .claude/skills/worktree-discipline/SKILL.md
`,
    };
  }

  // Allow non-WU commits from anywhere
  return { blocked: false };
}

/**
 * Check if a commit message is WU-related
 *
 * @param message - Commit message to check
 * @returns true if message indicates WU work
 */
export function isWUCommitMessage(message: string): boolean {
  return WU_COMMIT_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  let commitMessage: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--message' || arg === '-m') {
      commitMessage = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: guard-worktree-commit [--message] "commit message"

Check if a WU commit should be blocked from main checkout.

Options:
  --message, -m MSG  Commit message to check
  -h, --help         Show this help message

Examples:
  guard-worktree-commit "wu(WU-123): add feature"
  guard-worktree-commit --message "chore: update deps"
`);
      process.exit(0);
    } else if (!commitMessage) {
      commitMessage = arg;
    }
  }

  if (!commitMessage) {
    console.error(`${LOG_PREFIX} Error: Commit message required`);
    console.error('Usage: guard-worktree-commit [--message] "commit message"');
    process.exit(1);
  }

  // Check context
  const inWorktree = isInWorktree();
  let onMain = false;

  try {
    onMain = await isMainBranch();
  } catch {
    // If we can't determine branch, be conservative and allow
    onMain = false;
  }

  const result = shouldBlockCommit({
    commitMessage,
    isMainCheckout: onMain && !inWorktree,
    isInWorktree: inWorktree,
  });

  if (result.blocked) {
    console.error(result.reason);
    process.exit(1);
  }

  console.log(`${LOG_PREFIX} Commit allowed`);
  process.exit(0);
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  runCLI(main);
}
