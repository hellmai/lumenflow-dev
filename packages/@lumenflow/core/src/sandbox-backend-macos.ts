// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { spawnSync } from 'node:child_process';
import os from 'node:os';
import {
  SANDBOX_BACKEND_IDS,
  type SandboxBackend,
  type SandboxExecutionPlan,
  type SandboxExecutionRequest,
} from './sandbox-profile.js';

export interface MacosSandboxBackendOptions {
  commandExists?: (binary: string) => boolean;
}

const MACOS_SANDBOX_BINARY = 'sandbox-exec';

function defaultCommandExists(binary: string): boolean {
  const probe = spawnSync(binary, ['-h'], { stdio: 'ignore' });
  return !probe.error;
}

function escapePolicyPath(targetPath: string): string {
  return targetPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildNetworkRules(profile: SandboxExecutionRequest['profile']): string[] {
  const posture = profile.networkPosture ?? 'full';

  if (posture === 'off') {
    return ['(deny network*)'];
  }

  if (posture === 'allowlist') {
    const rules: string[] = ['(deny network*)'];
    for (const host of profile.networkAllowlist) {
      rules.push(`(allow network-outbound (remote ip "${host}"))`);
    }
    return rules;
  }

  // posture === 'full'
  return ['(allow network*)'];
}

/** macOS system paths required for process execution (parity with bwrap --ro-bind /) */
const MACOS_SYSTEM_READ_PATHS = [
  '/usr',
  '/System',
  '/Library',
  '/bin',
  '/sbin',
  '/private',
  '/dev',
  '/tmp',
];

/** Sensitive paths denied from read access (parity with bwrap deny overlays) */
const SENSITIVE_DENY_PATHS = ['.ssh', '.aws', '.gnupg'];

function buildReadRules(profile: SandboxExecutionRequest['profile']): string[] {
  const readPaths = new Set<string>();

  // Workspace root (covers worktree, state, WU YAML)
  readPaths.add(profile.projectRoot);

  // System paths required for process execution
  for (const systemPath of MACOS_SYSTEM_READ_PATHS) {
    readPaths.add(systemPath);
  }

  // Temp path from profile
  readPaths.add(profile.tempPath);

  return [...readPaths].map(
    (readPath) => `(allow file-read* (subpath "${escapePolicyPath(readPath)}"))`,
  );
}

function buildDenyOverlays(): string[] {
  const homeDir = os.homedir();
  return SENSITIVE_DENY_PATHS.map(
    (sensitivePath) =>
      `(deny file-read* (subpath "${escapePolicyPath(homeDir)}/${sensitivePath}"))`,
  );
}

function buildPolicy(profile: SandboxExecutionRequest['profile']): string {
  const writableRules = profile.allowlist.writableRoots.map(
    (entry) => `(allow file-write* (subpath "${escapePolicyPath(entry.normalizedPath)}"))`,
  );

  return [
    '(version 1)',
    '(deny default)',
    '(allow process*)',
    ...buildReadRules(profile),
    ...buildDenyOverlays(),
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    ...buildNetworkRules(profile),
    '(allow signal)',
    ...writableRules,
  ].join(' ');
}

function buildUnavailablePlan(request: SandboxExecutionRequest): SandboxExecutionPlan {
  if (request.allowUnsandboxedFallback) {
    return {
      backendId: SANDBOX_BACKEND_IDS.MACOS,
      enforced: false,
      failClosed: false,
      warning:
        'Running unsandboxed because sandbox-exec is unavailable and fallback was explicitly enabled.',
    };
  }

  return {
    backendId: SANDBOX_BACKEND_IDS.MACOS,
    enforced: false,
    failClosed: true,
    reason: 'macOS sandbox backend unavailable: required binary "sandbox-exec" was not found.',
  };
}

function buildInvocation(request: SandboxExecutionRequest) {
  return {
    command: MACOS_SANDBOX_BINARY,
    args: ['-p', buildPolicy(request.profile), ...request.command],
  };
}

export function createMacosSandboxBackend(
  options: MacosSandboxBackendOptions = {},
): SandboxBackend {
  const commandExists = options.commandExists || defaultCommandExists;

  return {
    id: SANDBOX_BACKEND_IDS.MACOS,
    resolveExecution(request: SandboxExecutionRequest): SandboxExecutionPlan {
      if (!commandExists(MACOS_SANDBOX_BINARY)) {
        return buildUnavailablePlan(request);
      }

      return {
        backendId: SANDBOX_BACKEND_IDS.MACOS,
        enforced: true,
        failClosed: false,
        invocation: buildInvocation(request),
      };
    },
  };
}
