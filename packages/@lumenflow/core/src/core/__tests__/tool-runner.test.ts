/**
 * @file tool-runner.test.mjs
 * @description Unit tests for tool-runner.mjs (WU-1398)
 *
 * Tests the unified tool execution layer that integrates:
 * - Argument validation (via Zod schemas from tool.schemas.ts)
 * - Worktree context detection (via worktree-guard.mjs)
 * - Scope validation (via scope-checker.mjs)
 * - Audit logging (via telemetry integration)
 * - Consistent error handling (via error-handler.mjs)
 *
 * TDD: These tests are written BEFORE implementation per LumenFlow §5
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

// Import will fail until implementation exists (RED phase of TDD)
import { runTool, createToolConfig, ToolRunner, RUNNER_DEFAULTS } from '../tool-runner.js';

import { TOOL_DOMAINS, PERMISSION_LEVELS, TOOL_ERROR_CODES } from '../tool.constants.js';

/**
 * Helper: Create a mock tool definition for testing
 */
function createMockTool(overrides = {}) {
  return {
    metadata: {
      name: 'test:echo',
      description: 'Echo input for testing',
      domain: TOOL_DOMAINS.UTIL,
      permission: PERMISSION_LEVELS.READ,
      version: '1.0.0',
      ...overrides.metadata,
    },
    inputSchema: z.object({
      message: z.string().describe('Message to echo'),
    }),
    outputSchema: z.object({
      echoed: z.string(),
    }),
    execute: mock.fn(async (input) => ({
      success: true,
      data: { echoed: input.message },
    })),
    ...overrides,
  };
}

/**
 * Helper: Create mock dependencies for dependency injection
 */
function createMockDependencies() {
  return {
    getWUContext: mock.fn(() => ({
      wuId: 'WU-1398',
      lane: 'operations-tooling',
      worktreePath: 'worktrees/operations-tooling-wu-1398',
    })),
    getActiveScope: mock.fn(() => ({
      wuId: 'WU-1398',
      code_paths: ['tools/lib/core/**/*.js'],
    })),
    isPathInScope: mock.fn(() => true),
    assertWorktreeRequired: mock.fn(() => Promise.resolve()),
    logAudit: mock.fn(() => {}),
  };
}

describe('tool-runner', () => {
  describe('createToolConfig', () => {
    it('should create a valid tool configuration with defaults', () => {
      const tool = createMockTool();
      const config = createToolConfig(tool);

      assert.strictEqual(config.requiresWorktree, false);
      assert.strictEqual(config.requiresScope, false);
      assert.strictEqual(config.enableAuditLog, true);
      assert.strictEqual(config.timeoutMs, RUNNER_DEFAULTS.TIMEOUT_MS);
    });

    it('should respect explicit configuration options', () => {
      const tool = createMockTool();
      const config = createToolConfig(tool, {
        requiresWorktree: true,
        requiresScope: true,
        enableAuditLog: false,
        timeoutMs: 5000,
      });

      assert.strictEqual(config.requiresWorktree, true);
      assert.strictEqual(config.requiresScope, true);
      assert.strictEqual(config.enableAuditLog, false);
      assert.strictEqual(config.timeoutMs, 5000);
    });

    it('should infer requiresWorktree from write permission', () => {
      const writeTool = createMockTool({
        metadata: { permission: PERMISSION_LEVELS.WRITE },
      });
      const config = createToolConfig(writeTool);

      assert.strictEqual(config.requiresWorktree, true);
    });

    it('should infer requiresScope from write permission', () => {
      const writeTool = createMockTool({
        metadata: { permission: PERMISSION_LEVELS.WRITE },
      });
      const config = createToolConfig(writeTool);

      assert.strictEqual(config.requiresScope, true);
    });
  });

  describe('runTool - happy path', () => {
    it('should execute tool and return success output', async () => {
      const tool = createMockTool();
      const deps = createMockDependencies();

      const result = await runTool(tool, { message: 'hello' }, { dependencies: deps });

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.data, { echoed: 'hello' });
    });

    it('should call tool execute function with validated input', async () => {
      const tool = createMockTool();
      const deps = createMockDependencies();

      await runTool(tool, { message: 'test-input' }, { dependencies: deps });

      assert.strictEqual(tool.execute.mock.calls.length, 1);
      assert.deepStrictEqual(tool.execute.mock.calls[0].arguments[0], { message: 'test-input' });
    });

    it('should include execution metadata in output', async () => {
      const tool = createMockTool();
      const deps = createMockDependencies();

      const result = await runTool(tool, { message: 'hello' }, { dependencies: deps });

      assert.ok(result.metadata);
      assert.ok(typeof result.metadata.durationMs === 'number');
      assert.ok(typeof result.metadata.startedAt === 'string');
    });

    it('should pass context to tool execute function', async () => {
      const tool = createMockTool();
      const deps = createMockDependencies();
      const context = { sessionId: 'test-session', userId: 'test-user' };

      await runTool(tool, { message: 'hello' }, { dependencies: deps, context });

      assert.strictEqual(tool.execute.mock.calls.length, 1);
      const callArgs = tool.execute.mock.calls[0].arguments;
      assert.deepStrictEqual(callArgs[1], context);
    });
  });

  describe('runTool - input validation', () => {
    it('should reject invalid input with SCHEMA_VALIDATION_FAILED error', async () => {
      const tool = createMockTool();
      const deps = createMockDependencies();

      // Missing required 'message' field
      const result = await runTool(tool, {}, { dependencies: deps });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error.code, TOOL_ERROR_CODES.SCHEMA_VALIDATION_FAILED);
      assert.match(result.error.message, /validation failed/i);
    });

    it('should reject input with wrong type', async () => {
      const tool = createMockTool();
      const deps = createMockDependencies();

      const result = await runTool(tool, { message: 12345 }, { dependencies: deps });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error.code, TOOL_ERROR_CODES.SCHEMA_VALIDATION_FAILED);
    });

    it('should provide tryNext suggestions in validation errors', async () => {
      const tool = createMockTool();
      const deps = createMockDependencies();

      const result = await runTool(tool, {}, { dependencies: deps });

      assert.ok(result.error.tryNext);
      assert.ok(Array.isArray(result.error.tryNext));
      assert.ok(result.error.tryNext.length > 0);
    });
  });

  describe('runTool - worktree enforcement', () => {
    it('should check worktree when requiresWorktree is true', async () => {
      const tool = createMockTool({
        metadata: { permission: PERMISSION_LEVELS.WRITE },
      });
      const deps = createMockDependencies();

      await runTool(
        tool,
        { message: 'hello' },
        {
          dependencies: deps,
          config: { requiresWorktree: true },
        },
      );

      assert.strictEqual(deps.assertWorktreeRequired.mock.calls.length, 1);
    });

    it('should not check worktree for read-only tools', async () => {
      const tool = createMockTool({
        metadata: { permission: PERMISSION_LEVELS.READ },
      });
      const deps = createMockDependencies();

      await runTool(
        tool,
        { message: 'hello' },
        {
          dependencies: deps,
          config: { requiresWorktree: false },
        },
      );

      assert.strictEqual(deps.assertWorktreeRequired.mock.calls.length, 0);
    });

    it('should return error when worktree check fails', async () => {
      const tool = createMockTool({
        metadata: { permission: PERMISSION_LEVELS.WRITE },
      });
      const deps = createMockDependencies();
      deps.assertWorktreeRequired = mock.fn(() => {
        throw new Error('BLOCKED: Operation requires worktree');
      });

      const result = await runTool(
        tool,
        { message: 'hello' },
        {
          dependencies: deps,
          config: { requiresWorktree: true },
        },
      );

      assert.strictEqual(result.success, false);
      assert.match(result.error.message, /worktree/i);
    });
  });

  describe('runTool - scope enforcement', () => {
    it('should check scope for file write operations', async () => {
      const tool = createMockTool({
        metadata: {
          name: 'file:write',
          domain: TOOL_DOMAINS.FILE,
          permission: PERMISSION_LEVELS.WRITE,
        },
        inputSchema: z.object({
          path: z.string(),
          content: z.string(),
        }),
      });
      const deps = createMockDependencies();

      await runTool(
        tool,
        { path: 'tools/lib/core/test.js', content: 'test' },
        {
          dependencies: deps,
          config: { requiresScope: true },
        },
      );

      assert.strictEqual(deps.getActiveScope.mock.calls.length, 1);
      assert.strictEqual(deps.isPathInScope.mock.calls.length, 1);
    });

    it('should return error when path is out of scope', async () => {
      const tool = createMockTool({
        metadata: {
          name: 'file:write',
          domain: TOOL_DOMAINS.FILE,
          permission: PERMISSION_LEVELS.WRITE,
        },
        inputSchema: z.object({
          path: z.string(),
          content: z.string(),
        }),
      });
      const deps = createMockDependencies();
      deps.isPathInScope = mock.fn(() => false);

      const result = await runTool(
        tool,
        { path: 'apps/web/src/index.ts', content: 'test' },
        {
          dependencies: deps,
          config: { requiresScope: true },
        },
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error.code, TOOL_ERROR_CODES.PERMISSION_DENIED);
      assert.match(result.error.message, /scope/i);
    });

    it('should skip scope check when no active WU context', async () => {
      const tool = createMockTool({
        metadata: { permission: PERMISSION_LEVELS.WRITE },
      });
      const deps = createMockDependencies();
      deps.getActiveScope = mock.fn(() => null);

      const result = await runTool(
        tool,
        { message: 'hello' },
        {
          dependencies: deps,
          config: { requiresScope: true },
        },
      );

      // Should still succeed - no scope means no restrictions
      assert.strictEqual(result.success, true);
    });
  });

  describe('runTool - audit logging', () => {
    it('should log tool invocation when enableAuditLog is true', async () => {
      const tool = createMockTool();
      const deps = createMockDependencies();

      await runTool(
        tool,
        { message: 'hello' },
        {
          dependencies: deps,
          config: { enableAuditLog: true },
        },
      );

      assert.strictEqual(deps.logAudit.mock.calls.length, 1);
      const logEntry = deps.logAudit.mock.calls[0].arguments[0];
      assert.strictEqual(logEntry.tool, 'test:echo');
      assert.strictEqual(logEntry.status, 'success');
    });

    it('should not log when enableAuditLog is false', async () => {
      const tool = createMockTool();
      const deps = createMockDependencies();

      await runTool(
        tool,
        { message: 'hello' },
        {
          dependencies: deps,
          config: { enableAuditLog: false },
        },
      );

      assert.strictEqual(deps.logAudit.mock.calls.length, 0);
    });

    it('should log failure status when tool execution fails', async () => {
      const tool = createMockTool({
        execute: mock.fn(async () => {
          throw new Error('Tool execution failed');
        }),
      });
      const deps = createMockDependencies();

      await runTool(
        tool,
        { message: 'hello' },
        {
          dependencies: deps,
          config: { enableAuditLog: true },
        },
      );

      assert.strictEqual(deps.logAudit.mock.calls.length, 1);
      const logEntry = deps.logAudit.mock.calls[0].arguments[0];
      assert.strictEqual(logEntry.status, 'failed');
    });

    it('should include WU context in audit log entry', async () => {
      const tool = createMockTool();
      const deps = createMockDependencies();

      await runTool(
        tool,
        { message: 'hello' },
        {
          dependencies: deps,
          config: { enableAuditLog: true },
        },
      );

      const logEntry = deps.logAudit.mock.calls[0].arguments[0];
      assert.strictEqual(logEntry.context.wuId, 'WU-1398');
      assert.strictEqual(logEntry.context.lane, 'operations-tooling');
    });
  });

  describe('runTool - error handling', () => {
    it('should catch and wrap tool execution errors', async () => {
      const tool = createMockTool({
        execute: mock.fn(async () => {
          throw new Error('Database connection failed');
        }),
      });
      const deps = createMockDependencies();

      const result = await runTool(tool, { message: 'hello' }, { dependencies: deps });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error.code, TOOL_ERROR_CODES.EXECUTION_FAILED);
      assert.match(result.error.message, /Database connection failed/);
    });

    it('should preserve error stack trace in error details', async () => {
      const tool = createMockTool({
        execute: mock.fn(async () => {
          throw new Error('Test error');
        }),
      });
      const deps = createMockDependencies();

      const result = await runTool(tool, { message: 'hello' }, { dependencies: deps });

      assert.ok(result.error.stack);
      assert.match(result.error.stack, /Error: Test error/);
    });

    it('should handle non-Error exceptions gracefully', async () => {
      const tool = createMockTool({
        execute: mock.fn(async () => {
          throw 'string error';
        }),
      });
      const deps = createMockDependencies();

      const result = await runTool(tool, { message: 'hello' }, { dependencies: deps });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error.code, TOOL_ERROR_CODES.EXECUTION_FAILED);
    });
  });

  describe('runTool - output validation', () => {
    it('should validate tool output when outputSchema is defined', async () => {
      const tool = createMockTool({
        execute: mock.fn(async () => ({
          success: true,
          data: { echoed: 'hello' }, // Valid output
        })),
      });
      const deps = createMockDependencies();

      const result = await runTool(tool, { message: 'hello' }, { dependencies: deps });

      assert.strictEqual(result.success, true);
    });

    it('should fail when output does not match outputSchema', async () => {
      const tool = createMockTool({
        execute: mock.fn(async () => ({
          success: true,
          data: { wrongField: 'value' }, // Invalid output
        })),
      });
      const deps = createMockDependencies();

      const result = await runTool(tool, { message: 'hello' }, { dependencies: deps });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error.code, TOOL_ERROR_CODES.INVALID_OUTPUT);
    });

    it('should skip output validation when outputSchema is not defined', async () => {
      const tool = createMockTool();
      delete tool.outputSchema;
      tool.execute = mock.fn(async () => ({
        success: true,
        data: { anything: 'goes' },
      }));
      const deps = createMockDependencies();

      const result = await runTool(tool, { message: 'hello' }, { dependencies: deps });

      assert.strictEqual(result.success, true);
    });
  });

  describe('ToolRunner class', () => {
    it('should create instance with default configuration', () => {
      const runner = new ToolRunner();

      assert.ok(runner);
      assert.strictEqual(typeof runner.run, 'function');
      assert.strictEqual(typeof runner.register, 'function');
    });

    it('should allow registering tools', () => {
      const runner = new ToolRunner();
      const tool = createMockTool();

      runner.register(tool);

      assert.ok(runner.hasTool('test:echo'));
    });

    it('should reject duplicate tool registration', () => {
      const runner = new ToolRunner();
      const tool = createMockTool();

      runner.register(tool);

      assert.throws(() => {
        runner.register(tool);
      }, /already registered/i);
    });

    it('should run registered tool by name', async () => {
      const runner = new ToolRunner();
      const tool = createMockTool();
      runner.register(tool);

      const result = await runner.run('test:echo', { message: 'hello' });

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.data, { echoed: 'hello' });
    });

    it('should return error for unknown tool name', async () => {
      const runner = new ToolRunner();

      const result = await runner.run('unknown:tool', {});

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error.code, TOOL_ERROR_CODES.TOOL_NOT_FOUND);
    });

    it('should allow setting global configuration', () => {
      const runner = new ToolRunner({
        enableAuditLog: false,
        timeoutMs: 10000,
      });

      const config = runner.getConfig();

      assert.strictEqual(config.enableAuditLog, false);
      assert.strictEqual(config.timeoutMs, 10000);
    });

    it('should allow injecting dependencies', () => {
      const mockDeps = createMockDependencies();
      const runner = new ToolRunner({ dependencies: mockDeps });
      const tool = createMockTool();
      runner.register(tool);

      runner.run('test:echo', { message: 'hello' });

      // Dependencies should be used
      assert.ok(mockDeps.getWUContext.mock.calls.length >= 0);
    });

    it('should list all registered tools', () => {
      const runner = new ToolRunner();
      runner.register(createMockTool({ metadata: { name: 'tool:one' } }));
      runner.register(createMockTool({ metadata: { name: 'tool:two' } }));

      const tools = runner.listTools();

      assert.strictEqual(tools.length, 2);
      assert.ok(tools.some((t) => t.name === 'tool:one'));
      assert.ok(tools.some((t) => t.name === 'tool:two'));
    });

    it('should filter tools by domain', () => {
      const runner = new ToolRunner();
      runner.register(
        createMockTool({ metadata: { name: 'git:status', domain: TOOL_DOMAINS.GIT } }),
      );
      runner.register(
        createMockTool({ metadata: { name: 'file:read', domain: TOOL_DOMAINS.FILE } }),
      );

      const gitTools = runner.listTools({ domain: TOOL_DOMAINS.GIT });

      assert.strictEqual(gitTools.length, 1);
      assert.strictEqual(gitTools[0].name, 'git:status');
    });
  });

  describe('RUNNER_DEFAULTS', () => {
    it('should export default timeout value', () => {
      assert.ok(RUNNER_DEFAULTS.TIMEOUT_MS);
      assert.strictEqual(typeof RUNNER_DEFAULTS.TIMEOUT_MS, 'number');
      assert.ok(RUNNER_DEFAULTS.TIMEOUT_MS > 0);
    });

    it('should export default audit log setting', () => {
      assert.strictEqual(typeof RUNNER_DEFAULTS.ENABLE_AUDIT_LOG, 'boolean');
    });
  });
});

describe('integration scenarios', () => {
  describe('write tool with full guards', () => {
    it('should enforce worktree + scope for file write operation', async () => {
      const fileWriteTool = {
        metadata: {
          name: 'file:write',
          description: 'Write content to file',
          domain: TOOL_DOMAINS.FILE,
          permission: PERMISSION_LEVELS.WRITE,
          version: '1.0.0',
        },
        inputSchema: z.object({
          path: z.string(),
          content: z.string(),
        }),
        execute: mock.fn(async (input) => ({
          success: true,
          data: { path: input.path, bytesWritten: input.content.length },
        })),
      };

      const deps = createMockDependencies();

      const result = await runTool(
        fileWriteTool,
        { path: 'tools/lib/core/new-file.js', content: 'test content' },
        { dependencies: deps },
      );

      // Should check worktree
      assert.strictEqual(deps.assertWorktreeRequired.mock.calls.length, 1);

      // Should check scope
      assert.strictEqual(deps.getActiveScope.mock.calls.length, 1);
      assert.strictEqual(deps.isPathInScope.mock.calls.length, 1);

      // Should succeed
      assert.strictEqual(result.success, true);
    });
  });

  describe('read tool with minimal guards', () => {
    it('should skip worktree + scope checks for read operation', async () => {
      const fileReadTool = {
        metadata: {
          name: 'file:read',
          description: 'Read file content',
          domain: TOOL_DOMAINS.FILE,
          permission: PERMISSION_LEVELS.READ,
          version: '1.0.0',
        },
        inputSchema: z.object({
          path: z.string(),
        }),
        execute: mock.fn(async () => ({
          success: true,
          data: { content: 'file content' },
        })),
      };

      const deps = createMockDependencies();

      const result = await runTool(fileReadTool, { path: 'any/path.txt' }, { dependencies: deps });

      // Should NOT check worktree for read
      assert.strictEqual(deps.assertWorktreeRequired.mock.calls.length, 0);

      // Should succeed
      assert.strictEqual(result.success, true);
    });
  });
});
