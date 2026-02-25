// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Error helpers for wu:done validators
 *
 * WU-1049: Standardize error handling patterns across wu-done validator paths.
 */

import { createError, ErrorCodes } from './error-handler.js';

/**
 * Create a validation error for wu:done validators.
 */
export function createValidationError(message: string, details = {}) {
  return createError(ErrorCodes.VALIDATION_ERROR, message, details);
}

/**
 * Create a file-not-found error for wu:done validators.
 */
export function createFileNotFoundError(message: string, details = {}) {
  return createError(ErrorCodes.FILE_NOT_FOUND, message, details);
}

/**
 * Create a recovery error for wu:done recovery flows.
 */
export function createRecoveryError(message: string, details = {}) {
  return createError(ErrorCodes.RECOVERY_ERROR, message, details);
}
