/**
 * @lumenflow/shims - Git and pnpm Safety Shims (WU-2546)
 *
 * Provides worktree-aware safety wrappers for git and pnpm commands.
 *
 * @packageDocumentation
 */

export const VERSION = '0.0.0';

// Re-export types
export * from './types.js';

// Re-export worktree utilities
export * from './worktree.js';

// Re-export git shim functions
export {
  detectUserType,
  checkBannedPattern,
  checkProtectedContext,
  formatBlockedError,
  findRealGit,
  runGitShim,
} from './git-shim.js';

// Re-export pnpm shim functions
export { findRealPnpm, isDependencyCommand, runPnpmShim } from './pnpm-shim.js';
