// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Memory FS Utils (WU-1909)
 *
 * Shared filesystem utilities for the memory package.
 * Extracted from duplicated code in mem-checkpoint-core, mem-create-core, and mem-start-core.
 *
 * @module fs-utils
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { LUMENFLOW_MEMORY_PATHS } from './paths.js';

/**
 * Ensures the memory directory exists, creating it recursively if needed.
 *
 * @param baseDir - Base directory containing .lumenflow/
 * @returns Memory directory path (.lumenflow/memory)
 */
export async function ensureMemoryDir(baseDir: string): Promise<string> {
  const memoryDir = path.join(baseDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Known directory path
  await fs.mkdir(memoryDir, { recursive: true });
  return memoryDir;
}
