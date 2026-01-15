/**
 * PHI (Protected Health Information) Detection Constants
 *
 * Centralized constants for PHI scanner to detect NHS numbers and UK postcodes
 * in medical context. Uses library-first approach with nhs-number-validator
 * and postcode packages for validation.
 *
 * Part of WU-1404: PHI Scanner Integration
 *
 * @see {@link https://digital.nhs.uk/data-and-information/data-tools-and-services/data-services/nhs-number} NHS Number format
 * @see {@link https://github.com/ideal-postcodes/postcode} Postcode validation library
 */

/**
 * PHI type identifiers for categorizing detected PHI
 */
export const PHI_TYPES = {
  /** NHS number (10 digits with Modulus 11 checksum) */
  NHS_NUMBER: 'NHS_NUMBER',

  /** UK postcode detected in medical context */
  POSTCODE_MEDICAL_CONTEXT: 'POSTCODE_MEDICAL_CONTEXT',
};

/**
 * Medical context keywords for postcode detection
 *
 * Postcodes are only flagged as PHI when they appear within proximity
 * of these medical context keywords. This reduces false positives from
 * legitimate postcode usage (e.g., hospital addresses in documentation).
 */
export const MEDICAL_CONTEXT_KEYWORDS = [
  'patient',
  'medical record',
  'gp surgery',
  'nhs',
  'hospital',
  'clinic',
  'registered address',
  'home address',
  'next of kin',
  'emergency contact',
  'admission',
  'discharge',
  'referral',
  'diagnosis',
  'treatment',
];

/**
 * Context window size for medical keyword proximity detection
 *
 * When a postcode is found, we search this many characters before
 * and after the postcode for medical context keywords.
 */
export const MEDICAL_CONTEXT_WINDOW_SIZE = 100;

/**
 * Known test NHS numbers that should not trigger PHI detection
 *
 * These are official test NHS numbers or commonly used in test fixtures.
 * Source: NHS Digital test data guidelines
 */
export const TEST_NHS_NUMBERS = [
  '4505577104', // Common test NHS number
  '9999999999', // Range reserved for testing (999 prefix)
  '9990000001', // Test range
  '9990000002',
  '9990000003',
];

/**
 * Prefix for NHS test numbers (numbers starting with 999 are reserved for testing)
 */
export const NHS_TEST_PREFIX = '999';

/**
 * Known test postcodes that should not trigger PHI detection
 *
 * These are commonly used in examples, documentation, and test fixtures.
 */
export const TEST_POSTCODES = [
  'SW1A 1AA', // Buckingham Palace - often used in examples
  'SW1A1AA', // Same without space
  'EC1A 1BB', // Commonly used test postcode
  'EC1A1BB',
  'W1A 1AA', // BBC Broadcasting House - frequently in docs
  'W1A1AA',
];

/**
 * Content markers that indicate test/example data
 *
 * Content containing these markers should not trigger PHI detection.
 */
export const TEST_DATA_MARKERS = [
  '[TEST]',
  '[EXAMPLE]',
  '[PLACEHOLDER]',
  '[SAMPLE]',
  '// test data',
  '/* test data */',
  '# test data',
  'test-data',
  'testData',
  'TEST_DATA',
  'example-data',
  'sample-data',
  'mock-data',
  'fixture',
];

/**
 * File path patterns that should be excluded from PHI scanning
 *
 * These patterns indicate test/fixture files where PHI patterns
 * may legitimately appear for testing purposes.
 */
export const EXCLUDED_PATH_PATTERNS = [
  /\/__tests__\//i,
  /\/test\//i,
  /\/tests\//i,
  /\.test\./i,
  /\.spec\./i,
  /\/fixtures?\//i,
  /\/mocks?\//i,
  /\/__mocks__\//i,
  /\/VCR\/cassettes\//i,
  /\.md$/i, // Documentation files have different risk profile
];

/**
 * Candidate extraction pattern for NHS numbers
 *
 * Extracts 10-digit numeric sequences that could be NHS numbers.
 * The library validates these with Modulus 11 checksum.
 *
 * NHS numbers may appear with or without spaces:
 * - 1234567890
 * - 123 456 7890
 * - 123-456-7890
 */
export const NHS_CANDIDATE_PATTERN = /\b(\d{3}[\s-]?\d{3}[\s-]?\d{4})\b/g;

/**
 * PHI detection result structure
 *
 * @typedef {Object} PHIMatch
 * @property {string} type - PHI type from PHI_TYPES
 * @property {string} value - The matched value (may be masked)
 * @property {number} startIndex - Start position in content
 * @property {number} endIndex - End position in content
 * @property {string} [context] - Surrounding context (optional)
 * @property {string} [medicalKeyword] - Medical keyword that triggered postcode detection (optional)
 */

/**
 * Scan result structure
 *
 * @typedef {Object} PHIScanResult
 * @property {boolean} hasPHI - Whether PHI was detected
 * @property {PHIMatch[]} matches - Array of PHI matches found
 * @property {string[]} warnings - Non-blocking warnings (e.g., test data detected)
 */
