import { spawnSync } from 'node:child_process';
import {
  SANDBOX_BACKEND_IDS,
  type SandboxBackend,
  type SandboxExecutionPlan,
  type SandboxExecutionRequest,
} from './sandbox-profile.js';

export interface WindowsSandboxBackendOptions {
  commandExists?: (binary: string) => boolean;
}

const WINDOWS_SANDBOX_BINARY = 'powershell.exe';

function defaultCommandExists(binary: string): boolean {
  const probe = spawnSync(binary, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion'], {
    stdio: 'ignore',
  });
  return !probe.error;
}

function escapePowerShellSingleQuotedValue(value: string): string {
  return value.replace(/'/g, "''");
}

function buildWriteRootArray(profile: SandboxExecutionRequest['profile']): string {
  const roots = profile.allowlist.writableRoots
    .map((entry) => `'${escapePowerShellSingleQuotedValue(entry.normalizedPath)}'`)
    .join(', ');

  return `@(${roots})`;
}

function buildCommandInvocation(command: string[]): string {
  return command.map((part) => `'${escapePowerShellSingleQuotedValue(part)}'`).join(', ');
}

function buildInvocationScript(request: SandboxExecutionRequest): string {
  const roots = buildWriteRootArray(request.profile);
  const command = buildCommandInvocation(request.command);

  return [
    '$ErrorActionPreference = "Stop"',
    `$lumenflowAllowedRoots = ${roots}`,
    `$lumenflowCommand = @(${command})`,
    'if ($lumenflowCommand.Length -eq 0) { throw "No command provided." }',
    '$lumenflowArgs = if ($lumenflowCommand.Length -gt 1) { $lumenflowCommand[1..($lumenflowCommand.Length - 1)] } else { @() }',
    '& $lumenflowCommand[0] @lumenflowArgs',
  ].join('; ');
}

function buildUnavailablePlan(request: SandboxExecutionRequest): SandboxExecutionPlan {
  if (request.allowUnsandboxedFallback) {
    return {
      backendId: SANDBOX_BACKEND_IDS.WINDOWS,
      enforced: false,
      failClosed: false,
      warning:
        'Running unsandboxed because powershell is unavailable and fallback was explicitly enabled.',
    };
  }

  return {
    backendId: SANDBOX_BACKEND_IDS.WINDOWS,
    enforced: false,
    failClosed: true,
    reason: 'Windows sandbox backend unavailable: required binary "powershell.exe" was not found.',
  };
}

function buildInvocation(request: SandboxExecutionRequest) {
  return {
    command: WINDOWS_SANDBOX_BINARY,
    args: ['-NoProfile', '-NonInteractive', '-Command', buildInvocationScript(request)],
  };
}

export function createWindowsSandboxBackend(
  options: WindowsSandboxBackendOptions = {},
): SandboxBackend {
  const commandExists = options.commandExists || defaultCommandExists;

  return {
    id: SANDBOX_BACKEND_IDS.WINDOWS,
    resolveExecution(request: SandboxExecutionRequest): SandboxExecutionPlan {
      if (!commandExists(WINDOWS_SANDBOX_BINARY)) {
        return buildUnavailablePlan(request);
      }

      return {
        backendId: SANDBOX_BACKEND_IDS.WINDOWS,
        enforced: true,
        failClosed: false,
        invocation: buildInvocation(request),
      };
    },
  };
}
