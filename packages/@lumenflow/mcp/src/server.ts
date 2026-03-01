// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file server.ts
 * @description MCP server factory and configuration
 *
 * WU-1412: MCP server runs via npx @lumenflow/mcp over stdio
 *
 * Creates an MCP server that exposes LumenFlow tools and resources.
 * Supports configuration via environment variables:
 * - LUMENFLOW_PROJECT_ROOT: Project root directory
 * - LUMENFLOW_MCP_LOG_LEVEL: Log level (debug, info, warn, error)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ENV_VARS } from '@lumenflow/core/wu-constants';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { registeredTools, runtimeTaskTools } from './tools.js';
import { staticResources, resourceTemplates, type ResourceDefinition } from './resources.js';
import { RuntimeTaskToolNames } from './tools/runtime-task-constants.js';
import { enrichToolResultWithSignals } from './signal-enrichment.js';

/**
 * Log levels supported by the MCP server
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * MCP server configuration
 */
export interface McpServerConfig {
  /** Project root directory (default: process.cwd()) */
  projectRoot?: string;
  /** Log level (default: 'info') */
  logLevel?: LogLevel;
}

/**
 * MCP server instance with LumenFlow tools and resources
 */
export interface McpServer {
  /** Server name */
  name: string;
  /** Server configuration */
  config: Required<McpServerConfig>;
  /** List available tools */
  listTools: () => Array<{ name: string; description: string }>;
  /** List available static resources */
  listResources: () => Array<{ uri: string; name: string; description: string }>;
  /** List available resource templates */
  listResourceTemplates: () => Array<{ uriTemplate: string; name: string; description: string }>;
  /** Start the server (connects stdio transport) */
  start: () => Promise<void>;
  /** Stop the server */
  stop: () => Promise<void>;
}

const REQUIRED_RUNTIME_TOOL_NAMES: readonly string[] = [
  RuntimeTaskToolNames.TASK_CLAIM,
  RuntimeTaskToolNames.TASK_CREATE,
  RuntimeTaskToolNames.TASK_COMPLETE,
  RuntimeTaskToolNames.TASK_BLOCK,
  RuntimeTaskToolNames.TASK_UNBLOCK,
  RuntimeTaskToolNames.TASK_INSPECT,
  RuntimeTaskToolNames.TOOL_EXECUTE,
];

const REQUIRED_RUNTIME_MISSING_PREFIX = 'Required runtime MCP tool(s) missing from registry';

/**
 * Convert a Zod schema to JSON Schema format for MCP
 */
function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema) as Record<string, unknown>;
}

function collectMissingTools(
  availableToolNames: Set<string>,
  requiredToolNames: readonly string[],
) {
  return requiredToolNames.filter((toolName) => !availableToolNames.has(toolName));
}

/**
 * Create an MCP server with LumenFlow tools and resources
 *
 * @param config - Server configuration
 * @returns MCP server instance
 *
 * @example
 * const server = createMcpServer({
 *   projectRoot: process.env.LUMENFLOW_PROJECT_ROOT,
 *   logLevel: process.env.LUMENFLOW_MCP_LOG_LEVEL as LogLevel,
 * });
 * await server.start();
 */
export function createMcpServer(config: McpServerConfig = {}): McpServer {
  const resolvedConfig: Required<McpServerConfig> = {
    projectRoot: config.projectRoot || process.env[ENV_VARS.PROJECT_ROOT] || process.cwd(),
    logLevel: config.logLevel || (process.env[ENV_VARS.MCP_LOG_LEVEL] as LogLevel) || 'info',
  };

  const runtimeToolNames = new Set(runtimeTaskTools.map((tool) => tool.name));
  const missingRuntimeTools = collectMissingTools(runtimeToolNames, REQUIRED_RUNTIME_TOOL_NAMES);
  if (missingRuntimeTools.length > 0) {
    throw createError(
      ErrorCodes.CONFIG_ERROR,
      `${REQUIRED_RUNTIME_MISSING_PREFIX}: ${missingRuntimeTools.join(', ')}`,
    );
  }

  // Create the MCP SDK server
  const server = new Server(
    {
      name: '@lumenflow/mcp',
      version: '2.10.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  // Register tool handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: registeredTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: zodToJsonSchema(tool.inputSchema),
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = registeredTools.find((t) => t.name === name);

    if (!tool) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        isError: true,
      };
    }

    try {
      const result = await tool.execute(args || {}, { projectRoot: resolvedConfig.projectRoot });
      const enrichedResult = await enrichToolResultWithSignals(result, {
        projectRoot: resolvedConfig.projectRoot,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(enrichedResult) }],
        isError: !result.success,
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          },
        ],
        isError: true,
      };
    }
  });

  // Register resource handlers
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: staticResources
        .filter((r): r is typeof r & { uri: string } => r.uri !== undefined)
        .map((r) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        })),
    };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return {
      resourceTemplates: resourceTemplates
        .filter((r): r is typeof r & { uriTemplate: string } => r.uriTemplate !== undefined)
        .map((r) => ({
          uriTemplate: r.uriTemplate,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        })),
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    // Find matching resource
    let resource: ResourceDefinition | undefined;

    // Check static resources first
    resource = staticResources.find((r) => r.uri === uri);

    // Check resource templates
    if (!resource) {
      for (const template of resourceTemplates) {
        if (template.uriTemplate) {
          // Simple template matching for lumenflow://wu/{id} pattern
          // Security: pattern is derived from our own static uriTemplate, not user input
          const pattern = template.uriTemplate.replace(/\{[^}]+\}/g, '([^/]+)');
          // eslint-disable-next-line security/detect-non-literal-regexp
          const regex = new RegExp(`^${pattern}$`);
          if (regex.test(uri)) {
            resource = template;
            break;
          }
        }
      }
    }

    if (!resource) {
      return {
        contents: [{ uri, text: `Resource not found: ${uri}`, mimeType: 'text/plain' }],
      };
    }

    const result = await resource.fetch(uri, { projectRoot: resolvedConfig.projectRoot });

    return {
      contents: [
        {
          uri,
          text: result.success ? (result.content ?? '') : `Error: ${result.error}`,
          mimeType: resource.mimeType,
        },
      ],
    };
  });

  // Build the McpServer wrapper
  let transport: StdioServerTransport | null = null;

  return {
    name: '@lumenflow/mcp',
    config: resolvedConfig,

    listTools() {
      return registeredTools.map((t) => ({ name: t.name, description: t.description }));
    },

    listResources() {
      return staticResources
        .filter((r): r is typeof r & { uri: string } => r.uri !== undefined)
        .map((r) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
        }));
    },

    listResourceTemplates() {
      return resourceTemplates
        .filter((r): r is typeof r & { uriTemplate: string } => r.uriTemplate !== undefined)
        .map((r) => ({
          uriTemplate: r.uriTemplate,
          name: r.name,
          description: r.description,
        }));
    },

    async start() {
      transport = new StdioServerTransport();
      await server.connect(transport);
    },

    async stop() {
      if (transport) {
        await server.close();
        transport = null;
      }
    },
  };
}
