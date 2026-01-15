/**
 * Guards Module (WU-2539)
 *
 * Exports all guard functions for protecting WU lifecycle.
 *
 * @module @lumenflow/core/guards
 */

export {
  checkBannedPattern,
  checkProtectedContext,
  formatBlockedError,
  type BannedCheckResult,
  type ProtectedContext,
  type ProtectedContextInput,
} from './git-guard.js';

export {
  isWULocked,
  checkWUEditAllowed,
  WUStatus,
  type WUState,
  type WUEditAllowedResult,
} from './locked-wu-guard.js';

export {
  isDependencyMutatingCommand,
  buildDependencyBlockMessage,
  DEPENDENCY_MUTATING_COMMANDS,
  type DependencyMutatingCommand,
} from './dependency-guard.js';
