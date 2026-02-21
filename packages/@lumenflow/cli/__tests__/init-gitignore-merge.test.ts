/**
 * @file init-gitignore-merge.test.ts
 * Test suite for WU-1969: Fix gitignore merge path missing runtime state exclusions
 *
 * Verifies:
 * 1. requiredExclusions array includes all entries from GITIGNORE_TEMPLATE
 * 2. Running init with existing .gitignore produces same exclusions as fresh init
 * 3. Exclusion list is defined once (shared constant) to prevent future drift
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('WU-1969: gitignore merge path completeness', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-gitignore-merge-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const baseOptions = {
    force: false,
    full: false,
    framework: undefined,
    defaultClient: 'none',
    docsStructure: 'arc42',
  } as const;

  describe('shared constant (REQUIRED_GITIGNORE_EXCLUSIONS)', () => {
    it('should be exported from init-templates', async () => {
      const templates = await import('../src/init-templates.js');
      expect(templates.REQUIRED_GITIGNORE_EXCLUSIONS).toBeDefined();
      expect(Array.isArray(templates.REQUIRED_GITIGNORE_EXCLUSIONS)).toBe(true);
    });

    it('should include all LumenFlow-specific entries from GITIGNORE_TEMPLATE', async () => {
      const templates = await import('../src/init-templates.js');
      const { REQUIRED_GITIGNORE_EXCLUSIONS, GITIGNORE_TEMPLATE } = templates;

      // Every entry in the shared constant must appear in the template
      for (const { pattern } of REQUIRED_GITIGNORE_EXCLUSIONS) {
        expect(GITIGNORE_TEMPLATE).toContain(pattern);
      }
    });

    it('should include runtime state exclusions that were previously missing', async () => {
      const templates = await import('../src/init-templates.js');
      const { REQUIRED_GITIGNORE_EXCLUSIONS } = templates;

      const patterns = REQUIRED_GITIGNORE_EXCLUSIONS.map((e: { pattern: string }) => e.pattern);

      // These were in GITIGNORE_TEMPLATE but missing from the old requiredExclusions
      expect(patterns).toContain('.lumenflow/flow.log');
      expect(patterns).toContain('.lumenflow/commands.log');
      expect(patterns).toContain('.lumenflow/sessions/');
      expect(patterns).toContain('.lumenflow/memory/');
      expect(patterns).toContain('.logs/');
    });

    it('should include the original 3 exclusions too', async () => {
      const templates = await import('../src/init-templates.js');
      const { REQUIRED_GITIGNORE_EXCLUSIONS } = templates;

      const patterns = REQUIRED_GITIGNORE_EXCLUSIONS.map((e: { pattern: string }) => e.pattern);

      expect(patterns).toContain('node_modules');
      expect(patterns).toContain('.lumenflow/telemetry');
      expect(patterns).toContain('worktrees');
    });
  });

  describe('merge path produces same exclusions as fresh init', () => {
    it('should add all required exclusions to an existing .gitignore', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      const templates = await import('../src/init-templates.js');

      // Create a pre-existing .gitignore with unrelated content
      const gitignorePath = path.join(tempDir, '.gitignore');
      fs.writeFileSync(gitignorePath, '# My project\n*.pyc\n__pycache__/\n');

      // Run init in default (skip) mode -- triggers the merge path
      await scaffoldProject(tempDir, { ...baseOptions });

      const mergedContent = fs.readFileSync(gitignorePath, 'utf-8');

      // Every required exclusion must be present in the merged result
      for (const { pattern } of templates.REQUIRED_GITIGNORE_EXCLUSIONS) {
        expect(mergedContent).toContain(pattern);
      }
    });

    it('should produce the same LumenFlow exclusions as a fresh init', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      const templates = await import('../src/init-templates.js');

      // Fresh init: no existing .gitignore
      const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-fresh-'));
      try {
        await scaffoldProject(freshDir, { ...baseOptions });
        const freshContent = fs.readFileSync(path.join(freshDir, '.gitignore'), 'utf-8');

        // Merge init: existing .gitignore
        const gitignorePath = path.join(tempDir, '.gitignore');
        fs.writeFileSync(gitignorePath, '# Existing project\n');
        await scaffoldProject(tempDir, { ...baseOptions });
        const mergedContent = fs.readFileSync(gitignorePath, 'utf-8');

        // All required exclusions present in fresh should also be in merged
        for (const { pattern } of templates.REQUIRED_GITIGNORE_EXCLUSIONS) {
          expect(freshContent).toContain(pattern);
          expect(mergedContent).toContain(pattern);
        }
      } finally {
        fs.rmSync(freshDir, { recursive: true, force: true });
      }
    });

    it('should not duplicate entries already present in existing .gitignore', async () => {
      const { scaffoldProject } = await import('../src/init.js');

      // Pre-existing .gitignore with node_modules already present
      const gitignorePath = path.join(tempDir, '.gitignore');
      fs.writeFileSync(gitignorePath, '# Dependencies\nnode_modules/\n');

      await scaffoldProject(tempDir, { ...baseOptions });

      const content = fs.readFileSync(gitignorePath, 'utf-8');

      // Count occurrences of 'node_modules' - should appear only once (the original)
      const matches = content.match(/node_modules/g);
      expect(matches).toHaveLength(1);
    });
  });
});
