// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU ID Generator (WU-1246)
 *
 * Auto-generates sequential WU IDs by scanning existing WU YAML files.
 * Provides race-condition handling via retry mechanism.
 *
 * @module wu-id-generator
 */

import { existsSync, readdirSync } from 'node:fs';
import { WU_PATHS } from './wu-paths.js';
import { createError, ErrorCodes } from './error-handler.js';

/** WU ID prefix constant */
export const WU_ID_PREFIX = 'WU-';

/** Default maximum retry attempts for race condition handling */
const DEFAULT_MAX_RETRIES = 5;

/** Retry delay in milliseconds (exponential backoff base) */
const RETRY_DELAY_BASE_MS = 50;

/**
 * Parse the numeric part from a WU ID string.
 *
 * Supports formats:
 * - WU-123 (direct ID)
 * - WU-123.yaml (filename)
 *
 * @param wuIdOrFilename - WU ID or filename to parse
 * @returns Numeric ID or null if invalid format
 */
export function parseWuIdNumber(wuIdOrFilename: string): number | null {
  if (!wuIdOrFilename || typeof wuIdOrFilename !== 'string') {
    return null;
  }

  // Remove .yaml extension if present
  const wuId = wuIdOrFilename.replace(/\.yaml$/, '');

  // Match WU-{number} pattern using RegExp method per sonarjs/prefer-regexp-exec
  const WU_ID_PATTERN = /^WU-(\d+)$/;
  const regexResult = WU_ID_PATTERN.exec(wuId);
  if (!regexResult) {
    return null;
  }

  const idSegment = regexResult[1];
  if (!idSegment) {
    return null;
  }
  const num = parseInt(idSegment, 10);
  return isNaN(num) ? null : num;
}

/**
 * Get the highest WU ID number from the WU directory.
 *
 * Scans all WU-*.yaml files and returns the highest numeric ID found.
 * Returns 0 if directory doesn't exist or contains no valid WU files.
 *
 * @returns Highest WU ID number or 0 if none found
 */
export function getHighestWuId(): number {
  const wuDir = WU_PATHS.WU_DIR();

  if (!existsSync(wuDir)) {
    return 0;
  }

  const files = readdirSync(wuDir);

  let highest = 0;
  for (const file of files) {
    const num = parseWuIdNumber(file);
    if (num !== null && num > highest) {
      highest = num;
    }
  }

  return highest;
}

/**
 * Get the next available WU ID.
 *
 * Returns the next sequential ID after the highest existing WU.
 * Does not fill gaps - always returns highest + 1.
 *
 * @returns Next WU ID in format "WU-{number}"
 */
export function getNextWuId(): string {
  const highest = getHighestWuId();
  return `${WU_ID_PREFIX}${highest + 1}`;
}

/** Options for generateWuIdWithRetry */
interface GenerateOptions {
  /** Maximum number of retry attempts (default: 5) */
  maxRetries?: number;
}

/**
 * Generate a unique WU ID with retry handling for race conditions.
 *
 * This function handles concurrent wu:create calls by:
 * 1. Generating the next sequential ID
 * 2. Checking if the file already exists (race condition detection)
 * 3. Retrying with exponential backoff if conflict detected
 *
 * @param options - Generation options
 * @returns Promise resolving to unique WU ID
 * @throws Error if max retries exceeded
 */
export async function generateWuIdWithRetry(options: GenerateOptions = {}): Promise<string> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const nextId = getNextWuId();
    const wuPath = WU_PATHS.WU(nextId);

    // Check if file already exists (race condition)
    if (!existsSync(wuPath)) {
      return nextId;
    }

    // Exponential backoff before retry
    const delay = RETRY_DELAY_BASE_MS * Math.pow(2, attempt);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw createError(
    ErrorCodes.ID_GENERATION_FAILED,
    `Failed to generate unique WU ID after ${maxRetries} attempts`,
  );
}
