import { spawnSync } from 'node:child_process';
import {
  SANDBOX_BACKEND_IDS,
  type SandboxBackend,
  type SandboxExecutionPlan,
  type SandboxExecutionRequest,
} from './sandbox-profile.js';

export interface LinuxSandboxBackendOptions {
  commandExists?: (binary: string) => boolean;
}

const LINUX_SANDBOX_BINARY = 'bwrap';

function defaultCommandExists(binary: string): boolean {
  const probe = spawnSync(binary, ['--help'], { stdio: 'ignore' });
  return !probe.error;
}

function buildUnavailablePlan(request: SandboxExecutionRequest): SandboxExecutionPlan {
  if (request.allowUnsandboxedFallback) {
    return {
      backendId: SANDBOX_BACKEND_IDS.LINUX,
      enforced: false,
      failClosed: false,
      warning: 'Running unsandboxed because bwrap is unavailable and fallback was explicitly enabled.',
    };
  }

  return {
    backendId: SANDBOX_BACKEND_IDS.LINUX,
    enforced: false,
    failClosed: true,
    reason: 'Linux sandbox backend unavailable: required binary "bwrap" was not found.',
  };
}

function buildInvocation(request: SandboxExecutionRequest) {
  const writableBinds = request.profile.allowlist.writableRoots.flatMap((entry) => [
    '--bind',
    entry.normalizedPath,
    entry.normalizedPath,
  ]);

  return {
    command: LINUX_SANDBOX_BINARY,
    args: [
      '--die-with-parent',
      '--new-session',
      ...writableBinds,
      '--proc',
      '/proc',
      '--dev',
      '/dev',
      '--',
      ...request.command,
    ],
  };
}

export function createLinuxSandboxBackend(options: LinuxSandboxBackendOptions = {}): SandboxBackend {
  const commandExists = options.commandExists || defaultCommandExists;

  return {
    id: SANDBOX_BACKEND_IDS.LINUX,
    resolveExecution(request: SandboxExecutionRequest): SandboxExecutionPlan {
      if (!commandExists(LINUX_SANDBOX_BINARY)) {
        return buildUnavailablePlan(request);
      }

      return {
        backendId: SANDBOX_BACKEND_IDS.LINUX,
        enforced: true,
        failClosed: false,
        invocation: buildInvocation(request),
      };
    },
  };
}
