#!/usr/bin/env node
/**
 * WU Claim Helper
 *
 * Canonical sequence:
 * 1) Auto-update backlog/status/WU YAML (safe parsing) unless `--no-auto`
 * 2) Commit and push to `main`
 * 3) Create a dedicated worktree+branch for the WU
 *
 * Usage:
 *   node tools/wu-claim.mjs --id WU-334 --lane Intelligence \
 *     [--worktree worktrees/intelligence-wu-334] [--branch lane/intelligence/wu-334]
 *
 * WU-2542: This script imports utilities from @lumenflow/core package.
 * Full migration to thin shim pending @lumenflow/core CLI export implementation.
 */

// WU-2542: Import from @lumenflow/core to establish shim layer dependency
// eslint-disable-next-line no-unused-vars -- Validates @lumenflow/core package link
import { VERSION as LUMENFLOW_VERSION } from '@lumenflow/core';

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isOrphanWorktree } from '@lumenflow/core/dist/orphan-detector.js';
// WU-1352: Use centralized YAML functions from wu-yaml.mjs
import { parseYAML, stringifyYAML } from '@lumenflow/core/dist/wu-yaml.js';
import { assertTransition } from '@lumenflow/core/dist/state-machine.js';
import { checkLaneFree, validateLaneFormat } from '@lumenflow/core/dist/lane-checker.js';
// WU-1603: Atomic lane locking to prevent TOCTOU race conditions
import {
  acquireLaneLock,
  releaseLaneLock,
  checkLaneLock,
  forceRemoveStaleLock,
} from '@lumenflow/core/dist/lane-lock.js';
// WU-1825: Import from unified code-path-validator (consolidates 3 validators)
import {
  validateLaneCodePaths,
  logLaneValidationWarnings,
} from '@lumenflow/core/dist/code-path-validator.js';
// WU-1574: parseBacklogFrontmatter/getSectionHeadings removed - state store replaces backlog parsing
import { detectConflicts } from '@lumenflow/core/dist/code-paths-overlap.js';
import { getGitForCwd, createGitForPath } from '@lumenflow/core/dist/git-adapter.js';
import { die } from '@lumenflow/core/dist/error-handler.js';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/dist/arg-parser.js';
import { WU_PATHS, getStateStoreDirFromBacklog } from '@lumenflow/core/dist/wu-paths.js';
import {
  BRANCHES,
  REMOTES,
  WU_STATUS,
  CLAIMED_MODES,
  STATUS_SECTIONS,
  PATTERNS,
  toKebab,
  LOG_PREFIX,
  MICRO_WORKTREE_OPERATIONS,
  COMMIT_FORMATS,
  EMOJI,
  FILE_SYSTEM,
  STRING_LITERALS,
} from '@lumenflow/core/dist/wu-constants.js';
import { withMicroWorktree } from '@lumenflow/core/dist/micro-worktree.js';
import { ensureOnMain } from '@lumenflow/core/dist/wu-helpers.js';
import { emitWUFlowEvent } from '@lumenflow/core/dist/telemetry.js';
import {
  checkLaneForOrphanDoneWU,
  repairWUInconsistency,
} from '@lumenflow/core/dist/wu-consistency-checker.js';
import { emitMandatoryAgentAdvisory } from '@lumenflow/core/dist/orchestration-advisory-loader.js';
import { validateWU, generateAutoApproval } from '@lumenflow/core/dist/wu-schema.js';
import { startSessionForWU } from '@lumenflow/agent/dist/auto-session-integration.js';
import {
  detectFixableIssues,
  applyFixes,
  autoFixWUYaml,
  formatIssues,
} from '@lumenflow/core/dist/wu-yaml-fixer.js';
import { validateSpecCompleteness } from '@lumenflow/core/dist/wu-done-validators.js';
import { getAssignedEmail } from '@lumenflow/core/dist/wu-claim-helpers.js';
import {
  symlinkNodeModules,
  symlinkNestedNodeModules,
} from '@lumenflow/core/dist/worktree-symlink.js';
// WU-1572: Import WUStateStore for event-sourced state tracking
import { WUStateStore } from '@lumenflow/core/dist/wu-state-store.js';
// WU-1574: Import backlog generator to replace BacklogManager
import { generateBacklog, generateStatus } from '@lumenflow/core/dist/backlog-generator.js';
// WU-2411: Import resume helpers for agent handoff
import {
  resumeClaimForHandoff,
  getWorktreeUncommittedChanges,
  formatUncommittedChanges,
  createHandoffCheckpoint,
} from '@lumenflow/core/dist/wu-claim-resume.js';

// ensureOnMain() moved to wu-helpers.mjs (WU-1256)

async function ensureCleanOrClaimOnlyWhenNoAuto() {
  // Require staged claim edits only if running with --no-auto
  const status = await getGitForCwd().getStatus();
  if (!status)
    die(
      'No staged changes detected. Stage backlog/status/WU YAML claim edits first or omit --no-auto.',
    );
  const staged = status
    .split(STRING_LITERALS.NEWLINE)
    .filter(Boolean)
    .filter((l) => l.startsWith('A ') || l.startsWith('M ') || l.startsWith('R '));
  const hasClaimFiles = staged.some(
    (l) =>
      l.includes('docs/04-operations/tasks/status.md') ||
      l.includes('docs/04-operations/tasks/backlog.md') ||
      /docs\/04-operations\/tasks\/wu\/WU-\d+\.yaml/.test(l),
  );
  if (!hasClaimFiles) {
    console.error(status);
    die('Stage claim-related files (status/backlog/WU YAML) before running with --no-auto.');
  }
}

const PREFIX = LOG_PREFIX.CLAIM;

/**
 * Pre-flight validation: Check WU file exists and is valid BEFORE any git operations
 * Prevents zombie worktrees when WU YAML is missing or malformed
 */
function preflightValidateWU(WU_PATH, id) {
  // Check file exists
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool validates WU files
  if (!existsSync(WU_PATH)) {
    die(
      `WU file not found: ${WU_PATH}\n\n` +
        `Cannot claim a WU that doesn't exist.\n\n` +
        `Options:\n` +
        `  1. Create the WU first: pnpm wu:create --id ${id} --lane <lane> --title "..."\n` +
        `  2. Check if the WU ID is correct\n` +
        `  3. Check if the WU file was moved or deleted`,
    );
  }

  // Parse and validate YAML structure
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool validates WU files
  const text = readFileSync(WU_PATH, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  let doc;
  try {
    doc = parseYAML(text);
  } catch (e) {
    die(
      `Failed to parse WU YAML ${WU_PATH}\n\n` +
        `YAML parsing error: ${e.message}\n\n` +
        `Fix the YAML syntax errors before claiming.`,
    );
  }

  // Validate ID matches
  if (!doc || doc.id !== id) {
    die(
      `WU YAML id mismatch in ${WU_PATH}\n\n` +
        `Expected: ${id}\n` +
        `Found: ${doc?.id || 'missing'}\n\n` +
        `Fix the id field in the WU YAML before claiming.`,
    );
  }

  // Validate state transition is allowed
  const currentStatus = doc.status || WU_STATUS.READY;
  try {
    assertTransition(currentStatus, WU_STATUS.IN_PROGRESS, id);
  } catch (error) {
    die(
      `Cannot claim ${id} - invalid state transition\n\n` +
        `Current status: ${currentStatus}\n` +
        `Attempted transition: ${currentStatus} → in_progress\n\n` +
        `Reason: ${error.message}`,
    );
  }

  return doc;
}

/**
 * WU-1361: Validate YAML schema at claim time
 *
 * Validates WU YAML against Zod schema AFTER git pull.
 * Detects fixable issues BEFORE schema validation (so --fix can run even if schema fails).
 * Returns fixable issues for application in worktree (WU-1361 fix).
 *
 * @param {string} WU_PATH - Path to WU YAML file
 * @param {object} doc - Parsed WU YAML data
 * @param {object} args - CLI arguments
 * @param {boolean} args.fix - If true, issues will be fixed in worktree
 * @returns {Array} Array of fixable issues to apply in worktree
 */
function validateYAMLSchema(WU_PATH, doc, args) {
  // WU-1361: Detect fixable issues BEFORE schema validation
  // This allows --fix to work even when schema would fail
  const fixableIssues = detectFixableIssues(doc);

  if (fixableIssues.length > 0) {
    if (args.fix) {
      // WU-1425: Apply fixes to in-memory doc so validation passes
      // Note: This does NOT modify the file on disk - only the in-memory object
      // The actual file fix happens when the doc is written to the worktree
      applyFixes(doc, fixableIssues);
      console.log(
        `${PREFIX} Detected ${fixableIssues.length} fixable YAML issue(s) (will fix in worktree):`,
      );
      console.log(formatIssues(fixableIssues));
    } else {
      // Report issues and suggest --fix
      console.warn(`${PREFIX} Detected ${fixableIssues.length} fixable YAML issue(s):`);
      console.warn(formatIssues(fixableIssues));
      console.warn(`${PREFIX} Run with --fix to auto-repair these issues.`);
      // Continue - Zod validation will provide the detailed error
    }
  }

  // Now run Zod schema validation
  const schemaResult = validateWU(doc);
  if (!schemaResult.success) {
    const issueList = schemaResult.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join(STRING_LITERALS.NEWLINE);

    const tip =
      fixableIssues.length > 0 ? 'Tip: Run with --fix to auto-repair common issues.\n' : '';
    die(
      `WU YAML schema validation failed for ${WU_PATH}:\n\n${issueList}\n\nFix these issues before claiming.\n${tip}`,
    );
  }

  // WU-1361: Return fixable issues for application in worktree
  return args.fix ? fixableIssues : [];
}

// WU-1576: validateBacklogConsistency removed - repair now happens inside micro-worktree
// See claimWorktreeMode() execute function for the new location

async function updateWUYaml(
  WU_PATH,
  id,
  lane,
  claimedMode = 'worktree',
  worktreePath = null,
  sessionId = null,
) {
  // Check file exists

  try {
    await access(WU_PATH);
  } catch {
    die(
      `WU file not found: ${WU_PATH}\n\n` +
        `Options:\n` +
        `  1. Create the WU first: pnpm wu:create --id ${id} --lane "${lane}" --title "..."\n` +
        `  2. Check if the WU ID is correct`,
    );
  }

  // Read file
  let text;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool validates WU files
    text = await readFile(WU_PATH, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  } catch (e) {
    die(
      `Failed to read WU file: ${WU_PATH}\n\n` +
        `Error: ${e.message}\n\n` +
        `Options:\n` +
        `  1. Check file permissions: ls -la ${WU_PATH}\n` +
        `  2. Ensure you have read access to the repository`,
    );
  }
  let doc;
  try {
    doc = parseYAML(text);
  } catch (e) {
    die(
      `Failed to parse YAML ${WU_PATH}\n\n` +
        `Error: ${e.message}\n\n` +
        `Options:\n` +
        `  1. Validate YAML syntax: pnpm wu:validate --id ${id}\n` +
        `  2. Fix YAML errors manually and retry`,
    );
  }
  if (!doc || doc.id !== id) {
    die(
      `WU YAML id mismatch. Expected ${id}, found ${doc && doc.id}\n\n` +
        `Options:\n` +
        `  1. Check the WU file has correct id field\n` +
        `  2. Verify you're claiming the right WU`,
    );
  }

  // Validate state transition before updating
  const currentStatus = doc.status || WU_STATUS.READY;
  try {
    assertTransition(currentStatus, WU_STATUS.IN_PROGRESS, id);
  } catch (error) {
    die(`State transition validation failed: ${error.message}`);
  }

  // Update status and lane (lane only if provided and different)
  doc.status = WU_STATUS.IN_PROGRESS;
  if (lane) doc.lane = lane;
  // Record claimed mode (worktree or branch-only)
  doc.claimed_mode = claimedMode;
  // WU-1226: Record worktree path to prevent resolution failures if lane field changes
  if (worktreePath) {
    doc.worktree_path = worktreePath;
  }
  // WU-1423: Record owner using validated email (no silent username fallback)
  // Fallback chain: git config user.email > GIT_AUTHOR_EMAIL > error
  // WU-1427: getAssignedEmail is now async to properly await gitAdapter.getConfigValue
  doc.assigned_to = await getAssignedEmail(getGitForCwd());
  // Record claim timestamp for duration tracking (WU-637)
  doc.claimed_at = new Date().toISOString();
  // WU-1382: Store baseline main SHA for parallel agent detection
  // wu:done will compare against this to detect if other WUs were merged during work
  const git = getGitForCwd();
  doc.baseline_main_sha = await git.getCommitHash('origin/main');
  // WU-1438: Store agent session ID for tracking
  if (sessionId) {
    doc.session_id = sessionId;
  }

  // WU-2080: Agent-first auto-approval
  // Agents auto-approve on claim. Human escalation only for detected triggers.
  const autoApproval = generateAutoApproval(doc, doc.assigned_to);
  doc.approved_by = autoApproval.approved_by;
  doc.approved_at = autoApproval.approved_at;
  doc.escalation_triggers = autoApproval.escalation_triggers;
  doc.requires_human_escalation = autoApproval.requires_human_escalation;

  // Log escalation triggers if any detected
  if (autoApproval.requires_human_escalation) {
    console.log(
      `[wu-claim] ⚠️  Escalation triggers detected: ${autoApproval.escalation_triggers.join(', ')}`,
    );
    console.log(`[wu-claim] ℹ️  Human resolution required before wu:done can complete.`);
  } else {
    console.log(`[wu-claim] ✅ Agent auto-approved (no escalation triggers)`);
  }

  // WU-1352: Use centralized stringify for consistent output
  const out = stringifyYAML(doc);
  // Write file
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool writes WU files
  await writeFile(WU_PATH, out, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  return doc.title || '';
}

async function addOrReplaceInProgressStatus(statusPath, id, title) {
  // Check file exists

  try {
    await access(statusPath);
  } catch {
    die(`Missing ${statusPath}`);
  }

  const rel = `wu/${id}.yaml`;
  const bullet = `- [${id} — ${title}](${rel})`;
  // Read file
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool validates status file
  const content = await readFile(statusPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  const lines = content.split(STRING_LITERALS.NEWLINE);
  const findHeader = (h) => lines.findIndex((l) => l.trim().toLowerCase() === h.toLowerCase());
  const startIdx = findHeader(STATUS_SECTIONS.IN_PROGRESS);
  if (startIdx === -1) die(`Could not find "${STATUS_SECTIONS.IN_PROGRESS}" section in status.md`);
  let endIdx = lines.slice(startIdx + 1).findIndex((l) => l.startsWith('## '));
  if (endIdx === -1) endIdx = lines.length - startIdx - 1;
  else endIdx = startIdx + 1 + endIdx;
  // Check if already present
  const section = lines.slice(startIdx + 1, endIdx).join(STRING_LITERALS.NEWLINE);
  if (section.includes(rel) || section.includes(`[${id}`)) return; // already listed
  // Remove "No items" marker if present
  for (let i = startIdx + 1; i < endIdx; i++) {
    // eslint-disable-next-line security/detect-object-injection -- array index loop
    if (lines[i] && lines[i].includes('No items currently in progress')) {
      lines.splice(i, 1);
      endIdx--;
      break;
    }
  }
  // Insert bullet right after header
  lines.splice(startIdx + 1, 0, '', bullet);
  // Write file
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool writes status file
  await writeFile(statusPath, lines.join(STRING_LITERALS.NEWLINE), {
    encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
  });
}

async function removeFromReadyAndAddToInProgressBacklog(backlogPath, id, title, lane) {
  // WU-1574: Use WUStateStore as single source of truth, generate backlog.md from state
  // WU-1593: Use centralized path helper to correctly resolve state dir from backlog path
  const stateDir = getStateStoreDirFromBacklog(backlogPath);

  // Append claim event to state store
  const store = new WUStateStore(stateDir);
  await store.load();
  await store.claim(id, lane, title);
  console.log(`${PREFIX} Claim event appended to state store`);

  // Regenerate backlog.md from state store
  const backlogContent = await generateBacklog(store);
  await writeFile(backlogPath, backlogContent, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  console.log(`${PREFIX} backlog.md regenerated from state store`);

  // Regenerate status.md from state store
  const statusPath = path.join(path.dirname(backlogPath), 'status.md');
  const statusContent = await generateStatus(store);
  await writeFile(statusPath, statusContent, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  console.log(`${PREFIX} status.md regenerated from state store`);
}

/**
 * WU-1746: Append claim event without regenerating backlog.md/status.md
 * For worktree mode, we only need to record the claim event in the state store.
 * Generated files (backlog.md, status.md) cause merge conflicts when committed
 * to worktrees because they change on main as other WUs complete.
 *
 * @param {string} stateDir - Path to state store directory
 * @param {string} id - WU ID
 * @param {string} title - WU title
 * @param {string} lane - Lane name
 */
async function appendClaimEventOnly(stateDir, id, title, lane) {
  const store = new WUStateStore(stateDir);
  await store.load();
  await store.claim(id, lane, title);
  console.log(`${PREFIX} Claim event appended to state store`);
}

/**
 * WU-1746: Get list of files to commit in worktree mode
 * Excludes backlog.md and status.md to prevent merge conflicts.
 * These generated files should only be updated on main during wu:done.
 *
 * @param {string} wuId - WU ID (e.g., 'WU-1746')
 * @returns {string[]} List of files to commit
 */
export function getWorktreeCommitFiles(wuId) {
  return [
    `docs/04-operations/tasks/wu/${wuId}.yaml`,
    '.beacon/state/wu-events.jsonl', // WU-1740: Event store is source of truth
    // WU-1746: Explicitly NOT including:
    // - docs/04-operations/tasks/backlog.md
    // - docs/04-operations/tasks/status.md
    // These generated files cause merge conflicts when main advances
  ];
}

async function readWUTitle(id) {
  const p = WU_PATHS.WU(id);
  // Check file exists

  try {
    await access(p);
  } catch {
    return null;
  }
  // Read file
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool validates WU files
  const text = await readFile(p, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  const m = text.match(/^title:\s*"?(.+?)"?$/m);
  return m ? m[1] : null;
}

// emitWUFlowEvent() moved to telemetry.mjs as emitWUFlowEvent() (WU-1256)

/**
 * Check if there's already a Branch-Only WU in progress
 * Branch-Only mode doesn't support parallel WUs (only one WU at a time in main checkout)
 * @param {string} statusPath - Path to status.md
 * @param {string} currentWU - Current WU ID being claimed
 * @returns {Promise<{hasBranchOnly: boolean, existingWU: string|null}>}
 */
async function checkExistingBranchOnlyWU(statusPath, currentWU) {
  // Check file exists

  try {
    await access(statusPath);
  } catch {
    return { hasBranchOnly: false, existingWU: null };
  }

  // Read file
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool validates status file
  const content = await readFile(statusPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  const lines = content.split(STRING_LITERALS.NEWLINE);

  // Find "In Progress" section
  const startIdx = lines.findIndex((l) => l.trim().toLowerCase() === '## in progress');
  if (startIdx === -1) return { hasBranchOnly: false, existingWU: null };

  let endIdx = lines.slice(startIdx + 1).findIndex((l) => l.startsWith('## '));
  if (endIdx === -1) endIdx = lines.length - startIdx - 1;
  else endIdx = startIdx + 1 + endIdx;

  // Extract WU IDs from In Progress section
  const wuPattern = /\[?(WU-\d+)/i;
  const inProgressWUs = lines
    .slice(startIdx + 1, endIdx)
    .map((line) => {
      const match = line.match(wuPattern);
      return match ? match[1].toUpperCase() : null;
    })
    .filter(Boolean)
    .filter((wuid) => wuid !== currentWU); // exclude the WU we're claiming

  // Check each in-progress WU for claimed_mode: branch-only
  for (const wuid of inProgressWUs) {
    const wuPath = WU_PATHS.WU(wuid);
    // Check file exists

    try {
      await access(wuPath);
    } catch {
      continue; // File doesn't exist, skip
    }

    try {
      // Read file
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool validates WU files
      const text = await readFile(wuPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
      const doc = parseYAML(text);
      if (doc && doc.claimed_mode === CLAIMED_MODES.BRANCH_ONLY) {
        return { hasBranchOnly: true, existingWU: wuid };
      }
    } catch {
      // ignore parse errors
    }
  }

  return { hasBranchOnly: false, existingWU: null };
}

/**
 * Handle orphan WU check and auto-repair (WU-1276)
 * WU-1426: Commits repair changes to avoid dirty working tree blocking claim
 * WU-1437: Use pushOnly micro-worktree to keep local main pristine
 */
async function handleOrphanCheck(lane, id) {
  const orphanCheck = await checkLaneForOrphanDoneWU(lane, id);
  if (orphanCheck.valid) return;

  // Try auto-repair for single orphan
  if (orphanCheck.orphans.length === 1) {
    const orphanId = orphanCheck.orphans[0];
    console.log(`${PREFIX} Auto-repairing orphan: ${orphanId}`);

    // WU-1437: Use micro-worktree with pushOnly to keep main pristine
    await withMicroWorktree({
      operation: MICRO_WORKTREE_OPERATIONS.ORPHAN_REPAIR,
      id: orphanId,
      logPrefix: PREFIX,
      pushOnly: true,
      execute: async ({ worktreePath }) => {
        // Run repair inside micro-worktree using projectRoot option
        const repairResult = await repairWUInconsistency(orphanCheck.reports[0], {
          projectRoot: worktreePath,
        });

        if (repairResult.failed > 0) {
          throw new Error(
            `Lane ${lane} has orphan done WU: ${orphanId}\n` +
              `Auto-repair failed. Fix manually with: pnpm wu:repair --id ${orphanId}`,
          );
        }

        if (repairResult.repaired === 0) {
          // Nothing to repair - return empty result
          return { commitMessage: null, files: [] };
        }

        // Return files for commit
        // WU-1740: Include wu-events.jsonl to persist state store events
        return {
          commitMessage: `chore(repair): auto-repair orphan ${orphanId.toLowerCase()}`,
          files: [
            WU_PATHS.BACKLOG(),
            WU_PATHS.STATUS(),
            `.beacon/stamps/${orphanId}.done`,
            '.beacon/state/wu-events.jsonl',
          ],
        };
      },
    });

    console.log(`${PREFIX} Auto-repair successful`);
    return;
  }

  die(
    `Lane ${lane} has ${orphanCheck.orphans.length} orphan done WUs: ${orphanCheck.orphans.join(', ')}\n` +
      `Fix with: pnpm wu:repair --id <WU-ID> for each, or pnpm wu:repair --all`,
  );
}

/**
 * Validate lane format with user-friendly error messages
 */
function validateLaneFormatWithError(lane) {
  try {
    validateLaneFormat(lane);
  } catch (error) {
    die(
      `Invalid lane format: ${error.message}\n\n` +
        `Valid formats:\n` +
        `  - Parent-only: "Operations", "Intelligence", "Experience", etc.\n` +
        `  - Sub-lane: "Operations: Tooling", "Intelligence: Prompts", etc.\n\n` +
        `Format rules:\n` +
        `  - Single colon with EXACTLY one space after (e.g., "Parent: Subdomain")\n` +
        `  - No spaces before colon\n` +
        `  - No multiple colons\n\n` +
        `See .lumenflow.config.yaml for valid parent lanes.`,
    );
  }
}

/**
 * Handle lane occupancy check and enforce WIP=1 policy
 */
function handleLaneOccupancy(laneCheck, lane, id, force) {
  if (laneCheck.free) return;

  if (laneCheck.error) {
    die(`Lane check failed: ${laneCheck.error}`);
  }

  if (!laneCheck.occupiedBy) return;

  if (force) {
    console.warn(`${PREFIX} ⚠️  WARNING: Lane "${lane}" is occupied by ${laneCheck.occupiedBy}`);
    console.warn(`${PREFIX} ⚠️  Forcing WIP=2 in same lane. Risk of worktree collision!`);
    console.warn(`${PREFIX} ⚠️  Use only for P0 emergencies or manual recovery.`);
    return;
  }

  die(
    `Lane "${lane}" is already occupied by ${laneCheck.occupiedBy}.\n\n` +
      `LumenFlow enforces one-WU-per-lane to maintain focus.\n\n` +
      `Options:\n` +
      `  1. Wait for ${laneCheck.occupiedBy} to complete or block\n` +
      `  2. Choose a different lane\n` +
      `  3. Use --force to override (P0 emergencies only)\n\n` +
      `To check lane status: grep "${STATUS_SECTIONS.IN_PROGRESS}" docs/04-operations/tasks/status.md`,
  );
}

/**
 * Handle code path overlap detection (WU-901)
 */
function handleCodePathOverlap(WU_PATH, STATUS_PATH, id, args) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool validates WU files
  if (!existsSync(WU_PATH)) return;

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool validates WU files
  const wuContent = readFileSync(WU_PATH, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  const wuDoc = parseYAML(wuContent);
  const codePaths = wuDoc.code_paths || [];

  if (codePaths.length === 0) return;

  const overlapCheck = detectConflicts(STATUS_PATH, codePaths, id);

  emitWUFlowEvent({
    script: 'wu-claim',
    wu_id: id,
    step: 'overlap_check',
    conflicts_count: overlapCheck.conflicts.length,
    forced: args.forceOverlap || false,
  });

  if (overlapCheck.hasBlocker && !args.forceOverlap) {
    const conflictList = overlapCheck.conflicts
      .map(
        (c) =>
          `  - ${c.wuid}: ${c.overlaps.slice(0, 3).join(', ')}${c.overlaps.length > 3 ? ` (+${c.overlaps.length - 3} more)` : ''}`,
      )
      .join(STRING_LITERALS.NEWLINE);

    die(
      `Code path overlap detected with in-progress WUs:\n\n${conflictList}\n\n` +
        `Merge conflicts are guaranteed if both WUs proceed.\n\n` +
        `Options:\n` +
        `  1. Wait for conflicting WU(s) to complete\n` +
        `  2. Coordinate with agent working on conflicting WU\n` +
        `  3. Use --force-overlap --reason "..." (emits telemetry for audit)\n\n` +
        `To check WU status: grep "${STATUS_SECTIONS.IN_PROGRESS}" docs/04-operations/tasks/status.md`,
    );
  }

  if (args.forceOverlap) {
    if (!args.reason) {
      die('--force-overlap requires --reason "explanation" for audit trail');
    }
    emitWUFlowEvent({
      script: 'wu-claim',
      wu_id: id,
      event: 'overlap_forced',
      reason: args.reason,
      conflicts: overlapCheck.conflicts.map((c) => ({ wuid: c.wuid, files: c.overlaps })),
    });
    console.warn(`${PREFIX} ⚠️  WARNING: Overlap forced with reason: ${args.reason}`);
  }
}

/**
 * Validate branch-only mode can be used
 */
async function validateBranchOnlyMode(STATUS_PATH, id) {
  const branchOnlyCheck = await checkExistingBranchOnlyWU(STATUS_PATH, id);
  if (branchOnlyCheck.hasBranchOnly) {
    die(
      `Branch-Only mode does not support parallel WUs.\n\n` +
        `Another Branch-Only WU is already in progress: ${branchOnlyCheck.existingWU}\n\n` +
        `Options:\n` +
        `  1. Complete ${branchOnlyCheck.existingWU} first (pnpm wu:done --id ${branchOnlyCheck.existingWU})\n` +
        `  2. Block ${branchOnlyCheck.existingWU} (pnpm wu:block --id ${branchOnlyCheck.existingWU} --reason "...")\n` +
        `  3. Use Worktree mode instead (omit --branch-only flag)\n\n` +
        `Branch-Only mode works in the main checkout and cannot isolate parallel WUs.`,
    );
  }

  // Ensure working directory is clean for Branch-Only mode
  const status = await getGitForCwd().getStatus();
  if (status) {
    die(
      `Branch-Only mode requires a clean working directory.\n\n` +
        `Uncommitted changes detected:\n${status}\n\n` +
        `Options:\n` +
        `  1. Commit or stash your changes\n` +
        `  2. Use Worktree mode instead (omit --branch-only flag for isolated workspace)`,
    );
  }
}

/**
 * Execute branch-only mode claim workflow
 */
async function claimBranchOnlyMode(ctx) {
  const { args, id, laneK, title, branch, WU_PATH, STATUS_PATH, BACKLOG_PATH, claimedMode } = ctx;

  // WU-1438: Start agent session BEFORE metadata update to include session_id in YAML
  let sessionId = null;
  try {
    const sessionResult = await startSessionForWU({
      wuId: id,
      tier: 2,
    });
    sessionId = sessionResult.sessionId;
    if (sessionResult.alreadyActive) {
      console.log(`${PREFIX} Agent session already active (${sessionId.slice(0, 8)}...)`);
    } else {
      console.log(`${PREFIX} ${EMOJI.SUCCESS} Agent session started (${sessionId.slice(0, 8)}...)`);
    }
  } catch (err) {
    // Non-blocking: session start failure should not block claim
    console.warn(`${PREFIX} Warning: Could not start agent session: ${err.message}`);
  }

  // Create branch and switch to it (LEGACY - for constrained environments only)
  await getGitForCwd().createBranch(branch, BRANCHES.MAIN);

  // Update metadata in branch-only mode (on main checkout)
  let updatedTitle = title;
  if (args.noAuto) {
    await ensureCleanOrClaimOnlyWhenNoAuto();
  } else {
    updatedTitle =
      (await updateWUYaml(WU_PATH, id, args.lane, claimedMode, null, sessionId)) || title;
    await addOrReplaceInProgressStatus(STATUS_PATH, id, updatedTitle);
    await removeFromReadyAndAddToInProgressBacklog(BACKLOG_PATH, id, updatedTitle, args.lane);
    await getGitForCwd().add(
      `${JSON.stringify(WU_PATH)} ${JSON.stringify(STATUS_PATH)} ${JSON.stringify(BACKLOG_PATH)}`,
    );
  }

  // Commit and push
  const msg = COMMIT_FORMATS.CLAIM(id.toLowerCase(), laneK);
  await getGitForCwd().commit(msg);
  await getGitForCwd().push(REMOTES.ORIGIN, branch);

  // Summary
  console.log(`\n${PREFIX} Claim recorded in Branch-Only mode.`);
  console.log(`- WU: ${id}${updatedTitle ? ` — ${updatedTitle}` : ''}`);
  console.log(`- Lane: ${args.lane}`);
  console.log(`- Mode: Branch-Only (no worktree)`);
  console.log(`- Commit: ${msg}`);
  console.log(`- Branch: ${branch}`);
  console.log(
    '\n⚠️  LIMITATION: Branch-Only mode does not support parallel WUs (WIP=1 across ALL lanes)',
  );
  console.log('Next: work on this branch in the main checkout.');

  // WU-1360: Print next-steps checklist to prevent common mistakes
  console.log(`\n${PREFIX} Next steps:`);
  console.log(`  1. Work on this branch in the main checkout`);
  console.log(`  2. Implement changes per acceptance criteria`);
  console.log(`  3. Run: pnpm gates`);
  console.log(`  4. pnpm wu:done --id ${id}`);
  console.log(`\n${PREFIX} Common mistakes to avoid:`);
  console.log(`  - Don't manually edit WU YAML status fields`);
  console.log(`  - Don't create PRs (trunk-based development)`);

  // WU-1501: Hint for sub-agent execution context
  console.log(`\n${PREFIX} For sub-agent execution:`);
  console.log(`  /wu-prompt ${id}  (generates full context prompt)`);

  // Emit mandatory agent advisory based on code_paths (WU-1324)
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool validates WU files
  const wuContent = await readFile(WU_PATH, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  const wuDoc = parseYAML(wuContent);
  const codePaths = wuDoc.code_paths || [];
  emitMandatoryAgentAdvisory(codePaths, id);

  // WU-1763: Print lifecycle nudge with tips for tool adoption
  printLifecycleNudge(id);
}

/**
 * Execute worktree mode claim workflow
 *
 * WU-1741: Removed micro-worktree pattern that committed to main during claim.
 * Branch existence (e.g. lane/operations/wu-1234) is the coordination lock.
 * Metadata updates happen IN the work worktree, NOT on main.
 *
 * New flow:
 * 1. Create work worktree+branch from main (branch = lock)
 * 2. Update metadata (WU YAML, status.md, backlog.md) IN worktree
 * 3. Commit metadata in worktree
 * 4. Main only changes via wu:done (single merge point)
 *
 * Benefits:
 * - Simpler mental model: main ONLY changes via wu:done
 * - Branch existence is natural coordination (git prevents duplicates)
 * - Less network traffic (no push during claim)
 * - Cleaner rollback: delete worktree+branch = claim undone
 */
async function claimWorktreeMode(ctx) {
  const {
    args,
    id,
    laneK,
    title,
    branch,
    worktree,
    WU_PATH,
    BACKLOG_PATH,
    claimedMode,
    fixableIssues, // Fixable issues from pre-flight validation
  } = ctx;

  const originalCwd = process.cwd();
  const worktreePath = path.resolve(worktree);
  let updatedTitle = title;
  const commitMsg = COMMIT_FORMATS.CLAIM(id.toLowerCase(), laneK);

  // WU-1438: Start agent session BEFORE metadata update to include session_id in YAML
  let sessionId = null;
  try {
    const sessionResult = await startSessionForWU({
      wuId: id,
      tier: 2,
    });
    sessionId = sessionResult.sessionId;
    if (sessionResult.alreadyActive) {
      console.log(`${PREFIX} Agent session already active (${sessionId.slice(0, 8)}...)`);
    } else {
      console.log(`${PREFIX} ${EMOJI.SUCCESS} Agent session started (${sessionId.slice(0, 8)}...)`);
    }
  } catch (err) {
    // Non-blocking: session start failure should not block claim
    console.warn(`${PREFIX} Warning: Could not start agent session: ${err.message}`);
  }

  // WU-1741: Step 1 - Create work worktree+branch from main
  // Branch creation IS the coordination lock (git prevents duplicate branch names)
  console.log(`${PREFIX} Creating worktree (branch = coordination lock)...`);
  await getGitForCwd().worktreeAdd(worktree, branch, BRANCHES.MAIN);
  console.log(`${PREFIX} ${EMOJI.SUCCESS} Worktree created at ${worktree}`);

  // WU-1741: Step 2 - Update metadata IN the work worktree (not main)
  if (!args.noAuto) {
    // Build paths relative to work worktree
    const wtWUPath = path.join(worktreePath, WU_PATH);
    const wtBacklogPath = path.join(worktreePath, BACKLOG_PATH);

    // Apply YAML fixes in worktree (not on main)
    if (fixableIssues && fixableIssues.length > 0) {
      console.log(`${PREFIX} Applying ${fixableIssues.length} YAML fix(es)...`);
      autoFixWUYaml(wtWUPath);
      console.log(`${PREFIX} YAML fixes applied successfully`);
    }

    // Update metadata files in worktree (WU-1438: include session_id)
    updatedTitle =
      (await updateWUYaml(wtWUPath, id, args.lane, claimedMode, worktree, sessionId)) || title;

    // WU-1746: Only append claim event to state store - don't regenerate backlog.md/status.md
    // These generated files cause merge conflicts when committed to worktrees
    const wtStateDir = getStateStoreDirFromBacklog(wtBacklogPath);
    await appendClaimEventOnly(wtStateDir, id, updatedTitle, args.lane);

    // WU-1741: Step 3 - Commit metadata in worktree (NOT on main)
    // This commit stays on the lane branch until wu:done merges to main
    console.log(`${PREFIX} Committing claim metadata in worktree...`);
    const wtGit = createGitForPath(worktreePath);
    // WU-1746: Use getWorktreeCommitFiles which excludes backlog.md and status.md
    const filesToCommit = getWorktreeCommitFiles(id);
    await wtGit.add(filesToCommit);
    await wtGit.commit(commitMsg);
    console.log(`${PREFIX} ${EMOJI.SUCCESS} Claim committed: ${commitMsg}`);
  }

  // WU-1443: Auto-symlink node_modules for immediate pnpm usability
  // WU-2238: Pass mainRepoPath to detect broken worktree-path symlinks
  const symlinkResult = symlinkNodeModules(worktreePath, console, originalCwd);
  if (symlinkResult.created) {
    console.log(`${PREFIX} ${EMOJI.SUCCESS} node_modules symlinked for immediate use`);
  } else if (symlinkResult.refused) {
    // WU-2238: Symlinking was refused due to worktree-path symlinks
    // Fall back to running pnpm install in the worktree
    console.log(
      `${PREFIX} Running pnpm install in worktree (symlink refused: ${symlinkResult.reason})`,
    );
    try {
      const { execSync } = await import('node:child_process');
      execSync('pnpm install --frozen-lockfile', {
        cwd: worktreePath,
        stdio: 'inherit',
        timeout: 120000, // 2 minute timeout
      });
      console.log(`${PREFIX} ${EMOJI.SUCCESS} pnpm install completed in worktree`);
    } catch (installError) {
      console.warn(`${PREFIX} Warning: pnpm install failed: ${installError.message}`);
      console.warn(`${PREFIX} You may need to run 'pnpm install' manually in the worktree`);
    }
  }

  // WU-1579: Auto-symlink nested package node_modules for turbo typecheck
  // WU-2238: Skip nested symlinks if root symlink was refused (pnpm install handles them)
  if (!symlinkResult.refused) {
    const nestedResult = symlinkNestedNodeModules(worktreePath, originalCwd);
    if (nestedResult.created > 0) {
      console.log(
        `${PREFIX} ${EMOJI.SUCCESS} ${nestedResult.created} nested node_modules symlinked for typecheck`,
      );
    }
  }

  console.log(`${PREFIX} Claim recorded in worktree`);
  console.log(`- WU: ${id}${updatedTitle ? ` — ${updatedTitle}` : ''}`);
  console.log(`- Lane: ${args.lane}`);
  console.log(`- Worktree: ${worktreePath}`);
  console.log(`- Branch: ${branch}`);
  console.log(`- Commit: ${commitMsg}`);

  // Summary
  console.log(`\n${PREFIX} Worktree created and claim committed.`);
  console.log(`Next: cd ${worktree} and begin work.`);

  // WU-1360: Print next-steps checklist to prevent common mistakes
  console.log(`\n${PREFIX} Next steps:`);
  console.log(`  1. cd ${worktree}  (IMPORTANT: work here, not main)`);
  console.log(`  2. Implement changes per acceptance criteria`);
  console.log(`  3. Run: pnpm gates`);
  console.log(`  4. cd ${originalCwd} && pnpm wu:done --id ${id}`);
  console.log(`\n${PREFIX} Common mistakes to avoid:`);
  console.log(`  - Don't edit files on main branch`);
  console.log(`  - Don't manually edit WU YAML status fields`);
  console.log(`  - Don't create PRs (trunk-based development)`);

  // WU-1501: Hint for sub-agent execution context
  console.log(`\n${PREFIX} For sub-agent execution:`);
  console.log(`  /wu-prompt ${id}  (generates full context prompt)`);

  // Emit mandatory agent advisory based on code_paths (WU-1324)
  // Read from worktree since that's where the updated YAML is
  const wtWUPathForAdvisory = path.join(worktreePath, WU_PATH);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool validates WU files
  const wuContent = await readFile(wtWUPathForAdvisory, {
    encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
  });
  const wuDoc = parseYAML(wuContent);
  const codePaths = wuDoc.code_paths || [];
  emitMandatoryAgentAdvisory(codePaths, id);

  // WU-1763: Print lifecycle nudge with tips for tool adoption
  printLifecycleNudge(id);
}

/**
 * WU-1763: Print a single concise tips line to improve tool adoption.
 * Non-blocking, single-line output to avoid flooding the console.
 *
 * @param {string} _id - WU ID being claimed (unused, kept for future use)
 */
export function printLifecycleNudge(_id) {
  // Single line, concise, actionable
  console.log(
    `\n${PREFIX} 💡 Tip: pnpm session:recommend for context tier, mem:ready for pending work, pnpm file:*/git:* for audited wrappers`,
  );
}

/**
 * WU-2411: Handle --resume flag for agent handoff
 *
 * When an agent crashes or is killed, the --resume flag allows a new agent
 * to take over by:
 * 1. Verifying the old PID is dead (safety check)
 * 2. Updating the lock file with the new PID
 * 3. Preserving the existing worktree
 * 4. Printing uncommitted changes summary
 * 5. Creating a checkpoint in the memory layer
 *
 * @param {Object} args - CLI arguments
 * @param {string} id - WU ID
 */
async function handleResumeMode(args, id) {
  const laneK = toKebab(args.lane);
  const idK = id.toLowerCase();
  const worktree = args.worktree || `worktrees/${laneK}-${idK}`;
  const worktreePath = path.resolve(worktree);

  console.log(`${PREFIX} Attempting to resume ${id} in lane "${args.lane}"...`);

  // Attempt the resume/handoff
  const result = await resumeClaimForHandoff({
    wuId: id,
    lane: args.lane,
    worktreePath,
    agentSession: null, // Will be populated by session system
  });

  if (!result.success) {
    die(
      `Cannot resume ${id}: ${result.error}\n\n` +
        `If you need to start a fresh claim, use: pnpm wu:claim --id ${id} --lane "${args.lane}"`,
    );
  }

  console.log(`${PREFIX} ${EMOJI.SUCCESS} Handoff successful`);
  console.log(`${PREFIX} Previous PID: ${result.previousPid}`);
  console.log(`${PREFIX} New PID: ${process.pid}`);

  // Get and display uncommitted changes in the worktree
  const wtGit = createGitForPath(worktreePath);
  const uncommittedStatus = await getWorktreeUncommittedChanges(wtGit);

  if (uncommittedStatus) {
    const formatted = formatUncommittedChanges(uncommittedStatus);
    console.log(`\n${PREFIX} ${formatted}`);
  } else {
    console.log(`\n${PREFIX} No uncommitted changes in worktree.`);
  }

  // Create handoff checkpoint in memory layer
  const checkpointResult = await createHandoffCheckpoint({
    wuId: id,
    previousPid: result.previousPid,
    newPid: process.pid,
    previousSession: result.previousSession,
    uncommittedSummary: uncommittedStatus,
  });

  if (checkpointResult.success && checkpointResult.checkpointId) {
    console.log(
      `${PREFIX} ${EMOJI.SUCCESS} Handoff checkpoint created: ${checkpointResult.checkpointId}`,
    );
  }

  // Emit telemetry event for handoff
  emitWUFlowEvent({
    script: 'wu-claim',
    wu_id: id,
    lane: args.lane,
    step: 'resume_handoff',
    previousPid: result.previousPid,
    newPid: process.pid,
    uncommittedChanges: uncommittedStatus ? 'present' : 'none',
  });

  // Print summary
  console.log(`\n${PREFIX} Resume complete. Worktree preserved at: ${worktree}`);
  console.log(`${PREFIX} Next: cd ${worktree} and continue work.`);
  console.log(
    `\n${PREFIX} Tip: Run 'pnpm mem:ready --wu ${id}' to check for pending context from previous session.`,
  );
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- main() orchestrates multi-step claim workflow
async function main() {
  const args = createWUParser({
    name: 'wu-claim',
    description: 'Claim a work unit by creating a worktree/branch and updating status',
    options: [
      WU_OPTIONS.id,
      WU_OPTIONS.lane,
      WU_OPTIONS.worktree,
      WU_OPTIONS.branch,
      WU_OPTIONS.branchOnly,
      WU_OPTIONS.prMode,
      WU_OPTIONS.noAuto,
      WU_OPTIONS.force,
      WU_OPTIONS.forceOverlap,
      WU_OPTIONS.fix,
      WU_OPTIONS.reason,
      WU_OPTIONS.allowIncomplete,
      WU_OPTIONS.resume, // WU-2411: Agent handoff flag
    ],
    required: ['id', 'lane'],
    allowPositionalId: true,
  });

  const id = args.id.toUpperCase();
  if (!PATTERNS.WU_ID.test(id)) die(`Invalid WU id '${args.id}'. Expected format WU-123`);

  await ensureOnMain(getGitForCwd());

  // WU-2411: Handle --resume flag for agent handoff
  if (args.resume) {
    await handleResumeMode(args, id);
    return; // Resume mode handles its own flow
  }

  // Preflight: ensure working tree is clean (unless --no-auto, which expects staged changes)
  if (!args.noAuto) {
    const status = await getGitForCwd().getStatus();
    if (status.trim()) {
      die(
        `Working tree is not clean. Commit or stash changes before claiming.\n\n` +
          `Uncommitted changes:\n${status}\n\n` +
          `Options:\n` +
          `  1. git add . && git commit -m "..."\n` +
          `  2. git stash\n` +
          `  3. Use --no-auto if you already staged claim edits manually`,
      );
    }
  }

  // WU-1361: Fetch and pull FIRST - validate on fresh data, not stale pre-pull data
  await getGitForCwd().fetch(REMOTES.ORIGIN, BRANCHES.MAIN);
  await getGitForCwd().pull(REMOTES.ORIGIN, BRANCHES.MAIN);

  const WU_PATH = WU_PATHS.WU(id);
  const STATUS_PATH = WU_PATHS.STATUS();
  const BACKLOG_PATH = WU_PATHS.BACKLOG();

  // PRE-FLIGHT VALIDATION (on post-pull data)
  const doc = preflightValidateWU(WU_PATH, id);
  await handleOrphanCheck(args.lane, id);
  validateLaneFormatWithError(args.lane);

  // WU-1372: Lane-to-code_paths consistency check (advisory only, never blocks)
  const laneValidation = validateLaneCodePaths(doc, args.lane);
  logLaneValidationWarnings(laneValidation, PREFIX);

  // WU-1361: YAML schema validation at claim time
  // Returns fixable issues for application in worktree (not on main)
  const fixableIssues = validateYAMLSchema(WU_PATH, doc, args);

  // WU-1506/WU-1576: Backlog invariant repair moved inside micro-worktree (see claimWorktreeMode)
  // Previously called validateBacklogConsistency(BACKLOG_PATH) here which modified main directly

  // WU-1362: Spec completeness validation (fail-fast before expensive operations)
  // Two-tier validation: Schema errors (above) are never bypassable; spec completeness is bypassable
  const specResult = validateSpecCompleteness(doc, id);
  if (!specResult.valid) {
    const errorList = specResult.errors.map((e) => `  - ${e}`).join(STRING_LITERALS.NEWLINE);
    if (args.allowIncomplete) {
      console.warn(`${PREFIX} ⚠️  Spec completeness warnings (bypassed with --allow-incomplete):`);
      console.warn(errorList);
      console.warn(`${PREFIX} Proceeding with incomplete spec. Fix before wu:done.`);
    } else {
      die(
        `Spec completeness validation failed for ${WU_PATH}:\n\n${errorList}\n\n` +
          `Fix these issues before claiming, or use --allow-incomplete to bypass.\n` +
          `Note: Schema errors (placeholders, invalid structure) cannot be bypassed.`,
      );
    }
  }

  // Check lane occupancy (WIP=1 per sub-lane)
  const laneCheck = checkLaneFree(STATUS_PATH, args.lane, id);
  emitWUFlowEvent({
    script: 'wu-claim',
    wu_id: id,
    lane: args.lane,
    step: 'lane_check',
    occupied: !laneCheck.free,
    occupiedBy: laneCheck.occupiedBy,
  });
  handleLaneOccupancy(laneCheck, args.lane, id, args.force);

  // WU-1603: Atomic lane lock to prevent TOCTOU race conditions
  // This is Layer 2 defense after status.md check - prevents parallel agents from
  // both reading a free status.md before either updates it
  const existingLock = checkLaneLock(args.lane);
  if (existingLock.locked && existingLock.isStale) {
    console.log(`${PREFIX} Detected stale lock for "${args.lane}" (${existingLock.metadata.wuId})`);
    console.log(`${PREFIX} Lock timestamp: ${existingLock.metadata.timestamp}`);
    forceRemoveStaleLock(args.lane);
  }

  const lockResult = acquireLaneLock(args.lane, id, {
    agentSession: null, // Will be set after session starts
  });

  if (!lockResult.acquired) {
    // Lock acquisition failed - another agent got there first
    const staleSuffix = lockResult.isStale
      ? '\n\nNote: This lock may be stale (>24h). Use --force to override if the owning WU is abandoned.'
      : '';
    die(
      `Cannot claim ${id}: ${lockResult.error}\n\n` +
        `Another agent is actively claiming or has claimed this lane.\n\n` +
        `Options:\n` +
        `  1. Wait for ${lockResult.existingLock?.wuId || 'the other WU'} to complete or block\n` +
        `  2. Choose a different lane\n` +
        `  3. Use --force to override (P0 emergencies only)${staleSuffix}`,
    );
  }

  emitWUFlowEvent({
    script: 'wu-claim',
    wu_id: id,
    lane: args.lane,
    step: 'lane_lock_acquired',
  });

  // WU-1808: Wrap claim execution in try/finally to ensure lock release on failure
  // If claim fails after lock acquisition, the lane would be blocked without this cleanup
  let claimSucceeded = false;
  try {
    // Code paths overlap detection (WU-901)
    handleCodePathOverlap(WU_PATH, STATUS_PATH, id, args);

    // Prepare paths and branches
    const laneK = toKebab(args.lane);
    const idK = id.toLowerCase();
    const title = (await readWUTitle(id)) || '';
    const branch = args.branch || `lane/${laneK}/${idK}`;
    const worktree = args.worktree || `worktrees/${laneK}-${idK}`;
    const claimedMode = args.branchOnly
      ? CLAIMED_MODES.BRANCH_ONLY
      : args.prMode
        ? CLAIMED_MODES.WORKTREE_PR
        : CLAIMED_MODES.WORKTREE;

    // Branch-Only mode validation
    if (args.branchOnly) {
      await validateBranchOnlyMode(STATUS_PATH, id);
    }

    // Check if branch already exists (prevents duplicate claims)
    const branchAlreadyExists = await getGitForCwd().branchExists(branch);
    if (branchAlreadyExists) {
      die(
        `Branch ${branch} already exists. WU may already be claimed.\n\n` +
          `Git branch existence = WU claimed (natural locking).\n\n` +
          `Options:\n` +
          `  1. Check git worktree list to see if worktree exists\n` +
          `  2. Coordinate with the owning agent or wait for them to complete\n` +
          `  3. Choose a different WU`,
      );
    }

    // Layer 3 defense (WU-1476): Pre-flight orphan check
    // Clean up orphan directory if it exists at target worktree path
    const absoluteWorktreePath = path.resolve(worktree);
    if (await isOrphanWorktree(absoluteWorktreePath, process.cwd())) {
      console.log(`${PREFIX} Detected orphan directory at ${worktree}, cleaning up...`);
      try {
        rmSync(absoluteWorktreePath, { recursive: true, force: true });
        console.log(`${PREFIX} ${EMOJI.SUCCESS} Orphan directory removed`);
      } catch (err) {
        die(
          `Failed to clean up orphan directory at ${worktree}\n\n` +
            `Error: ${err.message}\n\n` +
            `Manual cleanup: rm -rf ${absoluteWorktreePath}`,
        );
      }
    }

    // Execute claim workflow
    const ctx = {
      args,
      id,
      laneK,
      title,
      branch,
      worktree,
      WU_PATH,
      STATUS_PATH,
      BACKLOG_PATH,
      claimedMode,
      fixableIssues, // WU-1361: Pass fixable issues for worktree application
    };
    if (args.branchOnly) {
      await claimBranchOnlyMode(ctx);
    } else {
      await claimWorktreeMode(ctx);
    }

    // Mark claim as successful - lock should remain for wu:done to release
    claimSucceeded = true;
  } finally {
    // WU-1808: Release lane lock if claim did not complete successfully
    // This prevents orphan locks from blocking the lane when claim crashes or fails
    if (!claimSucceeded) {
      console.log(`${PREFIX} Claim did not complete - releasing lane lock...`);
      const releaseResult = releaseLaneLock(args.lane, { wuId: id });
      if (releaseResult.released && !releaseResult.notFound) {
        console.log(`${PREFIX} Lane lock released for "${args.lane}"`);
      }
    }
  }
}

// Guard main() for testability (WU-1366)
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
