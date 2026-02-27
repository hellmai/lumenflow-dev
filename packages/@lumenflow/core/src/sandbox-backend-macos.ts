// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { spawnSync } from 'node:child_process';
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

function buildPolicy(profile: SandboxExecutionRequest['profile']): string {
  const writableRules = profile.allowlist.writableRoots.map(
    (entry) => `(allow file-write* (subpath "${escapePolicyPath(entry.normalizedPath)}"))`,
  );

  return [
    '(version 1)',
    '(deny default)',
    '(allow process*)',
    '(allow file-read*)',
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
