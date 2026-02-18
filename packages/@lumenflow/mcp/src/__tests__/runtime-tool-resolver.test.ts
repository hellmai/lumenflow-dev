import path from 'node:path';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
const WRITE_SCOPE = {
  type: 'path' as const,
  pattern: '**',
  access: 'write' as const,
};
const RUNTIME_PROJECT_ROOT_KEY = 'project_root';
const FILE_TOOL_NAMES = {
  READ: 'file:read',
  WRITE: 'file:write',
  EDIT: 'file:edit',
  DELETE: 'file:delete',
} as const;
const STATE_SIGNAL_TOOL_NAMES = {
  BACKLOG_PRUNE: 'backlog:prune',
  STATE_BOOTSTRAP: 'state:bootstrap',
  STATE_CLEANUP: 'state:cleanup',
  STATE_DOCTOR: 'state:doctor',
  SIGNAL_CLEANUP: 'signal:cleanup',
} as const;
const ORCHESTRATION_QUERY_TOOL_NAMES = {
  INIT_STATUS: 'orchestrate:init-status',
  MONITOR: 'orchestrate:monitor',
  DELEGATION_LIST: 'delegation:list',
} as const;

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
  let tempRoot = '';

  beforeEach(() => {
    resetExecuteViaPackRuntimeCache();
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = '';
    }
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

  it('resolves file tools to in-process handlers', async () => {
    const toolNames = [
      FILE_TOOL_NAMES.READ,
      FILE_TOOL_NAMES.WRITE,
      FILE_TOOL_NAMES.EDIT,
      FILE_TOOL_NAMES.DELETE,
    ];

    for (const toolName of toolNames) {
      const capability = await packToolCapabilityResolver(createResolverInput(toolName));
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.IN_PROCESS);
      expect(isInProcessPackToolRegistered(toolName)).toBe(true);
    }
  });

  it('resolves state/signal tools to in-process handlers', async () => {
    const toolNames = [
      STATE_SIGNAL_TOOL_NAMES.BACKLOG_PRUNE,
      STATE_SIGNAL_TOOL_NAMES.STATE_BOOTSTRAP,
      STATE_SIGNAL_TOOL_NAMES.STATE_CLEANUP,
      STATE_SIGNAL_TOOL_NAMES.STATE_DOCTOR,
      STATE_SIGNAL_TOOL_NAMES.SIGNAL_CLEANUP,
    ];

    for (const toolName of toolNames) {
      const capability = await packToolCapabilityResolver(createResolverInput(toolName));
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.IN_PROCESS);
      expect(isInProcessPackToolRegistered(toolName)).toBe(true);
    }
  });

  it('resolves orchestration query tools to in-process handlers', async () => {
    const toolNames = [
      ORCHESTRATION_QUERY_TOOL_NAMES.INIT_STATUS,
      ORCHESTRATION_QUERY_TOOL_NAMES.MONITOR,
      ORCHESTRATION_QUERY_TOOL_NAMES.DELEGATION_LIST,
    ];

    for (const toolName of toolNames) {
      const capability = await packToolCapabilityResolver(createResolverInput(toolName));
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.IN_PROCESS);
      expect(isInProcessPackToolRegistered(toolName)).toBe(true);
    }
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

  it('executes file write/read/edit/delete handlers in-process', async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'lumenflow-runtime-file-tools-'));
    const nestedPath = 'nested/file.txt';
    const context: ExecutionContext = {
      run_id: 'run-file-tools-1',
      task_id: 'WU-1799',
      session_id: 'session-file-tools-1',
      allowed_scopes: [WRITE_SCOPE],
      metadata: {
        [RUNTIME_PROJECT_ROOT_KEY]: tempRoot,
      },
    };

    const writeCapability = await packToolCapabilityResolver(
      createResolverInput(FILE_TOOL_NAMES.WRITE),
    );
    const readCapability = await packToolCapabilityResolver(
      createResolverInput(FILE_TOOL_NAMES.READ),
    );
    const editCapability = await packToolCapabilityResolver(
      createResolverInput(FILE_TOOL_NAMES.EDIT),
    );
    const deleteCapability = await packToolCapabilityResolver(
      createResolverInput(FILE_TOOL_NAMES.DELETE),
    );

    expect(writeCapability?.handler.kind).toBe(TOOL_HANDLER_KINDS.IN_PROCESS);
    expect(readCapability?.handler.kind).toBe(TOOL_HANDLER_KINDS.IN_PROCESS);
    expect(editCapability?.handler.kind).toBe(TOOL_HANDLER_KINDS.IN_PROCESS);
    expect(deleteCapability?.handler.kind).toBe(TOOL_HANDLER_KINDS.IN_PROCESS);

    if (
      !writeCapability ||
      !readCapability ||
      !editCapability ||
      !deleteCapability ||
      writeCapability.handler.kind !== TOOL_HANDLER_KINDS.IN_PROCESS ||
      readCapability.handler.kind !== TOOL_HANDLER_KINDS.IN_PROCESS ||
      editCapability.handler.kind !== TOOL_HANDLER_KINDS.IN_PROCESS ||
      deleteCapability.handler.kind !== TOOL_HANDLER_KINDS.IN_PROCESS
    ) {
      throw new Error('Expected all file tools to resolve to in-process handlers');
    }

    const writeResult = await writeCapability.handler.fn(
      {
        path: nestedPath,
        content: 'hello world',
      },
      context,
    );
    expect(writeResult.success).toBe(true);

    const readResult = await readCapability.handler.fn(
      {
        path: nestedPath,
      },
      context,
    );
    expect(readResult.success).toBe(true);
    expect((readResult.data as { content: string }).content).toBe('hello world');

    const editResult = await editCapability.handler.fn(
      {
        path: nestedPath,
        old_string: 'hello',
        new_string: 'goodbye',
      },
      context,
    );
    expect(editResult.success).toBe(true);

    const editedContent = await readFile(path.join(tempRoot, nestedPath), 'utf-8');
    expect(editedContent).toBe('goodbye world');

    const deleteResult = await deleteCapability.handler.fn(
      {
        path: nestedPath,
        force: true,
      },
      context,
    );
    expect(deleteResult.success).toBe(true);

    await expect(stat(path.join(tempRoot, nestedPath))).rejects.toThrow();
  });
});

/**
 * WU-1803: Tests for flow, metrics, and context tool in-process handler registration
 */
describe('WU-1803: flow/metrics/context tool registration', () => {
  const FLOW_METRICS_CONTEXT_TOOLS = [
    'flow:bottlenecks',
    'flow:report',
    'metrics:snapshot',
    'lumenflow:metrics',
    'metrics',
    'context:get',
    'wu:list',
  ] as const;

  it.each(FLOW_METRICS_CONTEXT_TOOLS)('registers %s as an in-process pack tool', (toolName) => {
    expect(isInProcessPackToolRegistered(toolName)).toBe(true);
  });

  it('lists all flow/metrics/context tools in the registry', () => {
    const registeredTools = listInProcessPackTools();
    for (const toolName of FLOW_METRICS_CONTEXT_TOOLS) {
      expect(registeredTools).toContain(toolName);
    }
  });

  it.each(FLOW_METRICS_CONTEXT_TOOLS)(
    'resolves %s to an in-process handler via packToolCapabilityResolver',
    async (toolName) => {
      const input = createResolverInput(toolName);
      const capability = await packToolCapabilityResolver(input);

      expect(capability).toBeDefined();
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.IN_PROCESS);
    },
  );
});

/**
 * WU-1804: Tests for orchestration/delegation query tool in-process registration
 */
describe('WU-1804: orchestration/delegation query tool registration', () => {
  const ORCHESTRATION_QUERY_TOOLS = [
    ORCHESTRATION_QUERY_TOOL_NAMES.INIT_STATUS,
    ORCHESTRATION_QUERY_TOOL_NAMES.MONITOR,
    ORCHESTRATION_QUERY_TOOL_NAMES.DELEGATION_LIST,
  ] as const;

  it.each(ORCHESTRATION_QUERY_TOOLS)('registers %s as an in-process pack tool', (toolName) => {
    expect(isInProcessPackToolRegistered(toolName)).toBe(true);
  });

  it('lists all orchestration/delegation query tools in the registry', () => {
    const registeredTools = listInProcessPackTools();
    for (const toolName of ORCHESTRATION_QUERY_TOOLS) {
      expect(registeredTools).toContain(toolName);
    }
  });

  it.each(ORCHESTRATION_QUERY_TOOLS)(
    'resolves %s to an in-process handler via packToolCapabilityResolver',
    async (toolName) => {
      const input = createResolverInput(toolName);
      const capability = await packToolCapabilityResolver(input);

      expect(capability).toBeDefined();
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.IN_PROCESS);
    },
  );
});

/**
 * WU-1803: Tests for flow/metrics/context MCP tools using executeViaPack
 */
describe('WU-1803: flow/metrics/context tools use executeViaPack (not runCliCommand)', () => {
  beforeEach(() => {
    resetExecuteViaPackRuntimeCache();
  });

  it('flow_bottlenecks routes through executeViaPack runtime path', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { bottlenecks: [], criticalPath: { path: [], length: 0 } },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const result = await executeViaPack(
      'flow:bottlenecks',
      { limit: 10 },
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1803' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'flow:bottlenecks',
          args: ['--limit', '10'],
          errorCode: 'FLOW_BOTTLENECKS_ERROR',
        },
      },
    );

    expect(runtimeFactory).toHaveBeenCalledTimes(1);
    expect(runtimeExecuteTool).toHaveBeenCalledWith(
      'flow:bottlenecks',
      { limit: 10 },
      expect.objectContaining({ task_id: 'WU-1803' }),
    );
    expect(cliRunner).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('flow_report routes through executeViaPack runtime path', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { range: { start: '2026-01-01', end: '2026-02-01' } },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const result = await executeViaPack(
      'flow:report',
      { days: 30 },
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1803' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'flow:report',
          args: ['--days', '30'],
          errorCode: 'FLOW_REPORT_ERROR',
        },
      },
    );

    expect(cliRunner).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('metrics_snapshot routes through executeViaPack runtime path', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { flow: { ready: 5, inProgress: 2, blocked: 1, waiting: 0, done: 10, totalActive: 8 } },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const result = await executeViaPack(
      'metrics:snapshot',
      {},
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1803' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'metrics:snapshot',
          args: [],
          errorCode: 'METRICS_SNAPSHOT_ERROR',
        },
      },
    );

    expect(cliRunner).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('context_get routes through executeViaPack runtime path', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { location: { type: 'main' } },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const result = await executeViaPack(
      'context:get',
      {},
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1803' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'context:get',
          args: [],
          errorCode: 'CONTEXT_ERROR',
        },
      },
    );

    expect(cliRunner).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('wu_list routes through executeViaPack runtime path', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: [{ id: 'WU-1803', status: 'in_progress' }],
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const result = await executeViaPack(
      'wu:list',
      { status: 'in_progress' },
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1803' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'wu:validate',
          args: ['--all', '--json'],
          errorCode: 'WU_LIST_ERROR',
        },
      },
    );

    expect(cliRunner).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});
