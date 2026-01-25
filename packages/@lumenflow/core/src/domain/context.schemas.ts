/**
 * Context Schemas
 *
 * WU-1093: INIT-002 Phase 1 - Define ports and domain schemas
 *
 * Zod schemas for context-related types in the context-aware validation system.
 * Types are inferred from Zod schemas using z.infer<> for single source of truth.
 *
 * @module domain/context.schemas
 */

import { z } from 'zod';

/**
 * Location type enum values
 *
 * Mirrors CONTEXT_VALIDATION.LOCATION_TYPES from wu-constants.ts
 */
export const LOCATION_TYPE_VALUES = ['main', 'worktree', 'detached', 'unknown'] as const;

/**
 * Schema for location types
 */
export const LocationTypeSchema = z.enum(LOCATION_TYPE_VALUES);

/**
 * Schema for location context
 *
 * Captures where the command is being run from and related paths.
 */
export const LocationContextSchema = z.object({
  /** Location type: 'main', 'worktree', 'detached', or 'unknown' */
  type: LocationTypeSchema,
  /** Absolute path to current working directory */
  cwd: z.string(),
  /** Absolute path to git root (top-level of working tree) */
  gitRoot: z.string(),
  /** Absolute path to main checkout (primary repo) */
  mainCheckout: z.string(),
  /** Worktree name if in a worktree (e.g., 'framework-core-wu-1090') */
  worktreeName: z.string().nullable(),
  /** WU ID extracted from worktree path (e.g., 'WU-1090') */
  worktreeWuId: z.string().nullable(),
});

/**
 * Schema for git state
 *
 * Captures the current git state relevant to command execution.
 */
export const GitStateSchema = z.object({
  /** Current branch name (null if detached) */
  branch: z.string().nullable(),
  /** Whether HEAD is detached */
  isDetached: z.boolean(),
  /** Whether working tree has uncommitted changes */
  isDirty: z.boolean(),
  /** Whether there are staged changes */
  hasStaged: z.boolean(),
  /** Commits ahead of tracking branch */
  ahead: z.number().int().min(0),
  /** Commits behind tracking branch */
  behind: z.number().int().min(0),
  /** Tracking branch (e.g., 'origin/main') */
  tracking: z.string().nullable(),
  /** List of modified files */
  modifiedFiles: z.array(z.string()),
  /** Whether an error occurred reading state */
  hasError: z.boolean(),
  /** Error message if hasError is true */
  errorMessage: z.string().nullable(),
});

/**
 * Schema for WU state result
 *
 * Result of reading WU state from YAML and state store.
 */
export const WuStateResultSchema = z.object({
  /** WU ID (uppercase, e.g., 'WU-1090') */
  id: z.string(),
  /** Current status from YAML */
  status: z.string(),
  /** Lane name */
  lane: z.string(),
  /** WU title */
  title: z.string(),
  /** Absolute path to WU YAML file */
  yamlPath: z.string(),
  /** Whether YAML and state store are consistent */
  isConsistent: z.boolean(),
  /** Reason for inconsistency if not consistent */
  inconsistencyReason: z.string().nullable(),
});

/**
 * Schema for session state
 *
 * Session state for active WU work.
 */
export const SessionStateSchema = z.object({
  /** Whether a session is active */
  isActive: z.boolean(),
  /** Session ID if active */
  sessionId: z.string().nullable(),
});

/**
 * Schema for unified WU context
 *
 * Captures all environmental state relevant to command execution.
 */
export const WuContextSchema = z.object({
  /** Location context (main vs worktree) */
  location: LocationContextSchema,
  /** Git state (branch, dirty, staged, ahead/behind) */
  git: GitStateSchema,
  /** WU state (null if no WU specified) */
  wu: WuStateResultSchema.nullable(),
  /** Session state */
  session: SessionStateSchema,
  /**
   * Git state of the WU's worktree (WU-1092).
   *
   * When running wu:done from main checkout, we need to check the worktree's
   * git state, not main's. This field is populated when:
   * - Running from main checkout (location.type === 'main')
   * - A WU is specified (wu !== null)
   * - WU has an active worktree (status === 'in_progress')
   *
   * If undefined, predicates should fall back to checking `git.isDirty`.
   */
  worktreeGit: GitStateSchema.optional(),
});

// Type inference from Zod schemas
export type LocationType = z.infer<typeof LocationTypeSchema>;
export type LocationContext = z.infer<typeof LocationContextSchema>;
export type GitState = z.infer<typeof GitStateSchema>;
export type WuStateResult = z.infer<typeof WuStateResultSchema>;
export type SessionState = z.infer<typeof SessionStateSchema>;
export type WuContext = z.infer<typeof WuContextSchema>;
