#!/usr/bin/env node

// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Break-Glass WU Stamp Tool
 *
 * Standalone WU finalization tool that works WITHOUT any built dist.
 * Uses ONLY Node.js built-in modules (fs, path, child_process).
 *
 * PURPOSE: When CLI dist is broken (e.g., committed symlinks pointing nowhere),
 * agents cannot run wu:done to complete the WU that fixes the CLI. This tool
 * breaks the chicken-and-egg cycle by creating the stamp and event directly,
 * then committing via micro-worktree pattern.
 *
 * USAGE:
 *   node scripts/wu-stamp.mjs --id WU-XXXX --title "WU title here"
 *
 * WHAT IT DOES:
 *   1. Creates .lumenflow/stamps/WU-XXXX.done (stamp file)
 *   2. Appends completion event to .lumenflow/state/wu-events.jsonl
 *   3. Commits atomically via micro-worktree pattern (temp branch -> push -> cleanup)
 *
 * IDEMPOTENT: Safe to re-run. Skips stamp if it exists, skips event if already logged.
 *
 * SECURITY NOTE: All execSync calls use either string literals or WU IDs validated
 * against /^WU-\d+$/ (digits only). No user-controlled free-text reaches shell commands.
 * This script intentionally avoids project imports (the whole point is zero dist dependency).
 *
 * WU-2212: Initial implementation
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAMPS_DIR = '.lumenflow/stamps';
const EVENTS_FILE = '.lumenflow/state/wu-events.jsonl';
const TEMP_BRANCH_PREFIX = 'tmp/wu-stamp';
const REMOTE = 'origin';
const BRANCH = 'main';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a git command synchronously, returning trimmed stdout.
 *
 * Security: args array is joined with spaces. All callers pass either
 * string literals or validated WU IDs (digits-only after "WU-" prefix).
 *
 * @param {string[]} args - git subcommand and arguments
 * @param {object} [opts] - extra execSync options (cwd, env, etc.)
 * @returns {string} trimmed stdout
 */
function git(args, opts = {}) {
  const cmd = `git ${args.join(' ')}`;
  return execSync(cmd, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...opts,
  }).trim();
}

/**
 * Run a git command, returning { ok, stdout, stderr }.
 * Never throws.
 */
function gitSafe(args, opts = {}) {
  const cmd = `git ${args.join(' ')}`;
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...opts,
    }).trim();
    return { ok: true, stdout, stderr: '' };
  } catch (err) {
    return {
      ok: false,
      stdout: (err.stdout || '').toString().trim(),
      stderr: (err.stderr || '').toString().trim(),
    };
  }
}

/** Today as YYYY-MM-DD */
function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Current ISO timestamp */
function nowISO() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Argument parsing (zero deps)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { id: null, title: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--id' && argv[i + 1]) {
      args.id = argv[++i];
    } else if (argv[i] === '--title' && argv[i + 1]) {
      args.title = argv[++i];
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`Usage: node scripts/wu-stamp.mjs --id WU-XXXX --title "Title"

BREAK-GLASS ONLY -- Use pnpm wu:done for normal WU completion.

Options:
  --id      WU identifier (e.g., WU-2212)   [required]
  --title   WU title for stamp file          [required]
  --help    Show this help message`);
      process.exit(0);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Stamp creation
// ---------------------------------------------------------------------------

/**
 * Create .lumenflow/stamps/WU-XXXX.done
 * Returns { created: boolean, path: string }
 */
function createStamp(projectRoot, id, title) {
  const stampsDir = join(projectRoot, STAMPS_DIR);
  const stampPath = join(stampsDir, `${id}.done`);

  if (existsSync(stampPath)) {
    return { created: false, path: stampPath };
  }

  if (!existsSync(stampsDir)) {
    mkdirSync(stampsDir, { recursive: true });
  }

  // Match format from packages/@lumenflow/core/src/stamp-utils.ts STAMP_TEMPLATE
  // Format: "WU WU-XXXX \u2014 Title\nCompleted: YYYY-MM-DD\n"
  const body = `WU ${id} \u2014 ${title}\nCompleted: ${todayISO()}\n`;
  writeFileSync(stampPath, body, { encoding: 'utf-8' });

  return { created: true, path: stampPath };
}

// ---------------------------------------------------------------------------
// Event append
// ---------------------------------------------------------------------------

/**
 * Append completion event to wu-events.jsonl
 * Returns { appended: boolean }
 */
function appendEvent(projectRoot, id) {
  const eventsPath = join(projectRoot, EVENTS_FILE);

  // Check for existing completion event (idempotent)
  if (existsSync(eventsPath)) {
    const content = readFileSync(eventsPath, { encoding: 'utf-8' });
    // Search for a "complete" event for this WU ID
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.trim() === '') continue;
      try {
        const evt = JSON.parse(line);
        if (evt.type === 'complete' && evt.wuId === id) {
          return { appended: false };
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  // Ensure directory exists
  const eventsDir = join(projectRoot, '.lumenflow/state');
  if (!existsSync(eventsDir)) {
    mkdirSync(eventsDir, { recursive: true });
  }

  // Match event format from existing wu-events.jsonl
  const event = { type: 'complete', wuId: id, timestamp: nowISO() };
  appendFileSync(eventsPath, JSON.stringify(event) + '\n', { encoding: 'utf-8' });

  return { appended: true };
}

// ---------------------------------------------------------------------------
// Micro-worktree commit + push
// ---------------------------------------------------------------------------

/**
 * Commit stamp + event via micro-worktree pattern:
 *   1. Fetch origin/main
 *   2. Create temp branch from origin/main
 *   3. Create micro-worktree in /tmp
 *   4. Copy stamp + events into worktree, commit
 *   5. Push temp branch -> origin/main (refspec)
 *   6. Fast-forward local main
 *   7. Cleanup
 */
function commitViaMicroWorktree(projectRoot, id, files) {
  const tempBranch = `${TEMP_BRANCH_PREFIX}/${id.toLowerCase()}`;
  let microWorktreePath = null;

  try {
    // Step 1: Fetch latest origin/main
    console.log('[wu-stamp] Fetching origin/main...');
    git(['fetch', REMOTE, BRANCH], { cwd: projectRoot });

    // Step 2: Create temp branch from origin/main (no checkout switch)
    console.log(`[wu-stamp] Creating temp branch: ${tempBranch}`);
    // Clean up stale temp branch if it exists (from prior interrupted run)
    const branchCheck = gitSafe(['branch', '--list', tempBranch], { cwd: projectRoot });
    if (branchCheck.ok && branchCheck.stdout.trim() !== '') {
      git(['branch', '-D', tempBranch], { cwd: projectRoot });
    }
    git(['branch', '--no-track', tempBranch, `${REMOTE}/${BRANCH}`], { cwd: projectRoot });

    // Step 3: Create micro-worktree in /tmp
    microWorktreePath = execSync('mktemp -d /tmp/wu-stamp-XXXXXX', {
      encoding: 'utf-8',
    }).trim();
    console.log(`[wu-stamp] Micro-worktree: ${microWorktreePath}`);
    git(['worktree', 'add', microWorktreePath, tempBranch], { cwd: projectRoot });

    // Step 4: Copy changed files into worktree and commit
    for (const relPath of files) {
      const src = join(projectRoot, relPath);
      const dst = join(microWorktreePath, relPath);
      // Ensure destination directory exists
      const dstDir = join(microWorktreePath, relPath, '..');
      mkdirSync(resolve(dstDir), { recursive: true });
      // Copy file content
      const content = readFileSync(src, { encoding: 'utf-8' });
      writeFileSync(dst, content, { encoding: 'utf-8' });
    }

    git(['add', ...files], { cwd: microWorktreePath });

    const commitMsg = `wu(${id.toLowerCase()}): done - break-glass stamp (scripts/wu-stamp.mjs)`;
    git(['commit', '-m', commitMsg], {
      cwd: microWorktreePath,
      env: {
        ...process.env,
        LUMENFLOW_FORCE: '1',
        LUMENFLOW_FORCE_REASON: `break-glass wu-stamp for ${id}`,
        LUMENFLOW_WU_TOOL: 'wu-stamp',
      },
    });
    console.log(`[wu-stamp] Committed: ${commitMsg}`);

    // Step 5: Push temp branch -> origin/main via refspec
    console.log('[wu-stamp] Pushing to origin/main...');
    git(['push', REMOTE, `${tempBranch}:${BRANCH}`], {
      cwd: microWorktreePath,
      env: {
        ...process.env,
        LUMENFLOW_FORCE: '1',
        LUMENFLOW_FORCE_REASON: `break-glass wu-stamp for ${id}`,
        LUMENFLOW_WU_TOOL: 'wu-stamp',
      },
    });
    console.log('[wu-stamp] Pushed to origin/main');

    // Step 6: Fast-forward local main
    console.log('[wu-stamp] Fast-forwarding local main...');
    git(['fetch', REMOTE, BRANCH], { cwd: projectRoot });
    gitSafe(['merge', '--ff-only', `${REMOTE}/${BRANCH}`], { cwd: projectRoot });

    console.log('[wu-stamp] Local main updated');
  } finally {
    // Step 7: Cleanup (always runs)
    if (microWorktreePath) {
      console.log('[wu-stamp] Cleaning up micro-worktree...');
      gitSafe(['worktree', 'remove', '--force', microWorktreePath], { cwd: projectRoot });
    }
    // Remove temp branch (ignore errors)
    gitSafe(['branch', '-D', tempBranch], { cwd: projectRoot });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  // -----------------------------------------------------------------------
  // Break-glass warning
  // -----------------------------------------------------------------------
  console.log('');
  console.log('='.repeat(72));
  console.log('  BREAK-GLASS TOOL -- FOR EMERGENCY USE ONLY');
  console.log('');
  console.log('  This tool bypasses the normal wu:done pipeline.');
  console.log('  Use ONLY when CLI dist is broken and wu:done cannot run.');
  console.log('  For normal WU completion, use: pnpm wu:done --id WU-XXXX');
  console.log('='.repeat(72));
  console.log('');

  // -----------------------------------------------------------------------
  // Parse and validate args
  // -----------------------------------------------------------------------
  const args = parseArgs(process.argv);

  if (!args.id) {
    console.error('ERROR: --id is required (e.g., --id WU-2212)');
    process.exit(1);
  }
  if (!args.title) {
    console.error('ERROR: --title is required (e.g., --title "Fix broken dist")');
    process.exit(1);
  }
  if (!/^WU-\d+$/.test(args.id)) {
    console.error(`ERROR: Invalid WU ID format: ${args.id} (expected WU-XXXX)`);
    process.exit(1);
  }

  // Resolve project root (script lives at <root>/scripts/wu-stamp.mjs)
  const projectRoot = resolve(join(import.meta.dirname, '..'));

  console.log(`[wu-stamp] Project root: ${projectRoot}`);
  console.log(`[wu-stamp] WU ID: ${args.id}`);
  console.log(`[wu-stamp] Title: ${args.title}`);
  console.log('');

  // -----------------------------------------------------------------------
  // Step 1: Create stamp file
  // -----------------------------------------------------------------------
  const stampResult = createStamp(projectRoot, args.id, args.title);
  if (stampResult.created) {
    console.log(`[wu-stamp] Created stamp: ${stampResult.path}`);
  } else {
    console.log(`[wu-stamp] Stamp already exists (idempotent skip): ${stampResult.path}`);
  }

  // -----------------------------------------------------------------------
  // Step 2: Append completion event
  // -----------------------------------------------------------------------
  const eventResult = appendEvent(projectRoot, args.id);
  if (eventResult.appended) {
    console.log(`[wu-stamp] Appended completion event to ${EVENTS_FILE}`);
  } else {
    console.log(`[wu-stamp] Completion event already exists (idempotent skip)`);
  }

  // -----------------------------------------------------------------------
  // Step 3: Commit and push via micro-worktree
  // -----------------------------------------------------------------------
  if (!stampResult.created && !eventResult.appended) {
    console.log('');
    console.log('[wu-stamp] Nothing to commit (all artifacts already exist).');
    console.log('[wu-stamp] Done.');
    process.exit(0);
  }

  // Collect files that were actually modified
  const filesToCommit = [];
  if (stampResult.created) {
    filesToCommit.push(`${STAMPS_DIR}/${args.id}.done`);
  }
  if (eventResult.appended) {
    filesToCommit.push(EVENTS_FILE);
  }

  console.log('');
  console.log('[wu-stamp] Committing via micro-worktree pattern...');
  commitViaMicroWorktree(projectRoot, args.id, filesToCommit);

  console.log('');
  console.log(`[wu-stamp] Done. ${args.id} has been stamped and pushed.`);
}

main();
