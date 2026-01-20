/**
 * @file init.test.ts
 * Test suite for lumenflow init command (WU-1005, WU-1028)
 *
 * Tests scaffolding of new LumenFlow projects:
 * - LUMENFLOW.md main entry point (WU-1028)
 * - .lumenflow/ constraints and rules directory (WU-1028)
 * - docs/04-operations/_frameworks/lumenflow/agent/onboarding/ agent onboarding docs (WU-1028)
 * - .lumenflow.yaml configuration
 * - .beacon/ stamps directory
 * - docs/ WU storage structure
 * - Vendor-specific files based on --vendor flag (WU-1028)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('lumenflow init command (WU-1005, WU-1028)', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-test-'));
  });

  afterEach(() => {
    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('scaffoldProject', () => {
    it('should create .lumenflow.yaml with sensible defaults', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { force: false, vendor: 'none' });

      const configPath = path.join(tempDir, '.lumenflow.yaml');
      expect(fs.existsSync(configPath)).toBe(true);

      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('version:');
      expect(content).toContain('lanes:');
    });

    it('should create LUMENFLOW.md with wu:done warning (WU-1028)', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { force: false, vendor: 'none' });

      const lumenflowPath = path.join(tempDir, 'LUMENFLOW.md');
      expect(fs.existsSync(lumenflowPath)).toBe(true);

      const content = fs.readFileSync(lumenflowPath, 'utf-8');
      expect(content).toContain('ALWAYS Run wu:done');
      expect(content).toContain('pnpm wu:done');
      expect(content).toContain('Worktree Discipline');
    });

    it('should create .lumenflow/constraints.md (WU-1028)', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { force: false, vendor: 'none' });

      const constraintsPath = path.join(tempDir, '.lumenflow', 'constraints.md');
      expect(fs.existsSync(constraintsPath)).toBe(true);

      const content = fs.readFileSync(constraintsPath, 'utf-8');
      expect(content).toContain('Non-Negotiable Constraints');
      expect(content).toContain('Mini Audit Checklist');
    });

    it('should create .lumenflow/rules directory (WU-1028)', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { force: false, vendor: 'none' });

      const rulesDir = path.join(tempDir, '.lumenflow', 'rules');
      expect(fs.existsSync(rulesDir)).toBe(true);
      expect(fs.statSync(rulesDir).isDirectory()).toBe(true);
    });

    it('should create docs/04-operations/_frameworks/lumenflow/agent/onboarding/troubleshooting-wu-done.md (WU-1028)', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { force: false, vendor: 'none' });

      const troubleshootingPath = path.join(
        tempDir,
        'ai',
        'onboarding',
        'troubleshooting-wu-done.md',
      );
      expect(fs.existsSync(troubleshootingPath)).toBe(true);

      const content = fs.readFileSync(troubleshootingPath, 'utf-8');
      expect(content).toContain('wu:done Not Run');
      expect(content).toContain('Checklist Before Ending Session');
    });

    it('should create docs/04-operations/_frameworks/lumenflow/agent/onboarding/agent-safety-card.md (WU-1028)', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { force: false, vendor: 'none' });

      const safetyCardPath = path.join(tempDir, 'ai', 'onboarding', 'agent-safety-card.md');
      expect(fs.existsSync(safetyCardPath)).toBe(true);

      const content = fs.readFileSync(safetyCardPath, 'utf-8');
      expect(content).toContain('Stop and Ask When');
      expect(content).toContain('Never Do');
    });

    it('should create .beacon/ directory', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { force: false, vendor: 'none' });

      const beaconDir = path.join(tempDir, '.beacon');
      expect(fs.existsSync(beaconDir)).toBe(true);
      expect(fs.statSync(beaconDir).isDirectory()).toBe(true);

      // Should have stamps subdirectory
      const stampsDir = path.join(beaconDir, 'stamps');
      expect(fs.existsSync(stampsDir)).toBe(true);
    });

    it('should create docs/ structure for WUs', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { force: false, vendor: 'none' });

      const wuDir = path.join(tempDir, 'docs', '04-operations', 'tasks', 'wu');
      expect(fs.existsSync(wuDir)).toBe(true);
      expect(fs.statSync(wuDir).isDirectory()).toBe(true);

      // Should have .gitkeep to preserve empty directory
      const gitkeep = path.join(wuDir, '.gitkeep');
      expect(fs.existsSync(gitkeep)).toBe(true);
    });

    it('should not overwrite existing files without --force', async () => {
      const { scaffoldProject } = await import('../src/init.js');

      // Create existing file
      const existingContent = '# Existing LUMENFLOW.md';
      const lumenflowPath = path.join(tempDir, 'LUMENFLOW.md');
      fs.writeFileSync(lumenflowPath, existingContent);

      await scaffoldProject(tempDir, { force: false, vendor: 'none' });

      // Should preserve existing content
      const content = fs.readFileSync(lumenflowPath, 'utf-8');
      expect(content).toBe(existingContent);
    });

    it('should overwrite existing files with --force', async () => {
      const { scaffoldProject } = await import('../src/init.js');

      // Create existing file
      const existingContent = '# Existing LUMENFLOW.md';
      const lumenflowPath = path.join(tempDir, 'LUMENFLOW.md');
      fs.writeFileSync(lumenflowPath, existingContent);

      await scaffoldProject(tempDir, { force: true, vendor: 'none' });

      // Should have new template content
      const content = fs.readFileSync(lumenflowPath, 'utf-8');
      expect(content).not.toBe(existingContent);
      expect(content).toContain('ALWAYS Run wu:done');
    });

    it('should return list of created files', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      const result = await scaffoldProject(tempDir, { force: false, vendor: 'none' });

      expect(result.created).toContain('.lumenflow.yaml');
      expect(result.created).toContain('LUMENFLOW.md');
      expect(result.created).toContain('.beacon/stamps');
      expect(result.created).toContain('docs/04-operations/tasks/wu');
    });

    it('should return list of skipped files when not using --force', async () => {
      const { scaffoldProject } = await import('../src/init.js');

      // Create existing file
      fs.writeFileSync(path.join(tempDir, 'LUMENFLOW.md'), '# Existing');

      const result = await scaffoldProject(tempDir, { force: false, vendor: 'none' });

      expect(result.skipped).toContain('LUMENFLOW.md');
    });
  });

  describe('vendor flag (WU-1028)', () => {
    it('should create .claude/ directory with --vendor claude', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { force: false, vendor: 'claude' });

      const claudeDir = path.join(tempDir, '.claude');
      expect(fs.existsSync(claudeDir)).toBe(true);

      // Should have CLAUDE.md that references LUMENFLOW.md
      const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
      expect(fs.existsSync(claudeMdPath)).toBe(true);
      const content = fs.readFileSync(claudeMdPath, 'utf-8');
      expect(content).toContain('LUMENFLOW.md');
      expect(content).toContain('wu:done');

      // Should have settings.json
      const settingsPath = path.join(claudeDir, 'settings.json');
      expect(fs.existsSync(settingsPath)).toBe(true);
    });

    it('should create .cursor/ directory with --vendor cursor', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { force: false, vendor: 'cursor' });

      const cursorDir = path.join(tempDir, '.cursor');
      expect(fs.existsSync(cursorDir)).toBe(true);

      // Should have rules.md that references LUMENFLOW.md
      const rulesPath = path.join(cursorDir, 'rules.md');
      expect(fs.existsSync(rulesPath)).toBe(true);
      const content = fs.readFileSync(rulesPath, 'utf-8');
      expect(content).toContain('LUMENFLOW.md');
    });

    it('should create .aider.conf.yml with --vendor aider', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { force: false, vendor: 'aider' });

      const aiderPath = path.join(tempDir, '.aider.conf.yml');
      expect(fs.existsSync(aiderPath)).toBe(true);

      const content = fs.readFileSync(aiderPath, 'utf-8');
      expect(content).toContain('LUMENFLOW.md');
    });

    it('should create all vendor files with --vendor all', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { force: false, vendor: 'all' });

      // Claude
      expect(fs.existsSync(path.join(tempDir, '.claude', 'CLAUDE.md'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.claude', 'settings.json'))).toBe(true);

      // Cursor
      expect(fs.existsSync(path.join(tempDir, '.cursor', 'rules.md'))).toBe(true);

      // Aider
      expect(fs.existsSync(path.join(tempDir, '.aider.conf.yml'))).toBe(true);
    });

    it('should not create vendor files with --vendor none', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { force: false, vendor: 'none' });

      expect(fs.existsSync(path.join(tempDir, '.claude'))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, '.cursor'))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, '.aider.conf.yml'))).toBe(false);
    });

    it('should still create core files regardless of vendor', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { force: false, vendor: 'none' });

      // Core files should always exist
      expect(fs.existsSync(path.join(tempDir, 'LUMENFLOW.md'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.lumenflow', 'constraints.md'))).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, 'ai', 'onboarding', 'troubleshooting-wu-done.md')),
      ).toBe(true);
    });
  });
});
