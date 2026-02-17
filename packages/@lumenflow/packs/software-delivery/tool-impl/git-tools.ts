import { spawnSync } from 'node:child_process';
import { UTF8_ENCODING } from '../constants.js';

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

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number;
}

const GIT_BINARY = '/usr/bin/git';

function runGit(cwd: string, args: string[]): CommandResult {
  const result = spawnSync(GIT_BINARY, args, {
    cwd,
    encoding: UTF8_ENCODING,
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout || '').toString(),
    stderr: (result.stderr || '').toString(),
    status: result.status ?? 1,
  };
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
  const existing = runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (existing.ok) {
    return;
  }
  const init = runGit(cwd, ['init']);
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
      const result = runGit(cwd, args);
      if (!result.ok) {
        return {
          success: false,
          error: {
            code: 'command_failed',
            message: result.stderr || result.stdout || 'Command execution failed.',
          },
        };
      }
    }
    return {
      success: true,
      data: { commands_executed: commands.length },
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

  const status = runGit(cwd, ['status', '--short']);
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
  const result = runGit(cwd, args);
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
    const stage = runGit(cwd, ['add', ...files]);
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

  const commit = runGit(cwd, ['commit', '--no-gpg-sign', '-m', message]);
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

  const hash = runGit(cwd, ['rev-parse', 'HEAD']);
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
