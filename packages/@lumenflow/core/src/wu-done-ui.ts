// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Done UI Helpers
 *
 * WU-1281: Extracted display helpers to consolidate DRY violations
 * and use library-first duration formatting.
 *
 * @see {@link packages/@lumenflow/cli/src/wu-done.ts} - Primary consumer
 * @see {@link packages/@lumenflow/cli/src/lib/wu-constants.ts} - UI constants
 */

import prettyMs from 'pretty-ms';
import { UI, LOG_PREFIX, STRING_LITERALS } from './wu-constants.js';

/**
 * Print prominent gate failure box
 *
 * Consolidated from two duplicate implementations in wu-done.ts
 * (worktree mode and branch-only mode). Uses pretty-ms for
 * human-readable duration formatting.
 *
 * @param {object} options - Failure info
 * @param {string} options.id - WU ID (e.g., 'WU-123')
 * @param {string} options.location - Location description (worktree path or 'Branch-Only')
 * @param {number} options.durationMs - Duration in milliseconds
 * @param {boolean} [options.isWorktreeMode=true] - True for worktree mode, false for branch-only
 */
export function printGateFailureBox({
  id,
  location,
  durationMs,
  isWorktreeMode = true,
}: {
  id: string;
  location: string;
  durationMs: number;
  isWorktreeMode?: boolean;
}) {
  const width = UI.ERROR_BOX_WIDTH;
  const duration = prettyMs(durationMs, { secondsDecimalDigits: 0 });

  console.error(`\n${'═'.repeat(width)}`);
  console.error('❌ WU:DONE FAILED - GATES DID NOT PASS');
  console.error('═'.repeat(width));
  console.error(`WU ID:     ${id}`);
  console.error(
    `${isWorktreeMode ? 'Worktree' : 'Mode'}:  ${isWorktreeMode ? location : 'Branch-Only'}`,
  );
  console.error(`Duration:  ${duration}`);
  console.error('─'.repeat(width));
  console.error('Next steps:');

  if (isWorktreeMode) {
    console.error(`  1. cd ${location}`);
    console.error('  2. Review gate output above to identify failures');
    console.error('  3. Fix issues in the worktree');
    console.error('  4. Run: pnpm gates');
    console.error(`  5. cd back to main and re-run: pnpm wu:done --id ${id}`);
  } else {
    console.error('  1. Review gate output above to identify failures');
    console.error('  2. Fix issues on the lane branch');
    console.error('  3. Run: pnpm gates');
    console.error(`  4. Re-run: pnpm wu:done --id ${id}`);
  }

  console.error(`${'═'.repeat(width)}\n`);
}

/**
 * Print git status preview with truncation
 *
 * Shows first N lines of git status output with indication
 * of how many more files exist. Parses output once (not three times).
 *
 * @param {string} statusOutput - Raw git status --porcelain output
 */
export function printStatusPreview(statusOutput: string) {
  const lines = statusOutput
    .split(STRING_LITERALS.NEWLINE)
    .filter((line: string) => line.trim());
  const previewLimit = UI.STATUS_PREVIEW_LINES;
  const preview = lines.slice(0, previewLimit);

  console.warn(`${LOG_PREFIX.DONE} ⚠️  Working tree still has changes after rollback:`);
  console.warn(preview.join(STRING_LITERALS.NEWLINE));

  if (lines.length > previewLimit) {
    console.warn(`  ... and ${lines.length - previewLimit} more files`);
  }
  console.warn(`${LOG_PREFIX.DONE} Run "git status" for full details`);
}
