// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { runGit } from './git-runner.js';

interface WorktreeCommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

function runWorktreeGit(args: string[], cwd?: string): WorktreeCommandResult {
  const result = runGit(args, { cwd });
  return {
    success: result.ok,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function listWorktreesTool(
  input: { cwd?: string } = {},
): Promise<WorktreeCommandResult> {
  return runWorktreeGit(['worktree', 'list', '--porcelain'], input.cwd);
}

export async function createWorktreeTool(input: {
  cwd?: string;
  path: string;
  branch: string;
}): Promise<WorktreeCommandResult> {
  return runWorktreeGit(['worktree', 'add', input.path, input.branch], input.cwd);
}

export async function removeWorktreeTool(input: {
  cwd?: string;
  path: string;
  force?: boolean;
}): Promise<WorktreeCommandResult> {
  const args = ['worktree', 'remove'];
  if (input.force) {
    args.push('--force');
  }
  args.push(input.path);
  return runWorktreeGit(args, input.cwd);
}
