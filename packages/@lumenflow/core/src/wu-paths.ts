/**
 * WU Paths - Centralized path management for Work Units
 *
 * All paths are configurable via .lumenflow.config.yaml
 *
 * @module wu-paths
 */

import * as path from 'node:path';
import { getWorktreePath, getProjectRoot as getProjectRootFromConstants } from './wu-constants.js';
import { getConfig, getProjectRoot as getProjectRootFromConfig } from './lumenflow-config.js';

/**
 * Directory depth constants for path resolution.
 * These define how many levels deep each standard file is from repo root.
 */
const PATH_DEPTHS = {
  /** backlog.md is 4 levels deep: docs/04-operations/tasks/backlog.md */
  BACKLOG: 4,
  /** status.md is 4 levels deep: docs/04-operations/tasks/status.md */
  STATUS: 4,
  /** WU YAML files are 5 levels deep: docs/04-operations/tasks/wu/{id}.yaml */
  WU_YAML: 5,
  /** State store is 3 levels deep: .lumenflow/state/wu-events.jsonl */
  STATE_STORE: 3,
};

/**
 * Resolve repo root from an absolute file path by traversing up N directory levels.
 *
 * @param absolutePath - Absolute path to a file within the repo
 * @param depth - Number of directory levels to traverse up
 * @returns Absolute path to repo root
 */
export function resolveRepoRoot(absolutePath: string, depth: number): string {
  let result = absolutePath;
  for (let i = 0; i < depth; i++) {
    result = path.dirname(result);
  }
  return result;
}

/**
 * Compute the directory depth of a relative path (number of path segments).
 *
 * WU-1523: Used to dynamically determine backlog depth from config
 * instead of using hardcoded PATH_DEPTHS constants. This ensures
 * getStateStoreDirFromBacklog works correctly for all docs structures
 * (arc42: docs/04-operations/tasks/backlog.md, simple: docs/tasks/backlog.md, etc.)
 *
 * @param relativePath - Relative file path (e.g., 'docs/tasks/backlog.md')
 * @returns Number of path segments (e.g., 3 for 'docs/tasks/backlog.md')
 */
function computePathDepth(relativePath: string): number {
  // Normalize separators and split on path separator
  const normalized = relativePath.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).length;
}

/**
 * Get the state store directory path from backlog.md path.
 *
 * WU-1523: Now computes depth dynamically from configured backlog path
 * instead of using a hardcoded depth constant. This fixes empty backlog.md
 * and status.md rendering in scaffolded projects with non-default docs structures.
 *
 * @param backlogPath - Absolute path to backlog.md
 * @returns Absolute path to state store directory
 */
export function getStateStoreDirFromBacklog(backlogPath: string): string {
  const config = getConfig();
  const depth = computePathDepth(config.directories.backlogPath);
  const repoRoot = resolveRepoRoot(backlogPath, depth);
  return path.join(repoRoot, config.state.stateDir);
}

/**
 * Create WU paths object with configurable base paths
 *
 * @param options - Options for path generation
 * @param options.projectRoot - Override project root
 * @returns WU paths object
 */
export function createWuPaths(options: { projectRoot?: string } = {}) {
  const config = getConfig({ projectRoot: options.projectRoot });

  return {
    /**
     * Get path to WU YAML file
     * @param id - WU ID (e.g., 'WU-123')
     * @returns Path to WU YAML file
     */
    WU: (id: string) => path.join(config.directories.wuDir, `${id}.yaml`),

    /**
     * Get path to WU directory
     * @returns Path to WU directory
     */
    WU_DIR: () => config.directories.wuDir,

    /**
     * Get path to status.md
     * @returns Path to status.md
     */
    STATUS: () => config.directories.statusPath,

    /**
     * Get path to backlog.md
     * @returns Path to backlog.md
     */
    BACKLOG: () => config.directories.backlogPath,

    /**
     * Get path to stamps directory
     * @returns Path to stamps directory
     */
    STAMPS_DIR: () => config.state.stampsDir,

    /**
     * Get path to WU done stamp file
     * @param id - WU ID (e.g., 'WU-123')
     * @returns Path to stamp file
     */
    STAMP: (id: string) => path.join(config.state.stampsDir, `${id}.done`),

    /**
     * Get path to state directory
     * @returns Path to state directory
     */
    STATE_DIR: () => config.state.stateDir,

    /**
     * Get path to initiatives directory
     * @returns Path to initiatives directory
     */
    INITIATIVES_DIR: () => config.directories.initiativesDir,

    /**
     * Get path to worktrees directory
     * @returns Path to worktrees directory
     */
    WORKTREES_DIR: () => config.directories.worktrees,

    /**
     * Get path to plans directory
     * @returns Path to plans directory (WU-1301)
     */
    PLANS_DIR: () => config.directories.plansDir,

    /**
     * Get path to templates directory
     * @returns Path to templates directory (WU-1310)
     */
    TEMPLATES_DIR: () => config.directories.templatesDir,

    /**
     * Get path to onboarding directory
     * @returns Path to onboarding directory (WU-1310)
     */
    ONBOARDING_DIR: () => config.directories.onboardingDir,
  };
}

/**
 * Default WU paths using default config
 * For backwards compatibility with existing code
 */
export const WU_PATHS = createWuPaths();

/**
 * Generate default worktree path from WU document
 *
 * @param doc - WU document with lane and id fields
 * @returns Worktree path or null if inputs are invalid
 */
export function defaultWorktreeFrom(
  doc: { lane?: string; id?: string } | null | undefined,
): string | null {
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

  // Use centralized getWorktreePath from wu-constants
  return getWorktreePath(laneStr, idStr);
}

/**
 * Resolve a repo-root-relative path to an absolute path using project root.
 *
 * @param relativePath - Path relative to project root
 * @param moduleUrl - import.meta.url of the calling module (for backwards compat)
 * @returns Absolute path resolved from project root
 */
export function resolveFromProjectRoot(relativePath: string, moduleUrl?: string): string {
  // Try config-based project root first, fall back to constants-based
  let projectRoot: string;
  try {
    projectRoot = getProjectRootFromConfig();
  } catch {
    projectRoot = moduleUrl ? getProjectRootFromConstants(moduleUrl) : process.cwd();
  }
  return path.join(projectRoot, relativePath);
}

/**
 * Get absolute path to WU YAML file
 *
 * @param id - WU ID (e.g., 'WU-123')
 * @param options - Options
 * @returns Absolute path to WU YAML file
 */
export function getAbsoluteWuPath(id: string, options: { projectRoot?: string } = {}): string {
  const projectRoot = options.projectRoot || getProjectRootFromConfig();
  const paths = createWuPaths({ projectRoot });
  return path.join(projectRoot, paths.WU(id));
}

/**
 * Get absolute path to stamp file
 *
 * @param id - WU ID (e.g., 'WU-123')
 * @param options - Options
 * @returns Absolute path to stamp file
 */
export function getAbsoluteStampPath(id: string, options: { projectRoot?: string } = {}): string {
  const projectRoot = options.projectRoot || getProjectRootFromConfig();
  const paths = createWuPaths({ projectRoot });
  return path.join(projectRoot, paths.STAMP(id));
}
