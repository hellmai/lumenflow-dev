// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2014: Main branch sync validation compatibility exports for wu:done.
 *
 * Canonical implementations now live in sync-validator.ts.
 */
export { validateMainNotBehindOrigin, ensureMainNotBehindOrigin } from './sync-validator.js';
export type { EnsureMainNotBehindOriginOptions, MainSyncGitAdapter } from './sync-validator.js';
