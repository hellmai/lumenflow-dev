/**
 * Validation Types for WU Context
 *
 * WU-1090: Context-aware state machine for WU lifecycle commands
 *
 * Type definitions for the unified context model, command definitions,
 * and validation results.
 *
 * @module
 */

import type { LocationType, PredicateSeverity, ValidationErrorCode } from '../wu-constants.js';
import type { LocationContext } from '../context/location-resolver.js';
import type { GitState } from '../context/git-state-reader.js';

/**
 * WU state information from YAML and state store.
 */
export interface WuState {
  /** WU ID (e.g., 'WU-1090') */
  id: string;
  /** Current status (ready, in_progress, blocked, done, etc.) */
  status: string;
  /** Lane name */
  lane: string;
  /** WU title */
  title: string;
  /** Path to WU YAML file */
  yamlPath: string;
  /** WU-1683: Path to linked plan file */
  plan?: string;
  /** Whether YAML and state store are consistent */
  isConsistent: boolean;
  /** Reason for inconsistency if not consistent */
  inconsistencyReason: string | null;
}

/**
 * Session state for active WU work.
 */
export interface SessionState {
  /** Whether a session is active */
  isActive: boolean;
  /** Session ID if active */
  sessionId: string | null;
}

/**
 * Unified context model for WU operations.
 *
 * Captures all environmental state relevant to command execution.
 */
export interface WuContext {
  /** Location context (main vs worktree) */
  location: LocationContext;
  /** Git state (branch, dirty, staged, ahead/behind) */
  git: GitState;
  /** WU state (null if no WU specified) */
  wu: WuState | null;
  /** Session state */
  session: SessionState;
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
  worktreeGit?: GitState;
}

/**
 * Command predicate for custom validation checks.
 */
export interface CommandPredicate {
  /** Unique identifier for the predicate */
  id: string;
  /** Human-readable description */
  description: string;
  /** Severity: 'error' blocks execution, 'warning' allows with warning */
  severity: PredicateSeverity;
  /** Function that checks the predicate against context */
  check: (context: WuContext) => boolean;
  /** Function that generates fix message if check fails */
  getFixMessage?: (context: WuContext) => string;
}

/**
 * Command definition for a wu:* command.
 */
export interface CommandDefinition {
  /** Command name (e.g., 'wu:create') */
  name: string;
  /** Human-readable description */
  description: string;
  /** Required location type (null = any location) */
  requiredLocation: LocationType | null;
  /** Required WU status (null = no status requirement) */
  requiredWuStatus: string | null;
  /** Custom predicates for additional checks */
  predicates?: CommandPredicate[];
  /** Function to get next steps after success */
  getNextSteps?: (context: WuContext) => string[];
}

/**
 * Validation error with fix guidance.
 */
export interface ValidationError {
  /** Error code */
  code: ValidationErrorCode;
  /** Human-readable message */
  message: string;
  /** Copy-paste ready fix command (if available) */
  fixCommand: string | null;
  /** Additional context for debugging */
  context?: Record<string, unknown>;
}

/**
 * Validation warning (non-blocking).
 */
export interface ValidationWarning {
  /** Warning ID */
  id: string;
  /** Human-readable message */
  message: string;
}

/**
 * Validation result for a command.
 */
export interface ValidationResult {
  /** Whether command can proceed */
  valid: boolean;
  /** Errors that block execution */
  errors: ValidationError[];
  /** Warnings that don't block execution */
  warnings: ValidationWarning[];
  /** Context used for validation (for debugging) */
  context: WuContext;
}
