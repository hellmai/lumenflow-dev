// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { existsSync, readFileSync, writeFileSync, promises as fs } from 'node:fs';
import { parse, stringify } from 'yaml';
import { createError, ErrorCodes, getErrorMessage } from './error-handler.js';
import { STRING_LITERALS } from './wu-constants.js';
import { createWuPaths } from './wu-paths.js';
import { BaseWUSchema } from './wu-schema.js';

/**
 * Unified WU YAML I/O module.
 *
 * Replaces 4 duplicate read/write functions scattered across wu-claim, wu-done,
 * wu-block, and wu-unblock. Single source of truth for WU YAML operations.
 *
 * WU-1352: Standardized on yaml v2.8.1 (eemeli) with consistent stringify options.
 *
 * Functions:
 * - readWU(path, id): Read and validate WU YAML
 * - readWURaw(path): Read YAML without ID validation
 * - parseYAML(text): Parse YAML string to object
 * - writeWU(path, doc): Write WU YAML with consistent formatting
 * - stringifyYAML(doc): Stringify object to YAML with consistent formatting
 * - appendNote(doc, note): Append note to doc.notes field
 *
 * @example
 * import { readWU, writeWU, appendNote } from './lib/wu-yaml.js';
 * import { createWuPaths } from './wu-paths.js';
 *
 * const wuPaths = createWuPaths();
 *
 * // Read WU
 * const doc = readWU(wuPaths.WU('WU-123'), 'WU-123');
 *
 * // Modify doc
 * doc.status = 'in_progress';
 * appendNote(doc, 'Started work on this WU');
 *
 * // Write back
 * writeWU(wuPaths.WU('WU-123'), doc);
 */

/**
 * WU-1352: YAML scalar type constants (from yaml library).
 * These match the string values expected by the yaml package.
 * @see https://github.com/eemeli/yaml/blob/main/docs/03_options.md
 */
const YAML_SCALAR_TYPES = Object.freeze({
  /** Unquoted string (when safe) */
  PLAIN: 'PLAIN',
  /** Single-quoted string */
  QUOTE_SINGLE: 'QUOTE_SINGLE',
  /** Double-quoted string */
  QUOTE_DOUBLE: 'QUOTE_DOUBLE',
  /** Block literal (|) */
  BLOCK_LITERAL: 'BLOCK_LITERAL',
  /** Block folded (>) */
  BLOCK_FOLDED: 'BLOCK_FOLDED',
});

/** Standard line width for WU YAML files */
const YAML_LINE_WIDTH = 100;

/**
 * WU-1352: Standardized YAML stringify options.
 *
 * Ensures consistent output across all WU tools:
 * - lineWidth: 100 (wrap long lines)
 * - singleQuote: true (prefer 'single' over "double")
 * - defaultKeyType: PLAIN (unquoted keys when safe)
 *
 * @type {import('yaml').ToStringOptions}
 */
export const YAML_STRINGIFY_OPTIONS = Object.freeze({
  lineWidth: YAML_LINE_WIDTH,
  singleQuote: true,
  defaultKeyType: YAML_SCALAR_TYPES.PLAIN,
});

/**
 * WU-2125: Parse YAML content string into a validated object.
 *
 * Shared parse boundary for all read functions. Wraps YAML parse errors
 * with structured error codes and path context.
 *
 * @param {string} text - Raw YAML content
 * @param {string} sourcePath - File path (for error messages)
 * @returns {Record<string, unknown>} Parsed document
 * @throws {Error} YAML_PARSE_ERROR if YAML is invalid
 */
function parseWUYaml(text: string, sourcePath: string): Record<string, unknown> {
  try {
    return parse(text) as Record<string, unknown>;
  } catch (e: unknown) {
    const msg = getErrorMessage(e);
    throw createError(ErrorCodes.YAML_PARSE_ERROR, `Failed to parse YAML ${sourcePath}: ${msg}`, {
      path: sourcePath,
      originalError: msg,
    });
  }
}

/**
 * WU-2125: Validate that a parsed WU document's id field matches the expected ID.
 *
 * @param {unknown} doc - Parsed YAML document (may be null for empty files)
 * @param {string} expectedId - Expected WU ID (e.g., 'WU-123')
 * @param {string} wuPath - File path (for error messages)
 * @returns {Record<string, unknown>} Validated document
 * @throws {Error} WU_NOT_FOUND if doc is null or ID does not match
 */
function validateWUId(doc: unknown, expectedId: string, wuPath: string): Record<string, unknown> {
  const parsed = doc as Record<string, unknown> | null;
  if (!parsed || parsed.id !== expectedId) {
    throw createError(
      ErrorCodes.WU_NOT_FOUND,
      `WU YAML id mismatch. Expected ${expectedId}, found ${parsed && parsed.id}`,
      { path: wuPath, expectedId, foundId: parsed && parsed.id },
    );
  }
  return parsed;
}

/**
 * Read and parse WU YAML file.
 *
 * Validates:
 * - File exists
 * - YAML is valid
 * - WU ID matches expected ID
 *
 * @param {string} wuPath - Path to WU YAML file
 * @param {string} expectedId - Expected WU ID (e.g., 'WU-123')
 * @returns {object} Parsed YAML document
 * @throws {Error} If file not found, YAML invalid, or ID mismatch
 */
export function readWU(wuPath: string, expectedId: string): Record<string, unknown> {
  if (!existsSync(wuPath)) {
    throw createError(ErrorCodes.FILE_NOT_FOUND, `WU file not found: ${wuPath}`, {
      path: wuPath,
      expectedId,
    });
  }

  const text = readFileSync(wuPath, { encoding: 'utf-8' });
  const doc = parseWUYaml(text, wuPath);
  return validateWUId(doc, expectedId, wuPath);
}

/**
 * Read and parse WU YAML file asynchronously.
 *
 * Validates:
 * - File exists
 * - YAML is valid
 * - WU ID matches expected ID
 *
 * @param {string} wuPath - Path to WU YAML file
 * @param {string} expectedId - Expected WU ID (e.g., 'WU-123')
 * @returns {Promise<object>} Parsed YAML document
 * @throws {Error} If file not found, YAML invalid, or ID mismatch
 */
export async function readWUAsync(
  wuPath: string,
  expectedId: string,
): Promise<Record<string, unknown>> {
  try {
    const text = await fs.readFile(wuPath, { encoding: 'utf-8' });
    const doc = parseWUYaml(text, wuPath);
    return validateWUId(doc, expectedId, wuPath);
  } catch (err: unknown) {
    const errObj = err as { code?: string };
    if (errObj.code === 'ENOENT') {
      throw createError(ErrorCodes.FILE_NOT_FOUND, `WU file not found: ${wuPath}`, {
        path: wuPath,
        expectedId,
      });
    }
    throw err;
  }
}

/**
 * Parse YAML string to object.
 * WU-1352: Centralized YAML parsing for consistency.
 *
 * @param {string} text - YAML string to parse
 * @returns {object} Parsed object
 * @throws {Error} If YAML is invalid
 */
export function parseYAML(text: string): Record<string, unknown> {
  return parse(text) as Record<string, unknown>;
}

/**
 * Stringify object to YAML with standardized options.
 * WU-1352: Centralized YAML serialization for consistency.
 *
 * @param {object} doc - Object to stringify
 * @param {object} [options] - Additional stringify options (merged with YAML_STRINGIFY_OPTIONS)
 * @returns {string} YAML string
 */
export function stringifyYAML(doc: unknown, options: Record<string, unknown> = {}): string {
  return stringify(doc, { ...YAML_STRINGIFY_OPTIONS, ...options });
}

/**
 * Read and parse YAML file without ID validation.
 * WU-1352: For cases where you don't know/need to validate the WU ID.
 *
 * @param {string} yamlPath - Path to YAML file
 * @returns {object} Parsed YAML document
 * @throws {Error} If file not found or YAML invalid
 */
export function readWURaw(yamlPath: string): Record<string, unknown> {
  if (!existsSync(yamlPath)) {
    throw createError(ErrorCodes.FILE_NOT_FOUND, `YAML file not found: ${yamlPath}`, {
      path: yamlPath,
    });
  }

  const text = readFileSync(yamlPath, { encoding: 'utf-8' });
  return parseWUYaml(text, yamlPath);
}

/**
 * Read and parse YAML file without ID validation asynchronously.
 * WU-1352: For cases where you don't know/need to validate the WU ID.
 *
 * @param {string} yamlPath - Path to YAML file
 * @returns {Promise<object>} Parsed YAML document
 * @throws {Error} If file not found or YAML invalid
 */
export async function readWURawAsync(yamlPath: string): Promise<Record<string, unknown>> {
  try {
    const text = await fs.readFile(yamlPath, { encoding: 'utf-8' });
    return parseWUYaml(text, yamlPath);
  } catch (err: unknown) {
    const errObj = err as { code?: string };
    if (errObj.code === 'ENOENT') {
      throw createError(ErrorCodes.FILE_NOT_FOUND, `YAML file not found: ${yamlPath}`, {
        path: yamlPath,
      });
    }
    throw err;
  }
}

/**
 * Write WU YAML file with consistent formatting.
 * WU-1352: Uses YAML_STRINGIFY_OPTIONS for consistent output.
 * WU-2115: Validates doc against BaseWUSchema before writing to prevent
 * malformed WU YAML from being silently persisted.
 *
 * @param {string} wuPath - Path to WU YAML file
 * @param {object} doc - YAML document to write
 * @throws {ZodError} If doc fails BaseWUSchema validation
 */
export function writeWU(wuPath: string, doc: unknown): void {
  // WU-2115: Validate against schema before writing — throws ZodError on invalid data
  BaseWUSchema.parse(doc);
  const out = stringify(doc, YAML_STRINGIFY_OPTIONS);
  writeFileSync(wuPath, out, { encoding: 'utf-8' });
}

/**
 * Append note to WU document's notes field.
 *
 * Always outputs a string (Zod schema requires string type).
 * Handles various input formats:
 * - undefined/null/empty: Set note directly as string
 * - string: Append with newline separator
 * - array: Convert to newline-separated string, then append
 * - other: Replace with note
 *
 * @param {object} doc - WU document
 * @param {string} note - Note to append
 */
export function appendNote(doc: Record<string, unknown>, note: string): void {
  // Do nothing if note is falsy
  if (!note) return;

  const existing = doc.notes;

  if (existing === undefined || existing === null || existing === '') {
    // No existing notes: set directly as string
    doc.notes = note;
  } else if (Array.isArray(existing)) {
    // Array notes: convert to string first (schema requires string), then append
    const joined = existing.filter(Boolean).join(STRING_LITERALS.NEWLINE).trimEnd();
    doc.notes = joined ? `${joined}${STRING_LITERALS.NEWLINE}${note}` : note;
  } else if (typeof existing === 'string') {
    // String notes: append with newline
    const trimmed = existing.trimEnd();
    doc.notes = trimmed ? `${trimmed}${STRING_LITERALS.NEWLINE}${note}` : note;
  } else {
    // Invalid type: replace with note
    doc.notes = note;
  }
}

/**
 * Append an agent session entry to a WU's agent_sessions[] array
 *
 * @param {string} wuId - WU ID (e.g., "WU-1234")
 * @param {object} sessionData - Session summary from endSession()
 * @throws {Error} if WU file not found
 */
export function appendAgentSession(wuId: string, sessionData: Record<string, unknown>): void {
  const paths = createWuPaths();
  const wuPath = paths.WU(wuId);

  if (!existsSync(wuPath)) {
    throw createError(ErrorCodes.FILE_NOT_FOUND, `WU file not found: ${wuPath}`);
  }

  // Parse WU YAML
  const doc = readWU(wuPath, wuId);

  // Initialize agent_sessions array if needed
  if (!Array.isArray(doc.agent_sessions)) {
    doc.agent_sessions = [];
  }

  // Append session
  (doc.agent_sessions as unknown[]).push(sessionData);

  // Write back
  writeWU(wuPath, doc);
}
