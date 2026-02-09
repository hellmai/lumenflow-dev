#!/usr/bin/env node
/**
 * pre-push hook - Block direct push to main/master
 *
 * WU-1017: Vendor-agnostic git workflow enforcement
 * WU-1024: Allow CLI tool pushes from micro-worktrees (tmp/* branches)
 * WU-1070: Audit logging for LUMENFLOW_FORCE bypass
 *
 * Rules:
 * - BLOCK push to refs/heads/main or refs/heads/master
 * - ALLOW pushes from tmp/* branches (CLI micro-worktree operations)
 * - ALLOW all lane branch pushes (per WU-1255: protection at merge time)
 * - Parse stdin refs to catch bypasses like `git push origin HEAD:main`
 *
 * Escape hatch: LUMENFLOW_FORCE=1 (logged to .lumenflow/force-bypasses.log)
 */

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';

// WU-1070: Inline audit logging (fail-open, no external imports for hook reliability)
function logForceBypass(hookName, projectRoot) {
  if (process.env.LUMENFLOW_FORCE !== '1') return;

  const reason = process.env.LUMENFLOW_FORCE_REASON;
  if (!reason) {
    console.warn(
      `[${hookName}] Warning: LUMENFLOW_FORCE_REASON not set. ` +
        'Please provide a reason for the audit trail.',
    );
  }

  try {
    const timestamp = new Date().toISOString();
    let user = 'unknown';
    let branch = 'unknown';
    try {
      user = execSync('git config user.name', { encoding: 'utf8' }).trim();
    } catch {}
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    } catch {}

    const logLine = `${timestamp} | ${hookName} | ${user} | ${branch} | ${reason || '(no reason provided)'} | ${projectRoot}\n`;
    const lumenflowDir = join(projectRoot, '.lumenflow');
    const logPath = join(lumenflowDir, 'force-bypasses.log');

    if (!existsSync(lumenflowDir)) {
      mkdirSync(lumenflowDir, { recursive: true });
    }
    appendFileSync(logPath, logLine);
  } catch (error) {
    console.error(`[${hookName}] Warning: Failed to write audit log: ${error.message}`);
  }
}

// Find project root
let projectRoot = process.cwd();
for (let i = 0; i < 10; i++) {
  if (existsSync(join(projectRoot, '.lumenflow.config.yaml'))) break;
  const parent = dirname(projectRoot);
  if (parent === projectRoot) break;
  projectRoot = parent;
}

// Escape hatch with audit logging (WU-1070)
if (process.env.LUMENFLOW_FORCE === '1') {
  logForceBypass('pre-push', projectRoot);
  process.exit(0);
}

// Allow CLI micro-worktree pushes that originate from WU lifecycle automation
// WU-1245: Extended to include all micro-worktree operations (wu:delete, wu:claim, etc.)
// WU-1255: Extended to include initiative operations (initiative:create, initiative:edit)
const WU_TOOL_ENV = process.env.LUMENFLOW_WU_TOOL;
const ALLOWED_WU_TOOLS = new Set([
  'wu-create',
  'wu-edit',
  'wu-done',
  'wu-delete', // WU-1245: Safe WU deletion
  'wu-claim', // WU-1245: WU claiming with micro-worktree
  'wu-block', // WU-1245: WU blocking
  'wu-unblock', // WU-1245: WU unblocking
  'wu-repair', // WU-1418: WU consistency repair with micro-worktree
  'wu-admin-repair', // WU-1418: WU admin repair with micro-worktree
  'initiative-create', // WU-1255: Initiative creation with micro-worktree
  'initiative-edit', // WU-1255: Initiative editing with micro-worktree
  'release', // WU-1296: npm release with micro-worktree isolation
]);
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
    console.error('To fix workflow state:');
    console.error('  pnpm wu:recover --id WU-XXXX');
    console.error('');
    process.exit(1);
  }
}

// All other pushes (lane branches, etc): ALLOW
// Per WU-1255: Lane branches can be pushed regardless of status
// Protection happens at merge-to-main time via wu:done
process.exit(0);
