// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Repair Service (WU-2013)
 *
 * Corruption recovery for wu-events.jsonl. Removes malformed JSON lines,
 * invalid schema entries, and creates backups before repair.
 *
 * Single responsibility: state file corruption recovery.
 *
 * WU-2240: Atomic write with fsync for durability.
 *
 * @see {@link ./wu-state-store.ts} - Facade that delegates to this service
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
} from 'node:fs';
import path from 'node:path';
import { validateWUEvent } from './wu-state-schema.js';

/**
 * Repair result
 */
export interface RepairResult {
  success: boolean;
  linesKept: number;
  linesRemoved: number;
  backupPath: string | null;
  warnings: string[];
}

/**
 * Repair a corrupted state file by removing invalid lines.
 *
 * WU-2240: Corruption recovery for wu-events.jsonl
 *
 * Features:
 * - Creates backup before repair
 * - Removes malformed JSON lines
 * - Removes lines that fail schema validation
 * - Returns detailed repair statistics
 *
 * @example
 * const stateFilePath = path.join(process.cwd(), '.lumenflow', 'state', 'wu-events.jsonl');
 * const result = await repairStateFile(stateFilePath);
 * if (result.success) {
 *   console.log(`Repaired: kept ${result.linesKept}, removed ${result.linesRemoved}`);
 * }
 */
export async function repairStateFile(filePath: string): Promise<RepairResult> {
  const warnings: string[] = [];
  let linesKept = 0;
  let linesRemoved = 0;

  // Check if file exists
  if (!existsSync(filePath)) {
    return {
      success: true,
      linesKept: 0,
      linesRemoved: 0,
      backupPath: null,
      warnings: ['File does not exist, nothing to repair'],
    };
  }

  // Read the original content
  const originalContent = readFileSync(filePath, 'utf-8');
  const lines = originalContent.split('\n');

  // Create backup with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.backup.${timestamp}`;
  writeFileSync(backupPath, originalContent, 'utf-8');

  // Process each line
  const validLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (typeof rawLine !== 'string') {
      continue;
    }
    const line = rawLine.trim();

    // Skip empty lines
    if (!line) {
      continue;
    }

    // Try to parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      linesRemoved++;
      warnings.push(`Line ${i + 1}: Malformed JSON removed`);
      continue;
    }

    // Validate against schema
    const validation = validateWUEvent(parsed);
    if (!validation.success) {
      linesRemoved++;
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      warnings.push(`Line ${i + 1}: Invalid event removed (${issues})`);
      continue;
    }

    // Line is valid
    validLines.push(line);
    linesKept++;
  }

  // Write repaired file atomically
  const tempPath = `${filePath}.tmp.${process.pid}`;
  const repairedContent = validLines.length > 0 ? `${validLines.join('\n')}\n` : '';

  try {
    const fd = openSync(tempPath, 'w');
    writeFileSync(fd, repairedContent, 'utf-8');
    fsyncSync(fd);
    closeSync(fd);

    // Atomic rename
    renameSync(tempPath, filePath);

    // Fsync directory
    const dirPath = path.dirname(filePath);
    const dirFd = openSync(dirPath, 'r');
    fsyncSync(dirFd);
    closeSync(dirFd);
  } catch (error) {
    // Cleanup temp file on failure
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }

  // Add warning if file is now empty
  if (linesKept === 0 && linesRemoved > 0) {
    warnings.push('All lines were invalid - file is now empty');
  }

  return {
    success: true,
    linesKept,
    linesRemoved,
    backupPath,
    warnings,
  };
}
