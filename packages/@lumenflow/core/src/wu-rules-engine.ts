// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import {
  RULE_CODES,
  type ValidationIssue,
  validateWURulesSync,
  validateWURulesWithResolvers,
  type ValidationPhase,
  type WUValidationContextInput,
  type WUValidationResult,
} from './wu-rules-core.js';
import { createDefaultWURuleResolvers } from './wu-rules-resolvers.js';

export * from './wu-rules-core.js';
export {
  pathReferenceExistsSync,
  pathReferenceExists,
  resolveBaseRef,
  resolveChangedFiles,
  resolveCliBinDiff,
  createDefaultWURuleResolvers,
} from './wu-rules-resolvers.js';

export interface NormalizedValidationIssue {
  code: string;
  type: string;
  severity: 'error' | 'warning';
  wuId?: string;
  message: string;
  suggestion: string;
  details: string[];
}

export interface NormalizeValidationIssueOptions {
  wuId?: string;
  typeByCode?: Record<string, string>;
}

function extractValidationIssueDetails(issue: ValidationIssue): string[] {
  if (!issue.metadata || typeof issue.metadata !== 'object') {
    return [];
  }

  const metadata = issue.metadata as Record<string, unknown>;
  const details: string[] = [];

  const missingCodePaths = metadata.missingCodePaths;
  if (Array.isArray(missingCodePaths) && missingCodePaths.length > 0) {
    details.push(...missingCodePaths.map((entry) => `  - ${entry}`));
  }

  const missingTestPaths = metadata.missingTestPaths;
  if (Array.isArray(missingTestPaths) && missingTestPaths.length > 0) {
    details.push(...missingTestPaths.map((entry) => `  - ${entry}`));
  }

  if (issue.code === RULE_CODES.CODE_PATH_COVERAGE) {
    const changedFiles = metadata.changedFiles;
    if (Array.isArray(changedFiles)) {
      details.push('Changed files considered:');
      if (changedFiles.length === 0) {
        details.push('  - (none)');
      } else {
        details.push(...changedFiles.map((entry) => `  - ${entry}`));
      }
    }
  }

  return details;
}

export function normalizeValidationIssue(
  issue: ValidationIssue,
  options: NormalizeValidationIssueOptions = {},
): NormalizedValidationIssue {
  const mappedType = options.typeByCode?.[issue.code] ?? issue.code;

  return {
    code: issue.code,
    type: mappedType,
    severity: issue.severity,
    wuId: options.wuId,
    message: issue.message,
    suggestion: issue.suggestion,
    details: extractValidationIssueDetails(issue),
  };
}

export function validationIssueToDisplayLines(issue: ValidationIssue): string[] {
  const normalized = normalizeValidationIssue(issue);
  return [normalized.message, ...normalized.details];
}

/**
 * Backward-compatible facade for the shared WU rules engine.
 *
 * Reality-phase validation is resolved via explicit git/fs adapters
 * from wu-rules-resolvers so rule evaluation in wu-rules-core stays pure.
 */
export async function validateWURules(
  input: WUValidationContextInput,
  options: { phase?: ValidationPhase } = {},
): Promise<WUValidationResult> {
  return validateWURulesWithResolvers(input, options, createDefaultWURuleResolvers());
}

export { validateWURulesSync };
