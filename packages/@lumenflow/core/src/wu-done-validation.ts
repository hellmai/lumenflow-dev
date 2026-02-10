/**
 * Core validation helpers for wu:done.
 */

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { getGitForCwd } from './git-adapter.js';
import { parseYAML } from './wu-yaml.js';
import { die } from './error-handler.js';
import {
  BRANCHES,
  DIRECTORIES,
  EMOJI,
  FILE_SYSTEM,
  GIT_COMMANDS,
  LUMENFLOW_PATHS,
  LOG_PREFIX,
  STRING_LITERALS,
  TEST_TYPES,
  VALIDATION,
  WU_TYPES,
  WU_STATUS,
} from './wu-constants.js';
import { WU_PATHS } from './wu-paths.js';
import { PLACEHOLDER_SENTINEL } from './wu-schema.js';
import { resolveExposureDefault } from './wu-validation.js';
import { validateAutomatedTestRequirement } from './manual-test-validator.js';
import { isDocumentationPath } from './file-classifiers.js';
import { normalizeToDateString } from './date-utils.js';

interface ExposureDefaultResult {
  applied: boolean;
  exposure?: string;
}

export function applyExposureDefaults(doc): ExposureDefaultResult {
  if (!doc || typeof doc !== 'object') {
    return { applied: false };
  }

  if (typeof doc.exposure === 'string' && doc.exposure.trim().length > 0) {
    return { applied: false, exposure: doc.exposure };
  }

  const exposureDefault = resolveExposureDefault(doc.lane);
  if (!exposureDefault) {
    return { applied: false };
  }

  doc.exposure = exposureDefault;
  return { applied: true, exposure: exposureDefault };
}

/**
 * WU-1351: Validate code_paths files exist on main branch
 *
 * Prevents false completions by ensuring all code_paths entries
 * actually exist on the target branch (main or lane branch).
 *
 * This guards against:
 * - Stamps being created for WUs where code never merged
 * - Metadata becoming desynchronized from actual code
 */
export interface ValidateCodePathsExistOptions {
  /** Branch to check files against (default: 'main') */
  targetBranch?: string;
  /** Worktree path for worktree mode */
  worktreePath?: string | null;
}

export async function validateCodePathsExist(doc, id, options: ValidateCodePathsExistOptions = {}) {
  const { targetBranch = BRANCHES.MAIN, worktreePath = null } = options;
  const errors = [];
  const missing = [];
  const codePaths = doc.code_paths || [];

  // Skip validation for WUs without code_paths (docs-only, process WUs)
  if (codePaths.length === 0) {
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.INFO} No code_paths to validate for ${id}`);
    return { valid: true, errors: [], missing: [] };
  }

  console.log(`${LOG_PREFIX.DONE} Validating ${codePaths.length} code_paths exist...`);

  // For worktree mode, check files exist in the worktree (will be merged)
  // For branch-only mode or post-merge validation, check files exist on target branch
  if (worktreePath && existsSync(worktreePath)) {
    // Worktree mode: validate files exist in worktree
    for (const filePath of codePaths) {
      const fullPath = path.join(worktreePath, filePath);
      if (!existsSync(fullPath)) {
        missing.push(filePath);
      }
    }

    if (missing.length > 0) {
      errors.push(
        `code_paths validation failed - ${missing.length} file(s) not found in worktree:\n${missing
          .map((p) => `  - ${p}`)
          .join(
            STRING_LITERALS.NEWLINE,
          )}\n\nEnsure all files listed in code_paths exist before running wu:done.`,
      );
    }
  } else {
    // Branch-only or post-merge: use git ls-tree to check files on target branch
    try {
      const gitAdapter = getGitForCwd();

      for (const filePath of codePaths) {
        try {
          // git ls-tree returns empty for non-existent files
          const result = await gitAdapter.raw([GIT_COMMANDS.LS_TREE, targetBranch, '--', filePath]);

          if (!result || result.trim() === '') {
            missing.push(filePath);
          }
        } catch {
          // git ls-tree fails for non-existent paths
          missing.push(filePath);
        }
      }

      if (missing.length > 0) {
        errors.push(
          `code_paths validation failed - ${missing.length} file(s) not found on ${targetBranch}:\n${missing
            .map((p) => `  - ${p}`)
            .join(STRING_LITERALS.NEWLINE)}\n\n❌ POTENTIAL FALSE COMPLETION DETECTED\n\n` +
            `These files are listed in code_paths but do not exist on ${targetBranch}.\n` +
            `This prevents creating a stamp for incomplete work.\n\n` +
            `Fix options:\n` +
            `  1. Ensure all code is committed and merged to ${targetBranch}\n` +
            `  2. Update code_paths in ${id}.yaml to match actual files\n` +
            `  3. Remove files that were intentionally not created\n\n` +
            `Context: WU-1351 prevents false completions from INIT-WORKFLOW-INTEGRITY`,
        );
      }
    } catch (err) {
      // Non-fatal: warn but don't block if git command fails
      console.warn(
        `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not validate code_paths: ${err.message}`,
      );
      return { valid: true, errors: [], missing: [] };
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, missing };
  }

  console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} All ${codePaths.length} code_paths verified`);
  return { valid: true, errors: [], missing: [] };
}

/**
 * Validate WU spec completeness (WU-1162, WU-1280)
 *
 * Ensures WU specifications are complete before allowing wu:done to proceed.
 * Prevents placeholder WUs from being marked as done.
 */
export function validateSpecCompleteness(doc, _id) {
  const errors = [];

  // Check for placeholder text in description
  if (doc.description && doc.description.includes(PLACEHOLDER_SENTINEL)) {
    errors.push(`Description contains ${PLACEHOLDER_SENTINEL} marker`);
  }

  // Handle both array and object formats for acceptance criteria
  if (doc.acceptance) {
    const hasPlaceholder = (value) => {
      if (typeof value === 'string') {
        return value.includes(PLACEHOLDER_SENTINEL);
      }
      if (Array.isArray(value)) {
        return value.some((item) => hasPlaceholder(item));
      }
      if (typeof value === 'object' && value !== null) {
        return Object.values(value).some((item) => hasPlaceholder(item));
      }
      return false;
    };

    if (hasPlaceholder(doc.acceptance)) {
      errors.push(`Acceptance criteria contain ${PLACEHOLDER_SENTINEL} markers`);
    }
  }

  // Check minimum description length
  if (!doc.description || doc.description.trim().length < VALIDATION.MIN_DESCRIPTION_LENGTH) {
    errors.push(
      `Description too short (${doc.description?.trim().length || 0} chars, minimum ${VALIDATION.MIN_DESCRIPTION_LENGTH})`,
    );
  }

  // Check code_paths for non-documentation WUs
  if (doc.type !== WU_TYPES.DOCUMENTATION && doc.type !== WU_TYPES.PROCESS) {
    if (!doc.code_paths || doc.code_paths.length === 0) {
      errors.push('Code paths required for non-documentation WUs');
    }

    // WU-1280: Check tests array for non-documentation WUs
    // Support both tests: (current) and test_paths: (legacy)
    const testObj = doc.tests || doc.test_paths || {};

    // Helper to check if array has items
    const hasItems = (arr) => Array.isArray(arr) && arr.length > 0;

    const hasUnitTests = hasItems(testObj[TEST_TYPES.UNIT]);
    const hasE2ETests = hasItems(testObj[TEST_TYPES.E2E]);
    const hasManualTests = hasItems(testObj[TEST_TYPES.MANUAL]);
    const hasIntegrationTests = hasItems(testObj[TEST_TYPES.INTEGRATION]);

    if (!(hasUnitTests || hasE2ETests || hasManualTests || hasIntegrationTests)) {
      errors.push('At least one test path required (unit, e2e, integration, or manual)');
    }

    // WU-2332: Require automated tests for code file changes
    // Manual-only tests are not sufficient when code_paths contain actual code files
    const automatedTestResult = validateAutomatedTestRequirement(doc);
    if (!automatedTestResult.valid) {
      errors.push(...automatedTestResult.errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

function deriveStatusFromEventsContent(
  eventsContent: string,
  wuId: string,
): (typeof WU_STATUS)[keyof typeof WU_STATUS] | undefined {
  let status: (typeof WU_STATUS)[keyof typeof WU_STATUS] | undefined;

  for (const line of eventsContent.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as { wuId?: string; type?: string };
      if (event.wuId !== wuId || !event.type) continue;

      switch (event.type) {
        case 'claim':
        case 'create':
          status = WU_STATUS.IN_PROGRESS;
          break;
        case 'release':
          status = WU_STATUS.READY;
          break;
        case 'complete':
          status = WU_STATUS.DONE;
          break;
        case 'block':
          status = WU_STATUS.BLOCKED;
          break;
        case 'unblock':
          status = WU_STATUS.IN_PROGRESS;
          break;
      }
    } catch {
      // Ignore malformed lines; other guards handle structural integrity.
    }
  }

  return status;
}

/**
 * WU-1617: Post-mutation validation for wu:done
 *
 * Validates that metadata files written by tx.commit() are valid:
 * 1. WU YAML has completed_at field with valid ISO datetime
 * 2. WU YAML has locked: true
 * 3. Stamp file exists
 * 4. State store derives to done (when eventsPath is provided)
 */
export function validatePostMutation({ id, wuPath, stampPath, eventsPath = null }) {
  const errors = [];

  // Check stamp file exists
  if (!existsSync(stampPath)) {
    errors.push(`Stamp file not created: ${stampPath}`);
  }

  // Read and validate WU YAML after mutation
  if (!existsSync(wuPath)) {
    errors.push(`WU YAML not found after mutation: ${wuPath}`);
    return { valid: false, errors };
  }

  try {
    const content = readFileSync(wuPath, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });
    const doc = parseYAML(content);

    // Verify completed_at exists and is valid ISO datetime
    if (!doc.completed_at) {
      errors.push(`Missing required field 'completed_at' in ${id}.yaml`);
    } else {
      // Validate ISO datetime format (YYYY-MM-DDTHH:mm:ss.sssZ or similar)
      const timestamp = new Date(doc.completed_at);
      if (isNaN(timestamp.getTime())) {
        errors.push(`Invalid completed_at timestamp: ${doc.completed_at}`);
      }
    }

    // Keep legacy completion date normalized for downstream tools.
    if (!doc.completed) {
      errors.push(`Missing required field 'completed' in ${id}.yaml`);
    } else {
      const normalizedCompleted = normalizeToDateString(doc.completed);
      if (!normalizedCompleted) {
        errors.push(`Invalid completed date: ${doc.completed}`);
      } else if (normalizedCompleted !== doc.completed) {
        errors.push(`Non-normalized completed date: ${doc.completed}`);
      }
    }

    // Verify locked is true
    if (doc.locked !== true) {
      errors.push(
        `Missing or invalid 'locked' field in ${id}.yaml (expected: true, got: ${doc.locked})`,
      );
    }

    // Verify status is done
    if (doc.status !== WU_STATUS.DONE) {
      errors.push(
        `Invalid status in ${id}.yaml (expected: '${WU_STATUS.DONE}', got: '${doc.status}')`,
      );
    }
  } catch (err) {
    errors.push(`Failed to parse WU YAML after mutation: ${err.message}`);
  }

  if (eventsPath) {
    if (!existsSync(eventsPath)) {
      errors.push(`State store file not found after mutation: ${eventsPath}`);
    } else {
      try {
        const eventsContent = readFileSync(eventsPath, {
          encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
        });
        const derivedStatus = deriveStatusFromEventsContent(eventsContent, id);
        if (derivedStatus !== WU_STATUS.DONE) {
          errors.push(
            `WU ${id} state store is '${derivedStatus ?? 'missing'}' after mutation (expected: '${WU_STATUS.DONE}')`,
          );
        }
      } catch (err) {
        errors.push(`Failed to parse state store after mutation: ${err.message}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * WU-2242: Validate that test_paths is required for non-doc WUs
 *
 * Enforces that WUs with code changes (non-documentation types with code_paths
 * that contain actual code) have at least one test path specified.
 */
export function validateTestPathsRequired(wu) {
  // Skip validation for documentation and process WUs
  if (wu.type === WU_TYPES.DOCUMENTATION || wu.type === WU_TYPES.PROCESS) {
    return { valid: true };
  }

  // Skip if code_paths is empty or undefined
  const codePaths = wu.code_paths || [];
  if (codePaths.length === 0) {
    return { valid: true };
  }

  // Skip if all code_paths are documentation paths
  const hasCodeChanges = codePaths.some((p) => !isDocumentationPath(p));
  if (!hasCodeChanges) {
    return { valid: true };
  }

  // Check if tests object exists and has at least one test
  const testObj = wu.tests || {};

  // Helper to check if array has items
  const hasItems = (arr) => Array.isArray(arr) && arr.length > 0;

  const hasUnitTests = hasItems(testObj[TEST_TYPES.UNIT]);
  const hasE2ETests = hasItems(testObj[TEST_TYPES.E2E]);
  const hasManualTests = hasItems(testObj[TEST_TYPES.MANUAL]);
  const hasIntegrationTests = hasItems(testObj[TEST_TYPES.INTEGRATION]);

  // No tests at all - fail
  if (!(hasUnitTests || hasE2ETests || hasManualTests || hasIntegrationTests)) {
    return {
      valid: false,
      error: `${wu.id} requires test_paths: WU has code_paths but no tests specified. Add unit, e2e, integration, or manual tests.`,
    };
  }

  // WU-2332: If we have tests, also check automated test requirement for code files
  // Manual-only tests are not sufficient for code changes
  const automatedTestResult = validateAutomatedTestRequirement(wu);
  if (!automatedTestResult.valid) {
    // Extract the first error line for the single-error format of this function
    const errorSummary =
      automatedTestResult.errors[0]?.split('\n')[0] || 'Automated tests required';
    return {
      valid: false,
      error: `${wu.id}: ${errorSummary}`,
    };
  }

  return { valid: true };
}

/**
 * WU-2310: Allowed path patterns for documentation WUs.
 * Mirrors the patterns in gates-pre-commit.ts gateDocsOnlyPathEnforcement()
 * to enable early validation at preflight (before transaction starts).
 *
 * @constant {RegExp[]}
 */
const DOCS_ONLY_ALLOWED_PATTERNS = [
  /^memory-bank\//i,
  /^docs\//i,
  /\.md$/i,
  /^\.lumenflow\/stamps\//i,
  /^\.claude\//i,
  /^ai\//i,
  /^README\.md$/i,
  /^CLAUDE\.md$/i,
];

/**
 * WU-2310: Check if a path is allowed for documentation WUs.
 *
 * @param {string} filePath - File path to check
 * @returns {boolean} True if path is allowed for docs WUs
 */
function isAllowedDocsPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  return DOCS_ONLY_ALLOWED_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * WU-2310: Validate type vs code_paths at preflight (before transaction starts).
 */
export function validateTypeVsCodePathsPreflight(wu) {
  const errors = [];
  const blockedPaths = [];

  // Only validate documentation WUs
  if (wu.type !== WU_TYPES.DOCUMENTATION) {
    return { valid: true, errors: [], blockedPaths: [], abortedBeforeTransaction: false };
  }

  // Skip if no code_paths
  const codePaths = wu.code_paths;
  if (!codePaths || !Array.isArray(codePaths) || codePaths.length === 0) {
    return { valid: true, errors: [], blockedPaths: [], abortedBeforeTransaction: false };
  }

  // Check each code_path against allowed patterns
  for (const filePath of codePaths) {
    if (!isAllowedDocsPath(filePath)) {
      blockedPaths.push(filePath);
    }
  }

  if (blockedPaths.length > 0) {
    const pathsList = blockedPaths.map((p) => `  - ${p}`).join('\n');
    errors.push(
      `Documentation WU ${wu.id} has code_paths that would fail pre-commit hook:\n${pathsList}`,
    );
    return { valid: false, errors, blockedPaths, abortedBeforeTransaction: true };
  }

  return { valid: true, errors: [], blockedPaths: [], abortedBeforeTransaction: false };
}

/**
 * WU-2310: Build error message for type vs code_paths preflight failure.
 */
export function buildTypeVsCodePathsErrorMessage(id, blockedPaths) {
  return `
PREFLIGHT VALIDATION FAILED (WU-2310)

WU ${id} is type: documentation but has code_paths that are not allowed:

${blockedPaths.map((p) => `  - ${p}`).join('\n')}

This would fail at git commit time (pre-commit hook: gateDocsOnlyPathEnforcement).
Aborting BEFORE transaction to prevent inconsistent state.

Fix options:

  1. Change WU type to 'engineering' (or 'feature', 'bug', etc.):
     pnpm wu:edit --id ${id} --type engineering

  2. Update code_paths to only include documentation files:
     pnpm wu:edit --id ${id} --code-paths "docs/..." "*.md"

Allowed paths for documentation WUs:
  - docs/
  - ai/
  - .claude/
  - memory-bank/
  - .lumenflow/stamps/
  - *.md files

After fixing, retry: pnpm wu:done --id ${id}
`;
}

/**
 * WU-1153: Validate that code_paths are committed before wu:done metadata updates
 *
 * Prevents lost work by ensuring all code_paths are committed before metadata
 * transaction starts. If code_paths are uncommitted and metadata transaction
 * fails, the rollback could lose the uncommitted code changes.
 *
 * @param {object} wu - WU YAML document
 * @param {object} gitAdapter - Git adapter instance
 * @param {object} options - Validation options
 * @param {boolean} [options.abortOnFailure=true] - Whether to call die() on failure
 * @returns {Promise<{valid: boolean, errors: string[], uncommittedPaths: string[]}>}
 */
export async function validateCodePathsCommittedBeforeDone(
  wu: Record<string, unknown>,
  gitAdapter: { getStatus: () => Promise<string> },
  options: { abortOnFailure?: boolean } = {},
): Promise<{ valid: boolean; errors: string[]; uncommittedPaths: string[] }> {
  const { abortOnFailure = true } = options;
  const errors: string[] = [];
  const uncommittedPaths: string[] = [];

  // Skip validation if no code_paths
  const codePaths = wu.code_paths as string[] | undefined;
  if (!codePaths || codePaths.length === 0) {
    return { valid: true, errors: [], uncommittedPaths: [] };
  }

  try {
    // Get git status to check for uncommitted files
    const gitStatus = await gitAdapter.getStatus();

    // Parse git status output to find uncommitted files
    const statusLines = gitStatus.split('\n').filter((line) => line.trim());

    // Create a Set of uncommitted file paths for efficient lookup
    const uncommittedFiles = new Set<string>();

    for (const line of statusLines) {
      // Git status porcelain format:
      // XY PATH
      // where X = staged, Y = working tree
      // We care about any file that's not in a clean state
      const match = line.match(/^.{2}\s+(.+)$/);
      if (match) {
        const filePath = match[1];
        uncommittedFiles.add(filePath);
      }
    }

    // Check each code_path against uncommitted files
    for (const codePath of codePaths) {
      if (uncommittedFiles.has(codePath)) {
        uncommittedPaths.push(codePath);
      }
    }

    // If any code_paths are uncommitted, validation fails
    if (uncommittedPaths.length > 0) {
      const count = uncommittedPaths.length;
      const pathList = uncommittedPaths.map((p) => `  - ${p}`).join('\n');

      errors.push(`${count} code_path${count === 1 ? '' : 's'} are not committed:\n${pathList}`);

      if (abortOnFailure) {
        const errorMessage = buildCodePathsCommittedErrorMessage(wu.id as string, uncommittedPaths);
        die(errorMessage);
      }
    }
  } catch (err) {
    // If git status fails, warn but don't block (non-fatal)
    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not validate code_paths commit status: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { valid: true, errors: [], uncommittedPaths: [] };
  }

  return {
    valid: errors.length === 0,
    errors,
    uncommittedPaths,
  };
}

/**
 * WU-1153: Build error message for uncommitted code_paths validation failure
 *
 * @param {string} wuId - WU ID
 * @param {string[]} uncommittedPaths - List of uncommitted code_paths
 * @returns {string} Formatted error message
 */
export function buildCodePathsCommittedErrorMessage(
  wuId: string,
  uncommittedPaths: string[],
): string {
  const count = uncommittedPaths.length;
  const pathList = uncommittedPaths.map((p) => `  - ${p}`).join('\n');

  return `
❌ UNCOMMITTED CODE_PATHS DETECTED (WU-1153)

${count} code_path${count === 1 ? '' : 's'} for ${wuId} are not committed:

${pathList}

wu:done cannot proceed because uncommitted code_paths would be lost 
if the metadata transaction fails and needs to roll back.

This prevents lost work from metadata rollbacks after code commits.

Required actions:
  1. Commit your code changes:
     git add ${uncommittedPaths.join(' ')}
     git commit -m "implement: ${wuId} changes"

  2. Retry wu:done:
     pnpm wu:done --id ${wuId}

The guard ensures atomic completion: either both code and metadata succeed,
or neither is modified. This prevents partial state corruption.

Context: WU-1153 prevents lost work from metadata rollbacks
`;
}

/**
 * WU-1503: Metadata allowlist patterns for dirty-main pre-merge guard.
 *
 * These paths are always considered "related" to any wu:done operation,
 * regardless of the WU's code_paths. They represent files that wu:done
 * itself may create or modify during the completion workflow.
 */
export const METADATA_ALLOWLIST_PATTERNS: string[] = [
  DIRECTORIES.STATUS_PATH,
  DIRECTORIES.BACKLOG_PATH,
  LUMENFLOW_PATHS.WU_EVENTS,
  LUMENFLOW_PATHS.FLOW_LOG,
  LUMENFLOW_PATHS.SKIP_GATES_AUDIT,
  LUMENFLOW_PATHS.SKIP_COS_GATES_AUDIT,
  // WU YAML and stamps are matched dynamically by WU ID (see isMetadataAllowlisted)
];

/**
 * WU-1503: Check if a file path is on the metadata allowlist for a given WU.
 *
 * Matches:
 * - Static patterns from METADATA_ALLOWLIST_PATTERNS
 * - Dynamic WU-specific patterns: WU YAML file and completion stamp
 *
 * @param filePath - Dirty file path from git status
 * @param wuId - Current WU ID (e.g., "WU-1503")
 * @returns true if the file is on the metadata allowlist
 */
function isMetadataAllowlisted(filePath: string, wuId: string): boolean {
  // Static allowlist
  if (METADATA_ALLOWLIST_PATTERNS.includes(filePath)) {
    return true;
  }

  // Dynamic WU-specific patterns
  if (filePath === WU_PATHS.WU(wuId)) {
    return true;
  }

  // Stamps directory (any stamp file is allowed during wu:done)
  if (filePath.startsWith(`${LUMENFLOW_PATHS.STAMPS_DIR}/`)) {
    return true;
  }

  return false;
}

/**
 * WU-1503: Check if a file path matches any of the WU's code_paths.
 *
 * Supports both exact matches and prefix/directory matches
 * (e.g., code_path "packages/@lumenflow/cli/src/" matches
 *  dirty file "packages/@lumenflow/cli/src/wu-done.ts").
 *
 * @param filePath - Dirty file path from git status
 * @param codePaths - WU code_paths array
 * @returns true if the file is covered by code_paths
 */
function isCodePathRelated(filePath: string, codePaths: string[]): boolean {
  for (const codePath of codePaths) {
    // Exact match
    if (filePath === codePath) {
      return true;
    }
    // Prefix match (code_path is a directory prefix)
    if (codePath.endsWith('/') && filePath.startsWith(codePath)) {
      return true;
    }
    // Reverse prefix match (dirty file is a parent of code_path)
    if (filePath.endsWith('/') && codePath.startsWith(filePath)) {
      return true;
    }
  }
  return false;
}

/**
 * WU-1503: Parse a file path from a git status --porcelain line.
 *
 * Porcelain format: XY filename
 * For renames: XY old-name -> new-name
 *
 * @param line - Single line from git status --porcelain output
 * @returns Parsed file path, or null for unparseable lines
 */
function parseGitStatusPath(line: string): string | null {
  if (line.length < 4) {
    return null;
  }

  // The path starts at position 3 (after XY and space)
  const pathPart = line.substring(3).trim();

  if (!pathPart) {
    return null;
  }

  // Handle renames: "old-name -> new-name" - use destination
  const arrowIndex = pathPart.indexOf(' -> ');
  if (arrowIndex !== -1) {
    return pathPart.substring(arrowIndex + 4);
  }

  return pathPart;
}

/**
 * WU-1503: Validate that main checkout dirty state does not contain unrelated files.
 *
 * Performs a pre-merge dirty-main check by comparing dirty paths from
 * `git status --porcelain` against the WU's code_paths plus an explicit
 * metadata allowlist.
 *
 * @param gitStatusOutput - Raw output from `git status --porcelain`
 * @param wuId - WU ID (e.g., "WU-1503")
 * @param codePaths - WU code_paths array from YAML spec
 * @returns Validation result with unrelated files list
 */
export interface DirtyMainResult {
  valid: boolean;
  unrelatedFiles: string[];
  relatedFiles: string[];
}

export function validateDirtyMain(
  gitStatusOutput: string,
  wuId: string,
  codePaths: string[],
): DirtyMainResult {
  // Split lines BEFORE trimming to preserve leading spaces in porcelain format.
  // Porcelain lines start with 2-char status codes (e.g., " M", "??", "M ")
  // where the leading space is significant.
  const lines = gitStatusOutput.split('\n').filter((line) => line.length >= 4);

  if (lines.length === 0) {
    return { valid: true, unrelatedFiles: [], relatedFiles: [] };
  }
  const unrelatedFiles: string[] = [];
  const relatedFiles: string[] = [];

  for (const line of lines) {
    const filePath = parseGitStatusPath(line);
    if (!filePath) {
      continue;
    }

    // Check if file is on the metadata allowlist or matches code_paths
    if (isMetadataAllowlisted(filePath, wuId) || isCodePathRelated(filePath, codePaths)) {
      relatedFiles.push(filePath);
    } else {
      unrelatedFiles.push(filePath);
    }
  }

  return {
    valid: unrelatedFiles.length === 0,
    unrelatedFiles,
    relatedFiles,
  };
}

/**
 * WU-1503: Build actionable error message for dirty-main guard failure.
 *
 * Provides remediation guidance for unrelated dirty files on main,
 * including the --force bypass option.
 *
 * @param wuId - WU ID (e.g., "WU-1503")
 * @param unrelatedFiles - List of unrelated dirty file paths
 * @returns Formatted error message with remediation guidance
 */
export function buildDirtyMainErrorMessage(wuId: string, unrelatedFiles: string[]): string {
  const count = unrelatedFiles.length;
  const fileList = unrelatedFiles.map((f) => `  - ${f}`).join('\n');

  return (
    `DIRTY MAIN PRE-MERGE GUARD (WU-1503)\n\n` +
    `${count} unrelated file(s) found dirty on main checkout:\n\n` +
    `${fileList}\n\n` +
    `wu:done for ${wuId} cannot proceed because unrelated dirty files\n` +
    `would survive completion and pollute subsequent WUs.\n\n` +
    `Remediation options:\n` +
    `  1. Commit the changes in a separate WU:\n` +
    `     git add ${unrelatedFiles.join(' ')}\n` +
    `     git commit -m "fix: address unrelated changes"\n\n` +
    `  2. Discard the changes if they are unwanted:\n` +
    `     git checkout -- ${unrelatedFiles.join(' ')}\n\n` +
    `  3. Force bypass (audited, use with caution):\n` +
    `     pnpm wu:done --id ${wuId} --force\n\n` +
    `After resolving, retry:\n` +
    `  pnpm wu:done --id ${wuId}`
  );
}
