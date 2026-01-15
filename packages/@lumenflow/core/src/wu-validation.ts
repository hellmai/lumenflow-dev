/**
 * WU Exposure Validation (WU-1999, WU-2022)
 *
 * WU-1999: Validates exposure field and UI pairing for wu:done.
 *          Provides warnings (not errors) to guide completion without blocking.
 *
 * WU-2022: Adds BLOCKING validation for feature accessibility.
 *          When exposure=ui, ensures the feature is actually accessible via navigation.
 *
 * Part of INIT-031 Phase 4: Prevent backend-without-UI pattern.
 *
 * @see {@link tools/wu-done.mjs} - Consumer
 * @see {@link tools/lib/wu-schema.mjs} - WU schema with exposure field
 * @see {@link tools/lib/wu-constants.mjs} - WU_EXPOSURE values
 */

import { WU_EXPOSURE } from './wu-constants.js';

/**
 * UI verification keywords to search for in acceptance criteria.
 * Case-insensitive patterns that indicate the acceptance criteria
 * mentions UI verification.
 */
const UI_VERIFICATION_KEYWORDS = [
  'ui',
  'frontend',
  'component',
  'widget',
  'page',
  'displays',
  'shows',
  'renders',
  'user sees',
  'visible',
  'screen',
  'interface',
];

/**
 * Warning message templates with remediation guidance.
 * All messages include the WU ID for context.
 */
export const EXPOSURE_WARNING_MESSAGES = {
  /**
   * Warning when exposure field is missing entirely.
   * @param {string} wuId - The WU identifier
   * @returns {string} Warning message with remediation
   */
  MISSING_EXPOSURE: (wuId) =>
    `${wuId}: exposure field is missing. ` +
    `Add 'exposure: ui|api|backend-only|documentation' to the WU YAML. ` +
    `This helps ensure user-facing features have corresponding UI coverage.`,

  /**
   * Warning when API exposure lacks UI pairing WUs.
   * @param {string} wuId - The WU identifier
   * @returns {string} Warning message with remediation
   */
  MISSING_UI_PAIRING: (wuId) =>
    `${wuId}: exposure=api but ui_pairing_wus not specified. ` +
    `Add 'ui_pairing_wus: [WU-XXX]' listing UI WUs that consume this API, ` +
    `or set exposure to 'backend-only' if no UI is planned.`,

  /**
   * Warning when API exposure lacks UI verification in acceptance criteria.
   * @param {string} wuId - The WU identifier
   * @returns {string} Warning message with remediation
   */
  MISSING_UI_VERIFICATION: (wuId) =>
    `${wuId}: exposure=api but acceptance criteria lacks UI verification mention. ` +
    `Consider adding a criterion like 'UI displays the data correctly' to ensure end-to-end coverage.`,

  /**
   * Recommendation for user_journey when exposure is UI.
   * @param {string} wuId - The WU identifier
   * @returns {string} Warning message with remediation
   */
  MISSING_USER_JOURNEY: (wuId) =>
    `${wuId}: exposure=ui but user_journey field not present. ` +
    `Adding 'user_journey: "<description>"' is recommended to document the user flow.`,
};

/**
 * Check if acceptance criteria mentions UI verification.
 *
 * Searches acceptance criteria (array or nested object) for keywords
 * that indicate UI verification is mentioned.
 *
 * @param {string[]|Record<string, string[]>} acceptance - Acceptance criteria
 * @returns {boolean} True if UI verification is mentioned
 */
function hasUIVerificationInAcceptance(acceptance) {
  // Flatten acceptance to array of strings
  let criteria = [];
  if (Array.isArray(acceptance)) {
    criteria = acceptance;
  } else if (typeof acceptance === 'object' && acceptance !== null) {
    // Nested object format: { category: [items] }
    criteria = Object.values(acceptance).flat();
  }

  // Search for UI-related keywords (case-insensitive)
  const lowerCriteria = criteria.map((c) => (typeof c === 'string' ? c.toLowerCase() : ''));

  return lowerCriteria.some((criterion) =>
    UI_VERIFICATION_KEYWORDS.some((keyword) => criterion.includes(keyword.toLowerCase()))
  );
}

/**
 * Validate exposure field and UI pairing for a WU.
 *
 * This is a non-blocking validation that returns warnings, not errors.
 * Use during wu:done to guide completion without preventing it.
 *
 * Checks:
 * 1. exposure field is present (warns if missing)
 * 2. If exposure=api, warns if no ui_pairing_wus specified
 * 3. If exposure=api, checks acceptance criteria for UI verification mention
 * 4. If exposure=ui, recommends user_journey field if not present
 *
 * @param {object} wu - WU YAML object
 * @param {string} wu.id - WU identifier
 * @param {string} [wu.exposure] - Exposure type (ui, api, backend-only, documentation)
 * @param {string[]} [wu.ui_pairing_wus] - Related UI WU IDs for API exposure
 * @param {string} [wu.user_journey] - User journey description for UI exposure
 * @param {string[]|object} [wu.acceptance] - Acceptance criteria
 * @param {object} [options] - Validation options
 * @param {boolean} [options.skipExposureCheck=false] - Skip all exposure validation
 * @returns {{valid: boolean, warnings: string[]}} Validation result
 */
export function validateExposure(wu, options = {}) {
  const warnings = [];

  // Early return if skip flag is set
  if (options.skipExposureCheck) {
    return { valid: true, warnings: [] };
  }

  const wuId = wu.id || 'WU-???';
  const exposure = wu.exposure;

  // Check 1: exposure field presence
  if (!exposure) {
    warnings.push(EXPOSURE_WARNING_MESSAGES.MISSING_EXPOSURE(wuId));
    // Can't check further without exposure
    return { valid: true, warnings };
  }

  // Check 2 & 3: API exposure checks
  if (exposure === WU_EXPOSURE.API) {
    // Check for ui_pairing_wus
    const uiPairingWus = wu.ui_pairing_wus;
    if (!uiPairingWus || uiPairingWus.length === 0) {
      warnings.push(EXPOSURE_WARNING_MESSAGES.MISSING_UI_PAIRING(wuId));
    }

    // Check acceptance criteria for UI verification mention
    const acceptance = wu.acceptance;
    if (acceptance && !hasUIVerificationInAcceptance(acceptance)) {
      warnings.push(EXPOSURE_WARNING_MESSAGES.MISSING_UI_VERIFICATION(wuId));
    }
  }

  // Check 4: UI exposure checks
  if (exposure === WU_EXPOSURE.UI) {
    // Recommend user_journey if not present
    if (!wu.user_journey) {
      warnings.push(EXPOSURE_WARNING_MESSAGES.MISSING_USER_JOURNEY(wuId));
    }
  }

  // backend-only and documentation exposures: no additional checks

  return { valid: true, warnings };
}

// =============================================================================
// WU-2022: Feature Accessibility Validation (BLOCKING)
// =============================================================================

/**
 * Navigation keywords to search for in tests.manual.
 * Case-insensitive patterns that indicate manual navigation testing.
 */
const NAVIGATION_KEYWORDS = [
  'navigate',
  'navigation',
  'accessible',
  'access',
  'visible',
  'reachable',
  'go to',
  'visit',
  'open',
  'click',
  'link',
  'route',
  'url',
  'path',
  '/space',
  '/dashboard',
  '/settings',
];

/**
 * Pattern to detect Next.js page files in code_paths.
 * Matches: app/.../page.tsx, pages/.../index.tsx, pages/.../*.tsx
 */
const PAGE_FILE_PATTERNS = [
  /app\/.*\/page\.tsx$/,
  /app\/.*\/page\.ts$/,
  /pages\/.*\.tsx$/,
  /pages\/.*\.ts$/,
];

/**
 * Error message templates for accessibility validation (WU-2022).
 * These are BLOCKING errors, not warnings.
 */
export const ACCESSIBILITY_ERROR_MESSAGES = {
  /**
   * Error when UI exposure lacks navigation accessibility proof.
   * @param {string} wuId - The WU identifier
   * @returns {string} Error message with remediation guidance
   */
  UI_NOT_ACCESSIBLE: (wuId) =>
    `${wuId}: exposure=ui but feature accessibility not verified. ` +
    `Add one of the following:\n` +
    `  1. navigation_path: '/your-route' - specify the route where feature is accessible\n` +
    `  2. code_paths: [..., 'apps/web/src/app/.../page.tsx'] - include a page file\n` +
    `  3. tests.manual: ['Navigate to /path and verify feature is accessible'] - add navigation test\n\n` +
    `This prevents "orphaned code" - features that exist but users cannot access. ` +
    `Use --skip-accessibility-check to bypass (not recommended).`,
};

/**
 * Check if code_paths includes a page file (Next.js page).
 *
 * @param {string[]} codePaths - Array of code paths
 * @returns {boolean} True if any code path matches a page file pattern
 */
function hasPageFileInCodePaths(codePaths) {
  if (!codePaths || !Array.isArray(codePaths)) {
    return false;
  }

  return codePaths.some((codePath) =>
    PAGE_FILE_PATTERNS.some((pattern) => pattern.test(codePath))
  );
}

/**
 * Check if tests.manual includes navigation verification.
 *
 * @param {object} tests - Tests object from WU YAML
 * @returns {boolean} True if manual tests mention navigation
 */
function hasNavigationInManualTests(tests) {
  if (!tests || typeof tests !== 'object') {
    return false;
  }

  const manualTests = tests.manual;
  if (!manualTests || !Array.isArray(manualTests)) {
    return false;
  }

  const lowerTests = manualTests.map((t) =>
    typeof t === 'string' ? t.toLowerCase() : ''
  );

  return lowerTests.some((test) =>
    NAVIGATION_KEYWORDS.some((keyword) => test.includes(keyword.toLowerCase()))
  );
}

/**
 * Validate feature accessibility for UI-exposed WUs (WU-2022).
 *
 * This is a BLOCKING validation that returns errors (not warnings).
 * When exposure=ui, the feature must be verifiably accessible.
 *
 * Accessibility is verified by ANY of:
 * 1. navigation_path field is specified (explicit route)
 * 2. code_paths includes a page.tsx file (Next.js page)
 * 3. tests.manual includes navigation/accessibility verification
 *
 * Non-UI exposures (api, backend-only, documentation) pass automatically.
 * Missing exposure field passes (legacy WUs, handled by WU-1999 warning).
 *
 * @param {object} wu - WU YAML object
 * @param {string} wu.id - WU identifier
 * @param {string} [wu.exposure] - Exposure type (ui, api, backend-only, documentation)
 * @param {string} [wu.navigation_path] - Route where UI is accessible
 * @param {string[]} [wu.code_paths] - Files modified by this WU
 * @param {object} [wu.tests] - Test specifications
 * @param {object} [options] - Validation options
 * @param {boolean} [options.skipAccessibilityCheck=false] - Skip all accessibility validation
 * @returns {{valid: boolean, errors: string[]}} Validation result
 */
export function validateFeatureAccessibility(wu, options = {}) {
  const errors = [];

  // Early return if skip flag is set
  if (options.skipAccessibilityCheck) {
    return { valid: true, errors: [] };
  }

  const exposure = wu.exposure;

  // Skip validation for non-UI exposures
  if (!exposure || exposure !== WU_EXPOSURE.UI) {
    return { valid: true, errors: [] };
  }

  // For exposure=ui, verify accessibility via one of three methods
  const wuId = wu.id || 'WU-???';

  // Method 1: navigation_path is specified
  if (wu.navigation_path && wu.navigation_path.trim().length > 0) {
    return { valid: true, errors: [] };
  }

  // Method 2: code_paths includes a page file
  if (hasPageFileInCodePaths(wu.code_paths)) {
    return { valid: true, errors: [] };
  }

  // Method 3: tests.manual includes navigation verification
  if (hasNavigationInManualTests(wu.tests)) {
    return { valid: true, errors: [] };
  }

  // No accessibility proof found - this is a blocking error
  errors.push(ACCESSIBILITY_ERROR_MESSAGES.UI_NOT_ACCESSIBLE(wuId));

  return { valid: false, errors };
}
