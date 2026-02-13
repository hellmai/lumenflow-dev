/**
 * @file wu-create-validation.ts
 * @description Validation logic for wu:create command (WU-1651)
 *
 * Extracted from wu-create.ts to isolate spec validation, strict mode checks,
 * and field-level error aggregation into a focused module.
 */

import { todayISO } from '@lumenflow/core/date-utils';
import { hasSpecRefs } from '@lumenflow/core/wu-create-validators';
import { WU_TYPES } from '@lumenflow/core/wu-constants';
import { validateWU } from '@lumenflow/core/wu-schema';
import { validateSpecCompleteness } from '@lumenflow/core/wu-done-validators';
import {
  validateCodePathsExistence,
  validateTestPathsExistence,
} from '@lumenflow/core/wu-preflight-validators';
import { validateNoPlaceholders, buildPlaceholderErrorMessage } from '@lumenflow/core/wu-validator';
import { isCodeFile } from '@lumenflow/core/manual-test-validator';
import { isDocsOrProcessType, hasManualTests } from '@lumenflow/core/wu-type-helpers';
import { buildWUContent } from './wu-create-content.js';

/** Log prefix for console output */
const LOG_PREFIX = '[wu:create]';

/** Default WU type */
const DEFAULT_TYPE = WU_TYPES.FEATURE;

/** Options for creating WU YAML */
export interface CreateWUOptions {
  initiative?: string;
  phase?: string;
  blockedBy?: string[];
  blocks?: string[];
  labels?: string[];
  assignedTo?: string;
  description?: string;
  acceptance?: string[];
  notes?: string;
  codePaths?: string[];
  testPathsManual?: string[];
  testPathsUnit?: string[];
  testPathsE2e?: string[];
  exposure?: string;
  userJourney?: string;
  uiPairingWus?: string[];
  specRefs?: string[];
  // WU-1329: Strict validation flag
  strict?: boolean;
}

export function containsCodeFiles(codePaths: string[] | undefined): boolean {
  if (!codePaths || codePaths.length === 0) return false;
  return codePaths.some((p) => isCodeFile(p));
}

export function hasAnyItems(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Validate WU spec for creation
 *
 * WU-1329: Strict mode (default) validates that code_paths and test_paths exist on disk.
 * Use opts.strict = false to bypass path existence checks.
 *
 * @param params - Validation parameters
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateCreateSpec({
  id,
  lane,
  title,
  priority,
  type,
  opts,
}: {
  id: string;
  lane: string;
  title: string;
  priority: string;
  type: string;
  opts: CreateWUOptions;
}) {
  const errors = [];
  const effectiveType = type || DEFAULT_TYPE;
  // WU-1329: Strict mode is the default
  const strict = opts.strict !== false;

  // WU-1329: Log when strict validation is bypassed
  if (!strict) {
    console.warn(
      `${LOG_PREFIX} WARNING: strict validation bypassed (--no-strict). Path existence checks skipped.`,
    );
  }

  if (!opts.description) {
    errors.push('--description is required');
  }

  if (!opts.acceptance || opts.acceptance.length === 0) {
    errors.push('--acceptance is required (repeatable)');
  }

  if (!opts.exposure) {
    errors.push('--exposure is required');
  }

  const hasTestPaths =
    hasAnyItems(opts.testPathsManual) ||
    hasAnyItems(opts.testPathsUnit) ||
    hasAnyItems(opts.testPathsE2e);
  const hasManualTestPaths = hasManualTests({ manual: opts.testPathsManual });

  if (!isDocsOrProcessType(effectiveType)) {
    const codePaths = opts.codePaths ?? [];
    if (codePaths.length === 0) {
      errors.push('--code-paths is required for non-documentation WUs');
    }

    // WU-1443: Plan-first WUs may not know tests yet.
    // Allow auto-manual stub ONLY when code_paths does not include code files.
    const canAutoAddManualTests =
      !hasTestPaths && codePaths.length > 0 && !containsCodeFiles(codePaths);
    if (!hasTestPaths && !canAutoAddManualTests) {
      errors.push(
        'At least one test path flag is required (--test-paths-manual, --test-paths-unit, or --test-paths-e2e)',
      );
    }

    if (!hasManualTestPaths && !canAutoAddManualTests) {
      errors.push('--test-paths-manual is required for non-documentation WUs');
    }
  }

  if (effectiveType === WU_TYPES.FEATURE && !hasSpecRefs(opts.specRefs)) {
    errors.push(
      '--spec-refs is required for type: feature WUs\n' +
        '    Tip: Create a plan first with: pnpm plan:create --id <WU-ID> --title "..."\n' +
        '    Then use --plan flag or --spec-refs lumenflow://plans/<WU-ID>-plan.md',
    );
  }

  // WU-1530: Single-pass validation -- collect all errors before returning.
  // Always build WU content and run all validation stages, even when early fields are missing.
  // buildWUContent handles undefined gracefully; Zod catches missing required fields.

  // Stage 2b: Placeholder check (only meaningful if fields exist)
  if (opts.description && opts.acceptance && opts.acceptance.length > 0) {
    const placeholderResult = validateNoPlaceholders({
      description: opts.description,
      acceptance: opts.acceptance,
    });

    if (!placeholderResult.valid) {
      errors.push(buildPlaceholderErrorMessage('wu:create', placeholderResult));
    }
  }

  // Stage 2c-2d: Schema + completeness -- always run to catch enum/format errors
  // even when required fields are missing (Zod reports both)
  const today = todayISO();
  const wuContent = buildWUContent({
    id,
    lane,
    title,
    priority,
    type: effectiveType,
    created: today,
    opts,
  });

  const schemaResult = validateWU(wuContent);
  if (!schemaResult.success) {
    // Deduplicate: skip schema errors already covered by field-level checks above
    const fieldErrorFields = new Set(['description', 'acceptance', 'code_paths', 'tests']);
    const schemaErrors = schemaResult.error.issues
      .filter((issue) => !fieldErrorFields.has(issue.path[0] as string) || errors.length === 0)
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    errors.push(...schemaErrors);
  }

  // Only run completeness if schema passed (it depends on well-formed data)
  if (schemaResult.success) {
    const completeness = validateSpecCompleteness(wuContent, id);
    if (!completeness.valid) {
      errors.push(...completeness.errors);
    }
  }

  // Stage 2e: Strict mode validates path existence
  if (strict) {
    const rootDir = process.cwd();

    if (opts.codePaths && opts.codePaths.length > 0) {
      const codePathsResult = validateCodePathsExistence(opts.codePaths, rootDir);
      if (!codePathsResult.valid) {
        errors.push(...codePathsResult.errors);
      }
    }

    const testsObj = {
      unit: opts.testPathsUnit || [],
      e2e: opts.testPathsE2e || [],
    };
    const testPathsResult = validateTestPathsExistence(testsObj, rootDir);
    if (!testPathsResult.valid) {
      errors.push(...testPathsResult.errors);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}
