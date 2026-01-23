#!/usr/bin/env node
/**
 * pre-commit hook - Block direct commits to main/master
 *
 * WU-1017: Vendor-agnostic git workflow enforcement
 * WU-1070: Audit logging for LUMENFLOW_FORCE bypass
 *
 * Rules:
 * - BLOCK commits to main/master (use wu:claim workflow)
 * - ALLOW commits on lane branches (message validation in commit-msg)
 * - RESPECT Branch-Only mode (check claimed_mode in WU YAML)
 *
 * Escape hatch: LUMENFLOW_FORCE=1 (logged to .beacon/force-bypasses.log)
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// WU-1070: Inline audit logging (fail-open, no external imports for hook reliability)
function logForceBypass(hookName, projectRoot) {
  if (process.env.LUMENFLOW_FORCE !== '1') return;

  const reason = process.env.LUMENFLOW_FORCE_REASON;
  if (!reason) {
    console.warn(
      `[${hookName}] Warning: LUMENFLOW_FORCE_REASON not set. ` +
        'Consider: LUMENFLOW_FORCE_REASON="reason" LUMENFLOW_FORCE=1 git ...',
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
    const beaconDir = join(projectRoot, '.beacon');
    const logPath = join(beaconDir, 'force-bypasses.log');

    if (!existsSync(beaconDir)) {
      mkdirSync(beaconDir, { recursive: true });
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
  logForceBypass('pre-commit', projectRoot);
  process.exit(0);
}

// Get current branch
let branch;
try {
  branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
} catch {
  // Not in a git repo or detached HEAD
  process.exit(0);
}

// Constants (repo-relative to avoid bare specifier imports that fail in micro-worktrees)
const MAIN_BRANCHES = ['main', 'master'];
const LANE_PREFIX = 'lane/';

// Block commits to main/master
if (MAIN_BRANCHES.includes(branch)) {
  console.error('');
  console.error('BLOCKED: Direct commit to', branch);
  console.error('');
  console.error('LumenFlow requires work to happen on lane branches.');
  console.error('');
  console.error('To start work on a WU:');
  console.error('  pnpm wu:claim --id WU-XXXX --lane <Lane>');
  console.error('  cd worktrees/<lane>-wu-xxxx');
  console.error('');
  console.error('To bypass (emergency only):');
  console.error('  LUMENFLOW_FORCE=1 git commit ...');
  console.error('');
  process.exit(1);
}

// Check for lane branch in main worktree (should be in worktree unless Branch-Only)
if (branch.startsWith(LANE_PREFIX)) {
  // Extract WU ID from branch: lane/core/wu-1017 -> wu-1017
  const wuMatch = branch.match(/wu-\d+/i);
  if (wuMatch) {
    const wuId = wuMatch[0].toUpperCase(); // WU-1017

    // Find project root (look for .lumenflow.config.yaml)
    let projectRoot = process.cwd();
    for (let i = 0; i < 10; i++) {
      if (existsSync(join(projectRoot, '.lumenflow.config.yaml'))) {
        break;
      }
      const parent = dirname(projectRoot);
      if (parent === projectRoot) break;
      projectRoot = parent;
    }

    // Check if we're in the main worktree (not a worktree subdirectory)
    const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim();
    const isMainWorktree = gitDir === '.git';

    if (isMainWorktree) {
      // Check claimed_mode in WU YAML
      const wuPath = join(projectRoot, 'docs/04-operations/tasks/wu', `${wuId}.yaml`);

      if (existsSync(wuPath)) {
        try {
          const content = readFileSync(wuPath, 'utf8');
          // Simple YAML parsing for claimed_mode (avoid js-yaml dependency for speed)
          const modeMatch = content.match(/^claimed_mode:\s*(.+)$/m);
          const claimedMode = modeMatch ? modeMatch[1].trim() : null;

          if (claimedMode === 'branch-only') {
            // Branch-Only mode: ALLOW working on lane branch in main worktree
            process.exit(0);
          }

          // Worktree mode (default): should be working in worktree
          console.error('');
          console.error('BLOCKED: Lane branch work should be in worktree');
          console.error('');
          console.error(`You're on branch ${branch} but in the main checkout.`);
          console.error('');
          console.error('Option 1: Work in the worktree:');
          console.error(`  cd worktrees/*-${wuId.toLowerCase()}`);
          console.error('');
          console.error('Option 2: Reclaim with --branch-only:');
          console.error(`  pnpm wu:claim --id ${wuId} --lane <Lane> --branch-only`);
          console.error('');
          console.error('To bypass (emergency only):');
          console.error('  LUMENFLOW_FORCE=1 git commit ...');
          console.error('');
          process.exit(1);
        } catch {
          // Can't read/parse YAML, allow commit
        }
      }
    }
  }
}

// All other branches: ALLOW
process.exit(0);
