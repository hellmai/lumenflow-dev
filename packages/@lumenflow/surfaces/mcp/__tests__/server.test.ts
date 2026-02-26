// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KernelRuntime } from '@lumenflow/kernel';
import { initializeTaskLifecycleCommands } from '../../cli/task-lifecycle.js';
import { createMcpServer } from '../server.js';

const READ_SCOPE = {
  type: 'path' as const,
  pattern: '**',
  access: 'read' as const,
};

async function writeWorkspaceFixture(root: string): Promise<void> {
  const packsRoot = join(root, 'packs');
  const packRoot = join(packsRoot, 'software-delivery');
  await mkdir(packRoot, { recursive: true });

  await writeFile(
    join(root, 'workspace.yaml'),
    [
      'id: workspace-surfaces-mcp',
      'name: Surfaces MCP Workspace',
      'packs:',
      '  - id: software-delivery',
      '    version: 1.0.0',
      '    integrity: dev',
      '    source: local',
      'lanes:',
      '  - id: framework-mcp',
      '    title: Framework MCP',
      '    allowed_scopes:',
      '      - type: path',
      '        pattern: "**"',
      '        access: read',
      'security:',
      '  allowed_scopes:',
      '    - type: path',
      '      pattern: "**"',
      '      access: read',
      '  network_default: off',
      '  deny_overlays: []',
      'software_delivery: {}',
      'memory_namespace: mem',
      'event_namespace: evt',
    ].join('\n'),
    'utf8',
  );

  await writeFile(
    join(packRoot, 'manifest.yaml'),
    [
      'id: software-delivery',
      'version: 1.0.0',
      'task_types:',
      '  - work-unit',
      'tools: []',
      'policies:',
      '  - id: runtime.completion.allow',
      '    trigger: on_completion',
      '    decision: allow',
      'state_aliases:',
      '  active: in_progress',
      'evidence_types: []',
      'lane_templates: []',
      'config_key: software_delivery',
    ].join('\n'),
    'utf8',
  );
}

describe('surfaces/mcp runtime-backed server', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'lumenflow-surfaces-mcp-'));
    await writeWorkspaceFixture(tempRoot);
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('routes task:* names to KernelRuntime use-cases', async () => {
    const createTask = vi.fn(async () => ({ ok: true }));
    const claimTask = vi.fn(async () => ({ ok: true }));
    const completeTask = vi.fn(async () => ({ ok: true }));
    const inspectTask = vi.fn(async () => ({ ok: true }));

    const runtime = {
      createTask,
      claimTask,
      completeTask,
      inspectTask,
      executeTool: vi.fn(),
      getToolHost: vi.fn(),
      getPolicyEngine: vi.fn(),
    } as unknown as KernelRuntime;

    const server = createMcpServer(runtime);

    await server.handleInvocation({
      name: 'task:create',
      arguments: {
        id: 'WU-1738-create',
        workspace_id: 'workspace-surfaces-mcp',
        lane_id: 'framework-mcp',
        domain: 'software-delivery',
        title: 'Create',
        description: 'Create through MCP',
        acceptance: ['ok'],
        declared_scopes: [READ_SCOPE],
        risk: 'medium',
        type: 'feature',
        priority: 'P1',
        created: '2026-02-16',
      },
    });
    await server.handleInvocation({
      name: 'task:claim',
      arguments: {
        task_id: 'WU-1738-create',
        by: 'tom@hellm.ai',
        session_id: 'session-1738',
      },
    });
    await server.handleInvocation({
      name: 'task:complete',
      arguments: {
        task_id: 'WU-1738-create',
      },
    });
    await server.handleInvocation({
      name: 'task:inspect',
      arguments: {
        task_id: 'WU-1738-create',
      },
    });

    expect(createTask).toHaveBeenCalledTimes(1);
    expect(claimTask).toHaveBeenCalledTimes(1);
    expect(completeTask).toHaveBeenCalledTimes(1);
    expect(inspectTask).toHaveBeenCalledTimes(1);
  });

  it('passes optional claim/complete fields through to runtime handlers', async () => {
    const createTask = vi.fn(async () => ({ ok: true }));
    const claimTask = vi.fn(async () => ({ ok: true }));
    const completeTask = vi.fn(async () => ({ ok: true }));
    const inspectTask = vi.fn(async () => ({ ok: true }));

    const runtime = {
      createTask,
      claimTask,
      completeTask,
      inspectTask,
      executeTool: vi.fn(),
      getToolHost: vi.fn(),
      getPolicyEngine: vi.fn(),
    } as unknown as KernelRuntime;

    const server = createMcpServer(runtime);

    await server.handleInvocation({
      name: 'task:claim',
      arguments: {
        task_id: 'WU-1738-claim-optional',
        by: 'tom@hellm.ai',
        session_id: 'session-claim-optional',
        timestamp: '2026-02-17T10:00:00.000Z',
        domain_data: {
          source: 'mcp',
        },
      },
    });

    await server.handleInvocation({
      name: 'task:complete',
      arguments: {
        task_id: 'WU-1738-claim-optional',
        run_id: 'run-WU-1738-claim-optional-1',
        timestamp: '2026-02-17T10:05:00.000Z',
        evidence_refs: ['evidence://run/1'],
      },
    });

    expect(claimTask).toHaveBeenCalledWith({
      task_id: 'WU-1738-claim-optional',
      by: 'tom@hellm.ai',
      session_id: 'session-claim-optional',
      timestamp: '2026-02-17T10:00:00.000Z',
      domain_data: {
        source: 'mcp',
      },
    });

    expect(completeTask).toHaveBeenCalledWith({
      task_id: 'WU-1738-claim-optional',
      run_id: 'run-WU-1738-claim-optional-1',
      timestamp: '2026-02-17T10:05:00.000Z',
      evidence_refs: ['evidence://run/1'],
    });
  });

  it('rejects invalid claim/complete payload shapes at schema boundaries', async () => {
    const claimTask = vi.fn(async () => ({ ok: true }));
    const completeTask = vi.fn(async () => ({ ok: true }));

    const runtime = {
      createTask: vi.fn(),
      claimTask,
      completeTask,
      inspectTask: vi.fn(),
      executeTool: vi.fn(),
      getToolHost: vi.fn(),
      getPolicyEngine: vi.fn(),
    } as unknown as KernelRuntime;

    const server = createMcpServer(runtime);

    await expect(
      server.handleInvocation({
        name: 'task:claim',
        arguments: {
          task_id: 'WU-1738-invalid',
          by: 'tom@hellm.ai',
          session_id: 'session-invalid',
          domain_data: 'not-an-object',
        },
      }),
    ).rejects.toThrow();

    await expect(
      server.handleInvocation({
        name: 'task:complete',
        arguments: {
          task_id: 'WU-1738-invalid',
          evidence_refs: ['ok', 42],
        },
      }),
    ).rejects.toThrow();

    expect(claimTask).not.toHaveBeenCalled();
    expect(completeTask).not.toHaveBeenCalled();
  });

  it('routes non-task names to runtime.executeTool', async () => {
    const executeTool = vi.fn(async () => ({ success: true }));

    const runtime = {
      createTask: vi.fn(),
      claimTask: vi.fn(),
      completeTask: vi.fn(),
      inspectTask: vi.fn(),
      executeTool,
      getToolHost: vi.fn(),
      getPolicyEngine: vi.fn(),
    } as unknown as KernelRuntime;

    const server = createMcpServer(runtime);
    await server.handleInvocation(
      {
        name: 'fs:read',
        arguments: { path: 'README.md' },
      },
      {
        run_id: 'run-1738-tool',
        task_id: 'WU-1738-tool',
        session_id: 'session-1738-tool',
        allowed_scopes: [READ_SCOPE],
        metadata: {
          workspace_allowed_scopes: [READ_SCOPE],
          lane_allowed_scopes: [READ_SCOPE],
          task_declared_scopes: [READ_SCOPE],
          workspace_config_hash: 'a'.repeat(64),
          runtime_version: '2.21.0',
        },
      },
    );

    expect(executeTool).toHaveBeenCalledWith(
      'fs:read',
      { path: 'README.md' },
      expect.objectContaining({
        run_id: 'run-1738-tool',
        task_id: 'WU-1738-tool',
      }),
    );
  });

  it('routes pack/workspace parity tools through runtime.executeTool with context enforcement', async () => {
    const executeTool = vi.fn(async () => ({ success: true }));

    const runtime = {
      createTask: vi.fn(),
      claimTask: vi.fn(),
      completeTask: vi.fn(),
      inspectTask: vi.fn(),
      executeTool,
      getToolHost: vi.fn(),
      getPolicyEngine: vi.fn(),
    } as unknown as KernelRuntime;

    const server = createMcpServer(runtime);

    await server.handleInvocation(
      {
        name: 'pack:list',
        arguments: {},
      },
      {
        run_id: 'run-1738-pack-list',
        task_id: 'WU-1738-pack-list',
        session_id: 'session-1738-pack-list',
        allowed_scopes: [READ_SCOPE],
        metadata: {
          workspace_allowed_scopes: [READ_SCOPE],
          lane_allowed_scopes: [READ_SCOPE],
          task_declared_scopes: [READ_SCOPE],
          workspace_config_hash: 'a'.repeat(64),
          runtime_version: '2.21.0',
        },
      },
    );

    await server.handleInvocation(
      {
        name: 'pack:install',
        arguments: {
          id: 'software-delivery',
          source: 'registry',
          version: '1.0.0',
        },
      },
      {
        run_id: 'run-1738-pack-install',
        task_id: 'WU-1738-pack-install',
        session_id: 'session-1738-pack-install',
        allowed_scopes: [READ_SCOPE],
        metadata: {
          workspace_allowed_scopes: [READ_SCOPE],
          lane_allowed_scopes: [READ_SCOPE],
          task_declared_scopes: [READ_SCOPE],
          workspace_config_hash: 'b'.repeat(64),
          runtime_version: '2.21.0',
        },
      },
    );

    await server.handleInvocation(
      {
        name: 'workspace:info',
        arguments: {},
      },
      {
        run_id: 'run-1738-workspace-info',
        task_id: 'WU-1738-workspace-info',
        session_id: 'session-1738-workspace-info',
        allowed_scopes: [READ_SCOPE],
        metadata: {
          workspace_allowed_scopes: [READ_SCOPE],
          lane_allowed_scopes: [READ_SCOPE],
          task_declared_scopes: [READ_SCOPE],
          workspace_config_hash: 'c'.repeat(64),
          runtime_version: '2.21.0',
        },
      },
    );

    expect(executeTool).toHaveBeenCalledWith(
      'pack:list',
      {},
      expect.objectContaining({
        run_id: 'run-1738-pack-list',
        task_id: 'WU-1738-pack-list',
      }),
    );
    expect(executeTool).toHaveBeenCalledWith(
      'pack:install',
      {
        id: 'software-delivery',
        source: 'registry',
        version: '1.0.0',
      },
      expect.objectContaining({
        run_id: 'run-1738-pack-install',
        task_id: 'WU-1738-pack-install',
      }),
    );
    expect(executeTool).toHaveBeenCalledWith(
      'workspace:info',
      {},
      expect.objectContaining({
        run_id: 'run-1738-workspace-info',
        task_id: 'WU-1738-workspace-info',
      }),
    );

    await expect(
      server.handleInvocation({
        name: 'pack:list',
        arguments: {},
      }),
    ).rejects.toThrow('requires execution context');
  });

  it('builds MCP tool schemas from zod via Kernel JSON schema conversion', () => {
    const runtime = {
      createTask: vi.fn(),
      claimTask: vi.fn(),
      completeTask: vi.fn(),
      inspectTask: vi.fn(),
      executeTool: vi.fn(),
      getToolHost: vi.fn(),
      getPolicyEngine: vi.fn(),
    } as unknown as KernelRuntime;

    const server = createMcpServer(runtime);
    const tools = server.listTools();

    const createTool = tools.find((tool) => tool.name === 'task:create');
    expect(createTool).toBeDefined();
    expect(createTool?.input_schema.type).toBe('object');

    const claimTool = tools.find((tool) => tool.name === 'task:claim');
    expect(claimTool).toBeDefined();
    expect(claimTool?.input_schema.required).toEqual(
      expect.arrayContaining(['task_id', 'by', 'session_id']),
    );
    expect(claimTool?.input_schema.properties?.task_id).toBeDefined();
    expect(claimTool?.input_schema.properties?.id).toBeUndefined();

    const completeTool = tools.find((tool) => tool.name === 'task:complete');
    expect(completeTool).toBeDefined();
    expect(completeTool?.input_schema.required).toEqual(expect.arrayContaining(['task_id']));
    expect(completeTool?.input_schema.properties?.task_id).toBeDefined();
    expect(completeTool?.input_schema.properties?.id).toBeUndefined();

    const packListTool = tools.find((tool) => tool.name === 'pack:list');
    expect(packListTool).toBeDefined();
    expect(packListTool?.input_schema).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });

    const packInstallTool = tools.find((tool) => tool.name === 'pack:install');
    expect(packInstallTool).toBeDefined();
    expect(packInstallTool?.input_schema.required).toEqual(
      expect.arrayContaining(['id', 'source', 'version']),
    );
    expect(packInstallTool?.input_schema.properties?.id).toEqual({ type: 'string' });
    expect(packInstallTool?.input_schema.properties?.source).toEqual({
      type: 'string',
      enum: ['local', 'git', 'registry'],
    });
    expect(packInstallTool?.input_schema.properties?.version).toEqual({ type: 'string' });

    const workspaceInfoTool = tools.find((tool) => tool.name === 'workspace:info');
    expect(workspaceInfoTool).toBeDefined();
    expect(workspaceInfoTool?.input_schema).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
  });

  it('CLI lifecycle and MCP lifecycle produce identical event sequences', async () => {
    const initialized = await initializeTaskLifecycleCommands({
      workspaceRoot: tempRoot,
      packsRoot: join(tempRoot, 'packs'),
      taskSpecRoot: join(tempRoot, 'tasks'),
      eventsFilePath: join(tempRoot, 'events.jsonl'),
      eventLockFilePath: join(tempRoot, 'events.lock'),
      evidenceRoot: join(tempRoot, 'evidence'),
    });

    const cliCommands = initialized.commands;
    const server = createMcpServer(initialized.runtime);

    const cliTask = {
      id: 'WU-1738-cli',
      workspace_id: 'workspace-surfaces-mcp',
      lane_id: 'framework-mcp',
      domain: 'software-delivery',
      title: 'CLI lifecycle',
      description: 'CLI path',
      acceptance: ['ok'],
      declared_scopes: [READ_SCOPE],
      risk: 'medium' as const,
      type: 'feature',
      priority: 'P1' as const,
      created: '2026-02-16',
    };

    const mcpTask = {
      ...cliTask,
      id: 'WU-1738-mcp',
      title: 'MCP lifecycle',
      description: 'MCP path',
    };

    await cliCommands['task:create'](cliTask);
    await cliCommands['task:claim']({
      task_id: cliTask.id,
      by: 'tom@hellm.ai',
      session_id: 'session-cli',
    });
    await cliCommands['task:complete']({ task_id: cliTask.id });

    await server.handleInvocation({ name: 'task:create', arguments: mcpTask });
    await server.handleInvocation({
      name: 'task:claim',
      arguments: {
        task_id: mcpTask.id,
        by: 'tom@hellm.ai',
        session_id: 'session-mcp',
      },
    });
    await server.handleInvocation({
      name: 'task:complete',
      arguments: {
        task_id: mcpTask.id,
      },
    });

    const cliInspection = await cliCommands['task:status'](cliTask.id);
    const mcpInspection = await server.handleInvocation({
      name: 'task:inspect',
      arguments: {
        task_id: mcpTask.id,
      },
    });

    expect(cliInspection.events.map((event) => event.kind)).toEqual(
      mcpInspection.events.map((event) => event.kind),
    );
  });

  it('contains no CLI package imports or spawn/exec shell-outs', async () => {
    const source = await readFile(
      join(process.cwd(), 'packages', '@lumenflow', 'surfaces', 'mcp', 'server.ts'),
      'utf8',
    );

    expect(source.includes('@lumenflow/cli')).toBe(false);
    expect(source.includes('execFile')).toBe(false);
    expect(source.includes('spawn(')).toBe(false);
  });
});
