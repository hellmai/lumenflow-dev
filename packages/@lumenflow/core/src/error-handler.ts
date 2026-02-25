// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file error-handler.ts
 * @description Structured error handling with error codes
 * WU-1082: Extract shared utilities (eliminate die() duplication)
 * WU-1006: Library-First - use path.basename() instead of manual split
 *
 * Replaces die() function in:
 * - tools/wu-claim.ts
 * - tools/wu-done.ts
 * - tools/wu-block.ts
 * - tools/wu-unblock.ts
 * - tools/wu-create.ts
 * - tools/wu-cleanup.ts
 * - tools/gates-pre-commit.ts
 * - tools/validate.ts
 * - tools/guard-worktree-commit.ts
 */

import path from 'node:path';

const UNKNOWN_ERROR_MESSAGE = 'Unknown error';

interface MessageLikeError {
  message: string;
}

function hasMessage(value: unknown): value is MessageLikeError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof (value as MessageLikeError).message === 'string'
  );
}

/**
 * Typed error for process exit signals from library code.
 * WU-1538: Core modules throw this instead of calling process.exit directly.
 * CLI entry boundaries catch this and call process.exit with the exitCode.
 *
 * @class ProcessExitError
 * @extends Error
 */
export class ProcessExitError extends Error {
  /** Process exit code to use when caught at CLI boundary */
  exitCode: number;

  /**
   * Create a process exit error
   * @param {string} message - Error message (already formatted by die() or caller)
   * @param {number} [exitCode=1] - Process exit code
   */
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'ProcessExitError';
    this.exitCode = exitCode;

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ProcessExitError);
    }
  }
}

/**
 * Structured error class with error codes and details
 * @class WUError
 * @extends Error
 */
export class WUError extends Error {
  /** Error code (e.g., 'WU_NOT_FOUND') */
  code: string;
  /** Additional error context */
  details: Record<string, unknown>;
  /** Suggested commands or actions to try (optional) */
  tryNext?: string[];
  /** Alias for details for agent-friendly access */
  context?: Record<string, unknown>;

  /**
   * Create a WU error
   * @param {string} code - Error code (e.g., 'WU_NOT_FOUND')
   * @param {string} message - Human-readable error message
   * @param {object} [details={}] - Additional error context
   */
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'WUError';
    this.code = code;
    this.details = details;

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WUError);
    }
  }
}

/**
 * Normalize unknown thrown values into Error instances.
 *
 * This is the strict-mode-safe boundary helper for `catch (err: unknown)`.
 * Consumers should call this before accessing `.message`.
 *
 * @param {unknown} error - Unknown thrown value
 * @param {string} [fallbackMessage='Unknown error'] - Message used when value has no message
 * @returns {Error} Normalized Error instance
 */
export function toError(error: unknown, fallbackMessage = UNKNOWN_ERROR_MESSAGE): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === 'string' && error.length > 0) {
    return new Error(error);
  }

  if (hasMessage(error)) {
    return new Error(error.message);
  }

  return new Error(fallbackMessage);
}

/**
 * Strict-safe helper for extracting error messages from unknown values.
 *
 * @param {unknown} error - Unknown thrown value
 * @param {string} [fallbackMessage='Unknown error'] - Message used when value has no message
 * @returns {string} Resolved error message
 */
export function getErrorMessage(error: unknown, fallbackMessage = UNKNOWN_ERROR_MESSAGE): string {
  return toError(error, fallbackMessage).message;
}

/**
 * Throw typed error with formatted message (replaces process.exit calls)
 * Auto-detects script name from process.argv[1] - no string literals needed!
 *
 * WU-1538: Now throws ProcessExitError instead of calling process.exit directly.
 * The CLI entry boundary (runCLI) catches ProcessExitError and maps to process.exit.
 *
 * @param {string} message - Error message to log
 * @param {number} [exitCode=1] - Process exit code
 * @throws {ProcessExitError} Always throws with the formatted message and exit code
 * @example
 * die('WU file not found');
 * die('Gates failed', 2);
 */
export function die(message: string, exitCode = 1): never {
  // Auto-detect script name from process.argv[1] (eliminates string literal duplication)
  // WU-1006: Use path.basename() instead of manual split (Library-First principle)
  const scriptPath = process.argv[1] || 'unknown';
  const scriptName = path.basename(scriptPath, '.js');
  const formattedMessage = `[${scriptName}] ${message}`;
  console.error(formattedMessage);
  throw new ProcessExitError(formattedMessage, exitCode);
}

/**
 * Create a WUError instance (factory function)
 * @param {string} code - Error code
 * @param {string} message - Error message
 * @param {object} [details={}] - Error details
 * @returns {WUError} Structured error instance
 * @example
 * throw createError('WU_NOT_FOUND', 'WU-123 not found', { id: 'WU-123' });
 */
export function createError(code: string, message: string, details: Record<string, unknown> = {}) {
  return new WUError(code, message, details);
}

/**
 * Options for creating agent-friendly errors
 */
export interface AgentFriendlyErrorOptions {
  /** Array of suggested commands or actions to try */
  tryNext?: string[];
  /** Additional context information */
  context?: Record<string, unknown>;
}

/**
 * Create an agent-friendly error with try-next command suggestions
 * WU-1339: Agent-friendly error messages and hints (AX3)
 *
 * @param {string} code - Error code from ErrorCodes
 * @param {string} message - Human-readable error message
 * @param {AgentFriendlyErrorOptions} options - Options object
 * @returns {WUError} Error instance with tryNext property and context
 * @example
 * throw createAgentFriendlyError(
 *   ErrorCodes.WU_NOT_FOUND,
 *   'WU-1234 not found',
 *   {
 *     tryNext: ['pnpm wu:create --id WU-1234 --lane "<lane>" --title "..."'],
 *     context: { wuId: 'WU-1234' }
 *   }
 * );
 */
export function createAgentFriendlyError(
  code: string,
  message: string,
  options: AgentFriendlyErrorOptions = {},
) {
  const { tryNext, context = {} } = options;
  const error = createError(code, message, context);

  // Add tryNext suggestions if provided
  if (tryNext && Array.isArray(tryNext) && tryNext.length > 0) {
    error.tryNext = tryNext;
  }

  // Expose details as context for agent-friendly access
  // (WUError stores context in details property, but we expose it as context for clarity)
  error.context = error.details;

  return error;
}

/**
 * Common error codes for WU operations
 */
export const ErrorCodes = {
  PROCESS_EXIT: 'PROCESS_EXIT', // WU-1538: Typed exit signal from library code
  WU_NOT_FOUND: 'WU_NOT_FOUND',
  WU_ALREADY_CLAIMED: 'WU_ALREADY_CLAIMED',
  WU_NOT_CLAIMED: 'WU_NOT_CLAIMED',
  INVALID_WU_ID: 'INVALID_WU_ID',
  INVALID_LANE: 'INVALID_LANE',
  GATES_FAILED: 'GATES_FAILED',
  GIT_ERROR: 'GIT_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  YAML_PARSE_ERROR: 'YAML_PARSE_ERROR',
  PARSE_ERROR: 'PARSE_ERROR',
  WORKTREE_ERROR: 'WORKTREE_ERROR',
  BRANCH_ERROR: 'BRANCH_ERROR',
  STATE_ERROR: 'STATE_ERROR',
  SECTION_NOT_FOUND: 'SECTION_NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RECOVERY_ERROR: 'RECOVERY_ERROR',
  TRANSACTION_ERROR: 'TRANSACTION_ERROR', // WU-1369: Atomic transaction errors
  LOCK_ERROR: 'LOCK_ERROR', // WU-1747: Merge lock errors

  // Initiative system error codes (WU-1247)
  INIT_NOT_FOUND: 'INIT_NOT_FOUND',
  INIT_ALREADY_EXISTS: 'INIT_ALREADY_EXISTS',
  INVALID_INIT_ID: 'INVALID_INIT_ID',
  INVALID_SLUG: 'INVALID_SLUG',
  INVALID_PHASE: 'INVALID_PHASE',
  DEPENDENCY_CYCLE: 'DEPENDENCY_CYCLE',

  // WU-2116: Structured error codes for migrated throw new Error() sites
  MERGE_EXHAUSTION: 'MERGE_EXHAUSTION',
  REBASE_CONFLICT: 'REBASE_CONFLICT',
  DELEGATION_NOT_FOUND: 'DELEGATION_NOT_FOUND',
  DELEGATION_ALREADY_ESCALATED: 'DELEGATION_ALREADY_ESCALATED',
  SIGNAL_UNAVAILABLE: 'SIGNAL_UNAVAILABLE',
  ID_GENERATION_FAILED: 'ID_GENERATION_FAILED',
  SCOPE_VIOLATION: 'SCOPE_VIOLATION',
  TOOL_ALREADY_REGISTERED: 'TOOL_ALREADY_REGISTERED',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  DEPRECATED_API: 'DEPRECATED_API',
  CONFIG_ERROR: 'CONFIG_ERROR',
  TEMPLATE_VALIDATION_ERROR: 'TEMPLATE_VALIDATION_ERROR',
  INVARIANT_ERROR: 'INVARIANT_ERROR',
  RETRY_EXHAUSTION: 'RETRY_EXHAUSTION',
  PREFLIGHT_ERROR: 'PREFLIGHT_ERROR',
  INVALID_DURATION: 'INVALID_DURATION',

  // WU-2118: Structured error codes for memory/agent/mcp package migrations
  NODE_NOT_FOUND: 'NODE_NOT_FOUND',
  SESSION_ERROR: 'SESSION_ERROR',
  ALREADY_EXISTS: 'ALREADY_EXISTS',

  // WU-2117: Structured error codes for CLI throw new Error() migration
  COMMAND_EXECUTION_FAILED: 'COMMAND_EXECUTION_FAILED',
  PACK_ALREADY_EXISTS: 'PACK_ALREADY_EXISTS',
  CANCELLED_BY_USER: 'CANCELLED_BY_USER',
  REGISTRY_UPLOAD_FAILED: 'REGISTRY_UPLOAD_FAILED',
  WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',
  WORKSPACE_MALFORMED: 'WORKSPACE_MALFORMED',
  ORPHAN_WU_ERROR: 'ORPHAN_WU_ERROR',
  REPAIR_FAILED: 'REPAIR_FAILED',
  ONBOARD_FAILED: 'ONBOARD_FAILED',
  DIRECTORY_NOT_EMPTY: 'DIRECTORY_NOT_EMPTY',
  AMBIGUOUS_MATCH: 'AMBIGUOUS_MATCH',
  STRING_NOT_FOUND: 'STRING_NOT_FOUND',
  FILE_SIZE_EXCEEDED: 'FILE_SIZE_EXCEEDED',
  PARENT_DIR_NOT_FOUND: 'PARENT_DIR_NOT_FOUND',
};
