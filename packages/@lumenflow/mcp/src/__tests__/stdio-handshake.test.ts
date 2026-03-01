// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file stdio-handshake.test.ts
 * @description Tests for MCP server stdio transport handshake
 *
 * WU-1412: MCP server runs via npx @lumenflow/mcp over stdio
 */

import { z } from 'zod';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RuntimeTaskToolNames } from '../tools/runtime-task-constants.js';

vi.mock('../tools.js', () => ({
  registeredTools: [
    {
      name: 'context_get',
      description: 'Get context',
      inputSchema: {},
      execute: vi.fn(async () => ({ success: true })),
    },
    {
      name: 'wu_list',
      description: 'List WUs',
      inputSchema: {},
      execute: vi.fn(async () => ({ success: true })),
    },
    {
      name: 'wu_status',
      description: 'WU status',
      inputSchema: {},
      execute: vi.fn(async () => ({ success: true })),
    },
    {
      name: 'wu_create',
      description: 'Create WU',
      inputSchema: {},
      execute: vi.fn(async () => ({ success: true })),
    },
    {
      name: 'wu_claim',
      description: 'Claim WU',
      inputSchema: {},
      execute: vi.fn(async () => ({ success: true })),
    },
    {
      name: 'wu_done',
      description: 'Complete WU',
      inputSchema: {},
      execute: vi.fn(async () => ({ success: true })),
    },
    {
      name: 'gates_run',
      description: 'Run gates',
      inputSchema: {},
      execute: vi.fn(async () => ({ success: true })),
    },
    {
      name: RuntimeTaskToolNames.TOOL_EXECUTE,
      description: 'Execute runtime tool',
      inputSchema: {},
      execute: vi.fn(async () => ({ success: true })),
    },
  ],
  runtimeTaskTools: [
    { name: RuntimeTaskToolNames.TASK_CLAIM },
    { name: RuntimeTaskToolNames.TASK_CREATE },
    { name: RuntimeTaskToolNames.TASK_COMPLETE },
    { name: RuntimeTaskToolNames.TASK_BLOCK },
    { name: RuntimeTaskToolNames.TASK_UNBLOCK },
    { name: RuntimeTaskToolNames.TASK_INSPECT },
    { name: RuntimeTaskToolNames.TOOL_EXECUTE },
  ],
}));

vi.mock('../resources.js', () => ({
  staticResources: [
    {
      uri: 'lumenflow://context',
      name: 'Context',
      description: 'Context resource',
      mimeType: 'application/json',
      fetch: vi.fn(async () => ({ success: true, content: '{}' })),
    },
    {
      uri: 'lumenflow://backlog',
      name: 'Backlog',
      description: 'Backlog resource',
      mimeType: 'text/markdown',
      fetch: vi.fn(async () => ({ success: true, content: '# Backlog' })),
    },
  ],
  resourceTemplates: [
    {
      uriTemplate: 'lumenflow://wu/{id}',
      name: 'WU',
      description: 'WU template',
      mimeType: 'application/json',
      fetch: vi.fn(async () => ({ success: true, content: '{}' })),
    },
  ],
}));

import { createMcpServer } from '../server.js';

const REQUIRED_RUNTIME_TOOL_NAMES = [
  RuntimeTaskToolNames.TASK_CLAIM,
  RuntimeTaskToolNames.TASK_CREATE,
  RuntimeTaskToolNames.TASK_COMPLETE,
  RuntimeTaskToolNames.TASK_BLOCK,
  RuntimeTaskToolNames.TASK_UNBLOCK,
  RuntimeTaskToolNames.TASK_INSPECT,
  RuntimeTaskToolNames.TOOL_EXECUTE,
] as const;

interface ServerHarnessOptions {
  runtimeToolNames?: readonly string[];
  registeredTools?: Array<{
    name: string;
    description: string;
    inputSchema: unknown;
    execute: (input: unknown, options?: { projectRoot?: string }) => Promise<unknown>;
  }>;
  staticResources?: Array<{
    uri?: string;
    name: string;
    description: string;
    mimeType: string;
    fetch: (uri: string, options?: { projectRoot?: string }) => Promise<unknown>;
  }>;
  resourceTemplates?: Array<{
    uriTemplate?: string;
    name: string;
    description: string;
    mimeType: string;
    fetch: (uri: string, options?: { projectRoot?: string }) => Promise<unknown>;
  }>;
  enrichToolResultWithSignals?: (
    result: unknown,
    options: { projectRoot: string },
  ) => Promise<unknown>;
}

async function createServerHarness(options: ServerHarnessOptions = {}) {
  vi.resetModules();

  const schemaRefs = {
    ListToolsRequestSchema: Symbol('ListToolsRequestSchema'),
    CallToolRequestSchema: Symbol('CallToolRequestSchema'),
    ListResourcesRequestSchema: Symbol('ListResourcesRequestSchema'),
    ReadResourceRequestSchema: Symbol('ReadResourceRequestSchema'),
    ListResourceTemplatesRequestSchema: Symbol('ListResourceTemplatesRequestSchema'),
  };

  const handlers = new Map<symbol, (request: unknown) => Promise<unknown>>();
  const connectMock = vi.fn(async () => undefined);
  const closeMock = vi.fn(async () => undefined);

  vi.doMock('@modelcontextprotocol/sdk/types.js', () => schemaRefs);

  vi.doMock('@modelcontextprotocol/sdk/server/index.js', () => ({
    Server: class MockServer {
      public setRequestHandler(schema: symbol, handler: (request: unknown) => Promise<unknown>) {
        handlers.set(schema, handler);
      }

      public async connect(): Promise<void> {
        await connectMock();
      }

      public async close(): Promise<void> {
        await closeMock();
      }
    },
  }));

  vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
    StdioServerTransport: function MockTransport() {},
  }));

  vi.doMock('../tools.js', () => ({
    runtimeTaskTools: (options.runtimeToolNames ?? REQUIRED_RUNTIME_TOOL_NAMES).map((name) => ({
      name,
    })),
    registeredTools: options.registeredTools ?? [],
  }));

  vi.doMock('../resources.js', () => ({
    staticResources: options.staticResources ?? [
      {
        uri: 'lumenflow://context',
        name: 'Context',
        description: 'Context',
        mimeType: 'application/json',
        fetch: vi.fn(async () => ({ success: true, content: '{}' })),
      },
    ],
    resourceTemplates: options.resourceTemplates ?? [],
  }));

  const enrichToolResultWithSignals =
    options.enrichToolResultWithSignals ?? vi.fn(async (result: unknown) => result);
  vi.doMock('../signal-enrichment.js', () => ({
    enrichToolResultWithSignals,
  }));

  const module = await import('../server.js');

  return {
    createMcpServer: module.createMcpServer,
    handlers,
    schemaRefs,
    connectMock,
    closeMock,
    enrichToolResultWithSignals,
  };
}

describe('MCP stdio handshake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('server creation', () => {
    it('should create server with default config', () => {
      const server = createMcpServer();

      expect(server).toBeDefined();
      expect(server.name).toBe('@lumenflow/mcp');
    });

    it('should respect LUMENFLOW_PROJECT_ROOT env var', () => {
      const projectRoot = '/custom/root';
      const server = createMcpServer({ projectRoot });

      expect(server.config.projectRoot).toBe(projectRoot);
    });

    it('should respect LUMENFLOW_MCP_LOG_LEVEL env var', () => {
      const server = createMcpServer({ logLevel: 'debug' });

      expect(server.config.logLevel).toBe('debug');
    });

    it('should default to info log level', () => {
      const server = createMcpServer();

      expect(server.config.logLevel).toBe('info');
    });
  });

  describe('tool registration', () => {
    it('should register context_get tool', () => {
      const server = createMcpServer();
      const tools = server.listTools();

      expect(tools.some((t) => t.name === 'context_get')).toBe(true);
    });

    it('should register wu_list tool', () => {
      const server = createMcpServer();
      const tools = server.listTools();

      expect(tools.some((t) => t.name === 'wu_list')).toBe(true);
    });

    it('should register wu_status tool', () => {
      const server = createMcpServer();
      const tools = server.listTools();

      expect(tools.some((t) => t.name === 'wu_status')).toBe(true);
    });

    it('should register wu_create tool', () => {
      const server = createMcpServer();
      const tools = server.listTools();

      expect(tools.some((t) => t.name === 'wu_create')).toBe(true);
    });

    it('should register wu_claim tool', () => {
      const server = createMcpServer();
      const tools = server.listTools();

      expect(tools.some((t) => t.name === 'wu_claim')).toBe(true);
    });

    it('should register wu_done tool', () => {
      const server = createMcpServer();
      const tools = server.listTools();

      expect(tools.some((t) => t.name === 'wu_done')).toBe(true);
    });

    it('should register gates_run tool', () => {
      const server = createMcpServer();
      const tools = server.listTools();

      expect(tools.some((t) => t.name === 'gates_run')).toBe(true);
    });

    it(`should register ${RuntimeTaskToolNames.TOOL_EXECUTE} runtime tool`, () => {
      const server = createMcpServer();
      const tools = server.listTools();

      expect(tools.some((t) => t.name === RuntimeTaskToolNames.TOOL_EXECUTE)).toBe(true);
    });
  });

  describe('resource registration', () => {
    it('should register context resource', () => {
      const server = createMcpServer();
      const resources = server.listResources();

      expect(resources.some((r) => r.uri === 'lumenflow://context')).toBe(true);
    });

    it('should register wu/{id} resource template', () => {
      const server = createMcpServer();
      const templates = server.listResourceTemplates();

      expect(templates.some((t) => t.uriTemplate === 'lumenflow://wu/{id}')).toBe(true);
    });

    it('should register backlog resource', () => {
      const server = createMcpServer();
      const resources = server.listResources();

      expect(resources.some((r) => r.uri === 'lumenflow://backlog')).toBe(true);
    });
  });

  describe('config validation', () => {
    it('should accept valid log levels', () => {
      const validLevels = ['debug', 'info', 'warn', 'error'] as const;

      for (const level of validLevels) {
        const server = createMcpServer({ logLevel: level });
        expect(server.config.logLevel).toBe(level);
      }
    });
  });

  describe('behavioral contracts', () => {
    it('returns MCP error payload for unknown tool calls (malformed request path)', async () => {
      const harness = await createServerHarness();
      harness.createMcpServer();
      const callToolHandler = harness.handlers.get(harness.schemaRefs.CallToolRequestSchema);

      expect(callToolHandler).toBeDefined();
      const response = (await callToolHandler?.({
        params: { name: 'does_not_exist', arguments: {} },
      })) as {
        isError: boolean;
        content: Array<{ text: string }>;
      };

      expect(response.isError).toBe(true);
      expect(response.content[0]?.text).toContain('Unknown tool: does_not_exist');
    });

    it('returns MCP error payload when tool execution throws timeout-like errors', async () => {
      const timeoutTool = {
        name: 'timeout_tool',
        description: 'Simulated timeout',
        inputSchema: {},
        execute: vi.fn(async () => {
          throw new Error('Timed out waiting for tool execution');
        }),
      };
      const harness = await createServerHarness({ registeredTools: [timeoutTool] });
      harness.createMcpServer();
      const callToolHandler = harness.handlers.get(harness.schemaRefs.CallToolRequestSchema);

      expect(callToolHandler).toBeDefined();
      const response = (await callToolHandler?.({
        params: { name: 'timeout_tool', arguments: {} },
      })) as {
        isError: boolean;
        content: Array<{ text: string }>;
      };

      expect(response.isError).toBe(true);
      expect(response.content[0]?.text).toContain('Timed out waiting for tool execution');
    });

    it('maps list-tools and call-tool handlers for success and failure results', async () => {
      const successTool = {
        name: 'success_tool',
        description: 'Returns success',
        inputSchema: z.object({ dry_run: z.boolean().optional() }),
        execute: vi.fn(async () => ({ success: true, payload: { ok: true } })),
      };
      const failedTool = {
        name: 'failed_tool',
        description: 'Returns failure',
        inputSchema: z.object({}),
        execute: vi.fn(async () => ({ success: false, error: 'failed' })),
      };
      const harness = await createServerHarness({ registeredTools: [successTool, failedTool] });
      harness.createMcpServer({ projectRoot: '/workspace' });
      const listToolsHandler = harness.handlers.get(harness.schemaRefs.ListToolsRequestSchema);
      const callToolHandler = harness.handlers.get(harness.schemaRefs.CallToolRequestSchema);

      expect(listToolsHandler).toBeDefined();
      const listToolsResponse = (await listToolsHandler?.({})) as {
        tools: Array<{ name: string; inputSchema: Record<string, unknown> }>;
      };
      expect(listToolsResponse.tools.map((tool) => tool.name)).toEqual([
        'success_tool',
        'failed_tool',
      ]);
      expect(listToolsResponse.tools[0]?.inputSchema).toMatchObject({ type: 'object' });

      const successResponse = (await callToolHandler?.({
        params: { name: 'success_tool', arguments: { dry_run: true } },
      })) as {
        isError: boolean;
        content: Array<{ text: string }>;
      };
      expect(successResponse.isError).toBe(false);
      expect(successResponse.content[0]?.text).toContain('"ok":true');
      expect(successTool.execute).toHaveBeenCalledWith(
        { dry_run: true },
        { projectRoot: '/workspace' },
      );

      const failedResponse = (await callToolHandler?.({
        params: { name: 'failed_tool', arguments: {} },
      })) as {
        isError: boolean;
        content: Array<{ text: string }>;
      };
      expect(failedResponse.isError).toBe(true);
      expect(failedResponse.content[0]?.text).toContain('"error":"failed"');
    });

    it('applies signal enrichment payload to tool call responses', async () => {
      const successTool = {
        name: 'success_tool',
        description: 'Returns success',
        inputSchema: z.object({}),
        execute: vi.fn(async () => ({ success: true, payload: { ok: true } })),
      };
      const enrichToolResultWithSignals = vi.fn().mockImplementation(async (result: unknown) => ({
        ...(result as Record<string, unknown>),
        _signals: { count: 1, items: [{ id: 'sig-1', message: 'coordination' }] },
      }));
      const harness = await createServerHarness({
        registeredTools: [successTool],
        enrichToolResultWithSignals,
      });
      harness.createMcpServer({ projectRoot: '/workspace' });
      const callToolHandler = harness.handlers.get(harness.schemaRefs.CallToolRequestSchema);

      const response = (await callToolHandler?.({
        params: { name: 'success_tool', arguments: {} },
      })) as {
        isError: boolean;
        content: Array<{ text: string }>;
      };
      const payload = JSON.parse(response.content[0]?.text ?? '{}') as Record<string, unknown>;

      expect(response.isError).toBe(false);
      expect(enrichToolResultWithSignals).toHaveBeenCalledWith(
        { success: true, payload: { ok: true } },
        { projectRoot: '/workspace' },
      );
      expect(payload._signals).toMatchObject({ count: 1 });
    });

    it('returns not-found payload for unknown resources', async () => {
      const harness = await createServerHarness();
      harness.createMcpServer();
      const readResourceHandler = harness.handlers.get(
        harness.schemaRefs.ReadResourceRequestSchema,
      );

      expect(readResourceHandler).toBeDefined();
      const response = (await readResourceHandler?.({
        params: { uri: 'lumenflow://resource/does-not-exist' },
      })) as {
        contents: Array<{ text: string }>;
      };

      expect(response.contents[0]?.text).toContain('Resource not found:');
    });

    it('resolves template resources and propagates resource fetch errors', async () => {
      const templateFetch = vi.fn(async () => ({ success: true, content: '{"id":"WU-9"}' }));
      const staticFailureFetch = vi.fn(async () => ({ success: false, error: 'failed read' }));
      const harness = await createServerHarness({
        staticResources: [
          {
            uri: 'lumenflow://context',
            name: 'Context',
            description: 'Context',
            mimeType: 'application/json',
            fetch: staticFailureFetch,
          },
        ],
        resourceTemplates: [
          {
            uriTemplate: 'lumenflow://wu/{id}',
            name: 'WU',
            description: 'WU',
            mimeType: 'application/json',
            fetch: templateFetch,
          },
        ],
      });
      harness.createMcpServer({ projectRoot: '/workspace' });
      const readResourceHandler = harness.handlers.get(
        harness.schemaRefs.ReadResourceRequestSchema,
      );

      expect(readResourceHandler).toBeDefined();

      const templateResponse = (await readResourceHandler?.({
        params: { uri: 'lumenflow://wu/WU-9' },
      })) as {
        contents: Array<{ text: string; mimeType: string }>;
      };
      expect(templateResponse.contents[0]).toMatchObject({
        text: '{"id":"WU-9"}',
        mimeType: 'application/json',
      });
      expect(templateFetch).toHaveBeenCalledWith('lumenflow://wu/WU-9', {
        projectRoot: '/workspace',
      });

      const staticFailureResponse = (await readResourceHandler?.({
        params: { uri: 'lumenflow://context' },
      })) as {
        contents: Array<{ text: string }>;
      };
      expect(staticFailureResponse.contents[0]?.text).toContain('Error: failed read');
    });

    it('connects stdio transport on start and closes only after transport exists', async () => {
      const harness = await createServerHarness();
      const server = harness.createMcpServer();

      await server.stop();
      expect(harness.closeMock).not.toHaveBeenCalled();

      await server.start();
      expect(harness.connectMock).toHaveBeenCalledTimes(1);

      await server.stop();
      expect(harness.closeMock).toHaveBeenCalledTimes(1);
    });

    it('throws when required runtime tools are missing from the loaded registry', async () => {
      const harness = await createServerHarness({
        runtimeToolNames: [RuntimeTaskToolNames.TASK_CLAIM],
      });

      expect(() => harness.createMcpServer()).toThrow(
        'Required runtime MCP tool(s) missing from registry',
      );
      expect(() => harness.createMcpServer()).toThrow(RuntimeTaskToolNames.TASK_CREATE);
    });
  });
});
