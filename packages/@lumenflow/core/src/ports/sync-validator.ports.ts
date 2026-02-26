// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Sync Validator Port Interfaces
 *
 * Canonical git adapter contract for main-branch sync validation helpers.
 *
 * @module ports/sync-validator
 */

import type { IGitAdapter } from './git-validator.ports.js';

/**
 * Canonical git adapter shape for sync validation operations.
 */
export interface ISyncValidatorGitAdapter {
  fetch: IGitAdapter['fetch'];
  getCommitHash: IGitAdapter['getCommitHash'];
  revList: IGitAdapter['revList'];
}

/**
 * WU-2208: Git adapter shape for remote-aware WU ID generation.
 *
 * Extends the sync validator contract with tree listing and file content
 * retrieval at a specific git ref (e.g., origin/main). Designed to
 * accommodate future cloud `allocateWuId()` by keeping the interface
 * narrow and async.
 */
export interface IWuIdGitAdapter {
  /** Fetch remote refs (e.g., origin main). */
  fetch: IGitAdapter['fetch'];

  /**
   * List file/directory names at a given ref and tree path.
   *
   * Equivalent to: git ls-tree --name-only <ref> <path>/
   * Returns an array of filenames (not full paths) within the directory.
   * Returns empty array if the path does not exist at the given ref.
   *
   * @param ref - Git ref (e.g., 'origin/main')
   * @param path - Directory path relative to repo root (e.g., 'docs/04-operations/tasks/wu')
   * @returns Array of filenames in the directory at the given ref
   */
  listTreeAtRef(ref: string, path: string): Promise<string[]>;

  /**
   * Show a file's content at a given ref.
   *
   * Equivalent to: git show <ref>:<path>
   * Returns empty string if the file does not exist at the given ref.
   *
   * @param ref - Git ref (e.g., 'origin/main')
   * @param path - File path relative to repo root
   * @returns File content as string, or empty string if not found
   */
  showFileAtRef(ref: string, path: string): Promise<string>;
}
