/**
 * Stamp File Utilities
 *
 * Centralized stamp file operations (create, validate)
 * Eliminates magic string for stamp body template
 *
 * WU-2242: Added format validation for corrupted stamp detection
 *
 * Stamp files (.lumenflow/stamps/WU-{id}.done) serve as completion markers
 * Used by wu:done, wu:recovery, and validation tools
 */

import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { parse, isValid } from 'date-fns';
import { WU_PATHS } from './wu-paths.js';
import { todayISO } from './date-utils.js';

/**
 * Stamp format error types (WU-2242)
 * @readonly
 * @enum {string}
 */
export const STAMP_FORMAT_ERRORS = Object.freeze({
  /** Stamp file is empty or contains only whitespace */
  EMPTY_FILE: 'EMPTY_FILE',
  /** Missing WU identifier line (format: WU WU-123 (em dash) Title) */
  MISSING_WU_LINE: 'MISSING_WU_LINE',
  /** Missing Completed: YYYY-MM-DD line */
  MISSING_COMPLETED_LINE: 'MISSING_COMPLETED_LINE',
  /** Date is not in valid YYYY-MM-DD format or is invalid */
  INVALID_DATE_FORMAT: 'INVALID_DATE_FORMAT',
  /** WU ID in stamp does not match expected ID */
  WU_ID_MISMATCH: 'WU_ID_MISMATCH',
});

/**
 * Valid date regex: YYYY-MM-DD format (for format checking before parsing)
 * @type {RegExp}
 */
const DATE_FORMAT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate that a date string is a valid ISO date (YYYY-MM-DD)
 *
 * WU-1006: Uses date-fns parse() and isValid() instead of manual parseInt parsing
 * Library-First principle: leverage well-known libraries over brittle custom code
 *
 * @param {string} dateStr - Date string in YYYY-MM-DD format
 * @returns {boolean} True if date is valid
 */
export function isValidDateString(dateStr: string): boolean {
  // Quick format check - must be YYYY-MM-DD pattern
  if (!dateStr || !DATE_FORMAT_PATTERN.test(dateStr)) {
    return false;
  }

  // Parse with date-fns and validate the result
  // parse() with strict format ensures proper date validation
  const parsed = parse(dateStr, 'yyyy-MM-dd', new Date());
  return isValid(parsed);
}

// Internal alias for backward compatibility
const isValidDate = isValidDateString;

/**
 * Stamp file body template (eliminates magic string)
 * Single source of truth for stamp format
 */
const STAMP_TEMPLATE = (id: string, title: string, timestamp: string): string =>
  `WU ${id} — ${title}\nCompleted: ${timestamp}\n`;

interface CreateStampParams {
  id: string;
  title: string;
}

interface CreateStampResult {
  created: boolean;
  path: string;
  reason?: 'already_exists';
}

/**
 * Create stamp file (idempotent - safe to call multiple times)
 *
 * @param {object} params - Parameters
 * @param {string} params.id - WU ID (e.g., 'WU-123')
 * @param {string} params.title - WU title
 * @returns {object} Result { created: boolean, path: string, reason?: string }
 */
export function createStamp({ id, title }: CreateStampParams): CreateStampResult {
  const stampsDir = WU_PATHS.STAMPS_DIR();
  const stampPath = WU_PATHS.STAMP(id);

  // Ensure stamps directory exists
  if (!existsSync(stampsDir)) {
    mkdirSync(stampsDir, { recursive: true });
  }

  // Idempotent: skip if stamp already exists
  if (existsSync(stampPath)) {
    return { created: false, path: stampPath, reason: 'already_exists' };
  }

  // Create stamp file
  const body = STAMP_TEMPLATE(id, title, todayISO());
  writeFileSync(stampPath, body, { encoding: 'utf-8' });

  return { created: true, path: stampPath };
}

/**
 * Validate stamp exists
 *
 * @param {string} stampPath - Path to stamp file
 * @returns {boolean} True if stamp exists
 */
export function validateStamp(stampPath: string): boolean {
  return existsSync(stampPath);
}

/**
 * Get stamp path using WU_PATHS (consistent with codebase)
 *
 * @param {string} id - WU ID
 * @returns {string} Absolute path to stamp file
 */
export function getStampPath(id: string): string {
  return WU_PATHS.STAMP(id);
}

/**
 * Validate WU line in stamp content
 * Checks for format: "WU WU-123 (em dash) Title"
 * @param {string[]} lines - Stamp file lines
 * @param {string} expectedWuId - Expected WU ID
 * @returns {string|null} Error type or null if valid
 */
function validateWuLine(lines: string[], expectedWuId: string): string | null {
  const wuLine = lines.find((line: string) => line.startsWith('WU '));
  if (!wuLine) {
    return STAMP_FORMAT_ERRORS.MISSING_WU_LINE;
  }

  const wuIdMatch = wuLine.match(/^WU (WU-\d+)/);
  if (!wuIdMatch) {
    return STAMP_FORMAT_ERRORS.MISSING_WU_LINE;
  }
  const wuId = wuIdMatch[1];
  if (!wuId) {
    return STAMP_FORMAT_ERRORS.MISSING_WU_LINE;
  }

  if (wuId !== expectedWuId) {
    return STAMP_FORMAT_ERRORS.WU_ID_MISMATCH;
  }

  return null;
}

/**
 * Validate Completed line in stamp content
 * @param {string[]} lines - Stamp file lines
 * @returns {string|null} Error type or null if valid
 */
function validateCompletedLine(lines: string[]): string | null {
  const completedLine = lines.find((line: string) => line.startsWith('Completed:'));
  if (!completedLine) {
    return STAMP_FORMAT_ERRORS.MISSING_COMPLETED_LINE;
  }

  const dateMatch = completedLine.match(/^Completed:\s*(.+)/);
  if (!dateMatch) {
    return STAMP_FORMAT_ERRORS.MISSING_COMPLETED_LINE;
  }

  const dateStr = dateMatch[1]?.trim();
  if (!dateStr) {
    return STAMP_FORMAT_ERRORS.MISSING_COMPLETED_LINE;
  }
  if (!isValidDate(dateStr)) {
    return STAMP_FORMAT_ERRORS.INVALID_DATE_FORMAT;
  }

  return null;
}

/**
 * Validate stamp file format (WU-2242)
 *
 * Expected format:
 * ```
 * WU WU-123 (em dash) Title here
 * Completed: 2025-12-31
 * ```
 *
 * @param {string} wuId - WU ID (e.g., 'WU-123')
 * @param {string} [projectRoot=process.cwd()] - Project root directory
 * @returns {Promise<{valid: boolean, errors: string[], missing?: boolean}>}
 */
export async function validateStampFormat(
  wuId: string,
  projectRoot = process.cwd(),
): Promise<{ valid: boolean; errors: string[]; missing?: boolean }> {
  const stampPath = path.join(projectRoot, WU_PATHS.STAMP(wuId));

  // Check if stamp file exists
  try {
    await access(stampPath, constants.R_OK);
  } catch {
    return { valid: false, errors: [], missing: true };
  }

  // Read stamp content
  let content: string;
  try {
    content = await readFile(stampPath, { encoding: 'utf-8' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, errors: [`Failed to read stamp: ${message}`] };
  }

  // Check for empty file
  if (content.trim() === '') {
    return { valid: false, errors: [STAMP_FORMAT_ERRORS.EMPTY_FILE] };
  }

  const lines = content.split('\n');
  const errors: string[] = [];

  // Validate WU line
  const wuLineError = validateWuLine(lines, wuId);
  if (wuLineError) {
    errors.push(wuLineError);
  }

  // Validate Completed line
  const completedError = validateCompletedLine(lines);
  if (completedError) {
    errors.push(completedError);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Parsed stamp metadata
 */
interface StampMetadata {
  wuId?: string;
  title?: string;
  completedDate?: string;
}

/**
 * Parse stamp content to extract metadata
 *
 * @param {string} content - Stamp file content
 * @returns {StampMetadata}
 */
export function parseStampContent(content: string): StampMetadata {
  const result: StampMetadata = {};
  const lines = content.split('\n');

  // Parse WU line
  const wuLine = lines.find((line) => line.startsWith('WU '));
  if (wuLine) {
    const match = wuLine.match(/^WU (WU-\d+)\s*[—-]\s*(.+)/);
    if (match) {
      const wuId = match[1];
      const title = match[2];
      if (wuId) {
        result.wuId = wuId;
      }
      if (title) {
        result.title = title.trim();
      }
    }
  }

  // Parse Completed line
  const completedLine = lines.find((line) => line.startsWith('Completed:'));
  if (completedLine) {
    const match = completedLine.match(/^Completed:\s*(.+)/);
    if (match) {
      const completedDate = match[1];
      if (completedDate) {
        result.completedDate = completedDate.trim();
      }
    }
  }

  return result;
}
