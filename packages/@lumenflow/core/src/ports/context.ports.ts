/**
 * Context Ports
 *
 * WU-1093: INIT-002 Phase 1 - Define ports and domain schemas
 *
 * Port interfaces for context-aware validation system.
 * These abstractions allow external users to inject custom implementations.
 *
 * Hexagonal Architecture - Input Ports:
 * - ILocationResolver: Detect main checkout vs worktree
 * - IGitStateReader: Read git branch, dirty state, ahead/behind
 * - IWuStateReader: Read WU state from YAML and state store
 *
 * Current Implementations:
 * - resolveLocation (location-resolver.ts)
 * - readGitState (git-state-reader.ts)
 * - readWuState (wu-state-reader.ts)
 *
 * @module ports/context
 */

import type { LocationContext } from '../context/location-resolver.js';
import type { GitState } from '../context/git-state-reader.js';
import type { WuStateResult } from '../context/wu-state-reader.js';

/**
 * Location Resolver Port Interface
 *
 * Resolves the current working directory context to determine:
 * - Whether in main checkout or a worktree
 * - Path to main checkout
 * - Worktree name and associated WU ID (if applicable)
 *
 * @example
 * // Custom implementation for testing
 * const mockResolver: ILocationResolver = {
 *   resolveLocation: async (cwd) => ({
 *     type: 'main',
 *     cwd: cwd || '/repo',
 *     gitRoot: '/repo',
 *     mainCheckout: '/repo',
 *     worktreeName: null,
 *     worktreeWuId: null,
 *   }),
 * };
 *
 * @example
 * // Using default implementation
 * import { resolveLocation } from './context/location-resolver.js';
 * const resolver: ILocationResolver = { resolveLocation };
 */
export interface ILocationResolver {
  /**
   * Resolve location context for the given working directory.
   *
   * @param cwd - Current working directory (defaults to process.cwd())
   * @returns Promise<LocationContext> - Resolved location context
   */
  resolveLocation(cwd?: string): Promise<LocationContext>;
}

/**
 * Git State Reader Port Interface
 *
 * Reads the current git state including:
 * - Current branch name
 * - Whether HEAD is detached
 * - Dirty working tree (uncommitted changes)
 * - Staged changes
 * - Commits ahead/behind tracking branch
 *
 * @example
 * // Custom implementation for testing
 * const mockReader: IGitStateReader = {
 *   readGitState: async () => ({
 *     branch: 'main',
 *     isDetached: false,
 *     isDirty: false,
 *     hasStaged: false,
 *     ahead: 0,
 *     behind: 0,
 *     tracking: 'origin/main',
 *     modifiedFiles: [],
 *     hasError: false,
 *     errorMessage: null,
 *   }),
 * };
 *
 * @example
 * // Using default implementation
 * import { readGitState } from './context/git-state-reader.js';
 * const reader: IGitStateReader = { readGitState };
 */
export interface IGitStateReader {
  /**
   * Read current git state for the given working directory.
   *
   * @param cwd - Current working directory (defaults to process.cwd())
   * @returns Promise<GitState> - Current git state
   */
  readGitState(cwd?: string): Promise<GitState>;
}

/**
 * WU State Reader Port Interface
 *
 * Reads WU state from YAML file and optionally cross-references
 * with state store for inconsistency detection.
 *
 * @example
 * // Custom implementation for testing
 * const mockReader: IWuStateReader = {
 *   readWuState: async (wuId, repoRoot) => ({
 *     id: wuId,
 *     status: 'in_progress',
 *     lane: 'Framework: Core',
 *     title: 'Test WU',
 *     yamlPath: `${repoRoot}/docs/04-operations/tasks/wu/${wuId}.yaml`,
 *     isConsistent: true,
 *     inconsistencyReason: null,
 *   }),
 * };
 *
 * @example
 * // Using default implementation
 * import { readWuState } from './context/wu-state-reader.js';
 * const reader: IWuStateReader = { readWuState };
 */
export interface IWuStateReader {
  /**
   * Read WU state from YAML and detect inconsistencies.
   *
   * @param wuId - WU ID (e.g., 'WU-1093' or 'wu-1093')
   * @param repoRoot - Repository root path
   * @returns Promise<WuStateResult | null> - WU state or null if not found
   */
  readWuState(wuId: string, repoRoot: string): Promise<WuStateResult | null>;
}

// Re-export types for convenience
export type { LocationContext, GitState, WuStateResult };
