// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file date-utils.ts
 * @description Date formatting utilities using date-fns library
 * WU-1082: Extract shared utilities (eliminate date formatting duplication)
 *
 * Replaces manual date formatting in:
 * - tools/wu-block.ts (todayISO)
 * - tools/wu-unblock.ts (todayISO)
 * - tools/wu-done.ts (todayISO - already uses date-fns)
 */

import { format } from 'date-fns';

/**
 * Get current date in ISO format (YYYY-MM-DD)
 * @returns {string} Current date in YYYY-MM-DD format
 * @example
 * todayISO(); // "2025-11-12"
 */
export function todayISO() {
  return format(new Date(), 'yyyy-MM-dd');
}

/**
 * Format a date with a custom format string
 * @param {Date|string|number} date - Date to format
 * @param {string} formatString - date-fns format string
 * @returns {string} Formatted date string
 * @example
 * formatDate(new Date(), 'yyyy-MM-dd HH:mm:ss');
 * formatDate('2025-11-12', 'MMMM d, yyyy'); // "November 12, 2025"
 */
export function formatDate(date: Date | string | number, formatString: string) {
  return format(new Date(date), formatString);
}

/**
 * Date format constant for YYYY-MM-DD
 * @constant {string}
 */
const DATE_FORMAT_ISO = 'yyyy-MM-dd';

/**
 * Normalize a Date object or ISO timestamp string to YYYY-MM-DD format
 *
 * WU-1442: Fix date corruption when js-yaml parses YYYY-MM-DD as Date objects
 * Library-First: Uses date-fns for date formatting (no manual parsing)
 *
 * Use case: js-yaml parses `created: 2025-12-04` (unquoted) as a Date object.
 * When yaml.dump() serializes it back, it outputs `2025-12-04T00:00:00.000Z`.
 * This function normalizes Date objects back to YYYY-MM-DD string format.
 *
 * Handles:
 * - Date objects → YYYY-MM-DD string
 * - ISO timestamp strings → YYYY-MM-DD string (date portion)
 * - YYYY-MM-DD strings → preserved as-is
 * - undefined/null → preserved as undefined
 *
 * @param {Date|string|undefined|null} value - Date value to normalize
 * @returns {string|undefined} Date in YYYY-MM-DD format or undefined
 *
 * @example
 * normalizeToDateString(new Date('2025-12-04')); // '2025-12-04'
 * normalizeToDateString('2025-12-04T00:00:00.000Z'); // '2025-12-04'
 * normalizeToDateString('2025-12-04'); // '2025-12-04'
 * normalizeToDateString(undefined); // undefined
 */
export function normalizeToDateString(value: unknown) {
  // Preserve undefined/null
  if (value == null) {
    return undefined;
  }

  // If already a YYYY-MM-DD string, return as-is
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  // Convert Date objects or timestamp strings to YYYY-MM-DD
  if (value instanceof Date) {
    return format(value, DATE_FORMAT_ISO);
  }

  // Handle ISO timestamp strings (e.g., '2025-12-04T00:00:00.000Z')
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return format(new Date(value), DATE_FORMAT_ISO);
  }

  // Fallback: try to parse and format (coerce to string for Date constructor)
  try {
    const date = new Date(String(value));
    if (!isNaN(date.getTime())) {
      return format(date, DATE_FORMAT_ISO);
    }
  } catch {
    // Invalid date - return undefined
  }

  return undefined;
}

/**
 * Normalize various date formats to ISO 8601 datetime (YYYY-MM-DDTHH:mm:ss.sssZ)
 *
 * WU-1337: Auto-repair date fields in WU YAML to consistent format
 * Library-First: Uses date-fns for date handling (no manual parsing)
 *
 * Handles:
 * - ISO date strings (YYYY-MM-DD) → midnight UTC
 * - ISO datetime strings (already valid) → preserved
 * - Unix timestamps (milliseconds) → converted
 * - undefined/null → preserved as undefined
 *
 * @param {string|number|undefined|null} value - Date value to normalize
 * @returns {string|undefined} ISO datetime string or undefined
 *
 * @example
 * normalizeISODateTime('2025-11-29'); // '2025-11-29T00:00:00.000Z'
 * normalizeISODateTime('2025-11-29T14:30:00.000Z'); // '2025-11-29T14:30:00.000Z'
 * normalizeISODateTime(1732896000000); // '2024-11-29T16:00:00.000Z'
 * normalizeISODateTime(undefined); // undefined
 */
export function normalizeISODateTime(value: string | number | null | undefined) {
  // Preserve undefined/null (optional fields)
  if (value == null) {
    return undefined;
  }

  // If already a valid ISO datetime format, preserve it
  // Pattern: YYYY-MM-DDTHH:mm:ss.sssZ
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return value;
  }

  // Handle Unix timestamps as strings (convert to number first)
  let dateInput = value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    // Numeric string - treat as Unix timestamp in milliseconds
    dateInput = Number(value);
  }

  // Parse and convert to ISO datetime
  // date-fns/Date handles: ISO dates, ISO datetimes, Unix timestamps
  const date = new Date(dateInput);

  // Check for invalid date
  if (isNaN(date.getTime())) {
    // Fallback: return undefined for unparseable dates
    // Zod schema will catch invalid dates separately
    return undefined;
  }

  // Convert to ISO 8601 datetime format
  return date.toISOString();
}
