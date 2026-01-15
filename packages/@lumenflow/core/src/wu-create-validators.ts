/**
 * WU Create Validators (WU-2107)
 *
 * Validation helpers for wu:create, including lane inference surfacing.
 *
 * When agents create WUs, this module helps surface lane inference suggestions
 * to guide better lane selection and improve parallelization.
 *
 * NOTE: This is domain-specific WU workflow code, not a general utility.
 * No external library exists for LumenFlow lane inference validation.
 */

/** Confidence threshold for showing suggestion (percentage) */
const CONFIDENCE_THRESHOLD_LOW = 30;

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
export function generateLaneMismatchWarning(providedLane, inferredLane, confidence) {
  // Normalize lanes for comparison (handle parent-only vs sub-lane)
  const normalizedProvided = providedLane.trim();
  const normalizedInferred = inferredLane.trim();

  // If lanes match exactly, no warning needed
  if (normalizedProvided === normalizedInferred) {
    return '';
  }

  // Check if provided is parent-only and inferred is a sub-lane of that parent
  const inferredParent = normalizedInferred.split(':')[0].trim();
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
function formatWarningMessage(suggestedLane, confidence, isSubLaneSuggestion) {
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
export function validateLaneWithInference(providedLane, codePaths, description, inferSubLane) {
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
