/**
 * @file wu-claim-state.ts
 * @description State update helpers for wu:claim - WU YAML, backlog, status updates.
 *
 * WU-1649: Extracted from wu-claim.ts to reduce orchestration complexity.
 * All functions are mechanical extractions preserving original behavior.
 */

import { rmSync } from 'node:fs';
import { access, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseYAML, stringifyYAML } from '@lumenflow/core/wu-yaml';
import { assertTransition } from '@lumenflow/core/state-machine';
import { getGitForCwd, createGitForPath } from '@lumenflow/core/git-adapter';
import { die, getErrorMessage } from '@lumenflow/core/error-handler';
import {
  BRANCHES,
  WU_STATUS,
  CLAIMED_MODES,
  STATUS_SECTIONS,
  STRING_LITERALS,
  LOG_PREFIX,
  GIT_REFS,
  MICRO_WORKTREE_OPERATIONS,
  COMMIT_FORMATS,
  LUMENFLOW_PATHS,
  FILE_SYSTEM,
} from '@lumenflow/core/wu-constants';
import { WU_PATHS, getStateStoreDirFromBacklog } from '@lumenflow/core/wu-paths';
import { withMicroWorktree, shouldSkipRemoteOperations } from '@lumenflow/core/micro-worktree';
import { generateAutoApproval } from '@lumenflow/core/wu-schema';
import { WUStateStore } from '@lumenflow/core/wu-state-store';
import { DelegationRegistryStore } from '@lumenflow/core/delegation-registry-store';
import { generateBacklog, generateStatus } from '@lumenflow/core/backlog-generator';
import { getConfig } from '@lumenflow/core/config';
import { autoFixWUYaml } from '@lumenflow/core/wu-yaml-fixer';
import { getAssignedEmail } from '@lumenflow/core/wu-claim-helpers';
import {
  shouldProgressInitiativeStatus,
  findInitiative,
  writeInitiative,
  getInitiativeWUs,
} from '@lumenflow/initiatives';
import { resolveClaimStatus } from './wu-claim-validation.js';

const PREFIX = LOG_PREFIX.CLAIM;

export interface ClaimCanonicalUpdateInput {
  isCloud?: boolean;
  claimedMode?: string;
  noPush?: boolean;
}

export interface ClaimBranchMetadataInput {
  claimedMode?: string;
  noPush?: boolean;
  skipRemote?: boolean;
}

/**
 * Decide whether wu:claim should update canonical state on origin/main.
 *
 * Cloud branch-pr claims run on platform-managed branches and should not mutate
 * canonical state on main during claim; they commit claim metadata on their own branch.
 */
export function shouldApplyCanonicalClaimUpdate(input: ClaimCanonicalUpdateInput): boolean {
  // WU-1653: Skip canonical update when no remote (requireRemote=false)
  if (input.noPush || shouldSkipRemoteOperations()) {
    return false;
  }

  return !(input.isCloud && input.claimedMode === CLAIMED_MODES.BRANCH_PR);
}

/**
 * Decide whether wu:claim should write claim metadata directly to the active branch.
 */
export function shouldPersistClaimMetadataOnBranch(input: ClaimBranchMetadataInput): boolean {
  return (
    input.noPush === true ||
    input.claimedMode === CLAIMED_MODES.BRANCH_PR ||
    input.skipRemote === true
  );
}

/**
 * Resolve which main reference should be used for claim baseline SHA.
 *
 * In local-only mode (git.requireRemote=false), origin/main may not exist.
 */
export function resolveClaimBaselineRef(input: { skipRemote?: boolean } = {}): string {
  return input.skipRemote === true ? BRANCHES.MAIN : GIT_REFS.ORIGIN_MAIN;
}

/**
 * WU-1521: Build a rolled-back version of a WU YAML doc by stripping claim metadata.
 *
 * When wu:claim fails after pushing YAML changes to origin/main but before
 * worktree creation succeeds, this function produces a clean doc that can be
 * written back to reset the WU to 'ready' state, enabling a clean retry.
 *
 * Pure function: does not mutate the input doc.
 *
 * @param doc - The claimed WU YAML document to roll back
 * @returns A new document with status=ready and claim metadata removed
 */
export function buildRollbackYamlDoc(doc) {
  // Shallow-copy to avoid mutating the original
  const rolled = { ...doc };

  // Reset status back to ready
  rolled.status = WU_STATUS.READY;

  // Remove claim-specific metadata fields
  delete rolled.claimed_mode;
  delete rolled.claimed_branch; // WU-1589: Clear claimed_branch on rollback
  delete rolled.claimed_at;
  delete rolled.worktree_path;
  delete rolled.baseline_main_sha;
  delete rolled.session_id;
  delete rolled.assigned_to;

  return rolled;
}

export interface ClaimPickupEvidenceResult {
  matchedSpawn: boolean;
  recorded: boolean;
  alreadyRecorded: boolean;
  spawnId?: string;
}

/**
 * Returns true when a spawn record includes claim-time pickup evidence.
 */
export function hasClaimPickupEvidence(entry): boolean {
  const pickedUpAt =
    typeof entry?.pickedUpAt === 'string' && entry.pickedUpAt.trim().length > 0
      ? entry.pickedUpAt
      : '';
  const pickedUpBy =
    typeof entry?.pickedUpBy === 'string' && entry.pickedUpBy.trim().length > 0
      ? entry.pickedUpBy
      : '';
  return pickedUpAt.length > 0 && pickedUpBy.length > 0;
}

/**
 * WU-1605: Record delegated pickup evidence at wu:claim time when a spawn/delegate
 * provenance record already exists for this target WU.
 */
export async function recordClaimPickupEvidence(
  id: string,
  options: {
    baseDir?: string;
    claimedBy?: string;
  } = {},
): Promise<ClaimPickupEvidenceResult> {
  const baseDir = options.baseDir ?? process.cwd();
  const claimedBy =
    typeof options.claimedBy === 'string' && options.claimedBy.trim().length > 0
      ? options.claimedBy.trim()
      : 'unknown';

  const store = new DelegationRegistryStore(path.join(baseDir, '.lumenflow', 'state'));
  await store.load();

  const spawnEntry = store.getByTarget(id);
  if (!spawnEntry) {
    return { matchedSpawn: false, recorded: false, alreadyRecorded: false };
  }

  if (hasClaimPickupEvidence(spawnEntry)) {
    return {
      matchedSpawn: true,
      recorded: false,
      alreadyRecorded: true,
      spawnId: spawnEntry.id,
    };
  }

  await store.recordPickup(spawnEntry.id, claimedBy);
  return {
    matchedSpawn: true,
    recorded: true,
    alreadyRecorded: false,
    spawnId: spawnEntry.id,
  };
}

export async function updateWUYaml(
  WU_PATH,
  id,
  lane,
  claimedMode = 'worktree',
  worktreePath = null,
  sessionId = null,
  gitAdapter = null,
  claimedBranch: string | null = null, // WU-1590: Persist claimed_branch for branch-pr cloud agents
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
    text = await readFile(WU_PATH, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  } catch (e) {
    die(
      `Failed to read WU file: ${WU_PATH}\n\n` +
        `Error: ${getErrorMessage(e)}\n\n` +
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
        `Error: ${getErrorMessage(e)}\n\n` +
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
  const currentStatus = resolveClaimStatus(doc.status);
  try {
    assertTransition(currentStatus, WU_STATUS.IN_PROGRESS, id);
  } catch (error) {
    die(`State transition validation failed: ${getErrorMessage(error)}`);
  }

  // Update status and lane (lane only if provided and different)
  doc.status = WU_STATUS.IN_PROGRESS;
  if (lane) doc.lane = lane;
  // Record claimed mode (worktree or branch-only)
  doc.claimed_mode = claimedMode;
  // WU-1590: Persist claimed_branch for branch-pr cloud agents so downstream commands
  // (wu:prep, wu:done, wu:cleanup) can resolve the actual branch via defaultBranchFrom()
  if (claimedBranch) {
    doc.claimed_branch = claimedBranch;
  }
  // WU-1226: Record worktree path to prevent resolution failures if lane field changes
  if (worktreePath) {
    doc.worktree_path = worktreePath;
  }
  const git = gitAdapter || getGitForCwd();
  // WU-1423: Record owner using validated email (no silent username fallback)
  // Fallback chain: git config user.email > GIT_AUTHOR_EMAIL > error
  // WU-1427: getAssignedEmail is now async to properly await gitAdapter.getConfigValue
  doc.assigned_to = await getAssignedEmail(git);
  // Record claim timestamp for duration tracking (WU-637)
  doc.claimed_at = new Date().toISOString();
  // WU-1382: Store baseline main SHA for parallel agent detection
  // wu:done will compare against this to detect if other WUs were merged during work
  const baselineRef = resolveClaimBaselineRef({ skipRemote: shouldSkipRemoteOperations() });
  doc.baseline_main_sha = await git.getCommitHash(baselineRef);
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

  await writeFile(WU_PATH, out, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  // WU-1211: Return both title and initiative for status progression check
  return { title: doc.title || '', initiative: doc.initiative || null };
}

/**
 * WU-1211: Check and progress initiative status from draft/open to in_progress.
 *
 * Called when a WU with an initiative field is claimed. If this is the first
 * WU being claimed for the initiative, progress the initiative status.
 *
 * @param {string} worktreePath - Path to micro-worktree (or main)
 * @param {string} initiativeRef - Initiative ID or slug
 * @param {string} wuId - WU ID being claimed
 * @returns {Promise<{updated: boolean, initPath: string|null}>} Result
 */
export async function maybeProgressInitiativeStatus(
  worktreePath: string,
  initiativeRef: string,
  wuId: string,
): Promise<{ updated: boolean; initPath: string | null }> {
  try {
    // Find the initiative
    const initiative = findInitiative(initiativeRef);
    if (!initiative) {
      console.log(`${PREFIX} Initiative ${initiativeRef} not found (may be created later)`);
      return { updated: false, initPath: null };
    }

    // Get all WUs for this initiative to check if any are in_progress
    const wus = getInitiativeWUs(initiativeRef);
    // Include the WU we're currently claiming as in_progress
    const wusWithCurrent = wus.map((wu) =>
      wu.id === wuId ? { ...wu, doc: { ...wu.doc, status: 'in_progress' } } : wu,
    );
    const wuDocs = wusWithCurrent.map((wu) => wu.doc);

    // Check if initiative status should progress
    const progressCheck = shouldProgressInitiativeStatus(initiative.doc, wuDocs);
    if (!progressCheck.shouldProgress || !progressCheck.newStatus) {
      return { updated: false, initPath: null };
    }

    // Update initiative status in worktree
    const initRelativePath = initiative.path.replace(process.cwd() + '/', '');
    const initAbsPath = path.join(worktreePath, initRelativePath);

    // Read, update, write
    const initDoc = { ...initiative.doc, status: progressCheck.newStatus };
    writeInitiative(initAbsPath, initDoc);

    console.log(
      `${PREFIX} ✅ Initiative ${initiativeRef} status progressed: ${initiative.doc.status} → ${progressCheck.newStatus}`,
    );

    return { updated: true, initPath: initRelativePath };
  } catch (error) {
    // Non-fatal: log warning and continue
    console.warn(
      `${PREFIX} ⚠️  Could not check initiative status progression: ${getErrorMessage(error)}`,
    );
    return { updated: false, initPath: null };
  }
}

export async function addOrReplaceInProgressStatus(statusPath, id, title) {
  // Check file exists

  try {
    await access(statusPath);
  } catch {
    die(`Missing ${statusPath}`);
  }

  const rel = `wu/${id}.yaml`;
  const bullet = `- [${id} — ${title}](${rel})`;
  // Read file

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
    if (lines[i] && lines[i].includes('No items currently in progress')) {
      lines.splice(i, 1);
      endIdx--;
      break;
    }
  }
  // Insert bullet right after header
  lines.splice(startIdx + 1, 0, '', bullet);
  // Write file

  await writeFile(statusPath, lines.join(STRING_LITERALS.NEWLINE), {
    encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
  });
}

export async function removeFromReadyAndAddToInProgressBacklog(backlogPath, id, title, lane) {
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
export async function appendClaimEventOnly(stateDir, id, title, lane) {
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
  // WU-1311: Use config-based paths instead of hardcoded docs/04-operations paths
  const config = getConfig();
  return [
    `${config.directories.wuDir}/${wuId}.yaml`,
    LUMENFLOW_PATHS.WU_EVENTS, // WU-1740: Event store is source of truth
    // WU-1746: Explicitly NOT including backlog.md and status.md
    // These generated files cause merge conflicts when main advances
  ];
}

export async function readWUTitle(id) {
  const p = WU_PATHS.WU(id);
  // Check file exists

  try {
    await access(p);
  } catch {
    return null;
  }
  // Read file

  const text = await readFile(p, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  // Match title field - use RegExp.exec for sonarjs/prefer-regexp-exec compliance
  // Regex is safe: runs on trusted WU YAML files with bounded input

  const titlePattern = /^title:\s*"?([^"\n]+)"?$/m;
  const m = titlePattern.exec(text);
  return m ? m[1] : null;
}

export function parseStagedChangeLine(line) {
  const parts = line.trim().split(/\s+/);
  const status = parts[0];
  if (!status) return null;
  if (status.startsWith('R') || status.startsWith('C')) {
    return { status, from: parts[1], filePath: parts[2] };
  }
  return { status, filePath: parts.slice(1).join(' ') };
}

export async function getStagedChanges() {
  const diff = await getGitForCwd().raw(['diff', '--cached', '--name-status']);
  if (!diff.trim()) return [];
  return diff
    .split(STRING_LITERALS.NEWLINE)
    .filter(Boolean)
    .map(parseStagedChangeLine)
    .filter(Boolean);
}

export async function applyStagedChangesToMicroWorktree(worktreePath, stagedChanges) {
  for (const change of stagedChanges) {
    const filePath = change.filePath;
    if (!filePath) continue;
    const targetPath = path.join(worktreePath, filePath);
    if (change.status.startsWith('D')) {
      rmSync(targetPath, { recursive: true, force: true });
      continue;
    }
    const sourcePath = path.join(process.cwd(), filePath);

    const contents = await readFile(sourcePath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
    await mkdir(path.dirname(targetPath), { recursive: true });

    await writeFile(targetPath, contents, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  }
}

export async function ensureCleanOrClaimOnlyWhenNoAuto() {
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
  // WU-1311: Use config-based paths instead of hardcoded docs/04-operations paths
  const config = getConfig();
  const wuDirPattern = config.directories.wuDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // eslint-disable-next-line security/detect-non-literal-regexp -- config path escaped for regex; not user input
  const wuYamlRegex = new RegExp(`${wuDirPattern}/WU-\\d+\\.yaml`);
  const hasClaimFiles = staged.some(
    (l) =>
      l.includes(config.directories.statusPath) ||
      l.includes(config.directories.backlogPath) ||
      wuYamlRegex.test(l),
  );
  if (!hasClaimFiles) {
    console.error(status);
    die('Stage claim-related files (status/backlog/WU YAML) before running with --no-auto.');
  }
}

/**
 * Update canonical claim state on origin/main using push-only micro-worktree.
 * Ensures canonical state stays global while local main remains unchanged.
 */
export async function applyCanonicalClaimUpdate(ctx, sessionId) {
  const {
    args,
    id,
    laneK,
    worktree,
    WU_PATH,
    STATUS_PATH,
    BACKLOG_PATH,
    claimedMode,
    fixableIssues,
    stagedChanges,
    currentBranchForCloud, // WU-1590: For persisting claimed_branch
  } = ctx;
  const commitMsg = COMMIT_FORMATS.CLAIM(id.toLowerCase(), laneK);
  const worktreePathForYaml =
    claimedMode === CLAIMED_MODES.BRANCH_ONLY ? null : path.resolve(worktree);
  let updatedTitle = '';
  const filesToCommit =
    args.noAuto && stagedChanges.length > 0
      ? stagedChanges.map((change) => change.filePath).filter(Boolean)
      : [WU_PATHS.WU(id), WU_PATHS.STATUS(), WU_PATHS.BACKLOG(), LUMENFLOW_PATHS.WU_EVENTS];

  console.log(`${PREFIX} Updating canonical claim state (push-only)...`);

  await withMicroWorktree({
    operation: MICRO_WORKTREE_OPERATIONS.WU_CLAIM,
    id,
    logPrefix: PREFIX,
    pushOnly: true,
    execute: async ({ worktreePath }) => {
      const microWUPath = path.join(worktreePath, WU_PATH);
      const microStatusPath = path.join(worktreePath, STATUS_PATH);
      const microBacklogPath = path.join(worktreePath, BACKLOG_PATH);

      if (args.noAuto) {
        await applyStagedChangesToMicroWorktree(worktreePath, stagedChanges);
      } else {
        if (fixableIssues && fixableIssues.length > 0) {
          console.log(`${PREFIX} Applying ${fixableIssues.length} YAML fix(es)...`);
          autoFixWUYaml(microWUPath);
          console.log(`${PREFIX} YAML fixes applied successfully`);
        }

        const microGit = createGitForPath(worktreePath);
        // WU-1211: updateWUYaml now returns {title, initiative}
        const updateResult = await updateWUYaml(
          microWUPath,
          id,
          args.lane,
          claimedMode,
          worktreePathForYaml,
          sessionId,
          microGit,
          currentBranchForCloud || null, // WU-1590: Persist claimed_branch for branch-pr
        );
        updatedTitle = updateResult.title || updatedTitle;
        await addOrReplaceInProgressStatus(microStatusPath, id, updatedTitle);
        await removeFromReadyAndAddToInProgressBacklog(
          microBacklogPath,
          id,
          updatedTitle,
          args.lane,
        );

        // WU-1211: Check and progress initiative status
        let initPath: string | null = null;
        if (updateResult.initiative) {
          const initProgress = await maybeProgressInitiativeStatus(
            worktreePath,
            updateResult.initiative,
            id,
          );
          initPath = initProgress.initPath;
        }

        // Include initiative path in files to commit if updated
        const allFilesToCommit = initPath ? [...filesToCommit, initPath] : filesToCommit;

        return {
          commitMessage: commitMsg,
          files: allFilesToCommit,
        };
      }

      return {
        commitMessage: commitMsg,
        files: filesToCommit,
      };
    },
  });

  console.log(`${PREFIX} Canonical claim state updated on origin/main`);
  return updatedTitle;
}

/**
 * WU-1521: Rollback canonical claim state on origin/main after partial failure.
 *
 * When wu:claim pushes YAML changes to origin/main (via applyCanonicalClaimUpdate)
 * but then fails to create the worktree or branch, this function reverses the claim
 * by writing the WU YAML back to 'ready' status and emitting a 'release' event
 * to the state store. This ensures re-running wu:claim succeeds without wu:repair.
 *
 * Uses a push-only micro-worktree to atomically update origin/main.
 *
 * @param id - WU ID (e.g., 'WU-1521')
 * @param lane - Lane name for the release event
 * @param title - WU title for the release event
 */
export async function rollbackCanonicalClaim(
  id: string,
  _lane: string,
  _title: string,
): Promise<void> {
  console.log(`${PREFIX} Rolling back canonical claim for ${id}...`);

  try {
    await withMicroWorktree({
      operation: MICRO_WORKTREE_OPERATIONS.WU_CLAIM,
      id,
      logPrefix: PREFIX,
      pushOnly: true,
      execute: async ({ worktreePath }) => {
        const microWUPath = path.join(worktreePath, WU_PATHS.WU(id));

        // Read the current (claimed) YAML from the micro-worktree
        const text = await readFile(microWUPath, {
          encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
        });
        const doc = parseYAML(text);

        // Build the rolled-back doc and write it
        const rolledBackDoc = buildRollbackYamlDoc(doc);
        const out = stringifyYAML(rolledBackDoc);
        await writeFile(microWUPath, out, {
          encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
        });

        // Emit a release event to the state store so the claim event is reversed
        const microBacklogPath = path.join(worktreePath, WU_PATHS.BACKLOG());
        const stateDir = getStateStoreDirFromBacklog(microBacklogPath);
        const store = new WUStateStore(stateDir);
        await store.load();
        await store.release(id, `Rollback: wu:claim failed after canonical update`);

        // Regenerate backlog.md and status.md from the corrected state
        const backlogContent = await generateBacklog(store);
        await writeFile(microBacklogPath, backlogContent, {
          encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
        });
        const microStatusPath = path.join(worktreePath, WU_PATHS.STATUS());
        const statusContent = await generateStatus(store);
        await writeFile(microStatusPath, statusContent, {
          encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
        });

        return {
          commitMessage: `wu(${id.toLowerCase()}): rollback claim after partial failure`,
          files: [
            WU_PATHS.WU(id),
            WU_PATHS.STATUS(),
            WU_PATHS.BACKLOG(),
            LUMENFLOW_PATHS.WU_EVENTS,
          ],
        };
      },
    });

    console.log(`${PREFIX} Canonical claim rolled back for ${id}`);
  } catch (rollbackErr) {
    // Rollback failure should not mask the original error.
    // Log the rollback failure but let the original error propagate.
    console.error(
      `${PREFIX} WARNING: Failed to rollback canonical claim for ${id}: ${rollbackErr.message}`,
    );
    console.error(`${PREFIX} Manual recovery required: pnpm wu:repair --id ${id} --claim`);
  }
}
