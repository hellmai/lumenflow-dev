/**
 * @file sync-templates.ts
 * Sync internal docs to CLI templates for release-cycle maintenance (WU-1123)
 *
 * WU-1368: Fixed two bugs:
 * 1. --check-drift flag now is truly read-only (compares without writing)
 * 2. sync:templates uses micro-worktree isolation for safe atomic commits
 *
 * This script syncs source docs from the hellmai/lumenflow repo to the templates
 * directory, applying template variable substitutions:
 * - Onboarding docs -> templates/core/ai/onboarding/
 * - Claude skills -> templates/vendors/claude/.claude/skills/
 * - Core docs (LUMENFLOW.md, constraints.md) -> templates/core/
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createWUParser, withMicroWorktree } from '@lumenflow/core';

// Directory name constants to avoid duplicate strings
const LUMENFLOW_DIR = '.lumenflow';
const CLAUDE_DIR = '.claude';
const SKILLS_DIR = 'skills';

// Template variable patterns
const DATE_PATTERN = /\d{4}-\d{2}-\d{2}/g;

// Log prefix for console output
const LOG_PREFIX = '[sync-templates]';

// Micro-worktree operation name
const OPERATION_NAME = 'sync-templates';

export interface SyncResult {
  synced: string[];
  errors: string[];
}

export interface SyncSummary {
  onboarding: SyncResult;
  skills: SyncResult;
  core: SyncResult;
}

export interface DriftResult {
  hasDrift: boolean;
  driftingFiles: string[];
  checkedFiles: string[];
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
  checkDrift: {
    name: 'check-drift',
    flags: '--check-drift',
    description: 'Check for template drift without syncing (CI mode)',
    default: false,
  },
};

/**
 * Parse sync-templates command options
 */
export function parseSyncTemplatesOptions(): {
  dryRun: boolean;
  verbose: boolean;
  checkDrift: boolean;
} {
  const opts = createWUParser({
    name: 'sync-templates',
    description: 'Sync internal docs to CLI templates for release-cycle maintenance',
    options: Object.values(SYNC_TEMPLATES_OPTIONS),
  });

  return {
    dryRun: opts['dry-run'] ?? false,
    verbose: opts.verbose ?? false,
    checkDrift: opts['check-drift'] ?? false,
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
  // eslint-disable-next-line security/detect-non-literal-regexp -- path is escaped for regex; not user input
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

  const sourceDir = path.join(projectRoot, CLAUDE_DIR, SKILLS_DIR);
  const targetDir = path.join(
    getTemplatesDir(projectRoot),
    'vendors',
    'claude',
    CLAUDE_DIR,
    SKILLS_DIR,
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
  const constraintsSource = path.join(projectRoot, LUMENFLOW_DIR, 'constraints.md');
  const constraintsTarget = path.join(
    templatesDir,
    'core',
    LUMENFLOW_DIR,
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
 * Compare source file content with template content (ignoring date placeholders)
 */
function compareContent(
  sourceContent: string,
  templateContent: string,
  projectRoot: string,
): boolean {
  // Convert source to template format for comparison
  const convertedSource = convertToTemplate(sourceContent, projectRoot);
  return convertedSource === templateContent;
}

/**
 * Check if a single template file is in sync with its source
 */
function checkFileDrift(
  sourcePath: string,
  templatePath: string,
  projectRoot: string,
): { isDrifting: boolean; relativePath: string } {
  const relativePath = path.relative(projectRoot, templatePath);

  if (!fs.existsSync(sourcePath)) {
    return { isDrifting: false, relativePath }; // Source doesn't exist, can't drift
  }

  if (!fs.existsSync(templatePath)) {
    return { isDrifting: true, relativePath }; // Template missing, definitely drifting
  }

  const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
  const templateContent = fs.readFileSync(templatePath, 'utf-8');

  const isDrifting = !compareContent(sourceContent, templateContent, projectRoot);
  return { isDrifting, relativePath };
}

/**
 * Check for template drift - compares source docs with templates (WU-1353)
 *
 * This function compares source documents with their template counterparts
 * to detect if templates have drifted out of sync. Used by CI to warn
 * when templates need to be re-synced.
 */

export async function checkTemplateDrift(projectRoot: string): Promise<DriftResult> {
  const driftingFiles: string[] = [];
  const checkedFiles: string[] = [];
  const templatesDir = getTemplatesDir(projectRoot);

  // Check core docs
  const coreChecks = [
    {
      source: path.join(projectRoot, 'LUMENFLOW.md'),
      template: path.join(templatesDir, 'core', 'LUMENFLOW.md.template'),
    },
    {
      source: path.join(projectRoot, LUMENFLOW_DIR, 'constraints.md'),
      template: path.join(templatesDir, 'core', LUMENFLOW_DIR, 'constraints.md.template'),
    },
  ];

  for (const check of coreChecks) {
    const result = checkFileDrift(check.source, check.template, projectRoot);
    checkedFiles.push(result.relativePath);
    if (result.isDrifting) {
      driftingFiles.push(result.relativePath);
    }
  }

  // Check onboarding docs
  const onboardingSourceDir = path.join(
    projectRoot,
    'docs',
    '04-operations',
    '_frameworks',
    'lumenflow',
    'agent',
    'onboarding',
  );
  const onboardingTargetDir = path.join(templatesDir, 'core', 'ai', 'onboarding');

  if (fs.existsSync(onboardingSourceDir)) {
    const files = fs.readdirSync(onboardingSourceDir).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      const sourcePath = path.join(onboardingSourceDir, file);
      const templatePath = path.join(onboardingTargetDir, `${file}.template`);
      const result = checkFileDrift(sourcePath, templatePath, projectRoot);
      checkedFiles.push(result.relativePath);
      if (result.isDrifting) {
        driftingFiles.push(result.relativePath);
      }
    }
  }

  // Check skills
  const skillsSourceDir = path.join(projectRoot, CLAUDE_DIR, SKILLS_DIR);
  const skillsTargetDir = path.join(templatesDir, 'vendors', 'claude', CLAUDE_DIR, SKILLS_DIR);

  if (fs.existsSync(skillsSourceDir)) {
    const skillDirs = fs
      .readdirSync(skillsSourceDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const skillName of skillDirs) {
      const skillFile = path.join(skillsSourceDir, skillName, 'SKILL.md');
      const templatePath = path.join(skillsTargetDir, skillName, 'SKILL.md.template');
      if (fs.existsSync(skillFile)) {
        const result = checkFileDrift(skillFile, templatePath, projectRoot);
        checkedFiles.push(result.relativePath);
        if (result.isDrifting) {
          driftingFiles.push(result.relativePath);
        }
      }
    }
  }

  return {
    hasDrift: driftingFiles.length > 0,
    driftingFiles,
    checkedFiles,
  };
}

/**
 * Sync a single file to templates within a worktree path
 *
 * WU-1368: Internal helper for micro-worktree sync operations.
 * Writes to worktreePath instead of projectRoot for isolation.
 */
function syncFileToWorktree(
  sourcePath: string,
  targetPath: string,
  projectRoot: string,
  result: SyncResult,
): void {
  try {
    if (!fs.existsSync(sourcePath)) {
      result.errors.push(`Source not found: ${sourcePath}`);
      return;
    }

    const content = fs.readFileSync(sourcePath, 'utf-8');
    const templateContent = convertToTemplate(content, projectRoot);

    ensureDir(path.dirname(targetPath));
    fs.writeFileSync(targetPath, templateContent);

    // Store relative path from project root (not worktree path)
    const relPath = targetPath.includes('templates/')
      ? targetPath.substring(targetPath.indexOf('packages/'))
      : path.basename(targetPath);
    result.synced.push(relPath);
  } catch (error) {
    result.errors.push(`Error syncing ${sourcePath}: ${(error as Error).message}`);
  }
}

/**
 * Sync templates using micro-worktree isolation (WU-1368)
 *
 * This function uses the micro-worktree pattern to atomically sync templates:
 * 1. Create temp branch in micro-worktree
 * 2. Sync all templates to micro-worktree
 * 3. Commit and push atomically
 * 4. Cleanup
 *
 * Benefits:
 * - Never modifies main checkout directly
 * - Atomic commit with all template changes
 * - Race-safe with other operations
 *
 * @param {string} projectRoot - Project root directory (source for templates)
 * @returns {Promise<SyncSummary>} Summary of synced files
 */
export async function syncTemplatesWithWorktree(projectRoot: string): Promise<SyncSummary> {
  // Generate unique operation ID using timestamp
  const operationId = `templates-${Date.now()}`;

  console.log(`${LOG_PREFIX} Using micro-worktree isolation for atomic sync...`);

  // Set env var for pre-push hook
  const previousWuTool = process.env.LUMENFLOW_WU_TOOL;
  process.env.LUMENFLOW_WU_TOOL = OPERATION_NAME;

  try {
    let syncResult: SyncSummary = {
      onboarding: { synced: [], errors: [] },
      skills: { synced: [], errors: [] },
      core: { synced: [], errors: [] },
    };

    await withMicroWorktree({
      operation: OPERATION_NAME,
      id: operationId,
      logPrefix: LOG_PREFIX,
      execute: async ({ worktreePath }) => {
        const templatesDir = path.join(worktreePath, 'packages', '@lumenflow', 'cli', 'templates');

        // Sync core docs
        const coreResult: SyncResult = { synced: [], errors: [] };
        const lumenflowSource = path.join(projectRoot, 'LUMENFLOW.md');
        const lumenflowTarget = path.join(templatesDir, 'core', 'LUMENFLOW.md.template');
        syncFileToWorktree(lumenflowSource, lumenflowTarget, projectRoot, coreResult);

        const constraintsSource = path.join(projectRoot, LUMENFLOW_DIR, 'constraints.md');
        const constraintsTarget = path.join(
          templatesDir,
          'core',
          LUMENFLOW_DIR,
          'constraints.md.template',
        );
        syncFileToWorktree(constraintsSource, constraintsTarget, projectRoot, coreResult);

        // Sync onboarding docs
        const onboardingResult: SyncResult = { synced: [], errors: [] };
        const onboardingSourceDir = path.join(
          projectRoot,
          'docs',
          '04-operations',
          '_frameworks',
          'lumenflow',
          'agent',
          'onboarding',
        );
        const onboardingTargetDir = path.join(templatesDir, 'core', 'ai', 'onboarding');

        if (fs.existsSync(onboardingSourceDir)) {
          const files = fs.readdirSync(onboardingSourceDir).filter((f) => f.endsWith('.md'));
          for (const file of files) {
            const sourcePath = path.join(onboardingSourceDir, file);
            const targetPath = path.join(onboardingTargetDir, `${file}.template`);
            syncFileToWorktree(sourcePath, targetPath, projectRoot, onboardingResult);
          }
        } else {
          onboardingResult.errors.push(
            `Onboarding source directory not found: ${onboardingSourceDir}`,
          );
        }

        // Sync skills
        const skillsResult: SyncResult = { synced: [], errors: [] };
        const skillsSourceDir = path.join(projectRoot, CLAUDE_DIR, SKILLS_DIR);
        const skillsTargetDir = path.join(
          templatesDir,
          'vendors',
          'claude',
          CLAUDE_DIR,
          SKILLS_DIR,
        );

        if (fs.existsSync(skillsSourceDir)) {
          const skillDirs = fs
            .readdirSync(skillsSourceDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);

          for (const skillName of skillDirs) {
            const skillFile = path.join(skillsSourceDir, skillName, 'SKILL.md');
            if (fs.existsSync(skillFile)) {
              const targetPath = path.join(skillsTargetDir, skillName, 'SKILL.md.template');
              syncFileToWorktree(skillFile, targetPath, projectRoot, skillsResult);
            }
          }
        } else {
          skillsResult.errors.push(`Skills source directory not found: ${skillsSourceDir}`);
        }

        syncResult = {
          onboarding: onboardingResult,
          skills: skillsResult,
          core: coreResult,
        };

        // Collect all synced files for commit
        const allSyncedFiles = [
          ...coreResult.synced,
          ...onboardingResult.synced,
          ...skillsResult.synced,
        ];

        const totalSynced = allSyncedFiles.length;
        const commitMessage = `chore(sync:templates): sync ${totalSynced} template files`;

        return {
          commitMessage,
          files: allSyncedFiles,
        };
      },
    });

    return syncResult;
  } finally {
    // Restore env var
    if (previousWuTool === undefined) {
      delete process.env.LUMENFLOW_WU_TOOL;
    } else {
      process.env.LUMENFLOW_WU_TOOL = previousWuTool;
    }
  }
}

/**
 * Print sync results summary
 */
function printSyncResults(result: SyncSummary): { totalSynced: number; totalErrors: number } {
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

  return { totalSynced, totalErrors };
}

/**
 * CLI entry point
 */

export async function main(): Promise<void> {
  const opts = parseSyncTemplatesOptions();
  const projectRoot = process.cwd();

  // Check-drift mode: verify templates match source without syncing (read-only)
  if (opts.checkDrift) {
    console.log(`${LOG_PREFIX} Checking for template drift...`);
    const drift = await checkTemplateDrift(projectRoot);

    if (opts.verbose) {
      console.log(`  Checked ${drift.checkedFiles.length} files`);
    }

    if (drift.hasDrift) {
      console.log(`\n${LOG_PREFIX} WARNING: Template drift detected!`);
      console.log('  The following templates are out of sync with their source:');
      for (const file of drift.driftingFiles) {
        console.log(`    - ${file}`);
      }
      console.log('\n  Run `pnpm sync:templates` to update templates.');
      process.exitCode = 1;
    } else {
      console.log(`${LOG_PREFIX} All templates are in sync.`);
    }
    return;
  }

  // Dry-run mode: show what would be synced without writing
  if (opts.dryRun) {
    console.log(`${LOG_PREFIX} Dry-run mode - showing what would be synced...`);
    const result = await syncTemplates(projectRoot, true);
    const { totalSynced, totalErrors } = printSyncResults(result);
    console.log(`\n${LOG_PREFIX} Dry run complete. Would sync ${totalSynced} files.`);
    if (totalErrors > 0) {
      console.log(`  ${totalErrors} error(s) would occur.`);
      process.exitCode = 1;
    }
    return;
  }

  // Sync mode: update templates using micro-worktree isolation (WU-1368)
  console.log(`${LOG_PREFIX} Syncing internal docs to CLI templates...`);

  const result = await syncTemplatesWithWorktree(projectRoot);
  const { totalSynced, totalErrors } = printSyncResults(result);

  console.log(`\n${LOG_PREFIX} Done! Synced ${totalSynced} files.`);

  if (totalErrors > 0) {
    console.log(`  ${totalErrors} error(s) occurred.`);
    process.exitCode = 1;
  }
}

// CLI entry point
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}
