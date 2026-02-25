// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-claim-helpers.ts
 * Helper functions for wu:claim (WU-1423)
 *
 * Extracted email validation logic for testability and SOLID compliance.
 */

import { z } from 'zod';
import { createError, ErrorCodes } from './error-handler.js';

/**
 * Zod schema for validating email addresses.
 * Uses Zod's built-in email validation (library-first, no regex).
 */
const emailSchema = z.string().email();

/**
 * Validates if a string is a valid email address.
 *
 * @param {string} value - The string to validate
 * @returns {boolean} True if valid email, false otherwise
 */
export function isValidEmail(value: string) {
  if (!value || typeof value !== 'string') {
    return false;
  }
  return emailSchema.safeParse(value).success;
}

/**
 * Gets a valid email address for WU assignment.
 *
 * Fallback chain (WU-1423):
 * 1. git config user.email
 * 2. GIT_AUTHOR_EMAIL environment variable
 * 3. Error (no silent fallback to username)
 *
 * @param {object} gitAdapter - Git adapter with getConfigValue method
 * @returns {Promise<string>} Valid email address
 * @throws {Error} If no valid email can be determined
 */
export async function getAssignedEmail(gitAdapter: { getConfigValue: (key: string) => Promise<string> }) {
  // Try git config user.email first (WU-1427: properly await async method)
  try {
    const gitEmail = await gitAdapter.getConfigValue('user.email');
    const trimmed = gitEmail?.trim();
    if (trimmed && isValidEmail(trimmed)) {
      return trimmed;
    }
  } catch {
    // Git config not available, continue to fallback
  }

  // Fallback to GIT_AUTHOR_EMAIL (commonly set in CI/scripting)
  const authorEmail = process.env.GIT_AUTHOR_EMAIL?.trim();
  if (authorEmail && isValidEmail(authorEmail)) {
    return authorEmail;
  }

  // WU-1423: NO silent fallback to username (GIT_USER, USER)
  // These are usernames, not email addresses, and would cause wu:done validation failures
  throw createError(
    ErrorCodes.CONFIG_ERROR,
    'Cannot determine assigned_to email address.\n\n' +
      'Checked:\n' +
      '  1. git config user.email - not set or invalid\n' +
      '  2. GIT_AUTHOR_EMAIL env var - not set or invalid\n\n' +
      'Fix:\n' +
      '  git config --global user.email "you@example.com"\n' +
      '  OR export GIT_AUTHOR_EMAIL="you@example.com"',
  );
}
