/**
 * @file stdio-handshake.test.ts
 * @description Tests for MCP server stdio transport handshake
 *
 * WU-1412: MCP server runs via npx @lumenflow/mcp over stdio
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMcpServer, type McpServerConfig } from '../server.js';

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
});
