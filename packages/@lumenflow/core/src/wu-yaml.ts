import { existsSync, readFileSync, writeFileSync, promises as fs } from 'node:fs';
import { parse, stringify } from 'yaml';
import { createError, ErrorCodes } from './error-handler.js';
import { STRING_LITERALS } from './wu-constants.js';
import { createWuPaths } from './wu-paths.js';

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
 *
 * // Read WU
 * const doc = readWU('docs/04-operations/tasks/wu/WU-123.yaml', 'WU-123');
 *
 * // Modify doc
 * doc.status = 'in_progress';
 * appendNote(doc, 'Started work on this WU');
 *
 * // Write back
 * writeWU('docs/04-operations/tasks/wu/WU-123.yaml', doc);
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
export function readWU(wuPath, expectedId) {
  if (!existsSync(wuPath)) {
    throw createError(ErrorCodes.FILE_NOT_FOUND, `WU file not found: ${wuPath}`, {
      path: wuPath,
      expectedId,
    });
  }

  const text = readFileSync(wuPath, { encoding: 'utf-8' });
  let doc;

  try {
    doc = parse(text);
  } catch (e) {
    throw createError(ErrorCodes.YAML_PARSE_ERROR, `Failed to parse YAML ${wuPath}: ${e.message}`, {
      path: wuPath,
      originalError: e.message,
    });
  }

  // Validate ID matches
  if (!doc || doc.id !== expectedId) {
    throw createError(
      ErrorCodes.WU_NOT_FOUND,
      `WU YAML id mismatch. Expected ${expectedId}, found ${doc && doc.id}`,
      { path: wuPath, expectedId, foundId: doc && doc.id },
    );
  }

  return doc;
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
export async function readWUAsync(wuPath, expectedId) {
  try {
    const text = await fs.readFile(wuPath, { encoding: 'utf-8' });
    let doc;

    try {
      doc = parse(text);
    } catch (e) {
      throw createError(
        ErrorCodes.YAML_PARSE_ERROR,
        `Failed to parse YAML ${wuPath}: ${e.message}`,
        {
          path: wuPath,
          originalError: e.message,
        },
      );
    }

    // Validate ID matches
    if (!doc || doc.id !== expectedId) {
      throw createError(
        ErrorCodes.WU_NOT_FOUND,
        `WU YAML id mismatch. Expected ${expectedId}, found ${doc && doc.id}`,
        { path: wuPath, expectedId, foundId: doc && doc.id },
      );
    }

    return doc;
  } catch (err) {
    if (err.code === 'ENOENT') {
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
export function parseYAML(text) {
  return parse(text);
}

/**
 * Stringify object to YAML with standardized options.
 * WU-1352: Centralized YAML serialization for consistency.
 *
 * @param {object} doc - Object to stringify
 * @param {object} [options] - Additional stringify options (merged with YAML_STRINGIFY_OPTIONS)
 * @returns {string} YAML string
 */
export function stringifyYAML(doc, options = {}) {
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
export function readWURaw(yamlPath) {
  if (!existsSync(yamlPath)) {
    throw createError(ErrorCodes.FILE_NOT_FOUND, `YAML file not found: ${yamlPath}`, {
      path: yamlPath,
    });
  }

  const text = readFileSync(yamlPath, { encoding: 'utf-8' });

  try {
    return parse(text);
  } catch (e) {
    throw createError(
      ErrorCodes.YAML_PARSE_ERROR,
      `Failed to parse YAML ${yamlPath}: ${e.message}`,
      {
        path: yamlPath,
        originalError: e.message,
      },
    );
  }
}

/**
 * Read and parse YAML file without ID validation asynchronously.
 * WU-1352: For cases where you don't know/need to validate the WU ID.
 *
 * @param {string} yamlPath - Path to YAML file
 * @returns {Promise<object>} Parsed YAML document
 * @throws {Error} If file not found or YAML invalid
 */
export async function readWURawAsync(yamlPath) {
  try {
    const text = await fs.readFile(yamlPath, { encoding: 'utf-8' });

    try {
      return parse(text);
    } catch (e) {
      throw createError(
        ErrorCodes.YAML_PARSE_ERROR,
        `Failed to parse YAML ${yamlPath}: ${e.message}`,
        {
          path: yamlPath,
          originalError: e.message,
        },
      );
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
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
 *
 * @param {string} wuPath - Path to WU YAML file
 * @param {object} doc - YAML document to write
 */
export function writeWU(wuPath, doc) {
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
export function appendNote(doc, note) {
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
export function appendAgentSession(wuId, sessionData) {
  const paths = createWuPaths();
  const wuPath = paths.WU(wuId);

  if (!existsSync(wuPath)) {
    throw new Error(`WU file not found: ${wuPath}`);
  }

  // Parse WU YAML
  const doc = readWU(wuPath, wuId);

  // Initialize agent_sessions array if needed
  if (!doc.agent_sessions) {
    doc.agent_sessions = [];
  }

  // Append session
  doc.agent_sessions.push(sessionData);

  // Write back
  writeWU(wuPath, doc);
}
