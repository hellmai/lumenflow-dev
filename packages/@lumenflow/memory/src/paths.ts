// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Memory Package Path Constants
 *
 * Re-export selected canonical constants from @lumenflow/core/wu-constants.
 * This avoids local literal drift while preserving a memory-local surface area.
 */

import { LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';

/**
 * Path constants for LumenFlow memory layer.
 * Duplicated here to avoid circular dependency with @lumenflow/core.
 *
 * Note: Named LUMENFLOW_MEMORY_PATHS to avoid conflict with
 * MEMORY_PATHS exported from mem-init-core.ts
 */
export const LUMENFLOW_MEMORY_PATHS = {
  BASE: LUMENFLOW_PATHS.BASE,
  STATE_DIR: LUMENFLOW_PATHS.STATE_DIR,
  MEMORY_DIR: LUMENFLOW_PATHS.MEMORY_DIR,
  SESSION_CURRENT: LUMENFLOW_PATHS.SESSION_CURRENT,
} as const;
