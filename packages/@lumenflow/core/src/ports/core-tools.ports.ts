/**
 * Core Tools Ports
 *
 * WU-1101: INIT-003 Phase 2a - Migrate tools/lib/core/ to @lumenflow/core
 *
 * Port interfaces for core tool modules migrated from ExampleApp tools/lib/core/.
 * These abstractions allow external users to inject custom implementations.
 *
 * Hexagonal Architecture - Input Ports:
 * - IToolRunner: Execute tools with validation and guards
 * - IWorktreeGuard: Detect and enforce worktree context
 * - IScopeChecker: Validate file paths against WU code_paths
 *
 * Current Implementations:
 * - runTool, ToolRunner (tool-runner.ts)
 * - getWUContext, assertWorktreeRequired, isInWorktree, isMainBranch (worktree-guard.ts)
 * - getActiveScope, isPathInScope, assertPathInScope (scope-checker.ts)
 *
 * @module ports/core-tools
 */

import type { ZodType } from 'zod';
import type { ToolOutput, ToolError } from '../core/tool.schemas.js';
import type { PermissionLevel, ToolDomain } from '../core/tool.constants.js';

/**
 * Tool metadata interface
 */
export interface IToolMetadata {
  /** Tool name (unique identifier) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Tool domain classification */
  domain?: ToolDomain;
  /** Required permission level */
  permission: PermissionLevel;
  /** Tool version */
  version?: string;
}

/**
 * Tool definition interface
 */
export interface IToolDefinition {
  /** Tool metadata */
  metadata: IToolMetadata;
  /** Zod schema for input validation */
  inputSchema?: ZodType;
  /** Zod schema for output validation */
  outputSchema?: ZodType;
  /** Tool execution function */
  execute: (input: unknown, context?: unknown) => Promise<ToolOutput>;
}

/**
 * Tool configuration options
 */
export interface IToolConfigOptions {
  /** Require worktree context for execution */
  requiresWorktree?: boolean;
  /** Require scope validation for file paths */
  requiresScope?: boolean;
  /** Enable audit logging */
  enableAuditLog?: boolean;
  /** Execution timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Tool execution options
 */
export interface IRunToolOptions {
  /** Injected dependencies (for testing) */
  dependencies?: Record<string, unknown>;
  /** Configuration overrides */
  config?: IToolConfigOptions;
  /** Execution context (sessionId, userId, etc.) */
  context?: Record<string, unknown>;
}

/**
 * Tool Executor Port Interface (Slim)
 *
 * WU-1549: Segregated from IToolRunner following Interface Segregation Principle.
 * Gate consumers and simple tool execution only need runTool and run methods,
 * not the full registry (register, hasTool, listTools).
 *
 * @example
 * // Direct tool execution
 * const result = await executor.runTool(toolDefinition, { message: 'hello' });
 *
 * @example
 * // Named tool execution
 * const result = await executor.run('tool:name', { arg: 'value' });
 */
export interface IToolExecutor {
  /**
   * Execute a tool with full validation and guards.
   *
   * @param tool - Tool definition
   * @param input - Tool input arguments
   * @param options - Execution options
   * @returns Tool output (success/failure with data/error)
   */
  runTool(tool: IToolDefinition, input: unknown, options?: IRunToolOptions): Promise<ToolOutput>;

  /**
   * Run a registered tool by name.
   *
   * @param name - Tool name
   * @param input - Tool input
   * @param options - Execution options
   * @returns Tool output
   */
  run(name: string, input: unknown, options?: IRunToolOptions): Promise<ToolOutput>;
}

/**
 * Tool Runner Port Interface (Full)
 *
 * Extends IToolExecutor with tool registry management (register, hasTool, listTools).
 * Use IToolExecutor for consumers that only need execution.
 * Use IToolRunner for consumers that also manage the tool registry.
 *
 * @example
 * // Full registry usage
 * runner.register(myTool);
 * const result = await runner.run('tool:name', { arg: 'value' });
 * const tools = runner.listTools({ domain: 'file' });
 */
export interface IToolRunner extends IToolExecutor {
  /**
   * Register a tool definition.
   *
   * @param tool - Tool definition
   * @throws Error if tool with same name already registered
   */
  register(tool: IToolDefinition): void;

  /**
   * Check if a tool is registered.
   *
   * @param name - Tool name
   * @returns True if tool exists
   */
  hasTool(name: string): boolean;

  /**
   * List all registered tools.
   *
   * @param options - Filter options
   * @returns Array of tool metadata
   */
  listTools(options?: { domain?: string }): IToolMetadata[];
}

/**
 * WU context from worktree detection
 */
export interface IWUContext {
  /** WU identifier (e.g., 'WU-1101') */
  wuId: string;
  /** Lane name in kebab-case (e.g., 'framework-core') */
  lane: string;
  /** Worktree path relative to repo root, or null if on lane branch */
  worktreePath: string | null;
}

/**
 * Worktree detection options
 */
export interface IWorktreeOptions {
  /** Current working directory (defaults to process.cwd()) */
  cwd?: string;
  /** Git adapter instance (for testing) */
  git?: {
    getCurrentBranch(): Promise<string>;
  };
  /** Operation name for error messages */
  operation?: string;
}

/**
 * Worktree Guard Port Interface
 *
 * Provides runtime guards to enforce worktree discipline:
 * - Detect if current directory is inside a worktree
 * - Extract WU ID and lane from worktree path or git branch
 * - Block write operations when not in worktree
 *
 * @example
 * // Check worktree context
 * const context = await guard.getWUContext();
 * if (context) {
 *   console.log(`Working on ${context.wuId} in ${context.lane}`);
 * }
 *
 * @example
 * // Assert worktree for write operation
 * await guard.assertWorktreeRequired({ operation: 'file:write' });
 */
export interface IWorktreeGuard {
  /**
   * Check if current directory is inside a worktree.
   *
   * @param options - Detection options
   * @returns True if inside a worktree directory
   */
  isInWorktree(options?: IWorktreeOptions): boolean;

  /**
   * Check if on main or master branch.
   *
   * @param options - Detection options
   * @returns True if on main/master branch
   */
  isMainBranch(options?: IWorktreeOptions): Promise<boolean>;

  /**
   * Get WU context from worktree path or git branch.
   *
   * @param options - Detection options
   * @returns WU context or null if not in WU workspace
   */
  getWUContext(options?: IWorktreeOptions): Promise<IWUContext | null>;

  /**
   * Assert that current context is inside a worktree or on a lane branch.
   * Throws if on main branch in main checkout.
   *
   * @param options - Detection options
   * @throws Error if not in worktree and on main branch
   */
  assertWorktreeRequired(options?: IWorktreeOptions): Promise<void>;
}

/**
 * WU scope with code paths
 */
export interface IWUScope {
  /** WU identifier */
  wuId: string;
  /** Allowed file paths/glob patterns */
  code_paths: string[];
}

/**
 * Scope Checker Port Interface
 *
 * Provides runtime validation that file modifications stay within WU code_paths.
 * Prevents scope creep and ensures agents only modify authorized files.
 *
 * @example
 * // Check if path is in scope
 * const scope = await checker.getActiveScope();
 * if (checker.isPathInScope('src/file.ts', scope)) {
 *   // Safe to modify
 * }
 *
 * @example
 * // Assert path is in scope (throws if not)
 * await checker.assertPathInScope('src/file.ts', scope, 'file:write');
 */
export interface IScopeChecker {
  /**
   * Get active WU scope (WU ID + code_paths).
   *
   * @param options - Options for dependency injection
   * @returns Scope object or null if not in WU workspace
   */
  getActiveScope(options?: {
    getWUContext?: () => Promise<IWUContext | null>;
    loadWUYaml?: (wuId: string) => { code_paths?: string[] };
  }): Promise<IWUScope | null>;

  /**
   * Check if a file path is within WU scope.
   *
   * @param filePath - File path to check
   * @param scope - Scope object from getActiveScope()
   * @returns True if path is in scope
   */
  isPathInScope(filePath: string, scope: IWUScope | null): boolean;

  /**
   * Assert that a file path is within WU scope.
   * Throws if path is outside scope or no scope available.
   *
   * @param filePath - File path to check
   * @param scope - Scope object from getActiveScope()
   * @param operation - Operation name for error message
   * @throws Error if path is outside scope
   */
  assertPathInScope(filePath: string, scope: IWUScope | null, operation?: string): void;
}

// Re-export types from implementations for convenience
export type { ToolOutput, ToolError };
