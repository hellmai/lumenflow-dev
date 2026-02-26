// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { scanLogForViolations, rotateLog } from '@lumenflow/core/commands-logger';
import { getConfig } from '@lumenflow/core/config';
import { validateDocsOnly, getAllowedPathsDescription } from '@lumenflow/core/docs-path-validator';
import { die, getErrorMessage, ProcessExitError } from '@lumenflow/core/error-handler';
import { getGitForCwd } from '@lumenflow/core/git-adapter';
import {
  BRANCHES,
  REMOTES,
  LOG_PREFIX,
  EMOJI,
  GIT,
  STRING_LITERALS,
  LUMENFLOW_PATHS,
  EXIT_CODES,
} from '@lumenflow/core/wu-constants';
import { resolveWuEventsRelativePath } from './state-path-resolvers.js';

type GitAdapter = ReturnType<typeof getGitForCwd>;
type DetectParallelCompletionsGitAdapter = Pick<GitAdapter, 'fetch' | 'getCommitHash' | 'raw'>;
type EnsureMainUpToDateGitAdapter = Pick<GitAdapter, 'fetch' | 'getCommitHash' | 'revList'>;

interface WUDocLike extends Record<string, unknown> {
  baseline_main_sha?: string;
}

interface ParallelCompletionResult {
  hasParallelCompletions: boolean;
  completedWUs: string[];
  warning: string | null;
}

/**
 * WU-1234: Detect if branch is already merged to main
 * Checks if branch tip is an ancestor of main HEAD (i.e., already merged).
 */
export async function isBranchAlreadyMerged(branch: string): Promise<boolean> {
  try {
    const gitAdapter = getGitForCwd();
    const branchTip = (await gitAdapter.getCommitHash(branch)).trim();
    const mergeBase = (await gitAdapter.mergeBase(BRANCHES.MAIN, branch)).trim();
    const mainHead = (await gitAdapter.getCommitHash(BRANCHES.MAIN)).trim();

    if (branchTip === mergeBase) {
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.INFO} Branch ${branch} is already merged to main\n` +
          `         Branch tip: ${branchTip.substring(0, GIT.SHA_SHORT_LENGTH)}\n` +
          `         Merge-base: ${mergeBase.substring(0, GIT.SHA_SHORT_LENGTH)}\n` +
          `         Main HEAD:  ${mainHead.substring(0, GIT.SHA_SHORT_LENGTH)}`,
      );
      return true;
    }

    return false;
  } catch (e) {
    console.warn(
      `${LOG_PREFIX.DONE} Could not check if branch is already merged: ${getErrorMessage(e)}`,
    );
    return false;
  }
}

/**
 * Ensure working tree is clean before wu:done operations.
 */
export async function ensureCleanWorkingTreeForDone() {
  const status = await getGitForCwd().getStatus();
  if (status.trim()) {
    die(
      `Working tree is not clean. Cannot proceed with wu:done.\n\n` +
        `Uncommitted changes in main checkout:\n${status}\n\n` +
        `⚠️  CRITICAL: These may be another agent's work!\n\n` +
        `Before proceeding:\n` +
        `1. Check if these are YOUR changes (forgot to commit in main)\n` +
        `   → If yes: Commit them now, then retry wu:done\n\n` +
        `2. Check if these are ANOTHER AGENT's changes\n` +
        `   → If yes: STOP. Coordinate with user before proceeding\n` +
        `   → NEVER remove another agent's uncommitted work\n\n` +
        `Multi-agent coordination: See CLAUDE.md §2.2\n\n` +
        `Common causes:\n` +
        `  - You forgot to commit changes before claiming a different WU\n` +
        `  - Another agent is actively working in main checkout\n` +
        `  - Leftover changes from previous session`,
    );
  }
}

/**
 * Extract completed WU IDs from git log output.
 */
function extractCompletedWUIds(logOutput: string, currentId: string): string[] {
  const wuPattern = /wu\((wu-\d+)\):/gi;
  const seenIds = new Set();
  const completedWUs = [];

  for (const line of logOutput.split(STRING_LITERALS.NEWLINE)) {
    if (!line.toLowerCase().includes('done')) continue;

    let match;
    while ((match = wuPattern.exec(line)) !== null) {
      const wuId = match[1].toUpperCase();
      if (wuId !== currentId && !seenIds.has(wuId)) {
        seenIds.add(wuId);
        completedWUs.push(wuId);
      }
    }
  }
  return completedWUs;
}

/**
 * Build warning message for parallel completions.
 */
function buildParallelWarning(
  id: string,
  completedWUs: string[],
  baselineSha: string,
  currentSha: string,
): string {
  const wuList = completedWUs.map((wu) => `  • ${wu}`).join(STRING_LITERALS.NEWLINE);
  return `
${EMOJI.WARNING}  PARALLEL COMPLETIONS DETECTED ${EMOJI.WARNING}

The following WUs were completed and merged to main since you claimed ${id}:

${wuList}

This may cause rebase conflicts when wu:done attempts to merge.

Options:
  1. Proceed anyway - rebase will attempt to resolve conflicts
  2. Abort and manually rebase: git fetch origin main && git rebase origin/main
  3. Check if other completed WUs touched the same files

Baseline: ${baselineSha.substring(0, 8)}
Current:  ${currentSha.substring(0, 8)}
`;
}

/**
 * WU-1382: Detect parallel WU completions since claim time.
 */
export async function detectParallelCompletions(
  id: string,
  doc: WUDocLike,
  gitAdapter?: DetectParallelCompletionsGitAdapter,
): Promise<ParallelCompletionResult> {
  const noParallel: ParallelCompletionResult = {
    hasParallelCompletions: false,
    completedWUs: [],
    warning: null,
  };
  const baselineSha = doc.baseline_main_sha;

  if (!baselineSha) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.INFO} No baseline_main_sha recorded (legacy WU) - skipping parallel detection`,
    );
    return noParallel;
  }

  try {
    const git = gitAdapter ?? getGitForCwd();
    await git.fetch(REMOTES.ORIGIN, BRANCHES.MAIN);

    const currentSha = (await git.getCommitHash(`${REMOTES.ORIGIN}/${BRANCHES.MAIN}`)).trim();

    if (currentSha === baselineSha) {
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} No parallel completions detected (main unchanged since claim)`,
      );
      return noParallel;
    }

    const logOutput = await git.raw([
      'log',
      '--oneline',
      '--grep=^wu(wu-',
      `${baselineSha}..${REMOTES.ORIGIN}/${BRANCHES.MAIN}`,
    ]);

    if (!logOutput?.trim()) {
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Main advanced since claim but no WU completions detected`,
      );
      return noParallel;
    }

    const completedWUs = extractCompletedWUIds(logOutput, id);

    if (completedWUs.length === 0) {
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Main advanced since claim but no other WU completions`,
      );
      return noParallel;
    }

    const warning = buildParallelWarning(id, completedWUs, baselineSha, currentSha);
    return { hasParallelCompletions: true, completedWUs, warning };
  } catch (err) {
    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not detect parallel completions: ${getErrorMessage(err)}`,
    );
    return noParallel;
  }
}

/**
 * Ensure main branch is up-to-date with origin before merge operations.
 */
export async function ensureMainUpToDate(gitAdapter?: EnsureMainUpToDateGitAdapter) {
  console.log(`${LOG_PREFIX.DONE} Checking if main is up-to-date with origin...`);

  try {
    const git = gitAdapter ?? getGitForCwd();
    await git.fetch(REMOTES.ORIGIN, BRANCHES.MAIN);

    const localMain = await git.getCommitHash(BRANCHES.MAIN);
    const remoteMain = await git.getCommitHash(`${REMOTES.ORIGIN}/${BRANCHES.MAIN}`);

    if (localMain !== remoteMain) {
      const behind = await git.revList([
        '--count',
        `${BRANCHES.MAIN}..${REMOTES.ORIGIN}/${BRANCHES.MAIN}`,
      ]);
      const ahead = await git.revList([
        '--count',
        `${REMOTES.ORIGIN}/${BRANCHES.MAIN}..${BRANCHES.MAIN}`,
      ]);

      die(
        `Main branch is out of sync with ${REMOTES.ORIGIN}.\n\n` +
          `Local ${BRANCHES.MAIN} is ${behind} commits behind and ${ahead} commits ahead of ${REMOTES.ORIGIN}/${BRANCHES.MAIN}.\n\n` +
          `Update main before running wu:done:\n` +
          `  git pull origin main\n` +
          `  # Then retry:\n` +
          `  pnpm wu:done --id ${process.argv.find((a) => a.startsWith('WU-')) || 'WU-XXX'}\n\n` +
          `This prevents fast-forward merge failures during wu:done completion.\n\n` +
          `Why this happens:\n` +
          `  - Another agent completed a WU and pushed to main\n` +
          `  - Your main checkout is now behind origin/main\n` +
          `  - The fast-forward merge will fail without updating first\n\n` +
          `Multi-agent coordination: See CLAUDE.md §2.7`,
      );
    }

    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Main is up-to-date with origin`);
  } catch (err) {
    // WU-2198: Re-throw ProcessExitError from die() — intentional aborts must propagate.
    // Only catch network/fetch errors (fail-open policy for connectivity issues).
    if (err instanceof ProcessExitError) throw err;
    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not verify main sync: ${getErrorMessage(err)}`,
    );
    console.warn(`${LOG_PREFIX.DONE} Proceeding anyway (network issue or no remote)`);
  }
}

/**
 * Tripwire check: Scan commands log for violations (WU-630 detective layer)
 */
export function runTripwireCheck() {
  const violations = scanLogForViolations();

  if (violations.length === 0) {
    return;
  }

  console.error('\n⛔ VIOLATION DETECTED: Destructive Git Commands on Main\n');
  console.error('The following forbidden git commands were executed during this session:\n');

  violations.forEach((v, i) => {
    console.error(`  ${i + 1}. ${v.command}`);
    console.error(`     Branch: ${v.branch}`);
    console.error(`     Worktree: ${v.worktree}`);
    console.error(`     Time: ${v.timestamp}\n`);
  });

  console.error(`\nTotal: ${violations.length} violations\n`);

  console.error("⚠️  CRITICAL: These commands may have destroyed other agents' work!\n");
  console.error('Remediation Steps:\n');

  const hasReset = violations.some((v) => v.command.includes('reset --hard'));
  const hasStash = violations.some((v) => v.command.includes('stash'));
  const hasClean = violations.some((v) => v.command.includes('clean'));

  if (hasReset) {
    console.error('📋 git reset --hard detected:');
    console.error('   1. Check git reflog to recover lost commits:');
    console.error('      git reflog');
    console.error('      git reset --hard HEAD@{N}  (where N is the commit before reset)');
    console.error('   2. If reflog shows lost work, restore it immediately\n');
  }

  if (hasStash) {
    console.error('📋 git stash detected:');
    console.error("   1. Check if stash contains other agents' work:");
    console.error('      git stash list');
    console.error('      git stash show -p stash@{0}');
    console.error('   2. If stash contains work, pop it back:');
    console.error('      git stash pop\n');
  }

  if (hasClean) {
    console.error('📋 git clean detected:');
    console.error('   1. Deleted files may not be recoverable');
    console.error('   2. Check git status for remaining untracked files');
    console.error('   3. Escalate to human if critical files were deleted\n');
  }

  console.error('📖 See detailed recovery steps:');
  console.error('   https://lumenflow.dev/reference/playbook/ §4.6\n');

  console.error('🚫 DO NOT proceed with wu:done until violations are remediated.\n');
  console.error('Fix violations first, then retry wu:done.\n');

  rotateLog();
  process.exit(EXIT_CODES.ERROR);
}

async function listStaged(gitAdapter?: GitAdapter): Promise<string[]> {
  const gitCwd = gitAdapter ?? getGitForCwd();
  const raw = await gitCwd.raw(['diff', '--cached', '--name-only']);
  return raw ? raw.split(/\r?\n/).filter(Boolean) : [];
}

// In --no-auto mode, allow a safe no-op: if NONE of the expected files are staged,
// treat as already-synchronised and continue.
export async function ensureNoAutoStagedOrNoop(
  paths: Array<string | null | undefined>,
): Promise<{ noop: boolean }> {
  const staged = await listStaged();
  const isStaged = (p: string): boolean =>
    staged.some((name: string) => name === p || name.startsWith(`${p}/`));
  const definedPaths = paths.filter((p): p is string => typeof p === 'string' && p.length > 0);
  const present = definedPaths.filter((p) => isStaged(p));
  if (present.length === 0) {
    console.log(
      `${LOG_PREFIX.DONE} No staged changes detected for --no-auto; treating as no-op finalisation (repo already in done state)`,
    );
    return { noop: true };
  }
  const missing = definedPaths.filter((p) => !isStaged(p));
  if (missing.length > 0) {
    die(`Stage updates for: ${missing.join(', ')}`);
  }
  return { noop: false };
}

export async function validateStagedFiles(
  id: string,
  isDocsOnly = false,
  gitAdapter?: GitAdapter,
  options: { metadataAllowlist?: string[] } = {},
): Promise<void> {
  const staged = await listStaged(gitAdapter);

  const config = getConfig();
  const wuPath = `${config.directories.wuDir}/${id}.yaml`;

  const whitelist = [
    wuPath,
    config.directories.statusPath,
    config.directories.backlogPath,
    resolveWuEventsRelativePath(process.cwd()),
  ];
  const metadataAllowlist = (options.metadataAllowlist ?? []).filter(
    (file): file is string => typeof file === 'string' && file.length > 0,
  );
  const whitelistSet = new Set([...whitelist, ...metadataAllowlist]);

  if (isDocsOnly) {
    const docsResult = validateDocsOnly(staged);
    if (!docsResult.valid) {
      die(
        `Docs-only WU cannot modify code files:\n  ${docsResult.violations.join(`${STRING_LITERALS.NEWLINE}  `)}\n\n${getAllowedPathsDescription()}`,
      );
    }
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Docs-only path validation passed`);
    return;
  }

  const unexpected = staged.filter((file) => {
    if (whitelistSet.has(file)) return false;
    if (file.startsWith(`${LUMENFLOW_PATHS.STAMPS_DIR}/`)) return false;
    if (file.startsWith('apps/docs/') && file.endsWith('.mdx')) return false;
    return true;
  });

  if (unexpected.length > 0) {
    const wuDirPattern = config.directories.wuDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line security/detect-non-literal-regexp -- config path escaped for regex; not user input
    const wuYamlRegex = new RegExp(`^${wuDirPattern}/WU-\\d+\\.yaml$`);
    const otherWuYamlOnly = unexpected.every((f) => wuYamlRegex.test(f));
    if (otherWuYamlOnly) {
      console.warn(
        `${LOG_PREFIX.DONE} Warning: other WU YAMLs are staged; proceeding and committing only current WU files.`,
      );
    } else {
      die(
        `Unexpected files staged (only current WU metadata, current parent initiative YAML, and .lumenflow/stamps/<id>.done allowed):\n  ${unexpected.join(`${STRING_LITERALS.NEWLINE}  `)}`,
      );
    }
  }
}

/**
 * Validate Branch-Only mode requirements before proceeding.
 */
export async function validateBranchOnlyMode(
  laneBranch: string,
): Promise<{ valid: boolean; error: string | null }> {
  const gitAdapter = getGitForCwd();
  const currentBranch = await gitAdapter.getCurrentBranch();
  if (currentBranch !== laneBranch) {
    return {
      valid: false,
      error:
        `Branch-Only mode error: Not on the lane branch.\n\n` +
        `Expected branch: ${laneBranch}\n` +
        `Current branch: ${currentBranch}\n\n` +
        `Fix: git checkout ${laneBranch}`,
    };
  }

  const status = await gitAdapter.getStatus();
  if (status) {
    return {
      valid: false,
      error:
        `Branch-Only mode error: Working directory is not clean.\n\n` +
        `Uncommitted changes detected:\n${status}\n\n` +
        `Fix: Commit all changes before running wu:done\n` +
        `  git add -A\n` +
        `  git commit -m "wu(wu-xxx): ..."\n` +
        `  git push origin ${laneBranch}`,
    };
  }

  return { valid: true, error: null };
}
