/**
 * Initiative Validator (WU-1246, WU-2319, WU-1088)
 *
 * Validates WU dependency graphs for cycles, orphan references,
 * initiative consistency, and bidirectional WU-Initiative references.
 *
 * Part of the Initiative System Phase 1 - Schema & Validation Foundation.
 * WU-2319: Added bidirectional validation for WU<->Initiative references.
 * WU-1088: detectCycles moved to @lumenflow/core to break circular dependency.
 *
 * @see {@link packages/@lumenflow/cli/src/validate.ts} - Consumer (CI validation)
 * @see {@link packages/@lumenflow/cli/src/lib/initiative-schema.ts} - Initiative schema
 */

// WU-1088: Import detectCycles from @lumenflow/core to break circular dependency
import { detectCycles, type WUObject, type CycleResult } from '@lumenflow/core';

// Re-export for backward compatibility with existing consumers
export { detectCycles, type WUObject, type CycleResult };

/**
 * Initiative object interface for validation
 */
interface InitiativeObject {
  id?: string;
  slug?: string;
  wus?: string[];
  phases?: Array<{ id: number }>;
  [key: string]: unknown;
}

/**
 * Orphan reference result
 */
interface OrphanRef {
  wuId: string;
  field: string;
  ref: string;
}

/**
 * Detects orphan references in WU dependency fields
 *
 * An orphan reference is a WU ID in blocks/blocked_by that doesn't exist
 * in the known set of WU IDs.
 *
 * @param {Map<string, Object>} wuMap - Map of WU ID to WU object
 * @param {Set<string>} allWuIds - Set of all known WU IDs
 * @returns {{orphans: Array<{wuId: string, field: string, ref: string}>}} Orphan detection result
 *
 * @example
 * const wuMap = new Map([['WU-001', { id: 'WU-001', blocks: ['WU-999'] }]]);
 * const allWuIds = new Set(['WU-001']);
 * const result = detectOrphanRefs(wuMap, allWuIds);
 * // result.orphans contains { wuId: 'WU-001', field: 'blocks', ref: 'WU-999' }
 */
/**
 * Regex pattern for valid WU ID references
 * Only validate entries that match this pattern (ignore informal notes)
 */
const WU_ID_PATTERN = /^WU-\d+$/;

/**
 * Checks array field for orphan WU references
 *
 * @param {string} wuId - The WU being checked
 * @param {Array<string>} refs - Array of WU ID references
 * @param {string} fieldName - Name of the field being checked
 * @param {Set<string>} allWuIds - Set of all known WU IDs
 * @returns {Array<{wuId: string, field: string, ref: string}>} Orphan references found
 */
function findOrphansInField(
  wuId: string,
  refs: string[],
  fieldName: string,
  allWuIds: Set<string>,
): OrphanRef[] {
  const orphans: OrphanRef[] = [];
  for (const ref of refs) {
    if (WU_ID_PATTERN.test(ref) && !allWuIds.has(ref)) {
      orphans.push({ wuId, field: fieldName, ref });
    }
  }
  return orphans;
}

export function detectOrphanRefs(wuMap: Map<string, WUObject>, allWuIds: Set<string>) {
  const orphans: OrphanRef[] = [];

  for (const [wuId, wu] of wuMap.entries()) {
    const blocks = Array.isArray(wu?.blocks) ? wu.blocks : [];
    const blockedBy = Array.isArray(wu?.blocked_by) ? wu.blocked_by : [];

    orphans.push(...findOrphansInField(wuId, blocks, 'blocks', allWuIds));
    orphans.push(...findOrphansInField(wuId, blockedBy, 'blocked_by', allWuIds));
  }

  return { orphans };
}

/**
 * Validates initiative references in WUs
 *
 * Checks that:
 * - Initiative field references exist (by ID or slug)
 * - Phase numbers are defined in parent initiative
 *
 * Returns warnings (not errors) for soft enforcement.
 *
 * @param {Map<string, Object>} wuMap - Map of WU ID to WU object
 * @param {Map<string, Object>} initiatives - Map of Initiative ID to Initiative object
 * @returns {{warnings: string[]}} Validation warnings
 *
 * @example
 * const wuMap = new Map([['WU-001', { id: 'WU-001', initiative: 'INIT-999' }]]);
 * const initiatives = new Map();
 * const result = validateInitiativeRefs(wuMap, initiatives);
 * // result.warnings contains warning about missing initiative
 */
export function validateInitiativeRefs(
  wuMap: Map<string, WUObject>,
  initiatives: Map<string, InitiativeObject>,
) {
  const warnings: string[] = [];

  // Build slug lookup for initiative references
  const initiativeBySlug = new Map<string, InitiativeObject>();
  for (const [id, init] of initiatives.entries()) {
    if (init.slug) {
      initiativeBySlug.set(init.slug, init);
    }
    // Also index by ID
    initiativeBySlug.set(id, init);
  }

  for (const [wuId, wu] of wuMap.entries()) {
    const initRef = wu?.initiative;

    // Skip WUs without initiative field
    if (!initRef) {
      continue;
    }

    // Look up initiative by ID or slug
    const initiative = initiatives.get(initRef) || initiativeBySlug.get(initRef);

    if (!initiative) {
      warnings.push(`[${wuId}] references non-existent initiative: ${initRef}`);
      continue;
    }

    // Validate phase if specified
    const phase = wu?.phase;
    if (phase !== undefined) {
      const phases = initiative.phases || [];
      const phaseExists = phases.some((p: { id: number }) => p.id === phase);

      if (phases.length === 0) {
        warnings.push(
          `[${wuId}] specifies phase ${phase} but initiative ${initRef} has no phases defined`,
        );
      } else if (!phaseExists) {
        const validPhases = phases.map((p: { id: number }) => p.id).join(', ');
        warnings.push(
          `[${wuId}] references phase ${phase} which does not exist in initiative ${initRef} (valid phases: ${validPhases})`,
        );
      }
    }
  }

  return { warnings };
}

/**
 * Builds a lookup map that resolves initiative references (by ID or slug) to initiative IDs.
 *
 * @param {Map<string, Object>} initiatives - Map of Initiative ID to Initiative object
 * @returns {Map<string, string>} Map from ID or slug to initiative ID
 */
function buildInitiativeSlugLookup(
  initiatives: Map<string, InitiativeObject>,
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const [id, init] of initiatives.entries()) {
    if (init.slug) {
      lookup.set(init.slug, id);
    }
    lookup.set(id, id);
  }
  return lookup;
}

/**
 * Validates WU->Initiative direction: checks if WU is listed in initiative.wus
 *
 * @param {Map<string, Object>} wuMap - Map of WU ID to WU object
 * @param {Map<string, Object>} initiatives - Map of Initiative ID to Initiative object
 * @param {Map<string, string>} slugLookup - Lookup from slug/ID to initiative ID
 * @returns {string[]} Array of error messages
 */
function validateWuToInitiativeRefs(
  wuMap: Map<string, WUObject>,
  initiatives: Map<string, InitiativeObject>,
  slugLookup: Map<string, string>,
): string[] {
  const errors: string[] = [];

  for (const [wuId, wu] of wuMap.entries()) {
    const initRef = wu?.initiative;
    if (!initRef) continue;

    const initId = slugLookup.get(initRef);
    if (!initId) continue; // Non-existent initiative caught by validateInitiativeRefs

    const initiative = initiatives.get(initId);
    const wusList = Array.isArray(initiative?.wus) ? initiative.wus : [];

    if (!wusList.includes(wuId)) {
      errors.push(`[${wuId}] references initiative ${initRef} but is not listed in ${initId}.wus`);
    }
  }

  return errors;
}

/**
 * Validates Initiative->WU direction: checks if WU has matching initiative field
 *
 * @param {Map<string, Object>} wuMap - Map of WU ID to WU object
 * @param {Map<string, Object>} initiatives - Map of Initiative ID to Initiative object
 * @param {Map<string, string>} slugLookup - Lookup from slug/ID to initiative ID
 * @returns {{errors: string[], warnings: string[]}} Validation results
 */
function validateInitiativeToWuRefs(
  wuMap: Map<string, WUObject>,
  initiatives: Map<string, InitiativeObject>,
  slugLookup: Map<string, string>,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const [initId, init] of initiatives.entries()) {
    const wusList = Array.isArray(init?.wus) ? init.wus : [];

    for (const wuRef of wusList) {
      if (!wuMap.has(wuRef)) {
        warnings.push(`[${initId}] lists non-existent WU: ${wuRef}`);
        continue;
      }

      const wu = wuMap.get(wuRef);
      const wuInitRef = wu?.initiative;

      if (!wuInitRef) {
        errors.push(`[${wuRef}] is listed in ${initId}.wus but has missing initiative field`);
        continue;
      }

      const resolvedWuInitId = slugLookup.get(wuInitRef);
      if (resolvedWuInitId && resolvedWuInitId !== initId) {
        errors.push(
          `[${wuRef}] is listed in ${initId}.wus but has initiative: ${wuInitRef} (points to ${resolvedWuInitId})`,
        );
      }
    }
  }

  return { errors, warnings };
}

/**
 * Validates bidirectional references between WUs and Initiatives (WU-2319)
 *
 * Checks two directions:
 * 1. WU->Initiative: If WU has initiative: INIT-XXX, the initiative.wus must list the WU
 * 2. Initiative->WU: If initiative.wus lists a WU, the WU should have initiative: field
 *
 * Also delegates to validateInitiativeRefs for phase mismatch detection.
 *
 * Note: All bidirectional mismatches are returned as ERRORS (not warnings).
 * The caller (validateDependencyGraph) may choose to treat these as warnings
 * for backward compatibility with pre-existing data inconsistencies.
 *
 * @param {Map<string, Object>} wuMap - Map of WU ID to WU object
 * @param {Map<string, Object>} initiatives - Map of Initiative ID to Initiative object
 * @returns {{errors: string[], warnings: string[]}} Validation results
 *
 * @example
 * const wuMap = new Map([['WU-001', { id: 'WU-001', initiative: 'INIT-001' }]]);
 * const initiatives = new Map([['INIT-001', { id: 'INIT-001', wus: ['WU-001'] }]]);
 * const result = validateBidirectionalRefs(wuMap, initiatives);
 * // result.errors === [] (all refs match)
 */
export function validateBidirectionalRefs(
  wuMap: Map<string, WUObject>,
  initiatives: Map<string, InitiativeObject>,
) {
  const slugLookup = buildInitiativeSlugLookup(initiatives);

  // Direction 1: WU->Initiative
  const wuToInitErrors = validateWuToInitiativeRefs(wuMap, initiatives, slugLookup);

  // Direction 2: Initiative->WU
  const initToWuResult = validateInitiativeToWuRefs(wuMap, initiatives, slugLookup);

  // Include phase mismatch warnings from existing validateInitiativeRefs
  const phaseResult = validateInitiativeRefs(wuMap, initiatives);

  return {
    errors: [...wuToInitErrors, ...initToWuResult.errors],
    warnings: [...initToWuResult.warnings, ...phaseResult.warnings],
  };
}

/**
 * Validates the complete WU dependency graph
 *
 * Orchestrates all validation checks:
 * 1. Cycle detection (error)
 * 2. Orphan reference detection (error)
 * 3. Initiative reference validation (warning)
 * 4. Bidirectional WU-Initiative validation (error) [WU-2319]
 *
 * @param {Map<string, Object>} wuMap - Map of WU ID to WU object
 * @param {Set<string>} allWuIds - Set of all known WU IDs
 * @param {Map<string, Object>} initiatives - Map of Initiative ID to Initiative object
 * @returns {{errors: string[], warnings: string[]}} Validation results
 *
 * @example
 * const result = validateDependencyGraph(wuMap, allWuIds, initiatives);
 * if (result.errors.length > 0) {
 *   console.error('Validation failed:', result.errors);
 * }
 */
export function validateDependencyGraph(
  wuMap: Map<string, WUObject>,
  allWuIds: Set<string>,
  initiatives: Map<string, InitiativeObject>,
) {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Check for cycles
  const cycleResult = detectCycles(wuMap);
  if (cycleResult.hasCycle) {
    for (const cycle of cycleResult.cycles) {
      errors.push(`Circular dependency detected: ${cycle.join(' → ')}`);
    }
  }

  // 2. Check for orphan references
  const orphanResult = detectOrphanRefs(wuMap, allWuIds);
  for (const orphan of orphanResult.orphans) {
    errors.push(`[${orphan.wuId}] references non-existent WU in ${orphan.field}: ${orphan.ref}`);
  }

  // 3. Validate initiative references (warnings only)
  const initResult = validateInitiativeRefs(wuMap, initiatives);
  warnings.push(...initResult.warnings);

  // 4. Validate bidirectional WU-Initiative references (WU-2319)
  // Note: Bidirectional errors are treated as WARNINGS for backward compatibility
  // with pre-existing data inconsistencies. Future: consider promoting to errors
  // once data is cleaned up.
  const bidirectionalResult = validateBidirectionalRefs(wuMap, initiatives);
  // Treat bidirectional "errors" as warnings for soft enforcement
  warnings.push(...bidirectionalResult.errors);
  // Add bidirectional warnings (non-existent WU refs, phase mismatches)
  // Filter out duplicates from phase warnings already added above
  const existingWarnings = new Set(warnings);
  for (const warning of bidirectionalResult.warnings) {
    if (!existingWarnings.has(warning)) {
      warnings.push(warning);
    }
  }

  return { errors, warnings };
}
