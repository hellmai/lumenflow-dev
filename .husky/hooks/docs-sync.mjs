#!/usr/bin/env node
/**
 * Pre-commit hook - Auto-regenerate documentation when source changes
 *
 * WU-1059: Prevents documentation drift by regenerating docs
 * when files that affect documentation are modified.
 *
 * Source files that trigger regeneration:
 * - packages/@lumenflow/core/src/arg-parser.ts (WU_OPTIONS)
 * - packages/@lumenflow/core/src/schemas/*.ts (Config schemas)
 * - tools/generate-cli-docs.ts (Generator itself)
 *
 * @module docs-sync
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Files that, when changed, require docs regeneration
const DOC_SOURCE_PATTERNS = [
  'packages/@lumenflow/core/src/arg-parser.ts',
  'packages/@lumenflow/core/src/schemas/',
  'tools/generate-cli-docs.ts',
];

// Output files to stage if regenerated
const DOC_OUTPUT_FILES = [
  'apps/docs/src/content/docs/reference/cli.mdx',
  'apps/docs/src/content/docs/reference/config.mdx',
];

/**
 * Check if any staged files match the doc source patterns
 */
function hasDocSourceChanges() {
  try {
    const staged = execSync('git diff --cached --name-only', {
      encoding: 'utf8',
    });
    const stagedFiles = staged.trim().split('\n').filter(Boolean);

    return stagedFiles.some((file) =>
      DOC_SOURCE_PATTERNS.some((pattern) => file === pattern || file.startsWith(pattern)),
    );
  } catch {
    return false;
  }
}

/**
 * Regenerate documentation
 */
function regenerateDocs() {
  try {
    console.log('[docs-sync] Source files changed, regenerating documentation...');
    execSync('pnpm docs:generate', {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    console.log('[docs-sync] Documentation regenerated successfully');
    return true;
  } catch (error) {
    console.error('[docs-sync] Failed to regenerate documentation:', error.message);
    return false;
  }
}

/**
 * Format regenerated doc files with Prettier
 */
function formatDocFiles() {
  const filesToFormat = DOC_OUTPUT_FILES.filter((f) => existsSync(f));
  if (filesToFormat.length > 0) {
    try {
      execSync(`pnpm prettier --write ${filesToFormat.join(' ')}`, {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      console.log('[docs-sync] Formatted documentation files');
    } catch (error) {
      console.error('[docs-sync] Failed to format doc files:', error.message);
    }
  }
}

/**
 * Stage regenerated doc files
 */
function stageDocFiles() {
  const filesToStage = DOC_OUTPUT_FILES.filter((f) => existsSync(f));
  if (filesToStage.length > 0) {
    try {
      execSync(`git add ${filesToStage.join(' ')}`, { encoding: 'utf8' });
      console.log('[docs-sync] Staged updated documentation files');
    } catch (error) {
      console.error('[docs-sync] Failed to stage doc files:', error.message);
    }
  }
}

// Main execution
if (hasDocSourceChanges()) {
  if (regenerateDocs()) {
    formatDocFiles();
    stageDocFiles();
  }
}

process.exit(0);
