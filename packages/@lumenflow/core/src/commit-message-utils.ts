// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2278: Commit Message Utilities
 *
 * Utilities for processing commit messages according to commitlint rules.
 * Specifically handles lowercasing of commit subjects.
 *
 * Note: This is internal LumenFlow tooling - no external library applies.
 *
 * @module commit-message-utils
 */

/**
 * Lowercase the entire subject of a conventional commit message
 *
 * commitlint requires lowercase subjects, but the prepare-commit-msg hook
 * was only lowercasing the first character. This function lowercases
 * the entire subject portion.
 *
 * Examples:
 *   "feat(wu-100): Add Supabase integration" -> "feat(wu-100): add supabase integration"
 *   "fix: Fix OpenAI API call" -> "fix: fix openai api call"
 *
 * @param {string} message - Commit message (first line only)
 * @returns {string} Message with lowercased subject
 */
export function lowercaseCommitSubject(message: string) {
  if (!message || typeof message !== 'string') {
    return message;
  }

  // Match conventional commit format: type(scope): subject
  // or type: subject
  // Using indexOf for simple parsing - safer than complex regex
  const colonIndex = message.indexOf(': ');
  if (colonIndex > 0) {
    const prefix = message.slice(0, colonIndex);
    const subject = message.slice(colonIndex + 2);
    const lowercaseSubject = subject.toLowerCase();
    return `${prefix.toLowerCase()}: ${lowercaseSubject}`;
  }

  // No conventional format - lowercase entire message
  return message.toLowerCase();
}
