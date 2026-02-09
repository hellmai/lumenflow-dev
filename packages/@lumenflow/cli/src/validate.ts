#!/usr/bin/env node
/**
 * @file validate.ts
 * @description Main WU YAML validator CLI (WU-1111)
 *
 * Validates WU tasks and status consistency. This is the replacement for
 * tools/validate.js that was previously a stub.
 *
 * Usage:
 *   validate                     # Validate all WUs
 *   validate --id WU-123         # Validate specific WU
 *   validate --strict            # Fail on warnings too
 *   validate --done-only         # Only validate done WUs
 *
 * Exit codes:
 *   0 - All validations passed
 *   1 - Validation errors found
 *
 * @see {@link wu-validate.ts} - Detailed WU validation with schema
 * @see {@link docs/04-operations/_frameworks/lumenflow/lumenflow-complete.md} - WU lifecycle
 */

import {
  validateSingleWU,
  validateAllWUs,
  type ValidationResult,
  type ValidationSummary,
} from '@lumenflow/core/validators/wu-tasks';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { EMOJI, PATTERNS } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';

const LOG_PREFIX = '[validate]';

export type { ValidationResult, ValidationSummary };
export { validateSingleWU, validateAllWUs };

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  let wuId: string | undefined;
  let strict = false;
  let doneOnly = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--id' || arg === '--wu') {
      wuId = args[++i];
    } else if (arg === '--strict' || arg === '-s') {
      strict = true;
    } else if (arg === '--done-only') {
      doneOnly = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: validate [options]

Validate WU YAML files for schema and quality.

Options:
  --id, --wu WU-XXX  Validate specific WU
  --strict, -s       Fail on warnings too
  --done-only        Only validate done WUs
  -h, --help         Show this help message

Examples:
  validate                     # Validate all WUs
  validate --id WU-123         # Validate specific WU
  validate --strict            # Strict mode
`);
      process.exit(0);
    } else if (PATTERNS.WU_ID.test(arg.toUpperCase())) {
      wuId = arg.toUpperCase();
    }
  }

  if (wuId) {
    // Validate single WU
    wuId = wuId.toUpperCase();
    if (!PATTERNS.WU_ID.test(wuId)) {
      console.error(`${LOG_PREFIX} Invalid WU ID: ${wuId}`);
      process.exit(1);
    }

    const wuPath = WU_PATHS.WU(wuId);
    console.log(`${LOG_PREFIX} Validating ${wuId}...`);

    const result = validateSingleWU(wuPath, { strict });

    if (result.errors.length > 0) {
      console.log(`${EMOJI.FAILURE} Validation failed:`);
      result.errors.forEach((e) => console.log(`  ${e}`));
      process.exit(1);
    }

    if (result.warnings.length > 0) {
      console.log(`${EMOJI.WARNING} Validation passed with warnings:`);
      result.warnings.forEach((w) => console.log(`  ${w}`));
    } else {
      console.log(`${EMOJI.SUCCESS} ${wuId} is valid`);
    }
  } else {
    // Validate all WUs
    console.log(`${LOG_PREFIX} Validating all WUs${doneOnly ? ' (done only)' : ''}...`);

    const { totalValid, totalInvalid, totalWarnings, results } = validateAllWUs({
      strict,
      doneOnly,
    });

    // Print results
    for (const result of results) {
      if (result.errors.length > 0) {
        console.log(`${EMOJI.FAILURE} ${result.wuId}:`);
        result.errors.forEach((e) => console.log(`    ${e}`));
      } else if (result.warnings.length > 0) {
        console.log(`${EMOJI.WARNING} ${result.wuId}: ${result.warnings.length} warning(s)`);
        if (process.env.VERBOSE) {
          result.warnings.forEach((w) => console.log(`    ${w}`));
        }
      }
    }

    console.log('');
    console.log(`${LOG_PREFIX} Summary:`);
    console.log(`  ${EMOJI.SUCCESS} Valid: ${totalValid}`);
    console.log(`  ${EMOJI.FAILURE} Invalid: ${totalInvalid}`);
    console.log(`  ${EMOJI.WARNING} Warnings: ${totalWarnings}`);

    if (totalInvalid > 0) {
      process.exit(1);
    }
  }
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  runCLI(main);
}
