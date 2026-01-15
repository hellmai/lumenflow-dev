/* eslint-disable security/detect-non-literal-fs-filename */
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { createError, ErrorCodes } from '@lumenflow/core/lib/error-handler.js';
import { validateInitiative } from './initiative-schema.js';
import { INIT_PATHS } from './initiative-paths.js';
import { INIT_PATTERNS } from './initiative-constants.js';
import { readWU } from '@lumenflow/core/lib/wu-yaml.js';
import { WU_PATHS } from '@lumenflow/core/lib/wu-paths.js';
import { FILE_SYSTEM } from '@lumenflow/core/lib/wu-constants.js';

/**
 * Initiative YAML I/O module.
 *
 * Mirrors wu-yaml.mjs pattern. Provides validated read/write operations
 * for Initiative YAML files.
 *
 * @example
 * import { readInitiative, writeInitiative, listInitiatives } from './lib/initiative-yaml.js';
 *
 * // Read initiative
 * const doc = readInitiative('docs/04-operations/tasks/initiatives/INIT-001.yaml', 'INIT-001');
 *
 * // List all initiatives
 * const initiatives = listInitiatives();
 *
 * // Get WUs for initiative
 * const wus = getInitiativeWUs('INIT-001');
 */

/**
 * Read and parse Initiative YAML file.
 *
 * Validates:
 * - File exists
 * - YAML is valid
 * - Initiative ID matches expected ID
 * - Schema validation passes
 *
 * @param {string} initPath - Path to Initiative YAML file
 * @param {string} expectedId - Expected Initiative ID (e.g., 'INIT-001')
 * @returns {object} Parsed YAML document
 * @throws {Error} If file not found, YAML invalid, ID mismatch, or validation fails
 */
export function readInitiative(initPath, expectedId) {
  if (!existsSync(initPath)) {
    throw createError(ErrorCodes.INIT_NOT_FOUND, `Initiative file not found: ${initPath}`, {
      path: initPath,
      expectedId,
    });
  }

  const text = readFileSync(initPath, FILE_SYSTEM.UTF8);
  let doc;

  try {
    doc = yaml.load(text);
  } catch (e) {
    throw createError(
      ErrorCodes.YAML_PARSE_ERROR,
      `Failed to parse YAML ${initPath}: ${e.message}`,
      {
        path: initPath,
        originalError: e.message,
      }
    );
  }

  // Validate ID matches
  if (!doc || doc.id !== expectedId) {
    throw createError(
      ErrorCodes.INIT_NOT_FOUND,
      `Initiative YAML id mismatch. Expected ${expectedId}, found ${doc && doc.id}`,
      { path: initPath, expectedId, foundId: doc && doc.id }
    );
  }

  // Schema validation
  const result = validateInitiative(doc);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw createError(ErrorCodes.VALIDATION_ERROR, `Initiative validation failed: ${issues}`, {
      path: initPath,
      issues: result.error.issues,
    });
  }

  return doc;
}

/**
 * Write Initiative YAML file with consistent formatting.
 *
 * Uses:
 * - lineWidth: 100 (consistent with WU scripts)
 * - UTF-8 encoding
 *
 * @param {string} initPath - Path to Initiative YAML file
 * @param {object} doc - YAML document to write
 */
export function writeInitiative(initPath, doc) {
  const out = yaml.dump(doc, { lineWidth: 100 });
  writeFileSync(initPath, out, FILE_SYSTEM.UTF8);
}

/**
 * List all initiatives from the initiatives directory.
 *
 * @returns {Array<{id: string, doc: object, path: string}>} Array of parsed initiatives
 */
export function listInitiatives() {
  const dir = INIT_PATHS.INITIATIVES_DIR();

  if (!existsSync(dir)) {
    return [];
  }

  const files = readdirSync(dir).filter(
    (f) => f.endsWith('.yaml') && INIT_PATTERNS.INIT_ID.test(f.replace('.yaml', ''))
  );

  return files
    .map((f) => {
      const filePath = path.join(dir, f);
      const id = f.replace('.yaml', '');

      try {
        const doc = readInitiative(filePath, id);
        return { id, doc, path: filePath };
      } catch {
        // Skip invalid files
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Find an initiative by ID or slug.
 *
 * @param {string} ref - Initiative ID (INIT-XXX) or slug
 * @returns {{id: string, doc: object, path: string} | null} Initiative or null if not found
 */
export function findInitiative(ref) {
  const initiatives = listInitiatives();

  // Try direct ID match
  const byId = initiatives.find((i) => i.id === ref);
  if (byId) return byId;

  // Try slug match
  const bySlug = initiatives.find((i) => i.doc.slug === ref);
  return bySlug || null;
}

/**
 * Get all WUs belonging to an initiative (by ID or slug).
 *
 * @param {string} initRef - Initiative ID (INIT-XXX) or slug
 * @returns {Array<{id: string, doc: object, path: string}>} Array of WUs in initiative
 */
export function getInitiativeWUs(initRef) {
  const wuDir = WU_PATHS.WU('').replace(/\/[^/]*$/, ''); // Get directory path

  if (!existsSync(wuDir)) {
    return [];
  }

  const files = readdirSync(wuDir).filter((f) => f.endsWith('.yaml') && f.startsWith('WU-'));

  // Find initiative to get both ID and slug for matching
  const initiative = findInitiative(initRef);
  const matchRefs = initiative ? [initiative.id, initiative.doc.slug].filter(Boolean) : [initRef];

  return files
    .map((f) => {
      const filePath = path.join(wuDir, f);
      const id = f.replace('.yaml', '');

      try {
        const doc = readWU(filePath, id);

        // Check if WU belongs to this initiative (by ID or slug)
        if (doc.initiative && matchRefs.includes(doc.initiative)) {
          return { id, doc, path: filePath };
        }
        return null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Calculate initiative progress (percentage of done WUs).
 *
 * @param {string} initRef - Initiative ID or slug
 * @returns {{total: number, done: number, inProgress: number, blocked: number, ready: number, percentage: number}}
 */
export function getInitiativeProgress(initRef) {
  const wus = getInitiativeWUs(initRef);

  const counts = {
    total: wus.length,
    done: 0,
    inProgress: 0,
    blocked: 0,
    ready: 0,
  };

  for (const { doc } of wus) {
    switch (doc.status) {
      case 'done':
        counts.done++;
        break;
      case 'in_progress':
        counts.inProgress++;
        break;
      case 'blocked':
        counts.blocked++;
        break;
      case 'ready':
        counts.ready++;
        break;
      default:
        // Other statuses count toward total but not specific buckets
        break;
    }
  }

  counts.percentage = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;

  return counts;
}

/**
 * Get WUs grouped by phase within an initiative.
 *
 * @param {string} initRef - Initiative ID or slug
 * @returns {Map<number|null, Array<{id: string, doc: object}>>} Map of phase ID to WU array (null key = no phase)
 */
export function getInitiativePhases(initRef) {
  const wus = getInitiativeWUs(initRef);
  const phases = new Map();

  for (const { id, doc } of wus) {
    const phase = doc.phase ?? null;

    if (!phases.has(phase)) {
      phases.set(phase, []);
    }
    phases.get(phase).push({ id, doc });
  }

  return phases;
}

/**
 * Build a map of all initiatives (by ID and slug) for quick lookup.
 *
 * @returns {Map<string, object>} Map of ID/slug to initiative doc
 */
export function buildInitiativeMap() {
  const initiatives = listInitiatives();
  const map = new Map();

  for (const { id, doc } of initiatives) {
    map.set(id, doc);
    if (doc.slug) {
      map.set(doc.slug, doc);
    }
  }

  return map;
}
