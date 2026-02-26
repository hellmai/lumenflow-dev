// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2014: Main branch sync validation compatibility exports for wu:done.
 *
 * Canonical implementations now live in sync-validator.ts.
 */
import {
  validateMainNotBehindOrigin as validateMainNotBehindOriginCore,
  ensureMainNotBehindOrigin as ensureMainNotBehindOriginCore,
} from './sync-validator.js';
import type {
  EnsureMainNotBehindOriginOptions,
  MainSyncGitAdapter,
} from './sync-validator.js';

export type { EnsureMainNotBehindOriginOptions, MainSyncGitAdapter } from './sync-validator.js';

export function validateMainNotBehindOrigin(gitAdapter: MainSyncGitAdapter) {
  return validateMainNotBehindOriginCore(gitAdapter);
}

export function ensureMainNotBehindOrigin(
  mainCheckoutPath: string,
  wuId: string,
  options: EnsureMainNotBehindOriginOptions = {},
) {
  return ensureMainNotBehindOriginCore(mainCheckoutPath, wuId, options);
}
