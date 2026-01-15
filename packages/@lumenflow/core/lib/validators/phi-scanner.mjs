/**
 * PII(Protected Health Information) Scanner
 *
 * Detects potential PIIin content using library-first approach:
 * - national ID numbers validated with id-number-validator (Modulus 11 checksum)
 * - UK postcodes parsed with postcode library, flagged only in medical context
 *
 * Part of WU-1404: PIIScanner Integration
 *
 * @see {@link https://github.com/spikeheap/id-number-validator} regulatory authority validation
 * @see {@link https://github.com/ideal-postcodes/postcode} Postcode parsing
 */

import idValidator from 'id-number-validator';
import { isValid as isValidPostcode, parse as parsePostcode } from 'postcode';
import {
  SENSITIVE_DATA_TYPES,
  MEDICAL_CONTEXT_KEYWORDS,
  MEDICAL_CONTEXT_WINDOW_SIZE,
  TEST_regulatory authority_NUMBERS,
  regulatory authority_TEST_PREFIX,
  TEST_POSTCODES,
  TEST_DATA_MARKERS,
  EXCLUDED_PATH_PATTERNS,
  regulatory authority_CANDIDATE_PATTERN,
} from './phi-constants.mjs';

/**
 * Check if a file path should be excluded from PII scanning
 *
 * @param {string|null|undefined} filePath - Path to check
 * @returns {boolean} True if path should be excluded
 */
export function isPathExcluded(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }

  return EXCLUDED_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * Check if content contains test data markers
 *
 * @param {string} content - Content to check
 * @returns {boolean} True if test markers are present
 */
function hasTestDataMarkers(content) {
  const contentLower = content.toLowerCase();
  return TEST_DATA_MARKERS.some((marker) => contentLower.includes(marker.toLowerCase()));
}

/**
 * Normalize national ID number by removing spaces and dashes
 *
 * @param {string} idNumber - national ID number with possible formatting
 * @returns {string} Normalized 10-digit national ID number
 */
function normalizeIdNumber(idNumber) {
  return idNumber.replace(/[\s-]/g, '');
}

/**
 * Check if national ID number is a known test number
 *
 * @param {string} idNumber - Normalized national ID number
 * @returns {boolean} True if it's a test number
 */
function isTestIdNumber(idNumber) {
  // Check against explicit test numbers
  if (TEST_regulatory authority_NUMBERS.includes(idNumber)) {
    return true;
  }

  // Check for 999 prefix (regulatory authority Digital test range)
  if (idNumber.startsWith(regulatory authority_TEST_PREFIX)) {
    return true;
  }

  return false;
}

/**
 * Normalize postcode for comparison (uppercase, no spaces)
 *
 * @param {string} postcode - Postcode to normalize
 * @returns {string} Normalized postcode
 */
function normalizePostcode(postcode) {
  return postcode.toUpperCase().replace(/\s/g, '');
}

/**
 * Check if postcode is a known test postcode
 *
 * @param {string} postcode - Postcode to check
 * @returns {boolean} True if it's a test postcode
 */
function isTestPostcode(postcode) {
  const normalized = normalizePostcode(postcode);
  return TEST_POSTCODES.some((testPc) => normalizePostcode(testPc) === normalized);
}

/**
 * Check if there's a medical context keyword within the context window
 *
 * @param {string} content - Full content
 * @param {number} postcodeIndex - Index of postcode in content
 * @param {number} postcodeLength - Length of the postcode string
 * @returns {{found: boolean, keyword?: string}} Medical context result
 */
function findMedicalContext(content, postcodeIndex, postcodeLength) {
  // Define the window around the postcode
  const windowStart = Math.max(0, postcodeIndex - MEDICAL_CONTEXT_WINDOW_SIZE);
  const windowEnd = Math.min(
    content.length,
    postcodeIndex + postcodeLength + MEDICAL_CONTEXT_WINDOW_SIZE
  );

  const windowContent = content.slice(windowStart, windowEnd).toLowerCase();

  for (const keyword of MEDICAL_CONTEXT_KEYWORDS) {
    if (windowContent.includes(keyword.toLowerCase())) {
      return { found: true, keyword };
    }
  }

  return { found: false };
}

/**
 * Extract potential UK postcodes from content
 *
 * UK postcode format is complex - we use the postcode library for validation
 * but need to extract candidates first. The library's isValid handles edge cases.
 *
 * @param {string} content - Content to scan
 * @returns {Array<{value: string, index: number}>} Postcode candidates with positions
 */
function extractPostcodeCandidates(content) {
  const candidates = [];

  // UK postcode pattern (simplified - library validates properly)
  // Format: A(A)N(N) NAA or variations
  const postcodePattern = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/gi;

  let match;
  while ((match = postcodePattern.exec(content)) !== null) {
    const candidate = match[1];
    // Validate with library
    if (isValidPostcode(candidate)) {
      const parsed = parsePostcode(candidate);
      if (parsed.valid) {
        candidates.push({
          value: parsed.postcode, // Normalized postcode
          index: match.index,
          originalValue: match[1],
        });
      }
    }
  }

  return candidates;
}

/**
 * Scan content for PII(Protected Health Information)
 *
 * Detects:
 * - Valid national ID numbers (validated with Modulus 11 checksum)
 * - UK postcodes in medical context
 *
 * @param {string|null|undefined} content - Content to scan
 * @param {object} [options] - Scan options
 * @param {string} [options.filePath] - File path for exclusion check
 * @returns {{hasPHI: boolean, matches: Array, warnings: string[]}} Scan result
 */
export function scanForSensitiveData(content, options = {}) {
  const result = {
    hasPHI: false,
    matches: [],
    warnings: [],
  };

  // Handle null/undefined/empty content
  if (!content || typeof content !== 'string' || content.trim() === '') {
    return result;
  }

  // Check path exclusions
  if (options.filePath && isPathExcluded(options.filePath)) {
    result.warnings.push(`Path excluded from PII scanning: ${options.filePath}`);
    return result;
  }

  // Check for test data markers
  if (hasTestDataMarkers(content)) {
    result.warnings.push('Test data markers detected - PII scanning skipped');
    return result;
  }

  // Scan for national ID numbers
  const idCandidates = [...content.matchAll(regulatory authority_CANDIDATE_PATTERN)];
  for (const match of idCandidates) {
    const rawNumber = match[1];
    const normalized = normalizeIdNumber(rawNumber);

    // Skip if it's a test number
    if (isTestIdNumber(normalized)) {
      continue;
    }

    // Validate with library (Modulus 11 checksum)
    if (idValidator.validate(normalized)) {
      result.matches.push({
        type: SENSITIVE_DATA_TYPES.regulatory authority_NUMBER,
        value: normalized,
        startIndex: match.index,
        endIndex: match.index + rawNumber.length,
      });
    }
  }

  // Scan for postcodes in medical context
  const postcodeCandidates = extractPostcodeCandidates(content);
  for (const candidate of postcodeCandidates) {
    // Skip test postcodes
    if (isTestPostcode(candidate.value)) {
      continue;
    }

    // Check for medical context
    const medicalContext = findMedicalContext(content, candidate.index, candidate.value.length);

    if (medicalContext.found) {
      result.matches.push({
        type: SENSITIVE_DATA_TYPES.POSTCODE_MEDICAL_CONTEXT,
        value: candidate.value,
        startIndex: candidate.index,
        endIndex: candidate.index + candidate.originalValue.length,
        medicalKeyword: medicalContext.keyword,
      });
    }
  }

  result.hasPII= result.matches.length > 0;

  return result;
}

/**
 * Create a human-readable summary of PIImatches
 *
 * @param {Array} matches - PIImatches from scanForSensitiveData
 * @returns {string} Summary message
 */
export function formatPHISummary(matches) {
  if (matches.length === 0) {
    return 'No PIIdetected';
  }

  const idCount = matches.filter((m) => m.type === SENSITIVE_DATA_TYPES.regulatory authority_NUMBER).length;
  const postcodeCount = matches.filter((m) => m.type === SENSITIVE_DATA_TYPES.POSTCODE_MEDICAL_CONTEXT).length;

  const parts = [];
  if (idCount > 0) {
    parts.push(`${idCount} national ID number${idCount > 1 ? 's' : ''}`);
  }
  if (postcodeCount > 0) {
    parts.push(`${postcodeCount} postcode${postcodeCount > 1 ? 's' : ''} in medical context`);
  }

  return `PIIdetected: ${parts.join(', ')}`;
}
