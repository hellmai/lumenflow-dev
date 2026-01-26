/**
 * @file sync-templates.ts
 * Sync internal docs to CLI templates for release-cycle maintenance (WU-1123)
 *
 * This script syncs source docs from the hellmai/os repo to the templates
 * directory, applying template variable substitutions:
 * - Onboarding docs -> templates/core/ai/onboarding/
 * - Claude skills -> templates/vendors/claude/.claude/skills/
 * - Core docs (LUMENFLOW.md, constraints.md) -> templates/core/
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createWUParser } from '@lumenflow/core';

// Template variable patterns
const DATE_PATTERN = /\d{4}-\d{2}-\d{2}/g;

export interface SyncResult {
  synced: string[];
  errors: string[];
}

export interface SyncSummary {
  onboarding: SyncResult;
  skills: SyncResult;
  core: SyncResult;
}

/**
 * CLI option definitions for sync-templates command
 */
const SYNC_TEMPLATES_OPTIONS = {
  dryRun: {
    name: 'dry-run',
    flags: '--dry-run',
    description: 'Show what would be synced without writing files',
    default: false,
  },
  verbose: {
    name: 'verbose',
    flags: '--verbose',
    description: 'Show detailed output',
    default: false,
  },
};

/**
 * Parse sync-templates command options
 */
export function parseSyncTemplatesOptions(): {
  dryRun: boolean;
  verbose: boolean;
} {
  const opts = createWUParser({
    name: 'sync-templates',
    description: 'Sync internal docs to CLI templates for release-cycle maintenance',
    options: Object.values(SYNC_TEMPLATES_OPTIONS),
  });

  return {
    dryRun: opts['dry-run'] ?? false,
    verbose: opts.verbose ?? false,
  };
}

/**
 * Convert source content to template format by replacing:
 * - YYYY-MM-DD dates with {{DATE}}
 * - Absolute project paths with {{PROJECT_ROOT}}
 */
export function convertToTemplate(content: string, projectRoot: string): string {
  let output = content;

  // Replace dates with {{DATE}}
  output = output.replace(DATE_PATTERN, '{{DATE}}');

  // Replace absolute project paths with {{PROJECT_ROOT}}
  // Escape special regex characters in the path
  const escapedPath = projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pathPattern = new RegExp(escapedPath, 'g');
  output = output.replace(pathPattern, '{{PROJECT_ROOT}}');

  return output;
}

/**
 * Get the templates directory path
 */
function getTemplatesDir(projectRoot: string): string {
  return path.join(projectRoot, 'packages', '@lumenflow', 'cli', 'templates');
}

/**
 * Ensure directory exists
 */
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Sync a single file to templates
 */
function syncFile(
  sourcePath: string,
  targetPath: string,
  projectRoot: string,
  result: SyncResult,
  dryRun: boolean = false,
): void {
  try {
    if (!fs.existsSync(sourcePath)) {
      result.errors.push(`Source not found: ${sourcePath}`);
      return;
    }

    const content = fs.readFileSync(sourcePath, 'utf-8');
    const templateContent = convertToTemplate(content, projectRoot);

    if (!dryRun) {
      ensureDir(path.dirname(targetPath));
      fs.writeFileSync(targetPath, templateContent);
    }

    result.synced.push(path.relative(projectRoot, targetPath));
  } catch (error) {
    result.errors.push(`Error syncing ${sourcePath}: ${(error as Error).message}`);
  }
}

/**
 * Sync onboarding docs to templates/core/ai/onboarding/
 */
export async function syncOnboardingDocs(
  projectRoot: string,
  dryRun: boolean = false,
): Promise<SyncResult> {
  const result: SyncResult = { synced: [], errors: [] };

  const sourceDir = path.join(
    projectRoot,
    'docs',
    '04-operations',
    '_frameworks',
    'lumenflow',
    'agent',
    'onboarding',
  );
  const targetDir = path.join(getTemplatesDir(projectRoot), 'core', 'ai', 'onboarding');

  if (!fs.existsSync(sourceDir)) {
    result.errors.push(`Onboarding source directory not found: ${sourceDir}`);
    return result;
  }

  const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith('.md'));

  for (const file of files) {
    const sourcePath = path.join(sourceDir, file);
    const targetPath = path.join(targetDir, `${file}.template`);
    syncFile(sourcePath, targetPath, projectRoot, result, dryRun);
  }

  return result;
}

/**
 * Sync Claude skills to templates/vendors/claude/.claude/skills/
 */
export async function syncSkillsToTemplates(
  projectRoot: string,
  dryRun: boolean = false,
): Promise<SyncResult> {
  const result: SyncResult = { synced: [], errors: [] };

  const sourceDir = path.join(projectRoot, '.claude', 'skills');
  const targetDir = path.join(
    getTemplatesDir(projectRoot),
    'vendors',
    'claude',
    '.claude',
    'skills',
  );

  if (!fs.existsSync(sourceDir)) {
    result.errors.push(`Skills source directory not found: ${sourceDir}`);
    return result;
  }

  // Get all skill directories
  const skillDirs = fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const skillName of skillDirs) {
    const skillSourceDir = path.join(sourceDir, skillName);
    const skillTargetDir = path.join(targetDir, skillName);

    // Look for SKILL.md file
    const skillFile = path.join(skillSourceDir, 'SKILL.md');
    if (fs.existsSync(skillFile)) {
      const targetPath = path.join(skillTargetDir, 'SKILL.md.template');
      syncFile(skillFile, targetPath, projectRoot, result, dryRun);
    }
  }

  return result;
}

/**
 * Sync core docs (LUMENFLOW.md, constraints.md) to templates/core/
 */
export async function syncCoreDocs(
  projectRoot: string,
  dryRun: boolean = false,
): Promise<SyncResult> {
  const result: SyncResult = { synced: [], errors: [] };
  const templatesDir = getTemplatesDir(projectRoot);

  // Sync LUMENFLOW.md
  const lumenflowSource = path.join(projectRoot, 'LUMENFLOW.md');
  const lumenflowTarget = path.join(templatesDir, 'core', 'LUMENFLOW.md.template');
  syncFile(lumenflowSource, lumenflowTarget, projectRoot, result, dryRun);

  // Sync constraints.md
  const constraintsSource = path.join(projectRoot, '.lumenflow', 'constraints.md');
  const constraintsTarget = path.join(
    templatesDir,
    'core',
    '.lumenflow',
    'constraints.md.template',
  );
  syncFile(constraintsSource, constraintsTarget, projectRoot, result, dryRun);

  return result;
}

/**
 * Sync all templates
 */
export async function syncTemplates(
  projectRoot: string,
  dryRun: boolean = false,
): Promise<SyncSummary> {
  const onboarding = await syncOnboardingDocs(projectRoot, dryRun);
  const skills = await syncSkillsToTemplates(projectRoot, dryRun);
  const core = await syncCoreDocs(projectRoot, dryRun);

  return { onboarding, skills, core };
}

/**
 * CLI entry point
 */
export async function main(): Promise<void> {
  const opts = parseSyncTemplatesOptions();
  const projectRoot = process.cwd();

  console.log('[sync-templates] Syncing internal docs to CLI templates...');
  if (opts.dryRun) {
    console.log('  (dry-run mode - no files will be written)');
  }

  const result = await syncTemplates(projectRoot, opts.dryRun);

  // Print results
  const sections = [
    { name: 'Onboarding docs', data: result.onboarding },
    { name: 'Claude skills', data: result.skills },
    { name: 'Core docs', data: result.core },
  ];

  let totalSynced = 0;
  let totalErrors = 0;

  for (const section of sections) {
    if (section.data.synced.length > 0 || section.data.errors.length > 0) {
      console.log(`\n${section.name}:`);

      if (section.data.synced.length > 0) {
        section.data.synced.forEach((f) => console.log(`  + ${f}`));
        totalSynced += section.data.synced.length;
      }

      if (section.data.errors.length > 0) {
        section.data.errors.forEach((e) => console.log(`  ! ${e}`));
        totalErrors += section.data.errors.length;
      }
    }
  }

  console.log(`\n[sync-templates] Done! Synced ${totalSynced} files.`);

  if (totalErrors > 0) {
    console.log(`  ${totalErrors} error(s) occurred.`);
    process.exitCode = 1;
  }
}

// CLI entry point
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  runCLI(main);
}
