#!/usr/bin/env node
/**
 * WU Prune Utility
 *
 * Maintains worktree hygiene by:
 * - Running git worktree prune to clean stale metadata
 * - Validating worktree ↔ WU ↔ lane mappings
 * - Warning on orphaned worktrees (no matching WU YAML)
 * - Warning on stale worktrees (WU status is done/blocked)
 * - Warning on invalid branch naming conventions
 *
 * Usage:
 *   pnpm wu:prune          # Dry-run mode (shows what would be done)
 *   pnpm wu:prune --execute # Actually run cleanup
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { readWUYaml, validateBranchName, extractWUFromBranch } from '@lumenflow/core/wu-helpers';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { die } from '@lumenflow/core/error-handler';
import { getGitForCwd } from '@lumenflow/core/git-adapter';
import {
  detectOrphanWorktrees,
  detectMissingTrackedWorktrees,
  removeOrphanDirectory,
} from '@lumenflow/core/orphan-detector';
import {
  BRANCHES,
  WU_STATUS,
  CLI_FLAGS,
  EXIT_CODES,
  STRING_LITERALS,
  EMOJI,
  LOG_PREFIX,
  WORKTREE_WARNINGS,
} from '@lumenflow/core/wu-constants';

interface PruneArgs {
  dryRun: boolean;
  help?: boolean;
}

function parseArgs(argv: string[]): PruneArgs {
  const args: PruneArgs = { dryRun: true }; // Default to dry-run for safety
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === CLI_FLAGS.EXECUTE) args.dryRun = false;
    else if (a === CLI_FLAGS.DRY_RUN) args.dryRun = true;
    else if (a === CLI_FLAGS.HELP || a === CLI_FLAGS.HELP_SHORT) args.help = true;
    else die(`Unknown argument: ${a}`);
  }
  return args;
}

/**
 * Parse git worktree list --porcelain output
 * @returns {Promise<Array<{path: string, branch: string, head: string}>>}
 */
interface WorktreeEntry {
  path?: string;
  branch?: string;
  head?: string;
}

async function listWorktrees(): Promise<WorktreeEntry[]> {
  const output = await getGitForCwd().worktreeList();
  if (!output) return [];

  const worktrees: WorktreeEntry[] = [];
  const lines = output.split(STRING_LITERALS.NEWLINE);
  let current: WorktreeEntry = {};

  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      if (current.path) worktrees.push(current);
      current = { path: line.substring(9).trim() };
    } else if (line.startsWith('HEAD ')) {
      current.head = line.substring(5).trim();
    } else if (line.startsWith('branch ')) {
      const fullRef = line.substring(7).trim();
      // Extract branch name from refs/heads/...
      current.branch = fullRef.replace(/^refs\/heads\//, '');
    } else if (line === '') {
      if (current.path) worktrees.push(current);
      current = {};
    }
  }

  if (current.path) worktrees.push(current);
  return worktrees;
}

/**
 * Validate a single worktree
 * @returns {Promise<{valid: boolean, warnings: string[], errors: string[]}>}
 */
async function validateWorktree(wt) {
  const warnings = [];
  const errors = [];

  // Skip main worktree
  if (wt.branch === BRANCHES.MAIN) {
    return { valid: true, warnings, errors };
  }

  // Check branch naming convention
  const branchValidation = validateBranchName(wt.branch);
  if (!branchValidation.valid) {
    errors.push(
      `Invalid branch name: ${wt.branch}\n    Expected: lane/<lane>/<wu-id>\n    ${branchValidation.error}`,
    );
    return { valid: false, warnings, errors }; // Can't continue validation without WU ID
  }

  const wuid = extractWUFromBranch(wt.branch);
  if (!wuid) {
    errors.push(`Could not extract WU ID from branch: ${wt.branch}`);
    return { valid: false, warnings, errors };
  }

  // Check if WU YAML exists
  const repoRoot = await getGitForCwd().raw(['rev-parse', '--show-toplevel']);
  const wuPath = path.join(repoRoot.trim(), WU_PATHS.WU(wuid));
  if (!existsSync(wuPath)) {
    errors.push(
      `Orphaned worktree: WU ${wuid} not found\n    Worktree: ${wt.path}\n    Branch: ${wt.branch}\n    Expected: ${wuPath}`,
    );
    return { valid: false, warnings, errors };
  }

  // Read WU YAML and check status
  const wu = readWUYaml(wuid);
  if (!wu) {
    errors.push(`Failed to parse WU YAML: ${wuPath}`);
    return { valid: false, warnings, errors };
  }

  // Check for status mismatches
  const status = wu.status;
  if (status === WU_STATUS.DONE) {
    warnings.push(
      `Stale worktree: WU ${wuid} is marked '${WU_STATUS.DONE}'\n    Worktree: ${wt.path}\n    Branch: ${wt.branch}\n    Action: Remove with 'git worktree remove ${wt.path}'`,
    );
  } else if (status === WU_STATUS.BLOCKED) {
    warnings.push(
      `Blocked worktree: WU ${wuid} is marked '${WU_STATUS.BLOCKED}'\n    Worktree: ${wt.path}\n    Branch: ${wt.branch}\n    Consider: Keep if resuming soon, otherwise remove`,
    );
  } else if (status === WU_STATUS.READY) {
    warnings.push(
      `Unclaimed worktree: WU ${wuid} is marked '${WU_STATUS.READY}'\n    Worktree: ${wt.path}\n    Branch: ${wt.branch}\n    Expected: Status should be '${WU_STATUS.IN_PROGRESS}' for active worktrees`,
    );
  }

  // Check lane consistency
  const laneName = branchValidation.lane;
  const wuLane = wu.lane;
  if (wuLane && laneName && laneName !== wuLane.toLowerCase()) {
    warnings.push(
      `Lane mismatch: Branch lane '${laneName}' doesn't match WU lane '${wuLane}'\n    Worktree: ${wt.path}\n    WU: ${wuid}`,
    );
  }

  return { valid: true, warnings, errors };
}

async function main() {
  const args = parseArgs(process.argv);
  const PREFIX = LOG_PREFIX.PRUNE;

  if (args.help) {
    console.log(`
WU Prune Utility - Maintain worktree hygiene

Usage:
  pnpm wu:prune           # Dry-run mode (default, shows issues but doesn't change anything)
  pnpm wu:prune --execute # Execute cleanup (runs git worktree prune)

This tool:
  ${EMOJI.SUCCESS} Runs 'git worktree prune' to clean stale worktree metadata
  ${EMOJI.SUCCESS} Detects orphan directories (exist on disk but not tracked by git)
  ${EMOJI.SUCCESS} Validates worktree to WU to lane mappings
  ${EMOJI.SUCCESS} Warns on orphaned worktrees (no matching WU YAML)
  ${EMOJI.SUCCESS} Warns on stale worktrees (WU status is 'done' or 'blocked')
  ${EMOJI.SUCCESS} Warns on invalid branch naming (not lane/<lane>/<wu-id>)
  ${EMOJI.SUCCESS} Safe to run regularly (doesn't break active work)
`);
    process.exit(EXIT_CODES.SUCCESS);
  }

  console.log(`${PREFIX} Worktree Hygiene Check`);
  console.log(`${PREFIX} =====================\n`);

  const missingTracked = await detectMissingTrackedWorktrees(process.cwd());
  if (missingTracked.length > 0) {
    console.warn(`${PREFIX} ${EMOJI.WARNING} ${WORKTREE_WARNINGS.MISSING_TRACKED_HEADER}`);
    for (const missingPath of missingTracked) {
      console.warn(`${PREFIX} ${WORKTREE_WARNINGS.MISSING_TRACKED_LINE(missingPath)}`);
    }
    console.warn('');
  }

  if (args.dryRun) {
    console.log(`${PREFIX} ${EMOJI.INFO} DRY-RUN MODE (use --execute to apply changes)\n`);
  }

  // Get all worktrees
  const worktrees = await listWorktrees();
  console.log(`${PREFIX} Found ${worktrees.length} tracked worktree(s)\n`);

  let totalWarnings = 0;
  let totalErrors = 0;
  let orphansRemoved = 0;

  // Layer 2: Detect orphan directories (WU-1476)
  console.log(`${PREFIX} Checking for orphan directories...`);
  const orphanResult = await detectOrphanWorktrees(process.cwd());

  if (orphanResult.errors.length > 0) {
    console.log(`${PREFIX} ${EMOJI.WARNING} Orphan detection errors:`);
    orphanResult.errors.forEach((e) => console.log(`    ${e}`));
    totalErrors += orphanResult.errors.length;
  }

  if (orphanResult.orphans.length > 0) {
    console.log(
      `${PREFIX} ${EMOJI.WARNING} Found ${orphanResult.orphans.length} orphan director${orphanResult.orphans.length === 1 ? 'y' : 'ies'} (not tracked by git):`,
    );
    for (const orphanPath of orphanResult.orphans) {
      console.log(`    - ${orphanPath}`);
      if (!args.dryRun) {
        const removeResult = await removeOrphanDirectory(orphanPath);
        if (removeResult.removed) {
          console.log(`      ${EMOJI.SUCCESS} Removed`);
          orphansRemoved++;
        } else if (removeResult.error) {
          console.log(`      ${EMOJI.FAILURE} Failed: ${removeResult.error}`);
          totalErrors++;
        }
      }
    }
    if (args.dryRun && orphanResult.orphans.length > 0) {
      console.log(`${PREFIX} (use --execute to remove orphan directories)`);
    }
  } else {
    console.log(`${PREFIX} ${EMOJI.SUCCESS} No orphan directories found`);
  }

  console.log('');

  // Validate each tracked worktree
  for (const wt of worktrees) {
    const { warnings, errors } = await validateWorktree(wt);

    if (warnings.length > 0) {
      console.log(`${PREFIX} ${EMOJI.WARNING} Warnings for ${wt.path}:`);
      warnings.forEach((w) => console.log(`    ${w}\n`));
      totalWarnings += warnings.length;
    }

    if (errors.length > 0) {
      console.log(`${PREFIX} ${EMOJI.FAILURE} Errors for ${wt.path}:`);
      errors.forEach((e) => console.log(`    ${e}\n`));
      totalErrors += errors.length;
    }
  }

  // Run git worktree prune
  console.log(`${PREFIX} Running git worktree prune...`);
  if (args.dryRun) {
    console.log(`${PREFIX} (skipped in dry-run mode)`);
  } else {
    try {
      const output = await getGitForCwd().raw(['worktree', 'prune', '-v']);
      if (output) {
        console.log(output);
      } else {
        console.log(`${PREFIX} ${EMOJI.SUCCESS} No stale worktree metadata to prune`);
      }
    } catch (e) {
      console.error(`${PREFIX} ${EMOJI.WARNING} Failed to run git worktree prune: ${e.message}`);
    }
  }

  // Summary
  console.log(`\n${PREFIX} Summary`);
  console.log(`${PREFIX} ========`);
  console.log(`${PREFIX} Tracked worktrees: ${worktrees.length}`);
  console.log(`${PREFIX} Orphan directories: ${orphanResult.orphans.length}`);
  if (!args.dryRun && orphansRemoved > 0) {
    console.log(`${PREFIX} Orphans removed: ${orphansRemoved}`);
  }
  console.log(`${PREFIX} Warnings: ${totalWarnings}`);
  console.log(`${PREFIX} Errors: ${totalErrors}`);

  if (totalWarnings > 0 || totalErrors > 0 || orphanResult.orphans.length > 0) {
    console.log(`\n${PREFIX} ${EMOJI.INFO} Recommendations:`);
    if (orphanResult.orphans.length > 0 && args.dryRun) {
      console.log(`${PREFIX}    - Run 'pnpm wu:prune --execute' to remove orphan directories`);
    }
    if (totalErrors > 0) {
      console.log(`${PREFIX}    - Fix errors above (orphaned/invalid worktrees)`);
      console.log(`${PREFIX}    - Remove orphaned worktrees: git worktree remove <path>`);
    }
    if (totalWarnings > 0) {
      console.log(`${PREFIX}    - Review warnings and clean up stale worktrees`);
      console.log(`${PREFIX}    - For done WUs: Use pnpm wu:done to clean up properly`);
      console.log(`${PREFIX}    - For blocked WUs: Use pnpm wu:block to clean up if not resuming`);
    }
  } else {
    console.log(`\n${PREFIX} ${EMOJI.SUCCESS} All worktrees are valid and up-to-date!`);
  }

  if (args.dryRun) {
    console.log(`\n${PREFIX} ${EMOJI.INFO} This was a dry-run. Use --execute to apply changes.`);
  }

  process.exit(totalErrors > 0 ? EXIT_CODES.ERROR : EXIT_CODES.SUCCESS);
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}
