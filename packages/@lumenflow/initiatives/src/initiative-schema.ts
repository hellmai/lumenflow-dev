/**
 * Initiative YAML Schema (WU-1246)
 *
 * Zod schema for runtime validation of Initiative YAML structure.
 * Part of the Initiative System Phase 1 - Schema & Validation Foundation.
 *
 * @see {@link tools/validate.mjs} - Consumer (CI validation)
 * @see {@link tools/lib/initiative-validator.mjs} - Consumer (dependency graph validation)
 * @see {@link docs/04-operations/tasks/initiatives/} - Initiative YAML files
 */

import { z } from 'zod';
import {
  INIT_STATUSES,
  PHASE_STATUSES,
  PRIORITIES,
  INIT_PATTERNS,
} from './initiative-constants.js';

/**
 * Date format pattern (YYYY-MM-DD)
 * Note: Kept local as it's only used in schema validation, not elsewhere
 */
const DATE_PATTERN = INIT_PATTERNS.DATE;

/**
 * Zod schema for Initiative Phase
 *
 * Phases are optional subdivisions within an initiative.
 * Sequence matters - phases are ordered by id.
 */
export const InitiativePhaseSchema = z.object({
  /** Phase number (non-negative integer, determines sequence; 0 valid for foundation phases) */
  id: z.number().int().nonnegative({ message: 'Phase id must be a non-negative integer' }),

  /** Phase title */
  title: z.string().min(1, { message: 'Phase title is required' }),

  /** Phase status */
  status: z.enum(PHASE_STATUSES, {
    errorMap: () => ({ message: `Status must be one of: ${PHASE_STATUSES.join(', ')}` }),
  }),
});

/**
 * Zod schema for Initiative YAML structure
 *
 * Initiatives group related WUs for visualization, progress tracking,
 * and dependency management.
 */
export const InitiativeSchema = z.object({
  /** Initiative identifier (INIT-NNN or INIT-NAME format) */
  id: z
    .string()
    .regex(INIT_PATTERNS.INIT_ID, { message: 'ID must match pattern INIT-NNN or INIT-NAME' }),

  /** Kebab-case unique identifier for URLs and references */
  slug: z
    .string()
    .regex(INIT_PATTERNS.SLUG, { message: 'Slug must be kebab-case (e.g., shock-protocol)' }),

  /** Initiative title */
  title: z.string().min(1, { message: 'Title is required' }),

  /** Detailed description (optional) */
  description: z.string().optional(),

  /** Initiative lifecycle status */
  status: z.enum(INIT_STATUSES, {
    errorMap: () => ({ message: `Status must be one of: ${INIT_STATUSES.join(', ')}` }),
  }),

  /** Priority level (optional) */
  priority: z
    .enum(PRIORITIES, {
      errorMap: () => ({ message: `Priority must be one of: ${PRIORITIES.join(', ')}` }),
    })
    .optional(),

  /** Owner (team or individual, optional) */
  owner: z.string().optional(),

  /** Creation date (YYYY-MM-DD) */
  created: z.string().regex(DATE_PATTERN, { message: 'Created must be YYYY-MM-DD format' }),

  /** Target completion date (optional, YYYY-MM-DD) */
  target_date: z
    .string()
    .regex(DATE_PATTERN, { message: 'Target date must be YYYY-MM-DD format' })
    .optional(),

  /** Ordered phases within the initiative (optional) */
  phases: z.array(InitiativePhaseSchema).optional(),

  /** Success metrics for completion (optional) */
  success_metrics: z.array(z.string()).optional(),

  /** Labels for cross-cutting concerns (optional) */
  labels: z.array(z.string()).optional(),

  /** Linked WU IDs (optional, bidirectional link with WU.initiative field) */
  wus: z.array(z.string()).optional(),
});

/**
 * TypeScript type inferred from schema
 *
 * @typedef {import('zod').z.infer<typeof InitiativeSchema>} Initiative
 * @typedef {import('zod').z.infer<typeof InitiativePhaseSchema>} InitiativePhase
 */

/**
 * Validates Initiative data against schema
 *
 * @param {unknown} data - Parsed YAML data to validate
 * @returns {z.SafeParseReturnType<Initiative, Initiative>} Validation result
 *
 * @example
 * const result = validateInitiative(yamlData);
 * if (!result.success) {
 *   result.error.issues.forEach(issue => {
 *     console.error(`${issue.path.join('.')}: ${issue.message}`);
 *   });
 * }
 */
export function validateInitiative(data) {
  return InitiativeSchema.safeParse(data);
}
