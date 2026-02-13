/**
 * @file generators/index.ts
 * Barrel export for per-hook generator modules (WU-1645).
 *
 * Each hook script builder lives in its own file for focused maintainability.
 * This barrel re-exports all generators so that enforcement-generator.ts
 * (and other consumers) can import from a single location.
 */

export { generateEnforceWorktreeScript } from './enforce-worktree.js';
export { generateRequireWuScript } from './require-wu.js';
export { generateWarnIncompleteScript } from './warn-incomplete.js';
export { generatePreCompactCheckpointScript } from './pre-compact-checkpoint.js';
export { generateSessionStartRecoveryScript } from './session-start-recovery.js';
export { generateAutoCheckpointScript } from './auto-checkpoint.js';
export {
  surfaceUnreadSignals,
  markCompletedWUSignalsAsRead,
  type DisplaySignal,
  type UnreadSignalSummary,
} from './signal-utils.js';
