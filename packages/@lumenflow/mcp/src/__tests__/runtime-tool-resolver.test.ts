import path from 'node:path';
import {
  TOOL_HANDLER_KINDS,
  type ExecutionContext,
  type RuntimeToolCapabilityResolverInput,
} from '@lumenflow/kernel';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isInProcessPackToolRegistered,
  listInProcessPackTools,
  packToolCapabilityResolver,
} from '../runtime-tool-resolver.js';
import {
  buildExecutionContext,
  executeViaPack,
  resetExecuteViaPackRuntimeCache,
} from '../tools-shared.js';

const READ_SCOPE = {
  type: 'path' as const,
  pattern: '**',
  access: 'read' as const,
};

function createResolverInput(toolName: string): RuntimeToolCapabilityResolverInput {
  return {
    workspaceSpec: {
      id: 'workspace-runtime-resolver-tests',
      name: 'Runtime Resolver Tests',
      packs: [
        {
          id: 'software-delivery',
          version: '0.1.0',
          integrity: 'dev',
          source: 'local',
        },
      ],
      lanes: [
        {
          id: 'framework-core-lifecycle',
          title: 'Framework Core Lifecycle',
          allowed_scopes: [READ_SCOPE],
        },
      ],
      security: {
        allowed_scopes: [READ_SCOPE],
        network_default: 'off',
        deny_overlays: [],
      },
      memory_namespace: 'mem',
      event_namespace: 'evt',
    },
    loadedPack: {
      pin: {
        id: 'software-delivery',
        version: '0.1.0',
        integrity: 'dev',
        source: 'local',
      },
      manifest: {
        id: 'software-delivery',
        version: '0.1.0',
        task_types: ['work-unit'],
        tools: [],
        policies: [],
        evidence_types: [],
        state_aliases: {},
        lane_templates: [],
      },
      packRoot: path.resolve('/tmp/lumenflow-runtime-resolver-tests/software-delivery'),
      integrity: 'test-integrity',
    },
    tool: {
      name: toolName,
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [READ_SCOPE],
    },
  };
}

describe('packToolCapabilityResolver', () => {
  beforeEach(() => {
    resetExecuteViaPackRuntimeCache();
  });

  it('returns in-process capability for registered tools', async () => {
    const input = createResolverInput('wu:status');
    const capability = await packToolCapabilityResolver(input);

    expect(capability).toBeDefined();
    expect(isInProcessPackToolRegistered(input.tool.name)).toBe(true);
    expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.IN_PROCESS);
    expect(capability?.permission).toBe('read');
    expect(capability?.required_scopes).toEqual([READ_SCOPE]);

    const executionContext: ExecutionContext = {
      run_id: 'run-wu-status-1',
      task_id: 'WU-1797',
      session_id: 'session-runtime-resolver-tests',
      allowed_scopes: [READ_SCOPE],
    };

    const output = await capability?.handler.fn({}, executionContext);
    expect(output?.success).toBe(false);
    expect(output?.error?.code).toBe('RUNTIME_TOOL_NOT_MIGRATED');
  });

  it('lists registered in-process pack tools', () => {
    expect(listInProcessPackTools()).toContain('wu:status');
  });

  it('falls back to default subprocess capability for unregistered tools', async () => {
    const input = createResolverInput('tool:unknown');
    const capability = await packToolCapabilityResolver(input);

    expect(isInProcessPackToolRegistered(input.tool.name)).toBe(false);
    expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.SUBPROCESS);
    if (capability?.handler.kind === TOOL_HANDLER_KINDS.SUBPROCESS) {
      expect(capability.handler.entry).toContain('tool-impl/pending-runtime-tools.ts');
    }
  });

  it('builds a maintenance execution context when task identity is omitted', () => {
    const context = buildExecutionContext({
      now: () => new Date('2026-02-18T00:00:00.000Z'),
    });

    expect(context.task_id).toContain('maintenance');
    expect(context.run_id).toContain(context.task_id);
    expect(context.session_id).toContain('session-maintenance');
    expect(context.allowed_scopes).toEqual([{ type: 'path', pattern: '**', access: 'write' }]);
    expect(context.metadata?.invocation_mode).toBe('maintenance');
  });

  it('builds a task-scoped execution context when task identity is provided', () => {
    const context = buildExecutionContext({
      taskId: 'WU-1798',
      runId: 'run-WU-1798-1',
      sessionId: 'session-WU-1798',
      allowedScopes: [READ_SCOPE],
      metadata: { source: 'unit-test' },
    });

    expect(context.task_id).toBe('WU-1798');
    expect(context.run_id).toBe('run-WU-1798-1');
    expect(context.session_id).toBe('session-WU-1798');
    expect(context.allowed_scopes).toEqual([READ_SCOPE]);
    expect(context.metadata?.invocation_mode).toBe('task');
    expect(context.metadata?.source).toBe('unit-test');
  });

  it('prefers runtime execution in executeViaPack when runtime succeeds', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { via: 'runtime' },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const result = await executeViaPack(
      'wu:status',
      { id: 'WU-1798' },
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({
          taskId: 'WU-1798',
          runId: 'run-WU-1798-1',
          sessionId: 'session-WU-1798',
          allowedScopes: [READ_SCOPE],
        }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'wu:status',
          args: ['--id', 'WU-1798'],
          errorCode: 'WU_STATUS_ERROR',
        },
      },
    );

    expect(runtimeFactory).toHaveBeenCalledTimes(1);
    expect(runtimeExecuteTool).toHaveBeenCalledTimes(1);
    expect(cliRunner).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect((result.data as { success: boolean }).success).toBe(true);
  });

  it('falls back to CLI execution in executeViaPack when runtime fails', async () => {
    const runtimeFactory = vi.fn().mockRejectedValue(new Error('runtime unavailable'));
    const cliRunner = vi.fn().mockResolvedValue({
      success: true,
      stdout: 'fallback path',
      stderr: '',
      exitCode: 0,
    });

    const result = await executeViaPack(
      'wu:status',
      { id: 'WU-1798' },
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'wu:status',
          args: ['--id', 'WU-1798'],
          errorCode: 'WU_STATUS_ERROR',
        },
      },
    );

    expect(runtimeFactory).toHaveBeenCalledTimes(1);
    expect(cliRunner).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect((result.data as { message: string }).message).toContain('fallback path');
  });
});
