// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Domain Constants
 *
 * WU-1549: Extracted from wu-constants.ts for domain-specific modularity.
 * Contains WU patterns, commit formats, consistency checks, cleanup guards,
 * defaults, validation thresholds, safety tests, lane path patterns, and
 * utility functions (toKebab, getWorktreePath, getLaneBranch, getProjectRoot).
 *
 * @module wu-domain-constants
 */

import path from 'node:path';
import { kebabCase } from 'change-case';
import { LOG_PREFIX } from './wu-ui-constants.js';

/**
 * Regex patterns for WU operations
 *
 * Note: WU_ID pattern is also in wu-schema.ts for Zod validation
 */
export const PATTERNS = {
  /** WU identifier format: WU-123 */
  WU_ID: /^WU-\d+$/,

  /** Extract WU ID from text: captures "WU-123" */
  WU_ID_EXTRACT: /WU-\d+/,

  /**
   * Extract WU ID from worktree paths (case-insensitive)
   *
   * WU-1090: Worktree names use lowercase like 'framework-core-wu-1090'
   * This pattern matches both 'WU-123' and 'wu-123' to support
   * extracting WU IDs from worktree paths.
   */
  WU_ID_EXTRACT_CI: /wu-\d+/i,

  /** Lane branch format: lane/<lane-kebab>/wu-<id> */
  LANE_BRANCH: /^lane\/[\w-]+\/wu-\d+$/,

  /** Worktree path format: worktrees/<lane-kebab>-wu-<id> */
  WORKTREE_PATH: /^worktrees\/[\w-]+-wu-\d+$/,
};

/**
 * Commit message formats
 *
 * These are functions that generate properly formatted commit messages
 */
export const COMMIT_FORMATS = {
  CLAIM: (id: string, laneKebab: string) => `wu(${id}): claim for ${laneKebab} lane`,
  DONE: (id: string, title: string) => `wu(${id}): done - ${title}`,
  CREATE: (id: string, title: string) => `docs: create ${id.toLowerCase()} for ${title}`,
  EDIT: (id: string) => `docs: edit ${id.toLowerCase()} spec`,
  SPEC_UPDATE: (id: string) => `wu(${id.toLowerCase()}): spec update`,
  BLOCK: (id: string) => `wu(${id}): block`,
  UNBLOCK: (id: string) => `wu(${id}): unblock`,
  REPAIR: (id: string) => `fix(${id}): repair state inconsistency`,
  REBASE_ARTIFACT_CLEANUP: (id: string) =>
    `chore(${id.toLowerCase()}): remove rebased completion artifacts`,
  BACKLOG_REPAIR: (id: string) =>
    `chore(repair): repair backlog duplicates for ${id.toLowerCase()}`,
  ESCALATE: (id: string) => `wu(${id.toLowerCase()}): resolve escalation`,
};

/**
 * Consistency check types (WU-1276)
 *
 * Layer 2 defense-in-depth: detect and repair WU state inconsistencies
 */
export const CONSISTENCY_TYPES = {
  /** WU YAML has status 'done' but WU appears in status.md In Progress section */
  YAML_DONE_STATUS_IN_PROGRESS: 'YAML_DONE_STATUS_IN_PROGRESS',

  /** WU appears in both Done AND In Progress sections of backlog.md */
  BACKLOG_DUAL_SECTION: 'BACKLOG_DUAL_SECTION',

  /** WU YAML has status 'done' but no stamp file exists */
  YAML_DONE_NO_STAMP: 'YAML_DONE_NO_STAMP',

  /** WU has status 'done' but still has an associated worktree */
  ORPHAN_WORKTREE_DONE: 'ORPHAN_WORKTREE_DONE',

  /** Stamp file exists but WU YAML status is not 'done' (partial wu:done failure) */
  STAMP_EXISTS_YAML_NOT_DONE: 'STAMP_EXISTS_YAML_NOT_DONE',

  /** WU is claimed but its worktree directory is missing */
  MISSING_WORKTREE_CLAIMED: 'MISSING_WORKTREE_CLAIMED',
};

/**
 * Consistency check messages
 */
export const CONSISTENCY_MESSAGES = {
  MISSING_WORKTREE_CLAIMED: (id: string, status: string, worktreePath: string) =>
    `WU ${id} is '${status}' but worktree path is missing (${worktreePath})`,
  MISSING_WORKTREE_CLAIMED_REPAIR: 'Recover worktree or re-claim WU',
};

/**
 * Worktree warning messages
 */
export const WORKTREE_WARNINGS = {
  MISSING_TRACKED_HEADER: 'Tracked worktrees missing on disk (possible manual deletion):',
  MISSING_TRACKED_LINE: (worktreePath: string) => `Missing: ${worktreePath}`,
};

/**
 * Cleanup guard constants
 */
export const CLEANUP_GUARD = {
  REASONS: {
    UNCOMMITTED_CHANGES: 'UNCOMMITTED_CHANGES',
    UNPUSHED_COMMITS: 'UNPUSHED_COMMITS',
    STATUS_NOT_DONE: 'STATUS_NOT_DONE',
    MISSING_STAMP: 'MISSING_STAMP',
    PR_NOT_MERGED: 'PR_NOT_MERGED',
  },
  TITLES: {
    BLOCKED: 'CLEANUP BLOCKED',
    NEXT_STEPS: 'Next steps:',
  },
  MESSAGES: {
    UNCOMMITTED_CHANGES: 'Worktree has uncommitted changes. Refusing to delete.',
    UNPUSHED_COMMITS: 'Worktree has unpushed commits. Refusing to delete.',
    STATUS_NOT_DONE: 'WU YAML status is not done. Refusing to delete.',
    MISSING_STAMP: 'WU stamp is missing. Refusing to delete.',
    PR_NOT_MERGED: 'PR is not merged (or cannot be verified). Refusing to delete.',
  },
  /* eslint-disable sonarjs/no-duplicate-string -- Intentional: cleanup instructions repeated for each error type for readability */
  NEXT_STEPS: {
    DEFAULT: [
      { text: '1. Resolve the issue above', appendId: false },
      { text: '2. Re-run: pnpm wu:cleanup --id', appendId: true },
    ],
    UNCOMMITTED_CHANGES: [
      { text: '1. Commit or stash changes in the worktree', appendId: false },
      { text: '2. Re-run: pnpm wu:cleanup --id', appendId: true },
    ],
    UNPUSHED_COMMITS: [
      { text: '1. Push the lane branch to origin', appendId: false },
      { text: '2. Re-run: pnpm wu:cleanup --id', appendId: true },
    ],
    STATUS_NOT_DONE: [
      {
        text: `1. Complete the WU with ${LOG_PREFIX.DONE} (creates stamp + done status)`,
        appendId: false,
      },
      { text: '2. Re-run: pnpm wu:cleanup --id', appendId: true },
    ],
    MISSING_STAMP: [
      { text: '1. Run wu:done to create the stamp file', appendId: false },
      { text: '2. Re-run: pnpm wu:cleanup --id', appendId: true },
    ],
    PR_NOT_MERGED: [
      { text: '1. Merge the PR in GitHub', appendId: false },
      { text: '2. Re-run: pnpm wu:cleanup --id', appendId: true },
    ],
  },
  /* eslint-enable sonarjs/no-duplicate-string */
  PR_CHECK: {
    START: 'Verifying PR merge status...',
    RESULT: 'PR merge verification via',
  },
};

/**
 * Session display constants
 *
 * Emergency fix (Session 2): Centralized from hardcoded magic numbers
 */
export const SESSION = {
  /** Standard length for displaying session ID prefix (e.g., "sess-123") */
  ID_DISPLAY_LENGTH: 8,
};

/**
 * Validation constants
 *
 * WU-1281: Centralized from local constants in validators
 */
export const VALIDATION = {
  /** Minimum description length for WU spec completeness */
  MIN_DESCRIPTION_LENGTH: 50,
};

/**
 * Threshold constants for pre-flight checks
 *
 * WU-1302: Centralized to eliminate magic numbers
 * WU-1370: Added graduated drift thresholds for early warnings
 */
export const THRESHOLDS = {
  /** Info threshold: commits behind main to suggest rebasing (WU-1370) */
  BRANCH_DRIFT_INFO: 10,

  /** Warning threshold: commits behind main where rebase is recommended (WU-1370) */
  BRANCH_DRIFT_WARNING: 15,

  /** Maximum commits behind main before requiring rebase (WU-755 pre-flight) */
  BRANCH_DRIFT_MAX: 20,
};

/**
 * Default values
 */
export const DEFAULTS = {
  /** Default worktrees directory */
  WORKTREES_DIR: 'worktrees',

  /** Maximum commit subject length (commitlint default) */
  MAX_COMMIT_SUBJECT: 100,

  /** Parent directory traversal depth from tools/lib to project root */
  PROJECT_ROOT_DEPTH: 2,

  /**
   * Default email domain for username -> email conversion
   * WU-1068: Made configurable, no longer hardcoded to exampleapp.co.uk
   * @see user-normalizer.ts - Infers from git config first
   */
  EMAIL_DOMAIN: 'example.com',
};

/**
 * Default values for WU YAML fields
 *
 * WU-1337: Centralized defaults for auto-repair in schema validation
 * DRY principle: Single source of truth for optional field defaults
 *
 * Used by wu-schema.ts Zod transformations to provide sensible defaults
 * when agents omit optional fields, reducing validation errors.
 */
export const WU_DEFAULTS = {
  /** Default priority level (medium priority) */
  priority: 'P2',

  /** Default status for new WUs */
  status: 'ready',

  /** Default work type */
  type: 'feature',

  /** Default code paths (empty until populated) */
  code_paths: [] as string[],

  /** Default test structure (includes all test types) */
  tests: {
    manual: [] as string[],
    unit: [] as string[],
    integration: [] as string[],
    e2e: [] as string[],
  },

  /** Default artifacts (empty - wu:done adds stamp) */
  artifacts: [] as string[],

  /** Default dependencies (no blockers) */
  dependencies: [] as string[],

  /** Default risks (none identified) */
  risks: [] as string[],

  /** Default notes (empty string, not undefined) */
  notes: '',

  /** Default review requirement (agent-completed WUs) */
  requires_review: false,
};

/**
 * Safety-critical test glob patterns
 *
 * WU-2242: Centralized list of glob patterns for safety tests that MUST exist.
 * Gates fail if UnsafeAny of these patterns find no matches.
 */
export const SAFETY_CRITICAL_TEST_GLOBS = Object.freeze([
  // Escalation trigger tests
  'apps/web/src/**/*escalation*.test.{ts,tsx}',
  'apps/web/src/**/*Escalation*.test.{ts,tsx}',

  // Privacy detection tests
  'apps/web/src/**/*privacy*.test.{ts,tsx}',
  'apps/web/src/**/*Privacy*.test.{ts,tsx}',

  // Constitutional enforcer tests
  'apps/web/src/**/*constitutional*.test.{ts,tsx}',
  'apps/web/src/**/*Constitutional*.test.{ts,tsx}',

  // Safe prompt wrapper tests
  'apps/web/src/**/*safePrompt*.test.{ts,tsx}',
  'apps/web/src/**/*SafePrompt*.test.{ts,tsx}',

  // Crisis/emergency handling tests
  'apps/web/src/**/*crisis*.test.{ts,tsx}',
  'apps/web/src/**/*Crisis*.test.{ts,tsx}',
]);

/**
 * Lane-to-code_paths validation patterns (WU-1372)
 *
 * Advisory patterns to warn when a WU's lane doesn't match its code_paths.
 */
export const LANE_PATH_PATTERNS = {
  Operations: {
    exclude: ['ai/prompts/**', 'apps/web/src/lib/prompts/**'],
    allowExceptions: [] as string[],
  },
  Intelligence: {
    exclude: ['tools/**'],
    allowExceptions: ['tools/lib/prompt-*', 'tools/prompts-eval/**'],
  },
};

/**
 * Convert lane name to kebab-case using change-case library
 *
 * @param lane - Lane name (e.g., 'Operations: Tooling')
 * @returns Kebab-case lane (e.g., 'operations-tooling')
 */
export function toKebab(lane: string | null | undefined): string {
  if (lane == null) return '';
  const normalized = String(lane).trim();
  if (normalized === '') return '';
  return kebabCase(normalized);
}

/**
 * Generate worktree path from lane and WU ID
 *
 * @param lane - Lane name
 * @param id - WU ID
 * @returns Worktree path (e.g., 'worktrees/operations-tooling-wu-123')
 */
export function getWorktreePath(lane: string, id: string): string {
  const laneKebab = toKebab(lane);
  const idLower = id.toLowerCase();
  return `${DEFAULTS.WORKTREES_DIR}/${laneKebab}-${idLower}`;
}

/**
 * Generate lane branch name from lane and WU ID
 *
 * @param lane - Lane name
 * @param id - WU ID
 * @returns Branch name (e.g., 'lane/operations-tooling/wu-123')
 */
export function getLaneBranch(lane: string, id: string): string {
  const laneKebab = toKebab(lane);
  const idLower = id.toLowerCase();
  return `lane/${laneKebab}/${idLower}`;
}

/**
 * Get project root directory from a module URL
 *
 * WU-923: Centralized path resolution to eliminate '../..' magic strings
 *
 * @param moduleUrl - import.meta.url of the calling module
 * @returns Absolute path to project root
 */
export function getProjectRoot(moduleUrl: string): string {
  const { dirname } = path;
  const currentDir = dirname(new URL(moduleUrl).pathname);

  let root = currentDir;
  for (let i = 0; i < DEFAULTS.PROJECT_ROOT_DEPTH; i++) {
    root = dirname(root);
  }
  return root;
}

/**
 * Options for discovering safety tests
 */
export interface DiscoverSafetyTestsOptions {
  /** Project root directory */
  projectRoot?: string;
}

/**
 * Discover safety-critical test files
 *
 * WU-2242: Scans for test files matching safety-critical patterns.
 * Uses glob to find all matching files.
 *
 * @param options - Discovery options
 * @returns List of discovered test file paths
 */
export async function discoverSafetyTests(
  options: DiscoverSafetyTestsOptions = {},
): Promise<string[]> {
  const { projectRoot = process.cwd() } = options;
  const { glob } = await import('glob');
  const foundFiles: string[] = [];

  for (const pattern of SAFETY_CRITICAL_TEST_GLOBS) {
    try {
      const matches = await glob(pattern, {
        cwd: projectRoot,
        absolute: false,
      });
      foundFiles.push(...matches);
    } catch {
      // Pattern may not match anything, that's fine
    }
  }

  return [...new Set(foundFiles)]; // Deduplicate
}

/**
 * Validate that required safety-critical tests exist
 *
 * WU-2242: Checks that each pattern category has at least one matching test file.
 * Returns a validation result with missing patterns and found files.
 */
export async function validateSafetyTestsExist(options: DiscoverSafetyTestsOptions = {}) {
  const { projectRoot = process.cwd() } = options;
  const { glob } = await import('glob');

  const missingTests: string[] = [];
  const foundTests: string[] = [];

  const categories = [
    { name: 'Escalation', patterns: SAFETY_CRITICAL_TEST_GLOBS.slice(0, 2) },
    { name: 'Privacy detection', patterns: SAFETY_CRITICAL_TEST_GLOBS.slice(2, 4) },
    { name: 'Constitutional', patterns: SAFETY_CRITICAL_TEST_GLOBS.slice(4, 6) },
    { name: 'Safe prompt wrapper', patterns: SAFETY_CRITICAL_TEST_GLOBS.slice(6, 8) },
    { name: 'Crisis handling', patterns: SAFETY_CRITICAL_TEST_GLOBS.slice(8, 10) },
  ];

  for (const category of categories) {
    let categoryHasTests = false;

    for (const pattern of category.patterns) {
      try {
        const matches = await glob(pattern, {
          cwd: projectRoot,
          absolute: false,
        });
        if (matches.length > 0) {
          categoryHasTests = true;
          foundTests.push(...matches);
        }
      } catch {
        // Pattern error, treat as no matches
      }
    }

    if (!categoryHasTests) {
      missingTests.push(`${category.name}: ${category.patterns.join(', ')}`);
    }
  }

  const valid = missingTests.length === 0;

  return {
    valid,
    missingTests,
    foundTests: [...new Set(foundTests)],
    error: valid ? undefined : `Missing safety-critical tests: ${missingTests.join('; ')}`,
  };
}
