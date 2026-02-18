// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { GIT_BINARY, runGit } from './git-runner.js';

export type GitToolName = 'git:add' | 'git:status' | 'git:commit';

export interface GitToolContext {
  run_id: string;
  task_id: string;
  session_id: string;
  cwd: string;
}

export interface GitToolOutput {
  success: boolean;
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
  metadata?: {
    artifacts_written?: string[];
  };
}

export interface ToolCallStartedReceipt {
  schema_version: 1;
  kind: 'tool_call_started';
  run_id: string;
  task_id: string;
  session_id: string;
  tool_name: GitToolName;
}

export interface ToolCallFinishedReceipt {
  schema_version: 1;
  kind: 'tool_call_finished';
  result: 'success' | 'failure';
  artifacts_written: string[];
}

export interface GitToolHostReceipt {
  started: ToolCallStartedReceipt;
  finished: ToolCallFinishedReceipt;
  output: GitToolOutput;
}

interface CommandExecutionResult {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  status: number;
}

function isGitBinaryCommand(command: unknown): boolean {
  const normalized = String(command);
  return normalized === 'git' || normalized === GIT_BINARY;
}

async function trySimpleGitStatus(cwd: string): Promise<string | null> {
  try {
    const simpleGitModule = (await import('simple-git')) as {
      simpleGit?: (root: string) => { status: () => Promise<{ files: Array<{ path: string }> }> };
    };
    if (!simpleGitModule.simpleGit) {
      return null;
    }
    const git = simpleGitModule.simpleGit(cwd);
    const status = await git.status();
    return status.files.map((file) => file.path).join('\n');
  } catch {
    return null;
  }
}

function ensureRepository(cwd: string): void {
  const existing = runGit(['rev-parse', '--is-inside-work-tree'], { cwd });
  if (existing.ok) {
    return;
  }
  const init = runGit(['init'], { cwd });
  if (!init.ok) {
    throw new Error(`Failed to initialize git repository: ${init.stderr || init.stdout}`);
  }
}

export async function gitStatusTool(
  input: Record<string, unknown>,
  cwd: string,
): Promise<GitToolOutput> {
  ensureRepository(cwd);

  if (input.init === true) {
    return {
      success: true,
      data: { initialized: true },
    };
  }

  const commands = Array.isArray(input.commands) ? input.commands : null;
  if (commands) {
    const commandResults: CommandExecutionResult[] = [];

    for (const commandEntry of commands) {
      if (!Array.isArray(commandEntry) || commandEntry.length === 0) {
        return {
          success: false,
          error: {
            code: 'invalid_command',
            message: 'commands must contain non-empty command arrays.',
          },
        };
      }

      const command = commandEntry[0];
      if (!isGitBinaryCommand(command)) {
        return {
          success: false,
          error: {
            code: 'invalid_command',
            message: 'git:status commands only allow the git binary.',
          },
        };
      }

      const args = commandEntry.slice(1).map((arg) => String(arg));
      const result = runGit(args, { cwd });
      if (!result.ok) {
        return {
          success: false,
          error: {
            code: 'command_failed',
            message: result.stderr || result.stdout || 'Command execution failed.',
          },
        };
      }

      commandResults.push({
        command: String(command),
        args,
        stdout: result.stdout,
        stderr: result.stderr,
        status: result.status,
      });
    }

    return {
      success: true,
      data: {
        commands_executed: commands.length,
        command_results: commandResults,
        output: commandResults[commandResults.length - 1]?.stdout.trim() ?? '',
      },
    };
  }

  const simpleGitStatus = await trySimpleGitStatus(cwd);
  if (simpleGitStatus !== null) {
    return {
      success: true,
      data: {
        status: simpleGitStatus,
        source: 'simple-git',
      },
    };
  }

  const status = runGit(['status', '--short'], { cwd });
  if (!status.ok) {
    return {
      success: false,
      error: {
        code: 'git_status_failed',
        message: status.stderr || status.stdout || 'git status failed.',
      },
    };
  }

  return {
    success: true,
    data: {
      status: status.stdout.trim(),
      source: 'child_process',
    },
  };
}

export async function gitAddTool(
  input: Record<string, unknown>,
  cwd: string,
): Promise<GitToolOutput> {
  ensureRepository(cwd);
  const files = Array.isArray(input.files) ? input.files.map((file) => String(file)) : [];
  const args = ['add', ...(files.length > 0 ? files : ['-A'])];
  const result = runGit(args, { cwd });
  if (!result.ok) {
    return {
      success: false,
      error: {
        code: 'git_add_failed',
        message: result.stderr || result.stdout || 'git add failed.',
      },
    };
  }

  return {
    success: true,
    data: {
      staged: files,
    },
    metadata: {
      artifacts_written: files,
    },
  };
}

export async function gitCommitTool(
  input: Record<string, unknown>,
  cwd: string,
): Promise<GitToolOutput> {
  ensureRepository(cwd);

  const message =
    typeof input.message === 'string' && input.message.length > 0 ? input.message : null;
  if (!message) {
    return {
      success: false,
      error: {
        code: 'invalid_message',
        message: 'Commit message is required.',
      },
    };
  }

  const files = Array.isArray(input.files) ? input.files.map((file) => String(file)) : [];
  if (files.length > 0) {
    const stage = runGit(['add', ...files], { cwd });
    if (!stage.ok) {
      return {
        success: false,
        error: {
          code: 'git_add_failed',
          message: stage.stderr || stage.stdout || 'git add failed before commit.',
        },
      };
    }
  }

  const commit = runGit(['commit', '--no-gpg-sign', '-m', message], { cwd });
  if (!commit.ok) {
    return {
      success: false,
      error: {
        code: 'git_commit_failed',
        message: commit.stderr || commit.stdout || 'git commit failed.',
      },
      metadata: {
        artifacts_written: files,
      },
    };
  }

  const hash = runGit(['rev-parse', 'HEAD'], { cwd });
  return {
    success: true,
    data: {
      commit: hash.ok ? hash.stdout.trim() : null,
      output: commit.stdout.trim(),
    },
    metadata: {
      artifacts_written: files,
    },
  };
}

export async function runGitToolThroughToolHost(input: {
  toolName: GitToolName;
  input: Record<string, unknown>;
  context: GitToolContext;
}): Promise<GitToolHostReceipt> {
  const started: ToolCallStartedReceipt = {
    schema_version: 1,
    kind: 'tool_call_started',
    run_id: input.context.run_id,
    task_id: input.context.task_id,
    session_id: input.context.session_id,
    tool_name: input.toolName,
  };

  let output: GitToolOutput;
  if (input.toolName === 'git:add') {
    output = await gitAddTool(input.input, input.context.cwd);
  } else if (input.toolName === 'git:status') {
    output = await gitStatusTool(input.input, input.context.cwd);
  } else {
    output = await gitCommitTool(input.input, input.context.cwd);
  }

  const finished: ToolCallFinishedReceipt = {
    schema_version: 1,
    kind: 'tool_call_finished',
    result: output.success ? 'success' : 'failure',
    artifacts_written:
      output.metadata?.artifacts_written && output.metadata.artifacts_written.length > 0
        ? output.metadata.artifacts_written
        : [],
  };

  return {
    started,
    finished,
    output,
  };
}
