#!/usr/bin/env node

/**
 * Validation functions for wu:done workflow
 * Extracted from wu-done.mjs (WU-1215 refactoring)
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection */
import { parseWUArgs } from './arg-parser.js';
import { die, createError, ErrorCodes } from './error-handler.js';
import { WU_PATHS } from './wu-paths.js';
import { EXIT_CODES } from './wu-constants.js';
// WU-1352: Use centralized YAML functions from wu-yaml.mjs
import { readWU, writeWU, parseYAML } from './wu-yaml.js';
import { getGitForCwd } from './git-adapter.js';
import path from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { exec as execCallback, execSync as execSyncImport } from 'node:child_process';
import { promisify } from 'node:util';
import { updateStatusRemoveInProgress, addToStatusCompleted } from './wu-status-updater.js';
import { moveWUToDoneBacklog } from './wu-backlog-updater.js';
import { createStamp } from './stamp-utils.js';
import { WU_EVENTS_FILE_NAME } from './wu-state-store.js';
import {
  computeWUYAMLContent,
  computeStatusContent,
  computeBacklogContent,
  computeWUEventsContentAfterComplete,
  computeStampContent,
} from './wu-transaction-collectors.js';

const execAsync = promisify(execCallback);
import {
  PATTERNS,
  REMOTES,
  toKebab,
  VALIDATION,
  WU_TYPES,
  TEST_TYPES,
  DEFAULTS,
  LOG_PREFIX,
  EMOJI,
  CLAIMED_MODES,
  PKG_MANAGER,
  SCRIPTS,
  PRETTIER_FLAGS,
  GIT_COMMANDS,
  FILE_SYSTEM,
  BRANCHES,
  STRING_LITERALS,
  BEACON_PATHS,
  STDIO,
} from './wu-constants.js';
import { PLACEHOLDER_SENTINEL } from './wu-schema.js';
// WU-1433: Manual test escape hatch validator
import { validateAutomatedTestRequirement } from './manual-test-validator.js';
// WU-1440: Import merged check for branch deletion
import { isBranchAlreadyMerged } from './wu-done-worktree.js';
// WU-2241: Import cleanup lock for concurrent collision prevention
import { withCleanupLock } from './cleanup-lock.js';
// WU-1805: Import preflight validators for code_paths validation
import { validatePreflight } from './wu-preflight-validators.js';
// WU-2242: Import isDocumentationPath for test_paths enforcement
import { isDocumentationPath } from './file-classifiers.js';
// WU-2278: Import ownership validation for cross-agent protection
import { validateWorktreeOwnership } from './worktree-ownership.js';
// WU-2278: Import cleanup install config for timeout and CI mode
import { getCleanupInstallConfig, CLEANUP_INSTALL_TIMEOUT_MS } from './cleanup-install-config.js';

/**
 * Prefixes for paths that qualify as "docs-only" (no code changes).
 * Unlike SKIP_TESTS_PREFIXES, this excludes tools/ and scripts/ because
 * those contain code files that require full gate validation.
 *
 * WU-1539: Split from shouldSkipWebTests to fix docs-only misclassification.
 * @constant {string[]}
 */
const DOCS_ONLY_PREFIXES = Object.freeze(['docs/', 'ai/', '.claude/', 'memory-bank/']);

/**
 * Root file patterns that qualify as docs-only.
 * @constant {string[]}
 */
const DOCS_ONLY_ROOT_FILES = Object.freeze(['readme', 'claude']);

/**
 * WU-1234 + WU-1255 + WU-1539: Detect docs-only WU from code_paths
 * Returns true if all code_paths are documentation paths only.
 *
 * Docs-only paths: docs/, ai/, .claude/, memory-bank/, README*, CLAUDE*.md
 * NOT docs-only: tools/, scripts/ (these are code, not documentation)
 *
 * WU-1539: Fixed misclassification where tools/ was treated as docs-only
 * but then rejected by validateDocsOnly(). tools/ should skip web tests
 * but NOT be classified as docs-only.
 *
 * @param {string[]|null|undefined} codePaths - Array of file paths from WU YAML
 * @returns {boolean} True if WU is docs-only (all paths are documentation)
 */
function detectDocsOnlyByPaths(codePaths) {
  if (!codePaths || !Array.isArray(codePaths) || codePaths.length === 0) {
    return false;
  }

  return codePaths.every((filePath) => {
    if (!filePath || typeof filePath !== 'string') {
      return false;
    }

    const path = filePath.trim();
    if (path.length === 0) {
      return false;
    }

    // Check docs-only prefixes (docs/, ai/, .claude/, memory-bank/)
    for (const prefix of DOCS_ONLY_PREFIXES) {
      if (path.startsWith(prefix)) {
        return true;
      }
    }

    // Check if it's a markdown file (*.md)
    if (path.endsWith('.md')) {
      return true;
    }

    // Check root file patterns (README*, CLAUDE*.md)
    const lowerPath = path.toLowerCase();
    for (const pattern of DOCS_ONLY_ROOT_FILES) {
      if (lowerPath.startsWith(pattern)) {
        return true;
      }
    }

    return false;
  });
}

/**
 * Validates command-line inputs and WU ID format
 * @param {string[]} argv - Process arguments
 * @returns {{ args: object, id: string }} Parsed args and validated WU ID
 */
export function validateInputs(argv) {
  const args = parseWUArgs(argv);
  if (args.help || !args.id) {
    console.log(
      'Usage: pnpm wu:done --id WU-334 [OPTIONS]\n\n' +
        'Options:\n' +
        '  --worktree <path>   Override worktree path (default: worktrees/<lane>-<wu-id>)\n' +
        '  --no-auto           Skip auto-updating YAML/backlog/status (you staged manually)\n' +
        '  --no-remove         Skip worktree removal\n' +
        '  --no-merge          Skip auto-merging lane branch to main\n' +
        '  --delete-branch     Delete lane branch after merge (both local and remote)\n' +
        '  --create-pr         Create PR instead of auto-merge (requires gh CLI)\n' +
        '  --pr-draft          Create PR as draft (use with --create-pr)\n' +
        '  --skip-gates        Skip gates check (USE WITH EXTREME CAUTION)\n' +
        '  --reason "<text>"   Required with --skip-gates or --override-owner\n' +
        '  --fix-wu WU-{id}    Required with --skip-gates: WU ID that will fix the failures\n' +
        '  --allow-todo        Allow TODO comments in code (requires justification in WU notes)\n' +
        '  --override-owner    Override ownership check (requires --reason, audited)\n' +
        '  --no-auto-rebase    Disable auto-rebase on branch divergence (WU-1303)\n' +
        '  --require-agents    Block completion if mandatory agents not invoked (WU-1542)\n' +
        '  --help, -h          Show this help\n\n' +
        '⚠️  SKIP-GATES WARNING:\n' +
        '  Only use --skip-gates when:\n' +
        '    • Test failures are confirmed pre-existing (not introduced by your WU)\n' +
        '    • A separate WU exists to fix those failures (specify with --fix-wu)\n' +
        '    • Your WU work is genuinely complete\n\n' +
        '  NEVER use --skip-gates for failures introduced by your WU!\n' +
        '  All skip-gates events are logged to .beacon/skip-gates-audit.log\n\n' +
        '📝 WU VALIDATOR:\n' +
        '  Automatically scans code_paths for:\n' +
        '    • TODO/FIXME/HACK/XXX comments (fails validation unless --allow-todo)\n' +
        '    • Mock/Stub/Fake classes in production code (warning only)\n' +
        '  Use --allow-todo only for legitimate cases with justification in WU notes.\n'
    );
    process.exit(args.help ? EXIT_CODES.SUCCESS : EXIT_CODES.ERROR);
  }

  const id = args.id.toUpperCase();
  if (!PATTERNS.WU_ID.test(id)) die(`Invalid WU id '${args.id}'. Expected format WU-123`);

  return { args, id };
}

/**
 * Read WU YAML preferring worktree version over main version
 *
 * WU-1584 Fix #4: Added diagnostic logging to confirm which YAML file is being
 * read for code_paths validation. This helps debug issues where worktree YAML
 * differs from main checkout YAML.
 *
 * @param {string} id - WU ID
 * @param {string|null} worktreePath - Worktree path (null if branch-only mode)
 * @param {string} mainWUPath - Path to WU YAML in main checkout
 * @returns {object} Parsed WU document
 */
export function readWUPreferWorktree(id, worktreePath, mainWUPath) {
  if (worktreePath) {
    const wtWUPath = path.join(worktreePath, WU_PATHS.WU(id));
    if (existsSync(wtWUPath)) {
      try {
        const text = readFileSync(wtWUPath, FILE_SYSTEM.ENCODING);
        const doc = parseYAML(text);
        if (doc && doc.id === id) {
          // WU-1584: Log source file for validation debugging
          console.log(
            `${LOG_PREFIX.DONE} ${EMOJI.INFO} Reading WU YAML from worktree: ${wtWUPath}`
          );
          if (doc.code_paths && doc.code_paths.length > 0) {
            console.log(
              `${LOG_PREFIX.DONE}   code_paths source: worktree (${doc.code_paths.length} path(s))`
            );
          }
          return doc;
        }
        // If ID mismatch, log warning but continue
        console.warn(
          `${LOG_PREFIX.DONE} Warning: Worktree YAML ID mismatch (expected ${id}, got ${doc?.id})`
        );
      } catch (err) {
        // Log parse errors for debugging
        console.warn(`${LOG_PREFIX.DONE} Warning: Failed to read worktree YAML: ${err.message}`);
      }
    } else {
      // Log missing worktree YAML for debugging
      console.warn(`${LOG_PREFIX.DONE} Warning: Worktree YAML not found at ${wtWUPath}`);
    }
  }
  // WU-1584: Log when falling back to main checkout YAML
  console.log(`${LOG_PREFIX.DONE} ${EMOJI.INFO} Reading WU YAML from main: ${mainWUPath}`);
  const doc = readWU(mainWUPath, id);
  if (doc.code_paths && doc.code_paths.length > 0) {
    console.log(
      `${LOG_PREFIX.DONE}   code_paths source: main checkout (${doc.code_paths.length} path(s))`
    );
  }
  return doc;
}

/**
 * Detect if currently running inside a worktree
 * Checks for .git file (not directory) which indicates a worktree
 * @returns {string|null} Current directory path if inside worktree, null otherwise
 */
export function detectCurrentWorktree() {
  const cwd = process.cwd();
  const gitPath = path.join(cwd, '.git');

  // Check if .git exists and is a file (worktrees have .git file, main has .git directory)
  if (!existsSync(gitPath)) return null;

  try {
    const stats = statSync(gitPath);
    if (stats.isFile()) {
      // Parse .git file to verify it points to main repo's worktrees
      const gitContent = readFileSync(gitPath, FILE_SYSTEM.ENCODING);
      const match = gitContent.match(/^gitdir:\s*(.+)$/m);
      if (match && match[1].includes('.git/worktrees/')) {
        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.TARGET} Auto-detected worktree from process.cwd(): ${cwd}`
        );
        return cwd;
      }
    }
  } catch (err) {
    // Ignore errors, fall back to calculated path
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.WARNING} Failed to detect worktree: ${err.message}`);
  }

  return null;
}

/**
 * Resolve worktree path from WU YAML
 * Originally implemented in WU-1226, extracted to validators module in WU-1215
 * Priority:
 * 1. Read worktree_path field (set at claim time, immune to lane field changes)
 * 2. Fall back to calculating from lane field (for old WUs without worktree_path)
 * 3. Use git worktree list to find actual path (defensive fallback)
 * @param {object} doc - WU YAML document
 * @returns {Promise<string|null>} - Worktree path or null if not found
 */
export async function defaultWorktreeFrom(doc) {
  // Priority 1 - use recorded worktree_path if available
  if (doc.worktree_path) {
    return doc.worktree_path;
  }

  // Priority 2 - calculate from current lane field (legacy behavior)
  const lane = (doc.lane || '').toString();
  const laneK = toKebab(lane);
  const idK = (doc.id || '').toLowerCase();
  if (!laneK || !idK) return null;

  const calculated = `worktrees/${laneK}-${idK}`;

  // Priority 3 - verify calculated path exists, or find actual path via git worktree list
  let calculatedExists = true;
  try {
    await access(calculated);
  } catch {
    calculatedExists = false;
  }

  if (!calculatedExists) {
    try {
      const worktreeList = await getGitForCwd().worktreeList();
      const lines = worktreeList.split(STRING_LITERALS.NEWLINE);
      const branch = `lane/${laneK}/${idK}`;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('branch ') && lines[i].includes(branch)) {
          // Found the branch, now get the worktree path from previous line
          for (let j = i - 1; j >= 0; j--) {
            if (lines[j].startsWith('worktree ')) {
              const fullPath = lines[j].substring('worktree '.length);
              // Convert absolute path to relative path from repo root
              const repoRoot = process.cwd();
              const relativePath = path.relative(repoRoot, fullPath);
              console.log(
                `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Worktree path mismatch detected:\n` +
                  `  Expected: ${calculated}\n` +
                  `  Actual:   ${relativePath}\n` +
                  `  Using actual path from git worktree list`
              );
              return relativePath;
            }
          }
        }
      }
    } catch (e) {
      console.warn(`${LOG_PREFIX.DONE} Could not query git worktree list: ${e.message}`);
    }
  }

  return calculated;
}

/**
 * Detect workspace mode from WU YAML
 * @param {object} doc - WU YAML document
 * @returns {'worktree' | 'branch-only'}
 */
export function detectWorkspaceMode(doc) {
  // Explicit mode field takes precedence
  if (doc.claimed_mode === CLAIMED_MODES.BRANCH_ONLY) return CLAIMED_MODES.BRANCH_ONLY;
  if (doc.claimed_mode === CLAIMED_MODES.WORKTREE) return CLAIMED_MODES.WORKTREE;

  // Backward compatibility: if claimed_mode is missing, assume worktree mode
  // (all WUs claimed before WU-510 used worktree mode)
  return CLAIMED_MODES.WORKTREE;
}

/**
 * Calculate lane branch name from WU YAML
 * @param {object} doc - WU YAML document
 * @returns {string|null} Lane branch name (e.g., lane/operations-tooling/wu-1215)
 */
export function defaultBranchFrom(doc) {
  const lane = (doc.lane || '').toString();
  const laneK = toKebab(lane);
  const idK = (doc.id || '').toLowerCase();
  if (!laneK || !idK) return null;
  return `lane/${laneK}/${idK}`;
}

/**
 * Check if a branch exists
 * @param {string} branch - Branch name to check
 * @returns {Promise<boolean>} True if branch exists
 */
export async function branchExists(branch) {
  return await getGitForCwd().branchExists(branch);
}

/**
 * Detect workspace mode and calculate all relevant paths
 * @param {string} id - WU ID
 * @param {object} args - Parsed command-line arguments
 * @returns {Promise<object>} Object containing paths, mode info, and WU document
 */
export async function detectModeAndPaths(id, args) {
  const WU_PATH = WU_PATHS.WU(id);
  const STATUS_PATH = WU_PATHS.STATUS();
  const BACKLOG_PATH = WU_PATHS.BACKLOG();
  const STAMPS_DIR = WU_PATHS.STAMPS_DIR();

  // Read WU YAML to detect workspace mode
  let docMain = readWU(WU_PATH, id);
  const workspaceMode = detectWorkspaceMode(docMain);
  const isBranchOnly = workspaceMode === CLAIMED_MODES.BRANCH_ONLY;

  console.log(`\n${LOG_PREFIX.DONE} Detected workspace mode: ${workspaceMode}`);

  // Determine candidate worktree path early (only relevant for Worktree mode)
  // Priority: 1) Auto-detect from cwd 2) Explicit --worktree arg 3) Calculate from YAML
  const detectedWorktree = detectCurrentWorktree();
  const worktreePathGuess = args.worktree || null;

  // For Worktree mode: prefer auto-detected worktree, then explicit arg, then calculated path
  // For Branch-Only mode: use main checkout version (no worktree exists)
  const derivedWorktree = isBranchOnly
    ? null
    : detectedWorktree || worktreePathGuess || (await defaultWorktreeFrom(docMain));

  if (!isBranchOnly && derivedWorktree && !detectedWorktree) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.FOLDER} Calculated worktree path from YAML: ${derivedWorktree}`
    );
  }

  // Read the actual WU YAML for validation (prefer worktree version over main)
  const docForValidation = isBranchOnly
    ? docMain
    : readWUPreferWorktree(id, derivedWorktree, WU_PATH);

  // WU-1234: Detect docs-only by type OR by code_paths
  // Auto-detect if all code_paths are under docs/, ai/, .claude/, or are README/CLAUDE files
  const isDocsOnlyByType = docForValidation.type === 'documentation';
  const isDocsOnlyByPaths = detectDocsOnlyByPaths(docForValidation.code_paths);
  const isDocsOnly = isDocsOnlyByType || isDocsOnlyByPaths;

  if (isDocsOnlyByPaths && !isDocsOnlyByType) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.INFO} Auto-detected docs-only WU from code_paths (type: ${docForValidation.type || 'unset'})`
    );
  }

  return {
    WU_PATH,
    STATUS_PATH,
    BACKLOG_PATH,
    STAMPS_DIR,
    docMain,
    workspaceMode,
    isBranchOnly,
    derivedWorktree,
    docForValidation,
    isDocsOnly,
  };
}

/**
 * Generate commit message for WU completion
 * Extracted from wu-done.mjs (WU-1215 Phase 2 Extraction #1 Helper)
 * @param {string} id - WU ID (e.g., "WU-1215")
 * @param {string} title - WU title
 * @param {number} maxLength - Maximum commit header length from commitlint config
 * @returns {string} Formatted commit message
 * @throws {Error} If generated message exceeds maxLength
 */
export function generateCommitMessage(id, title, maxLength = DEFAULTS.MAX_COMMIT_SUBJECT) {
  const prefix = `wu(${id.toLowerCase()}): done - `;
  const safe = String(title).trim().toLowerCase().replace(/\s+/g, ' ');
  const room = Math.max(0, maxLength - prefix.length);
  const short = safe.length > room ? `${safe.slice(0, room - 1)}…` : safe;
  const msg = `${prefix}${short}`;

  if (msg.length > maxLength) {
    const error = new Error(
      `Commit message too long (${msg.length}/${maxLength}).\n` +
        `Fix: Shorten WU title\n` +
        `Current title: "${title}" (${title.length} chars)\n` +
        `Suggested max: ~${maxLength - prefix.length} chars`
    );
    error.code = 'COMMIT_MESSAGE_TOO_LONG';
    error.data = {
      title,
      titleLength: title.length,
      messageLength: msg.length,
      maxLength,
      suggestedMax: maxLength - prefix.length,
    };
    throw error;
  }

  return msg;
}

/**
 * Validate that required metadata files exist before updating
 * WU-1275: Fail fast before mutations to prevent partial state
 *
 * @param {object} params - Parameters object
 * @param {string} params.statusPath - Path to status.md file
 * @param {string} params.backlogPath - Path to backlog.md file
 * @throws {WUError} If any required file is missing
 */
export function validateMetadataFilesExist({ statusPath, backlogPath }) {
  const missing = [];

  if (!existsSync(statusPath)) {
    missing.push(`Status: ${statusPath}`);
  }

  if (!existsSync(backlogPath)) {
    missing.push(`Backlog: ${backlogPath}`);
  }

  if (missing.length > 0) {
    throw createError(
      ErrorCodes.FILE_NOT_FOUND,
      `Required metadata files missing:\n  ${missing.join('\n  ')}\n\nCannot complete WU - verify worktree has latest metadata files.`,
      { missingFiles: missing }
    );
  }
}

/**
 * Update all metadata files for WU completion
 * Extracted from wu-done.mjs (WU-1215 Phase 2 Extraction #1 Helper)
 * WU-1572: Made async for WUStateStore integration
 * @param {object} params - Parameters object
 * @param {string} params.id - WU ID
 * @param {string} params.title - WU title
 * @param {object} params.doc - WU YAML document to update
 * @param {string} params.wuPath - Path to WU YAML file
 * @param {string} params.statusPath - Path to status.md file
 * @param {string} params.backlogPath - Path to backlog.md file
 */
export async function updateMetadataFiles({ id, title, doc, wuPath, statusPath, backlogPath }) {
  // WU-1275: Fail fast before any mutations
  validateMetadataFilesExist({ statusPath, backlogPath });

  // Update WU YAML (mark as done, lock, set completion timestamp)
  doc.status = 'done';
  doc.locked = true;
  doc.completed_at = new Date().toISOString();
  writeWU(wuPath, doc);

  // Update status.md (remove from In Progress, add to Completed)
  updateStatusRemoveInProgress(statusPath, id);
  addToStatusCompleted(statusPath, id, title);

  // Update backlog.md (move to Done section)
  // WU-1572: Now async for state store integration
  await moveWUToDoneBacklog(backlogPath, id, title);

  // Create completion stamp
  createStamp({ id, title });
}

/**
 * Collect metadata updates to a transaction (WU-1369: Atomic pattern)
 *
 * This is the atomic version of updateMetadataFiles.
 * Instead of writing files immediately, it collects all changes
 * into a WUTransaction object for atomic commit.
 *
 * Usage:
 * ```js
 * const tx = new WUTransaction(id);
 * collectMetadataToTransaction({ id, title, doc, wuPath, statusPath, backlogPath, stampPath, transaction: tx });
 * // All changes are now in tx.pendingWrites
 * // Validate, then commit or abort
 * tx.commit();
 * ```
 *
 * @param {object} params - Parameters object
 * @param {string} params.id - WU ID
 * @param {string} params.title - WU title
 * @param {object} params.doc - WU YAML document to update (will be mutated)
 * @param {string} params.wuPath - Path to WU YAML file
 * @param {string} params.statusPath - Path to status.md file
 * @param {string} params.backlogPath - Path to backlog.md file
 * @param {string} params.stampPath - Path to stamp file
 * @param {WUTransaction} params.transaction - Transaction to add writes to
 */
// WU-1574: Made async for computeBacklogContent
export async function collectMetadataToTransaction({
  id,
  title,
  doc,
  wuPath,
  statusPath,
  backlogPath,
  stampPath,
  transaction,
}) {
  // WU-1369: Fail fast before any computations
  validateMetadataFilesExist({ statusPath, backlogPath });

  // Compute WU YAML content (mutates doc, returns YAML string)
  const wuYAMLContent = computeWUYAMLContent(doc);
  transaction.addWrite(wuPath, wuYAMLContent, 'WU YAML');

  // Compute status.md content
  const statusContent = computeStatusContent(statusPath, id, title);
  transaction.addWrite(statusPath, statusContent, 'status.md');

  // Compute backlog.md content (WU-1574: now async)
  const backlogContent = await computeBacklogContent(backlogPath, id, title);
  transaction.addWrite(backlogPath, backlogContent, 'backlog.md');

  const wuEventsUpdate = await computeWUEventsContentAfterComplete(backlogPath, id);
  if (wuEventsUpdate) {
    transaction.addWrite(wuEventsUpdate.eventsPath, wuEventsUpdate.content, 'wu-events.jsonl');
  }

  // Compute stamp content
  const stampContent = computeStampContent(id, title);
  transaction.addWrite(stampPath, stampContent, 'completion stamp');

  console.log(
    `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Collected ${transaction.size} metadata updates for atomic commit`
  );
}

/**
 * Stage and format metadata files
 * Extracted from wu-done.mjs (WU-1215 Phase 2 Extraction #1 Helper)
 * @param {object} params - Parameters object
 * @param {string} params.id - WU ID (for error reporting)
 * @param {string} params.wuPath - Path to WU YAML file
 * @param {string} params.statusPath - Path to status.md file
 * @param {string} params.backlogPath - Path to backlog.md file
 * @param {string} params.stampsDir - Path to stamps directory
 * @throws {Error} If formatting fails
 */
export async function stageAndFormatMetadata({ id, wuPath, statusPath, backlogPath, stampsDir }) {
  // WU-1235: Use getGitForCwd() to capture current directory (worktree after chdir)
  // The singleton git adapter captures cwd at import time, which is wrong after process.chdir()
  const gitCwd = getGitForCwd();

  // Stage files
  const wuEventsPath = path.join(BEACON_PATHS.STATE_DIR, WU_EVENTS_FILE_NAME);
  const filesToStage = [wuPath, statusPath, backlogPath, stampsDir];
  if (existsSync(wuEventsPath)) {
    filesToStage.push(wuEventsPath);
  }
  await gitCwd.add(filesToStage);

  // Format documentation
  console.log(`${LOG_PREFIX.DONE} Formatting auto-generated documentation...`);
  try {
    const prettierCmd = `${PKG_MANAGER} ${SCRIPTS.PRETTIER} ${PRETTIER_FLAGS.WRITE} "${wuPath}" "${statusPath}" "${backlogPath}"`;
    await execAsync(prettierCmd);
    await gitCwd.add([wuPath, statusPath, backlogPath]);
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Documentation formatted`);
  } catch (err) {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      `Failed to format documentation: ${err.message}`,
      { wuId: id, error: err.message }
    );
  }
}

/**
 * Run cleanup operations after successful merge
 * Removes worktree and optionally deletes lane branch
 * Extracted from wu-done.mjs (WU-1215 Phase 1 Extraction #3)
 *
 * WU-2241: Now wrapped with cleanup lock to prevent concurrent collision
 *          when multiple wu:done commands complete simultaneously.
 *
 * @param {object} docMain - WU YAML document
 * @param {object} args - Parsed CLI arguments
 */
export async function runCleanup(docMain, args) {
  const wuId = docMain.id;
  const worktreePath = args.worktree || (await defaultWorktreeFrom(docMain));

  // WU-2278: Validate worktree ownership before cleanup
  // Prevents cross-agent worktree deletion
  if (!args.overrideOwner) {
    const ownershipResult = validateWorktreeOwnership({ worktreePath, wuId });
    if (!ownershipResult.valid) {
      throw createError(
        ErrorCodes.VALIDATION_ERROR,
        `${ownershipResult.error}\n\nTo override (DANGEROUS): pnpm wu:done --id ${wuId} --override-owner --reason "explanation"`,
        { wuId, worktreePath, error: ownershipResult.error }
      );
    }
  }

  // WU-2241: Wrap cleanup operations in cleanup lock to prevent concurrent collision
  await withCleanupLock(
    wuId,
    async () => {
      await runCleanupInternal(docMain, args, worktreePath);
    },
    { worktreePath }
  );
}

/**
 * Internal cleanup implementation (runs under cleanup lock)
 *
 * @param {object} docMain - WU YAML document
 * @param {object} args - Parsed CLI arguments
 * @param {string|null} worktreePath - Path to worktree
 */
async function runCleanupInternal(docMain, args, worktreePath) {
  // Step 6: Remove worktree (runs even if commit/push failed)
  // Skip removal in PR mode (worktree needed for cleanup after PR merge)
  const claimedMode = docMain.claimed_mode || CLAIMED_MODES.WORKTREE;
  const requiresReview = docMain.requires_review === true;
  const prModeEnabled =
    claimedMode === CLAIMED_MODES.WORKTREE_PR || args.createPR || requiresReview;

  // WU-2241: Track branch for cleanup after worktree removal
  const laneBranch = await defaultBranchFrom(docMain);

  if (!args.noRemove && !prModeEnabled) {
    if (worktreePath && existsSync(worktreePath)) {
      try {
        await getGitForCwd().worktreeRemove(worktreePath, { force: true });
        console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Removed worktree ${worktreePath}`);

        // WU-2241: Delete branch AFTER worktree removal (correct ordering)
        // This ensures we don't leave orphan branches when worktree is removed
        if (laneBranch && (await branchExists(laneBranch))) {
          await deleteBranchWithCleanup(laneBranch);
        }

        // WU-1743: Re-run pnpm install to fix broken symlinks
        // When pnpm install runs in a worktree, it may create symlinks with absolute paths
        // to the worktree. After worktree removal, these symlinks break.
        // Re-running pnpm install regenerates them with correct paths.
        // WU-2278: Use timeout and CI=true to prevent hangs
        console.log(`${LOG_PREFIX.DONE} Reinstalling dependencies to fix symlinks...`);
        try {
          const installConfig = getCleanupInstallConfig();
          await execAsync(installConfig.command, {
            timeout: installConfig.timeout,
            env: installConfig.env,
          });
          console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Dependencies reinstalled`);
        } catch (installErr) {
          // Non-fatal: warn but don't fail wu:done
          // WU-2278: Include timeout info in error message
          const isTimeout = installErr.killed || installErr.signal === 'SIGTERM';
          const errorMsg = isTimeout
            ? `pnpm install timed out after ${CLEANUP_INSTALL_TIMEOUT_MS / 1000}s`
            : `pnpm install failed: ${installErr.message}`;
          console.warn(`${LOG_PREFIX.DONE} ${EMOJI.WARNING} ${errorMsg}`);
        }
      } catch (e) {
        console.warn(`${LOG_PREFIX.DONE} Could not remove worktree ${worktreePath}: ${e.message}`);
      }
    } else {
      console.log(`${LOG_PREFIX.DONE} Worktree not found; skipping removal`);

      // WU-2241: Still cleanup branch if worktree doesn't exist (orphan branch scenario)
      if (!prModeEnabled && laneBranch && (await branchExists(laneBranch))) {
        await deleteBranchWithCleanup(laneBranch);
      }
    }
  } else if (prModeEnabled) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Worktree preserved (PR mode - run wu:cleanup after PR merge)`
    );
  }
}

/**
 * WU-2241: Delete both local and remote branch with proper error handling
 *
 * @param {string} laneBranch - Branch name to delete
 */
async function deleteBranchWithCleanup(laneBranch) {
  const gitAdapter = getGitForCwd();

  // WU-1440: Check if branch is merged before deletion
  // Use -D (force) when confirmed merged to handle rebased branches
  const isMerged = await isBranchAlreadyMerged(laneBranch);

  try {
    await gitAdapter.deleteBranch(laneBranch, { force: isMerged });
    const modeIndicator = isMerged ? ' (force: merged)' : '';
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Deleted local branch ${laneBranch}${modeIndicator}`
    );

    // Also delete remote if it exists
    try {
      await gitAdapter.raw(['push', REMOTES.ORIGIN, '--delete', laneBranch]);
      console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Deleted remote branch ${laneBranch}`);
    } catch (e) {
      // WU-2241: Non-fatal - remote branch may already be deleted or never existed
      console.warn(`${LOG_PREFIX.DONE} Could not delete remote branch: ${e.message}`);
    }
  } catch (e) {
    console.warn(`${LOG_PREFIX.DONE} Could not delete branch ${laneBranch}: ${e.message}`);
  }
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
 *
 * @param {object} doc - WU YAML document
 * @param {string} id - WU ID
 * @param {object} options - Options
 * @param {string} options.targetBranch - Branch to check files against (default: 'main')
 * @param {string} options.worktreePath - Worktree path for worktree mode
 * @returns {Promise<{ valid: boolean, errors: string[], missing: string[] }>} Validation result
 */
export async function validateCodePathsExist(doc, id, options = {}) {
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
            STRING_LITERALS.NEWLINE
          )}\n\nEnsure all files listed in code_paths exist before running wu:done.`
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
            `Context: WU-1351 prevents false completions from INIT-WORKFLOW-INTEGRITY`
        );
      }
    } catch (err) {
      // Non-fatal: warn but don't block if git command fails
      console.warn(
        `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not validate code_paths: ${err.message}`
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
 *
 * WU-1280: Added tests array validation to catch empty tests.manual early
 * (previously only validated in pre-commit hook, causing late failures).
 *
 * @param {object} doc - WU YAML document
 * @param {string} id - WU ID
 * @returns {{ valid: boolean, errors: string[] }} Validation result
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
  // WU-1281: Using centralized constant from wu-constants.mjs
  if (!doc.description || doc.description.trim().length < VALIDATION.MIN_DESCRIPTION_LENGTH) {
    errors.push(
      `Description too short (${doc.description?.trim().length || 0} chars, minimum ${VALIDATION.MIN_DESCRIPTION_LENGTH})`
    );
  }

  // Check code_paths for non-documentation WUs
  // WU-1281: Using centralized type constants from wu-constants.mjs
  if (doc.type !== WU_TYPES.DOCUMENTATION && doc.type !== WU_TYPES.PROCESS) {
    if (!doc.code_paths || doc.code_paths.length === 0) {
      errors.push('Code paths required for non-documentation WUs');
    }

    // WU-1280: Check tests array for non-documentation WUs
    // Support both tests: (current) and test_paths: (legacy)
    const testObj = doc.tests || doc.test_paths || {};

    // Helper to check if array has items
    const hasItems = (arr) => Array.isArray(arr) && arr.length > 0;

    // WU-1281: Using centralized test type constants from wu-constants.mjs
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

// WU-1433: Re-export manual test validator for use in wu:done workflow
export { validateAutomatedTestRequirement };

/**
 * WU-1617: Post-mutation validation for wu:done
 *
 * Validates that metadata files written by tx.commit() are valid:
 * 1. WU YAML has completed_at field with valid ISO datetime
 * 2. WU YAML has locked: true
 * 3. Stamp file exists
 *
 * This catches schema violations that could persist silently after
 * transaction commit.
 *
 * @param {object} params - Validation parameters
 * @param {string} params.id - WU ID
 * @param {string} params.wuPath - Path to WU YAML file
 * @param {string} params.stampPath - Path to stamp file
 * @returns {{ valid: boolean, errors: string[] }} Validation result
 */
export function validatePostMutation({ id, wuPath, stampPath }) {
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
    const content = readFileSync(wuPath, FILE_SYSTEM.ENCODING);
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

    // Verify locked is true
    if (doc.locked !== true) {
      errors.push(
        `Missing or invalid 'locked' field in ${id}.yaml (expected: true, got: ${doc.locked})`
      );
    }

    // Verify status is done
    if (doc.status !== 'done') {
      errors.push(`Invalid status in ${id}.yaml (expected: 'done', got: '${doc.status}')`);
    }
  } catch (err) {
    errors.push(`Failed to parse WU YAML after mutation: ${err.message}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * WU-1781: Build preflight error message with actionable guidance
 *
 * Creates a formatted error message for preflight validation failures,
 * including specific guidance for stamp-status mismatch errors.
 *
 * @param {string} id - WU ID being completed
 * @param {string[]} errors - List of validation errors
 * @returns {string} Formatted error message with fix options
 */
export function buildPreflightErrorMessage(id, errors) {
  const hasStampStatusError = errors.some((e) => e.includes('stamp but status is not done'));

  let message = `
❌ PREFLIGHT VALIDATION FAILED

tasks:validate found errors that would block pre-push hooks.
Aborting wu:done BEFORE any merge operations to prevent deadlocks.

Errors:
${errors.map((e) => `  - ${e}`).join('\n')}

Fix options:
`;

  if (hasStampStatusError) {
    message += `
  For stamp-status mismatch errors:
  1. Fix the WU status to match the stamp (set status: done, locked: true)
  2. Or add the WU ID to .lumenflow.config.yaml > exemptions > stamp_status_mismatch

`;
  }

  message += `
  General fixes:
  1. Run: pnpm tasks:validate to see full errors
  2. Fix the validation errors
  3. Retry: pnpm wu:done --id ${id}

This preflight check prevents wu:done from leaving main in a stuck state
where husky pre-push would block all further operations.
`;

  return message;
}

/**
 * WU-1805: Execute preflight code_paths and test_paths validation
 *
 * Validates that all code_paths and test file paths specified in the WU YAML
 * actually exist before running gates. This catches YAML mismatches early,
 * saving time compared to discovering issues after a full gate run.
 *
 * This is run as the FIRST validation step in wu:done, before gates.
 *
 * @param {string} id - WU ID being completed
 * @param {object} paths - Path options
 * @param {string} paths.rootDir - Root directory for YAML lookup
 * @param {string} paths.worktreePath - Worktree path for file existence checks
 * @param {object} options - Options for testing
 * @param {function} options.validatePreflightFn - Override validatePreflight for testing
 * @returns {Promise<{ valid: boolean, errors: string[], missingCodePaths: string[], missingTestPaths: string[], abortedBeforeGates: boolean }>}
 */
export async function executePreflightCodePathValidation(id, paths, options = {}) {
  // Use injected validator for testability, default to actual implementation
  const validatePreflightFn = options.validatePreflightFn || validatePreflight;

  console.log(`\n${LOG_PREFIX.DONE} 🔍 Preflight: validating code_paths and test paths...`);

  const result = await validatePreflightFn(id, {
    rootDir: paths.rootDir,
    worktreePath: paths.worktreePath,
  });

  if (result.valid) {
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Preflight code_paths validation passed`);
    return {
      valid: true,
      errors: [],
      missingCodePaths: [],
      missingTestPaths: [],
      abortedBeforeGates: false,
    };
  }

  console.error(`\n${LOG_PREFIX.DONE} ${EMOJI.FAILURE} Preflight code_paths validation failed`);

  return {
    valid: false,
    errors: result.errors,
    missingCodePaths: result.missingCodePaths || [],
    missingTestPaths: result.missingTestPaths || [],
    abortedBeforeGates: true,
  };
}

/**
 * WU-1805: Build preflight code_paths error message with actionable guidance
 *
 * Creates a formatted error message for preflight code_paths validation failures,
 * including specific guidance for fixing missing files.
 *
 * @param {string} id - WU ID being completed
 * @param {object} result - Preflight validation result
 * @param {string[]} result.errors - List of validation errors
 * @param {string[]} result.missingCodePaths - Missing code_paths files
 * @param {string[]} result.missingTestPaths - Missing test files
 * @returns {string} Formatted error message with fix options
 */
export function buildPreflightCodePathErrorMessage(id, result) {
  const { errors, missingCodePaths = [], missingTestPaths = [] } = result;

  let message = `
❌ PREFLIGHT CODE_PATHS VALIDATION FAILED

code_paths/test_paths validation found errors that would cause gates to fail.
Aborting wu:done BEFORE running gates to save time.

Errors:
${errors.map((e) => `  ${e}`).join('\n')}

`;

  if (missingCodePaths.length > 0) {
    message += `
Fix options for missing code_paths:
  1. Create the missing files in your worktree
  2. Update code_paths in ${id}.yaml using: pnpm wu:edit --id ${id} --code-paths "<corrected-paths>"
  3. Remove paths that were intentionally not created

`;
  }

  if (missingTestPaths.length > 0) {
    message += `
Fix options for missing test_paths:
  1. Create the missing test files
  2. Update test paths in ${id}.yaml using wu:edit
  3. Use tests.manual for descriptions instead of file paths

`;
  }

  message += `
After fixing, retry:
  pnpm wu:done --id ${id}

This preflight check runs BEFORE gates to catch YAML mismatches early.
See: ai/onboarding/troubleshooting-wu-done.md for more recovery options.
`;

  return message;
}

/**
 * WU-1781: Run tasks:validate as preflight check before any git operations
 *
 * This prevents deadlocks where wu:done completes merge but then pre-push
 * fails on tasks:validate, leaving local main ahead of origin.
 *
 * @param {string} id - WU ID being completed
 * @param {object} options - Options for testing
 * @param {function} options.execSyncFn - Override execSync for testing (default: child_process.execSync)
 * @returns {{ valid: boolean, errors: string[], abortedBeforeMerge: boolean, localMainModified: boolean, hasStampStatusError: boolean }}
 */
export function runPreflightTasksValidation(id, options = {}) {
  // Use injected execSync for testability, default to node's child_process
  const execSyncFn = options.execSyncFn || execSyncImport;

  console.log(`\n${LOG_PREFIX.DONE} 🔍 Preflight: running tasks:validate...`);

  try {
    // Run tasks:validate with WU_ID context (single-WU validation mode)
    execSyncFn('node tools/validate.js', {
      stdio: STDIO.PIPE,
      encoding: FILE_SYSTEM.ENCODING,
      env: { ...process.env, WU_ID: id },
    });

    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Preflight tasks:validate passed`);
    return {
      valid: true,
      errors: [],
      abortedBeforeMerge: false,
      localMainModified: false,
      hasStampStatusError: false,
    };
  } catch (err) {
    // Validation failed - extract errors from output
    const output = err.stdout || err.message || 'Unknown validation error';
    const errors = output
      .split('\n')
      .filter((line) => line.includes('[') && line.includes(']'))
      .map((line) => line.trim());

    const hasStampStatusError = errors.some((e) => e.includes('stamp but status is not done'));

    console.error(`\n${LOG_PREFIX.DONE} ${EMOJI.FAILURE} Preflight tasks:validate failed`);

    return {
      valid: false,
      errors: errors.length > 0 ? errors : [output],
      abortedBeforeMerge: true,
      localMainModified: false,
      hasStampStatusError,
    };
  }
}

/**
 * WU-2308: Validate all pre-commit hooks with worktree context
 *
 * Runs pre-commit validation gates from the worktree directory when provided.
 * This ensures that dependency audits check the worktree's dependencies
 * (with any fixes) rather than main's potentially stale dependencies.
 *
 * @param {string} id - WU ID being completed
 * @param {string|null} worktreePath - Path to worktree (null = run from current dir)
 * @param {object} options - Options for testing
 * @param {function} options.execSyncFn - Override execSync for testing
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateAllPreCommitHooks(id, worktreePath = null, options = {}) {
  const execSyncFn = options.execSyncFn || execSyncImport;

  console.log(`\n${LOG_PREFIX.DONE} 🔍 Pre-flight: validating all pre-commit hooks...`);

  const errors = [];

  try {
    // WU-2308: Run from worktree context when provided to ensure audit checks
    // the worktree's dependencies (with fixes) not main's stale dependencies
    const execOptions = {
      stdio: STDIO.INHERIT,
      encoding: FILE_SYSTEM.ENCODING,
    };

    // Only set cwd when worktreePath is provided
    if (worktreePath) {
      execOptions.cwd = worktreePath;
    }

    // Run the gates-pre-commit script that contains all validation gates
    execSyncFn('node tools/gates-pre-commit.js', execOptions);

    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} All pre-commit hooks passed`);
    return { valid: true, errors: [] };
  } catch {
    // Pre-commit hooks failed
    errors.push('Pre-commit hook validation failed. Fix these issues before wu:done:');
    errors.push('');
    errors.push('Common fixes:');
    errors.push('  • Formatting issues: Run pnpm format');
    errors.push('  • Lint errors: Run pnpm lint:fix');
    errors.push('  • Type errors: Check pnpm typecheck output');
    errors.push('  • Audit issues: Check pnpm audit output');
    errors.push('');
    errors.push(`After fixing, re-run: pnpm wu:done --id ${id}`);

    return { valid: false, errors };
  }
}

/**
 * WU-2242: Validate that test_paths is required for non-doc WUs
 *
 * Enforces that WUs with code changes (non-documentation types with code_paths
 * that contain actual code) have at least one test path specified.
 *
 * Returns valid: true in the following cases:
 * - WU type is 'documentation' or 'process'
 * - code_paths is empty or only contains documentation paths
 * - tests object has at least one test (unit, e2e, manual, or integration)
 *
 * @param {object} wu - WU document
 * @param {string} wu.id - WU ID
 * @param {string} wu.type - WU type (feature, bug, documentation, etc.)
 * @param {object} wu.tests - Tests object with unit, e2e, manual, integration arrays
 * @param {string[]} wu.code_paths - Array of code paths
 * @returns {{ valid: boolean, error?: string }}
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
 * Mirrors the patterns in gates-pre-commit.mjs gateDocsOnlyPathEnforcement()
 * to enable early validation at preflight (before transaction starts).
 *
 * @constant {RegExp[]}
 */
const DOCS_ONLY_ALLOWED_PATTERNS = [
  /^memory-bank\//i,
  /^docs\//i,
  /\.md$/i,
  /^\.beacon\/stamps\//i,
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
 *
 * This catches the documentation WU + code file mismatch BEFORE any transaction
 * begins, preventing the scenario where:
 * 1. Transaction commits files (stamp, status, backlog)
 * 2. Git commit fails due to pre-commit hook (gateDocsOnlyPathEnforcement)
 * 3. Files are left in inconsistent state
 *
 * By running this validation at preflight, we fail fast with a clear error
 * message before any file mutations occur.
 *
 * @param {object} wu - WU document
 * @param {string} wu.id - WU ID
 * @param {string} wu.type - WU type (documentation, feature, bug, etc.)
 * @param {string[]} [wu.code_paths] - Array of code paths
 * @returns {{ valid: boolean, errors: string[], blockedPaths: string[], abortedBeforeTransaction: boolean }}
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
      `Documentation WU ${wu.id} has code_paths that would fail pre-commit hook:\n${pathsList}`
    );
    return { valid: false, errors, blockedPaths, abortedBeforeTransaction: true };
  }

  return { valid: true, errors: [], blockedPaths: [], abortedBeforeTransaction: false };
}

/**
 * WU-2310: Build error message for type vs code_paths preflight failure.
 *
 * Provides actionable guidance for fixing the mismatch:
 * 1. Change WU type to 'engineering' or appropriate type
 * 2. Update code_paths to only include documentation files
 *
 * @param {string} id - WU ID
 * @param {string[]} blockedPaths - Paths that would be blocked
 * @returns {string} Formatted error message
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
  - .beacon/stamps/
  - *.md files

After fixing, retry: pnpm wu:done --id ${id}
`;
}
