// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file init-detection.ts
 * Detection helpers for LumenFlow init command (WU-1644)
 *
 * Extracted from init.ts -- environment detection, prerequisite checks,
 * git state inspection, and docs structure detection.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  LUMENFLOW_CLIENT_IDS,
  getDocsLayoutPreset,
  type DocsLayoutPreset,
  type DocsLayoutType,
} from '@lumenflow/core';

/**
 * Detected IDE type from environment
 * WU-1177: Auto-detection support
 */
export type DetectedIDE = 'claude' | 'cursor' | 'windsurf' | 'vscode' | undefined;

/**
 * WU-1177: Prerequisite check result
 */
export interface PrerequisiteResult {
  passed: boolean;
  version: string;
  required: string;
  message?: string;
}

/**
 * WU-1177: All prerequisite results
 */
export interface PrerequisiteResults {
  node: PrerequisiteResult;
  pnpm: PrerequisiteResult;
  git: PrerequisiteResult;
}

/** WU-1300: Docs structure type for scaffolding */
export type DocsStructureType = DocsLayoutType;

/** WU-1309: Docs paths for different structure types */
export type DocsPathConfig = DocsLayoutPreset;

/**
 * WU-1364: Detect git state and return config overrides
 * Returns requireRemote: false if no origin remote is configured
 */
export interface GitStateConfig {
  requireRemote: boolean;
}

const DEFAULT_CLIENT_CLAUDE = LUMENFLOW_CLIENT_IDS.CLAUDE_CODE;

export type DefaultClient = typeof DEFAULT_CLIENT_CLAUDE | 'none';

/**
 * WU-1177: Detect IDE environment from environment variables
 * Auto-detects which AI coding assistant is running
 */
export function detectIDEEnvironment(): DetectedIDE {
  // Claude Code detection (highest priority - most specific)
  if (process.env.CLAUDE_PROJECT_DIR || process.env.CLAUDE_CODE) {
    return 'claude';
  }

  // Cursor detection
  const cursorVars = Object.keys(process.env).filter((key) => key.startsWith('CURSOR_'));
  if (cursorVars.length > 0) {
    return 'cursor';
  }

  // Windsurf detection
  const windsurfVars = Object.keys(process.env).filter((key) => key.startsWith('WINDSURF_'));
  if (windsurfVars.length > 0) {
    return 'windsurf';
  }

  // VS Code detection (lowest priority - most generic)
  const vscodeVars = Object.keys(process.env).filter((key) => key.startsWith('VSCODE_'));
  if (vscodeVars.length > 0) {
    return 'vscode';
  }

  return undefined;
}

/**
 * Get command version safely using execFileSync
 */
function getCommandVersion(command: string, args: string[]): string {
  try {
    const output = execFileSync(command, args, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return output;
  } catch {
    return 'not found';
  }
}

/**
 * Parse semver version string to compare
 */
function parseVersion(versionStr: string): number[] {
  // WU-1968: Removed ^ anchor so "git version 2.43.0" is parsed correctly.
  // The previous ^v? pattern required the string to start with a digit or "v",
  // but `git --version` returns "git version X.Y.Z" which starts with "git".
  // eslint-disable-next-line security/detect-unsafe-regex -- static semver pattern; no backtracking risk
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(versionStr);
  if (!match) {
    return [0, 0, 0];
  }
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3] || '0', 10)];
}

/**
 * Compare versions: returns true if actual >= required
 */
function compareVersions(actual: string, required: string): boolean {
  const actualParts = parseVersion(actual);
  const requiredParts = parseVersion(required);

  for (let i = 0; i < 3; i++) {
    if (actualParts[i] > requiredParts[i]) {
      return true;
    }
    if (actualParts[i] < requiredParts[i]) {
      return false;
    }
  }
  return true;
}

/**
 * WU-1177: Check prerequisite versions
 * Non-blocking - returns results but doesn't fail init
 */
export function checkPrerequisites(): PrerequisiteResults {
  const nodeVersion = getCommandVersion('node', ['--version']);
  const pnpmVersion = getCommandVersion('pnpm', ['--version']);
  const gitVersion = getCommandVersion('git', ['--version']);

  const requiredNode = '22.0.0';
  const requiredPnpm = '9.0.0';
  const requiredGit = '2.0.0';

  const nodeOk = nodeVersion !== 'not found' && compareVersions(nodeVersion, requiredNode);
  const pnpmOk = pnpmVersion !== 'not found' && compareVersions(pnpmVersion, requiredPnpm);
  const gitOk = gitVersion !== 'not found' && compareVersions(gitVersion, requiredGit);

  return {
    node: {
      passed: nodeOk,
      version: nodeVersion,
      required: `>=${requiredNode}`,
      message: nodeOk ? undefined : `Node.js ${requiredNode}+ required`,
    },
    pnpm: {
      passed: pnpmOk,
      version: pnpmVersion,
      required: `>=${requiredPnpm}`,
      message: pnpmOk ? undefined : `pnpm ${requiredPnpm}+ required`,
    },
    git: {
      passed: gitOk,
      version: gitVersion,
      required: `>=${requiredGit}`,
      message: gitOk ? undefined : `Git ${requiredGit}+ required`,
    },
  };
}

/**
 * WU-1309: Get docs paths based on structure type
 */
export function getDocsPath(structure: DocsStructureType): DocsPathConfig {
  return getDocsLayoutPreset(structure);
}

/**
 * WU-1309: Detect existing docs structure or return default
 * Auto-detects arc42 when docs/04-operations or UnsafeAny numbered dir (01-*, 02-*, etc.) exists
 */
export function detectDocsStructure(targetDir: string): DocsStructureType {
  const docsDir = path.join(targetDir, 'docs');

  if (!fs.existsSync(docsDir)) {
    return 'simple';
  }

  // Check for arc42 numbered directories (01-*, 02-*, ..., 04-operations, etc.)
  const entries = fs.readdirSync(docsDir);
  const hasNumberedDir = entries.some((entry) => /^\d{2}-/.test(entry));

  if (hasNumberedDir) {
    return 'arc42';
  }

  return 'simple';
}

/**
 * Detect default client from environment
 */
export function detectDefaultClient(): DefaultClient {
  if (process.env.CLAUDE_PROJECT_DIR || process.env.CLAUDE_CODE) {
    return DEFAULT_CLIENT_CLAUDE;
  }
  return 'none';
}

/**
 * WU-1364: Check if directory is a git repository
 */
export function isGitRepo(targetDir: string): boolean {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: targetDir,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * WU-1364: Check if git repo has UnsafeAny commits
 */
export function hasGitCommits(targetDir: string): boolean {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: targetDir,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * WU-1364: Check if git repo has an origin remote
 */
export function hasOriginRemote(targetDir: string): boolean {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    const result = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: targetDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * WU-1364: Detect git state and return config overrides
 * Returns requireRemote: false if no origin remote is configured
 */
export function detectGitStateConfig(targetDir: string): GitStateConfig | null {
  // If not a git repo, default to local-only mode for safety
  if (!isGitRepo(targetDir)) {
    return { requireRemote: false };
  }

  // If git repo but no origin remote, set requireRemote: false
  if (!hasOriginRemote(targetDir)) {
    return { requireRemote: false };
  }

  // Has origin remote - use default (requireRemote: true)
  return null;
}
