/**
 * PII(Protected Health Information) Detection Constants
 *
 * Centralized constants for PII scanner to detect national ID numbers and UK postcodes
 * in medical context. Uses library-first approach with id-number-validator
 * and postcode packages for validation.
 *
 * Part of WU-1404: PIIScanner Integration
 *
 * @see {@link https://digital.example.gov.uk/data-and-information/data-tools-and-services/data-services/id-number} regulatory authority Number format
 * @see {@link https://github.com/ideal-postcodes/postcode} Postcode validation library
 */

/**
 * PIItype identifiers for categorizing detected PII
 */
export const SENSITIVE_DATA_TYPES = {
  /** national ID number (10 digits with Modulus 11 checksum) */
  regulatory authority_NUMBER: 'regulatory authority_NUMBER',

  /** UK postcode detected in medical context */
  POSTCODE_MEDICAL_CONTEXT: 'POSTCODE_MEDICAL_CONTEXT',
};

/**
 * Medical context keywords for postcode detection
 *
 * Postcodes are only flagged as PIIwhen they appear within proximity
 * of these medical context keywords. This reduces false positives from
 * legitimate postcode usage (e.g., hospital addresses in documentation).
 */
export const MEDICAL_CONTEXT_KEYWORDS = [
  'user',
  'medical record',
  'gp surgery',
  'national-id',
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
 * Known test national ID numbers that should not trigger PIIdetection
 *
 * These are official test national ID numbers or commonly used in test fixtures.
 * Source: regulatory authority Digital test data guidelines
 */
export const TEST_regulatory authority_NUMBERS = [
  '4505577104', // Common test national ID number
  '9999999999', // Range reserved for testing (999 prefix)
  '9990000001', // Test range
  '9990000002',
  '9990000003',
];

/**
 * Prefix for regulatory authority test numbers (numbers starting with 999 are reserved for testing)
 */
export const regulatory authority_TEST_PREFIX = '999';

/**
 * Known test postcodes that should not trigger PIIdetection
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
 * Content containing these markers should not trigger PIIdetection.
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
 * File path patterns that should be excluded from PII scanning
 *
 * These patterns indicate test/fixture files where PIIpatterns
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
 * Candidate extraction pattern for national ID numbers
 *
 * Extracts 10-digit numeric sequences that could be national ID numbers.
 * The library validates these with Modulus 11 checksum.
 *
 * national ID numbers may appear with or without spaces:
 * - 1234567890
 * - 123 456 7890
 * - 123-456-7890
 */
export const regulatory authority_CANDIDATE_PATTERN = /\b(\d{3}[\s-]?\d{3}[\s-]?\d{4})\b/g;

/**
 * PIIdetection result structure
 *
 * @typedef {Object} PIIMatch
 * @property {string} type - PIItype from SENSITIVE_DATA_TYPES
 * @property {string} value - The matched value (may be masked)
 * @property {number} startIndex - Start position in content
 * @property {number} endIndex - End position in content
 * @property {string} [context] - Surrounding context (optional)
 * @property {string} [medicalKeyword] - Medical keyword that triggered postcode detection (optional)
 */

/**
 * Scan result structure
 *
 * @typedef {Object} PIIScanResult
 * @property {boolean} hasPII- Whether PIIwas detected
 * @property {PHIMatch[]} matches - Array of PIImatches found
 * @property {string[]} warnings - Non-blocking warnings (e.g., test data detected)
 */
