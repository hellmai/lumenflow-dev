import path from 'node:path';
import { getWorktreePath, getProjectRoot } from './wu-constants.js';

/**
 * Directory depth constants for path resolution.
 * These define how many levels deep each standard file is from repo root.
 *
 * Structure: {repoRoot}/docs/04-operations/tasks/{file}
 *            └── 0 ──┘└─ 1 ─┘└──── 2 ─────┘└─ 3 ─┘
 */
const PATH_DEPTHS = {
  /** backlog.md is 4 levels deep: docs/04-operations/tasks/backlog.md */
  BACKLOG: 4,
  /** status.md is 4 levels deep: docs/04-operations/tasks/status.md */
  STATUS: 4,
  /** WU YAML files are 5 levels deep: docs/04-operations/tasks/wu/{id}.yaml */
  WU_YAML: 5,
  /** State store is 3 levels deep: .beacon/state/wu-events.jsonl */
  STATE_STORE: 3,
};

/**
 * Resolve repo root from an absolute file path by traversing up N directory levels.
 *
 * @param {string} absolutePath - Absolute path to a file within the repo
 * @param {number} depth - Number of directory levels to traverse up
 * @returns {string} Absolute path to repo root
 *
 * @example
 * // From backlog.md (4 levels deep), returns repo root
 * const root = resolveRepoRoot(backlogPath, PATH_DEPTHS.BACKLOG);
 */
export function resolveRepoRoot(absolutePath, depth) {
  let result = absolutePath;
  for (let i = 0; i < depth; i++) {
    result = path.dirname(result);
  }
  return result;
}

/**
 * Get the state store directory path from backlog.md path.
 *
 * WU-1593: Correctly resolves repo root from backlog path (4 levels up),
 * then appends .beacon/state for the state store location.
 *
 * @param {string} backlogPath - Absolute path to backlog.md
 * @returns {string} Absolute path to state store directory
 *
 * @example
 * // Returns state store directory path from backlog path
 * const stateDir = getStateStoreDirFromBacklog(backlogPath);
 */
export function getStateStoreDirFromBacklog(backlogPath) {
  const repoRoot = resolveRepoRoot(backlogPath, PATH_DEPTHS.BACKLOG);
  return path.join(repoRoot, '.beacon', 'state');
}

/**
 * Centralized path constants for WU (Work Unit) management scripts.
 *
 * Eliminates hardcoded path strings scattered across wu-claim, wu-done, wu-block, etc.
 * Single source of truth for all WU-related file paths.
 *
 * @example
 * import { WU_PATHS } from './lib/wu-paths.js';
 * const wuPath = WU_PATHS.WU('WU-123'); // 'docs/04-operations/tasks/wu/WU-123.yaml'
 * const stampPath = WU_PATHS.STAMP('WU-123'); // '.beacon/stamps/WU-123.done'
 */
export const WU_PATHS = {
  /**
   * Get path to WU YAML file
   * @param {string} id - WU ID (e.g., 'WU-123')
   * @returns {string} Path to WU YAML file
   */
  WU: (id) => path.join('docs', '04-operations', 'tasks', 'wu', `${id}.yaml`),

  /**
   * Get path to WU directory
   * @returns {string} Path to WU directory
   */
  WU_DIR: () => path.join('docs', '04-operations', 'tasks', 'wu'),

  /**
   * Get path to status.md
   * @returns {string} Path to status.md
   */
  STATUS: () => path.join('docs', '04-operations', 'tasks', 'status.md'),

  /**
   * Get path to backlog.md
   * @returns {string} Path to backlog.md
   */
  BACKLOG: () => path.join('docs', '04-operations', 'tasks', 'backlog.md'),

  /**
   * Get path to stamps directory
   * @returns {string} Path to stamps directory
   */
  STAMPS_DIR: () => path.join('.beacon', 'stamps'),

  /**
   * Get path to WU done stamp file
   * @param {string} id - WU ID (e.g., 'WU-123')
   * @returns {string} Path to stamp file
   */
  STAMP: (id) => path.join('.beacon', 'stamps', `${id}.done`),
};

/**
 * Generate default worktree path from WU document
 *
 * Extracted from duplicate implementations in wu-block, wu-unblock, wu-claim (WU-1341).
 * Uses centralized getWorktreePath() from wu-constants.mjs for consistent path generation.
 *
 * @param {object|null|undefined} doc - WU document with lane and id fields
 * @returns {string|null} Worktree path or null if inputs are invalid
 *
 * @example
 * defaultWorktreeFrom({ lane: 'Operations: Tooling', id: 'WU-123' })
 * // => 'worktrees/operations-tooling-wu-123'
 *
 * defaultWorktreeFrom({ lane: 'Intelligence', id: 'WU-456' })
 * // => 'worktrees/intelligence-wu-456'
 *
 * defaultWorktreeFrom(null)
 * // => null
 */
export function defaultWorktreeFrom(doc) {
  if (!doc) return null;
  const lane = doc.lane;
  const id = doc.id;

  // Validate inputs
  if (!lane || !id) return null;

  // Convert to string and trim
  const laneStr = String(lane).trim();
  const idStr = String(id).trim();

  // Check for empty strings after trimming
  if (laneStr === '' || idStr === '') return null;

  // Use centralized getWorktreePath from wu-constants.mjs
  return getWorktreePath(laneStr, idStr);
}

/**
 * Resolve a repo-root-relative path to an absolute path using project root.
 *
 * WU-1806: When running from inside a worktree, resolve() uses process.cwd()
 * as the base, which creates bogus nested paths like:
 *   worktrees/operations-wu-123/worktrees/operations-wu-123
 *
 * This function resolves paths relative to the project root (main checkout),
 * regardless of where the script is executed from.
 *
 * @param {string} relativePath - Path relative to project root (e.g., 'worktrees/ops-wu-123')
 * @param {string} moduleUrl - import.meta.url of the calling module (for project root resolution)
 * @returns {string} Absolute path resolved from project root
 *
 * @example
 * // From inside a worktree, this works correctly:
 * const absolutePath = resolveFromProjectRoot('worktrees/ops-wu-123', import.meta.url);
 * // => '/path/to/repo/worktrees/ops-wu-123' (NOT nested)
 */
export function resolveFromProjectRoot(relativePath, moduleUrl) {
  const projectRoot = getProjectRoot(moduleUrl);
  return path.join(projectRoot, relativePath);
}
