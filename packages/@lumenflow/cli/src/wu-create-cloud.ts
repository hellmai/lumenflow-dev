/**
 * @file wu-create-cloud.ts
 * @description Cloud mode helpers for wu:create command
 *
 * WU-1590 AC1: Provides context builder for --cloud create path that
 * writes and commits WU specs on the current branch without ensureOnMain
 * or micro-worktree main updates.
 *
 * Cloud agents (Codex, Claude web, CI bots) operate from existing feature
 * branches. This module extracts the decision logic for skipping main-canonical
 * operations when --cloud is active.
 */

/**
 * Input for building cloud create context
 */
export interface CloudCreateInput {
  /** Whether --cloud flag is active */
  cloud: boolean;
  /** Current git branch name */
  currentBranch: string;
}

/**
 * Context object used by wu:create to decide cloud vs standard path
 */
export interface CloudCreateContext {
  /** Whether cloud mode is active */
  isCloud: boolean;
  /** Whether to skip ensureOnMain() check */
  skipEnsureOnMain: boolean;
  /** Whether to skip micro-worktree isolation (commit directly on current branch) */
  skipMicroWorktree: boolean;
  /** Target branch for the commit (current branch in cloud mode, main otherwise) */
  targetBranch: string;
}

/**
 * Build context for wu:create cloud mode.
 *
 * When --cloud is true, the create command should:
 * - Skip ensureOnMain() validation
 * - Skip micro-worktree isolation
 * - Write and commit WU spec directly on the current branch
 *
 * @param input - Cloud create input flags
 * @returns Cloud create context with skip flags and target branch
 */
export function buildCloudCreateContext(input: CloudCreateInput): CloudCreateContext {
  if (!input.cloud) {
    return {
      isCloud: false,
      skipEnsureOnMain: false,
      skipMicroWorktree: false,
      targetBranch: 'main',
    };
  }

  return {
    isCloud: true,
    skipEnsureOnMain: true,
    skipMicroWorktree: true,
    targetBranch: input.currentBranch,
  };
}
