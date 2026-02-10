#!/usr/bin/env node
/**
 * WU Validation Tool
 *
 * Validates WU YAML files against schema and checks for quality warnings.
 *
 * WU-1329: Strict mode is now the DEFAULT behavior.
 * - Warnings are treated as errors by default
 * - Use --no-strict to restore legacy advisory-only warnings behavior
 *
 * Usage:
 *   pnpm wu:validate --id WU-123         # Validate with strict mode (default)
 *   pnpm wu:validate --all               # Validate all WUs with strict mode
 *   pnpm wu:validate --all --no-strict   # Warnings are advisory (legacy behavior)
 *
 * @see {@link packages/@lumenflow/cli/src/lib/wu-schema.ts} - Schema definitions
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { parseYAML } from '@lumenflow/core/wu-yaml';
import { die } from '@lumenflow/core/error-handler';
import { validateWU, validateWUCompleteness } from '@lumenflow/core/wu-schema';
import { FILE_SYSTEM, EMOJI, PATTERNS } from '@lumenflow/core/wu-constants';
// WU-2253: Import WU spec linter for acceptance/code_paths validation
import { lintWUSpec } from '@lumenflow/core/wu-lint';
import { validateWuValidateCliArgs } from './shared-validators.js';

const LOG_PREFIX = '[wu:validate]';

export type ValidationResult = {
  wuId: string;
  valid: boolean;
  warnings: string[];
  errors: string[];
};

export type ValidationSummary = {
  valid: boolean;
  totalValid: number;
  totalInvalid: number;
  totalWarnings: number;
  invalid: { wuId: string; errors: string[] }[];
  warnings: { wuId: string; warnings: string[] }[];
};

export function validateWuValidateOptions(id: string | undefined, noStrict: boolean | undefined) {
  return validateWuValidateCliArgs({ id, noStrict });
}

/**
 * Summarize validation results for JSON output.
 */
export function summarizeValidationResults(results: ValidationResult[]): ValidationSummary {
  const totalValid = results.filter((r) => r.valid).length;
  const totalInvalid = results.filter((r) => !r.valid).length;
  const totalWarnings = results.reduce((sum, r) => sum + (r.warnings?.length ?? 0), 0);

  const invalid = results.filter((r) => !r.valid).map((r) => ({ wuId: r.wuId, errors: r.errors }));

  const warnings = results
    .filter((r) => r.warnings && r.warnings.length > 0)
    .map((r) => ({ wuId: r.wuId, warnings: r.warnings }));

  return {
    valid: totalInvalid === 0,
    totalValid,
    totalInvalid,
    totalWarnings,
    invalid,
    warnings,
  };
}

/**
 * Validate a single WU file
 *
 * WU-1329: strict defaults to true (warnings treated as errors)
 *
 * @param {string} wuPath - Path to WU YAML file
 * @param {object} options - Validation options
 * @param {boolean} options.strict - Treat warnings as errors (default: true)
 * @returns {{valid: boolean, warnings: string[], errors: string[]}}
 */
function validateSingleWU(wuPath, { strict = true } = {}) {
  const errors = [];
  const warnings = [];

  // Read and parse YAML
  let doc;
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

  // WU-2253: Run WU spec lint validation
  // Reports errors as warnings by default, errors in --strict mode
  const invariantsPath = path.join(process.cwd(), 'tools/invariants.yml');
  const lintResult = lintWUSpec(schemaResult.data, { invariantsPath });
  if (!lintResult.valid) {
    for (const lintError of lintResult.errors) {
      warnings.push(`[LINT] ${lintError.message}`);
    }
  }

  // In strict mode, warnings become errors
  if (strict && warnings.length > 0) {
    errors.push(...warnings.map((w) => `[STRICT] ${w}`));
    return { valid: false, warnings: [], errors };
  }

  return { valid: true, warnings, errors };
}

/**
 * Validate all WU files
 *
 * WU-1329: strict defaults to true (warnings treated as errors)
 *
 * @param {object} options - Validation options
 * @param {boolean} options.strict - Treat warnings as errors (default: true)
 * @returns {{totalValid: number, totalInvalid: number, totalWarnings: number, results: ValidationResult[]}}
 */
function validateAllWUs({ strict = true } = {}) {
  const wuDir = WU_PATHS.WU_DIR();

  if (!existsSync(wuDir)) {
    die(`WU directory not found: ${wuDir}`);
  }

  const files = readdirSync(wuDir).filter((f) => f.endsWith('.yaml'));
  const results = [];
  let totalValid = 0;
  let totalInvalid = 0;
  let totalWarnings = 0;

  for (const file of files) {
    const wuPath = `${wuDir}/${file}`;
    const result = validateSingleWU(wuPath, { strict });
    const wuId = file.replace('.yaml', '');

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
 * Main entry point
 */

async function main() {
  const args = createWUParser({
    name: 'wu-validate',
    description: 'Validate WU YAML files against schema (strict mode by default, WU-1329)',
    options: [
      WU_OPTIONS.id,
      {
        name: 'all',
        flags: '-a, --all',
        type: 'boolean',
        description: 'Validate all WUs',
      },
      // WU-1329: Change from --strict to --no-strict (strict is now default)
      WU_OPTIONS.noStrict,
      {
        name: 'json',
        flags: '--json',
        type: 'boolean',
        description: 'Output JSON summary only',
      },
    ],
    required: [],
    allowPositionalId: true,
  });

  const { id, all, noStrict, json } = args;

  // WU-1329: Strict mode is the default, --no-strict opts out
  const strict = !noStrict;

  // WU-1329: Log when strict validation is bypassed
  if (noStrict) {
    console.warn(
      `${LOG_PREFIX} WARNING: strict validation bypassed (--no-strict). Warnings will be advisory only.`,
    );
  }

  if (!id && !all) {
    die('Must specify --id WU-XXX or --all');
  }

  if (id && all) {
    die('Cannot specify both --id and --all');
  }

  if (all) {
    // Validate all WUs
    if (!json) {
      console.log(`${LOG_PREFIX} Validating all WU files...`);
    }
    const { results } = validateAllWUs({ strict });
    const summary = summarizeValidationResults(results);

    if (json) {
      console.log(JSON.stringify(summary));
      process.exit(summary.valid ? 0 : 1);
    }

    // Print results
    for (const result of results) {
      if (result.errors.length > 0) {
        console.log(`${EMOJI.FAILURE} ${result.wuId}:`);
        result.errors.forEach((e) => console.log(`    ${e}`));
      } else if (result.warnings.length > 0) {
        console.log(`${EMOJI.WARNING} ${result.wuId}: ${result.warnings.length} warning(s)`);
        result.warnings.forEach((w) => console.log(`    ${w}`));
      }
    }

    console.log('');
    console.log(`${LOG_PREFIX} Summary:`);
    console.log(`  ${EMOJI.SUCCESS} Valid: ${summary.totalValid}`);
    console.log(`  ${EMOJI.FAILURE} Invalid: ${summary.totalInvalid}`);
    console.log(`  ${EMOJI.WARNING} Warnings: ${summary.totalWarnings}`);

    if (!summary.valid) {
      process.exit(1);
    }
  } else {
    const validation = validateWuValidateOptions(id, noStrict);
    if (!validation.valid) {
      die(`Invalid wu:validate arguments:\n  - ${validation.errors.join('\n  - ')}`);
    }

    // Validate single WU
    const wuId = id.toUpperCase();
    if (!PATTERNS.WU_ID.test(wuId)) {
      die(`Invalid WU id '${id}'. Expected format WU-123`);
    }

    const wuPath = WU_PATHS.WU(wuId);
    if (!existsSync(wuPath)) {
      die(`WU file not found: ${wuPath}`);
    }

    if (!json) {
      console.log(`${LOG_PREFIX} Validating ${wuId}...`);
    }
    const result = validateSingleWU(wuPath, { strict });
    const summary = summarizeValidationResults([{ wuId, ...result }]);

    if (json) {
      console.log(JSON.stringify(summary));
      process.exit(summary.valid ? 0 : 1);
    }

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
  }
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}
