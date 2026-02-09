/**
 * Initiative Completeness Validation (WU-1211)
 *
 * Validates initiative completeness and determines when
 * initiative status should auto-progress.
 *
 * Used by:
 * - initiative:create (warns if description not provided)
 * - wu:create --initiative (warns if initiative has no phases)
 * - wu:claim (auto-progresses initiative status)
 * - state:doctor (reports incomplete initiatives)
 */

import { PROGRESSABLE_WU_STATUSES } from '@lumenflow/core/dist/wu-constants.js';

/**
 * Result of initiative completeness validation
 */
export interface InitiativeCompletenessResult {
  /** Whether the initiative is valid (always true - issues are warnings not errors) */
  valid: boolean;
  /** Warning messages for incomplete fields */
  warnings: string[];
}

/**
 * Result of checking if initiative has phases defined
 */
export interface InitiativePhaseCheck {
  /** Whether the initiative has at least one phase */
  hasPhases: boolean;
  /** Warning message if no phases (null if phases exist) */
  warning: string | null;
}

/**
 * Result of checking if initiative status should progress
 */
export interface InitiativeProgressCheck {
  /** Whether the initiative status should progress */
  shouldProgress: boolean;
  /** The new status if shouldProgress is true */
  newStatus: string | null;
}

/**
 * Initiative document interface for validation
 */
interface InitiativeDoc {
  id?: string;
  slug?: string;
  title?: string;
  description?: string;
  status?: string;
  phases?: Array<{ id: number; title?: string; status?: string }>;
  success_metrics?: string[];
  [key: string]: unknown;
}

/**
 * WU document interface for validation
 */
interface WUDoc {
  id?: string;
  status?: string;
  initiative?: string;
  [key: string]: unknown;
}

/** Initiative statuses that can transition to in_progress */
const PROGRESSABLE_STATUSES = ['draft', 'open'];

/**
 * Validates initiative completeness and returns warnings for missing fields.
 *
 * This is soft validation - missing fields generate warnings, not errors.
 * The initiative is still considered valid but incomplete.
 *
 * @param initiative - Initiative document to validate
 * @returns Validation result with warnings for incomplete fields
 *
 * @example
 * const result = validateInitiativeCompleteness(initiative);
 * if (result.warnings.length > 0) {
 *   console.warn('Initiative is incomplete:', result.warnings);
 * }
 */
export function validateInitiativeCompleteness(
  initiative: InitiativeDoc,
): InitiativeCompletenessResult {
  const warnings: string[] = [];
  const id = initiative.id || 'unknown';

  // Check description
  if (!initiative.description || initiative.description.trim() === '') {
    warnings.push(
      `[${id}] Initiative has no description. Add a description to explain its purpose.`,
    );
  }

  // Check phases
  if (!initiative.phases || initiative.phases.length === 0) {
    warnings.push(`[${id}] Initiative has no phases defined. Add phases to break down the work.`);
  }

  // Check success_metrics
  if (!initiative.success_metrics || initiative.success_metrics.length === 0) {
    warnings.push(
      `[${id}] Initiative has no success_metrics defined. Add metrics to measure completion.`,
    );
  }

  return {
    valid: true, // Always valid - issues are warnings not errors
    warnings,
  };
}

/**
 * Checks if an initiative has phases defined.
 *
 * Used by wu:create --initiative to warn when linking WUs to
 * initiatives without phases.
 *
 * @param initiative - Initiative document to check
 * @returns Check result with warning if no phases
 *
 * @example
 * const result = checkInitiativePhases(initiative);
 * if (!result.hasPhases) {
 *   console.warn(result.warning);
 * }
 */
export function checkInitiativePhases(initiative: InitiativeDoc): InitiativePhaseCheck {
  const hasPhases = Array.isArray(initiative.phases) && initiative.phases.length > 0;
  const id = initiative.id || 'unknown';

  return {
    hasPhases,
    warning: hasPhases
      ? null
      : `Initiative ${id} has no phases defined. Consider adding phases before linking WUs.`,
  };
}

/**
 * Determines if an initiative status should progress based on WU activity.
 *
 * Auto-progression rules:
 * - draft -> in_progress: when first WU is claimed (status: in_progress)
 * - open -> in_progress: when first WU is claimed (status: in_progress)
 *
 * Terminal statuses (done, archived) never progress.
 *
 * @param initiative - Initiative document to check
 * @param wus - Array of WUs (all WUs, filtering is done internally)
 * @returns Check result with new status if progression is needed
 *
 * @example
 * const result = shouldProgressInitiativeStatus(initiative, allWUs);
 * if (result.shouldProgress) {
 *   initiative.status = result.newStatus;
 *   // Save initiative
 * }
 */
export function shouldProgressInitiativeStatus(
  initiative: InitiativeDoc,
  wus: WUDoc[],
): InitiativeProgressCheck {
  const currentStatus = initiative.status || 'draft';
  const initiativeId = initiative.id;

  // Terminal statuses cannot progress
  if (!PROGRESSABLE_STATUSES.includes(currentStatus)) {
    return {
      shouldProgress: false,
      newStatus: null,
    };
  }

  // Filter WUs belonging to this initiative
  const initiativeWUs = wus.filter((wu) => wu.initiative === initiativeId);

  // Check if any WU is actively being worked on
  const hasActiveWU = initiativeWUs.some((wu) =>
    PROGRESSABLE_WU_STATUSES.includes(wu.status || ''),
  );

  if (hasActiveWU) {
    return {
      shouldProgress: true,
      newStatus: 'in_progress',
    };
  }

  return {
    shouldProgress: false,
    newStatus: null,
  };
}

/**
 * Finds incomplete initiatives for state:doctor reporting.
 *
 * @param initiatives - Array of initiative documents
 * @returns Array of incomplete initiative reports
 */
export function findIncompleteInitiatives(
  initiatives: InitiativeDoc[],
): Array<{ id: string; warnings: string[] }> {
  const incompleteList: Array<{ id: string; warnings: string[] }> = [];

  for (const init of initiatives) {
    const result = validateInitiativeCompleteness(init);
    if (result.warnings.length > 0) {
      incompleteList.push({
        id: init.id || 'unknown',
        warnings: result.warnings,
      });
    }
  }

  return incompleteList;
}
