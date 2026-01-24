/**
 * @file docs-sync.test.ts
 * Test suite for lumenflow docs:sync command (WU-1083)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

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

      expect(result.skipped).toContain('docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md');
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
});
