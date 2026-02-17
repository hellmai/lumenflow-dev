// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EvidenceStore } from '../evidence/evidence-store.js';
import type { ExecutionContext, ToolCapability, ToolScope } from '../kernel.schemas.js';
import {
  buildBwrapInvocation,
  buildSandboxProfileFromScopes,
  createDefaultDenyOverlays,
  SandboxSubprocessDispatcher,
  type SubprocessTransport,
} from '../sandbox/index.js';
import { ToolHost, ToolRegistry } from '../tool-host/index.js';

function collectMountTargets(args: string[], flag: '--bind' | '--ro-bind'): string[] {
  const targets: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) {
      continue;
    }
    targets.push(args[index + 2] || '');
    index += 2;
  }
  return targets;
}

function hasMount(
  args: string[],
  flag: '--bind' | '--ro-bind',
  source: string,
  target: string,
): boolean {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) {
      continue;
    }
    if (args[index + 1] === source && args[index + 2] === target) {
      return true;
    }
    index += 2;
  }
  return false;
}

function makeSubprocessCapability(entry: string): ToolCapability {
  return {
    name: 'proc:exec',
    domain: 'process',
    version: '1.0.0',
    input_schema: z.object({
      command: z.string(),
    }),
    output_schema: z.object({
      ok: z.boolean(),
    }),
    permission: 'admin',
    required_scopes: [
      {
        type: 'path',
        pattern: 'packages/@lumenflow/kernel/src/sandbox/**',
        access: 'write',
      },
    ],
    handler: {
      kind: 'subprocess',
      entry,
    },
    description: 'Execute a command in subprocess mode',
  };
}

function makeExecutionContext(): ExecutionContext {
  return {
    run_id: 'run-1730',
    task_id: 'WU-1730',
    session_id: 'session-1730',
    allowed_scopes: [
      {
        type: 'path',
        pattern: 'packages/@lumenflow/kernel/src/sandbox/**',
        access: 'write',
      },
    ],
    metadata: {
      workspace_allowed_scopes: [
        {
          type: 'path',
          pattern: 'packages/@lumenflow/kernel/src/sandbox/**',
          access: 'write',
        },
      ],
      lane_allowed_scopes: [
        {
          type: 'path',
          pattern: 'packages/@lumenflow/kernel/src/sandbox/**',
          access: 'write',
        },
      ],
      task_declared_scopes: [
        {
          type: 'path',
          pattern: 'packages/@lumenflow/kernel/src/sandbox/**',
          access: 'write',
        },
      ],
      workspace_config_hash: 'a'.repeat(64),
      runtime_version: '2.21.0',
    },
  };
}

describe('kernel sandbox integration', () => {
  let tempDir: string;
  let evidenceRoot: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lumenflow-kernel-sandbox-'));
    evidenceRoot = join(tempDir, 'evidence');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('builds sandbox profile + bwrap invocation with hardening flags and scoped rw mounts', () => {
    const workspaceRoot = resolve('repo', 'root');
    const homeDir = resolve('home', 'agent');
    const packagesRoot = join(workspaceRoot, 'packages');
    const docsRoot = join(workspaceRoot, 'docs');
    const scopeEnforced: ToolScope[] = [
      { type: 'path', pattern: 'packages/**', access: 'write' },
      { type: 'path', pattern: 'docs/**', access: 'read' },
      { type: 'network', posture: 'off' },
    ];
    const profile = buildSandboxProfileFromScopes(scopeEnforced, {
      workspaceRoot,
      homeDir,
      env: {
        LANG: 'C.UTF-8',
      },
    });

    expect(profile.network_posture).toBe('off');
    expect(profile.writable_bind_mounts.map((mount) => mount.target)).toContain(packagesRoot);
    expect(profile.readonly_bind_mounts.map((mount) => mount.target)).toContain(docsRoot);

    const invocation = buildBwrapInvocation({
      profile,
      command: ['node', join(workspaceRoot, 'dist', 'tool-runner-worker.js')],
    });

    expect(invocation.command).toBe('bwrap');
    expect(invocation.args).toContain('--die-with-parent');
    expect(invocation.args).toContain('--new-session');
    expect(invocation.args).toContain('--unshare-net');

    const writableTargets = collectMountTargets(invocation.args, '--bind');
    const readonlyTargets = collectMountTargets(invocation.args, '--ro-bind');
    expect(writableTargets).toContain(packagesRoot);
    expect(writableTargets).not.toContain(docsRoot);
    expect(readonlyTargets).toContain(docsRoot);
    expect(readonlyTargets).not.toContain(join(workspaceRoot, 'dist'));
    expect(hasMount(invocation.args, '--ro-bind', '/', '/')).toBe(false);
  });

  it('does not auto-mount deep absolute command ancestors outside profile prefixes', () => {
    const workspaceRoot = resolve('repo', 'root');
    const profile = buildSandboxProfileFromScopes(
      [{ type: 'path', pattern: 'sandbox/**', access: 'write' }],
      {
        workspaceRoot,
        homeDir: resolve('home', 'agent'),
      },
    );

    const invocation = buildBwrapInvocation({
      profile,
      command: ['/etc/deep/nested/tool', join(workspaceRoot, 'sandbox', 'worker.js')],
    });

    const readonlyTargets = collectMountTargets(invocation.args, '--ro-bind');
    expect(readonlyTargets).not.toContain('/etc/deep');
    expect(readonlyTargets).not.toContain('/etc/deep/nested');
  });

  it('includes required deny overlays for sensitive locations', () => {
    const workspaceRoot = resolve('repo', 'root');
    const homeDir = resolve('home', 'agent');
    const overlays = createDefaultDenyOverlays({
      workspaceRoot,
      homeDir,
    });
    const paths = overlays.map((overlay) => overlay.path);
    expect(paths).toContain(join(homeDir, '.ssh'));
    expect(paths).toContain(join(homeDir, '.aws'));
    expect(paths).toContain(join(homeDir, '.gnupg'));
    expect(paths).toContain(join(workspaceRoot, '.env'));
  });

  it('wires subprocess dispatcher into ToolHost and sends serialized invocation payload', async () => {
    let capturedStdin = '';
    const transport: SubprocessTransport = {
      async execute(request) {
        capturedStdin = request.stdin;
        return {
          code: 0,
          stdout: JSON.stringify({
            output: {
              success: true,
              data: { ok: true },
              metadata: { artifacts_written: ['sandbox/output.txt'] },
            },
          }),
          stderr: '',
        };
      },
    };

    const dispatcher = new SandboxSubprocessDispatcher({
      transport,
      commandExists: () => true,
      workspaceRoot: tempDir,
      homeDir: join(tempDir, 'home'),
    });

    const registry = new ToolRegistry();
    registry.register(makeSubprocessCapability(join(tempDir, 'adapter.mjs')));

    const evidenceStore = new EvidenceStore({
      evidenceRoot,
    });

    const host = new ToolHost({
      registry,
      evidenceStore,
      subprocessDispatcher: dispatcher,
    });

    const result = await host.execute(
      'proc:exec',
      {
        command: 'echo hello',
      },
      makeExecutionContext(),
    );

    expect(result.success).toBe(true);
    const workerPayload = JSON.parse(capturedStdin) as {
      tool_name: string;
      input: { command: string };
      scope_enforced: ToolScope[];
      receipt_id: string;
    };
    expect(workerPayload.tool_name).toBe('proc:exec');
    expect(workerPayload.input.command).toBe('echo hello');
    expect(workerPayload.scope_enforced).toHaveLength(1);
    expect(workerPayload.receipt_id.length).toBeGreaterThan(0);

    const traces = await evidenceStore.readTraces();
    expect(traces).toHaveLength(2);
    expect(traces[0]?.kind).toBe('tool_call_started');
    expect(traces[1]?.kind).toBe('tool_call_finished');
    const finished = traces[1];
    if (finished?.kind === 'tool_call_finished') {
      expect(finished.artifacts_written).toEqual(['sandbox/output.txt']);
    }
  });

  it('propagates structured transport failures with read confinement note when applicable', async () => {
    const workspaceRoot = resolve('repo', 'root');
    const homeDir = resolve('home', 'agent');
    const transport: SubprocessTransport = {
      async execute() {
        throw new Error('spawn failed');
      },
    };

    const dispatcher = new SandboxSubprocessDispatcher({
      transport,
      commandExists: () => true,
      workspaceRoot,
      homeDir,
    });

    const output = await dispatcher.dispatch({
      capability: {
        ...makeSubprocessCapability(join(workspaceRoot, 'adapter.mjs')),
        required_scopes: [{ type: 'path', pattern: 'docs/**', access: 'read' }],
      },
      input: { command: 'echo no-op' },
      context: makeExecutionContext(),
      scopeEnforced: [{ type: 'path', pattern: 'docs/**', access: 'read' }],
    });

    expect(output.success).toBe(false);
    expect(output.error?.code).toBe('SUBPROCESS_TRANSPORT_FAILED');
    expect(output.metadata?.scope_enforcement_note).toContain('read confinement best-effort');
  });
});
