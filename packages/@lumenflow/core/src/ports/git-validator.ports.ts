// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Git Validator Ports
 *
 * WU-1103: INIT-003 Phase 2c - Add git adapter and validator ports
 *
 * Port interfaces for git operations used by WU validation and lifecycle scripts.
 * These abstractions allow dependency injection and contract-based testing.
 *
 * @module ports/git-validator
 */

/**
 * Push command options.
 */
export interface PushOptions {
  /** Set upstream tracking (equivalent to git push -u). */
  setUpstream?: boolean;
}

/**
 * Merge command options.
 */
export interface MergeOptions {
  /** Require fast-forward-only merge. */
  ffOnly?: boolean;
}

/**
 * Worktree removal options.
 */
export interface WorktreeRemoveOptions {
  /** Force removal when worktree has uncommitted changes. */
  force?: boolean;
}

/**
 * Branch deletion options.
 */
export interface DeleteBranchOptions {
  /** Force-delete branch (equivalent to git branch -D). */
  force?: boolean;
}

/**
 * Reset command options.
 */
export interface ResetOptions {
  /** Perform hard reset (equivalent to git reset --hard). */
  hard?: boolean;
}

/**
 * Log command options.
 */
export interface LogOptions {
  /** Maximum number of commits to return. */
  maxCount?: number;
}

/**
 * Minimal merge result contract.
 */
export interface MergeResult {
  /** True when merge completed successfully. */
  success: boolean;
}

/**
 * Minimal git log entry contract.
 */
export interface GitLogEntry {
  hash: string;
  message: string;
}

/**
 * Minimal git log result contract.
 */
export interface GitLogResult {
  all: GitLogEntry[];
  total: number;
}

/**
 * Git adapter contract used by validator and lifecycle workflows.
 *
 * Note: Keep this aligned with `GitAdapter` public methods.
 */
export interface IGitAdapter {
  getCurrentBranch(): Promise<string>;
  getStatus(): Promise<string>;
  getUnpushedCommits(): Promise<string>;
  branchExists(branch: string): Promise<boolean>;
  remoteBranchExists(remote: string, branch: string): Promise<boolean>;
  fetch(remote?: string, branch?: string): Promise<void>;
  pull(remote: string, branch: string): Promise<void>;
  getConfigValue(key: string): Promise<string>;
  isClean(): Promise<boolean>;
  add(files: string | string[]): Promise<void>;
  addWithDeletions(files: string[]): Promise<void>;
  commit(message: string): Promise<void>;
  push(remote?: string, branch?: string, options?: PushOptions): Promise<void>;
  pushRefspec(remote: string, localRef: string, remoteRef: string): Promise<void>;
  createBranch(branch: string, startPoint?: string): Promise<void>;
  checkout(branch: string): Promise<void>;
  getCommitHash(ref?: string): Promise<string>;
  merge(branch: string, options?: MergeOptions): Promise<MergeResult>;
  log(options?: LogOptions): Promise<GitLogResult>;
  mergeBase(ref1: string, ref2: string): Promise<string>;
  mergeTree(base: string, ref1: string, ref2: string): Promise<string>;
  revList(args: string[]): Promise<string>;
  worktreeAdd(path: string, branch: string, startPoint?: string): Promise<void>;
  worktreeRemove(worktreePath: string, options?: WorktreeRemoveOptions): Promise<void>;
  worktreeList(): Promise<string>;
  deleteBranch(branch: string, options?: DeleteBranchOptions): Promise<void>;
  createBranchNoCheckout(branch: string, startPoint?: string): Promise<void>;
  worktreeAddExisting(path: string, branch: string): Promise<void>;
  rebase(onto: string): Promise<void>;
  reset(ref?: string, options?: ResetOptions): Promise<void>;
  raw(args: string[]): Promise<string>;
  addWorktree(path: string, branch: string, startPoint?: string): Promise<void>;
  removeWorktree(path: string, options?: WorktreeRemoveOptions): Promise<void>;
}
