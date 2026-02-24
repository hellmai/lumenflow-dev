// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseYAML, stringifyYAML } from '@lumenflow/core/wu-yaml';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import type { WUDocBase } from '@lumenflow/core/wu-doc-types';
import { validateInitiative } from './initiative-schema.js';
import { INIT_PATHS } from './initiative-paths.js';
import { INIT_PATTERNS } from './initiative-constants.js';
import { readWU } from '@lumenflow/core/wu-yaml';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
// FILE_SYSTEM removed - not used in this module

/**
 * WU document interface (WU-2048: uses canonical WUDocBase from @lumenflow/core)
 */
export type WUDoc = Pick<WUDocBase, 'status' | 'lane' | 'title' | 'initiative'> & {
  blocked_by?: string[];
  [key: string]: unknown;
};

/**
 * Initiative document interface
 */
export interface InitiativeDoc {
  id: string;
  slug?: string;
  status?: string;
  phases?: Array<{ id: number; status?: string; wus?: string[] }>;
  wus?: string[];
  [key: string]: unknown;
}

/**
 * WU entry with document and metadata
 */
export interface WUEntry {
  id: string;
  doc: WUDoc;
  path: string;
}

/**
 * Initiative entry with document and metadata
 */
export interface InitiativeEntry {
  id: string;
  doc: InitiativeDoc;
  path: string;
}

/**
 * Initiative YAML I/O module.
 *
 * Mirrors wu-yaml.ts pattern. Provides validated read/write operations
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
export function readInitiative(initPath: string, expectedId: string): InitiativeDoc {
  if (!existsSync(initPath)) {
    throw createError(ErrorCodes.INIT_NOT_FOUND, `Initiative file not found: ${initPath}`, {
      path: initPath,
      expectedId,
    });
  }

  const text = readFileSync(initPath, { encoding: 'utf-8' });
  let rawDoc: unknown;

  try {
    rawDoc = parseYAML(text);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    throw createError(
      ErrorCodes.YAML_PARSE_ERROR,
      `Failed to parse YAML ${initPath}: ${errorMessage}`,
      {
        path: initPath,
        originalError: errorMessage,
      },
    );
  }

  // Validate ID matches
  const docWithId = rawDoc as { id?: string } | null;
  if (!docWithId || docWithId.id !== expectedId) {
    throw createError(
      ErrorCodes.INIT_NOT_FOUND,
      `Initiative YAML id mismatch. Expected ${expectedId}, found ${docWithId?.id}`,
      { path: initPath, expectedId, foundId: docWithId?.id },
    );
  }

  // Schema validation
  const result = validateInitiative(rawDoc);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw createError(ErrorCodes.VALIDATION_ERROR, `Initiative validation failed: ${issues}`, {
      path: initPath,
      issues: result.error.issues,
    });
  }

  return result.data as InitiativeDoc;
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
export function writeInitiative(initPath: string, doc: InitiativeDoc): void {
  const out = stringifyYAML(doc);
  writeFileSync(initPath, out, { encoding: 'utf-8' });
}

/**
 * List all initiatives from the initiatives directory.
 *
 * @returns {Array<{id: string, doc: object, path: string}>} Array of parsed initiatives
 */
export function listInitiatives(): InitiativeEntry[] {
  const dir = INIT_PATHS.INITIATIVES_DIR();

  if (!existsSync(dir)) {
    return [];
  }

  const files = readdirSync(dir).filter(
    (f) => f.endsWith('.yaml') && INIT_PATTERNS.INIT_ID.test(f.replace('.yaml', '')),
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
    .filter((entry): entry is InitiativeEntry => entry !== null);
}

/**
 * Find an initiative by ID or slug.
 *
 * @param {string} ref - Initiative ID (INIT-XXX) or slug
 * @returns {{id: string, doc: object, path: string} | null} Initiative or null if not found
 */
export function findInitiative(ref: string): InitiativeEntry | null {
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
export function getInitiativeWUs(initRef: string): WUEntry[] {
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
        if (doc.initiative && matchRefs.includes(doc.initiative as string)) {
          return { id, doc, path: filePath } as WUEntry;
        }
        return null;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is WUEntry => entry !== null);
}

/**
 * Calculate initiative progress (percentage of done WUs).
 *
 * @param {string} initRef - Initiative ID or slug
 * @returns {{total: number, done: number, inProgress: number, blocked: number, ready: number, percentage: number}}
 */
export function getInitiativeProgress(initRef: string): {
  total: number;
  done: number;
  inProgress: number;
  blocked: number;
  ready: number;
  percentage: number;
} {
  const wus = getInitiativeWUs(initRef);

  const counts = {
    total: wus.length,
    done: 0,
    inProgress: 0,
    blocked: 0,
    ready: 0,
    percentage: 0,
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
export function getInitiativePhases(
  initRef: string,
): Map<number | null, Array<{ id: string; doc: WUDoc }>> {
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
export function buildInitiativeMap(): Map<string, InitiativeDoc> {
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
