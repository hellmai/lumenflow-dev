#!/usr/bin/env node
/**
 * WU Preflight Validation
 *
 * WU-1803: Fast validation of code_paths and test paths before gates run.
 * Completes in under 5 seconds vs 2+ minutes for full gates.
 *
 * WU-1180: Migrated from deprecated parseWUArgs to createWUParser for
 * proper Commander --help output and consistency with other WU commands.
 *
 * This catches YAML mismatches early, preventing wasted time running full
 * gates only to fail on code_paths validation at the end of wu:done.
 *
 * Usage:
 *   pnpm wu:preflight --id WU-1803          # Validate from main checkout
 *   pnpm wu:preflight --id WU-1803 --worktree worktrees/operations-gates-wu-1803
 *
 * Validates:
 *   - code_paths files exist
 *   - test file paths exist (unit, e2e, integration)
 *   - WU YAML schema is valid
 */

import { existsSync } from 'node:fs';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { validatePreflight, formatPreflightResult } from '@lumenflow/core/wu-preflight-validators';
import { PATTERNS, EXIT_CODES, LOG_PREFIX, EMOJI } from '@lumenflow/core/wu-constants';
import { defaultWorktreeFrom, WU_PATHS } from '@lumenflow/core/wu-paths';
import { readWURaw } from '@lumenflow/core/wu-yaml';
import { die } from '@lumenflow/core/error-handler';

/**
 * Detect worktree path from WU YAML or calculate from lane
 * @param {string} id - WU ID
 * @returns {string|null} Worktree path or null if not found
 */
function detectWorktreePath(id: string): string | null {
  const wuPath = WU_PATHS.WU(id);

  if (!existsSync(wuPath)) {
    return null;
  }

  try {
    const doc = readWURaw(wuPath);
    const calculatedPath = defaultWorktreeFrom(doc);

    if (calculatedPath && existsSync(calculatedPath)) {
      return calculatedPath;
    }
  } catch {
    // Ignore errors, fall through to return null
  }

  return null;
}

/**
 * Main entry point
 */
async function main() {
  const PREFIX = LOG_PREFIX.PREFLIGHT;

  // WU-1180: Use createWUParser for proper Commander help output
  const args = createWUParser({
    name: 'wu-preflight',
    description:
      'Fast validation of code_paths and test paths before gates run. ' +
      'Completes in under 5 seconds vs 2+ minutes for full gates.',
    options: [WU_OPTIONS.id, WU_OPTIONS.worktree],
    required: ['id'],
    allowPositionalId: true,
  });

  const id = args.id.toUpperCase();
  if (!PATTERNS.WU_ID.test(id)) {
    die(`Invalid WU ID format: ${args.id}. Expected WU-NNN`);
  }

  console.log(`${PREFIX} Preflight Validation for ${id}`);
  console.log(`${PREFIX} ${'='.repeat(30)}\n`);

  // Determine worktree path
  let worktreePath = args.worktree || null;
  if (!worktreePath) {
    worktreePath = detectWorktreePath(id);
    if (worktreePath) {
      console.log(`${PREFIX} ${EMOJI.INFO} Auto-detected worktree: ${worktreePath}`);
    }
  } else {
    console.log(`${PREFIX} ${EMOJI.INFO} Using worktree: ${worktreePath}`);
  }

  // Determine root directory for validation
  const rootDir = worktreePath || process.cwd();

  // Run preflight validation
  const startTime = Date.now();
  const result = await validatePreflight(id, { rootDir, worktreePath });
  const elapsed = Date.now() - startTime;

  // Display results
  console.log('');
  console.log(formatPreflightResult(id, result));
  console.log('');
  console.log(`${PREFIX} Completed in ${elapsed}ms`);

  if (!result.valid) {
    process.exit(EXIT_CODES.ERROR);
  }

  console.log(`${PREFIX} ${EMOJI.SUCCESS} Ready to run gates`);
  process.exit(EXIT_CODES.SUCCESS);
}

// Guard main() for testability
// WU-1071: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  runCLI(main);
}

// Export for testing
export { detectWorktreePath };
