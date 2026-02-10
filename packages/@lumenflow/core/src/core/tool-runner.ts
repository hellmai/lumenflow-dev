/**
 * @file tool-runner.ts
 * @description Unified tool execution layer integrating all core components (WU-1398)
 *
 * This module provides a higher-order function pattern for executing tools with:
 * - Input validation via Zod schemas (tool.schemas.ts)
 * - Worktree context detection (worktree-guard.ts)
 * - Scope validation against code_paths (scope-checker.ts)
 * - Audit logging for telemetry (.lumenflow/telemetry/tools.ndjson)
 * - Consistent error handling with agent-friendly messages
 *
 * Usage:
 *   import { runTool, ToolRunner, createToolConfig } from './tool-runner.js';
 *
 *   // Direct invocation
 *   const result = await runTool(toolDefinition, { arg: 'value' });
 *
 *   // Registry-based invocation
 *   const runner = new ToolRunner();
 *   runner.register(myTool);
 *   const result = await runner.run('tool:name', { arg: 'value' });
 *
 * @see tools/lib/core/tool.schemas.ts - Zod schemas for tool I/O
 * @see tools/lib/core/worktree-guard.ts - WU context detection
 * @see tools/lib/core/scope-checker.ts - Code path validation
 */

import {
  TOOL_ERROR_CODES,
  PERMISSION_LEVELS,
  TOOL_STATUS,
  DEFAULT_TOOL_TIMEOUT_MS,
} from './tool.constants.js';

import { validateToolInput, createErrorOutput } from './tool.schemas.js';

import { getWUContext, assertWorktreeRequired } from './worktree-guard.js';
import { getActiveScope, isPathInScope } from './scope-checker.js';

// Type definitions
interface ToolMetadata {
  name: string;
  description: string;
  domain?: string;
  permission: string;
  version?: string;
}

interface ToolDefinition {
  metadata: ToolMetadata;
  inputSchema?: unknown;
  outputSchema?: unknown;
  execute: (input: unknown, context?: unknown) => Promise<unknown>;
}

interface ToolConfigOptions {
  requiresWorktree?: boolean;
  requiresScope?: boolean;
  enableAuditLog?: boolean;
  timeoutMs?: number;
}

interface ToolConfig {
  requiresWorktree: boolean;
  requiresScope: boolean;
  enableAuditLog: boolean;
  timeoutMs: number;
}

interface RunToolOptions {
  dependencies?: Record<string, unknown>;
  config?: ToolConfigOptions;
  context?: unknown;
}

interface ToolRunnerOptions {
  enableAuditLog?: boolean;
  timeoutMs?: number;
  dependencies?: Record<string, unknown>;
}

interface ListToolsOptions {
  domain?: string;
}

/**
 * Default configuration values for tool runner
 */
export const RUNNER_DEFAULTS = {
  /** Default timeout for tool execution in milliseconds */
  TIMEOUT_MS: DEFAULT_TOOL_TIMEOUT_MS,

  /** Enable audit logging by default */
  ENABLE_AUDIT_LOG: true,

  /** Default: read tools don't require worktree */
  REQUIRES_WORKTREE: false,

  /** Default: read tools don't require scope check */
  REQUIRES_SCOPE: false,
};

/**
 * Create tool configuration with sensible defaults
 *
 * @param {object} tool - Tool definition
 * @param {object} options - Configuration overrides
 * @returns {object} Merged configuration
 */
export function createToolConfig(
  tool: ToolDefinition,
  options: ToolConfigOptions = {},
): ToolConfig {
  const isWriteOperation =
    tool.metadata.permission === PERMISSION_LEVELS.WRITE ||
    tool.metadata.permission === PERMISSION_LEVELS.ADMIN;

  return {
    requiresWorktree: options.requiresWorktree ?? isWriteOperation,
    requiresScope: options.requiresScope ?? isWriteOperation,
    enableAuditLog: options.enableAuditLog ?? RUNNER_DEFAULTS.ENABLE_AUDIT_LOG,
    timeoutMs: options.timeoutMs ?? RUNNER_DEFAULTS.TIMEOUT_MS,
  };
}

/**
 * Extract file path from tool input if present
 *
 * @param {object} input - Tool input
 * @returns {string|null} File path or null
 */
function extractFilePath(input: Record<string, unknown>): string | null {
  // Common field names for file paths
  const pathFields = ['path', 'filePath', 'file', 'targetPath'];

  for (const field of pathFields) {
    if (typeof input[field] === 'string') {
      return input[field];
    }
  }

  return null;
}

/**
 * Create default dependencies using real implementations
 *
 * @returns {object} Default dependency implementations
 */
function createDefaultDependencies(): Record<string, unknown> {
  return {
    getWUContext,
    getActiveScope,
    isPathInScope,
    assertWorktreeRequired,
    logAudit: createAuditLogger(),
  };
}

/**
 * Create audit logger function
 *
 * @returns {Function} Audit logging function
 */
function createAuditLogger(): (entry: unknown) => void {
  return (entry: unknown) => {
    // Write to NDJSON telemetry file
    // Implementation deferred - currently no-op for testing
    // Will integrate with .lumenflow/telemetry/tools.ndjson in future WU
    void entry;
  };
}

/**
 * Generate helpful suggestions for validation errors
 *
 * @param {object} tool - Tool definition
 * @param {object} zodError - Zod validation error
 * @returns {string[]} Array of suggestions
 */
function generateValidationHints(
  tool: ToolDefinition,
  zodError: { issues: Array<{ path: string[]; message: string }> },
): string[] {
  const hints: string[] = [];

  // Add field-specific hints
  for (const issue of zodError.issues) {
    const path = issue.path.join('.');
    hints.push(`Field '${path}': ${issue.message}`);
  }

  // Add general help hint
  hints.push(`Run with --help to see valid arguments for ${tool.metadata.name}`);

  return hints;
}

/**
 * Run a tool with full validation and guards
 *
 * @param {object} tool - Tool definition (metadata, inputSchema, execute)
 * @param {object} input - Tool input arguments
 * @param {object} options - Execution options
 * @param {object} options.dependencies - Injected dependencies (for testing)
 * @param {object} options.config - Configuration overrides
 * @param {object} options.context - Execution context (sessionId, etc.)
 * @returns {Promise<object>} Tool output (success/failure with data/error)
 */
export async function runTool(
  tool: ToolDefinition,
  input: unknown,
  options: RunToolOptions = {},
): Promise<unknown> {
  const startTime = Date.now();
  const startedAt = new Date().toISOString();

  // Merge dependencies with defaults
  const deps = {
    ...createDefaultDependencies(),
    ...options.dependencies,
  };

  // Create configuration
  const config = createToolConfig(tool, options.config);

  // Get WU context for audit logging
  let wuContext: { wuId: string; lane: string; worktreePath: string } | null = null;
  try {
    wuContext = await (
      deps.getWUContext as () => Promise<{ wuId: string; lane: string; worktreePath: string }>
    )();
  } catch {
    // Context retrieval failure is non-fatal
    wuContext = null;
  }

  // Build execution metadata
  const metadata = {
    startedAt,
    durationMs: 0,
  };

  // Helper to create audit log entry
  const createAuditEntry = (status: string, output: unknown, error: unknown) => ({
    tool: tool.metadata.name,
    status,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    input,
    output,
    error,
    context: wuContext
      ? {
          wuId: wuContext.wuId,
          lane: wuContext.lane,
          worktreePath: wuContext.worktreePath,
        }
      : {},
  });

  try {
    // Step 1: Validate input schema
    const validation = validateToolInput(input, tool.inputSchema as import('zod').ZodType);

    if (!validation.success) {
      const validationError = validation as {
        success: false;
        error: { issues: Array<{ path: string[]; message: string }> };
      };
      const errorOutput = createErrorOutput(
        {
          code: TOOL_ERROR_CODES.SCHEMA_VALIDATION_FAILED,
          message: `Input validation failed for ${tool.metadata.name}`,
          details: { issues: validationError.error.issues },
          tryNext: generateValidationHints(tool, validationError.error),
        },
        metadata,
      );

      if (config.enableAuditLog) {
        (deps.logAudit as (entry: unknown) => void)(
          createAuditEntry(
            TOOL_STATUS.FAILED,
            null,
            (errorOutput as Record<string, unknown>).error,
          ),
        );
      }

      return errorOutput;
    }

    // Narrow validation to success case
    const validatedInput = validation as { success: true; data: Record<string, unknown> };

    // Step 2: Check worktree requirement
    if (config.requiresWorktree) {
      try {
        await (deps.assertWorktreeRequired as (opts: { operation: string }) => Promise<void>)({
          operation: tool.metadata.name,
        });
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        const errorOutput = createErrorOutput(
          {
            code: TOOL_ERROR_CODES.PERMISSION_DENIED,
            message: errMessage,
            tryNext: [
              'Claim a WU first: pnpm wu:claim --id WU-XXX --lane "Your Lane"',
              'Then change to the worktree directory',
            ],
          },
          metadata,
        );

        if (config.enableAuditLog) {
          (deps.logAudit as (entry: unknown) => void)(
            createAuditEntry(
              TOOL_STATUS.FAILED,
              null,
              (errorOutput as Record<string, unknown>).error,
            ),
          );
        }

        return errorOutput;
      }
    }

    // Step 3: Check scope for write operations with file paths
    if (config.requiresScope) {
      const filePath = extractFilePath(validatedInput.data);

      if (filePath) {
        const scope = await (
          deps.getActiveScope as () => Promise<{ wuId: string; code_paths: string[] } | null>
        )();

        // If we have a scope, validate the path
        if (
          scope &&
          !(deps.isPathInScope as (path: string, scope: unknown) => boolean)(filePath, scope)
        ) {
          const errorOutput = createErrorOutput(
            {
              code: TOOL_ERROR_CODES.PERMISSION_DENIED,
              message: `Path '${filePath}' is outside WU scope for ${scope.wuId}`,
              details: {
                path: filePath,
                allowedPaths: scope.code_paths,
              },
              tryNext: [
                `Only modify files matching: ${scope.code_paths.join(', ')}`,
                'Update WU code_paths if this file should be in scope',
              ],
            },
            metadata,
          );

          if (config.enableAuditLog) {
            (deps.logAudit as (entry: unknown) => void)(
              createAuditEntry(
                TOOL_STATUS.FAILED,
                null,
                (errorOutput as Record<string, unknown>).error,
              ),
            );
          }

          return errorOutput;
        }
      }
    }

    // Step 4: Execute the tool
    const result = (await tool.execute(validatedInput.data, options.context)) as Record<
      string,
      unknown
    >;

    // Step 5: Validate output if schema defined
    if (tool.outputSchema && result.success && result.data) {
      const outputValidation = validateToolInput(
        result.data,
        tool.outputSchema as import('zod').ZodType,
      );

      if (!outputValidation.success) {
        const outputValidationError = outputValidation as {
          success: false;
          error: { issues: Array<{ path: string[]; message: string }> };
        };
        const errorOutput = createErrorOutput(
          {
            code: TOOL_ERROR_CODES.INVALID_OUTPUT,
            message: `Tool ${tool.metadata.name} produced invalid output`,
            details: { issues: outputValidationError.error.issues },
          },
          { ...metadata, durationMs: Date.now() - startTime },
        );

        if (config.enableAuditLog) {
          (deps.logAudit as (entry: unknown) => void)(
            createAuditEntry(
              TOOL_STATUS.FAILED,
              null,
              (errorOutput as Record<string, unknown>).error,
            ),
          );
        }

        return errorOutput;
      }
    }

    // Add metadata to result
    const resultMetadata = (result.metadata as Record<string, unknown>) || {};
    const finalResult = {
      ...result,
      metadata: {
        ...resultMetadata,
        ...metadata,
        durationMs: Date.now() - startTime,
      },
    };

    // Log successful execution
    if (config.enableAuditLog) {
      (deps.logAudit as (entry: unknown) => void)(
        createAuditEntry(TOOL_STATUS.SUCCESS, finalResult, null),
      );
    }

    return finalResult;
  } catch (err) {
    // Handle unexpected execution errors
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;

    const errorOutput = createErrorOutput(
      {
        code: TOOL_ERROR_CODES.EXECUTION_FAILED,
        message: errorMessage,
        stack: errorStack,
        tryNext: ['Check tool input and try again', 'Report issue if problem persists'],
      },
      { ...metadata, durationMs: Date.now() - startTime },
    );

    if (config.enableAuditLog) {
      (deps.logAudit as (entry: unknown) => void)(
        createAuditEntry(TOOL_STATUS.FAILED, null, (errorOutput as Record<string, unknown>).error),
      );
    }

    return errorOutput;
  }
}

/**
 * Tool registry and runner class
 *
 * Provides a registry for tool definitions and a unified execution interface.
 */
export class ToolRunner {
  #tools: Map<string, ToolDefinition> = new Map();
  #config: { enableAuditLog: boolean; timeoutMs: number };
  #dependencies: Record<string, unknown>;

  /**
   * Create a new ToolRunner instance
   *
   * @param {object} options - Runner options
   * @param {boolean} options.enableAuditLog - Enable audit logging
   * @param {number} options.timeoutMs - Default timeout
   * @param {object} options.dependencies - Injected dependencies
   */
  constructor(options: ToolRunnerOptions = {}) {
    this.#config = {
      enableAuditLog: options.enableAuditLog ?? RUNNER_DEFAULTS.ENABLE_AUDIT_LOG,
      timeoutMs: options.timeoutMs ?? RUNNER_DEFAULTS.TIMEOUT_MS,
    };
    this.#dependencies = options.dependencies || createDefaultDependencies();
  }

  /**
   * Register a tool definition
   *
   * @param {object} tool - Tool definition
   * @throws {Error} If tool with same name already registered
   */
  register(tool: ToolDefinition): void {
    const name = tool.metadata.name;

    if (this.#tools.has(name)) {
      throw new Error(`Tool '${name}' is already registered`);
    }

    this.#tools.set(name, tool);
  }

  /**
   * Check if a tool is registered
   *
   * @param {string} name - Tool name
   * @returns {boolean} True if tool exists
   */
  hasTool(name: string): boolean {
    return this.#tools.has(name);
  }

  /**
   * Run a registered tool by name
   *
   * @param {string} name - Tool name
   * @param {object} input - Tool input
   * @param {object} options - Execution options
   * @returns {Promise<object>} Tool output
   */
  async run(name: string, input: unknown, options: RunToolOptions = {}): Promise<unknown> {
    const tool = this.#tools.get(name);

    if (!tool) {
      return createErrorOutput({
        code: TOOL_ERROR_CODES.TOOL_NOT_FOUND,
        message: `Tool '${name}' not found in registry`,
        tryNext: ['Check tool name spelling', 'Use runner.listTools() to see available tools'],
      });
    }

    return runTool(tool, input, {
      ...options,
      dependencies: this.#dependencies,
      config: { ...this.#config, ...options.config },
    });
  }

  /**
   * Get runner configuration
   *
   * @returns {object} Current configuration
   */
  getConfig(): { enableAuditLog: boolean; timeoutMs: number } {
    return { ...this.#config };
  }

  /**
   * List all registered tools
   *
   * @param {object} options - Filter options
   * @param {string} options.domain - Filter by domain
   * @returns {object[]} Array of tool metadata
   */
  listTools(options: ListToolsOptions = {}): Array<{
    name: string;
    description: string;
    domain?: string;
    permission: string;
    version?: string;
  }> {
    const tools: Array<{
      name: string;
      description: string;
      domain?: string;
      permission: string;
      version?: string;
    }> = [];

    for (const tool of this.#tools.values()) {
      if (options.domain && tool.metadata.domain !== options.domain) {
        continue;
      }

      tools.push({
        name: tool.metadata.name,
        description: tool.metadata.description,
        domain: tool.metadata.domain,
        permission: tool.metadata.permission,
        version: tool.metadata.version,
      });
    }

    return tools;
  }
}
