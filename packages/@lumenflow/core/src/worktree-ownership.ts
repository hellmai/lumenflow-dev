// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2278: Worktree Ownership Validation
 *
 * Validates that a WU can only clean up its own worktree.
 * Prevents cross-agent worktree deletion during parallel execution.
 *
 * Note: No external library exists for LumenFlow-specific worktree ownership
 * validation - this is internal workflow tooling.
 *
 * @module worktree-ownership
 */

/**
 * Extract WU ID from worktree path
 *
 * Worktree paths follow pattern: worktrees/<lane>-wu-<id>
 * Examples:
 *   - worktrees/operations-wu-100 -> WU-100
 *   - worktrees/operations-tooling-wu-2278 -> WU-2278
 *   - worktrees/experience-chat-wu-500 -> WU-500
 *
 * @param {string} worktreePath - Path to worktree
 * @returns {string|null} Extracted WU ID (uppercase) or null if not found
 */
export function extractWUFromWorktreePath(worktreePath: string) {
  if (!worktreePath || typeof worktreePath !== 'string') {
    return null;
  }

  // Match wu-<id> pattern at end of path (case insensitive)
  const match = worktreePath.match(/wu-(\d+)(?:\/)?$/i);
  if (!match) {
    return null;
  }

  return `WU-${match[1]}`;
}

/**
 * Validate that the WU can safely clean up the given worktree
 *
 * Blocks deletion when:
 * - Worktree path contains a different WU ID
 *
 * Allows deletion when:
 * - Worktree path is null/undefined (nothing to clean up)
 * - Worktree path matches the WU ID
 * - Worktree path doesn't follow WU naming convention (manual worktree)
 *
 * @param {Object} params - Validation parameters
 * @param {string|null|undefined} params.worktreePath - Path to worktree
 * @param {string} params.wuId - WU ID attempting cleanup (e.g., "WU-100")
 * @returns {{ valid: boolean, error?: string }} Validation result
 */
export function validateWorktreeOwnership({
  worktreePath,
  wuId,
}: {
  worktreePath: string | null | undefined;
  wuId: string;
}) {
  // No worktree path = nothing to validate
  if (!worktreePath) {
    return { valid: true };
  }

  const worktreeWuId = extractWUFromWorktreePath(worktreePath);

  // If worktree doesn't follow WU naming, allow cleanup (manual worktree)
  if (!worktreeWuId) {
    return {
      valid: false,
      error: `Worktree ownership mismatch: cannot determine owner of ${worktreePath}`,
    };
  }

  // Normalize WU IDs for comparison (case insensitive)
  const normalizedWorktreeId = worktreeWuId.toUpperCase();
  const normalizedWuId = wuId.toUpperCase();

  if (normalizedWorktreeId !== normalizedWuId) {
    return {
      valid: false,
      error: `Worktree ownership mismatch: worktree belongs to ${normalizedWorktreeId}, but ${normalizedWuId} attempted cleanup. This could delete another agent's work.`,
    };
  }

  return { valid: true };
}
