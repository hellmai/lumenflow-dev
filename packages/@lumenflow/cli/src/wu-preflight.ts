#!/usr/bin/env node
/**
 * WU Preflight Validation
 *
 * WU-1803: Fast validation of code_paths and test paths before gates run.
 * Completes in under 5 seconds vs 2+ minutes for full gates.
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

import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { parseWUArgs } from '@lumenflow/core/dist/arg-parser.js';
import {
  validatePreflight,
  formatPreflightResult,
} from '@lumenflow/core/dist/wu-preflight-validators.js';
import { PATTERNS, EXIT_CODES, LOG_PREFIX, EMOJI } from '@lumenflow/core/dist/wu-constants.js';
import { defaultWorktreeFrom, WU_PATHS } from '@lumenflow/core/dist/wu-paths.js';
import { readWURaw } from '@lumenflow/core/dist/wu-yaml.js';
/* eslint-disable security/detect-non-literal-fs-filename */

/**
 * Parse command-line arguments
 * @param {string[]} argv - Process arguments
 * @returns {object} Parsed arguments
 */
function parseArgs(argv) {
  const args = parseWUArgs(argv);

  // Handle help
  if (args.help) {
    return { help: true };
  }

  // Validate WU ID
  if (!args.id) {
    return { error: 'Missing required argument: --id WU-XXX' };
  }

  const id = args.id.toUpperCase();
  if (!PATTERNS.WU_ID.test(id)) {
    return { error: `Invalid WU ID format: ${args.id}. Expected WU-NNN` };
  }

  return {
    id,
    worktree: args.worktree || null,
    help: false,
  };
}

/**
 * Display help message
 */
function showHelp() {
  console.log(`
WU Preflight Validation - Fast code_paths and test paths check

Usage:
  pnpm wu:preflight --id WU-XXX [OPTIONS]

Options:
  --id <WU-ID>           WU ID to validate (required)
  --worktree <path>      Worktree path to validate files in (auto-detected if not provided)
  --help, -h             Show this help

Description:
  Validates code_paths and test file paths exist BEFORE running full gates.
  Completes in under 5 seconds vs 2+ minutes for gates.

  This prevents wasting time running full gates only to fail on
  code_paths validation at the end of wu:done.

Checks performed:
  ${EMOJI.SUCCESS} code_paths files exist in worktree/main
  ${EMOJI.SUCCESS} Test file paths exist (unit, e2e, integration)
  ${EMOJI.SUCCESS} WU YAML schema is valid (required fields present)
  ${EMOJI.SUCCESS} Manual tests are skipped (descriptions, not files)

Recommended workflow:
  1. Implement feature/fix
  2. Run: pnpm wu:preflight --id WU-XXX  (fast check)
  3. Run: pnpm gates                      (full validation)
  4. Run: pnpm wu:done --id WU-XXX        (complete WU)

Example:
  pnpm wu:preflight --id WU-1803
  pnpm wu:preflight --id WU-1803 --worktree worktrees/operations-gates-wu-1803
`);
}

/**
 * Detect worktree path from WU YAML or calculate from lane
 * @param {string} id - WU ID
 * @returns {string|null} Worktree path or null if not found
 */
function detectWorktreePath(id) {
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
  const args = parseArgs(process.argv);

  // Handle help
  if (args.help) {
    showHelp();
    process.exit(EXIT_CODES.SUCCESS);
  }

  // Handle parse errors
  if (args.error) {
    console.error(`${PREFIX} ${EMOJI.FAILURE} ${args.error}`);
    console.error(`${PREFIX} Run: pnpm wu:preflight --help for usage`);
    process.exit(EXIT_CODES.ERROR);
  }

  const { id, worktree } = args;

  console.log(`${PREFIX} Preflight Validation for ${id}`);
  console.log(`${PREFIX} ${'='.repeat(30)}\n`);

  // Determine worktree path
  let worktreePath = worktree;
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
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

// Export for testing
export { parseArgs, detectWorktreePath };
