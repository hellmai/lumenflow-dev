/**
 * WU Helpers Port Interfaces
 *
 * WU-1102: INIT-003 Phase 2b - Port interfaces for WU helper modules
 *
 * Hexagonal Architecture - Input Ports:
 * These abstractions allow external users to inject custom implementations
 * for WU lifecycle operations.
 *
 * @module ports/wu-helpers
 */

/**
 * Git adapter interface for ensureOnMain and ensureMainUpToDate operations
 */
export interface IWuGitAdapter {
  /**
   * Get the current git branch name
   * @returns Promise resolving to branch name
   */
  getCurrentBranch(): Promise<string>;

  /**
   * Fetch from a remote
   * @param remote - Remote name (e.g., 'origin')
   * @param branch - Branch name (e.g., 'main')
   */
  fetch(remote: string, branch: string): Promise<void>;

  /**
   * Get commit hash for a ref
   * @param ref - Git ref (branch, tag, or commit)
   * @returns Promise resolving to commit hash
   */
  getCommitHash(ref: string): Promise<string>;
}

/**
 * WU status check result
 */
export interface IWuStatusCheckResult {
  /** Whether the operation is allowed */
  allowed: boolean;
  /** Current WU status */
  status: string | null;
  /** Error message if not allowed */
  error: string | null;
}

/**
 * Branch validation result
 */
export interface IBranchValidationResult {
  /** Whether the branch name is valid */
  valid: boolean;
  /** Lane name (kebab-case) or null */
  lane: string | null;
  /** WU ID (uppercase) or null */
  wuid: string | null;
  /** Error message if invalid */
  error: string | null;
}

/**
 * WU YAML reader interface
 */
export interface IWuYamlReader {
  /**
   * Read and parse WU YAML file
   * @param wuPath - Path to WU YAML file
   * @param expectedId - Expected WU ID for validation
   * @returns Parsed WU document
   */
  readWU(wuPath: string, expectedId: string): unknown;

  /**
   * Read YAML file without ID validation
   * @param yamlPath - Path to YAML file
   * @returns Parsed document
   */
  readWURaw(yamlPath: string): unknown;
}

/**
 * WU YAML writer interface
 */
export interface IWuYamlWriter {
  /**
   * Write WU document to file
   * @param wuPath - Path to WU YAML file
   * @param doc - Document to write
   */
  writeWU(wuPath: string, doc: unknown): void;
}

/**
 * WU state store interface (subset for dependency injection)
 */
export interface IWuStateStore {
  /**
   * Load state from events file
   */
  load(): Promise<void>;

  /**
   * Claim a WU (transition to in_progress)
   * @param wuId - WU identifier
   * @param lane - Lane name
   * @param title - WU title
   */
  claim(wuId: string, lane: string, title: string): Promise<void>;

  /**
   * Complete a WU (transition to done)
   * @param wuId - WU identifier
   */
  complete(wuId: string): Promise<void>;

  /**
   * Block a WU (transition to blocked)
   * @param wuId - WU identifier
   * @param reason - Block reason
   */
  block(wuId: string, reason: string): Promise<void>;

  /**
   * Unblock a WU (transition back to in_progress)
   * @param wuId - WU identifier
   */
  unblock(wuId: string): Promise<void>;

  /**
   * Release a WU (transition to ready)
   * @param wuId - WU identifier
   * @param reason - Release reason
   */
  release(wuId: string, reason: string): Promise<void>;

  /**
   * Get WU state entry
   * @param wuId - WU identifier
   * @returns State entry or undefined
   */
  getWUState(wuId: string): { status: string; lane: string; title: string } | undefined;

  /**
   * Get all WU IDs by status
   * @param status - Status to filter by
   * @returns Set of WU IDs
   */
  getByStatus(status: string): Set<string>;

  /**
   * Get all WU IDs by lane
   * @param lane - Lane to filter by
   * @returns Set of WU IDs
   */
  getByLane(lane: string): Set<string>;
}

/**
 * WU checkpoint interface
 */
export interface IWuCheckpointManager {
  /**
   * Create a pre-gates checkpoint
   */
  createPreGatesCheckpoint(
    params: { wuId: string; worktreePath: string; branchName: string; gatesPassed?: boolean },
    options?: { baseDir?: string },
  ): Promise<{ checkpointId: string; gatesPassed: boolean }>;

  /**
   * Mark checkpoint as gates passed
   * @param wuId - WU identifier
   * @returns True if updated
   */
  markGatesPassed(wuId: string, options?: { baseDir?: string }): boolean;

  /**
   * Get checkpoint for a WU
   * @param wuId - WU identifier
   * @returns Checkpoint or null
   */
  getCheckpoint(
    wuId: string,
    options?: { baseDir?: string },
  ): { gatesPassed: boolean; worktreeHeadSha: string } | null;

  /**
   * Clear checkpoint
   * @param wuId - WU identifier
   */
  clearCheckpoint(wuId: string, options?: { baseDir?: string }): void;

  /**
   * Check if gates can be skipped
   */
  canSkipGates(
    wuId: string,
    options?: { baseDir?: string; currentHeadSha?: string },
  ): { canSkip: boolean; reason?: string };
}

/**
 * WU paths interface
 */
export interface IWuPaths {
  /** Get path to WU YAML file */
  WU(id: string): string;

  /** Get path to WU directory */
  WU_DIR(): string;

  /** Get path to status.md */
  STATUS(): string;

  /** Get path to backlog.md */
  BACKLOG(): string;

  /** Get path to stamps directory */
  STAMPS_DIR(): string;

  /** Get path to WU done stamp file */
  STAMP(id: string): string;

  /** Get path to state directory */
  STATE_DIR(): string;

  /** Get path to initiatives directory */
  INITIATIVES_DIR(): string;

  /** Get path to worktrees directory */
  WORKTREES_DIR(): string;
}
