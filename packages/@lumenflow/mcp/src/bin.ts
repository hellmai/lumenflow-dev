#!/usr/bin/env node
/**
 * @file bin.ts
 * @description CLI entry point for @lumenflow/mcp
 *
 * WU-1412: MCP server runs via npx @lumenflow/mcp over stdio
 *
 * Usage:
 *   npx @lumenflow/mcp
 *
 * Environment variables:
 *   LUMENFLOW_PROJECT_ROOT - Project root directory
 *   LUMENFLOW_MCP_LOG_LEVEL - Log level (debug, info, warn, error)
 */

import { createMcpServer, type LogLevel } from './server.js';

/**
 * Log to stderr (stdout is reserved for MCP protocol)
 */
function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const projectRoot = process.env.LUMENFLOW_PROJECT_ROOT;
  const logLevel = process.env.LUMENFLOW_MCP_LOG_LEVEL as LogLevel | undefined;

  const server = createMcpServer({
    projectRoot,
    logLevel,
  });

  // Log startup info to stderr (stdout is for MCP protocol)
  if (logLevel === 'debug' || logLevel === 'info') {
    log(`[@lumenflow/mcp] Starting MCP server...`);
    log(`[@lumenflow/mcp] Project root: ${server.config.projectRoot}`);
    log(`[@lumenflow/mcp] Log level: ${server.config.logLevel}`);
    log(
      `[@lumenflow/mcp] Tools: ${server
        .listTools()
        .map((t) => t.name)
        .join(', ')}`,
    );
    log(
      `[@lumenflow/mcp] Resources: ${server
        .listResources()
        .map((r) => r.uri)
        .join(', ')}`,
    );
  }

  // Handle process signals - wrap async handlers to avoid unhandled rejections
  const handleShutdown = (signal: string): void => {
    log(`[@lumenflow/mcp] Received ${signal}, shutting down...`);
    server
      .stop()
      .then(() => {
        process.exit(0);
      })
      .catch((err: unknown) => {
        log(
          `[@lumenflow/mcp] Error during shutdown: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      });
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));

  // Start the server
  await server.start();
}

// Run main
main().catch((err: unknown) => {
  log(`[@lumenflow/mcp] Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
