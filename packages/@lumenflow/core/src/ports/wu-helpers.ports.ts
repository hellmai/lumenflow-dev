// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

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

import type { ISyncValidatorGitAdapter } from './sync-validator.ports.js';

/**
 * Git adapter interface for ensureOnMain and ensureMainUpToDate operations
 */
export interface IWuGitAdapter extends Pick<ISyncValidatorGitAdapter, 'fetch' | 'getCommitHash'> {
  /**
   * Get the current git branch name
   * @returns Promise resolving to branch name
   */
  getCurrentBranch(): Promise<string>;
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

// WU-2020: IWuStateStore is now canonically defined in wu-state.ports.ts
// Re-export here for backward compatibility with consumers importing from wu-helpers.ports.
export type { IWuStateStore } from './wu-state.ports.js';

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

  /** Get path to initiative YAML file */
  INITIATIVE(id: string): string;

  /** Get path to worktrees directory */
  WORKTREES_DIR(): string;
}
