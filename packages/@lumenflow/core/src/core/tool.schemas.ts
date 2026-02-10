/**
 * @file tool.schemas.ts
 * @description Zod schemas for tool abstraction layer (WU-1394)
 *
 * Provides runtime validation and TypeScript type inference for tool inputs,
 * outputs, and metadata. Supports JSON Schema export for provider adapters
 * (MCP, OpenAI, Gemini).
 *
 * Reference: tools/lib/arg-parser.ts for current argument handling patterns
 */

import { z, type ZodTypeAny } from 'zod';
import { TOOL_DOMAINS, PERMISSION_LEVELS, TOOL_STATUS } from './tool.constants.js';

/**
 * Schema for tool input
 *
 * Represents the standardized input format for all tools in the system.
 * Maps command names to their arguments and optional context.
 */
export const ToolInputSchema = z.object({
  /** Tool command name (e.g., 'wu:claim', 'git:commit') */
  command: z.string().min(1).describe('Tool command name'),

  /** Tool-specific arguments (validated by tool's inputSchema) */
  arguments: z.record(z.string(), z.unknown()).default({}),

  /** Optional execution context (session ID, user, etc.) */
  context: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Execution context (session_id, user, etc.)'),
});

export type ToolInput = z.infer<typeof ToolInputSchema>;

/**
 * Schema for tool error details
 */
export const ToolErrorSchema = z.object({
  /** Error code from TOOL_ERROR_CODES or ErrorCodes */
  code: z.string(),

  /** Human-readable error message */
  message: z.string(),

  /** Optional additional error details */
  details: z.record(z.string(), z.unknown()).optional(),

  /** Optional stack trace (for debugging) */
  stack: z.string().optional(),

  /** Optional suggestions for resolution (WU-1339: Agent-friendly errors) */
  tryNext: z.array(z.string()).optional().describe('Suggested next actions'),
});

export type ToolError = z.infer<typeof ToolErrorSchema>;

/**
 * Schema for tool output
 *
 * Standardized response format for all tools. Success/failure indicated by
 * the `success` field, with data/error fields providing details.
 */
export const ToolOutputSchema = z.object({
  /** Operation success status */
  success: z.boolean(),

  /** Output data (present when success=true) */
  data: z.unknown().optional(),

  /** Error details (present when success=false) */
  error: ToolErrorSchema.optional(),

  /** Optional warning messages */
  warnings: z.array(z.string()).optional(),

  /** Optional execution metadata (duration, timestamp, etc.) */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ToolOutput = z.infer<typeof ToolOutputSchema>;

/**
 * Schema for tool metadata
 *
 * Describes a tool's capabilities, domain, permissions, and usage examples.
 */
export const ToolMetadataSchema = z.object({
  /** Tool name (unique identifier) */
  name: z.string().min(1),

  /** Human-readable description */
  description: z.string().min(1),

  /** Tool domain classification */
  domain: z.enum([
    TOOL_DOMAINS.WU,
    TOOL_DOMAINS.GIT,
    TOOL_DOMAINS.FILE,
    TOOL_DOMAINS.EXPLORE,
    TOOL_DOMAINS.TEST,
    TOOL_DOMAINS.DB,
    TOOL_DOMAINS.SECURITY,
    TOOL_DOMAINS.INITIATIVE,
    TOOL_DOMAINS.METRICS,
    TOOL_DOMAINS.ORCHESTRATION,
    TOOL_DOMAINS.DOCS,
    TOOL_DOMAINS.UTIL,
  ] as const),

  /** Required permission level */
  permission: z.enum([
    PERMISSION_LEVELS.READ,
    PERMISSION_LEVELS.WRITE,
    PERMISSION_LEVELS.ADMIN,
  ] as const),

  /** Tool version (semantic versioning) */
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be semantic version (x.y.z)'),

  /** Optional tags for categorization */
  tags: z.array(z.string()).optional(),

  /** Optional usage examples */
  examples: z
    .array(
      z.object({
        description: z.string(),
        input: z.record(z.string(), z.unknown()),
        output: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),

  /** Optional deprecation notice */
  deprecated: z.boolean().optional(),

  /** Optional replacement tool (if deprecated) */
  replacedBy: z.string().optional(),
});

export type ToolMetadata = z.infer<typeof ToolMetadataSchema>;

/**
 * Schema for tool definition
 *
 * Complete tool specification including metadata, schemas, and execution function.
 */
export const ToolDefinitionSchema = z.object({
  /** Tool metadata */
  metadata: ToolMetadataSchema,

  /** Input schema (Zod schema for argument validation) */
  inputSchema: z.custom<ZodTypeAny>((val) => val instanceof z.ZodType),

  /** Optional output schema (Zod schema for response validation) */
  outputSchema: z.custom<ZodTypeAny>((val) => val instanceof z.ZodType).optional(),

  /** Tool execution function */
  execute: z.custom<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (input: any, context?: Record<string, unknown>) => Promise<ToolOutput>
  >((val) => typeof val === 'function'),
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

/**
 * Schema for tool execution result (audit logging)
 */
export const ToolExecutionResultSchema = z.object({
  /** Tool name */
  tool: z.string(),

  /** Execution status */
  status: z.enum([
    TOOL_STATUS.PENDING,
    TOOL_STATUS.RUNNING,
    TOOL_STATUS.SUCCESS,
    TOOL_STATUS.FAILED,
    TOOL_STATUS.TIMEOUT,
    TOOL_STATUS.CANCELLED,
  ] as const),

  /** Start timestamp */
  startedAt: z.string().datetime(),

  /** End timestamp */
  completedAt: z.string().datetime().optional(),

  /** Execution duration in milliseconds */
  durationMs: z.number().int().nonnegative().optional(),

  /** Tool input (sanitized, no sensitive data) */
  input: z.record(z.string(), z.unknown()),

  /** Tool output (sanitized) */
  output: ToolOutputSchema.optional(),

  /** Error details (if failed) */
  error: ToolErrorSchema.optional(),

  /** Execution context (session, user, etc.) */
  context: z.record(z.string(), z.unknown()).optional(),
});

export type ToolExecutionResult = z.infer<typeof ToolExecutionResultSchema>;

/**
 * Convert Zod schema to JSON Schema for provider adapters
 *
 * Uses Zod 4's native z.toJSONSchema() for robust conversion.
 * Supports MCP, OpenAI Functions, and Gemini Tools formats.
 *
 * @param schema - Zod schema to convert
 * @param options - Conversion options
 * @returns JSON Schema object
 *
 * @example
 * const inputSchema = z.object({ id: z.string() });
 * const jsonSchema = toJSONSchema(inputSchema);
 * // Returns: { type: 'object', properties: { id: { type: 'string' } }, ... }
 */
export function toJSONSchema(
  schema: ZodTypeAny,
  options?: {
    /** Schema name (for $id field) */
    name?: string;
    /** Base URI for schema references */
    baseUri?: string;
  },
): Record<string, unknown> {
  // Use Zod 4's native JSON Schema conversion
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;

  // Add $id if name is provided
  if (options?.name) {
    return {
      ...jsonSchema,
      $id: `${options.baseUri || ''}#/${options.name}`,
    };
  }

  return jsonSchema;
}

/**
 * Validate tool input against schema
 *
 * @param input - Tool input to validate
 * @param schema - Zod schema to validate against
 * @returns Validation result with parsed data or errors
 */
export function validateToolInput<T>(
  input: unknown,
  schema: z.ZodType<T>,
): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(input);

  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return { success: false, error: result.error };
  }
}

/**
 * Create standardized tool output for success case
 *
 * @param data - Output data
 * @param metadata - Optional execution metadata
 * @returns Standardized ToolOutput
 */
export function createSuccessOutput(data: unknown, metadata?: Record<string, unknown>): ToolOutput {
  return {
    success: true,
    data,
    metadata,
  };
}

/**
 * Create standardized tool output for error case
 *
 * @param error - Error details
 * @param metadata - Optional execution metadata
 * @returns Standardized ToolOutput
 */
export function createErrorOutput(
  error: ToolError,
  metadata?: Record<string, unknown>,
): ToolOutput {
  return {
    success: false,
    error,
    metadata,
  };
}
