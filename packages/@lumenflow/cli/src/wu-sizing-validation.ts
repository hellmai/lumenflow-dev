// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-sizing-validation.ts
 * @description WU sizing contract validation (WU-2141)
 *
 * Validates sizing_estimate metadata and checks adherence to the
 * wu-sizing-guide.md thresholds. Provides advisory warnings and
 * strict-mode blocking for oversize WUs.
 *
 * Thresholds are derived from the sizing guide referenced by SIZING_GUIDE_REF.
 *
 * @see {@link ./wu-create-sizing-advisory.ts} - wu:create integration
 * @see {@link ./wu-brief-sizing.ts} - wu:brief integration
 */

import { SIZING_GUIDE_REF } from '@lumenflow/core/wu-constants';

// ─── Constants ───

/** Valid strategy values from the sizing guide */
export const SIZING_STRATEGIES = [
  'single-session',
  'checkpoint-resume',
  'orchestrator-worker',
  'decomposition',
] as const;

export type SizingStrategy = (typeof SIZING_STRATEGIES)[number];

/** Valid exception types for overriding thresholds */
export const SIZING_EXCEPTION_TYPES = ['docs-only', 'shallow-multi-file'] as const;

export type SizingExceptionType = (typeof SIZING_EXCEPTION_TYPES)[number];

/**
 * Sizing thresholds from wu-sizing-guide.md section 1.
 * These are mandatory limits, not guidelines.
 */
export const SIZING_THRESHOLDS = {
  SIMPLE: { files: 20, tool_calls: 50 },
  MEDIUM: { files: 50, tool_calls: 100 },
  OVERSIZED: { files: 100, tool_calls: 200 },
  /** Docs-only exception thresholds (section 1.1) */
  DOCS_ONLY: { files: 40, tool_calls: 50 },
} as const;

// ─── Types ───

/**
 * sizing_estimate metadata contract.
 * Optional on WU YAML -- missing means "no estimate provided" (backward compat).
 */
export interface SizingEstimate {
  /** Estimated number of files to be modified */
  estimated_files: number;
  /** Estimated number of tool calls for the session */
  estimated_tool_calls: number;
  /** Execution strategy from the sizing guide */
  strategy: SizingStrategy;
  /** Exception type when thresholds are intentionally exceeded */
  exception_type?: SizingExceptionType;
  /** Justification for the exception (required when exception_type is set) */
  exception_reason?: string;
}

// ─── Validation ───

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate the structure of a sizing_estimate object.
 *
 * Returns valid=true for undefined input (backward compatibility with
 * historical WUs that lack sizing metadata).
 */
export function validateSizingEstimate(estimate: SizingEstimate | undefined): ValidationResult {
  if (estimate === undefined) {
    return { valid: true, errors: [] };
  }

  const errors: string[] = [];

  if (typeof estimate.estimated_files !== 'number' || estimate.estimated_files < 0) {
    errors.push('sizing_estimate.estimated_files must be a non-negative number');
  }

  if (typeof estimate.estimated_tool_calls !== 'number' || estimate.estimated_tool_calls < 0) {
    errors.push('sizing_estimate.estimated_tool_calls must be a non-negative number');
  }

  if (!SIZING_STRATEGIES.includes(estimate.strategy as SizingStrategy)) {
    errors.push(`sizing_estimate.strategy must be one of: ${SIZING_STRATEGIES.join(', ')}`);
  }

  if (estimate.exception_type !== undefined) {
    if (!SIZING_EXCEPTION_TYPES.includes(estimate.exception_type as SizingExceptionType)) {
      errors.push(
        `sizing_estimate.exception_type must be one of: ${SIZING_EXCEPTION_TYPES.join(', ')}`,
      );
    }

    if (!estimate.exception_reason || estimate.exception_reason.trim().length === 0) {
      errors.push('sizing_estimate.exception_reason is required when exception_type is set');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Advisory Check ───

export interface SizingAdvisoryResult {
  /** Whether the estimate exceeds thresholds without a valid exception */
  oversize: boolean;
  /** Advisory warning messages */
  warnings: string[];
}

/**
 * Check whether a valid exception is present (both type and reason).
 */
function hasValidException(estimate: SizingEstimate): boolean {
  return (
    estimate.exception_type !== undefined &&
    estimate.exception_reason !== undefined &&
    estimate.exception_reason.trim().length > 0
  );
}

/**
 * Check sizing advisory for a WU.
 *
 * Returns warnings when the estimate exceeds thresholds without a valid exception.
 * Returns empty warnings for undefined estimates (backward compatibility).
 *
 * When a valid exception (exception_type + exception_reason) is provided,
 * all warnings are suppressed -- the exception documents the intent and
 * justification for exceeding standard thresholds.
 */
export function checkSizingAdvisory(estimate: SizingEstimate | undefined): SizingAdvisoryResult {
  if (estimate === undefined) {
    return { oversize: false, warnings: [] };
  }

  // Valid exception suppresses all sizing warnings.
  // The exception_reason documents why thresholds are exceeded.
  if (hasValidException(estimate)) {
    return { oversize: false, warnings: [] };
  }

  const warnings: string[] = [];

  // Check oversized threshold (MUST split)
  if (
    estimate.estimated_files > SIZING_THRESHOLDS.OVERSIZED.files ||
    estimate.estimated_tool_calls > SIZING_THRESHOLDS.OVERSIZED.tool_calls
  ) {
    warnings.push(
      `Sizing estimate exceeds OVERSIZED threshold ` +
        `(${estimate.estimated_files} files, ${estimate.estimated_tool_calls} tool calls). ` +
        `This WU MUST be split per ${SIZING_GUIDE_REF}.`,
    );
    return { oversize: true, warnings };
  }

  // Check simple threshold
  if (estimate.estimated_files > SIZING_THRESHOLDS.SIMPLE.files) {
    warnings.push(
      `sizing: estimated_files (${estimate.estimated_files}) exceeds Simple threshold ` +
        `(${SIZING_THRESHOLDS.SIMPLE.files}). Consider adding exception_type/exception_reason ` +
        `or splitting the WU. See ${SIZING_GUIDE_REF}.`,
    );
  }

  if (estimate.estimated_tool_calls > SIZING_THRESHOLDS.SIMPLE.tool_calls) {
    warnings.push(
      `sizing: estimated_tool_calls (${estimate.estimated_tool_calls}) exceeds Simple threshold ` +
        `(${SIZING_THRESHOLDS.SIMPLE.tool_calls}). Consider checkpoint-resume strategy ` +
        `or splitting the WU. See ${SIZING_GUIDE_REF}.`,
    );
  }

  return { oversize: warnings.length > 0, warnings };
}
