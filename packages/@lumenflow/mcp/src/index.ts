/**
 * @lumenflow/mcp - MCP stdio server for LumenFlow workflow framework
 * @module @lumenflow/mcp
 *
 * WU-1412: Provides MCP server with LumenFlow tools and resources.
 *
 * Tools:
 * - context_get: Get current LumenFlow context
 * - wu_list: List all Work Units
 * - wu_status: Get WU status
 * - wu_create: Create a new WU
 * - wu_claim: Claim a WU
 * - wu_done: Complete a WU
 * - gates_run: Run quality gates
 *
 * Resources:
 * - lumenflow://context: Current context
 * - lumenflow://wu/{id}: WU by ID
 * - lumenflow://backlog: Current backlog
 *
 * @example
 * ```typescript
 * import { createMcpServer } from '@lumenflow/mcp';
 *
 * const server = createMcpServer({
 *   projectRoot: '/path/to/project',
 *   logLevel: 'info',
 * });
 *
 * await server.start();
 * ```
 */

// Server
export { createMcpServer, type McpServer, type McpServerConfig, type LogLevel } from './server.js';

// Tools
export {
  allTools,
  contextGetTool,
  wuListTool,
  wuStatusTool,
  wuCreateTool,
  wuClaimTool,
  wuDoneTool,
  gatesRunTool,
  type ToolDefinition,
  type ToolResult,
} from './tools.js';

// Resources
export {
  allResources,
  staticResources,
  resourceTemplates,
  contextResource,
  wuResource,
  backlogResource,
  type ResourceDefinition,
  type ResourceResult,
} from './resources.js';

// CLI Runner
export {
  runCliCommand,
  parseJsonOutput,
  type CliRunnerOptions,
  type CliRunnerResult,
} from './cli-runner.js';
