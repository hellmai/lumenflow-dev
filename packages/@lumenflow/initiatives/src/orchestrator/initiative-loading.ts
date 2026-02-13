/**
 * Initiative and WU loading utilities.
 *
 * Provides functions to load initiative documents and their associated WUs.
 *
 * @module orchestrator/initiative-loading
 */

import type { InitiativeDoc, WUEntry } from '../initiative-yaml.js';
import { findInitiative, getInitiativeWUs } from '../initiative-yaml.js';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';

/**
 * Load initiative and its WUs.
 *
 * @param {string} initRef - Initiative ID or slug
 * @returns {{initiative: object, wus: Array<{id: string, doc: object}>}}
 * @throws {Error} If initiative not found
 */
export function loadInitiativeWUs(initRef: string): { initiative: InitiativeDoc; wus: WUEntry[] } {
  const initiative = findInitiative(initRef);

  if (!initiative) {
    throw createError(
      ErrorCodes.INIT_NOT_FOUND,
      `Initiative '${initRef}' not found. Check the ID or slug.`,
      { initRef },
    );
  }

  const wus = getInitiativeWUs(initRef);

  return {
    initiative: initiative.doc,
    wus,
  };
}

/**
 * Load multiple initiatives and combine their WUs.
 *
 * Used for cross-initiative parallel execution.
 *
 * @param {string[]} initRefs - Array of initiative IDs or slugs
 * @returns {Array<{id: string, doc: object}>} Combined WUs from all initiatives
 * @throws {Error} If any initiative not found
 */
export function loadMultipleInitiatives(initRefs: string[]): WUEntry[] {
  const allWUs = [];
  const seenIds = new Set();

  for (const ref of initRefs) {
    const { wus } = loadInitiativeWUs(ref);

    for (const wu of wus) {
      if (!seenIds.has(wu.id)) {
        seenIds.add(wu.id);
        allWUs.push(wu);
      }
    }
  }

  return allWUs;
}
