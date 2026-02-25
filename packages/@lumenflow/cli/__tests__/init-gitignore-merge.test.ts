/**
 * @file init-gitignore-merge.test.ts
 * Test suite for WU-1969: Fix gitignore merge path missing runtime state exclusions
 * Extended by WU-2180: Fix gitignore scaffold drift (missing ephemeral path entries)
 *
 * Verifies:
 * 1. requiredExclusions array includes all entries from GITIGNORE_TEMPLATE
 * 2. Running init with existing .gitignore produces same exclusions as fresh init
 * 3. Exclusion list is defined once (shared constant) to prevent future drift
 * 4. (WU-2180) Source .gitignore ephemeral paths stay aligned with REQUIRED_GITIGNORE_EXCLUSIONS
 * 5. (WU-2180) lumenflow init --skip appends missing ephemeral entries
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

  describe('WU-2180: ephemeral path entries (checkpoints, locks, artifacts, spawn-registry)', () => {
    /**
     * WU-2180 AC1: REQUIRED_GITIGNORE_EXCLUSIONS includes all .lumenflow/* ephemeral paths
     * from the source .gitignore.
     *
     * The 4 missing ephemeral paths discovered on lumenflow-cloud:
     * - .lumenflow/checkpoints/
     * - .lumenflow/locks/
     * - .lumenflow/artifacts/
     * - .lumenflow/state/spawn-registry.jsonl
     */
    it('should include checkpoints, locks, artifacts, and spawn-registry ephemeral paths', async () => {
      const templates = await import('../src/init-templates.js');
      const { REQUIRED_GITIGNORE_EXCLUSIONS } = templates;

      const patterns = REQUIRED_GITIGNORE_EXCLUSIONS.map((e: { pattern: string }) => e.pattern);

      expect(patterns).toContain('.lumenflow/checkpoints/');
      expect(patterns).toContain('.lumenflow/locks/');
      expect(patterns).toContain('.lumenflow/artifacts/');
      expect(patterns).toContain('.lumenflow/state/spawn-registry.jsonl');
    });

    /**
     * WU-2180 AC2: GITIGNORE_TEMPLATE includes the same entries.
     */
    it('should include ephemeral paths in GITIGNORE_TEMPLATE', async () => {
      const templates = await import('../src/init-templates.js');
      const { GITIGNORE_TEMPLATE } = templates;

      expect(GITIGNORE_TEMPLATE).toContain('.lumenflow/checkpoints/');
      expect(GITIGNORE_TEMPLATE).toContain('.lumenflow/locks/');
      expect(GITIGNORE_TEMPLATE).toContain('.lumenflow/artifacts/');
      expect(GITIGNORE_TEMPLATE).toContain('.lumenflow/state/spawn-registry.jsonl');
    });

    /**
     * WU-2180 AC3: Sync test asserting source .gitignore and
     * REQUIRED_GITIGNORE_EXCLUSIONS stay aligned.
     *
     * Extracts all .lumenflow/* entries from the repo .gitignore and verifies
     * each has a matching pattern in REQUIRED_GITIGNORE_EXCLUSIONS.
     */
    it('should stay aligned with source .gitignore ephemeral entries', async () => {
      const templates = await import('../src/init-templates.js');
      const { REQUIRED_GITIGNORE_EXCLUSIONS } = templates;

      // Read the source repo .gitignore (the canonical truth)
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
      const sourceGitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf-8');

      // Extract all .lumenflow/* directory/file entries from source .gitignore.
      // We look for lines matching /.lumenflow/<path> or **/.lumenflow/<path>
      // and normalize them to just .lumenflow/<path>.
      const lumenflowEntries = new Set<string>();
      for (const rawLine of sourceGitignore.split('\n')) {
        const line = rawLine.trim();
        if (line.startsWith('#') || line === '') continue;

        // Normalize: remove leading /, remove leading **/
        let normalized = line;
        if (normalized.startsWith('/')) normalized = normalized.slice(1);
        if (normalized.startsWith('**/')) normalized = normalized.slice(3);

        if (normalized.startsWith('.lumenflow/')) {
          // Skip state-level globs like .lumenflow/state/*.backup* that are
          // too specific for consumer repos. Also skip files that are tracked
          // state (wu-events.jsonl) and non-directory entries that are specific
          // to this repo's internal state management (delegation-registry, etc.).
          // We only care about the ephemeral DIRECTORY paths and key ephemeral
          // files that any consumer repo would generate.
          const EXCLUDED_FROM_SYNC = new Set([
            '.lumenflow/state/*.backup*',
            '.lumenflow/state/delegation-registry.jsonl',
            '.lumenflow/state/.delegation-cutover-done',
            '.lumenflow/state/archive/',
            '.lumenflow/skip-gates-audit.log',
            '.lumenflow/force-bypasses.log',
            '.lumenflow/flow.log',
            '.lumenflow/archive/',
          ]);

          if (!EXCLUDED_FROM_SYNC.has(normalized)) {
            lumenflowEntries.add(normalized);
          }
        }
      }

      const requiredPatterns = REQUIRED_GITIGNORE_EXCLUSIONS.map(
        (e: { pattern: string }) => e.pattern,
      );

      // Every ephemeral .lumenflow/* entry from source .gitignore must have
      // a matching pattern in REQUIRED_GITIGNORE_EXCLUSIONS
      for (const entry of lumenflowEntries) {
        const hasMatch = requiredPatterns.some(
          (p: string) => entry.includes(p) || p.includes(entry.replace(/\/$/, '')),
        );
        expect(
          hasMatch,
          `Source .gitignore entry "${entry}" not covered by REQUIRED_GITIGNORE_EXCLUSIONS`,
        ).toBe(true);
      }
    });

    /**
     * WU-2180 AC4: lumenflow init --skip on a repo missing these entries appends them.
     */
    it('should append missing ephemeral entries when running init in skip mode', async () => {
      const { scaffoldProject } = await import('../src/init.js');

      // Create a .gitignore with only basic entries (missing the ephemeral paths)
      const gitignorePath = path.join(tempDir, '.gitignore');
      fs.writeFileSync(gitignorePath, '# Dependencies\nnode_modules/\n.lumenflow/telemetry/\n');

      // Run init in skip mode -- should append missing entries
      await scaffoldProject(tempDir, { ...baseOptions });

      const content = fs.readFileSync(gitignorePath, 'utf-8');

      // The 4 ephemeral paths should now be present
      expect(content).toContain('.lumenflow/checkpoints/');
      expect(content).toContain('.lumenflow/locks/');
      expect(content).toContain('.lumenflow/artifacts/');
      expect(content).toContain('.lumenflow/state/spawn-registry.jsonl');
    });
  });
});
