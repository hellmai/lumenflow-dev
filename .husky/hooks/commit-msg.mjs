#!/usr/bin/env node
/**
 * commit-msg hook - Validate commit message format
 *
 * WU-1017: Vendor-agnostic git workflow enforcement
 * WU-1070: Audit logging for LUMENFLOW_FORCE bypass
 *
 * Rules:
 * - On main/master: Only allow specific LumenFlow commit formats
 * - On lane branches: Require WU ID in message
 *
 * Escape hatch: LUMENFLOW_FORCE=1 (logged to .lumenflow/force-bypasses.log)
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
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
  logForceBypass('commit-msg', projectRoot);
  process.exit(0);
}

// Get commit message file path from args
const commitMsgFile = process.argv[2];
if (!commitMsgFile) {
  console.error('commit-msg: No message file provided');
  process.exit(1);
}

// Read commit message
let message;
try {
  message = readFileSync(commitMsgFile, 'utf8').trim();
} catch {
  console.error('commit-msg: Cannot read message file');
  process.exit(1);
}

// Get first line (subject) for validation
const subject = message.split('\n')[0].trim();

// Get current branch
let branch;
try {
  branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
} catch {
  process.exit(0);
}

// Constants
const MAIN_BRANCHES = ['main', 'master'];
const LANE_PREFIX = 'lane/';

/**
 * Allowed commit message patterns on main branch
 * Derived from COMMIT_FORMATS in wu-constants.ts
 */
const ALLOWED_ON_MAIN = [
  // wu:claim - wu(wu-123): claim for core lane
  /^wu\(wu-\d+\): claim for .+ lane$/i,

  // wu:done - wu(wu-123): done - title here
  /^wu\(wu-\d+\): done - .+$/i,

  // wu:create - docs: create wu-123 for title
  /^docs: create wu-\d+ for .+$/i,

  // wu:edit (ready WUs) - docs: edit wu-123 spec
  /^docs: edit wu-\d+ spec$/i,

  // wu:edit (in_progress) - wu(wu-123): spec update
  /^wu\(wu-\d+\): spec update$/i,

  // wu:block - wu(wu-123): block
  /^wu\(wu-\d+\): block$/i,

  // wu:unblock - wu(wu-123): unblock
  /^wu\(wu-\d+\): unblock$/i,

  // wu:repair - fix(wu-123): repair state inconsistency
  /^fix\(wu-\d+\): repair .+$/i,

  // Backlog repair - chore(repair): repair backlog duplicates for wu-123
  /^chore\(repair\): .+$/i,

  // Rebase cleanup - chore(wu-123): remove rebased completion artifacts
  /^chore\(wu-\d+\): .+$/i,

  // Style commits (formatting) - style: fix formatting
  /^style: .+$/i,

  // Merge commits
  /^Merge /i,

  // WU-1076: Emergency/hotfix commits (human override for agents)
  /\[emergency\]/i,
  /\[hotfix\]/i,
];

// Validate on main/master
if (MAIN_BRANCHES.includes(branch)) {
  const isAllowed = ALLOWED_ON_MAIN.some((pattern) => pattern.test(subject));

  if (!isAllowed) {
    console.error('');
    console.error('BLOCKED: Invalid commit message format on', branch);
    console.error('');
    console.error('Your message:');
    console.error(`  ${subject}`);
    console.error('');
    console.error('Allowed formats on main:');
    console.error('  wu(wu-123): claim for <lane> lane');
    console.error('  wu(wu-123): done - <title>');
    console.error('  docs: create wu-123 for <title>');
    console.error('  docs: edit wu-123 spec');
    console.error('  wu(wu-123): spec update');
    console.error('  wu(wu-123): block');
    console.error('  wu(wu-123): unblock');
    console.error('  fix(wu-123): repair <description>');
    console.error('  chore(repair): <description>');
    console.error('  chore(wu-123): <description>');
    console.error('  style: <description>');
    console.error('  [emergency] <description>');
    console.error('  [hotfix] <description>');
    console.error('');
    console.error('Use pnpm wu:* commands to create properly formatted commits.');
    console.error('');
    console.error('To fix workflow state:');
    console.error('  pnpm wu:recover --id WU-XXXX');
    console.error('');
    process.exit(1);
  }

  process.exit(0);
}

// Validate on lane branches: must contain WU ID
if (branch.startsWith(LANE_PREFIX)) {
  // Extract WU ID from branch: lane/core/wu-1017 -> wu-1017
  const wuMatch = branch.match(/wu-\d+/i);

  if (wuMatch) {
    const wuId = wuMatch[0].toLowerCase(); // wu-1017

    // Check if message contains WU ID (case-insensitive)
    if (!message.toLowerCase().includes(wuId)) {
      console.error('');
      console.error('BLOCKED: Commit message must reference', wuId.toUpperCase());
      console.error('');
      console.error('Your message:');
      console.error(`  ${subject}`);
      console.error('');
      console.error('Tip: Use the conventional format:');
      console.error(`  wu(${wuId}): your message here`);
      console.error('');
      console.error('Or include the WU ID anywhere:');
      console.error(`  feat: add feature for ${wuId.toUpperCase()}`);
      console.error('');
      console.error('To fix workflow state:');
      console.error(`  pnpm wu:recover --id ${wuId.toUpperCase()}`);
      console.error('');
      process.exit(1);
    }
  }
}

// All other cases: ALLOW
process.exit(0);
