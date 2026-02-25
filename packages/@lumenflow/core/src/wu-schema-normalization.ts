// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-schema-normalization.ts
 * @description Schema normalization for legacy WU YAML formats (WU-2004)
 *
 * Handles migration of legacy fields to current schema:
 * - summary → description
 * - string risks → array
 * - test_paths → tests
 * - ISO/Date created → YYYY-MM-DD
 * - Removes deprecated fields: owner, context
 */

/**
 * Normalize a WU schema object, converting legacy formats to current schema.
 * @param {Object} wu - Raw WU object (from YAML parse)
 * @returns {Object} Normalized WU object
 */
export function normalizeWUSchema(wu: Record<string, unknown>) {
  const result = { ...wu };

  // 1. summary → description migration
  if (result.summary && !result.description) {
    result.description = result.summary;
  }
  delete result.summary;

  // 2. context → append to description
  if (result.context) {
    if (result.description) {
      result.description = `${result.description}\n\n${result.context}`;
    } else {
      result.description = result.context;
    }
    delete result.context;
  }

  // 3. risks string → array conversion
  if (typeof result.risks === 'string') {
    result.risks = result.risks
      .split('\n')
      .map((line: string) => line.trim())
      .filter(Boolean);
  }

  // 4. test_paths → tests migration
  if (result.test_paths && !result.tests) {
    const tests: Record<string, unknown> = {};
    const testPaths = result.test_paths as Record<string, unknown>;

    for (const [key, value] of Object.entries(testPaths)) {
      if (Array.isArray(value)) {
        tests[key] = value.map((item: unknown) => {
          // js-yaml parses "Key: Value" as { Key: 'Value' } object
          if (typeof item === 'object' && item !== null) {
            // Convert { 'Manual test': 'Navigate to /settings' } → 'Manual test: Navigate to /settings'
            const entries = Object.entries(item);
            if (entries.length === 1) {
              const entry = entries[0];
              if (entry) {
                const [k, v] = entry;
                return `${k}: ${v}`;
              }
            }
          }
          return item;
        });
      } else {
        tests[key] = value;
      }
    }

    result.tests = tests;
  }
  delete result.test_paths;

  // 5. created date normalization
  if (result.created) {
    if (result.created instanceof Date) {
      result.created = result.created.toISOString().slice(0, 10);
    } else if (typeof result.created === 'string') {
      // ISO timestamp → YYYY-MM-DD
      const isoMatch = result.created.match(/^(\d{4}-\d{2}-\d{2})/);
      if (isoMatch) {
        result.created = isoMatch[1];
      }
    }
  }

  // 6. Remove deprecated fields
  delete result.owner;

  return result;
}
