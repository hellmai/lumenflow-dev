/**
 * Context Computer for WU Operations
 *
 * WU-1090: Context-aware state machine for WU lifecycle commands
 * WU-1092: Adds worktreeGit field for checking worktree state from main
 *
 * Computes the unified WuContext by gathering location, git, and WU state.
 * Performance budget: <100ms for complete context computation.
 *
 * @module
 */

import { join } from 'node:path';
import { CONTEXT_VALIDATION, WU_STATUS, getWorktreePath } from '../wu-constants.js';
import { resolveLocation, type LocationContext } from './location-resolver.js';
import { readGitState, type GitState } from './git-state-reader.js';
import { readWuState, type WuStateResult } from './wu-state-reader.js';
import type { WuContext, WuState, SessionState } from '../validation/types.js';

const { THRESHOLDS, LOCATION_TYPES } = CONTEXT_VALIDATION;

/**
 * Options for computing context.
 */
export interface ComputeContextOptions {
  /** Current working directory (defaults to process.cwd()) */
  cwd?: string;
  /** WU ID to look up (optional) */
  wuId?: string;
  /** Session ID if known */
  sessionId?: string;
}

/**
 * Result of context computation with timing.
 */
export interface ComputeContextResult {
  /** The computed context */
  context: WuContext;
  /** Time taken to compute in milliseconds */
  computationMs: number;
  /** Whether computation exceeded budget */
  exceededBudget: boolean;
}

/**
 * Convert WuStateResult to WuState interface used in WuContext.
 */
function toWuState(result: WuStateResult): WuState {
  return {
    id: result.id,
    status: result.status,
    lane: result.lane,
    title: result.title,
    yamlPath: result.yamlPath,
    isConsistent: result.isConsistent,
    inconsistencyReason: result.inconsistencyReason,
  };
}

/**
 * Extract WU ID from context if available.
 *
 * Priority:
 * 1. Explicit wuId option
 * 2. WU ID from worktree path
 */
function getWuIdToLookup(options: ComputeContextOptions, location: LocationContext): string | null {
  if (options.wuId) {
    return options.wuId;
  }
  if (location.worktreeWuId) {
    return location.worktreeWuId;
  }
  return null;
}

/**
 * Determine if we should read worktree git state (WU-1092).
 *
 * We need worktreeGit when:
 * - Running from main checkout (not already in worktree)
 * - WU is specified and found
 * - WU is in_progress (implying worktree exists)
 */
function shouldReadWorktreeGit(location: LocationContext, wuState: WuState | null): boolean {
  return (
    location.type === LOCATION_TYPES.MAIN &&
    wuState !== null &&
    wuState.status === WU_STATUS.IN_PROGRESS
  );
}

/**
 * Get the absolute path to a WU's worktree.
 *
 * @param mainCheckout - Path to main checkout
 * @param lane - WU lane name
 * @param wuId - WU ID
 * @returns Absolute path to worktree
 */
function getWorktreeAbsolutePath(mainCheckout: string, lane: string, wuId: string): string {
  const relativePath = getWorktreePath(lane, wuId);
  return join(mainCheckout, relativePath);
}

/**
 * Compute complete WuContext.
 *
 * Gathers location, git state, and WU state in parallel where possible.
 * Performance budget: <100ms for complete computation.
 *
 * WU-1092: Also reads worktreeGit when running from main with in_progress WU.
 *
 * @param options - Options for context computation
 * @returns Promise<ComputeContextResult> - Computed context with timing
 */
export async function computeContext(
  options: ComputeContextOptions = {},
): Promise<ComputeContextResult> {
  const startTime = performance.now();
  const cwd = options.cwd ?? process.cwd();

  // Step 1: Resolve location first (needed to determine WU ID and main checkout)
  const location = await resolveLocation(cwd);

  // Step 2: Get WU ID to look up
  const wuId = getWuIdToLookup(options, location);

  // Step 3: Read git state and WU state in parallel
  const [gitState, wuStateResult] = await Promise.all([
    readGitState(cwd),
    wuId ? readWuState(wuId, location.mainCheckout) : Promise.resolve(null),
  ]);

  // Step 4: Build WU state (null if no WU found)
  const wuState: WuState | null = wuStateResult ? toWuState(wuStateResult) : null;

  // Step 5: Build session state
  const session: SessionState = {
    isActive: !!options.sessionId,
    sessionId: options.sessionId ?? null,
  };

  // Step 6: Read worktree git state if applicable (WU-1092)
  let worktreeGit: GitState | undefined;
  if (shouldReadWorktreeGit(location, wuState)) {
    const worktreePath = getWorktreeAbsolutePath(location.mainCheckout, wuState!.lane, wuState!.id);
    worktreeGit = await readGitState(worktreePath);
  }

  // Step 7: Build complete context
  const context: WuContext = {
    location,
    git: gitState,
    wu: wuState,
    session,
    ...(worktreeGit !== undefined && { worktreeGit }),
  };

  const endTime = performance.now();
  const computationMs = endTime - startTime;
  const exceededBudget = computationMs > THRESHOLDS.CONTEXT_COMPUTATION_MS;

  return {
    context,
    computationMs,
    exceededBudget,
  };
}
