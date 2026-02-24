#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @file docs-sync.ts
 * LumenFlow docs:sync command for syncing agent docs to existing projects (WU-1083)
 * WU-1085: Added createWUParser for proper --help support
 * WU-1124: Refactored to read templates from bundled files (INIT-004 Phase 2)
 * WU-1362: Added branch guard to check branch before writing tracked files
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createWUParser,
  WU_OPTIONS,
  getDefaultConfig,
  createError,
  ErrorCodes,
} from '@lumenflow/core';
import { GIT_DIRECTORY_NAME, getConfig } from '@lumenflow/core/config';
// WU-1362: Import worktree guard utilities for branch checking
import { isMainBranch, isInWorktree } from '@lumenflow/core/core/worktree-guard';

export type VendorType = 'claude' | 'cursor' | 'aider' | 'all' | 'none';

/**
 * WU-1085: CLI option definitions for docs-sync command
 */
const DOCS_SYNC_OPTIONS = {
  vendor: {
    name: 'vendor',
    flags: '--vendor <type>',
    description: 'Vendor type (claude, cursor, aider, all, none)',
    default: 'claude',
  },
  force: WU_OPTIONS.force,
};

/**
 * WU-1085: Parse docs-sync command options using createWUParser
 * Provides proper --help, --version, and option parsing
 */
export function parseDocsSyncOptions(): {
  force: boolean;
  vendor: VendorType;
} {
  const opts = createWUParser({
    name: 'lumenflow-docs-sync',
    description:
      'Sync agent onboarding docs to existing projects (skips existing files by default)',
    options: Object.values(DOCS_SYNC_OPTIONS),
  });

  return {
    force: opts.force ?? false,
    vendor: (opts.vendor as VendorType) ?? 'claude',
  };
}

export interface SyncOptions {
  force: boolean;
  vendor?: VendorType;
}

export interface SyncResult {
  created: string[];
  skipped: string[];
  /** WU-1362: Warnings from branch guard or other checks */
  warnings?: string[];
}

function resolveDocsSyncDirectories(targetDir: string): {
  onboardingDir: string;
  skillsDir: string;
} {
  try {
    const config = getConfig({ projectRoot: targetDir, reload: true });
    return {
      onboardingDir: path.join(targetDir, config.directories.onboardingDir),
      skillsDir: path.join(targetDir, config.directories.skillsDir),
    };
  } catch {
    const defaults = getDefaultConfig();
    return {
      onboardingDir: path.join(targetDir, defaults.directories.onboardingDir),
      skillsDir: path.join(targetDir, defaults.directories.skillsDir),
    };
  }
}

/**
 * WU-1124: Get the templates directory path
 * Templates are bundled with the CLI package at dist/templates/
 * Falls back to src/templates/ for development
 */
export function getTemplatesDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // In production: dist/docs-sync.js -> templates/
  // In development: src/docs-sync.ts -> ../templates/
  const distTemplates = path.join(__dirname, '..', 'templates');
  if (fs.existsSync(distTemplates)) {
    return distTemplates;
  }

  // Fallback for tests running from src
  const srcTemplates = path.join(__dirname, '..', 'templates');
  if (fs.existsSync(srcTemplates)) {
    return srcTemplates;
  }

  throw createError(ErrorCodes.FILE_NOT_FOUND, `Templates directory not found at ${distTemplates}`);
}

/**
 * WU-1124: Load a template file from the bundled templates directory
 * @param templatePath - Relative path from templates directory (e.g., 'core/ai/onboarding/quick-ref-commands.md.template')
 * @returns Template content as string
 */
export function loadTemplate(templatePath: string): string {
  const templatesDir = getTemplatesDir();
  const fullPath = path.join(templatesDir, templatePath);

  if (!fs.existsSync(fullPath)) {
    throw createError(
      ErrorCodes.FILE_NOT_FOUND,
      `Template not found: ${templatePath} (looked at ${fullPath})`,
    );
  }

  return fs.readFileSync(fullPath, 'utf-8');
}

/**
 * Get current date in YYYY-MM-DD format
 */
function getCurrentDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Process template content by replacing placeholders
 */
function processTemplate(content: string, tokens: Record<string, string>): string {
  let output = content;
  for (const [key, value] of Object.entries(tokens)) {
    // eslint-disable-next-line security/detect-non-literal-regexp -- key is from internal token map, not user input
    output = output.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return output;
}

function getRelativePath(targetDir: string, filePath: string): string {
  return path.relative(targetDir, filePath).split(path.sep).join('/');
}

/**
 * Create a directory if missing
 */
async function createDirectory(
  dirPath: string,
  result: SyncResult,
  targetDir: string,
): Promise<void> {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    result.created.push(getRelativePath(targetDir, dirPath));
  }
}

/**
 * Create a file, respecting force option
 */
async function createFile(
  filePath: string,
  content: string,
  force: boolean,
  result: SyncResult,
  targetDir: string,
): Promise<void> {
  const relativePath = getRelativePath(targetDir, filePath);

  if (fs.existsSync(filePath) && !force) {
    result.skipped.push(relativePath);
    return;
  }

  const parentDir = path.dirname(filePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  fs.writeFileSync(filePath, content);
  result.created.push(relativePath);
}

/**
 * WU-1124: Template paths for agent onboarding docs
 * Maps output file names to template paths
 */
const ONBOARDING_TEMPLATE_PATHS: Record<string, string> = {
  'quick-ref-commands.md': 'core/ai/onboarding/quick-ref-commands.md.template',
  'first-wu-mistakes.md': 'core/ai/onboarding/first-wu-mistakes.md.template',
  'troubleshooting-wu-done.md': 'core/ai/onboarding/troubleshooting-wu-done.md.template',
  'agent-safety-card.md': 'core/ai/onboarding/agent-safety-card.md.template',
  'wu-create-checklist.md': 'core/ai/onboarding/wu-create-checklist.md.template',
};

const CLAUDE_VENDOR_TEMPLATE_ROOT = ['vendors', 'claude', '.claude'].join('/');
const CLAUDE_SKILLS_TEMPLATE_ROOT = `${CLAUDE_VENDOR_TEMPLATE_ROOT}/skills`;

/**
 * WU-1124: Template paths for Claude skills
 * Maps skill names to template paths
 */
const SKILL_TEMPLATE_PATHS: Record<string, string> = {
  'wu-lifecycle': `${CLAUDE_SKILLS_TEMPLATE_ROOT}/wu-lifecycle/SKILL.md.template`,
  'worktree-discipline': `${CLAUDE_SKILLS_TEMPLATE_ROOT}/worktree-discipline/SKILL.md.template`,
  'lumenflow-gates': `${CLAUDE_SKILLS_TEMPLATE_ROOT}/lumenflow-gates/SKILL.md.template`,
};

/**
 * Sync agent onboarding docs to an existing project
 * WU-1124: Now reads templates from bundled files instead of hardcoded strings
 */
export async function syncAgentDocs(targetDir: string, options: SyncOptions): Promise<SyncResult> {
  const result: SyncResult = {
    created: [],
    skipped: [],
  };

  const tokens = {
    DATE: getCurrentDate(),
  };

  const { onboardingDir } = resolveDocsSyncDirectories(targetDir);

  await createDirectory(onboardingDir, result, targetDir);

  // WU-1124: Load and process templates from bundled files
  for (const [outputFile, templatePath] of Object.entries(ONBOARDING_TEMPLATE_PATHS)) {
    const templateContent = loadTemplate(templatePath);
    const processedContent = processTemplate(templateContent, tokens);

    await createFile(
      path.join(onboardingDir, outputFile),
      processedContent,
      options.force,
      result,
      targetDir,
    );
  }

  return result;
}

/**
 * Sync Claude skills to an existing project
 * WU-1124: Now reads templates from bundled files instead of hardcoded strings
 */
export async function syncSkills(targetDir: string, options: SyncOptions): Promise<SyncResult> {
  const result: SyncResult = {
    created: [],
    skipped: [],
  };

  const vendor = options.vendor ?? 'none';
  if (vendor !== 'claude' && vendor !== 'all') {
    return result;
  }

  const tokens = {
    DATE: getCurrentDate(),
  };

  const { skillsDir } = resolveDocsSyncDirectories(targetDir);

  // WU-1124: Load and process skill templates from bundled files
  for (const [skillName, templatePath] of Object.entries(SKILL_TEMPLATE_PATHS)) {
    const skillDir = path.join(skillsDir, skillName);
    await createDirectory(skillDir, result, targetDir);

    const templateContent = loadTemplate(templatePath);
    const processedContent = processTemplate(templateContent, tokens);

    await createFile(
      path.join(skillDir, 'SKILL.md'),
      processedContent,
      options.force,
      result,
      targetDir,
    );
  }

  return result;
}

/**
 * WU-1362: Check branch guard before writing tracked files
 *
 * Warns (but does not block) if:
 * - On main branch AND
 * - Not in a worktree directory AND
 * - Git repository exists (has .git)
 *
 * @param targetDir - Directory where files will be written
 * @returns Array of warning messages
 */
async function checkBranchGuard(targetDir: string): Promise<string[]> {
  const warnings: string[] = [];

  // Only check if target is a git repository
  const gitDir = path.join(targetDir, GIT_DIRECTORY_NAME);
  if (!fs.existsSync(gitDir)) {
    return warnings;
  }

  // Check if we're in a worktree (always allow)
  if (isInWorktree({ cwd: targetDir })) {
    return warnings;
  }

  // Check if on main branch
  try {
    const onMain = await isMainBranch();
    if (onMain) {
      warnings.push(
        'Running docs:sync on main branch in main checkout. ' +
          'Consider using a worktree for changes to tracked files.',
      );
    }
  } catch {
    // Git error - silently allow
  }

  return warnings;
}

/**
 * CLI entry point for docs:sync command
 * WU-1085: Updated to use parseDocsSyncOptions for proper --help support
 * WU-1362: Added branch guard check
 */
export async function main(): Promise<void> {
  const opts = parseDocsSyncOptions();
  const targetDir = process.cwd();

  console.log('[lumenflow docs:sync] Syncing agent documentation...');
  console.log(`  Vendor: ${opts.vendor}`);
  console.log(`  Force: ${opts.force}`);

  // WU-1362: Check branch guard before writing files
  const branchWarnings = await checkBranchGuard(targetDir);

  const docsResult = await syncAgentDocs(targetDir, { force: opts.force });
  const skillsResult = await syncSkills(targetDir, { force: opts.force, vendor: opts.vendor });

  const created = [...docsResult.created, ...skillsResult.created];
  const skipped = [...docsResult.skipped, ...skillsResult.skipped];
  const warnings = [...branchWarnings];

  if (created.length > 0) {
    console.log('\nCreated:');
    created.forEach((f) => console.log(`  + ${f}`));
  }

  if (skipped.length > 0) {
    console.log('\nSkipped (already exists, use --force to overwrite):');
    skipped.forEach((f) => console.log(`  - ${f}`));
  }

  if (warnings.length > 0) {
    console.log('\nWarnings:');
    warnings.forEach((w) => console.log(`  ! ${w}`));
  }

  console.log('\n[lumenflow docs:sync] Done!');
}

// CLI entry point (WU-1071 pattern: import.meta.main)
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}
