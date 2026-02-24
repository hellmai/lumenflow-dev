#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @file guard-locked.ts
 * @description Guard that prevents changes to locked WUs (WU-1111)
 *
 * Validates that a WU is not locked before allowing modifications.
 * Used by git hooks and wu: commands to enforce workflow discipline.
 *
 * Usage:
 *   guard-locked WU-123        # Check if WU-123 is locked
 *   guard-locked --wu WU-123   # Same with explicit flag
 *
 * Exit codes:
 *   0 - WU is not locked (safe to proceed)
 *   1 - WU is locked (block operation)
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseYAML } from '@lumenflow/core/wu-yaml';
import { WU_PATHS, createWuPaths } from '@lumenflow/core/wu-paths';
import { PATTERNS, FILE_SYSTEM } from '@lumenflow/core/wu-constants';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { runCLI } from './cli-entry-point.js';

const LOG_PREFIX = '[guard-locked]';

function resolveCompleteGuidePathHint(): string {
  try {
    return createWuPaths({ projectRoot: process.cwd() }).COMPLETE_GUIDE_PATH();
  } catch {
    return WU_PATHS.COMPLETE_GUIDE_PATH();
  }
}

/**
 * Check if a WU is locked
 *
 * @param wuPath - Path to WU YAML file
 * @returns true if WU has locked: true, false otherwise
 * @throws Error if WU file does not exist or cannot be parsed
 *
 * @example
 * if (isWULocked('/path/to/WU-123.yaml')) {
 *   console.log('WU is locked, cannot modify');
 * }
 */
export function isWULocked(wuPath: string): boolean {
  if (!existsSync(wuPath)) {
    throw createError(ErrorCodes.FILE_NOT_FOUND, `WU file not found: ${wuPath}`);
  }

  const content = readFileSync(wuPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  const doc = parseYAML(content);

  return doc.locked === true;
}

/**
 * Assert that a WU is not locked
 *
 * @param wuPath - Path to WU YAML file
 * @throws Error if WU is locked, with actionable fix instructions
 *
 * @example
 * try {
 *   assertWUNotLocked('/path/to/WU-123.yaml');
 *   // Safe to modify
 * } catch (error) {
 *   console.error(error.message);
 *   process.exit(1);
 * }
 */
export function assertWUNotLocked(wuPath: string): void {
  if (!existsSync(wuPath)) {
    throw createError(ErrorCodes.FILE_NOT_FOUND, `WU file not found: ${wuPath}`);
  }

  const content = readFileSync(wuPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  const doc = parseYAML(content);

  if (doc.locked === true) {
    const wuId = doc.id || path.basename(wuPath, '.yaml');
    const completeGuidePath = resolveCompleteGuidePathHint();
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      `${LOG_PREFIX} WU ${wuId} is locked.

Locked WUs cannot be modified. This prevents accidental changes to completed work.

If you need to modify this WU:
  1. Check if modification is really necessary (locked WUs are done)
  2. Use wu:unlock to unlock the WU first:
     pnpm wu:unlock --id ${wuId} --reason "reason for unlocking"

For more information:
  See ${completeGuidePath}
`,
    );
  }
}

/**
 * Check if a WU ID is locked by looking up the YAML file
 *
 * @param wuId - WU ID (e.g., "WU-123")
 * @returns true if WU has locked: true, false otherwise
 * @throws Error if WU file does not exist
 */
export function isWUIdLocked(wuId: string): boolean {
  const wuPath = WU_PATHS.WU(wuId);
  return isWULocked(wuPath);
}

/**
 * Assert that a WU ID is not locked
 *
 * @param wuId - WU ID (e.g., "WU-123")
 * @throws Error if WU is locked
 */
export function assertWUIdNotLocked(wuId: string): void {
  const wuPath = WU_PATHS.WU(wuId);
  assertWUNotLocked(wuPath);
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  let wuId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--wu' || arg === '--id') {
      wuId = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: guard-locked [--wu] WU-XXX

Check if a WU is locked. Exits with code 1 if locked.

Options:
  --wu, --id WU-XXX  WU ID to check
  -h, --help         Show this help message

Examples:
  guard-locked WU-123
  guard-locked --wu WU-123
`);
      process.exit(0);
    } else if (PATTERNS.WU_ID.test(arg.toUpperCase())) {
      wuId = arg.toUpperCase();
    }
  }

  if (!wuId) {
    console.error(`${LOG_PREFIX} Error: WU ID required`);
    console.error('Usage: guard-locked [--wu] WU-XXX');
    process.exit(1);
  }

  // Normalize WU ID
  wuId = wuId.toUpperCase();
  if (!PATTERNS.WU_ID.test(wuId)) {
    console.error(`${LOG_PREFIX} Invalid WU ID: ${wuId}`);
    console.error('Expected format: WU-123');
    process.exit(1);
  }

  try {
    if (isWUIdLocked(wuId)) {
      console.error(`${LOG_PREFIX} ${wuId} is locked`);
      console.error('');
      console.error('Locked WUs cannot be modified.');
      console.error(`To unlock: pnpm wu:unlock --id ${wuId} --reason "your reason"`);
      process.exit(1);
    }

    console.log(`${LOG_PREFIX} ${wuId} is not locked (OK)`);
    process.exit(0);
  } catch (error) {
    console.error(`${LOG_PREFIX} Error: ${error.message}`);
    process.exit(1);
  }
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
