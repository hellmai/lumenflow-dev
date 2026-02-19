// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EvidenceStore } from '../evidence/index.js';
import type { ExecutionContext, ToolCapability, ToolScope } from '../kernel.schemas.js';
import {
  ToolHost,
  ToolRegistry,
  allowAllPolicyHook,
  type ToolHostOptions,
} from '../tool-host/index.js';

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
      policyHook: allowAllPolicyHook,
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
      policyHook: allowAllPolicyHook,
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
      policyHook: allowAllPolicyHook,
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
      policyHook: allowAllPolicyHook,
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
      policyHook: allowAllPolicyHook,
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
      policyHook: allowAllPolicyHook,
    });

    await host.onStartup();
    await host.onShutdown();

    expect(reconcileSpy).toHaveBeenCalledTimes(2);
  });

  it('returns tool execution result even if trace recording fails', async () => {
    const registry = new ToolRegistry();
    registry.register(makeInProcessCapability());

    const evidenceStore = new EvidenceStore({ evidenceRoot });
    const host = new ToolHost({
      registry,
      evidenceStore,
      policyHook: allowAllPolicyHook,
    });

    // Spy on appendTrace to fail only on the FINISHED trace (second call)
    let appendCallCount = 0;
    const originalAppendTrace = evidenceStore.appendTrace.bind(evidenceStore);
    vi.spyOn(evidenceStore, 'appendTrace').mockImplementation(async (entry) => {
      appendCallCount++;
      // Let started trace succeed (calls 1), fail on finished trace (call 2+)
      if (appendCallCount >= 2) {
        throw new Error('Simulated disk failure during trace recording');
      }
      return originalAppendTrace(entry);
    });

    const result = await host.execute(
      'fs:write',
      {
        path: 'packages/@lumenflow/kernel/src/tool-host/index.ts',
        content: 'ok',
      },
      makeExecutionContext(),
    );

    // The tool execution succeeded, so we should get the result back
    // even though trace recording failed
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ written: true });
  });

  describe('trace infrastructure resilience', () => {
    it('continues tool execution when STARTED trace write fails', async () => {
      const registry = new ToolRegistry();
      registry.register(makeInProcessCapability());

      const evidenceStore = new EvidenceStore({ evidenceRoot });
      const host = new ToolHost({
        registry,
        evidenceStore,
        policyHook: allowAllPolicyHook,
      });

      // Fail on the very first appendTrace call (the STARTED trace)
      vi.spyOn(evidenceStore, 'appendTrace').mockRejectedValue(
        new Error('Simulated disk failure during started trace'),
      );

      const result = await host.execute(
        'fs:write',
        {
          path: 'packages/@lumenflow/kernel/src/tool-host/index.ts',
          content: 'ok',
        },
        makeExecutionContext(),
      );

      // Tool should still execute and return its result
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ written: true });
    });

    it('returns denied output when scope-denied trace write fails', async () => {
      const registry = new ToolRegistry();
      registry.register(makeInProcessCapability());

      const evidenceStore = new EvidenceStore({ evidenceRoot });
      const host = new ToolHost({
        registry,
        evidenceStore,
        policyHook: allowAllPolicyHook,
      });

      // Let started trace succeed, fail on denied trace (second call)
      let appendCallCount = 0;
      const originalAppendTrace = evidenceStore.appendTrace.bind(evidenceStore);
      vi.spyOn(evidenceStore, 'appendTrace').mockImplementation(async (entry) => {
        appendCallCount++;
        if (appendCallCount >= 2) {
          throw new Error('Simulated disk failure during denied trace');
        }
        return originalAppendTrace(entry);
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

      // The denied output must still be returned to the caller
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SCOPE_DENIED');
    });

    it('returns denied output when reserved-scope denied trace write fails', async () => {
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
        policyHook: allowAllPolicyHook,
      });

      // Let started trace succeed, fail on denied trace (second call)
      let appendCallCount = 0;
      const originalAppendTrace = evidenceStore.appendTrace.bind(evidenceStore);
      vi.spyOn(evidenceStore, 'appendTrace').mockImplementation(async (entry) => {
        appendCallCount++;
        if (appendCallCount >= 2) {
          throw new Error('Simulated disk failure during reserved-scope denied trace');
        }
        return originalAppendTrace(entry);
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

      // The denied output must still be returned
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SCOPE_DENIED');
      expect(result.error?.message).toContain('.lumenflow');
    });

    it('returns denied output when policy-denied trace write fails', async () => {
      const registry = new ToolRegistry();
      registry.register(makeInProcessCapability());

      const evidenceStore = new EvidenceStore({ evidenceRoot });
      const host = new ToolHost({
        registry,
        evidenceStore,
        policyHook: async () => [
          {
            policy_id: 'test.deny',
            decision: 'deny' as const,
            reason: 'Test policy denial',
          },
        ],
      });

      // Let started trace succeed, fail on denied trace (second call)
      let appendCallCount = 0;
      const originalAppendTrace = evidenceStore.appendTrace.bind(evidenceStore);
      vi.spyOn(evidenceStore, 'appendTrace').mockImplementation(async (entry) => {
        appendCallCount++;
        if (appendCallCount >= 2) {
          throw new Error('Simulated disk failure during policy denied trace');
        }
        return originalAppendTrace(entry);
      });

      const result = await host.execute(
        'fs:write',
        {
          path: 'packages/@lumenflow/kernel/src/tool-host/index.ts',
          content: 'denied-by-policy',
        },
        makeExecutionContext(),
      );

      // The policy-denied output must still be returned
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('POLICY_DENIED');
    });

    it('returns failure output when input-validation denied trace write fails', async () => {
      const registry = new ToolRegistry();
      registry.register(makeInProcessCapability());

      const evidenceStore = new EvidenceStore({ evidenceRoot });
      const host = new ToolHost({
        registry,
        evidenceStore,
        policyHook: allowAllPolicyHook,
      });

      // Let started trace succeed, fail on denied trace (second call)
      let appendCallCount = 0;
      const originalAppendTrace = evidenceStore.appendTrace.bind(evidenceStore);
      vi.spyOn(evidenceStore, 'appendTrace').mockImplementation(async (entry) => {
        appendCallCount++;
        if (appendCallCount >= 2) {
          throw new Error('Simulated disk failure during input validation denied trace');
        }
        return originalAppendTrace(entry);
      });

      // Pass invalid input (missing 'content' field) to trigger input validation failure
      const result = await host.execute(
        'fs:write',
        {
          path: 'packages/@lumenflow/kernel/src/tool-host/index.ts',
          // missing 'content' - invalid input
        },
        makeExecutionContext(),
      );

      // The input validation failure output must still be returned
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_INPUT');
    });
  });

  describe('injectable clock', () => {
    const FIXED_DATE = new Date('2026-01-15T12:00:00.000Z');

    it('uses injected clock for all trace timestamps', async () => {
      const registry = new ToolRegistry();
      registry.register(makeInProcessCapability());

      const evidenceStore = new EvidenceStore({ evidenceRoot });
      const host = new ToolHost({
        registry,
        evidenceStore,
        policyHook: allowAllPolicyHook,
        now: () => FIXED_DATE,
      });

      await host.execute(
        'fs:write',
        {
          path: 'packages/@lumenflow/kernel/src/tool-host/index.ts',
          content: 'ok',
        },
        makeExecutionContext(),
      );

      const traces = await evidenceStore.readTraces();
      expect(traces).toHaveLength(2);
      for (const trace of traces) {
        expect(trace.timestamp).toBe('2026-01-15T12:00:00.000Z');
      }
    });

    it('uses injected clock for denial trace timestamps', async () => {
      const registry = new ToolRegistry();
      registry.register(makeInProcessCapability());

      const evidenceStore = new EvidenceStore({ evidenceRoot });
      const host = new ToolHost({
        registry,
        evidenceStore,
        policyHook: allowAllPolicyHook,
        now: () => FIXED_DATE,
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
      const traces = await evidenceStore.readTraces();
      for (const trace of traces) {
        expect(trace.timestamp).toBe('2026-01-15T12:00:00.000Z');
      }
    });

    it('uses injected clock for duration_ms calculation', async () => {
      let callCount = 0;
      const advancingClock = () => {
        callCount++;
        // First call: startedAt. Second call: finished timestamp.
        return new Date(FIXED_DATE.getTime() + (callCount - 1) * 42);
      };

      const registry = new ToolRegistry();
      registry.register(makeInProcessCapability());

      const evidenceStore = new EvidenceStore({ evidenceRoot });
      const host = new ToolHost({
        registry,
        evidenceStore,
        policyHook: allowAllPolicyHook,
        now: advancingClock,
      });

      await host.execute(
        'fs:write',
        {
          path: 'packages/@lumenflow/kernel/src/tool-host/index.ts',
          content: 'ok',
        },
        makeExecutionContext(),
      );

      const traces = await evidenceStore.readTraces();
      const finished = traces.find((trace) => trace.kind === 'tool_call_finished');
      if (finished?.kind === 'tool_call_finished') {
        expect(finished.duration_ms).toBeGreaterThanOrEqual(0);
      }
    });

    it('defaults to real clock when now is not provided', async () => {
      const registry = new ToolRegistry();
      registry.register(makeInProcessCapability());

      const evidenceStore = new EvidenceStore({ evidenceRoot });
      const host = new ToolHost({
        registry,
        evidenceStore,
        policyHook: allowAllPolicyHook,
        // no `now` option — should use real Date
      });

      const before = new Date().toISOString();
      await host.execute(
        'fs:write',
        {
          path: 'packages/@lumenflow/kernel/src/tool-host/index.ts',
          content: 'ok',
        },
        makeExecutionContext(),
      );
      const after = new Date().toISOString();

      const traces = await evidenceStore.readTraces();
      for (const trace of traces) {
        expect(trace.timestamp >= before).toBe(true);
        expect(trace.timestamp <= after).toBe(true);
      }
    });

    it('computes duration_ms from single now() capture to avoid clock skew', async () => {
      // The clock advances 100ms per call. If now() is called twice for
      // timestamp and duration_ms independently, the duration would reflect
      // the skew between two different calls. With the fix, duration_ms
      // should be exactly (finishedAt - startedAt) from a single pair.
      let callCount = 0;
      const advancingClock = () => {
        callCount++;
        return new Date(FIXED_DATE.getTime() + (callCount - 1) * 100);
      };

      const registry = new ToolRegistry();
      registry.register(makeInProcessCapability());

      const evidenceStore = new EvidenceStore({ evidenceRoot });
      const host = new ToolHost({
        registry,
        evidenceStore,
        policyHook: allowAllPolicyHook,
        now: advancingClock,
      });

      await host.execute(
        'fs:write',
        {
          path: 'packages/@lumenflow/kernel/src/tool-host/index.ts',
          content: 'ok',
        },
        makeExecutionContext(),
      );

      const traces = await evidenceStore.readTraces();
      const finished = traces.find((trace) => trace.kind === 'tool_call_finished');
      expect(finished).toBeDefined();
      if (finished?.kind === 'tool_call_finished') {
        // The finished trace's timestamp and duration_ms should be consistent:
        // timestamp should come from one now() call and duration_ms from
        // (that same call's getTime() - startedAt). They should NOT involve
        // separate now() calls for timestamp vs duration_ms.
        const finishedTimestamp = Date.parse(finished.timestamp);
        const started = traces.find((trace) => trace.kind === 'tool_call_started');
        expect(started).toBeDefined();
        const startedTimestamp = Date.parse(started!.timestamp);
        // duration_ms should equal finishedTimestamp - startedTimestamp
        expect(finished.duration_ms).toBe(finishedTimestamp - startedTimestamp);
      }
    });

    it('computes denied trace duration_ms from single now() capture', async () => {
      let callCount = 0;
      const advancingClock = () => {
        callCount++;
        return new Date(FIXED_DATE.getTime() + (callCount - 1) * 100);
      };

      const registry = new ToolRegistry();
      registry.register(makeInProcessCapability());

      const evidenceStore = new EvidenceStore({ evidenceRoot });
      const host = new ToolHost({
        registry,
        evidenceStore,
        policyHook: allowAllPolicyHook,
        now: advancingClock,
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
      const traces = await evidenceStore.readTraces();
      const finished = traces.find((trace) => trace.kind === 'tool_call_finished');
      expect(finished).toBeDefined();
      if (finished?.kind === 'tool_call_finished') {
        const finishedTimestamp = Date.parse(finished.timestamp);
        const started = traces.find((trace) => trace.kind === 'tool_call_started');
        expect(started).toBeDefined();
        const startedTimestamp = Date.parse(started!.timestamp);
        expect(finished.duration_ms).toBe(finishedTimestamp - startedTimestamp);
      }
    });

    it('uses injected clock for policy denial trace timestamps', async () => {
      const registry = new ToolRegistry();
      registry.register(makeInProcessCapability());

      const evidenceStore = new EvidenceStore({ evidenceRoot });
      const host = new ToolHost({
        registry,
        evidenceStore,
        now: () => FIXED_DATE,
        policyHook: async () => [
          {
            policy_id: 'test.deny',
            decision: 'deny' as const,
            reason: 'Test policy denial',
          },
        ],
      });

      const result = await host.execute(
        'fs:write',
        {
          path: 'packages/@lumenflow/kernel/src/tool-host/index.ts',
          content: 'denied-by-policy',
        },
        makeExecutionContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('POLICY_DENIED');

      const traces = await evidenceStore.readTraces();
      for (const trace of traces) {
        expect(trace.timestamp).toBe('2026-01-15T12:00:00.000Z');
      }
    });
  });

  describe('policy construction safety', () => {
    it('throws descriptive error when constructed without explicit policyHook', () => {
      const registry = new ToolRegistry();
      const evidenceStore = new EvidenceStore({ evidenceRoot });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- testing runtime guard for JS callers
      expect(() => new ToolHost({ registry, evidenceStore } as any)).toThrow(/policyHook/);
    });

    it('accepts explicit allowAllPolicyHook without throwing', () => {
      const registry = new ToolRegistry();
      const evidenceStore = new EvidenceStore({ evidenceRoot });

      expect(
        () =>
          new ToolHost({
            registry,
            evidenceStore,
            policyHook: allowAllPolicyHook,
          }),
      ).not.toThrow();
    });

    it('accepts custom policy hook without throwing', () => {
      const registry = new ToolRegistry();
      const evidenceStore = new EvidenceStore({ evidenceRoot });

      const customPolicy = async () => [
        {
          policy_id: 'custom.allow' as const,
          decision: 'allow' as const,
          reason: 'Custom policy',
        },
      ];

      expect(
        () =>
          new ToolHost({
            registry,
            evidenceStore,
            policyHook: customPolicy,
          }),
      ).not.toThrow();
    });
  });

  describe('onTraceError callback', () => {
    it('accepts optional onTraceError in ToolHostOptions', () => {
      const registry = new ToolRegistry();
      const evidenceStore = new EvidenceStore({ evidenceRoot });

      const options: ToolHostOptions = {
        registry,
        evidenceStore,
        policyHook: allowAllPolicyHook,
        onTraceError: () => {},
      };

      expect(() => new ToolHost(options)).not.toThrow();
    });

    it('invokes onTraceError when STARTED trace write fails', async () => {
      const registry = new ToolRegistry();
      registry.register(makeInProcessCapability());

      const evidenceStore = new EvidenceStore({ evidenceRoot });
      const traceErrors: Error[] = [];
      const host = new ToolHost({
        registry,
        evidenceStore,
        policyHook: allowAllPolicyHook,
        onTraceError: (error: Error) => {
          traceErrors.push(error);
        },
      });

      // Fail only on the first appendTrace call (STARTED trace)
      let appendCallCount = 0;
      const originalAppendTrace = evidenceStore.appendTrace.bind(evidenceStore);
      vi.spyOn(evidenceStore, 'appendTrace').mockImplementation(async (entry) => {
        appendCallCount++;
        if (appendCallCount === 1) {
          throw new Error('Simulated started trace failure');
        }
        return originalAppendTrace(entry);
      });

      const result = await host.execute(
        'fs:write',
        {
          path: 'packages/@lumenflow/kernel/src/tool-host/index.ts',
          content: 'ok',
        },
        makeExecutionContext(),
      );

      // Tool should still succeed
      expect(result.success).toBe(true);
      // The callback should have been invoked exactly once for the STARTED trace
      expect(traceErrors).toHaveLength(1);
      expect(traceErrors[0]!.message).toBe('Simulated started trace failure');
    });

    it('invokes onTraceError when FINISHED trace write fails', async () => {
      const registry = new ToolRegistry();
      registry.register(makeInProcessCapability());

      const evidenceStore = new EvidenceStore({ evidenceRoot });
      const traceErrors: Error[] = [];
      const host = new ToolHost({
        registry,
        evidenceStore,
        policyHook: allowAllPolicyHook,
        onTraceError: (error: Error) => {
          traceErrors.push(error);
        },
      });

      // Let started trace succeed, fail on finished trace
      let appendCallCount = 0;
      const originalAppendTrace = evidenceStore.appendTrace.bind(evidenceStore);
      vi.spyOn(evidenceStore, 'appendTrace').mockImplementation(async (entry) => {
        appendCallCount++;
        if (appendCallCount >= 2) {
          throw new Error('Simulated finished trace failure');
        }
        return originalAppendTrace(entry);
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
      expect(traceErrors).toHaveLength(1);
      expect(traceErrors[0]!.message).toBe('Simulated finished trace failure');
    });

    it('invokes onTraceError when scope-denied trace write fails', async () => {
      const registry = new ToolRegistry();
      registry.register(makeInProcessCapability());

      const evidenceStore = new EvidenceStore({ evidenceRoot });
      const traceErrors: Error[] = [];
      const host = new ToolHost({
        registry,
        evidenceStore,
        policyHook: allowAllPolicyHook,
        onTraceError: (error: Error) => {
          traceErrors.push(error);
        },
      });

      // Let started trace succeed, fail on denied trace
      let appendCallCount = 0;
      const originalAppendTrace = evidenceStore.appendTrace.bind(evidenceStore);
      vi.spyOn(evidenceStore, 'appendTrace').mockImplementation(async (entry) => {
        appendCallCount++;
        if (appendCallCount >= 2) {
          throw new Error('Simulated denied trace failure');
        }
        return originalAppendTrace(entry);
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
      expect(traceErrors).toHaveLength(1);
      expect(traceErrors[0]!.message).toBe('Simulated denied trace failure');
    });

    it('invokes onTraceError when reserved-scope denied trace write fails', async () => {
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
      const traceErrors: Error[] = [];
      const host = new ToolHost({
        registry,
        evidenceStore,
        policyHook: allowAllPolicyHook,
        onTraceError: (error: Error) => {
          traceErrors.push(error);
        },
      });

      // Let started trace succeed, fail on denied trace
      let appendCallCount = 0;
      const originalAppendTrace = evidenceStore.appendTrace.bind(evidenceStore);
      vi.spyOn(evidenceStore, 'appendTrace').mockImplementation(async (entry) => {
        appendCallCount++;
        if (appendCallCount >= 2) {
          throw new Error('Simulated reserved denied trace failure');
        }
        return originalAppendTrace(entry);
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
      expect(traceErrors).toHaveLength(1);
      expect(traceErrors[0]!.message).toBe('Simulated reserved denied trace failure');
    });

    it('invokes onTraceError when policy-denied trace write fails', async () => {
      const registry = new ToolRegistry();
      registry.register(makeInProcessCapability());

      const evidenceStore = new EvidenceStore({ evidenceRoot });
      const traceErrors: Error[] = [];
      const host = new ToolHost({
        registry,
        evidenceStore,
        policyHook: async () => [
          {
            policy_id: 'test.deny',
            decision: 'deny' as const,
            reason: 'Test policy denial',
          },
        ],
        onTraceError: (error: Error) => {
          traceErrors.push(error);
        },
      });

      // Let started trace succeed, fail on denied trace
      let appendCallCount = 0;
      const originalAppendTrace = evidenceStore.appendTrace.bind(evidenceStore);
      vi.spyOn(evidenceStore, 'appendTrace').mockImplementation(async (entry) => {
        appendCallCount++;
        if (appendCallCount >= 2) {
          throw new Error('Simulated policy denied trace failure');
        }
        return originalAppendTrace(entry);
      });

      const result = await host.execute(
        'fs:write',
        {
          path: 'packages/@lumenflow/kernel/src/tool-host/index.ts',
          content: 'denied-by-policy',
        },
        makeExecutionContext(),
      );

      expect(result.success).toBe(false);
      expect(traceErrors).toHaveLength(1);
      expect(traceErrors[0]!.message).toBe('Simulated policy denied trace failure');
    });

    it('invokes onTraceError when input-validation denied trace write fails', async () => {
      const registry = new ToolRegistry();
      registry.register(makeInProcessCapability());

      const evidenceStore = new EvidenceStore({ evidenceRoot });
      const traceErrors: Error[] = [];
      const host = new ToolHost({
        registry,
        evidenceStore,
        policyHook: allowAllPolicyHook,
        onTraceError: (error: Error) => {
          traceErrors.push(error);
        },
      });

      // Let started trace succeed, fail on denied trace
      let appendCallCount = 0;
      const originalAppendTrace = evidenceStore.appendTrace.bind(evidenceStore);
      vi.spyOn(evidenceStore, 'appendTrace').mockImplementation(async (entry) => {
        appendCallCount++;
        if (appendCallCount >= 2) {
          throw new Error('Simulated input validation denied trace failure');
        }
        return originalAppendTrace(entry);
      });

      // Pass invalid input (missing 'content' field)
      const result = await host.execute(
        'fs:write',
        {
          path: 'packages/@lumenflow/kernel/src/tool-host/index.ts',
        },
        makeExecutionContext(),
      );

      expect(result.success).toBe(false);
      expect(traceErrors).toHaveLength(1);
      expect(traceErrors[0]!.message).toBe('Simulated input validation denied trace failure');
    });

    it('does not invoke onTraceError when traces succeed', async () => {
      const registry = new ToolRegistry();
      registry.register(makeInProcessCapability());

      const evidenceStore = new EvidenceStore({ evidenceRoot });
      const traceErrors: Error[] = [];
      const host = new ToolHost({
        registry,
        evidenceStore,
        policyHook: allowAllPolicyHook,
        onTraceError: (error: Error) => {
          traceErrors.push(error);
        },
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
      expect(traceErrors).toHaveLength(0);
    });

    it('works without onTraceError (backward compatible)', async () => {
      const registry = new ToolRegistry();
      registry.register(makeInProcessCapability());

      const evidenceStore = new EvidenceStore({ evidenceRoot });
      const host = new ToolHost({
        registry,
        evidenceStore,
        policyHook: allowAllPolicyHook,
        // No onTraceError - should be backward compatible
      });

      // Fail on trace writes
      vi.spyOn(evidenceStore, 'appendTrace').mockRejectedValue(new Error('Simulated failure'));

      const result = await host.execute(
        'fs:write',
        {
          path: 'packages/@lumenflow/kernel/src/tool-host/index.ts',
          content: 'ok',
        },
        makeExecutionContext(),
      );

      // Should still work without onTraceError
      expect(result.success).toBe(true);
    });
  });
});
