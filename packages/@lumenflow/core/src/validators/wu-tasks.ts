/**
 * @file wu-tasks.ts
 * @description WU YAML validation helpers (shared by CLI and preflight)
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { WU_PATHS } from '../wu-paths.js';
import { parseYAML } from '../wu-yaml.js';
import { validateWU, validateWUCompleteness } from '../wu-schema.js';
import { FILE_SYSTEM, WU_STATUS } from '../wu-constants.js';

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export interface ValidationSummary {
  totalValid: number;
  totalInvalid: number;
  totalWarnings: number;
  results: Array<{ wuId: string } & ValidationResult>;
}

export function validateSingleWU(
  wuPath: string,
  options: { strict?: boolean } = {},
): ValidationResult {
  const { strict = false } = options;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!existsSync(wuPath)) {
    errors.push(`WU file not found: ${wuPath}`);
    return { valid: false, warnings, errors };
  }

  let doc: Record<string, unknown>;
  try {
    const text = readFileSync(wuPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
    doc = parseYAML(text);
  } catch (e) {
    errors.push(`Failed to parse YAML: ${(e as Error).message}`);
    return { valid: false, warnings, errors };
  }

  const schemaResult = validateWU(doc);
  if (!schemaResult.success) {
    const schemaErrors = schemaResult.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    errors.push(...schemaErrors);
    return { valid: false, warnings, errors };
  }

  const completenessResult = validateWUCompleteness(schemaResult.data);
  warnings.push(...completenessResult.warnings);

  if (strict && warnings.length > 0) {
    errors.push(...warnings.map((w) => `[STRICT] ${w}`));
    return { valid: false, warnings: [], errors };
  }

  return { valid: true, warnings, errors };
}

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

    if (doneOnly) {
      try {
        const text = readFileSync(wuPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
        const doc = parseYAML(text);
        if ((doc as { status?: string }).status !== WU_STATUS.DONE) {
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
