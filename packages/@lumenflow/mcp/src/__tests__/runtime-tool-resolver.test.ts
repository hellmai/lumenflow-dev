import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
const WU_LIFECYCLE_INIT_TOOL_NAMES = {
  CREATE: 'wu:create',
  CLAIM: 'wu:claim',
  PROTO: 'wu:proto',
} as const;
const WU_LIFECYCLE_STATE_TOOL_NAMES = {
  BLOCK: 'wu:block',
  UNBLOCK: 'wu:unblock',
  EDIT: 'wu:edit',
  RELEASE: 'wu:release',
} as const;
const WU_LIFECYCLE_COMPLETION_TOOL_NAMES = {
  DONE: 'wu:done',
  PREP: 'wu:prep',
  SANDBOX: 'wu:sandbox',
  PRUNE: 'wu:prune',
  DELETE: 'wu:delete',
  CLEANUP: 'wu:cleanup',
} as const;
const WU_DELEGATION_AND_GATES_TOOL_NAMES = {
  BRIEF: 'wu:brief',
  DELEGATE: 'wu:delegate',
  UNLOCK_LANE: 'wu:unlock-lane',
  GATES: 'gates',
} as const;
const INITIATIVE_ORCHESTRATION_TOOL_NAMES = {
  LIST: 'initiative:list',
  STATUS: 'initiative:status',
  CREATE: 'initiative:create',
  EDIT: 'initiative:edit',
  ADD_WU: 'initiative:add-wu',
  REMOVE_WU: 'initiative:remove-wu',
  BULK_ASSIGN: 'initiative:bulk-assign',
  PLAN: 'initiative:plan',
  INIT_PLAN: 'init:plan',
  ORCHESTRATE_INITIATIVE: 'orchestrate:initiative',
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

    // WU-1805: wu:status now has a real handler — missing id returns MISSING_PARAMETER
    const output = await capability?.handler.fn({}, executionContext);
    expect(output?.success).toBe(false);
    expect(output?.error?.code).toBe('MISSING_PARAMETER');
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

  it('resolves WU lifecycle initiation tools to in-process handlers', async () => {
    const toolNames = [
      WU_LIFECYCLE_INIT_TOOL_NAMES.CREATE,
      WU_LIFECYCLE_INIT_TOOL_NAMES.CLAIM,
      WU_LIFECYCLE_INIT_TOOL_NAMES.PROTO,
    ];

    for (const toolName of toolNames) {
      const capability = await packToolCapabilityResolver(createResolverInput(toolName));
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.IN_PROCESS);
      expect(isInProcessPackToolRegistered(toolName)).toBe(true);
    }
  });

  it('resolves WU lifecycle state transition tools to in-process handlers', async () => {
    const toolNames = [
      WU_LIFECYCLE_STATE_TOOL_NAMES.BLOCK,
      WU_LIFECYCLE_STATE_TOOL_NAMES.UNBLOCK,
      WU_LIFECYCLE_STATE_TOOL_NAMES.EDIT,
      WU_LIFECYCLE_STATE_TOOL_NAMES.RELEASE,
    ];

    for (const toolName of toolNames) {
      const capability = await packToolCapabilityResolver(createResolverInput(toolName));
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.IN_PROCESS);
      expect(isInProcessPackToolRegistered(toolName)).toBe(true);
    }
  });

  it('resolves WU lifecycle completion/cleanup tools to in-process handlers', async () => {
    const toolNames = [
      WU_LIFECYCLE_COMPLETION_TOOL_NAMES.DONE,
      WU_LIFECYCLE_COMPLETION_TOOL_NAMES.PREP,
      WU_LIFECYCLE_COMPLETION_TOOL_NAMES.SANDBOX,
      WU_LIFECYCLE_COMPLETION_TOOL_NAMES.PRUNE,
      WU_LIFECYCLE_COMPLETION_TOOL_NAMES.DELETE,
      WU_LIFECYCLE_COMPLETION_TOOL_NAMES.CLEANUP,
    ];

    for (const toolName of toolNames) {
      const capability = await packToolCapabilityResolver(createResolverInput(toolName));
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.IN_PROCESS);
      expect(isInProcessPackToolRegistered(toolName)).toBe(true);
    }
  });

  it('resolves WU delegation and gates tools to in-process handlers', async () => {
    const toolNames = [
      WU_DELEGATION_AND_GATES_TOOL_NAMES.BRIEF,
      WU_DELEGATION_AND_GATES_TOOL_NAMES.DELEGATE,
      WU_DELEGATION_AND_GATES_TOOL_NAMES.UNLOCK_LANE,
      WU_DELEGATION_AND_GATES_TOOL_NAMES.GATES,
    ];

    for (const toolName of toolNames) {
      const capability = await packToolCapabilityResolver(createResolverInput(toolName));
      expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.IN_PROCESS);
      expect(isInProcessPackToolRegistered(toolName)).toBe(true);
    }
  });

  it('resolves initiative/orchestration lifecycle tools to in-process handlers', async () => {
    const toolNames = [
      INITIATIVE_ORCHESTRATION_TOOL_NAMES.LIST,
      INITIATIVE_ORCHESTRATION_TOOL_NAMES.STATUS,
      INITIATIVE_ORCHESTRATION_TOOL_NAMES.CREATE,
      INITIATIVE_ORCHESTRATION_TOOL_NAMES.EDIT,
      INITIATIVE_ORCHESTRATION_TOOL_NAMES.ADD_WU,
      INITIATIVE_ORCHESTRATION_TOOL_NAMES.REMOVE_WU,
      INITIATIVE_ORCHESTRATION_TOOL_NAMES.BULK_ASSIGN,
      INITIATIVE_ORCHESTRATION_TOOL_NAMES.PLAN,
      INITIATIVE_ORCHESTRATION_TOOL_NAMES.INIT_PLAN,
      INITIATIVE_ORCHESTRATION_TOOL_NAMES.ORCHESTRATE_INITIATIVE,
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
 * WU-1802: Tests for validation/lane tool in-process registration
 */
describe('WU-1802: validation/lane tool registration', () => {
  const VALIDATION_LANE_TOOLS = [
    'validate',
    'validate:agent-skills',
    'validate:agent-sync',
    'validate:backlog-sync',
    'validate:skills-spec',
    'lumenflow:validate',
    'lane:health',
    'lane:suggest',
  ] as const;

  it.each(VALIDATION_LANE_TOOLS)('registers %s as an in-process pack tool', (toolName) => {
    expect(isInProcessPackToolRegistered(toolName)).toBe(true);
  });

  it('lists all validation/lane tools in the registry', () => {
    const registeredTools = listInProcessPackTools();
    for (const toolName of VALIDATION_LANE_TOOLS) {
      expect(registeredTools).toContain(toolName);
    }
  });

  it.each(VALIDATION_LANE_TOOLS)(
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
 * WU-1802: Tests for validation/lane MCP tools using executeViaPack
 */
describe('WU-1802: validation/lane tools use executeViaPack (not runCliCommand)', () => {
  beforeEach(() => {
    resetExecuteViaPackRuntimeCache();
  });

  it('validate routes through executeViaPack runtime path', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { message: 'Validation passed' },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const result = await executeViaPack(
      'validate',
      { strict: true },
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1802' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'validate',
          args: ['--strict'],
          errorCode: 'VALIDATE_ERROR',
        },
      },
    );

    expect(runtimeFactory).toHaveBeenCalledTimes(1);
    expect(runtimeExecuteTool).toHaveBeenCalledWith(
      'validate',
      { strict: true },
      expect.objectContaining({ task_id: 'WU-1802' }),
    );
    expect(cliRunner).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('lane_health routes through executeViaPack runtime path', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { overlaps: [], gaps: [] },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const result = await executeViaPack(
      'lane:health',
      { json: true },
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1802' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'lane:health',
          args: ['--json'],
          errorCode: 'LANE_HEALTH_ERROR',
        },
      },
    );

    expect(cliRunner).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('lane_suggest routes through executeViaPack runtime path', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { suggestions: [] },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const result = await executeViaPack(
      'lane:suggest',
      { no_llm: true },
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1802' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'lane:suggest',
          args: ['--no-llm'],
          errorCode: 'LANE_SUGGEST_ERROR',
        },
      },
    );

    expect(cliRunner).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('validate_backlog_sync routes through executeViaPack runtime path', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { message: 'Backlog sync valid' },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const result = await executeViaPack(
      'validate:backlog-sync',
      {},
      {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1802' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: {
          command: 'validate:backlog-sync',
          args: [],
          errorCode: 'VALIDATE_BACKLOG_SYNC_ERROR',
        },
      },
    );

    expect(cliRunner).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
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

describe('WU-1808: completion/cleanup lifecycle uses runtime path end-to-end', () => {
  beforeEach(() => {
    resetExecuteViaPackRuntimeCache();
  });

  it('runs create -> claim -> prep -> done via runtime without CLI fallback', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { message: 'runtime-success' },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const lifecycleCalls = [
      {
        toolName: 'wu:create',
        input: { lane: 'Framework: Core Lifecycle', title: 'Lifecycle fixture' },
        fallback: {
          command: 'wu:create',
          args: ['--lane', 'Framework: Core Lifecycle', '--title', 'Lifecycle fixture'],
          errorCode: 'WU_CREATE_ERROR',
        },
      },
      {
        toolName: 'wu:claim',
        input: { id: 'WU-1808', lane: 'Framework: Core Lifecycle' },
        fallback: {
          command: 'wu:claim',
          args: ['--id', 'WU-1808', '--lane', 'Framework: Core Lifecycle'],
          errorCode: 'WU_CLAIM_ERROR',
        },
      },
      {
        toolName: 'wu:prep',
        input: { id: 'WU-1808' },
        fallback: {
          command: 'wu:prep',
          args: ['--id', 'WU-1808'],
          errorCode: 'WU_PREP_ERROR',
        },
      },
      {
        toolName: 'wu:done',
        input: { id: 'WU-1808' },
        fallback: {
          command: 'wu:done',
          args: ['--id', 'WU-1808'],
          errorCode: 'WU_DONE_ERROR',
        },
      },
    ] as const;

    for (const lifecycleCall of lifecycleCalls) {
      const result = await executeViaPack(lifecycleCall.toolName, lifecycleCall.input, {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1808' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: lifecycleCall.fallback,
      });

      expect(result.success).toBe(true);
    }

    expect(runtimeFactory).toHaveBeenCalledTimes(lifecycleCalls.length);
    expect(runtimeExecuteTool).toHaveBeenCalledTimes(lifecycleCalls.length);
    expect(cliRunner).not.toHaveBeenCalled();
  });
});

describe('WU-1809: delegation/gates lifecycle uses runtime path end-to-end', () => {
  beforeEach(() => {
    resetExecuteViaPackRuntimeCache();
  });

  it('runs brief -> delegate -> unlock-lane -> gates via runtime without CLI fallback', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { message: 'runtime-success' },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const lifecycleCalls = [
      {
        toolName: 'wu:brief',
        input: { id: 'WU-1809' },
        fallback: {
          command: 'wu:brief',
          args: ['--id', 'WU-1809'],
          errorCode: 'WU_BRIEF_ERROR',
        },
      },
      {
        toolName: 'wu:delegate',
        input: { id: 'WU-1809', parent_wu: 'WU-1808' },
        fallback: {
          command: 'wu:delegate',
          args: ['--id', 'WU-1809', '--parent-wu', 'WU-1808'],
          errorCode: 'WU_DELEGATE_ERROR',
        },
      },
      {
        toolName: 'wu:unlock-lane',
        input: { lane: 'Framework: Core Lifecycle' },
        fallback: {
          command: 'wu:unlock-lane',
          args: ['--lane', 'Framework: Core Lifecycle'],
          errorCode: 'WU_UNLOCK_LANE_ERROR',
        },
      },
      {
        toolName: 'gates',
        input: { docs_only: true },
        fallback: {
          command: 'gates',
          args: ['--docs-only'],
          errorCode: 'GATES_ERROR',
        },
      },
    ] as const;

    for (const lifecycleCall of lifecycleCalls) {
      const result = await executeViaPack(lifecycleCall.toolName, lifecycleCall.input, {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1809' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: lifecycleCall.fallback,
      });

      expect(result.success).toBe(true);
    }

    expect(runtimeFactory).toHaveBeenCalledTimes(lifecycleCalls.length);
    expect(runtimeExecuteTool).toHaveBeenCalledTimes(lifecycleCalls.length);
    expect(cliRunner).not.toHaveBeenCalled();
  });
});

describe('WU-1810: initiative/orchestration lifecycle uses runtime path end-to-end', () => {
  beforeEach(() => {
    resetExecuteViaPackRuntimeCache();
  });

  it('runs initiative and orchestrate tools via runtime without CLI fallback', async () => {
    const runtimeExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: { message: 'runtime-success' },
    });
    const runtimeFactory = vi.fn().mockResolvedValue({
      executeTool: runtimeExecuteTool,
    });
    const cliRunner = vi.fn();

    const lifecycleCalls = [
      {
        toolName: 'initiative:list',
        input: {},
        fallback: {
          command: 'initiative:list',
          args: [],
          errorCode: 'INITIATIVE_LIST_ERROR',
        },
      },
      {
        toolName: 'initiative:status',
        input: { id: 'INIT-030' },
        fallback: {
          command: 'initiative:status',
          args: ['--id', 'INIT-030'],
          errorCode: 'INITIATIVE_STATUS_ERROR',
        },
      },
      {
        toolName: 'initiative:create',
        input: {
          id: 'INIT-030',
          slug: 'kernel-runtime-adoption',
          title: 'KernelRuntime Adoption',
        },
        fallback: {
          command: 'initiative:create',
          args: [
            '--id',
            'INIT-030',
            '--slug',
            'kernel-runtime-adoption',
            '--title',
            'KernelRuntime Adoption',
          ],
          errorCode: 'INITIATIVE_CREATE_ERROR',
        },
      },
      {
        toolName: 'initiative:edit',
        input: { id: 'INIT-030', description: 'updated' },
        fallback: {
          command: 'initiative:edit',
          args: ['--id', 'INIT-030', '--description', 'updated'],
          errorCode: 'INITIATIVE_EDIT_ERROR',
        },
      },
      {
        toolName: 'initiative:add-wu',
        input: { initiative: 'INIT-030', wu: 'WU-1810' },
        fallback: {
          command: 'initiative:add-wu',
          args: ['--initiative', 'INIT-030', '--wu', 'WU-1810'],
          errorCode: 'INITIATIVE_ADD_WU_ERROR',
        },
      },
      {
        toolName: 'initiative:remove-wu',
        input: { initiative: 'INIT-030', wu: 'WU-1810' },
        fallback: {
          command: 'initiative:remove-wu',
          args: ['--initiative', 'INIT-030', '--wu', 'WU-1810'],
          errorCode: 'INITIATIVE_REMOVE_WU_ERROR',
        },
      },
      {
        toolName: 'initiative:bulk-assign',
        input: { apply: true },
        fallback: {
          command: 'initiative:bulk-assign',
          args: ['--apply'],
          errorCode: 'INITIATIVE_BULK_ASSIGN_ERROR',
        },
      },
      {
        toolName: 'initiative:plan',
        input: { initiative: 'INIT-030', create: true },
        fallback: {
          command: 'initiative:plan',
          args: ['--initiative', 'INIT-030', '--create'],
          errorCode: 'INITIATIVE_PLAN_ERROR',
        },
      },
      {
        toolName: 'init:plan',
        input: { initiative: 'INIT-030', create: true },
        fallback: {
          command: 'init:plan',
          args: ['--initiative', 'INIT-030', '--create'],
          errorCode: 'INIT_PLAN_ERROR',
        },
      },
      {
        toolName: 'orchestrate:initiative',
        input: { initiative: 'INIT-030', dry_run: true },
        fallback: {
          command: 'orchestrate:initiative',
          args: ['--initiative', 'INIT-030', '--dry-run'],
          errorCode: 'ORCHESTRATE_INITIATIVE_ERROR',
        },
      },
    ] as const;

    for (const lifecycleCall of lifecycleCalls) {
      const result = await executeViaPack(lifecycleCall.toolName, lifecycleCall.input, {
        projectRoot: '/tmp/lumenflow-runtime-resolver-tests',
        context: buildExecutionContext({ taskId: 'WU-1810' }),
        runtimeFactory: runtimeFactory as Parameters<typeof executeViaPack>[2]['runtimeFactory'],
        cliRunner: cliRunner as Parameters<typeof executeViaPack>[2]['cliRunner'],
        fallback: lifecycleCall.fallback,
      });

      expect(result.success).toBe(true);
    }

    expect(runtimeFactory).toHaveBeenCalledTimes(lifecycleCalls.length);
    expect(runtimeExecuteTool).toHaveBeenCalledTimes(lifecycleCalls.length);
    expect(cliRunner).not.toHaveBeenCalled();
  });
});

describe('WU-1807: state transition handlers execute in-process and mutate WU state', () => {
  const TEST_WU_ID = 'WU-1807';
  const TEST_WU_LANE = 'Framework: Core Lifecycle';
  const TEST_WU_TITLE = 'Runtime transition fixture';
  const TEST_WU_REASON = 'Blocked by dependency';
  const TEST_RELEASE_REASON = 'Recovered ownership';
  const TEST_EDIT_DESCRIPTION = 'Updated via runtime handler';
  const TEST_EDIT_NOTES = 'Runtime edit note';
  const TEST_ACCEPTANCE_INITIAL = 'Initial acceptance';
  const TEST_ACCEPTANCE_UPDATED = 'Updated acceptance';
  const FIXTURE_TIMESTAMP_CREATE = '2026-02-18T00:00:00.000Z';
  const FIXTURE_TIMESTAMP_CLAIM = '2026-02-18T00:01:00.000Z';
  const STATE_EVENTS_FILE = '.lumenflow/state/wu-events.jsonl';
  const WU_FILE = `docs/04-operations/tasks/wu/${TEST_WU_ID}.yaml`;
  const BACKLOG_FILE = 'docs/04-operations/tasks/backlog.md';
  const STATUS_FILE = 'docs/04-operations/tasks/status.md';
  const FALLBACK_ERROR_CODE = 'WU_STATE_RUNTIME_ERROR';

  async function createStateFixture(projectRoot: string): Promise<void> {
    const wuDir = path.join(projectRoot, 'docs/04-operations/tasks/wu');
    const stateDir = path.join(projectRoot, '.lumenflow/state');

    await mkdir(wuDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });

    const wuYaml = [
      `id: ${TEST_WU_ID}`,
      `title: ${TEST_WU_TITLE}`,
      `lane: '${TEST_WU_LANE}'`,
      'status: in_progress',
      'description: Initial description',
      'acceptance:',
      `  - ${TEST_ACCEPTANCE_INITIAL}`,
      'code_paths:',
      '  - packages/@lumenflow/mcp/src/tools/wu-tools.ts',
      'notes: Initial note',
      '',
    ].join('\n');

    const events = [
      JSON.stringify({
        type: 'create',
        wuId: TEST_WU_ID,
        lane: TEST_WU_LANE,
        title: TEST_WU_TITLE,
        timestamp: FIXTURE_TIMESTAMP_CREATE,
      }),
      JSON.stringify({
        type: 'claim',
        wuId: TEST_WU_ID,
        lane: TEST_WU_LANE,
        title: TEST_WU_TITLE,
        timestamp: FIXTURE_TIMESTAMP_CLAIM,
      }),
      '',
    ].join('\n');

    await writeFile(path.join(projectRoot, WU_FILE), wuYaml, 'utf-8');
    await writeFile(path.join(projectRoot, BACKLOG_FILE), '# Backlog\n', 'utf-8');
    await writeFile(path.join(projectRoot, STATUS_FILE), '# Status\n', 'utf-8');
    await writeFile(path.join(projectRoot, STATE_EVENTS_FILE), events, 'utf-8');
  }

  async function executeRuntimeStateTool(
    toolName: string,
    input: Record<string, unknown>,
    projectRoot: string,
  ) {
    const capability = await packToolCapabilityResolver(createResolverInput(toolName));
    expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.IN_PROCESS);
    if (!capability || capability.handler.kind !== TOOL_HANDLER_KINDS.IN_PROCESS) {
      throw new Error(`Expected in-process handler for ${toolName}`);
    }

    return capability.handler.fn(input, {
      run_id: `run-${toolName.replace(':', '-')}`,
      task_id: TEST_WU_ID,
      session_id: `session-${toolName.replace(':', '-')}`,
      allowed_scopes: [WRITE_SCOPE],
      metadata: {
        [RUNTIME_PROJECT_ROOT_KEY]: projectRoot,
        fallback_error_code: FALLBACK_ERROR_CODE,
      },
    });
  }

  it('applies block -> unblock -> release transitions through runtime handlers', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'lumenflow-runtime-state-tools-'));
    try {
      await createStateFixture(projectRoot);
      const wuPath = path.join(projectRoot, WU_FILE);
      const eventsPath = path.join(projectRoot, STATE_EVENTS_FILE);

      const blockResult = await executeRuntimeStateTool(
        WU_LIFECYCLE_STATE_TOOL_NAMES.BLOCK,
        { id: TEST_WU_ID, reason: TEST_WU_REASON },
        projectRoot,
      );
      expect(blockResult.success).toBe(true);
      const blockedWu = await readFile(wuPath, 'utf-8');
      expect(blockedWu).toContain('status: blocked');

      const unblockResult = await executeRuntimeStateTool(
        WU_LIFECYCLE_STATE_TOOL_NAMES.UNBLOCK,
        { id: TEST_WU_ID, reason: 'dependency cleared' },
        projectRoot,
      );
      expect(unblockResult.success).toBe(true);
      const unblockedWu = await readFile(wuPath, 'utf-8');
      expect(unblockedWu).toContain('status: in_progress');

      const releaseResult = await executeRuntimeStateTool(
        WU_LIFECYCLE_STATE_TOOL_NAMES.RELEASE,
        { id: TEST_WU_ID, reason: TEST_RELEASE_REASON },
        projectRoot,
      );
      expect(releaseResult.success).toBe(true);
      const releasedWu = await readFile(wuPath, 'utf-8');
      expect(releasedWu).toContain('status: ready');

      const events = await readFile(eventsPath, 'utf-8');
      expect(events).toContain('"type":"block"');
      expect(events).toContain('"type":"unblock"');
      expect(events).toContain('"type":"release"');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 15000);

  it('updates WU editable fields through runtime wu:edit handler', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'lumenflow-runtime-wu-edit-'));
    try {
      await createStateFixture(projectRoot);
      const wuPath = path.join(projectRoot, WU_FILE);

      const editResult = await executeRuntimeStateTool(
        WU_LIFECYCLE_STATE_TOOL_NAMES.EDIT,
        {
          id: TEST_WU_ID,
          description: TEST_EDIT_DESCRIPTION,
          notes: TEST_EDIT_NOTES,
          acceptance: [TEST_ACCEPTANCE_UPDATED],
        },
        projectRoot,
      );

      expect(editResult.success).toBe(true);
      const editedWu = await readFile(wuPath, 'utf-8');
      expect(editedWu).toContain(`description: ${TEST_EDIT_DESCRIPTION}`);
      expect(editedWu).toContain(`- ${TEST_ACCEPTANCE_INITIAL}`);
      expect(editedWu).toContain(`- ${TEST_ACCEPTANCE_UPDATED}`);
      expect(editedWu).toContain(TEST_EDIT_NOTES);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
