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
