/**
 * WU Consistency Checker (WU-1276, WU-2412)
 *
 * Layer 2 defense-in-depth: Detect and repair WU state inconsistencies.
 *
 * Detects five types of inconsistencies:
 * - YAML_DONE_STATUS_IN_PROGRESS: WU YAML done but in status.md In Progress
 * - BACKLOG_DUAL_SECTION: WU in both Done and In Progress sections
 * - YAML_DONE_NO_STAMP: WU YAML done but no stamp file
 * - ORPHAN_WORKTREE_DONE: Done WU still has worktree
 * - STAMP_EXISTS_YAML_NOT_DONE: Stamp exists but YAML status is not done (WU-2412)
 *
 * @see {@link ../wu-repair.mjs} CLI interface
 */

import { readFile, writeFile, readdir, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { parseYAML, stringifyYAML } from './wu-yaml.js';
import { WU_PATHS } from './wu-paths.js';
import {
  CONSISTENCY_TYPES,
  CONSISTENCY_MESSAGES,
  FILE_SYSTEM,
  LOG_PREFIX,
  REMOTES,
  STRING_LITERALS,
  toKebab,
  WU_STATUS,
  YAML_OPTIONS,
} from './wu-constants.js';
import { todayISO } from './date-utils.js';
import { createGitForPath } from './git-adapter.js';

/**
 * Check a single WU for state inconsistencies
 *
 * @param {string} id - WU ID (e.g., 'WU-123')
 * @param {string} [projectRoot=process.cwd()] - Project root directory
 * @returns {Promise<object>} Consistency report with valid, errors, and stats
 */
export async function checkWUConsistency(id, projectRoot = process.cwd()) {
  const errors = [];
  const wuPath = path.join(projectRoot, WU_PATHS.WU(id));
  const stampPath = path.join(projectRoot, WU_PATHS.STAMP(id));
  const backlogPath = path.join(projectRoot, WU_PATHS.BACKLOG());
  const statusPath = path.join(projectRoot, WU_PATHS.STATUS());

  // Handle missing WU YAML gracefully
  try {
    await access(wuPath, constants.R_OK);
  } catch {
    return { valid: true, errors: [], stats: { wuExists: false } };
  }

  const wuContent = await readFile(wuPath, { encoding: 'utf-8' });
  const wuDoc = parseYAML(wuContent) as {
    status?: string;
    lane?: string;
    title?: string;
    worktree_path?: string;
  } | null;
  const yamlStatus = wuDoc?.status || 'unknown';
  const lane = wuDoc?.lane || '';
  const title = wuDoc?.title || '';
  const worktreePathFromYaml = wuDoc?.worktree_path || '';

  // Check stamp existence
  let hasStamp = false;
  try {
    await access(stampPath, constants.R_OK);
    hasStamp = true;
  } catch {
    hasStamp = false;
  }

  // Parse backlog sections
  let backlogContent = '';
  try {
    backlogContent = await readFile(backlogPath, { encoding: 'utf-8' });
  } catch {
    backlogContent = '';
  }
  const { inDone: backlogInDone, inProgress: backlogInProgress } = parseBacklogSections(
    backlogContent,
    id,
  );

  // Parse status.md sections
  let statusContent = '';
  try {
    statusContent = await readFile(statusPath, { encoding: 'utf-8' });
  } catch {
    statusContent = '';
  }
  const { inProgress: statusInProgress } = parseStatusSections(statusContent, id);

  // Check for worktree
  const hasWorktree = await checkWorktreeExists(id, projectRoot);
  const worktreePathExists = await checkWorktreePathExists(worktreePathFromYaml);

  // Detection logic

  // 1. YAML done but in status.md In Progress
  if (yamlStatus === WU_STATUS.DONE && statusInProgress) {
    errors.push({
      type: CONSISTENCY_TYPES.YAML_DONE_STATUS_IN_PROGRESS,
      wuId: id,
      description: `WU ${id} has status '${WU_STATUS.DONE}' in YAML but still appears in status.md In Progress section`,
      repairAction: 'Remove from status.md In Progress section',
      canAutoRepair: true,
    });
  }

  // 2. Backlog dual section (Done AND In Progress)
  if (backlogInDone && backlogInProgress) {
    errors.push({
      type: CONSISTENCY_TYPES.BACKLOG_DUAL_SECTION,
      wuId: id,
      description: `WU ${id} appears in both Done and In Progress sections of backlog.md`,
      repairAction: 'Remove from In Progress section (Done wins)',
      canAutoRepair: true,
    });
  }

  // 3. YAML done but no stamp
  if (yamlStatus === WU_STATUS.DONE && !hasStamp) {
    errors.push({
      type: CONSISTENCY_TYPES.YAML_DONE_NO_STAMP,
      wuId: id,
      title,
      description: `WU ${id} has status '${WU_STATUS.DONE}' but no stamp file exists`,
      repairAction: 'Create stamp file',
      canAutoRepair: true,
    });
  }

  // 4. Orphan worktree for done WU
  if (yamlStatus === WU_STATUS.DONE && hasWorktree) {
    errors.push({
      type: CONSISTENCY_TYPES.ORPHAN_WORKTREE_DONE,
      wuId: id,
      lane,
      description: `WU ${id} has status '${WU_STATUS.DONE}' but still has an associated worktree`,
      repairAction: 'Remove orphan worktree and lane branch',
      canAutoRepair: true,
    });
  }

  // 5. Stamp exists but YAML not done (inverse of YAML_DONE_NO_STAMP)
  // This catches partial wu:done failures where stamp was created but YAML update failed
  if (hasStamp && yamlStatus !== WU_STATUS.DONE) {
    errors.push({
      type: CONSISTENCY_TYPES.STAMP_EXISTS_YAML_NOT_DONE,
      wuId: id,
      title,
      description: `WU ${id} has stamp file but YAML status is '${yamlStatus}' (not done)`,
      repairAction: 'Update YAML to done+locked+completed',
      canAutoRepair: true,
    });
  }

  // 6. Claimed WU missing worktree directory
  if (
    worktreePathFromYaml &&
    !worktreePathExists &&
    (yamlStatus === WU_STATUS.IN_PROGRESS || yamlStatus === WU_STATUS.BLOCKED)
  ) {
    errors.push({
      type: CONSISTENCY_TYPES.MISSING_WORKTREE_CLAIMED,
      wuId: id,
      title,
      description: CONSISTENCY_MESSAGES.MISSING_WORKTREE_CLAIMED(
        id,
        yamlStatus,
        worktreePathFromYaml,
      ),
      repairAction: CONSISTENCY_MESSAGES.MISSING_WORKTREE_CLAIMED_REPAIR,
      canAutoRepair: false,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      yamlStatus,
      hasStamp,
      backlogInDone,
      backlogInProgress,
      statusInProgress,
      hasWorktree,
      worktreePathExists,
    },
  };
}

/**
 * Check all WUs for consistency
 *
 * @param {string} [projectRoot=process.cwd()] - Project root directory
 * @returns {Promise<object>} Aggregated report with valid, errors, and checked count
 */
export async function checkAllWUConsistency(projectRoot = process.cwd()) {
  const wuDir = path.join(projectRoot, 'docs/04-operations/tasks/wu');
  try {
    await access(wuDir, constants.R_OK);
  } catch {
    return { valid: true, errors: [], checked: 0 };
  }

  const allErrors = [];
  const wuFiles = (await readdir(wuDir)).filter((f) => /^WU-\d+\.yaml$/.test(f));

  for (const file of wuFiles) {
    const id = file.replace('.yaml', '');
    const report = await checkWUConsistency(id, projectRoot);
    allErrors.push(...report.errors);
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    checked: wuFiles.length,
  };
}

/**
 * Check lane for orphan done WUs (pre-flight for wu:claim)
 *
 * @param {string} lane - Lane name to check
 * @param {string} excludeId - WU ID to exclude from check (the one being claimed)
 * @param {string} [projectRoot=process.cwd()] - Project root directory
 * @returns {Promise<object>} Result with valid, orphans list, and reports
 */
export async function checkLaneForOrphanDoneWU(lane, excludeId, projectRoot = process.cwd()) {
  const wuDir = path.join(projectRoot, 'docs/04-operations/tasks/wu');
  try {
    await access(wuDir, constants.R_OK);
  } catch {
    return { valid: true, orphans: [] };
  }

  const orphans = [];
  const wuFiles = (await readdir(wuDir)).filter((f) => /^WU-\d+\.yaml$/.test(f));

  for (const file of wuFiles) {
    const id = file.replace('.yaml', '');
    if (id === excludeId) continue;

    const wuPath = path.join(wuDir, file);
    let wuContent;
    try {
      wuContent = await readFile(wuPath, { encoding: 'utf-8' });
    } catch {
      // Skip unreadable files
      continue;
    }

    let wuDoc;
    try {
      wuDoc = parseYAML(wuContent);
    } catch {
      // Skip malformed YAML files - they're a separate issue
      continue;
    }

    if (wuDoc?.lane === lane && wuDoc?.status === WU_STATUS.DONE) {
      const report = await checkWUConsistency(id, projectRoot);
      if (!report.valid) {
        orphans.push({ id, errors: report.errors });
      }
    }
  }

  return {
    valid: orphans.length === 0,
    orphans: orphans.map((o) => o.id),
    reports: orphans,
  };
}

/**
 * Options for repairing WU inconsistencies
 */
export interface RepairWUInconsistencyOptions {
  /** If true, don't actually repair */
  dryRun?: boolean;
  /** Project root directory */
  projectRoot?: string;
}

/**
 * Repair WU inconsistencies
 *
 * @param {object} report - Report from checkWUConsistency()
 * @param {RepairWUInconsistencyOptions} [options={}] - Repair options
 * @returns {Promise<object>} Result with repaired, skipped, and failed counts
 */
export async function repairWUInconsistency(report, options: RepairWUInconsistencyOptions = {}) {
  const { dryRun = false, projectRoot = process.cwd() } = options;

  if (report.valid) {
    return { repaired: 0, skipped: 0, failed: 0 };
  }

  let repaired = 0;
  let skipped = 0;
  let failed = 0;

  for (const error of report.errors) {
    if (!error.canAutoRepair) {
      skipped++;
      continue;
    }

    if (dryRun) {
      repaired++;
      continue;
    }

    try {
      const result = await repairSingleError(error, projectRoot);
      if (result.success) {
        repaired++;
      } else if (result.skipped) {
        skipped++;
        if (result.reason) {
          console.warn(`${LOG_PREFIX.REPAIR} Skipped ${error.type}: ${result.reason}`);
        }
      } else {
        failed++;
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_PREFIX.REPAIR} Failed to repair ${error.type}: ${errMessage}`);
      failed++;
    }
  }

  return { repaired, skipped, failed };
}

// Internal helpers

/**
 * Repair result type
 */
interface RepairResult {
  success?: boolean;
  skipped?: boolean;
  reason?: string;
}

/**
 * Repair a single inconsistency error
 *
 * @param {object} error - Error object from checkWUConsistency()
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<RepairResult>} Result with success, skipped, and reason
 */
async function repairSingleError(
  error: { type: string; wuId: string; title?: string; lane?: string },
  projectRoot: string,
): Promise<RepairResult> {
  switch (error.type) {
    case CONSISTENCY_TYPES.YAML_DONE_NO_STAMP:
      await createStampInProject(error.wuId, error.title || `WU ${error.wuId}`, projectRoot);
      return { success: true };

    case CONSISTENCY_TYPES.YAML_DONE_STATUS_IN_PROGRESS:
      await removeWUFromSection(
        path.join(projectRoot, WU_PATHS.STATUS()),
        error.wuId,
        '## In Progress',
      );
      return { success: true };

    case CONSISTENCY_TYPES.BACKLOG_DUAL_SECTION:
      await removeWUFromSection(
        path.join(projectRoot, WU_PATHS.BACKLOG()),
        error.wuId,
        '## 🔧 In progress',
      );
      return { success: true };

    case CONSISTENCY_TYPES.ORPHAN_WORKTREE_DONE:
      return await removeOrphanWorktree(error.wuId, error.lane, projectRoot);

    case CONSISTENCY_TYPES.STAMP_EXISTS_YAML_NOT_DONE:
      await updateYamlToDone(error.wuId, projectRoot);
      return { success: true };

    default:
      return { skipped: true, reason: `Unknown error type: ${error.type}` };
  }
}

/**
 * Create stamp file in a specific project root
 *
 * @param {string} id - WU ID
 * @param {string} title - WU title
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<void>}
 */
async function createStampInProject(id, title, projectRoot) {
  const stampsDir = path.join(projectRoot, WU_PATHS.STAMPS_DIR());
  const stampPath = path.join(projectRoot, WU_PATHS.STAMP(id));

  // Ensure stamps directory exists
  try {
    await access(stampsDir, constants.R_OK);
  } catch {
    await mkdir(stampsDir, { recursive: true });
  }

  // Don't overwrite existing stamp
  try {
    await access(stampPath, constants.R_OK);
    return; // Stamp already exists
  } catch {
    // Stamp doesn't exist, continue to create it
  }

  // Create stamp file
  const body = `WU ${id} — ${title}\nCompleted: ${todayISO()}\n`;
  await writeFile(stampPath, body, { encoding: 'utf-8' });
}

/**
 * Update WU YAML to done+locked+completed state (WU-2412)
 *
 * Repairs STAMP_EXISTS_YAML_NOT_DONE by setting:
 * - status: done
 * - locked: true
 * - completed: YYYY-MM-DD (today, unless already set)
 *
 * @param {string} id - WU ID
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<void>}
 */
async function updateYamlToDone(id, projectRoot) {
  const wuPath = path.join(projectRoot, WU_PATHS.WU(id));

  // Read current YAML
  const content = await readFile(wuPath, { encoding: 'utf-8' });
  const wuDoc = parseYAML(content) as {
    status?: string;
    locked?: boolean;
    completed?: string;
  } | null;

  if (!wuDoc) {
    throw new Error(`Failed to parse WU YAML: ${wuPath}`);
  }

  // Update fields
  wuDoc.status = WU_STATUS.DONE;
  wuDoc.locked = true;
  // Preserve existing completed date if present, otherwise set to today
  if (!wuDoc.completed) {
    wuDoc.completed = todayISO();
  }

  // Write updated YAML
  const updatedContent = stringifyYAML(wuDoc, { lineWidth: YAML_OPTIONS.LINE_WIDTH });
  await writeFile(wuPath, updatedContent, { encoding: 'utf-8' });
}

/**
 * Remove WU entry from a specific section in a markdown file
 *
 * @param {string} filePath - Path to the markdown file
 * @param {string} id - WU ID to remove
 * @param {string} sectionHeading - Section heading to target
 * @returns {Promise<void>}
 */
async function removeWUFromSection(filePath, id, sectionHeading) {
  try {
    await access(filePath, constants.R_OK);
  } catch {
    return; // File doesn't exist
  }

  const content = await readFile(filePath, { encoding: 'utf-8' });
  const lines = content.split(/\r?\n/);

  let inTargetSection = false;
  let nextSectionIdx = -1;
  let sectionStartIdx = -1;

  // Normalize heading for comparison (lowercase, trim)
  const normalizedHeading = sectionHeading.toLowerCase().trim();

  // Find section boundaries
  for (let i = 0; i < lines.length; i++) {
    const normalizedLine = lines[i].toLowerCase().trim();
    if (normalizedLine === normalizedHeading || normalizedLine.startsWith(normalizedHeading)) {
      inTargetSection = true;
      sectionStartIdx = i;
      continue;
    }
    if (inTargetSection && lines[i].trim().startsWith('## ')) {
      nextSectionIdx = i;
      break;
    }
  }

  if (sectionStartIdx === -1) return;

  const endIdx = nextSectionIdx === -1 ? lines.length : nextSectionIdx;

  // Filter out lines containing the WU ID in the target section
  const newLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > sectionStartIdx && i < endIdx && lines[i].includes(id)) {
      continue; // Skip this line
    }
    newLines.push(lines[i]);
  }

  await writeFile(filePath, newLines.join(STRING_LITERALS.NEWLINE));
}

/**
 * Remove orphan worktree for a done WU
 *
 * CRITICAL: This function includes safety guards to prevent data loss.
 * See WU-1276 incident report for why these guards are essential.
 *
 * @param {string} id - WU ID
 * @param {string} lane - Lane name
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<object>} Result with success, skipped, and reason
 */
async function removeOrphanWorktree(id, lane, projectRoot) {
  // Find worktree path
  const laneKebab = toKebab(lane);
  const worktreeName = `${laneKebab}-${id.toLowerCase()}`;
  const worktreePath = path.join(projectRoot, 'worktrees', worktreeName);

  // 🚨 SAFETY GUARD 1: Check if cwd is inside worktree
  const cwd = process.cwd();
  if (cwd.startsWith(worktreePath)) {
    return { skipped: true, reason: 'Cannot delete worktree while inside it' };
  }

  // 🚨 SAFETY GUARD 2: Check for uncommitted changes (if worktree exists)
  try {
    await access(worktreePath, constants.R_OK);
    // Worktree exists, check for uncommitted changes
    try {
      const gitWorktree = createGitForPath(worktreePath);
      const status = await gitWorktree.getStatus();
      if (status.trim().length > 0) {
        return { skipped: true, reason: 'Worktree has uncommitted changes' };
      }
    } catch {
      // Ignore errors checking status - proceed with other guards
    }
  } catch {
    // Worktree doesn't exist, that's fine
  }

  // 🚨 SAFETY GUARD 3: Check stamp exists (not rollback state)
  const stampPath = path.join(projectRoot, WU_PATHS.STAMP(id));
  try {
    await access(stampPath, constants.R_OK);
  } catch {
    return { skipped: true, reason: 'WU marked done but no stamp - possible rollback state' };
  }

  // Safe to proceed with cleanup
  const git = createGitForPath(projectRoot);

  try {
    await access(worktreePath, constants.R_OK);
    await git.worktreeRemove(worktreePath, { force: true });
  } catch {
    // Worktree may not exist
  }

  // Delete lane branch
  const branchName = `lane/${laneKebab}/${id.toLowerCase()}`;
  try {
    await git.deleteBranch(branchName, { force: true });
  } catch {
    // Branch may not exist locally
  }
  try {
    await git.raw(['push', REMOTES.ORIGIN, '--delete', branchName]);
  } catch {
    // Remote branch may not exist
  }

  return { success: true };
}

/**
 * Parse backlog.md to find which sections contain a WU ID
 *
 * @param {string} content - Backlog file content
 * @param {string} id - WU ID to search for
 * @returns {object} Object with inDone and inProgress booleans
 */
function parseBacklogSections(content, id) {
  const lines = content.split(/\r?\n/);
  let inDone = false;
  let inProgress = false;
  let currentSection = null;
  // Match exact WU YAML filename to prevent substring false positives
  // e.g., WU-208 should not match lines containing WU-2087
  const exactPattern = `(wu/${id}.yaml)`;

  for (const line of lines) {
    if (line.trim() === '## ✅ Done') {
      currentSection = WU_STATUS.DONE;
      continue;
    }
    if (line.trim() === '## 🔧 In progress') {
      currentSection = 'in_progress';
      continue;
    }
    if (line.trim().startsWith('## ')) {
      currentSection = null;
      continue;
    }

    if (line.includes(exactPattern)) {
      if (currentSection === WU_STATUS.DONE) inDone = true;
      if (currentSection === 'in_progress') inProgress = true;
    }
  }

  return { inDone, inProgress };
}

/**
 * Parse status.md to find if WU is in In Progress section
 *
 * @param {string} content - Status file content
 * @param {string} id - WU ID to search for
 * @returns {object} Object with inProgress boolean
 */
function parseStatusSections(content, id) {
  const lines = content.split(/\r?\n/);
  let inProgress = false;
  let currentSection = null;
  // Match exact WU YAML filename to prevent substring false positives
  // e.g., WU-208 should not match lines containing WU-2087
  const exactPattern = `(wu/${id}.yaml)`;

  for (const line of lines) {
    if (line.trim() === '## In Progress') {
      currentSection = 'in_progress';
      continue;
    }
    if (line.trim().startsWith('## ')) {
      currentSection = null;
      continue;
    }

    if (currentSection === 'in_progress' && line.includes(exactPattern)) {
      inProgress = true;
    }
  }

  return { inProgress };
}

/**
 * Check if a worktree exists for a given WU ID
 *
 * Uses word-boundary matching to avoid false positives where one WU ID
 * is a prefix of another (e.g., WU-204 should not match wu-2049).
 *
 * @param {string} id - WU ID
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<boolean>} True if worktree exists
 */
async function checkWorktreeExists(id, projectRoot) {
  try {
    const git = createGitForPath(projectRoot);
    const output = await git.worktreeList();
    // Match WU ID followed by non-digit or end of string to prevent
    // false positives (e.g., wu-204 matching wu-2049)
    const pattern = new RegExp(`${id.toLowerCase()}(?![0-9])`, 'i');
    return pattern.test(output);
  } catch {
    return false;
  }
}

/**
 * Check whether a worktree path exists on disk
 *
 * @param {string} worktreePath - Worktree path from WU YAML
 * @returns {Promise<boolean>} True if path exists
 */
async function checkWorktreePathExists(worktreePath) {
  if (!worktreePath) {
    return false;
  }
  try {
    await access(worktreePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
