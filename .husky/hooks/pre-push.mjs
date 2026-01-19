#!/usr/bin/env node
/**
 * pre-push hook - Block direct push to main/master
 *
 * WU-1017: Vendor-agnostic git workflow enforcement
 * WU-1024: Allow CLI tool pushes from micro-worktrees (tmp/* branches)
 *
 * Rules:
 * - BLOCK push to refs/heads/main or refs/heads/master
 * - ALLOW pushes from tmp/* branches (CLI micro-worktree operations)
 * - ALLOW all lane branch pushes (per WU-1255: protection at merge time)
 * - Parse stdin refs to catch bypasses like `git push origin HEAD:main`
 *
 * Escape hatch: LUMENFLOW_FORCE=1
 */

import { readFileSync } from 'node:fs';

// Escape hatch
if (process.env.LUMENFLOW_FORCE === '1') {
  process.exit(0);
}

// Allow wu:create / wu:edit pushes that originate from micro-worktree automation
const WU_TOOL_ENV = process.env.LUMENFLOW_WU_TOOL;
const ALLOWED_WU_TOOLS = new Set(['wu-create', 'wu-edit']);
if (WU_TOOL_ENV && ALLOWED_WU_TOOLS.has(WU_TOOL_ENV)) {
  process.exit(0);
}

// Protected branch refs
const PROTECTED = /^refs\/heads\/(main|master)$/;

// CLI micro-worktree temp branches (WU-1024)
// Pattern: tmp/wu-create/wu-xxx, tmp/wu-edit/wu-xxx, tmp/initiative-create/xxx, etc.
const CLI_TEMP_BRANCH = /^refs\/heads\/tmp\//;

// Pre-push receives refs via stdin: "<local ref> <local sha> <remote ref> <remote sha>"
let stdin;
try {
  stdin = readFileSync(0, 'utf8').trim();
} catch {
  // No stdin (dry run or error)
  process.exit(0);
}

if (!stdin) {
  // No refs being pushed
  process.exit(0);
}

// Check each ref being pushed
for (const line of stdin.split('\n')) {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 4) continue;

  const [localRef, localSha, remoteRef, remoteSha] = parts;

  // Block if pushing to protected branch
  if (PROTECTED.test(remoteRef)) {
    // WU-1024: Allow if the push is from a CLI micro-worktree temp branch
    // These are legitimate pushes from wu:create, wu:edit, wu:done, initiative:create, etc.
    if (CLI_TEMP_BRANCH.test(localRef)) {
      continue; // Allow this push
    }

    const branchName = remoteRef.replace('refs/heads/', '');

    console.error('');
    console.error('BLOCKED: Direct push to', branchName);
    console.error('');
    console.error('LumenFlow uses trunk-based development.');
    console.error('Changes reach main via the wu:done command.');
    console.error('');
    console.error('To complete work and merge:');
    console.error('  cd /path/to/repo');
    console.error('  pnpm wu:done --id WU-XXXX');
    console.error('');
    console.error('To bypass (emergency only):');
    console.error('  LUMENFLOW_FORCE=1 git push ...');
    console.error('');
    process.exit(1);
  }
}

// All other pushes (lane branches, etc): ALLOW
// Per WU-1255: Lane branches can be pushed regardless of status
// Protection happens at merge-to-main time via wu:done
process.exit(0);
