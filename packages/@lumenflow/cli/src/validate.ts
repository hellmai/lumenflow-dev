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

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WU_PATHS } from '@lumenflow/core/dist/wu-paths.js';
import { parseYAML } from '@lumenflow/core/dist/wu-yaml.js';
import { validateWU, validateWUCompleteness } from '@lumenflow/core/dist/wu-schema.js';
import { FILE_SYSTEM, EMOJI, PATTERNS } from '@lumenflow/core/dist/wu-constants.js';

const LOG_PREFIX = '[validate]';

/**
 * Validation result for a single WU
 */
export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Validation summary for multiple WUs
 */
export interface ValidationSummary {
  totalValid: number;
  totalInvalid: number;
  totalWarnings: number;
  results: Array<{ wuId: string } & ValidationResult>;
}

/**
 * Validate a single WU file
 *
 * @param wuPath - Path to WU YAML file
 * @param options - Validation options
 * @returns Validation result
 */
export function validateSingleWU(
  wuPath: string,
  options: { strict?: boolean } = {},
): ValidationResult {
  const { strict = false } = options;
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check file exists
  if (!existsSync(wuPath)) {
    errors.push(`WU file not found: ${wuPath}`);
    return { valid: false, warnings, errors };
  }

  // Read and parse YAML
  let doc: Record<string, unknown>;
  try {
    const text = readFileSync(wuPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
    doc = parseYAML(text);
  } catch (e) {
    errors.push(`Failed to parse YAML: ${e.message}`);
    return { valid: false, warnings, errors };
  }

  // Schema validation
  const schemaResult = validateWU(doc);
  if (!schemaResult.success) {
    const schemaErrors = schemaResult.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    errors.push(...schemaErrors);
    return { valid: false, warnings, errors };
  }

  // Completeness validation (soft warnings)
  const completenessResult = validateWUCompleteness(schemaResult.data);
  warnings.push(...completenessResult.warnings);

  // In strict mode, warnings become errors
  if (strict && warnings.length > 0) {
    errors.push(...warnings.map((w) => `[STRICT] ${w}`));
    return { valid: false, warnings: [], errors };
  }

  return { valid: true, warnings, errors };
}

/**
 * Validate all WU files in the WU directory
 *
 * @param options - Validation options
 * @returns Summary of all validations
 */
export function validateAllWUs(
  options: { strict?: boolean; doneOnly?: boolean } = {},
): ValidationSummary {
  const { strict = false, doneOnly = false } = options;
  const wuDir = WU_PATHS.WU_DIR();

  if (!existsSync(wuDir)) {
    return {
      totalValid: 0,
      totalInvalid: 1,
      totalWarnings: 0,
      results: [
        {
          wuId: 'DIRECTORY',
          valid: false,
          warnings: [],
          errors: [`WU directory not found: ${wuDir}`],
        },
      ],
    };
  }

  const files = readdirSync(wuDir).filter((f) => f.endsWith('.yaml'));
  const results: Array<{ wuId: string } & ValidationResult> = [];
  let totalValid = 0;
  let totalInvalid = 0;
  let totalWarnings = 0;

  for (const file of files) {
    const wuPath = `${wuDir}/${file}`;
    const wuId = file.replace('.yaml', '');

    // Skip if only validating done WUs
    if (doneOnly) {
      try {
        const text = readFileSync(wuPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
        const doc = parseYAML(text);
        if (doc.status !== 'done') {
          continue;
        }
      } catch {
        // If we can't read, still validate to catch the error
      }
    }

    const result = validateSingleWU(wuPath, { strict });
    results.push({ wuId, ...result });

    if (result.valid) {
      totalValid++;
      totalWarnings += result.warnings.length;
    } else {
      totalInvalid++;
    }
  }

  return { totalValid, totalInvalid, totalWarnings, results };
}

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

// Guard main() for testability
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`${LOG_PREFIX} Unexpected error:`, error);
    process.exit(1);
  });
}
