// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { readFile, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { UTF8_ENCODING } from '../shared-constants.js';

/**
 * Reads a file and returns its content as a string.
 * Returns an empty string when the file does not exist (ENOENT).
 * Rethrows all other errors.
 */
export async function readFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, UTF8_ENCODING);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

/**
 * Returns the fs.Stats for a path, or null when the path does not exist (ENOENT).
 * Rethrows all other errors.
 */
export async function statOrNull(filePath: string): Promise<Stats | null> {
  try {
    return await stat(filePath);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
