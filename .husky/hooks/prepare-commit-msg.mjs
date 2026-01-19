#!/usr/bin/env node
/**
 * prepare-commit-msg hook - Auto-inject WU ID prefix from lane branch
 *
 * WU-1017: Vendor-agnostic git workflow enforcement
 *
 * Rules:
 * - On lane branches: prepend wu(wu-xxxx): prefix if not present
 * - Skip for message/commit/merge sources (user provided message)
 * - Skip if message already starts with wu( prefix
 *
 * Escape hatch: LUMENFLOW_FORCE=1
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

// Escape hatch
if (process.env.LUMENFLOW_FORCE === '1') {
  process.exit(0);
}

// Get arguments: $1=file, $2=source, $3=commit SHA (for amend)
const [commitMsgFile, source, commitSha] = process.argv.slice(2);

if (!commitMsgFile) {
  process.exit(0);
}

// Skip if source is message, commit, or merge
// - message: git commit -m "..."
// - commit: git commit --amend or -c/-C
// - merge: merge commits
if (['message', 'commit', 'merge'].includes(source)) {
  process.exit(0);
}

// Get current branch
let branch;
try {
  branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
} catch {
  process.exit(0);
}

// Only process lane branches
const LANE_PREFIX = 'lane/';
if (!branch.startsWith(LANE_PREFIX)) {
  process.exit(0);
}

// Extract WU ID from branch: lane/core/wu-1017 -> wu-1017
const wuMatch = branch.match(/wu-\d+/i);
if (!wuMatch) {
  process.exit(0);
}

const wuId = wuMatch[0].toLowerCase(); // wu-1017

// Read current message
let message;
try {
  message = readFileSync(commitMsgFile, 'utf8');
} catch {
  process.exit(0);
}

// Skip if message already has wu( prefix (case-insensitive)
if (message.trim().toLowerCase().startsWith('wu(')) {
  process.exit(0);
}

// Skip if message starts with common conventional commit prefixes that include WU ID
const lowerMessage = message.trim().toLowerCase();
if (
  lowerMessage.includes(wuId) ||
  lowerMessage.startsWith('feat(') ||
  lowerMessage.startsWith('fix(') ||
  lowerMessage.startsWith('chore(') ||
  lowerMessage.startsWith('docs(') ||
  lowerMessage.startsWith('style(') ||
  lowerMessage.startsWith('refactor(') ||
  lowerMessage.startsWith('test(') ||
  lowerMessage.startsWith('ci(')
) {
  process.exit(0);
}

// Prepend wu(wu-xxxx): prefix
const prefix = `wu(${wuId}): `;
const newMessage = prefix + message;

try {
  writeFileSync(commitMsgFile, newMessage);
} catch {
  // Don't fail if we can't write
}

process.exit(0);
