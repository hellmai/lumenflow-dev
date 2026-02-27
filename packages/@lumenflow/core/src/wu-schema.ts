// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Work Unit YAML Schema
 *
 * Zod schema for runtime validation of WU YAML structure.
 * Provides compile-time type inference and semantic validation.
 *
 * Part of WU-1162: Add Zod schema validation to prevent placeholder WU completions
 * Part of WU-1539: Add BaseWUSchema pattern for create/edit validation
 *
 * Schema Architecture (DRY pattern):
 * - BaseWUSchema: Structural validation only (field types, formats, lengths)
 * - WUSchema: Extends base + placeholder rejection (for wu:claim, wu:done)
 * - ReadyWUSchema: Alias for BaseWUSchema (for wu:create, wu:edit)
 *
 * @see {@link packages/@lumenflow/cli/src/wu-done.ts} - Consumer (validates spec completeness, uses WUSchema)
 * @see {@link packages/@lumenflow/cli/src/wu-claim.ts} - Consumer (validates spec completeness, uses WUSchema)
 * @see {@link packages/@lumenflow/cli/src/wu-create.ts} - Consumer (structural validation, uses ReadyWUSchema)
 * @see {@link packages/@lumenflow/cli/src/wu-edit.ts} - Consumer (structural validation, uses ReadyWUSchema)
 * @see {@link packages/@lumenflow/cli/src/validate.ts} - Consumer (CI validation)
 * @see {@link apps/web/src/lib/llm/schemas/orchestrator.ts} - Pattern reference
 */

import { z } from 'zod';
import {
  WU_STATUS_GROUPS,
  WU_DEFAULTS,
  STRING_LITERALS,
  WU_EXPOSURE_VALUES,
} from './wu-constants.js';
import { createWuPaths } from './wu-paths.js';
import { normalizeISODateTime } from './date-utils.js';
import { getConfig } from './lumenflow-config.js';

/**
 * Valid WU status values derived from WU_STATUS constant (DRY principle)
 * Used for Zod enum validation with improved error messages
 * Note: Defined as tuple for Zod enum compatibility
 */
const VALID_STATUSES = [
  'todo',
  'ready',
  'backlog',
  'in_progress',
  'blocked',
  'done',
  'completed',
  'cancelled',
  'abandoned',
  'deferred',
  'closed',
  'superseded',
] as const;

/**
 * Placeholder sentinel constant
 *
 * Used in wu:create template generation and validation.
 * Single source of truth for placeholder detection (DRY principle).
 *
 * @example
 * // tools/wu-create.ts
 * description: `${PLACEHOLDER_SENTINEL} Describe the work...`
 *
 * @example
 * // tools/validate.ts
 * if (doc.description.includes(PLACEHOLDER_SENTINEL)) { error(); }
 */
export const PLACEHOLDER_SENTINEL = '[PLACEHOLDER]';

/**
 * Minimum description length requirement
 * Stored as constant for DRY error message generation
 */
const MIN_DESCRIPTION_LENGTH = 50;

/**
 * WU ID format validation message (DRY principle)
 * Used across blocks, blocked_by, and ui_pairing_wus fields
 */
const WU_ID_FORMAT_MESSAGE = 'Must be WU-XXX format';

/**
 * Acceptance criterion error message
 * Stored as constant for DRY error message generation (sonarjs/no-duplicate-string)
 */
const ACCEPTANCE_REQUIRED_MSG = 'At least one acceptance criterion required';

interface WUDoneValidationInput {
  type?: string;
  code_paths?: string[];
}

interface WUEscalationInput {
  id: string;
  lane?: string;
  code_paths?: string[];
  priority?: string;
  escalation_triggers?: string[];
  requires_human_escalation?: boolean;
  escalation_resolved_by?: string;
  escalation_resolved_at?: string;
  requires_cso_approval?: boolean;
  requires_cto_approval?: boolean;
  requires_design_approval?: boolean;
}

interface WUCompletenessInput {
  id: string;
  status?: string;
  type?: string;
  notes?: string;
  tests?: {
    manual?: string[];
  };
  spec_refs?: unknown;
}

interface WUNormalizationInput {
  description?: unknown;
  code_paths?: unknown;
  acceptance?: unknown;
}

type EscalationDetectionInput = Pick<WUEscalationInput, 'lane' | 'code_paths' | 'priority'>;

// =============================================================================
// WU-1750: NORMALIZATION TRANSFORMS (Watertight YAML validation)
// =============================================================================

/**
 * Regex pattern matching embedded newlines (both literal and escaped)
 * Handles: "a\nb" (literal newline) and "a\\nb" (escaped backslash-n)
 */
const NEWLINE_PATTERN = /\\n|\n/;

/**
 * Transform: Normalize string arrays by splitting embedded newlines
 *
 * WU-1750: Agents sometimes pass multi-item content as single strings with \n.
 * This transform auto-repairs: ["a\nb\nc"] → ["a", "b", "c"]
 *
 * @example
 * // Input: ["tools/a.ts\ntools/b.js"]
 * // Output: ["tools/a.js", "tools/b.js"]
 */
const normalizedStringArray = z.array(z.string()).transform((arr) =>
  arr
    .flatMap((s) => s.split(NEWLINE_PATTERN))
    .map((s) => s.trim())
    .filter(Boolean),
);

/**
 * Transform: Normalize description/notes strings by converting escaped newlines
 *
 * WU-1750: YAML quoted strings preserve literal \\n as two characters.
 * This transform converts them to actual newlines: "a\\n\\nb" → "a\n\nb"
 *
 * @example
 * // Input: "Problem:\\n\\n1. First issue"
 * // Output: "Problem:\n\n1. First issue"
 */
const _normalizedMultilineString = z.string().transform((s) => s.replace(/\\n/g, '\n'));

/**
 * Refinement: File path cannot contain newlines (post-normalization safety check)
 *
 * WU-1750: After normalization, paths should be clean. This catches UnsafeAny edge cases.
 */
const filePathItem = z.string().refine((s) => !s.includes('\n') && !s.includes('\\n'), {
  message: 'File path cannot contain newlines - split into separate array items',
});

/**
 * Normalized code_paths: split embedded newlines + validate each path
 */
const normalizedCodePaths = normalizedStringArray.pipe(z.array(filePathItem)).default([]);

/**
 * Normalized test paths object: all test arrays normalized
 */
const normalizedTestPaths = z
  .object({
    manual: normalizedStringArray.optional(),
    unit: normalizedStringArray.optional(),
    integration: normalizedStringArray.optional(),
    e2e: normalizedStringArray.optional(),
  })
  .optional();

// =============================================================================
// BASE FIELD DEFINITIONS (DRY - shared between BaseWUSchema and WUSchema)
// =============================================================================

/**
 * Base description field (structural validation only)
 * WU-1539: Fixed template string bug (single quotes → function message)
 * WU-1750: Added normalization of escaped newlines (\\n → actual newlines)
 */
const baseDescriptionField = z
  .string()
  .min(1, 'Description is required')
  .transform((s) => s.replace(/\\n/g, '\n')) // WU-1750: Normalize escaped newlines
  .refine((val) => val.trim().length >= MIN_DESCRIPTION_LENGTH, {
    // WU-1539 fix: Use function message for dynamic interpolation
    message: `Description must be at least ${MIN_DESCRIPTION_LENGTH} characters`,
  });

/**
 * Strict description field (with placeholder rejection)
 * Used by wu:claim and wu:done to ensure placeholders are filled
 * WU-1750: Added normalization of escaped newlines (\\n → actual newlines)
 */
const strictDescriptionField = z
  .string()
  .min(1, 'Description is required')
  .transform((s) => s.replace(/\\n/g, '\n')) // WU-1750: Normalize escaped newlines
  .refine((val) => !val.includes(PLACEHOLDER_SENTINEL), {
    message: `Description cannot contain ${PLACEHOLDER_SENTINEL} marker`,
  })
  .refine((val) => val.trim().length >= MIN_DESCRIPTION_LENGTH, {
    // WU-1539 fix: Use function message for dynamic interpolation
    message: `Description must be at least ${MIN_DESCRIPTION_LENGTH} characters`,
  });

/**
 * Recursive helper: Check all nested values for at least one item
 * Shared between base and strict acceptance schemas
 */
const hasItems = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).some(hasItems);
  }
  return false;
};

/**
 * Recursive helper: Check all strings for PLACEHOLDER_SENTINEL
 * Used only by strict acceptance schema
 */
const checkStringsForPlaceholder = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return !value.includes(PLACEHOLDER_SENTINEL);
  }
  if (Array.isArray(value)) {
    return value.every(checkStringsForPlaceholder);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).every(checkStringsForPlaceholder);
  }
  return true;
};

/**
 * Base acceptance field (structural validation only)
 * Validates format but allows placeholder markers
 * WU-1750: Added normalization of embedded newlines in array items
 */
const baseAcceptanceField = z.union([
  // Flat array format (legacy): acceptance: ["item1", "item2"]
  // WU-1750: Normalize embedded newlines: ["1. a\n2. b"] → ["1. a", "2. b"]
  normalizedStringArray.pipe(z.array(z.string()).min(1, ACCEPTANCE_REQUIRED_MSG)),
  // Nested object format (structured): acceptance: { category1: ["item1"], category2: ["item2"] }
  z.record(z.string(), normalizedStringArray).refine((obj) => Object.values(obj).some(hasItems), {
    message: ACCEPTANCE_REQUIRED_MSG,
  }),
]);

/**
 * Strict acceptance field (with placeholder rejection)
 * Used by wu:claim and wu:done to ensure placeholders are filled
 * WU-1750: Added normalization of embedded newlines in array items
 */
const strictAcceptanceField = z.union([
  // Flat array format (legacy): acceptance: ["item1", "item2"]
  // WU-1750: Normalize embedded newlines: ["1. a\n2. b"] → ["1. a", "2. b"]
  normalizedStringArray
    .pipe(z.array(z.string()).min(1, ACCEPTANCE_REQUIRED_MSG))
    .refine((arr) => !arr.some((item) => item.includes(PLACEHOLDER_SENTINEL)), {
      message: `Acceptance criteria cannot contain ${PLACEHOLDER_SENTINEL} markers`,
    }),
  // Nested object format (structured): acceptance: { category1: ["item1"], category2: ["item2"] }
  z
    .record(z.string(), normalizedStringArray)
    .refine((obj) => Object.values(obj).some(hasItems), {
      message: ACCEPTANCE_REQUIRED_MSG,
    })
    .refine((obj) => checkStringsForPlaceholder(obj), {
      message: `Acceptance criteria cannot contain ${PLACEHOLDER_SENTINEL} markers`,
    }),
]);

/**
 * Shared field definitions (same for both base and strict schemas)
 * DRY: Defined once, used in both schema variants
 */
const sharedFields = {
  /** WU identifier (e.g., WU-1162) */
  id: z.string().regex(/^WU-\d+$/, 'ID must match pattern WU-XXX'),

  /** Short title describing the work */
  title: z.string().min(1, 'Title is required'),

  /** Lane assignment (parent or sub-lane) */
  lane: z.string().min(1, 'Lane is required'),

  /** Work type classification */
  type: z
    .enum(['feature', 'bug', 'documentation', 'process', 'tooling', 'chore', 'refactor'] as const, {
      error: 'Invalid type',
    })
    .default(
      WU_DEFAULTS.type as
        | 'feature'
        | 'bug'
        | 'documentation'
        | 'process'
        | 'tooling'
        | 'chore'
        | 'refactor',
    ),

  /** Current status in workflow */
  status: z
    .enum(VALID_STATUSES, {
      error: `Invalid status. Valid values: ${VALID_STATUSES.join(', ')}`,
    })
    .default(WU_DEFAULTS.status as (typeof VALID_STATUSES)[number]),

  /** Priority level */
  priority: z
    .enum(['P0', 'P1', 'P2', 'P3'] as const, {
      error: 'Invalid priority',
    })
    .default(WU_DEFAULTS.priority as 'P0' | 'P1' | 'P2' | 'P3'),

  /** Creation date (YYYY-MM-DD) */
  created: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Created must be YYYY-MM-DD'),

  /** Files modified by this WU - WU-1750: Normalized to split embedded newlines */
  code_paths: normalizedCodePaths,

  /** Test specifications - WU-1750: All test arrays normalized */
  tests: normalizedTestPaths.default(WU_DEFAULTS.tests),

  /** Output artifacts (stamps, docs, etc.) - WU-1750: Normalized */
  artifacts: normalizedStringArray.optional().default(WU_DEFAULTS.artifacts),

  /** Upstream WU dependencies (informational, legacy field) - WU-1750: Normalized */
  dependencies: normalizedStringArray.optional().default(WU_DEFAULTS.dependencies),

  // === Initiative System Fields (WU-1246) ===

  /** Parent initiative reference (format: INIT-{number} or slug) */
  initiative: z.string().optional(),

  /** Phase number within parent initiative */
  phase: z.number().int().positive().optional(),

  /** WU IDs that this WU blocks (downstream dependencies) - WU-1750: Normalized + validated */
  blocks: normalizedStringArray
    .pipe(z.array(z.string().regex(/^WU-\d+$/, WU_ID_FORMAT_MESSAGE)))
    .optional(),

  /** WU IDs that block this WU (upstream dependencies) - WU-1750: Normalized + validated */
  blocked_by: normalizedStringArray
    .pipe(z.array(z.string().regex(/^WU-\d+$/, WU_ID_FORMAT_MESSAGE)))
    .optional(),

  /** Cross-cutting tags (orthogonal to initiative) - WU-1750: Normalized */
  labels: normalizedStringArray.optional(),

  // === End Initiative System Fields ===

  /**
   * WU-1683: First-class plan field, symmetric with initiative `related_plan`.
   * Set via wu:create --plan, wu:edit --plan, or plan:link --id WU-XXX.
   */
  plan: z.string().optional(),

  /**
   * WU-1833: References to plans, design docs, external specifications
   * WU-1834: Supports both flat string array AND nested object format for backwards compatibility
   *
   * Flat format (WU-1833+):  ['docs/plans/WU-XXX-plan.md']
   * Nested format (legacy):  [{file: 'docs/path.md', section: 'heading'}]
   * Mixed format allowed:    ['path.md', {section: 'heading'}]
   * Bare object (WU-428):    {file: 'docs/path.md', section: 'heading'}
   */
  spec_refs: z
    .union([
      // Single object format (WU-428 style): {file: '...', section: '...'}
      z.object({
        file: z.string().optional(),
        section: z.string(),
      }),
      // Array format (WU-1833+): strings, objects, or mixed
      z.array(
        z.union([
          z.string(), // Flat format: 'docs/path.md'
          z.object({
            // Nested format: {file: 'path', section: 'heading'}
            file: z.string().optional(),
            section: z.string(),
          }),
        ]),
      ),
    ])
    .optional(),

  /** Known risks or constraints - WU-1750: Normalized */
  risks: normalizedStringArray.optional().default(WU_DEFAULTS.risks),

  /**
   * Free-form notes - supports string or array (auto-converted to string)
   * WU-1750: Normalizes escaped newlines (\\n → actual newlines)
   */
  notes: z
    .union([
      z.string(),
      z.array(z.string()), // Legacy array format - will be converted
    ])
    .optional()
    .transform((val) => {
      // Convert array to newline-joined string (legacy format)
      if (Array.isArray(val)) {
        return val.filter((s) => s.trim().length > 0).join(STRING_LITERALS.NEWLINE);
      }
      // WU-1750: Normalize escaped newlines in string format
      if (typeof val === 'string') {
        return val.replace(/\\n/g, '\n');
      }
      return val ?? WU_DEFAULTS.notes;
    }),

  /** Requires human review before merge */
  requires_review: z.boolean().optional().default(WU_DEFAULTS.requires_review),

  /** Locked state (done WUs only) */
  locked: z.boolean().optional(),

  /** Completion date (done WUs only) - auto-normalized to ISO datetime */
  completed_at: z
    .string()
    .optional()
    .transform((val) => normalizeISODateTime(val)),

  /** Claimed mode (worktree/branch-only/worktree-pr/branch-pr) */
  claimed_mode: z.enum(['worktree', 'branch-only', 'worktree-pr', 'branch-pr']).optional(),

  /**
   * WU-1589: Canonical branch name for this WU claim.
   *
   * Set at claim time to record the actual branch used.
   * Used by defaultBranchFrom() as highest-priority source for branch resolution.
   * Essential for branch-pr mode where cloud agents may use non-lane-derived branch names.
   * Cleared on rollback/release/recover when resetting to ready.
   */
  claimed_branch: z.string().optional(),

  /** Assigned agent email */
  assigned_to: z.string().email().optional(),

  /** Claim timestamp - auto-normalized to ISO datetime */
  claimed_at: z
    .string()
    .optional()
    .transform((val) => normalizeISODateTime(val)),

  /** Block reason (blocked WUs only) */
  blocked_reason: z.string().optional(),

  /** Worktree path (claimed WUs only) */
  worktree_path: z.string().optional(),

  /** Current active session ID (WU-1438: auto-set on claim, cleared on done) */
  session_id: z.string().uuid().optional(),

  /** Agent sessions (issue logging metadata, WU-1231) */
  agent_sessions: z
    .array(
      z.object({
        session_id: z.string().uuid(),
        started: z.string().datetime(),
        completed: z.string().datetime().optional(),
        agent_type: z.enum([
          'claude-code',
          'codex-cli',
          'cursor',
          'gemini-cli',
          'windsurf',
          'copilot',
          'other',
        ]),
        context_tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        incidents_logged: z.number().int().min(0).default(0),
        incidents_major: z.number().int().min(0).default(0),
        artifacts: z.array(z.string()).optional(),
      }),
    )
    .optional(),

  // === Exposure System Fields (WU-1998) ===

  /**
   * WU-1998: Exposure level - defines how the WU exposes functionality to users
   *
   * Valid values:
   * - 'ui': User-facing UI changes (pages, components, widgets)
   * - 'api': API endpoints called by UI or external clients
   * - 'backend-only': Backend-only changes (no user visibility)
   * - 'documentation': Documentation changes only
   *
   * Optional during transition period, will become required after backlog update.
   */
  exposure: z
    .enum(WU_EXPOSURE_VALUES, {
      error: `Invalid exposure value. Valid values: ${WU_EXPOSURE_VALUES.join(', ')}`,
    })
    .optional(),

  /**
   * WU-1998: User journey description for user-facing WUs
   *
   * Recommended for exposure: 'ui' and 'api'.
   * Describes the end-user interaction flow affected by this WU.
   */
  user_journey: z.string().optional(),

  /**
   * WU-1998: Related UI WUs for backend/API changes
   *
   * For WUs with exposure: 'api', this field lists UI WUs that consume the API.
   * Ensures backend features have corresponding UI coverage.
   * Each entry must match WU-XXX format.
   */
  ui_pairing_wus: normalizedStringArray
    .pipe(z.array(z.string().regex(/^WU-\d+$/, WU_ID_FORMAT_MESSAGE)))
    .optional(),

  /**
   * WU-2022: Navigation path for UI-exposed features
   *
   * For WUs with exposure: 'ui', specifies the route where the feature is accessible.
   * Used by wu:done to verify that UI features are actually navigable.
   * Prevents "orphaned code" where features exist but users cannot access them.
   *
   * Example: '/dashboard', '/settings/preferences', '/space'
   */
  navigation_path: z.string().optional(),

  // === End Exposure System Fields ===

  // === Sizing Estimate Fields (WU-2141) ===

  /**
   * WU-2141: Optional sizing estimate metadata.
   *
   * Records expected WU complexity for tooling-backed sizing enforcement.
   * Absent for historical WUs (backward compatible).
   *
   * Fields:
   * - estimated_files: Expected number of files to modify
   * - estimated_tool_calls: Expected tool call count
   * - strategy: Execution strategy from wu-sizing-guide.md
   * - exception_type: Override type when thresholds intentionally exceeded
   * - exception_reason: Justification for the exception (required with exception_type)
   */
  sizing_estimate: z
    .object({
      estimated_files: z.number().int().min(0),
      estimated_tool_calls: z.number().int().min(0),
      strategy: z.enum([
        'single-session',
        'checkpoint-resume',
        'orchestrator-worker',
        'decomposition',
      ]),
      exception_type: z.enum(['docs-only', 'shallow-multi-file']).optional(),
      exception_reason: z.string().optional(),
    })
    .refine(
      (data) => {
        if (data.exception_type !== undefined) {
          return data.exception_reason !== undefined && data.exception_reason.trim().length > 0;
        }
        return true;
      },
      {
        message:
          'sizing_estimate.exception_reason is required and must be non-empty when exception_type is set',
        path: ['exception_reason'],
      },
    )
    .optional(),

  // === End Sizing Estimate Fields ===

  // === Agent-First Approval Fields (WU-2079 → WU-2080) ===

  /**
   * WU-2080: Escalation triggers detected for this WU
   *
   * Agent-first model: agents auto-approve by default.
   * Human escalation only when these triggers are detected:
   * - sensitive_data: Changes to sensitive data handling
   * - security_p0: P0 security incident or vulnerability
   * - budget: Budget/resource allocation above threshold
   * - cross_lane_arch: Cross-lane architectural decision
   *
   * Empty array = no escalation needed, agent proceeds autonomously.
   */
  escalation_triggers: z
    .array(z.enum(['sensitive_data', 'security_p0', 'budget', 'cross_lane_arch']))
    .optional()
    .default([]),

  /**
   * WU-2080: Human escalation required flag
   *
   * Auto-set to true when escalation_triggers is non-empty.
   * When true, wu:done requires human confirmation before completion.
   */
  requires_human_escalation: z.boolean().optional().default(false),

  /**
   * WU-2080: Email(s) of approvers who signed off
   *
   * Auto-populated with claiming agent at wu:claim.
   * Additional human approvers added when escalation is resolved.
   */
  approved_by: z.array(z.string().email()).optional(),

  /**
   * WU-2080: Timestamp when approval was granted
   *
   * Auto-set at wu:claim for agent auto-approval.
   * Updated when human escalation is resolved.
   */
  approved_at: z
    .string()
    .optional()
    .transform((val) => normalizeISODateTime(val)),

  /**
   * WU-2080: Human who resolved escalation (if UnsafeAny)
   *
   * Only set when requires_human_escalation was true and resolved.
   */
  escalation_resolved_by: z.string().email().optional(),

  /**
   * WU-2080: Timestamp when human resolved escalation
   */
  escalation_resolved_at: z
    .string()
    .optional()
    .transform((val) => normalizeISODateTime(val)),

  // Legacy fields (deprecated, kept for backwards compatibility)
  /** @deprecated Use escalation_triggers instead */
  requires_cso_approval: z.boolean().optional().default(false),
  /** @deprecated Use escalation_triggers instead */
  requires_cto_approval: z.boolean().optional().default(false),
  /** @deprecated Use escalation_triggers instead */
  requires_design_approval: z.boolean().optional().default(false),

  // === End Agent-First Approval Fields ===
};

// =============================================================================
// SCHEMA DEFINITIONS
// =============================================================================

/**
 * Base WU Schema (structural validation only)
 *
 * WU-1539: Used by wu:create and wu:edit for fail-fast structural validation.
 * Allows placeholder markers - only checks field types, formats, and lengths.
 *
 * Use case: Validate WU structure at creation/edit time before placeholders are filled.
 */
export const BaseWUSchema = z.object({
  ...sharedFields,
  description: baseDescriptionField,
  acceptance: baseAcceptanceField,
});

/**
 * Ready WU Schema (alias for BaseWUSchema)
 *
 * WU-1539: Semantic alias for clarity in wu:create and wu:edit.
 * Same validation as BaseWUSchema - allows placeholders, enforces structure.
 */
export const ReadyWUSchema = BaseWUSchema;

/**
 * Strict WU Schema (structural + placeholder rejection)
 *
 * Validates WU files against LumenFlow requirements:
 * - No placeholder text in done WUs
 * - Minimum description length (50 chars)
 * - Code paths present for non-documentation WUs
 * - Proper status/lane/type enums
 *
 * Used by wu:claim and wu:done to ensure specs are complete.
 * Provides runtime validation and TypeScript type inference.
 */
export const WUSchema = z.object({
  ...sharedFields,
  description: strictDescriptionField,
  acceptance: strictAcceptanceField,
});

/**
 * TypeScript type inferred from schema
 *
 * Single source of truth for both runtime validation and compile-time types.
 * Replaces manual WU interfaces (DRY principle).
 *
 * Note: Type inference available in TypeScript via z.infer<typeof WUSchema>
 * This is a JavaScript file, so the type export is not needed here.
 *
 * @typedef {import('zod').z.infer<typeof WUSchema>} WU
 */

/**
 * Validates WU data against strict schema (placeholder rejection)
 *
 * Used by wu:claim and wu:done to ensure specs are complete.
 * Rejects WUs with placeholder markers.
 *
 * @param {unknown} data - Parsed YAML data to validate
 * @returns {z.SafeParseReturnType<WU, WU>} Validation result
 *
 * @example
 * const result = validateWU(yamlData);
 * if (!result.success) {
 *   result.error.issues.forEach(issue => {
 *     console.error(`${issue.path.join('.')}: ${issue.message}`);
 *   });
 * }
 */
export function validateWU(data: unknown) {
  return WUSchema.safeParse(data);
}

/**
 * Validates WU data against base schema (structural only)
 *
 * WU-1539: Used by wu:create and wu:edit for fail-fast structural validation.
 * Allows placeholder markers - only checks field types, formats, and lengths.
 *
 * @param {unknown} data - Parsed YAML data to validate
 * @returns {z.SafeParseReturnType<WU, WU>} Validation result
 *
 * @example
 * const result = validateReadyWU(yamlData);
 * if (!result.success) {
 *   const errors = result.error.issues
 *     .map(issue => `  • ${issue.path.join('.')}: ${issue.message}`)
 *     .join('\n');
 *   die(`WU YAML validation failed:\n\n${errors}`);
 * }
 */
export function validateReadyWU(data: unknown) {
  return ReadyWUSchema.safeParse(data);
}

/**
 * Validates WU spec completeness for done status
 *
 * Additional validation beyond schema for WUs marked as done:
 * - Code paths required for non-documentation WUs
 * - Locked must be true
 * - Completed timestamp must be present
 *
 * @param {WU} wu - Validated WU data
 * @returns {{valid: boolean, errors: string[]}} Validation result
 *
 * @example
 * const schemaResult = validateWU(data);
 * if (schemaResult.success && data.status === 'done') {
 *   const completenessResult = validateDoneWU(schemaResult.data);
 *   if (!completenessResult.valid) {
 *     console.error(completenessResult.errors);
 *   }
 * }
 */
export function validateDoneWU(wu: WUDoneValidationInput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check code_paths for non-documentation WUs
  if (wu.type !== 'documentation' && wu.type !== 'process') {
    if (!wu.code_paths || wu.code_paths.length === 0) {
      errors.push('Code paths required for non-documentation WUs');
    }
  }

  // Note: locked and completed_at are set automatically by wu:done
  // No need to validate them here (they don't exist yet at validation time)

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * WU-2122: Get escalation email from workspace.yaml configuration.
 *
 * Reads `software_delivery.escalation.email` via getConfig() with a
 * sensible fallback default defined in EscalationConfigSchema.
 *
 * @returns Configured escalation email address
 */
function getEscalationEmail(): string {
  return getConfig().escalation.email;
}

/**
 * WU-2080: Valid escalation trigger types
 *
 * These are the only conditions that require human intervention.
 * Everything else is auto-approved by agents.
 */
export const ESCALATION_TRIGGER_TYPES = [
  'sensitive_data', // Sensitive data handling changes
  'security_p0', // P0 security incident
  'budget', // Budget/resource above threshold
  'cross_lane_arch', // Cross-lane architectural decision
];

/**
 * WU-2080: Agent-first approval validation
 *
 * AGENT-FIRST MODEL: Agents auto-approve by default.
 * Human escalation only when escalation_triggers is non-empty
 * AND requires_human_escalation is true AND not yet resolved.
 *
 * Returns:
 * - valid: true if agent can proceed (no unresolved escalation)
 * - errors: blocking issues requiring human resolution
 * - warnings: advisory messages (non-blocking)
 *
 * @param {object} wu - Validated WU data
 * @returns {{valid: boolean, errors: string[], warnings: string[]}}
 */
export function validateApprovalGates(wu: WUEscalationInput): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Agent-first: check for unresolved escalation triggers
  const triggers = wu.escalation_triggers || [];
  const requiresEscalation = wu.requires_human_escalation || triggers.length > 0;

  if (requiresEscalation) {
    // Check if escalation was resolved by human
    const resolved = wu.escalation_resolved_by && wu.escalation_resolved_at;

    if (!resolved) {
      errors.push(
        `Human escalation required for: ${triggers.join(', ')}\n` +
          `   To resolve: pnpm wu:escalate --resolve --id ${wu.id}`,
      );
    }
  }

  // Legacy backwards compatibility: map old fields to new model
  if (wu.requires_cso_approval || wu.requires_cto_approval || wu.requires_design_approval) {
    warnings.push(
      'Using deprecated requires_X_approval fields. Migrate to escalation_triggers model.',
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * WU-2080: Detect escalation triggers from WU content
 *
 * Analyzes WU metadata to detect conditions requiring human escalation.
 * Called by wu:claim to auto-set escalation_triggers.
 *
 * @param {object} wu - WU data with lane, type, code_paths
 * @returns {string[]} Array of triggered escalation types
 */
export function detectEscalationTriggers(wu: EscalationDetectionInput): string[] {
  const triggers: string[] = [];
  const lane = (wu.lane || '').toLowerCase();
  const codePaths = wu.code_paths || [];

  // Sensitive data: Changes to user data or auth
  const sensitivePatterns = ['pii', 'user-data', 'auth', 'credentials'];
  const touchesSensitive = codePaths.some((p) =>
    sensitivePatterns.some((pat) => p.toLowerCase().includes(pat)),
  );
  if (touchesSensitive || lane.includes('pii')) {
    triggers.push('sensitive_data');
  }

  // Security P0: Explicit security lane or auth changes
  if (wu.priority === 'P0' && lane.includes('security')) {
    triggers.push('security_p0');
  }

  return triggers;
}

/**
 * WU-2080: Generate auto-approval metadata for wu:claim
 *
 * Called by wu:claim to auto-approve agents within policy.
 * Sets approved_by and approved_at, detects escalation triggers.
 *
 * @param {object} wu - WU data
 * @param {string} agentEmail - Email of claiming agent
 * @returns {{approved_by: string[], approved_at: string, escalation_triggers: string[], requires_human_escalation: boolean}}
 */
export function generateAutoApproval(
  wu: EscalationDetectionInput,
  agentEmail: string,
): {
  approved_by: string[];
  approved_at: string;
  escalation_triggers: string[];
  requires_human_escalation: boolean;
} {
  const triggers = detectEscalationTriggers(wu);
  const now = new Date().toISOString();

  return {
    approved_by: [agentEmail],
    approved_at: now,
    escalation_triggers: triggers,
    requires_human_escalation: triggers.length > 0,
  };
}

/**
 * @deprecated Use detectEscalationTriggers instead
 * WU-2079: Legacy function for backwards compatibility
 */
export function determineRequiredApprovals(wu: EscalationDetectionInput): {
  requires_cso_approval: boolean;
  requires_cto_approval: boolean;
  requires_design_approval: boolean;
} {
  const triggers = detectEscalationTriggers(wu);
  return {
    requires_cso_approval: triggers.includes('security_p0') || triggers.includes('sensitive_data'),
    requires_cto_approval: triggers.includes('cross_lane_arch'),
    requires_design_approval: false, // Design no longer requires human escalation
  };
}

/**
 * WU-1811: Validates and normalizes WU YAML data with auto-fixable normalisations
 *
 * This function validates the WU YAML schema and applies fixable normalisations:
 * - Trimming whitespace from string fields
 * - Normalizing escaped newlines (\\n → \n)
 * - Splitting embedded newlines in arrays (["a\nb"] → ["a", "b"])
 *
 * Returns:
 * - valid: true if schema validation passes (after normalisations)
 * - normalized: the normalized data (even if validation fails, partial normalization is returned)
 * - errors: validation errors if UnsafeAny
 * - wasNormalized: true if UnsafeAny normalisations were applied
 *
 * @param {unknown} data - Parsed YAML data to validate and normalize
 * @returns {{valid: boolean, normalized: object|null, errors: string[], wasNormalized: boolean}}
 *
 * @example
 * const { valid, normalized, errors, wasNormalized } = validateAndNormalizeWUYAML(yamlData);
 * if (valid && wasNormalized) {
 *   // Write normalized data back to YAML file
 *   writeWU(wuPath, normalized);
 * }
 * if (!valid) {
 *   die(`Validation failed:\n${errors.join('\n')}`);
 * }
 */
export function validateAndNormalizeWUYAML(data: unknown): {
  valid: boolean;
  normalized: z.infer<typeof WUSchema> | null;
  errors: string[];
  wasNormalized: boolean;
} {
  // First try to parse with schema (which applies normalizations)
  const result = WUSchema.safeParse(data);

  if (!result.success) {
    // Schema validation failed - return errors
    const errors = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    return {
      valid: false,
      normalized: null,
      errors,
      wasNormalized: false,
    };
  }

  // Schema passed - check if data was normalized (compare key fields)
  const normalized = result.data;
  const original = typeof data === 'object' && data !== null ? (data as WUNormalizationInput) : {};
  const wasNormalized = detectNormalizationChanges(original, normalized);

  return {
    valid: true,
    normalized,
    errors: [],
    wasNormalized,
  };
}

/**
 * WU-1833: Validate WU spec completeness with advisory warnings
 *
 * Provides soft validation that warns (doesn't fail) when recommended fields are missing.
 * Used by wu:validate command to surface quality issues without blocking workflow.
 *
 * Feature and bug WUs should have:
 * - notes (implementation context, deployment instructions)
 * - tests.manual (verification steps)
 * - spec_refs (links to plans, design docs) - for features only
 *
 * @param {object} wu - Validated WU data (must pass WUSchema first)
 * @returns {{warnings: string[]}} Array of warning messages
 *
 * @example
 * const schemaResult = validateWU(data);
 * if (schemaResult.success) {
 *   const { warnings } = validateWUCompleteness(schemaResult.data);
 *   if (warnings.length > 0) {
 *     console.warn('Quality warnings:');
 *     warnings.forEach(w => console.warn(`  ⚠️  ${w}`));
 *   }
 * }
 */
export function validateWUCompleteness(wu: WUCompletenessInput): { warnings: string[] } {
  const warnings: string[] = [];

  // WU-1384: Skip completeness checks for terminal WUs (done, cancelled, etc.)
  // These are immutable historical records - enforcing completeness is pointless
  const status = wu.status ?? '';
  const isTerminal = WU_STATUS_GROUPS.TERMINAL.includes(status);
  if (isTerminal) {
    return { warnings };
  }

  const type = wu.type || 'feature';

  // Only check feature and bug WUs - docs/chore/process don't need these
  const requiresContext = ['feature', 'bug', 'refactor'].includes(type);

  if (!requiresContext) {
    return { warnings };
  }

  // Check for notes (implementation context)
  if (!wu.notes || wu.notes.trim().length === 0) {
    warnings.push(
      `${wu.id}: Missing 'notes' field. Add implementation context, deployment instructions, or plan links.`,
    );
  }

  // Check for manual tests
  const hasManualTests = wu.tests?.manual && wu.tests.manual.length > 0;
  if (!hasManualTests) {
    warnings.push(
      `${wu.id}: Missing 'tests.manual' field. Add manual verification steps for acceptance criteria.`,
    );
  }

  // Check for spec_refs (features should link to plans/specs)
  // WU-1062: Accepts both repo-relative paths (<configured plansDir>/) and
  // external paths (~/.lumenflow/plans/, $LUMENFLOW_HOME/plans/, lumenflow://plans/)
  if (type === 'feature') {
    const specRefs = wu.spec_refs as { length?: number } | undefined;
    const hasSpecRefs = !!specRefs && (specRefs.length ?? 0) > 0;
    if (!hasSpecRefs) {
      const plansDirHint = `${createWuPaths().PLANS_DIR().replace(/\/+$/, '')}/`;
      warnings.push(
        `${wu.id}: Missing 'spec_refs' field. Link to plan file (${plansDirHint}, lumenflow://plans/, or ~/.lumenflow/plans/) for traceability.`,
      );
    }
  }

  return { warnings };
}

/**
 * WU-1811: Detect if normalizations were applied by comparing original and normalized data
 *
 * Compares fields that are commonly normalized:
 * - description (escaped newlines)
 * - code_paths (embedded newlines split)
 * - acceptance (embedded newlines split)
 *
 * @param {object} original - Original parsed YAML data
 * @param {object} normalized - Schema-normalized data
 * @returns {boolean} True if UnsafeAny normalisations were applied
 */
function detectNormalizationChanges(
  original: WUNormalizationInput,
  normalized: WUNormalizationInput,
): boolean {
  // Compare description (newline normalization)
  if (original.description !== normalized.description) {
    return true;
  }

  // Compare code_paths (array splitting)
  const origPaths = Array.isArray(original.code_paths) ? original.code_paths : [];
  const normPaths = Array.isArray(normalized.code_paths) ? normalized.code_paths : [];
  if (origPaths.length !== normPaths.length) {
    return true;
  }
  for (let i = 0; i < origPaths.length; i++) {
    if (origPaths[i] !== normPaths[i]) {
      return true;
    }
  }

  // Compare acceptance if both are arrays (most common case)
  if (Array.isArray(original.acceptance) && Array.isArray(normalized.acceptance)) {
    if (original.acceptance.length !== normalized.acceptance.length) {
      return true;
    }
    for (let i = 0; i < original.acceptance.length; i++) {
      if (original.acceptance[i] !== normalized.acceptance[i]) {
        return true;
      }
    }
  }

  return false;
}
