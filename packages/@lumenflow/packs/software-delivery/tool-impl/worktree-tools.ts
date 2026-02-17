import { spawnSync } from 'node:child_process';
import { UTF8_ENCODING } from '../constants.js';

interface WorktreeCommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

const GIT_BINARY = '/usr/bin/git';

function runGit(args: string[], cwd?: string): WorktreeCommandResult {
  const result = spawnSync(GIT_BINARY, args, {
    cwd,
    encoding: UTF8_ENCODING,
  });
  return {
    success: result.status === 0,
    stdout: (result.stdout || '').toString(),
    stderr: (result.stderr || '').toString(),
  };
}

export async function listWorktreesTool(
  input: { cwd?: string } = {},
): Promise<WorktreeCommandResult> {
  return runGit(['worktree', 'list', '--porcelain'], input.cwd);
}

export async function createWorktreeTool(input: {
  cwd?: string;
  path: string;
  branch: string;
}): Promise<WorktreeCommandResult> {
  return runGit(['worktree', 'add', input.path, input.branch], input.cwd);
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
  return runGit(args, input.cwd);
}
