/**
 * @file tool.constants.ts
 * @description Shared constants for tool abstraction layer (WU-1394)
 *
 * Provides domain enums, error codes, and permission levels for unified
 * tool system. Used by tool registry, audit logging, and provider adapters.
 */

/**
 * Tool domain categories for classification and routing
 */
export const TOOL_DOMAINS = {
  /** Work Unit lifecycle operations (claim, done, block, etc.) */
  WU: 'wu',

  /** Git operations (commit, push, merge, etc.) */
  GIT: 'git',

  /** File system operations (read, write, delete, etc.) */
  FILE: 'file',

  /** Code exploration and search (grep, glob, find, etc.) */
  EXPLORE: 'explore',

  /** Testing operations (run tests, coverage, etc.) */
  TEST: 'test',

  /** Database operations (migrations, queries, etc.) */
  DB: 'db',

  /** Security operations (auth, permissions, audit, etc.) */
  SECURITY: 'security',

  /** Initiative management operations */
  INITIATIVE: 'initiative',

  /** Metrics and reporting operations */
  METRICS: 'metrics',

  /** Orchestration operations (status, suggest, etc.) */
  ORCHESTRATION: 'orchestration',

  /** Documentation operations (linting, validation, etc.) */
  DOCS: 'docs',

  /** General utility operations */
  UTIL: 'util',
} as const;

export type ToolDomain = (typeof TOOL_DOMAINS)[keyof typeof TOOL_DOMAINS];

/**
 * Permission levels for access control
 */
export const PERMISSION_LEVELS = {
  /** Read-only operations (no state changes) */
  READ: 'read',

  /** Write operations (modifies state) */
  WRITE: 'write',

  /** Administrative operations (destructive, requires elevated access) */
  ADMIN: 'admin',
} as const;

export type PermissionLevel = (typeof PERMISSION_LEVELS)[keyof typeof PERMISSION_LEVELS];

/**
 * Tool error codes (extends existing ErrorCodes from error-handler.mjs)
 */
export const TOOL_ERROR_CODES = {
  /** Tool not found in registry */
  TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',

  /** Invalid tool input schema */
  INVALID_INPUT: 'INVALID_INPUT',

  /** Invalid tool output schema */
  INVALID_OUTPUT: 'INVALID_OUTPUT',

  /** Tool execution failed */
  EXECUTION_FAILED: 'EXECUTION_FAILED',

  /** Permission denied for tool operation */
  PERMISSION_DENIED: 'PERMISSION_DENIED',

  /** Tool timeout */
  TIMEOUT: 'TIMEOUT',

  /** Tool not available in current context */
  NOT_AVAILABLE: 'NOT_AVAILABLE',

  /** Schema validation failed */
  SCHEMA_VALIDATION_FAILED: 'SCHEMA_VALIDATION_FAILED',

  /** Missing required argument */
  MISSING_ARGUMENT: 'MISSING_ARGUMENT',

  /** Invalid argument type */
  INVALID_ARGUMENT_TYPE: 'INVALID_ARGUMENT_TYPE',

  /** Tool already registered */
  DUPLICATE_TOOL: 'DUPLICATE_TOOL',

  /** Provider adapter error */
  PROVIDER_ERROR: 'PROVIDER_ERROR',
} as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[keyof typeof TOOL_ERROR_CODES];

/**
 * Tool execution status values
 */
export const TOOL_STATUS = {
  /** Tool execution pending */
  PENDING: 'pending',

  /** Tool currently executing */
  RUNNING: 'running',

  /** Tool execution completed successfully */
  SUCCESS: 'success',

  /** Tool execution failed */
  FAILED: 'failed',

  /** Tool execution timed out */
  TIMEOUT: 'timeout',

  /** Tool execution cancelled */
  CANCELLED: 'cancelled',
} as const;

export type ToolStatus = (typeof TOOL_STATUS)[keyof typeof TOOL_STATUS];

/**
 * Default timeout for tool execution (milliseconds)
 */
export const DEFAULT_TOOL_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Maximum number of retries for transient failures
 */
export const MAX_TOOL_RETRIES = 3;
