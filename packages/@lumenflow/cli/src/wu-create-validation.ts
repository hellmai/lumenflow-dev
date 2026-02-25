// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-create-validation.ts
 * @description Validation logic for wu:create command (WU-1651)
 *
 * Extracted from wu-create.ts to isolate spec validation, strict mode checks,
 * and field-level error aggregation into a focused module.
 */

import { todayISO } from '@lumenflow/core/date-utils';
import type { ZodIssue } from 'zod';
import { hasSpecRefs } from '@lumenflow/core/wu-create-validators';
import { WU_TYPES } from '@lumenflow/core/wu-constants';
import { validateWU } from '@lumenflow/core/wu-schema';
import { validateSpecCompleteness } from '@lumenflow/core/wu-done-validators';
import { validateWURulesSync } from '@lumenflow/core/wu-rules-engine';
import { validateNoPlaceholders, buildPlaceholderErrorMessage } from '@lumenflow/core/wu-validator';
import { isCodeFile } from '@lumenflow/core/manual-test-validator';
import { isDocsOrProcessType } from '@lumenflow/core/wu-type-helpers';
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
  // WU-1683: First-class plan field
  plan?: string;
  // WU-1329: Strict validation flag
  strict?: boolean;
  // WU-2155: Optional sizing estimate for advisory warnings
  sizingEstimate?: {
    estimated_files: number;
    estimated_tool_calls: number;
    strategy: string;
    exception_type?: string;
    exception_reason?: string;
  };
}

export function containsCodeFiles(codePaths: string[] | undefined): boolean {
  if (!codePaths || codePaths.length === 0) return false;
  return codePaths.some((filePath) => isCodeFile(filePath));
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
  // WU-1329: Strict mode flag retained for backwards compatibility in CLI UX.
  // Reality checks now run in wu:prep/wu:done; create/edit enforce intent only.
  const strict = opts.strict !== false;

  // Keep advisory log for callers that explicitly opt out.
  if (!strict) {
    console.warn(
      `${LOG_PREFIX} WARNING: strict validation bypassed (--no-strict). ` +
        `Reality-phase checks run at wu:prep/wu:done.`,
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

  if (!isDocsOrProcessType(effectiveType)) {
    const codePaths = opts.codePaths ?? [];
    if (codePaths.length === 0) {
      errors.push('--code-paths is required for non-documentation WUs');
    }
  }

  // WU-1755: --plan flag auto-generates a spec-ref at wu-create.ts:419 via mergeSpecRefs(),
  // so skip this validation when --plan is provided (the ref will exist by the time YAML is written).
  if (effectiveType === WU_TYPES.FEATURE && !hasSpecRefs(opts.specRefs) && !opts.plan) {
    errors.push(
      '--spec-refs is required for type: feature WUs\n' +
        '    Tip: Use --plan to auto-create a plan (recommended for greenfield projects)\n' +
        '    Or: --spec-refs lumenflow://plans/<WU-ID>-plan.md',
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
      .filter(
        (issue: ZodIssue) => !fieldErrorFields.has(issue.path[0] as string) || errors.length === 0,
      )
      .map((issue: ZodIssue) => `${issue.path.join('.')}: ${issue.message}`);
    errors.push(...schemaErrors);
  }

  // Only run completeness if schema passed (it depends on well-formed data)
  if (schemaResult.success) {
    const intentRules = validateWURulesSync(
      {
        id,
        type: effectiveType,
        status: 'ready',
        code_paths: wuContent.code_paths,
        tests: wuContent.tests,
      },
      { phase: 'intent' },
    );
    errors.push(...intentRules.errors.map((issue) => issue.message));

    const completeness = validateSpecCompleteness(wuContent, id);
    if (!completeness.valid) {
      errors.push(...completeness.errors);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}
