// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ToolOutput, ToolScope } from '../kernel.schemas.js';
import type {
  SubprocessDispatchRequest,
  SubprocessDispatcher,
} from '../tool-host/subprocess-dispatcher.js';
import { buildBwrapInvocation } from './bwrap-invocation.js';
import {
  buildSandboxProfileFromScopes,
  resolveScopeEnforcementNote,
  type BuildSandboxProfileFromScopesOptions,
} from './profile.js';
import { UTF8_ENCODING } from '../shared-constants.js';
import {
  parseToolRunnerWorkerResponse,
  type ToolRunnerWorkerInvocation,
} from './tool-runner-worker.js';

export interface SubprocessTransportRequest {
  command: string;
  args: string[];
  stdin: string;
  env: Record<string, string>;
}

export interface SubprocessTransportResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface SubprocessTransport {
  execute(request: SubprocessTransportRequest): Promise<SubprocessTransportResult>;
}

export interface SandboxSubprocessDispatcherOptions {
  commandExists?: (binary: string) => boolean;
  transport?: SubprocessTransport;
  workspaceRoot?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  workerEntry?: string;
  nodeBinary?: string;
}

function buildFailureOutput(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ToolOutput {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}

function withScopeNote(output: ToolOutput, scopes: ToolScope[]): ToolOutput {
  const scopeEnforcementNote = resolveScopeEnforcementNote(scopes);
  if (!scopeEnforcementNote) {
    return output;
  }
  return {
    ...output,
    metadata: {
      ...(output.metadata || {}),
      scope_enforcement_note: scopeEnforcementNote,
    },
  };
}

function defaultCommandExists(binary: string): boolean {
  const probe = spawnSync(binary, ['--help'], { stdio: 'ignore' });
  return !probe.error;
}

function resolveDefaultWorkerEntry(): string {
  const jsPath = fileURLToPath(new URL('./tool-runner-worker.js', import.meta.url));
  if (fs.existsSync(jsPath)) {
    return jsPath;
  }
  return fileURLToPath(new URL('./tool-runner-worker.ts', import.meta.url));
}

export class NodeSubprocessTransport implements SubprocessTransport {
  async execute(request: SubprocessTransportRequest): Promise<SubprocessTransportResult> {
    return new Promise<SubprocessTransportResult>((resolve, reject) => {
      const child = spawn(request.command, request.args, {
        stdio: 'pipe',
        env: {
          ...process.env,
          ...request.env,
        },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.setEncoding(UTF8_ENCODING);
      child.stderr.setEncoding(UTF8_ENCODING);

      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
        resolve({
          code: code ?? 1,
          stdout,
          stderr,
        });
      });

      child.stdin.end(request.stdin);
    });
  }
}

export class SandboxSubprocessDispatcher implements SubprocessDispatcher {
  private readonly commandExists: (binary: string) => boolean;
  private readonly transport: SubprocessTransport;
  private readonly profileOptions: BuildSandboxProfileFromScopesOptions;
  private readonly workerEntry: string;
  private readonly nodeBinary: string;

  constructor(options: SandboxSubprocessDispatcherOptions = {}) {
    this.commandExists = options.commandExists || defaultCommandExists;
    this.transport = options.transport || new NodeSubprocessTransport();
    this.profileOptions = {
      workspaceRoot: options.workspaceRoot,
      homeDir: options.homeDir,
      env: options.env,
    };
    this.workerEntry = options.workerEntry || resolveDefaultWorkerEntry();
    this.nodeBinary = options.nodeBinary || process.execPath;
  }

  async dispatch(request: SubprocessDispatchRequest): Promise<ToolOutput> {
    if (request.capability.handler.kind !== 'subprocess') {
      return buildFailureOutput(
        'INVALID_HANDLER_KIND',
        'Subprocess dispatcher requires subprocess handlers.',
      );
    }

    if (!this.commandExists('bwrap')) {
      return withScopeNote(
        buildFailureOutput(
          'SUBPROCESS_SANDBOX_UNAVAILABLE',
          'Subprocess execution unavailable: required binary "bwrap" was not found.',
        ),
        request.scopeEnforced,
      );
    }

    const invocationPayload: ToolRunnerWorkerInvocation = {
      tool_name: request.capability.name,
      handler_entry: request.capability.handler.entry,
      input: request.input,
      scope_enforced: request.scopeEnforced,
      receipt_id: randomUUID(),
    };

    const profile = buildSandboxProfileFromScopes(request.scopeEnforced, this.profileOptions);
    const sandboxInvocation = buildBwrapInvocation({
      profile,
      command: [this.nodeBinary, this.workerEntry],
    });

    let transportResult: SubprocessTransportResult;
    try {
      transportResult = await this.transport.execute({
        command: sandboxInvocation.command,
        args: sandboxInvocation.args,
        stdin: JSON.stringify(invocationPayload),
        env: sandboxInvocation.env,
      });
    } catch (error) {
      return withScopeNote(
        buildFailureOutput('SUBPROCESS_TRANSPORT_FAILED', (error as Error).message),
        request.scopeEnforced,
      );
    }

    if (transportResult.code !== 0) {
      return withScopeNote(
        buildFailureOutput(
          'SUBPROCESS_EXIT_NONZERO',
          'Subprocess worker exited with non-zero code.',
          {
            exit_code: transportResult.code,
            stderr: transportResult.stderr,
          },
        ),
        request.scopeEnforced,
      );
    }

    try {
      const response = parseToolRunnerWorkerResponse(transportResult.stdout);
      return withScopeNote(response.output, request.scopeEnforced);
    } catch (error) {
      return withScopeNote(
        buildFailureOutput('SUBPROCESS_PROTOCOL_ERROR', (error as Error).message, {
          stdout: transportResult.stdout,
          stderr: transportResult.stderr,
        }),
        request.scopeEnforced,
      );
    }
  }
}
