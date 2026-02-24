// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Create Validators (WU-2107, WU-1062)
 *
 * Validation helpers for wu:create, including:
 * - Lane inference surfacing (WU-2107)
 * - External spec_refs validation (WU-1062)
 *
 * When agents create WUs, this module helps surface lane inference suggestions
 * to guide better lane selection and improve parallelization.
 *
 * WU-1062: Validates spec_refs paths, accepting both repo-relative paths
 * and external paths (lumenflow://, ~/.lumenflow/, $LUMENFLOW_HOME/).
 *
 * NOTE: This is domain-specific WU workflow code, not a general utility.
 * No external library exists for LumenFlow lane inference validation.
 */

import { isExternalPath, normalizeSpecRef } from './lumenflow-home.js';
import { PATH_LITERALS } from './wu-constants.js';
import { createWuPaths } from './wu-paths.js';
import { getConfig } from './lumenflow-config.js';

/** Confidence threshold for showing suggestion (percentage) */
const CONFIDENCE_THRESHOLD_LOW = 30;

/** Prefixes that indicate repo-internal paths (WU-1069, WU-1430: Use centralized constants) */
const REPO_INTERNAL_PREFIXES = [PATH_LITERALS.CURRENT_DIR_PREFIX, PATH_LITERALS.LUMENFLOW_PREFIX];

/**
 * WU-1069: Check if a path is a repo-internal path that should be rejected
 *
 * Repo-internal paths start with ./ or .lumenflow/ and indicate the agent
 * is attempting to store plans inside the repository instead of externally.
 *
 * @param {string} path - Path to check
 * @returns {boolean} True if path is repo-internal and should be rejected
 */
export function isRepoInternalPath(path: string): boolean {
  return REPO_INTERNAL_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * WU-1069: Build error message for repo-internal path rejection
 *
 * @param {string} path - The rejected path
 * @returns {string} Error message with correct format examples
 */
export function buildRepoInternalPathError(path: string): string {
  return (
    `Rejected repo-internal spec_ref path: "${path}"\n` +
    `Plans must be stored externally, not inside the repository.\n\n` +
    `Valid path formats:\n` +
    `  - lumenflow://plans/WU-XXXX-plan.md (recommended)\n` +
    `  - ~/.lumenflow/plans/WU-XXXX-plan.md\n` +
    `  - $LUMENFLOW_HOME/plans/WU-XXXX-plan.md\n\n` +
    `Use --plan flag to auto-create: pnpm wu:create --plan --id WU-XXXX ...`
  );
}

/**
 * Generate a warning message when provided lane differs from inferred lane.
 *
 * Returns empty string if lanes match (no warning needed).
 *
 * @param {string} providedLane - Lane provided by the user
 * @param {string} inferredLane - Lane suggested by inference
 * @param {number} confidence - Confidence score (0-100)
 * @returns {string} Warning message or empty string if lanes match
 */
export function generateLaneMismatchWarning(
  providedLane: string,
  inferredLane: string,
  confidence: number,
): string {
  // Normalize lanes for comparison (handle parent-only vs sub-lane)
  const normalizedProvided = providedLane.trim();
  const normalizedInferred = inferredLane.trim();

  // If lanes match exactly, no warning needed
  if (normalizedProvided === normalizedInferred) {
    return '';
  }

  // Check if provided is parent-only and inferred is a sub-lane of that parent
  const inferredParent = (normalizedInferred.split(':')[0] ?? normalizedInferred).trim();
  if (normalizedProvided === inferredParent) {
    // User provided parent-only, suggest the specific sub-lane
    return formatWarningMessage(normalizedInferred, confidence, true);
  }

  // Lanes are different, show suggestion
  return formatWarningMessage(normalizedInferred, confidence, false);
}

/**
 * Format the warning message based on confidence level
 *
 * @param {string} suggestedLane - The suggested lane
 * @param {number} confidence - Confidence score (0-100)
 * @param {boolean} isSubLaneSuggestion - True if suggesting sub-lane for parent-only input
 * @returns {string} Formatted warning message
 */
function formatWarningMessage(
  suggestedLane: string,
  confidence: number,
  isSubLaneSuggestion: boolean,
): string {
  const confidenceStr = `${confidence}%`;

  if (confidence < CONFIDENCE_THRESHOLD_LOW) {
    return (
      `Lane suggestion (low confidence ${confidenceStr}): "${suggestedLane}"\n` +
      `Run: pnpm wu:infer-lane --id WU-XXX to verify\n` +
      `See: .lumenflow.lane-inference.yaml for lane taxonomy`
    );
  }

  if (isSubLaneSuggestion) {
    return (
      `Suggested sub-lane (${confidenceStr} confidence): "${suggestedLane}"\n` +
      `Using specific sub-lanes improves parallelization.\n` +
      `Run: pnpm wu:infer-lane --id WU-XXX to verify`
    );
  }

  return (
    `Lane inference suggests: "${suggestedLane}" (${confidenceStr} confidence)\n` +
    `Consider using the inferred lane for better lane distribution.\n` +
    `Run: pnpm wu:infer-lane --id WU-XXX to verify`
  );
}

/**
 * Check if lane validation should show a suggestion
 *
 * @param {string} providedLane - Lane provided by the user
 * @param {string[]} codePaths - Code paths from WU
 * @param {string} description - WU description
 * @param {Function} inferSubLane - Lane inference function
 * @returns {{ shouldWarn: boolean, warning: string }} Validation result
 */
export function validateLaneWithInference(
  providedLane: string,
  codePaths: string[],
  description: string,
  inferSubLane: (codePaths: string[], description: string) => { lane: string; confidence: number },
) {
  // Skip inference if no code paths provided
  if (!codePaths || codePaths.length === 0) {
    return { shouldWarn: false, warning: '' };
  }

  try {
    const { lane: inferredLane, confidence } = inferSubLane(codePaths, description);
    const warning = generateLaneMismatchWarning(providedLane, inferredLane, confidence);

    return {
      shouldWarn: warning.length > 0,
      warning,
      inferredLane,
      confidence,
    };
  } catch {
    // Inference failed, don't block creation
    return { shouldWarn: false, warning: '' };
  }
}

/**
 * WU-1062: Validate spec_refs paths
 *
 * Accepts:
 * - Repo-relative paths: <configured plansDir>/WU-XXX-plan.md
 * - External paths: lumenflow://plans/WU-XXX-plan.md
 * - Tilde paths: ~/.lumenflow/plans/WU-XXX-plan.md
 * - Env var paths: $LUMENFLOW_HOME/plans/WU-XXX-plan.md
 *
 * @param {string[]} specRefs - Array of spec reference paths
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }} Validation result
 */
export function validateSpecRefs(specRefs: string[]): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!specRefs || specRefs.length === 0) {
    return { valid: true, errors, warnings };
  }

  const plansDirHint = `${createWuPaths().PLANS_DIR().replace(/\/+$/, '')}/`;
  const docsDirHint = `${getConfig().directories.docs.replace(/\/+$/, '')}/`;

  for (const ref of specRefs) {
    // Check for empty refs
    if (!ref || ref.trim().length === 0) {
      errors.push('Empty spec_ref detected');
      continue;
    }

    // WU-1069: Reject repo-internal paths (paths starting with ./ or .lumenflow/)
    // This prevents agents from storing plans inside the repository
    if (isRepoInternalPath(ref)) {
      errors.push(buildRepoInternalPathError(ref));
      continue;
    }

    // External paths are valid (will be resolved at runtime)
    if (isExternalPath(ref)) {
      // Add informational warning about external paths
      warnings.push(`External spec_ref: "${ref}" - ensure plan exists at ${normalizeSpecRef(ref)}`);
      continue;
    }

    // Repo-relative paths should follow conventions (<docsDir>/ without ./ prefix)
    const isValidRepoPath =
      ref.startsWith(plansDirHint) || ref.startsWith(docsDirHint) || ref.endsWith('.md');

    if (!isValidRepoPath) {
      warnings.push(
        `Unconventional spec_ref path: "${ref}" - consider using ${plansDirHint} or lumenflow://plans/`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * WU-1062: Check if spec_refs contains external paths
 *
 * @param {string[]} specRefs - Array of spec reference paths
 * @returns {boolean} True if any spec_ref is an external path
 */
export function hasExternalSpecRefs(specRefs: string[]): boolean {
  if (!specRefs || specRefs.length === 0) {
    return false;
  }
  return specRefs.some((ref) => isExternalPath(ref));
}

/**
 * WU-1429: Check if spec_refs is non-empty
 *
 * @param {string[]|undefined} specRefs - Array of spec reference paths
 * @returns {boolean} True if spec_refs contains at least one entry
 */
export function hasSpecRefs(specRefs: string[] | undefined): boolean {
  return Array.isArray(specRefs) && specRefs.length > 0;
}

/**
 * WU-1062: Normalize all spec_refs paths
 *
 * Expands external paths to absolute paths while keeping repo-relative paths unchanged.
 *
 * @param {string[]} specRefs - Array of spec reference paths
 * @returns {string[]} Normalized paths
 */
export function normalizeSpecRefs(specRefs: string[]): string[] {
  if (!specRefs || specRefs.length === 0) {
    return [];
  }
  return specRefs.map((ref) => normalizeSpecRef(ref));
}
