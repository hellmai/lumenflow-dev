#!/usr/bin/env node
/**
 * System Map Validator Library
 *
 * Validates SYSTEM-MAP.yaml integrity:
 * 1. All paths resolve to existing files/folders
 * 2. No orphan docs not in map
 * 3. Audience tags from canonical list
 * 4. quick_queries resolve correctly
 * 5. No PHI entries tagged for investor/public
 *
 * @module system-map-validator
 */

import { existsSync, readFileSync } from 'node:fs';
import fg from 'fast-glob';
import { parseYAML } from './wu-yaml.js';

/**
 * Canonical list of valid audience tags as defined in SYSTEM-MAP.yaml header
 * @type {string[]}
 */
export const CANONICAL_AUDIENCES = [
  'ceo',
  'cto',
  'engineer',
  'compliance',
  'investor',
  'agent',
  'patient',
  'clinician',
];

/**
 * Canonical list of valid classification levels
 * From least to most restrictive: public < internal < confidential < restricted
 * @type {string[]}
 */
export const CANONICAL_CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'];

/**
 * Audiences that should NOT have access to restricted (PHI) data
 * These are considered "external" audiences who should never see PHI
 * Note: investor CAN see confidential (investor materials ARE confidential)
 * @type {string[]}
 */
const PHI_RESTRICTED_AUDIENCES = ['investor', 'patient', 'clinician', 'public'];

/**
 * Extract all document entries from system map (flattens all layer arrays)
 *
 * @param {object} systemMap - Parsed SYSTEM-MAP.yaml
 * @returns {Array<{id: string, path?: string, paths?: string[], audiences: string[], classification: string, summary: string}>}
 */
function extractAllEntries(systemMap) {
  const entries = [];
  const skipKeys = ['quick_queries'];

  for (const [key, value] of Object.entries(systemMap)) {
    if (skipKeys.includes(key)) continue;
    if (Array.isArray(value)) {
      entries.push(...value);
    }
  }

  return entries;
}

/**
 * Get all paths from an entry (handles both path and paths fields)
 *
 * @param {{path?: string, paths?: string[]}} entry - Document entry
 * @returns {string[]}
 */
function getEntryPaths(entry) {
  const result = [];
  if (entry.path) result.push(entry.path);
  if (entry.paths && Array.isArray(entry.paths)) result.push(...entry.paths);
  return result;
}

/**
 * Build a set of all indexed paths from the system map
 *
 * @param {object} systemMap - Parsed SYSTEM-MAP.yaml
 * @returns {Set<string>}
 */
function buildIndexedPathsSet(systemMap) {
  const indexedPaths = new Set();
  const entries = extractAllEntries(systemMap);

  for (const entry of entries) {
    const paths = getEntryPaths(entry);
    for (const p of paths) {
      indexedPaths.add(p);
      // For directory paths, also add the prefix for matching
      if (p.endsWith('/')) {
        indexedPaths.add(p);
      }
    }
  }

  return indexedPaths;
}

/**
 * Build a set of all document IDs from the system map
 *
 * @param {object} systemMap - Parsed SYSTEM-MAP.yaml
 * @returns {Set<string>}
 */
function buildIdSet(systemMap) {
  const idSet = new Set();
  const entries = extractAllEntries(systemMap);

  for (const entry of entries) {
    if (entry.id) {
      idSet.add(entry.id);
    }
  }

  return idSet;
}

/**
 * Validate all paths in system map exist
 *
 * @param {object} systemMap - Parsed SYSTEM-MAP.yaml
 * @param {{exists: (path: string) => boolean}} deps - Dependencies
 * @returns {Promise<string[]>} Array of error messages
 */
export async function validatePaths(systemMap, deps) {
  const errors = [];
  const entries = extractAllEntries(systemMap);

  for (const entry of entries) {
    const paths = getEntryPaths(entry);
    for (const p of paths) {
      if (!deps.exists(p)) {
        errors.push(`Path not found: ${p} (entry: ${entry.id})`);
      }
    }
  }

  return errors;
}

/**
 * Find orphan docs not indexed in system map
 *
 * @param {object} systemMap - Parsed SYSTEM-MAP.yaml
 * @param {{glob: (pattern: string) => Promise<string[]>}} deps - Dependencies
 * @returns {Promise<string[]>} Array of orphan file paths
 */
export async function findOrphanDocs(systemMap, deps) {
  const indexedPaths = buildIndexedPathsSet(systemMap);

  // Get all docs files
  const allDocs = await deps.glob('docs/**/*.md');

  const orphans = [];
  for (const docPath of allDocs) {
    // Check if this doc is directly indexed
    if (indexedPaths.has(docPath)) continue;

    // Check if this doc falls under an indexed directory
    let isUnderIndexedDir = false;
    for (const indexedPath of indexedPaths) {
      const indexedPathStr = String(indexedPath);
      if (indexedPathStr.endsWith('/') && docPath.startsWith(indexedPathStr)) {
        isUnderIndexedDir = true;
        break;
      }
    }

    if (!isUnderIndexedDir) {
      orphans.push(docPath);
    }
  }

  return orphans;
}

/**
 * Validate audience tags against canonical list
 *
 * @param {object} systemMap - Parsed SYSTEM-MAP.yaml
 * @returns {string[]} Array of error messages
 */
export function validateAudienceTags(systemMap) {
  const errors = [];
  const entries = extractAllEntries(systemMap);

  for (const entry of entries) {
    if (!entry.audiences || !Array.isArray(entry.audiences)) {
      errors.push(`Entry ${entry.id} missing audiences array`);
      continue;
    }

    if (entry.audiences.length === 0) {
      errors.push(`Entry ${entry.id} has empty audiences array (must have at least one)`);
      continue;
    }

    for (const audience of entry.audiences) {
      if (!CANONICAL_AUDIENCES.includes(audience)) {
        errors.push(`Invalid audience '${audience}' in entry ${entry.id}`);
      }
    }
  }

  return errors;
}

/**
 * Validate quick_queries reference valid document IDs
 *
 * @param {object} systemMap - Parsed SYSTEM-MAP.yaml
 * @returns {string[]} Array of error messages
 */
export function validateQuickQueries(systemMap) {
  const errors = [];

  if (!systemMap.quick_queries) {
    return errors;
  }

  const validIds = buildIdSet(systemMap);

  for (const [queryKey, queryValue] of Object.entries(systemMap.quick_queries)) {
    const query = queryValue as { primary?: string; related?: string[] };
    // Check primary reference
    if (query.primary && !validIds.has(query.primary)) {
      errors.push(`Quick query '${queryKey}' references non-existent primary: ${query.primary}`);
    }

    // Check related references
    if (query.related && Array.isArray(query.related)) {
      for (const related of query.related) {
        if (!validIds.has(related)) {
          errors.push(`Quick query '${queryKey}' references non-existent related: ${related}`);
        }
      }
    }
  }

  return errors;
}

/**
 * Validate classification prevents PHI routing to investor/public
 *
 * Rule: restricted (PHI) data should NOT be accessible to external audiences
 * - restricted = PHI data, must NOT go to investor/patient/clinician
 * - confidential = sensitive but OK for investor (investor docs ARE confidential)
 *
 * @param {object} systemMap - Parsed SYSTEM-MAP.yaml
 * @returns {string[]} Array of error messages
 */
export function validateClassificationRouting(systemMap) {
  const errors = [];
  const entries = extractAllEntries(systemMap);

  for (const entry of entries) {
    const classification = entry.classification;
    const audiences = entry.audiences || [];

    // Only check restricted classification (PHI data)
    // Confidential is OK for investors (investor materials are confidential by design)
    if (classification !== 'restricted') {
      continue;
    }

    // Check if any PHI-restricted audiences have access
    for (const audience of audiences) {
      if (PHI_RESTRICTED_AUDIENCES.includes(audience)) {
        errors.push(
          `PHI routing violation: ${entry.id} has restricted (PHI) classification but is accessible to '${audience}'`,
        );
      }
    }
  }

  return errors;
}

/**
 * Validate entire system map
 *
 * @param {object} systemMap - Parsed SYSTEM-MAP.yaml
 * @param {{exists: (path: string) => boolean, glob: (pattern: string) => Promise<string[]>}} deps - Dependencies
 * @returns {Promise<{valid: boolean, pathErrors: string[], orphanDocs: string[], audienceErrors: string[], queryErrors: string[], classificationErrors: string[]}>}
 */
export async function validateSystemMap(systemMap, deps) {
  const pathErrors = await validatePaths(systemMap, deps);
  const orphanDocs = await findOrphanDocs(systemMap, deps);
  const audienceErrors = validateAudienceTags(systemMap);
  const queryErrors = validateQuickQueries(systemMap);
  const classificationErrors = validateClassificationRouting(systemMap);

  const valid =
    pathErrors.length === 0 &&
    orphanDocs.length === 0 &&
    audienceErrors.length === 0 &&
    queryErrors.length === 0 &&
    classificationErrors.length === 0;

  return {
    valid,
    pathErrors,
    orphanDocs,
    audienceErrors,
    queryErrors,
    classificationErrors,
  };
}

const DEFAULT_SYSTEM_MAP_PATH = 'SYSTEM-MAP.yaml';

function emitErrors(label, errors) {
  if (!errors || errors.length === 0) return;
  console.error(`\n${label}:`);
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
}

async function runCLI() {
  const systemMapPath = process.env.SYSTEM_MAP_PATH || DEFAULT_SYSTEM_MAP_PATH;

  if (!existsSync(systemMapPath)) {
    console.warn(`[system-map] ${systemMapPath} not found; skipping validation.`);
    process.exit(0);
  }

  let systemMap;
  try {
    const raw = readFileSync(systemMapPath, 'utf-8');
    systemMap = parseYAML(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[system-map] Failed to read or parse ${systemMapPath}: ${message}`);
    process.exit(1);
  }

  const result = await validateSystemMap(systemMap, {
    exists: (path) => existsSync(path),
    glob: (pattern) => fg(pattern, { dot: false }),
  });

  if (!result.valid) {
    console.error('\n[system-map] Validation failed');
    emitErrors('Missing paths', result.pathErrors);
    emitErrors('Orphan docs', result.orphanDocs);
    emitErrors('Invalid audiences', result.audienceErrors);
    emitErrors('Invalid quick queries', result.queryErrors);
    emitErrors('Classification routing violations', result.classificationErrors);
    process.exit(1);
  }

  console.log('[system-map] Validation passed');
  process.exit(0);
}

if (import.meta.main) {
  runCLI().catch((error) => {
    console.error('[system-map] Validation failed:', error);
    process.exit(1);
  });
}
