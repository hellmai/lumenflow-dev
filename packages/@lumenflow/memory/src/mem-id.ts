// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Memory ID Generator (WU-1465)
 *
 * Hash-based collision-free ID generation for memory nodes.
 * Format: mem-[4 hex chars] derived from content hash.
 * Supports hierarchical IDs (mem-a1b2.1.2) for sub-task decomposition.
 *
 * @see {@link packages/@lumenflow/cli/src/lib/__tests__/mem-id.test.ts} - Tests
 * @see {@link packages/@lumenflow/cli/src/lib/memory-schema.ts} - Schema definitions
 */

import { createHash } from 'node:crypto';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';

/**
 * Memory ID prefix constant
 */
const MEM_ID_PREFIX = 'mem-';

/**
 * Number of hex characters in base ID suffix
 */
const HEX_SUFFIX_LENGTH = 4;

/**
 * Regex patterns for memory ID validation
 */
export const MEM_ID_PATTERNS = {
  /**
   * Base memory ID format: mem-[a-f0-9]{4}
   * Only lowercase hex characters (0-9, a-f)
   */
  BASE_ID: /^mem-[a-f0-9]{4}$/,

  /**
   * Hierarchical memory ID format: mem-[a-f0-9]{4}(.[1-9][0-9]*)*
   * Base ID followed by optional dot-separated positive integers
   * Examples: mem-a1b2, mem-a1b2.1, mem-a1b2.1.2
   */
  HIERARCHICAL_ID: /^mem-[a-f\d]{4}(\.[1-9]\d*)*$/,
};

/**
 * Error messages for validation and exceptions
 */
const ERROR_MESSAGES = {
  INVALID_ID: 'Invalid memory ID format',
  INVALID_BASE_ID: 'Invalid base memory ID format',
  INVALID_INDEX: 'Index must be a positive integer',
};

/**
 * Generates a deterministic memory ID from content.
 *
 * Uses SHA-256 hash of the content, taking the first 4 hex characters.
 * Same content always produces the same ID (deterministic).
 *
 * @param content - Content to hash for ID generation
 * @returns Memory ID in format mem-[a-f0-9]{4}
 *
 * @example
 * const id = generateMemId('discovered file at src/utils.ts');
 * // Returns something like 'mem-a3f2'
 */
export function generateMemId(content: string): string {
  const hash = createHash('sha256').update(content, 'utf-8').digest('hex');

  // Take first 4 hex characters from hash
  const suffix = hash.slice(0, HEX_SUFFIX_LENGTH);

  return `${MEM_ID_PREFIX}${suffix}`;
}

/**
 * Generates a hierarchical memory ID by appending an index to a parent ID.
 *
 * Used for sub-task decomposition where a parent task (mem-a1b2) has
 * child tasks (mem-a1b2.1, mem-a1b2.2) and grandchildren (mem-a1b2.1.1).
 *
 * @param parentId - Parent memory ID (base or hierarchical)
 * @param index - Positive integer index (1-based)
 * @returns Hierarchical memory ID
 * @throws If parentId is invalid or index is not positive
 *
 * @example
 * generateHierarchicalId('mem-a1b2', 1);     // 'mem-a1b2.1'
 * generateHierarchicalId('mem-a1b2.1', 2);  // 'mem-a1b2.1.2'
 */
export function generateHierarchicalId(parentId: string, index: number): string {
  // Validate parent ID
  if (!MEM_ID_PATTERNS.HIERARCHICAL_ID.test(parentId)) {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      `${ERROR_MESSAGES.INVALID_BASE_ID}: ${parentId}`,
    );
  }

  // Validate index is positive integer
  if (!Number.isInteger(index) || index < 1) {
    throw createError(ErrorCodes.VALIDATION_ERROR, `${ERROR_MESSAGES.INVALID_INDEX}: ${index}`);
  }

  return `${parentId}.${index}`;
}

/**
 * Validation result from validateMemId
 */
export interface MemIdValidationResult {
  /** Whether the ID is valid */
  valid: boolean;
  /** Type of ID if valid */
  type?: 'base' | 'hierarchical';
  /** Base ID portion if hierarchical */
  baseId?: string;
  /** Hierarchical indices (empty for base IDs) */
  indices: number[];
  /** Error message if invalid */
  error?: string;
}

/**
 * Validates a memory ID and extracts its components.
 *
 * Returns validation result with type classification and parsed components.
 * Compatible with MEMORY_PATTERNS.MEMORY_ID from memory-schema.ts.
 *
 * @param id - Memory ID to validate
 * @returns Validation result with parsed components
 *
 * @example
 * validateMemId('mem-a1b2');
 * // { valid: true, type: 'base', baseId: 'mem-a1b2', indices: [] }
 *
 * validateMemId('mem-a1b2.1.2');
 * // { valid: true, type: 'hierarchical', baseId: 'mem-a1b2', indices: [1, 2] }
 *
 * validateMemId('invalid');
 * // { valid: false, error: 'Invalid memory ID format', indices: [] }
 */
export function validateMemId(id: string): MemIdValidationResult {
  // Quick validation using regex
  if (!MEM_ID_PATTERNS.HIERARCHICAL_ID.test(id)) {
    return {
      valid: false,
      error: ERROR_MESSAGES.INVALID_ID,
      indices: [],
    };
  }

  // Check if it's a base ID (no dots after the prefix)
  if (MEM_ID_PATTERNS.BASE_ID.test(id)) {
    return {
      valid: true,
      type: 'base',
      baseId: id,
      indices: [],
    };
  }

  // It's a hierarchical ID - parse components
  const parts = id.split('.');
  const baseId = parts[0];
  const indices = parts.slice(1).map((part) => parseInt(part, 10));

  return {
    valid: true,
    type: 'hierarchical',
    baseId,
    indices,
  };
}
