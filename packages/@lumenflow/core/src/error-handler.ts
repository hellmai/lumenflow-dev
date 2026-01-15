/**
 * @file error-handler.mjs
 * @description Structured error handling with error codes
 * WU-1082: Extract shared utilities (eliminate die() duplication)
 *
 * Replaces die() function in:
 * - tools/wu-claim.mjs
 * - tools/wu-done.mjs
 * - tools/wu-block.mjs
 * - tools/wu-unblock.mjs
 * - tools/wu-create.mjs
 * - tools/wu-cleanup.mjs
 * - tools/gates-pre-commit.mjs
 * - tools/validate.mjs
 * - tools/guard-worktree-commit.mjs
 */

/**
 * Structured error class with error codes and details
 * @class WUError
 * @extends Error
 */
export class WUError extends Error {
  /**
   * Create a WU error
   * @param {string} code - Error code (e.g., 'WU_NOT_FOUND')
   * @param {string} message - Human-readable error message
   * @param {object} [details={}] - Additional error context
   */
  constructor(code, message, details = {}) {
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
 * Exit process with error message (replaces die() function)
 * Auto-detects script name from process.argv[1] - no string literals needed!
 * @param {string} message - Error message to log
 * @param {number} [exitCode=1] - Process exit code
 * @example
 * die('WU file not found');
 * die('Gates failed', 2);
 */
export function die(message, exitCode = 1) {
  // Auto-detect script name from process.argv[1] (eliminates string literal duplication)
  const scriptPath = process.argv[1] || 'unknown';
  const scriptName = scriptPath.split('/').pop().replace('.js', '');
  console.error(`[${scriptName}] ${message}`);
  process.exit(exitCode);
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
export function createError(code, message, details = {}) {
  return new WUError(code, message, details);
}

/**
 * Create an agent-friendly error with try-next command suggestions
 * WU-1339: Agent-friendly error messages and hints (AX3)
 *
 * @param {string} code - Error code from ErrorCodes
 * @param {string} message - Human-readable error message
 * @param {object} options - Options object
 * @param {string[]} [options.tryNext] - Array of suggested commands or actions to try
 * @param {object} [options.context] - Additional context information
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
export function createAgentFriendlyError(code, message, options = {}) {
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
};
