/**
 * Branch-aware bypass detection for cloud/automation agents.
 *
 * Provides functions to check if a branch is an agent branch that can
 * bypass worktree requirements, and if headless mode is allowed.
 *
 * @module branch-check
 */

import micromatch from 'micromatch';
import { getConfig } from './lumenflow-config.js';
import { getAgentPatterns, DEFAULT_AGENT_PATTERNS } from './agent-patterns-registry.js';

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
 * Uses the central registry for agent patterns (fetched from lumenflow.dev
 * with 7-day cache), falling back to config patterns if specified, then
 * to defaults.
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

  // Get patterns: prefer config override, then registry, then defaults
  let patterns: string[];
  if (config?.git?.agentBranchPatterns?.length > 0) {
    // Config has explicit patterns - use those
    patterns = config.git.agentBranchPatterns;
  } else {
    // Fetch from registry (with caching and fallback to defaults)
    patterns = await getAgentPatterns();
  }

  // Use micromatch for proper glob matching
  return micromatch.isMatch(branch, patterns);
}

/**
 * Synchronous version of isAgentBranch for backwards compatibility.
 *
 * Uses only local config patterns or defaults - does NOT fetch from registry.
 * Prefer async isAgentBranch() when possible.
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

  // Use config patterns or defaults (no registry fetch in sync version)
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
