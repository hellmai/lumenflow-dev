/**
 * @file docs-sync.test.ts
 * Test suite for lumenflow docs:sync command (WU-1083)
 * WU-1085: Added --help support tests
 * WU-1124: Added template loading tests (INIT-004 Phase 2)
 */

// Pre-existing lint issues - not introduced by WU-1367
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable sonarjs/no-unused-vars */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

describe('lumenflow docs:sync command (WU-1083)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-docs-sync-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('syncAgentDocs', () => {
    it('should sync agent onboarding docs to existing project', async () => {
      const { syncAgentDocs } = await import('../src/docs-sync.js');

      // Create minimal LumenFlow project (simulate existing project)
      fs.writeFileSync(path.join(tempDir, 'LUMENFLOW.md'), '# LumenFlow');
      fs.mkdirSync(path.join(tempDir, '.lumenflow'), { recursive: true });

      const result = await syncAgentDocs(tempDir, { force: false });

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
      expect(fs.existsSync(path.join(onboardingDir, 'wu-create-checklist.md'))).toBe(true);
      expect(result.created.length).toBeGreaterThan(0);
    });

    it('should not overwrite existing docs without --force', async () => {
      const { syncAgentDocs } = await import('../src/docs-sync.js');

      // Create existing doc
      const onboardingDir = path.join(
        tempDir,
        'docs',
        '04-operations',
        '_frameworks',
        'lumenflow',
        'agent',
        'onboarding',
      );
      fs.mkdirSync(onboardingDir, { recursive: true });
      const existingContent = '# Custom Content';
      fs.writeFileSync(path.join(onboardingDir, 'quick-ref-commands.md'), existingContent);

      await syncAgentDocs(tempDir, { force: false });

      const content = fs.readFileSync(path.join(onboardingDir, 'quick-ref-commands.md'), 'utf-8');
      expect(content).toBe(existingContent);
    });

    it('should overwrite existing docs with --force', async () => {
      const { syncAgentDocs } = await import('../src/docs-sync.js');

      // Create existing doc
      const onboardingDir = path.join(
        tempDir,
        'docs',
        '04-operations',
        '_frameworks',
        'lumenflow',
        'agent',
        'onboarding',
      );
      fs.mkdirSync(onboardingDir, { recursive: true });
      const existingContent = '# Custom Content';
      fs.writeFileSync(path.join(onboardingDir, 'quick-ref-commands.md'), existingContent);

      await syncAgentDocs(tempDir, { force: true });

      const content = fs.readFileSync(path.join(onboardingDir, 'quick-ref-commands.md'), 'utf-8');
      expect(content).not.toBe(existingContent);
      expect(content).toContain('Quick Reference');
    });

    it('should return created and skipped files', async () => {
      const { syncAgentDocs } = await import('../src/docs-sync.js');

      // Create one existing doc
      const onboardingDir = path.join(
        tempDir,
        'docs',
        '04-operations',
        '_frameworks',
        'lumenflow',
        'agent',
        'onboarding',
      );
      fs.mkdirSync(onboardingDir, { recursive: true });
      fs.writeFileSync(path.join(onboardingDir, 'quick-ref-commands.md'), '# Existing');

      const result = await syncAgentDocs(tempDir, { force: false });

      expect(result.skipped).toContain(
        'docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md',
      );
      expect(result.created.length).toBeGreaterThan(0);
    });
  });

  describe('syncSkills', () => {
    it('should sync Claude skills to existing project', async () => {
      const { syncSkills } = await import('../src/docs-sync.js');

      const result = await syncSkills(tempDir, { force: false, vendor: 'claude' });

      const skillsDir = path.join(tempDir, '.claude', 'skills');
      expect(fs.existsSync(path.join(skillsDir, 'wu-lifecycle', 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(skillsDir, 'worktree-discipline', 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(skillsDir, 'lumenflow-gates', 'SKILL.md'))).toBe(true);
      expect(result.created.length).toBeGreaterThan(0);
    });

    it('should do nothing for non-Claude vendor', async () => {
      const { syncSkills } = await import('../src/docs-sync.js');

      const result = await syncSkills(tempDir, { force: false, vendor: 'none' });

      const skillsDir = path.join(tempDir, '.claude', 'skills');
      expect(fs.existsSync(skillsDir)).toBe(false);
      expect(result.created.length).toBe(0);
    });
  });

  describe('CLI entry point', () => {
    it('should export main function for CLI', async () => {
      const mod = await import('../src/docs-sync.js');
      expect(typeof mod.main).toBe('function');
    });
  });

  // WU-1124: Template loading tests (INIT-004 Phase 2)
  describe('Template loading (WU-1124)', () => {
    it('should load templates from bundled files', async () => {
      const { loadTemplate, getTemplatesDir } = await import('../src/docs-sync.js');

      // Verify templates directory exists
      const templatesDir = getTemplatesDir();
      expect(fs.existsSync(templatesDir)).toBe(true);

      // Load a template and verify content comes from file
      const quickRefTemplate = loadTemplate('core/ai/onboarding/quick-ref-commands.md.template');
      expect(quickRefTemplate).toContain('Quick Reference');
      expect(quickRefTemplate).toContain('{{DATE}}'); // Should contain template placeholder
    });

    it('should load skill templates from vendor templates', async () => {
      const { loadTemplate } = await import('../src/docs-sync.js');

      const wuLifecycleTemplate = loadTemplate(
        'vendors/claude/.claude/skills/wu-lifecycle/SKILL.md.template',
      );
      expect(wuLifecycleTemplate).toContain('wu-lifecycle');
      expect(wuLifecycleTemplate).toContain('{{DATE}}');
    });

    it('should throw error for non-existent template', async () => {
      const { loadTemplate } = await import('../src/docs-sync.js');

      expect(() => loadTemplate('non-existent-template.md.template')).toThrow();
    });

    it('should have no hardcoded template strings in docs-sync module', async () => {
      // Read the docs-sync.ts source file and verify no large template strings
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const docsSyncPath = path.join(__dirname, '..', 'src', 'docs-sync.ts');
      const sourceCode = fs.readFileSync(docsSyncPath, 'utf-8');

      // Should not contain hardcoded template content markers
      // The old code had templates like "# Quick Reference: LumenFlow Commands"
      expect(sourceCode).not.toContain('# Quick Reference: LumenFlow Commands');
      expect(sourceCode).not.toContain('# First WU Mistakes');
      expect(sourceCode).not.toContain('# Troubleshooting: wu:done Not Run');
      expect(sourceCode).not.toContain('# Agent Safety Card');
      expect(sourceCode).not.toContain('# WU Creation Checklist');

      // Should not contain skill template content
      expect(sourceCode).not.toContain('name: wu-lifecycle');
      expect(sourceCode).not.toContain('name: worktree-discipline');
      expect(sourceCode).not.toContain('name: lumenflow-gates');
    });

    it('should sync docs using content from template files', async () => {
      const { syncAgentDocs, loadTemplate } = await import('../src/docs-sync.js');

      const result = await syncAgentDocs(tempDir, { force: false });

      // Verify content comes from templates (not hardcoded)
      const onboardingDir = path.join(
        tempDir,
        'docs',
        '04-operations',
        '_frameworks',
        'lumenflow',
        'agent',
        'onboarding',
      );

      const quickRefContent = fs.readFileSync(
        path.join(onboardingDir, 'quick-ref-commands.md'),
        'utf-8',
      );

      // Load template directly to compare (verifies template exists and is loadable)
      const _templateContent = loadTemplate('core/ai/onboarding/quick-ref-commands.md.template');

      // Both should have the same structural content (after placeholder replacement)
      expect(quickRefContent).toContain('Quick Reference');
      expect(quickRefContent).toContain('WU Lifecycle');
      // Template placeholders should be replaced
      expect(quickRefContent).not.toContain('{{DATE}}');

      expect(result.created.length).toBeGreaterThan(0);
    });
  });

  // WU-1085: CLI argument parsing with --help support
  describe('CLI argument parsing (WU-1085)', () => {
    let mockExit: ReturnType<typeof vi.spyOn>;
    let originalArgv: string[];

    beforeEach(() => {
      originalArgv = process.argv;
      mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    });

    afterEach(() => {
      process.argv = originalArgv;
      mockExit.mockRestore();
      vi.resetModules();
    });

    it('should show help when --help flag is passed and not run sync', async () => {
      process.argv = ['node', 'lumenflow-docs-sync', '--help'];

      const { parseDocsSyncOptions } = await import('../src/docs-sync.js');

      // Should throw/exit when --help is passed (Commander behavior)
      expect(() => parseDocsSyncOptions()).toThrow();
    });

    it('should show help when -h flag is passed', async () => {
      process.argv = ['node', 'lumenflow-docs-sync', '-h'];

      const { parseDocsSyncOptions } = await import('../src/docs-sync.js');

      expect(() => parseDocsSyncOptions()).toThrow();
    });

    it('should show version when --version flag is passed', async () => {
      process.argv = ['node', 'lumenflow-docs-sync', '--version'];

      const { parseDocsSyncOptions } = await import('../src/docs-sync.js');

      expect(() => parseDocsSyncOptions()).toThrow();
    });

    it('should parse --force flag correctly', async () => {
      process.argv = ['node', 'lumenflow-docs-sync', '--force'];

      const { parseDocsSyncOptions } = await import('../src/docs-sync.js');
      const opts = parseDocsSyncOptions();

      expect(opts.force).toBe(true);
    });

    it('should parse --vendor flag correctly', async () => {
      process.argv = ['node', 'lumenflow-docs-sync', '--vendor', 'claude'];

      const { parseDocsSyncOptions } = await import('../src/docs-sync.js');
      const opts = parseDocsSyncOptions();

      expect(opts.vendor).toBe('claude');
    });
  });
});
