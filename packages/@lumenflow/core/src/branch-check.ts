/**
 * Branch-aware bypass detection for cloud/automation agents.
 *
 * Provides functions to check if a branch is an agent branch that can
 * bypass worktree requirements, and if headless mode is allowed.
 *
 * WU-1089: Updated to use resolveAgentPatterns with merge/override/airgapped support.
 *
 * @module branch-check
 */

import micromatch from 'micromatch';
import { getConfig } from './lumenflow-config.js';
import {
  resolveAgentPatterns,
  DEFAULT_AGENT_PATTERNS,
  type AgentPatternResult,
} from './agent-patterns-registry.js';

/** Legacy protected branch (always protected regardless of mainBranch setting) */
const LEGACY_PROTECTED = 'master';

/**
 * Get lane branch pattern from config (or default).
 * Lane branches always require worktrees - never bypassed.
 */
function getLaneBranchPattern(): RegExp {
  const config = getConfig();
  const prefix = config?.git?.laneBranchPrefix ?? 'lane/';
  // Escape regex special chars in prefix, then anchor to start
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // eslint-disable-next-line security/detect-non-literal-regexp -- prefix from config file, not user input; escaped for safety
  return new RegExp(`^${escaped}`);
}

/**
 * Get protected branches derived from config.
 * Returns [mainBranch, 'master'] to avoid config duplication.
 */
function getProtectedBranches(): string[] {
  const config = getConfig();
  const mainBranch = config?.git?.mainBranch ?? 'main';
  // Deduplicate in case mainBranch is 'master'
  const protectedSet = new Set([mainBranch, LEGACY_PROTECTED]);
  return Array.from(protectedSet);
}

/**
 * Check if branch is an agent branch that can bypass worktree requirements.
 *
 * WU-1089: Now uses resolveAgentPatterns with proper merge/override/airgapped support:
 * - Default: Fetches from registry (lumenflow.dev) with 7-day cache
 * - Config patterns merge with registry patterns (config first)
 * - Override patterns (agentBranchPatternsOverride) replace everything
 * - Airgapped mode (disableAgentPatternRegistry) skips network fetch
 *
 * @param branch - Branch name to check
 * @returns Promise<true> if branch matches agent patterns
 *
 * @example
 * ```typescript
 * if (await isAgentBranch('claude/session-123')) {
 *   // Allow bypass for agent branch
 * }
 * ```
 */
export async function isAgentBranch(branch: string | null | undefined): Promise<boolean> {
  // Fail-closed: no branch = protected
  if (!branch) return false;

  // Detached HEAD = protected (fail-closed)
  if (branch === 'HEAD') return false;

  // Load config (uses existing loader with caching)
  const config = getConfig();
  const protectedBranches = getProtectedBranches();

  // Protected branches are NEVER bypassed (mainBranch + 'master')
  if (protectedBranches.includes(branch)) return false;

  // LumenFlow lane branches require worktrees (uses config's laneBranchPrefix)
  if (getLaneBranchPattern().test(branch)) return false;

  // WU-1089: Use resolveAgentPatterns with full merge/override/airgapped support
  const result = await resolveAgentPatterns({
    configPatterns: config?.git?.agentBranchPatterns,
    overridePatterns: config?.git?.agentBranchPatternsOverride,
    disableAgentPatternRegistry: config?.git?.disableAgentPatternRegistry,
  });

  // Use micromatch for proper glob matching
  return micromatch.isMatch(branch, result.patterns);
}

/**
 * Check if branch is an agent branch with full result details.
 *
 * Same as isAgentBranch but returns the full AgentPatternResult
 * for observability and debugging.
 *
 * @param branch - Branch name to check
 * @returns Promise with match result and pattern resolution details
 *
 * @example
 * ```typescript
 * const result = await isAgentBranchWithDetails('claude/session-123');
 * if (result.isMatch) {
 *   console.log(`Matched via ${result.patternResult.source}`);
 *   console.log(`Registry fetched: ${result.patternResult.registryFetched}`);
 * }
 * ```
 */
export async function isAgentBranchWithDetails(
  branch: string | null | undefined,
): Promise<{ isMatch: boolean; patternResult: AgentPatternResult }> {
  // Fail-closed: no branch = protected
  if (!branch) {
    return {
      isMatch: false,
      patternResult: { patterns: [], source: 'defaults', registryFetched: false },
    };
  }

  // Detached HEAD = protected (fail-closed)
  if (branch === 'HEAD') {
    return {
      isMatch: false,
      patternResult: { patterns: [], source: 'defaults', registryFetched: false },
    };
  }

  // Load config
  const config = getConfig();
  const protectedBranches = getProtectedBranches();

  // Protected branches are NEVER bypassed
  if (protectedBranches.includes(branch)) {
    return {
      isMatch: false,
      patternResult: { patterns: [], source: 'defaults', registryFetched: false },
    };
  }

  // Lane branches require worktrees
  if (getLaneBranchPattern().test(branch)) {
    return {
      isMatch: false,
      patternResult: { patterns: [], source: 'defaults', registryFetched: false },
    };
  }

  // Resolve patterns with full details
  const patternResult = await resolveAgentPatterns({
    configPatterns: config?.git?.agentBranchPatterns,
    overridePatterns: config?.git?.agentBranchPatternsOverride,
    disableAgentPatternRegistry: config?.git?.disableAgentPatternRegistry,
  });

  const isMatch = micromatch.isMatch(branch, patternResult.patterns);

  return { isMatch, patternResult };
}

/**
 * Synchronous version of isAgentBranch for backwards compatibility.
 *
 * Uses only local config patterns or defaults - does NOT fetch from registry.
 * Prefer async isAgentBranch() when possible.
 *
 * WU-1089: Updated to respect override and disable flags, but cannot fetch from registry.
 *
 * @param branch - Branch name to check
 * @returns True if branch matches agent patterns
 *
 * @deprecated Use async isAgentBranch() instead for registry support
 */
export function isAgentBranchSync(branch: string | null | undefined): boolean {
  // Fail-closed: no branch = protected
  if (!branch) return false;

  // Detached HEAD = protected (fail-closed)
  if (branch === 'HEAD') return false;

  // Load config (uses existing loader with caching)
  const config = getConfig();
  const protectedBranches = getProtectedBranches();

  // Protected branches are NEVER bypassed (mainBranch + 'master')
  if (protectedBranches.includes(branch)) return false;

  // LumenFlow lane branches require worktrees (uses config's laneBranchPrefix)
  if (getLaneBranchPattern().test(branch)) return false;

  // WU-1089: Check override first
  if (config?.git?.agentBranchPatternsOverride?.length) {
    return micromatch.isMatch(branch, config.git.agentBranchPatternsOverride);
  }

  // Use config patterns if provided, otherwise defaults
  // Note: sync version cannot fetch from registry
  const patterns =
    config?.git?.agentBranchPatterns?.length > 0
      ? config.git.agentBranchPatterns
      : DEFAULT_AGENT_PATTERNS;

  // Use micromatch for proper glob matching
  return micromatch.isMatch(branch, patterns);
}

/**
 * Check if headless mode is allowed (guarded).
 * Requires LUMENFLOW_HEADLESS=1 AND (LUMENFLOW_ADMIN=1 OR CI truthy OR GITHUB_ACTIONS truthy)
 */
export function isHeadlessAllowed(): boolean {
  if (process.env.LUMENFLOW_HEADLESS !== '1') return false;
  return (
    process.env.LUMENFLOW_ADMIN === '1' ||
    Boolean(process.env.CI) || // Any truthy CI value (true, 1, yes, etc.)
    Boolean(process.env.GITHUB_ACTIONS) // Any truthy value
  );
}
