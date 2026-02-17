// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EvidenceStore } from '../evidence/index.js';
import type { ExecutionContext, ToolCapability, ToolScope } from '../kernel.schemas.js';
import { ToolHost, ToolRegistry } from '../tool-host/index.js';

describe('tool host', () => {
  let tempDir: string;
  let evidenceRoot: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lumenflow-kernel-tool-host-'));
    evidenceRoot = join(tempDir, 'evidence');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeExecutionContext(
    overrides: Partial<ExecutionContext> = {},
    metadataOverrides: Record<string, unknown> = {},
  ): ExecutionContext {
    const sharedWriteScope: ToolScope = {
      type: 'path',
      pattern: 'packages/@lumenflow/kernel/src/tool-host/**',
      access: 'write',
    };

    return {
      run_id: 'run-1729',
      task_id: 'WU-1729',
      session_id: 'session-1729',
      allowed_scopes: [sharedWriteScope],
      metadata: {
        workspace_allowed_scopes: [sharedWriteScope],
        lane_allowed_scopes: [sharedWriteScope],
        task_declared_scopes: [sharedWriteScope],
        workspace_config_hash: 'd'.repeat(64),
        runtime_version: '2.21.0',
        pack_version: '1.0.0',
        pack_integrity: `sha256:${'e'.repeat(64)}`,
        ...metadataOverrides,
      },
      ...overrides,
    };
  }

  function makeInProcessCapability(): ToolCapability {
    return {
      name: 'fs:write',
      domain: 'file',
      version: '1.0.0',
      input_schema: z.object({
        path: z.string(),
        content: z.string(),
      }),
      output_schema: z.object({
        written: z.boolean(),
      }),
      permission: 'write',
      required_scopes: [
        {
          type: 'path',
          pattern: 'packages/@lumenflow/kernel/src/tool-host/**',
          access: 'write',
        },
      ],
      handler: {
        kind: 'in-process',
        fn: async () => ({
          success: true,
          data: {
            written: true,
          },
        }),
      },
      description: 'Write a file in the kernel tool-host area',
      pack: 'software-delivery',
    };
  }

  function makeSubprocessCapability(): ToolCapability {
    return {
      name: 'proc:exec',
      domain: 'process',
      version: '1.0.0',
      input_schema: z.object({
        command: z.string(),
      }),
      permission: 'admin',
      required_scopes: [{ type: 'network', posture: 'off' }],
      handler: {
        kind: 'subprocess',
        entry: 'kernel/tool-runner-worker.js',
      },
      description: 'Execute subprocess command',
    };
  }

  it('executes in-process handlers and writes started/finished traces', async () => {
    const registry = new ToolRegistry();
    registry.register(makeInProcessCapability());

    const evidenceStore = new EvidenceStore({ evidenceRoot });
    const host = new ToolHost({
      registry,
      evidenceStore,
    });

    const result = await host.execute(
      'fs:write',
      {
        path: 'packages/@lumenflow/kernel/src/tool-host/index.ts',
        content: 'ok',
      },
      makeExecutionContext(),
    );

    expect(result.success).toBe(true);
    const traces = await evidenceStore.readTraces();
    expect(traces).toHaveLength(2);
    expect(traces[0]?.kind).toBe('tool_call_started');
    expect(traces[1]?.kind).toBe('tool_call_finished');

    const started = traces[0];
    const finished = traces[1];
    if (started?.kind === 'tool_call_started') {
      expect(started.scope_requested).toHaveLength(1);
      expect(started.scope_allowed).toHaveLength(1);
      expect(started.scope_enforced).toHaveLength(1);
      expect(started.input_ref).toContain('/inputs/');
    }
    if (finished?.kind === 'tool_call_finished') {
      expect(finished.result).toBe('success');
      expect(finished.policy_decisions[0]?.decision).toBe('allow');
    }
  });

  it('denies execution when scope intersection resolves to empty', async () => {
    const registry = new ToolRegistry();
    registry.register(makeInProcessCapability());

    const evidenceStore = new EvidenceStore({ evidenceRoot });
    const host = new ToolHost({
      registry,
      evidenceStore,
    });

    const result = await host.execute(
      'fs:write',
      {
        path: 'packages/@lumenflow/kernel/src/tool-host/index.ts',
        content: 'blocked',
      },
      makeExecutionContext(
        {},
        {
          lane_allowed_scopes: [{ type: 'path', pattern: 'docs/**', access: 'write' }],
        },
      ),
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SCOPE_DENIED');

    const traces = await evidenceStore.readTraces();
    const finished = traces.find((trace) => trace.kind === 'tool_call_finished');
    expect(finished).toBeDefined();
    if (finished?.kind === 'tool_call_finished') {
      expect(finished.result).toBe('denied');
      expect(finished.scope_enforcement_note).toContain('Denied');
    }
  });

  it('uses default subprocess dispatcher with explicit configuration error', async () => {
    const registry = new ToolRegistry();
    registry.register(makeSubprocessCapability());

    const evidenceStore = new EvidenceStore({ evidenceRoot });
    const host = new ToolHost({
      registry,
      evidenceStore,
    });

    const result = await host.execute(
      'proc:exec',
      {
        command: 'echo hello',
      },
      makeExecutionContext(
        {
          allowed_scopes: [{ type: 'network', posture: 'off' }],
        },
        {
          workspace_allowed_scopes: [{ type: 'network', posture: 'off' }],
          lane_allowed_scopes: [{ type: 'network', posture: 'off' }],
          task_declared_scopes: [{ type: 'network', posture: 'off' }],
        },
      ),
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SUBPROCESS_NOT_AVAILABLE');
    expect(result.error?.message).toContain('no subprocess dispatcher was configured');
  });

  it('rejects reserved .lumenflow write scopes declared by tool capabilities', async () => {
    const reservedScope: ToolScope = {
      type: 'path',
      pattern: '.lumenflow/state/**',
      access: 'write',
    };

    const registry = new ToolRegistry();
    registry.register({
      ...makeInProcessCapability(),
      name: 'state:write',
      required_scopes: [reservedScope],
    });

    const evidenceStore = new EvidenceStore({ evidenceRoot });
    const host = new ToolHost({
      registry,
      evidenceStore,
    });

    const result = await host.execute(
      'state:write',
      {
        path: '.lumenflow/state/wu-events.jsonl',
        content: 'blocked',
      },
      makeExecutionContext(
        {
          allowed_scopes: [reservedScope],
        },
        {
          workspace_allowed_scopes: [reservedScope],
          lane_allowed_scopes: [reservedScope],
          task_declared_scopes: [reservedScope],
        },
      ),
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SCOPE_DENIED');
    expect(result.error?.message).toContain('.lumenflow');

    const traces = await evidenceStore.readTraces();
    const finished = traces.find((trace) => trace.kind === 'tool_call_finished');
    expect(finished).toBeDefined();
    if (finished?.kind === 'tool_call_finished') {
      expect(finished.result).toBe('denied');
      expect(
        finished.policy_decisions.some(
          (decision) => decision.policy_id === 'kernel.scope.reserved-path',
        ),
      ).toBe(true);
    }
  });

  it('does not reconcile orphaned traces on every execute call', async () => {
    const registry = new ToolRegistry();
    registry.register(makeInProcessCapability());

    const evidenceStore = new EvidenceStore({ evidenceRoot });
    const reconcileSpy = vi.spyOn(evidenceStore, 'reconcileOrphanedStarts');
    const host = new ToolHost({
      registry,
      evidenceStore,
    });

    const result = await host.execute(
      'fs:write',
      {
        path: 'packages/@lumenflow/kernel/src/tool-host/index.ts',
        content: 'ok',
      },
      makeExecutionContext(),
    );

    expect(result.success).toBe(true);
    expect(reconcileSpy).not.toHaveBeenCalled();
  });

  it('runs orphan reconciliation in startup and shutdown lifecycle hooks', async () => {
    const registry = new ToolRegistry();
    registry.register(makeInProcessCapability());

    const evidenceStore = new EvidenceStore({ evidenceRoot });
    const reconcileSpy = vi.spyOn(evidenceStore, 'reconcileOrphanedStarts');
    const host = new ToolHost({
      registry,
      evidenceStore,
    });

    await host.onStartup();
    await host.onShutdown();

    expect(reconcileSpy).toHaveBeenCalledTimes(2);
  });
});
