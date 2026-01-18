#!/usr/bin/env node
/**
 * WU Validation Tool
 *
 * Validates WU YAML files against schema and checks for quality warnings.
 * Returns exit code 0 if valid (warnings are advisory, not blocking).
 * Returns exit code 1 only for schema errors.
 *
 * Usage:
 *   pnpm wu:validate --id WU-123         # Validate specific WU
 *   pnpm wu:validate --all               # Validate all WUs
 *   pnpm wu:validate --all --strict      # Fail on warnings too
 *
 * @see {@link tools/lib/wu-schema.mjs} - Schema definitions
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/dist/arg-parser.js';
import { WU_PATHS } from '@lumenflow/core/dist/wu-paths.js';
import { parseYAML } from '@lumenflow/core/dist/wu-yaml.js';
import { die } from '@lumenflow/core/dist/error-handler.js';
import { validateWU, validateWUCompleteness } from '@lumenflow/core/dist/wu-schema.js';
import { FILE_SYSTEM, EMOJI, PATTERNS } from '@lumenflow/core/dist/wu-constants.js';
// WU-2253: Import WU spec linter for acceptance/code_paths validation
import { lintWUSpec } from '@lumenflow/core/dist/wu-lint.js';

const LOG_PREFIX = '[wu:validate]';

/**
 * Validate a single WU file
 *
 * @param {string} wuPath - Path to WU YAML file
 * @param {object} options - Validation options
 * @param {boolean} options.strict - Treat warnings as errors
 * @returns {{valid: boolean, warnings: string[], errors: string[]}}
 */
function validateSingleWU(wuPath, { strict = false } = {}) {
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
 * @param {object} options - Validation options
 * @param {boolean} options.strict - Treat warnings as errors
 * @returns {{totalValid: number, totalInvalid: number, totalWarnings: number, results: object[]}}
 */
function validateAllWUs({ strict = false } = {}) {
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
// eslint-disable-next-line sonarjs/cognitive-complexity -- Pre-existing complexity, refactor tracked separately
async function main() {
  const args = createWUParser({
    name: 'wu-validate',
    description: 'Validate WU YAML files against schema',
    options: [
      WU_OPTIONS.id,
      {
        name: 'all',
        flags: '-a, --all',
        type: 'boolean',
        description: 'Validate all WUs',
      },
      {
        name: 'strict',
        flags: '-s, --strict',
        type: 'boolean',
        description: 'Treat warnings as errors',
      },
    ],
    required: [],
    allowPositionalId: true,
  });

  const { id, all, strict } = args;

  if (!id && !all) {
    die('Must specify --id WU-XXX or --all');
  }

  if (id && all) {
    die('Cannot specify both --id and --all');
  }

  if (all) {
    // Validate all WUs
    console.log(`${LOG_PREFIX} Validating all WU files...`);
    const { totalValid, totalInvalid, totalWarnings, results } = validateAllWUs({ strict });

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
    console.log(`  ${EMOJI.SUCCESS} Valid: ${totalValid}`);
    console.log(`  ${EMOJI.FAILURE} Invalid: ${totalInvalid}`);
    console.log(`  ${EMOJI.WARNING} Warnings: ${totalWarnings}`);

    if (totalInvalid > 0) {
      process.exit(1);
    }
  } else {
    // Validate single WU
    const wuId = id.toUpperCase();
    if (!PATTERNS.WU_ID.test(wuId)) {
      die(`Invalid WU id '${id}'. Expected format WU-123`);
    }

    const wuPath = WU_PATHS.WU(wuId);
    if (!existsSync(wuPath)) {
      die(`WU file not found: ${wuPath}`);
    }

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
  }
}

// Guard main() for testability
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
