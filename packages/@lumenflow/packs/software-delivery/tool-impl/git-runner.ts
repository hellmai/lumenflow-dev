// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { spawnSync } from 'node:child_process';
import { UTF8_ENCODING } from '../constants.js';

const GIT_BINARY_ENV_VAR = 'LUMENFLOW_GIT_BINARY';
const POSIX_GIT_BINARY = 'git';
const WINDOWS_GIT_BINARY = 'git.exe';

export interface GitCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number;
}

function firstNonEmptyLine(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const line = value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line ?? null;
}

function resolveGitBinaryFromPath(): string | null {
  const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
  const lookupTarget = process.platform === 'win32' ? WINDOWS_GIT_BINARY : POSIX_GIT_BINARY;
  const lookupResult = spawnSync(lookupCommand, [lookupTarget], {
    encoding: UTF8_ENCODING,
  });

  if (!lookupResult || lookupResult.status !== 0) {
    return null;
  }
  return firstNonEmptyLine(lookupResult.stdout);
}

export function resolveGitBinary(): string {
  const configured = process.env[GIT_BINARY_ENV_VAR]?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }
  const resolved = resolveGitBinaryFromPath();
  if (resolved) {
    return resolved;
  }
  return process.platform === 'win32' ? WINDOWS_GIT_BINARY : POSIX_GIT_BINARY;
}

export const GIT_BINARY = resolveGitBinary();

export function runGit(args: string[], options: { cwd?: string; gitBinary?: string } = {}): GitCommandResult {
  const result = spawnSync(options.gitBinary ?? GIT_BINARY, args, {
    cwd: options.cwd,
    encoding: UTF8_ENCODING,
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout || '').toString(),
    stderr: (result.stderr || '').toString(),
    status: result.status ?? 1,
  };
}
