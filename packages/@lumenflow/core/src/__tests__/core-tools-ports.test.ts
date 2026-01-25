/**
 * Core Tools Ports Tests
 *
 * WU-1101: INIT-003 Phase 2a - Migrate tools/lib/core/ to @lumenflow/core
 *
 * Tests for port interfaces and implementations:
 * - IToolRunner / runTool, ToolRunner
 * - IWorktreeGuard / getWUContext, assertWorktreeRequired, isInWorktree, isMainBranch
 * - IScopeChecker / getActiveScope, isPathInScope, assertPathInScope
 *
 * TDD: These tests verify port interface compliance and coverage.
 *
 * @module __tests__/core-tools-ports
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// Import port interfaces
import type {
  IToolRunner,
  IWorktreeGuard,
  IScopeChecker,
  IToolDefinition,
  IWUContext,
  IWUScope,
} from '../ports/core-tools.ports.js';

// Import implementations
import { runTool, ToolRunner, createToolConfig, RUNNER_DEFAULTS } from '../core/tool-runner.js';

import {
  isInWorktree,
  isMainBranch,
  getWUContext,
  assertWorktreeRequired,
} from '../core/worktree-guard.js';

import { getActiveScope, isPathInScope, assertPathInScope } from '../core/scope-checker.js';

import { TOOL_DOMAINS, PERMISSION_LEVELS, TOOL_ERROR_CODES } from '../core/tool.constants.js';

/**
 * Helper: Create a mock tool definition for testing
 */
function createMockTool(overrides: Partial<IToolDefinition> = {}): IToolDefinition {
  return {
    metadata: {
      name: 'test:echo',
      description: 'Echo input for testing',
      domain: TOOL_DOMAINS.UTIL,
      permission: PERMISSION_LEVELS.READ,
      version: '1.0.0',
      ...((overrides as { metadata?: object }).metadata || {}),
    },
    inputSchema: z.object({
      message: z.string().describe('Message to echo'),
    }),
    outputSchema: z.object({
      echoed: z.string(),
    }),
    execute: vi.fn(async (input: { message: string }) => ({
      success: true as const,
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
    getWUContext: vi.fn(() =>
      Promise.resolve({
        wuId: 'WU-1101',
        lane: 'framework-core',
        worktreePath: 'worktrees/framework-core-wu-1101',
      }),
    ),
    getActiveScope: vi.fn(() =>
      Promise.resolve({
        wuId: 'WU-1101',
        code_paths: ['packages/@lumenflow/core/**/*.ts'],
      }),
    ),
    isPathInScope: vi.fn(() => true),
    assertWorktreeRequired: vi.fn(() => Promise.resolve()),
    logAudit: vi.fn(),
  };
}

describe('Port Interface Compliance', () => {
  describe('IToolRunner port interface', () => {
    it('should have runTool function matching port signature', () => {
      // Verify runTool exists and is a function
      expect(typeof runTool).toBe('function');
    });

    it('should have ToolRunner class implementing port interface', () => {
      const runner = new ToolRunner();

      // Verify all required methods exist
      expect(typeof runner.register).toBe('function');
      expect(typeof runner.hasTool).toBe('function');
      expect(typeof runner.run).toBe('function');
      expect(typeof runner.listTools).toBe('function');
    });

    it('should export RUNNER_DEFAULTS configuration', () => {
      expect(RUNNER_DEFAULTS).toHaveProperty('TIMEOUT_MS');
      expect(RUNNER_DEFAULTS).toHaveProperty('ENABLE_AUDIT_LOG');
      expect(typeof RUNNER_DEFAULTS.TIMEOUT_MS).toBe('number');
      expect(typeof RUNNER_DEFAULTS.ENABLE_AUDIT_LOG).toBe('boolean');
    });
  });

  describe('IWorktreeGuard port interface', () => {
    it('should have isInWorktree function matching port signature', () => {
      expect(typeof isInWorktree).toBe('function');

      // Test with explicit cwd
      const result = isInWorktree({ cwd: '/some/path' });
      expect(typeof result).toBe('boolean');
    });

    it('should have isMainBranch function matching port signature', async () => {
      expect(typeof isMainBranch).toBe('function');

      // Test with mock git
      const mockGit = { getCurrentBranch: async () => 'main' };
      const result = await isMainBranch({ git: mockGit });
      expect(typeof result).toBe('boolean');
    });

    it('should have getWUContext function matching port signature', async () => {
      expect(typeof getWUContext).toBe('function');

      // Test with mock git
      const mockGit = { getCurrentBranch: async () => 'main' };
      const result = await getWUContext({ cwd: '/some/path', git: mockGit });
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('should have assertWorktreeRequired function matching port signature', () => {
      expect(typeof assertWorktreeRequired).toBe('function');
    });
  });

  describe('IScopeChecker port interface', () => {
    it('should have getActiveScope function matching port signature', async () => {
      expect(typeof getActiveScope).toBe('function');

      // Test with mocked dependencies
      const mockGetWUContext = vi.fn(() => Promise.resolve(null));
      const mockLoadWUYaml = vi.fn();

      const result = await getActiveScope({
        getWUContext: mockGetWUContext,
        loadWUYaml: mockLoadWUYaml,
      });

      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('should have isPathInScope function matching port signature', () => {
      expect(typeof isPathInScope).toBe('function');

      const scope: IWUScope = {
        wuId: 'WU-1101',
        code_paths: ['src/**/*.ts'],
      };

      const result = isPathInScope('src/test.ts', scope);
      expect(typeof result).toBe('boolean');
    });

    it('should have assertPathInScope function matching port signature', () => {
      expect(typeof assertPathInScope).toBe('function');

      const scope: IWUScope = {
        wuId: 'WU-1101',
        code_paths: ['src/**/*.ts'],
      };

      // Should not throw for path in scope
      expect(() => assertPathInScope('src/test.ts', scope)).not.toThrow();
    });
  });
});

describe('ToolRunner Implementation', () => {
  describe('createToolConfig', () => {
    it('should create config with sensible defaults for read-only tools', () => {
      const tool = createMockTool();
      const config = createToolConfig(tool);

      expect(config.requiresWorktree).toBe(false);
      expect(config.requiresScope).toBe(false);
      expect(config.enableAuditLog).toBe(true);
      expect(config.timeoutMs).toBe(RUNNER_DEFAULTS.TIMEOUT_MS);
    });

    it('should infer worktree requirement from write permission', () => {
      const tool = createMockTool({
        metadata: {
          name: 'file:write',
          description: 'Write file',
          permission: PERMISSION_LEVELS.WRITE,
        },
      });
      const config = createToolConfig(tool);

      expect(config.requiresWorktree).toBe(true);
      expect(config.requiresScope).toBe(true);
    });

    it('should respect explicit configuration overrides', () => {
      const tool = createMockTool();
      const config = createToolConfig(tool, {
        requiresWorktree: true,
        requiresScope: true,
        enableAuditLog: false,
        timeoutMs: 5000,
      });

      expect(config.requiresWorktree).toBe(true);
      expect(config.requiresScope).toBe(true);
      expect(config.enableAuditLog).toBe(false);
      expect(config.timeoutMs).toBe(5000);
    });
  });

  describe('runTool - happy path', () => {
    it('should execute tool and return success output', async () => {
      const tool = createMockTool();
      const deps = createMockDependencies();

      const result = await runTool(tool, { message: 'hello' }, { dependencies: deps });

      expect(result.success).toBe(true);
      expect((result as { success: true; data: { echoed: string } }).data).toEqual({
        echoed: 'hello',
      });
    });

    it('should include execution metadata in output', async () => {
      const tool = createMockTool();
      const deps = createMockDependencies();

      const result = await runTool(tool, { message: 'hello' }, { dependencies: deps });

      expect(result.metadata).toBeDefined();
      expect(typeof result.metadata?.durationMs).toBe('number');
      expect(typeof result.metadata?.startedAt).toBe('string');
    });
  });

  describe('runTool - input validation', () => {
    it('should reject invalid input with schema validation error', async () => {
      const tool = createMockTool();
      const deps = createMockDependencies();

      const result = await runTool(tool, {}, { dependencies: deps });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(TOOL_ERROR_CODES.SCHEMA_VALIDATION_FAILED);
    });

    it('should provide tryNext suggestions in validation errors', async () => {
      const tool = createMockTool();
      const deps = createMockDependencies();

      const result = await runTool(tool, {}, { dependencies: deps });

      expect(result.error?.tryNext).toBeDefined();
      expect(Array.isArray(result.error?.tryNext)).toBe(true);
    });
  });

  describe('runTool - worktree enforcement', () => {
    it('should check worktree when requiresWorktree is true', async () => {
      const tool = createMockTool({
        metadata: {
          name: 'file:write',
          description: 'Write file',
          permission: PERMISSION_LEVELS.WRITE,
        },
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

      expect(deps.assertWorktreeRequired).toHaveBeenCalled();
    });

    it('should not check worktree for read-only tools', async () => {
      const tool = createMockTool();
      const deps = createMockDependencies();

      await runTool(
        tool,
        { message: 'hello' },
        {
          dependencies: deps,
          config: { requiresWorktree: false },
        },
      );

      expect(deps.assertWorktreeRequired).not.toHaveBeenCalled();
    });

    it('should return error when worktree check fails', async () => {
      const tool = createMockTool();
      const deps = createMockDependencies();
      deps.assertWorktreeRequired = vi.fn(() => {
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

      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/worktree/i);
    });
  });

  describe('runTool - scope enforcement', () => {
    it('should check scope for file write operations', async () => {
      const tool = createMockTool({
        metadata: {
          name: 'file:write',
          description: 'Write file',
          domain: TOOL_DOMAINS.FILE,
          permission: PERMISSION_LEVELS.WRITE,
        },
        inputSchema: z.object({
          path: z.string(),
          content: z.string(),
        }),
        execute: vi.fn(async () => ({ success: true as const, data: {} })),
      });
      const deps = createMockDependencies();

      await runTool(
        tool,
        { path: 'src/test.ts', content: 'test' },
        {
          dependencies: deps,
          config: { requiresScope: true },
        },
      );

      expect(deps.getActiveScope).toHaveBeenCalled();
      expect(deps.isPathInScope).toHaveBeenCalled();
    });

    it('should return error when path is out of scope', async () => {
      const tool = createMockTool({
        metadata: {
          name: 'file:write',
          description: 'Write file',
          domain: TOOL_DOMAINS.FILE,
          permission: PERMISSION_LEVELS.WRITE,
        },
        inputSchema: z.object({
          path: z.string(),
          content: z.string(),
        }),
        execute: vi.fn(async () => ({ success: true as const, data: {} })),
      });
      const deps = createMockDependencies();
      deps.isPathInScope = vi.fn(() => false);

      const result = await runTool(
        tool,
        { path: 'outside/scope.ts', content: 'test' },
        {
          dependencies: deps,
          config: { requiresScope: true },
        },
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(TOOL_ERROR_CODES.PERMISSION_DENIED);
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

      expect(deps.logAudit).toHaveBeenCalled();
      const logEntry = deps.logAudit.mock.calls[0][0];
      expect(logEntry.tool).toBe('test:echo');
      expect(logEntry.status).toBe('success');
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

      expect(deps.logAudit).not.toHaveBeenCalled();
    });
  });

  describe('runTool - error handling', () => {
    it('should catch and wrap tool execution errors', async () => {
      const tool = createMockTool({
        execute: vi.fn(async () => {
          throw new Error('Database connection failed');
        }),
      });
      const deps = createMockDependencies();

      const result = await runTool(tool, { message: 'hello' }, { dependencies: deps });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(TOOL_ERROR_CODES.EXECUTION_FAILED);
      expect(result.error?.message).toMatch(/Database connection failed/);
    });
  });

  describe('ToolRunner class', () => {
    it('should register and run tools', async () => {
      const runner = new ToolRunner();
      const tool = createMockTool();

      runner.register(tool);
      expect(runner.hasTool('test:echo')).toBe(true);

      const result = await runner.run('test:echo', { message: 'hello' });
      expect(result.success).toBe(true);
    });

    it('should reject duplicate tool registration', () => {
      const runner = new ToolRunner();
      const tool = createMockTool();

      runner.register(tool);
      expect(() => runner.register(tool)).toThrow(/already registered/i);
    });

    it('should return error for unknown tool name', async () => {
      const runner = new ToolRunner();

      const result = await runner.run('unknown:tool', {});

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(TOOL_ERROR_CODES.TOOL_NOT_FOUND);
    });

    it('should list registered tools', () => {
      const runner = new ToolRunner();
      runner.register(
        createMockTool({
          metadata: { name: 'tool:one', description: 'One', permission: PERMISSION_LEVELS.READ },
        }),
      );
      runner.register(
        createMockTool({
          metadata: { name: 'tool:two', description: 'Two', permission: PERMISSION_LEVELS.READ },
        }),
      );

      const tools = runner.listTools();

      expect(tools.length).toBe(2);
      expect(tools.some((t) => t.name === 'tool:one')).toBe(true);
      expect(tools.some((t) => t.name === 'tool:two')).toBe(true);
    });

    it('should filter tools by domain', () => {
      const runner = new ToolRunner();
      runner.register(
        createMockTool({
          metadata: {
            name: 'git:status',
            description: 'Git',
            domain: TOOL_DOMAINS.GIT,
            permission: PERMISSION_LEVELS.READ,
          },
        }),
      );
      runner.register(
        createMockTool({
          metadata: {
            name: 'file:read',
            description: 'File',
            domain: TOOL_DOMAINS.FILE,
            permission: PERMISSION_LEVELS.READ,
          },
        }),
      );

      const gitTools = runner.listTools({ domain: TOOL_DOMAINS.GIT });

      expect(gitTools.length).toBe(1);
      expect(gitTools[0].name).toBe('git:status');
    });
  });
});

describe('WorktreeGuard Implementation', () => {
  describe('isInWorktree', () => {
    it('should return true when in worktree directory', () => {
      const result = isInWorktree({ cwd: '/project/worktrees/framework-core-wu-1101' });
      expect(result).toBe(true);
    });

    it('should return true when in nested directory within worktree', () => {
      const result = isInWorktree({ cwd: '/project/worktrees/framework-core-wu-1101/src/lib' });
      expect(result).toBe(true);
    });

    it('should return false when in main checkout', () => {
      const result = isInWorktree({ cwd: '/project' });
      expect(result).toBe(false);
    });

    it('should return false when worktree pattern does not match', () => {
      const result = isInWorktree({ cwd: '/project/worktrees/invalid-path' });
      expect(result).toBe(false);
    });
  });

  describe('isMainBranch', () => {
    it('should return true when on main branch', async () => {
      const mockGit = { getCurrentBranch: async () => 'main' };
      const result = await isMainBranch({ git: mockGit });
      expect(result).toBe(true);
    });

    it('should return true when on master branch', async () => {
      const mockGit = { getCurrentBranch: async () => 'master' };
      const result = await isMainBranch({ git: mockGit });
      expect(result).toBe(true);
    });

    it('should return false when on lane branch', async () => {
      const mockGit = { getCurrentBranch: async () => 'lane/framework-core/wu-1101' };
      const result = await isMainBranch({ git: mockGit });
      expect(result).toBe(false);
    });
  });

  describe('getWUContext', () => {
    it('should extract context from worktree path', async () => {
      const result = await getWUContext({ cwd: '/project/worktrees/framework-core-wu-1101' });

      expect(result).not.toBeNull();
      expect(result?.wuId).toBe('WU-1101');
      expect(result?.lane).toBe('framework-core');
      expect(result?.worktreePath).toBe('worktrees/framework-core-wu-1101');
    });

    it('should extract context from lane branch name', async () => {
      const mockGit = { getCurrentBranch: async () => 'lane/framework-core/wu-1101' };
      const result = await getWUContext({ cwd: '/project', git: mockGit });

      expect(result).not.toBeNull();
      expect(result?.wuId).toBe('WU-1101');
      expect(result?.lane).toBe('framework-core');
      expect(result?.worktreePath).toBeNull();
    });

    it('should return null when not in WU workspace', async () => {
      const mockGit = { getCurrentBranch: async () => 'main' };
      const result = await getWUContext({ cwd: '/project', git: mockGit });

      expect(result).toBeNull();
    });

    it('should prioritize worktree path over branch name', async () => {
      const mockGit = { getCurrentBranch: async () => 'lane/different-lane/wu-999' };
      const result = await getWUContext({
        cwd: '/project/worktrees/framework-core-wu-1101',
        git: mockGit,
      });

      expect(result?.wuId).toBe('WU-1101');
      expect(result?.lane).toBe('framework-core');
    });
  });

  describe('assertWorktreeRequired', () => {
    it('should not throw when in worktree', async () => {
      await expect(
        assertWorktreeRequired({ cwd: '/project/worktrees/framework-core-wu-1101' }),
      ).resolves.toBeUndefined();
    });

    it('should not throw when on lane branch', async () => {
      const mockGit = { getCurrentBranch: async () => 'lane/framework-core/wu-1101' };
      await expect(
        assertWorktreeRequired({ cwd: '/project', git: mockGit }),
      ).resolves.toBeUndefined();
    });

    it('should throw when on main branch in main checkout', async () => {
      const mockGit = { getCurrentBranch: async () => 'main' };
      await expect(
        assertWorktreeRequired({ cwd: '/project', git: mockGit, operation: 'file:write' }),
      ).rejects.toThrow(/BLOCKED.*file:write.*requires a worktree/);
    });
  });
});

describe('ScopeChecker Implementation', () => {
  describe('getActiveScope', () => {
    it('should return null when no WU context available', async () => {
      const mockGetWUContext = vi.fn(() => Promise.resolve(null));
      const mockLoadWUYaml = vi.fn();

      const result = await getActiveScope({
        getWUContext: mockGetWUContext,
        loadWUYaml: mockLoadWUYaml,
      });

      expect(result).toBeNull();
      expect(mockGetWUContext).toHaveBeenCalled();
      expect(mockLoadWUYaml).not.toHaveBeenCalled();
    });

    it('should return code_paths from WU YAML', async () => {
      const mockGetWUContext = vi.fn(() =>
        Promise.resolve({
          wuId: 'WU-1101',
          lane: 'framework-core',
          worktreePath: 'worktrees/framework-core-wu-1101',
        }),
      );
      const mockLoadWUYaml = vi.fn(() => ({
        id: 'WU-1101',
        code_paths: ['packages/@lumenflow/core/**/*.ts'],
      }));

      const result = await getActiveScope({
        getWUContext: mockGetWUContext,
        loadWUYaml: mockLoadWUYaml,
      });

      expect(result).toEqual({
        wuId: 'WU-1101',
        code_paths: ['packages/@lumenflow/core/**/*.ts'],
      });
    });
  });

  describe('isPathInScope', () => {
    it('should return true for exact path match', () => {
      const scope: IWUScope = {
        wuId: 'WU-1101',
        code_paths: ['src/file.ts', 'src/other.ts'],
      };

      expect(isPathInScope('src/file.ts', scope)).toBe(true);
      expect(isPathInScope('src/other.ts', scope)).toBe(true);
    });

    it('should return false for path not in scope', () => {
      const scope: IWUScope = {
        wuId: 'WU-1101',
        code_paths: ['src/file.ts'],
      };

      expect(isPathInScope('src/other.ts', scope)).toBe(false);
    });

    it('should handle glob patterns', () => {
      const scope: IWUScope = {
        wuId: 'WU-1101',
        code_paths: ['src/**/*.ts', 'lib/*.js'],
      };

      expect(isPathInScope('src/nested/deep/file.ts', scope)).toBe(true);
      expect(isPathInScope('lib/helper.js', scope)).toBe(true);
      expect(isPathInScope('lib/nested/helper.js', scope)).toBe(false);
    });

    it('should return true for empty code_paths (no restrictions)', () => {
      const scope: IWUScope = {
        wuId: 'WU-1101',
        code_paths: [],
      };

      expect(isPathInScope('any/path/here.ts', scope)).toBe(true);
    });

    it('should return false for null scope', () => {
      expect(isPathInScope('any/path.ts', null)).toBe(false);
    });

    it('should normalize path separators', () => {
      const scope: IWUScope = {
        wuId: 'WU-1101',
        code_paths: ['src/file.ts'],
      };

      expect(isPathInScope('src\\file.ts', scope)).toBe(true);
    });
  });

  describe('assertPathInScope', () => {
    it('should not throw for path in scope', () => {
      const scope: IWUScope = {
        wuId: 'WU-1101',
        code_paths: ['src/**/*.ts'],
      };

      expect(() => assertPathInScope('src/file.ts', scope)).not.toThrow();
    });

    it('should throw for path out of scope', () => {
      const scope: IWUScope = {
        wuId: 'WU-1101',
        code_paths: ['src/**/*.ts'],
      };

      expect(() => assertPathInScope('lib/file.ts', scope, 'file:write')).toThrow(
        /SCOPE VIOLATION/,
      );
    });

    it('should throw for null scope', () => {
      expect(() => assertPathInScope('any/path.ts', null)).toThrow(/No active WU/);
    });

    it('should not throw for empty code_paths', () => {
      const scope: IWUScope = {
        wuId: 'WU-1101',
        code_paths: [],
      };

      expect(() => assertPathInScope('any/path.ts', scope)).not.toThrow();
    });
  });
});
