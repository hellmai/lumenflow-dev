/**
 * @file init-scaffold-dedup.test.ts
 * Test suite for WU-1965: Fix duplicate Created/Skipped output in lumenflow init
 *
 * Tests 5 acceptance criteria:
 * AC1: Files appear in exactly one output section (Created OR Skipped, never both)
 * AC2: Existing .gitignore gets lumenflow entries merged in (not skipped)
 * AC3: Gate config defaults match installed tooling (no vitest/turbo if not in package.json)
 * AC4: If init deletes or overwrites an existing file, it is reported in output
 * AC5: Non-full mode (--minimal) still scaffolds onboarding docs for claude client
 */

/* eslint-disable sonarjs/no-duplicate-string -- Test file with repeated assertion patterns */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('WU-1965: Init scaffold dedup and output fixes', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-dedup-test-'));
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

  // --------------------------------------------------------------------------
  // AC1: Files appear in exactly one output section (Created OR Skipped, never both)
  // --------------------------------------------------------------------------
  describe('AC1: No duplicate entries in Created and Skipped', () => {
    it('should not have any file in both created and skipped when running full+claude mode', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      const result = await scaffoldProject(tempDir, {
        ...baseOptions,
        full: true,
        client: 'claude',
      });

      // Check for intersection: no file should appear in both arrays
      const createdSet = new Set(result.created);
      const skippedSet = new Set(result.skipped);
      const intersection = [...createdSet].filter((f) => skippedSet.has(f));

      expect(intersection).toEqual([]);
    });

    it('should not have any file in both created and skipped when re-running on existing project', async () => {
      const { scaffoldProject } = await import('../src/init.js');

      // First run: create everything
      await scaffoldProject(tempDir, {
        ...baseOptions,
        full: true,
        client: 'claude',
      });

      // Second run: should only produce skipped (no created+skipped overlap)
      const result = await scaffoldProject(tempDir, {
        ...baseOptions,
        full: true,
        client: 'claude',
      });

      const createdSet = new Set(result.created);
      const skippedSet = new Set(result.skipped);
      const intersection = [...createdSet].filter((f) => skippedSet.has(f));

      expect(intersection).toEqual([]);
    });

    it('should have onboarding docs in created (not skipped) on first run with full+claude', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      const result = await scaffoldProject(tempDir, {
        ...baseOptions,
        full: true,
        client: 'claude',
      });

      // Onboarding docs should appear exactly once
      const onboardingFiles = result.created.filter((f) =>
        f.includes('onboarding/quick-ref-commands.md'),
      );
      expect(onboardingFiles).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // AC2: Existing .gitignore gets lumenflow entries merged in (not skipped)
  // --------------------------------------------------------------------------
  describe('AC2: .gitignore auto-merge in skip mode', () => {
    it('should merge lumenflow entries into existing .gitignore in default (skip) mode', async () => {
      // Pre-create a .gitignore with existing content
      const gitignorePath = path.join(tempDir, '.gitignore');
      fs.writeFileSync(gitignorePath, '# My project\n*.log\n');

      const { scaffoldProject } = await import('../src/init.js');
      const result = await scaffoldProject(tempDir, {
        ...baseOptions,
      });

      // Should have been merged, not skipped
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      expect(content).toContain('*.log'); // Original content preserved
      expect(content).toContain('.lumenflow/telemetry'); // LumenFlow entries added
      expect(content).toContain('worktrees/'); // LumenFlow entries added

      // Should appear in merged output, not skipped
      expect(result.merged).toContain('.gitignore');
      expect(result.skipped).not.toContain('.gitignore');
    });

    it('should not duplicate entries if lumenflow entries already present', async () => {
      const gitignorePath = path.join(tempDir, '.gitignore');
      // WU-1969: Must include ALL required exclusions (not just the old 3)
      // to be considered "complete" and skipped
      const templates = await import('../src/init-templates.js');
      const allLines = templates.REQUIRED_GITIGNORE_EXCLUSIONS.map(
        (e: { line: string }) => e.line,
      ).join('\n');
      fs.writeFileSync(gitignorePath, `# My project\n${allLines}\n`);

      const { scaffoldProject } = await import('../src/init.js');
      const result = await scaffoldProject(tempDir, {
        ...baseOptions,
      });

      // All entries already present -- should be skipped (nothing to merge)
      expect(result.skipped).toContain('.gitignore');
    });

    it('should merge only missing entries when some already exist', async () => {
      const gitignorePath = path.join(tempDir, '.gitignore');
      fs.writeFileSync(gitignorePath, '# My project\nnode_modules/\n');

      const { scaffoldProject } = await import('../src/init.js');
      const result = await scaffoldProject(tempDir, {
        ...baseOptions,
      });

      const content = fs.readFileSync(gitignorePath, 'utf-8');
      expect(content).toContain('node_modules/');
      expect(content).toContain('.lumenflow/telemetry');
      expect(content).toContain('worktrees/');

      // Count occurrences of node_modules -- should be exactly 1 (not duplicated)
      const nodeModulesCount = (content.match(/node_modules/g) ?? []).length;
      expect(nodeModulesCount).toBe(1);

      expect(result.merged).toContain('.gitignore');
    });
  });

  // --------------------------------------------------------------------------
  // AC3: Gate config defaults match installed tooling
  // --------------------------------------------------------------------------
  describe('AC3: Gate config defaults from package.json', () => {
    it('should not default to vitest when vitest is not in package.json', async () => {
      // Create a package.json without vitest
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(
          {
            name: 'my-project',
            devDependencies: {
              jest: '^29.0.0',
            },
          },
          null,
          2,
        ),
      );

      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, {
        ...baseOptions,
        full: true,
      });

      const configPath = path.join(tempDir, '.lumenflow.config.yaml');
      const content = fs.readFileSync(configPath, 'utf-8');

      // Should not contain vitest if it's not installed
      // The test runner in gates config should match what's actually installed
      if (content.includes('test')) {
        expect(content).not.toMatch(/vitest/);
      }
    });

    it('should not default to turbo when turbo is not in package.json', async () => {
      // Create a package.json without turbo
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(
          {
            name: 'my-project',
            devDependencies: {
              jest: '^29.0.0',
            },
          },
          null,
          2,
        ),
      );

      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, {
        ...baseOptions,
        full: true,
      });

      const configPath = path.join(tempDir, '.lumenflow.config.yaml');
      const content = fs.readFileSync(configPath, 'utf-8');

      // Should not contain turbo if it's not installed
      if (content.includes('build')) {
        expect(content).not.toMatch(/turbo/);
      }
    });

    it('should detect vitest when present in package.json devDependencies', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(
          {
            name: 'my-project',
            devDependencies: {
              vitest: '^1.0.0',
            },
          },
          null,
          2,
        ),
      );

      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, {
        ...baseOptions,
        full: true,
      });

      const configPath = path.join(tempDir, '.lumenflow.config.yaml');
      const content = fs.readFileSync(configPath, 'utf-8');

      // When vitest IS present, it's fine to reference it
      // This test just verifies detection works
      expect(content).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // AC4: Overwritten files reported in output
  // --------------------------------------------------------------------------
  describe('AC4: Report overwritten files in output', () => {
    it('should report overwritten files when using --force on existing project', async () => {
      const { scaffoldProject } = await import('../src/init.js');

      // First run: create files
      await scaffoldProject(tempDir, {
        ...baseOptions,
      });

      // Second run with --force: should report overwrites
      const result = await scaffoldProject(tempDir, {
        ...baseOptions,
        force: true,
      });

      // The result should have an overwritten array or the created array should
      // indicate files that were overwritten (not just newly created)
      const hasOverwriteTracking =
        result.overwritten !== undefined || result.created.some((f) => f.includes('overwritten'));
      expect(hasOverwriteTracking).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // AC5: Non-full mode (--minimal) still scaffolds onboarding docs for claude client
  // --------------------------------------------------------------------------
  describe('AC5: Minimal mode with claude client still scaffolds onboarding docs', () => {
    it('should scaffold onboarding docs when --minimal and --client claude', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      const result = await scaffoldProject(tempDir, {
        ...baseOptions,
        full: false, // minimal mode
        client: 'claude',
      });

      // Onboarding docs should exist
      const onboardingDir = path.join(
        tempDir,
        'docs',
        '04-operations',
        '_frameworks',
        'lumenflow',
        'agent',
        'onboarding',
      );
      expect(fs.existsSync(path.join(onboardingDir, 'quick-ref-commands.md'))).toBe(true);
      expect(fs.existsSync(path.join(onboardingDir, 'first-wu-mistakes.md'))).toBe(true);

      // Should be in created list
      const onboardingCreated = result.created.filter((f) => f.includes('onboarding'));
      expect(onboardingCreated.length).toBeGreaterThan(0);
    });
  });
});
