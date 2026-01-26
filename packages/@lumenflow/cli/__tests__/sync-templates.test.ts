/**
 * @file sync-templates.test.ts
 * Test suite for sync-templates command (WU-1123)
 *
 * This script syncs internal docs to the CLI templates directory
 * for release-cycle maintenance:
 * - Onboarding docs -> templates/core/ai/onboarding/
 * - Claude skills -> templates/vendors/claude/.claude/skills/
 * - Core docs (LUMENFLOW.md, constraints.md) -> templates/core/
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('sync-templates command (WU-1123)', () => {
  let tempDir: string;
  let sourceDir: string;
  let templatesDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-templates-test-'));
    sourceDir = tempDir;
    templatesDir = path.join(tempDir, 'packages', '@lumenflow', 'cli', 'templates');

    // Set up source directory structure (simulating hellmai/os repo)
    fs.mkdirSync(templatesDir, { recursive: true });

    // Create onboarding docs source
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
    fs.writeFileSync(
      path.join(onboardingDir, 'troubleshooting-wu-done.md'),
      `# Troubleshooting: wu:done Not Run

**Last updated:** 2026-01-21

This is the most common mistake agents make.`,
    );
    fs.writeFileSync(
      path.join(onboardingDir, 'first-wu-mistakes.md'),
      `# First WU Mistakes

**Last updated:** 2026-01-21

Common mistakes agents make.`,
    );

    // Create skills source
    const skillsDir = path.join(tempDir, '.claude', 'skills');
    fs.mkdirSync(path.join(skillsDir, 'wu-lifecycle'), { recursive: true });
    fs.mkdirSync(path.join(skillsDir, 'worktree-discipline'), { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, 'wu-lifecycle', 'SKILL.md'),
      `---
name: wu-lifecycle
description: WU lifecycle management
version: 2.1.0
---

# WU Lifecycle Skill

Core commands for WU management.`,
    );
    fs.writeFileSync(
      path.join(skillsDir, 'worktree-discipline', 'SKILL.md'),
      `---
name: worktree-discipline
description: Worktree discipline
version: 2.0.0
---

# Worktree Discipline

Absolute path trap prevention.`,
    );

    // Create core docs source - use tempDir in content so convertToTemplate can replace it
    fs.writeFileSync(
      path.join(tempDir, 'LUMENFLOW.md'),
      `# LumenFlow Workflow Guide

**Last updated:** 2026-01-26

cd ${tempDir}
pnpm wu:done --id WU-XXX`,
    );
    // Create .lumenflow directory BEFORE writing constraints.md
    fs.mkdirSync(path.join(tempDir, '.lumenflow'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, '.lumenflow', 'constraints.md'),
      `# LumenFlow Constraints Capsule

**Version:** 1.0
**Last updated:** 2026-01-19

The 6 non-negotiable constraints.`,
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('syncOnboardingDocs', () => {
    it('should sync onboarding docs to templates with variable substitution', async () => {
      const { syncOnboardingDocs } = await import('../src/sync-templates.js');

      const result = await syncOnboardingDocs(sourceDir);

      const targetFile = path.join(
        templatesDir,
        'core',
        'ai',
        'onboarding',
        'troubleshooting-wu-done.md.template',
      );
      expect(fs.existsSync(targetFile)).toBe(true);

      const content = fs.readFileSync(targetFile, 'utf-8');
      // Should have {{DATE}} template variable instead of hardcoded date
      expect(content).toContain('{{DATE}}');
      expect(content).not.toContain('2026-01-21');
    });

    it('should sync all onboarding doc files', async () => {
      const { syncOnboardingDocs } = await import('../src/sync-templates.js');

      const result = await syncOnboardingDocs(sourceDir);

      const targetDir = path.join(templatesDir, 'core', 'ai', 'onboarding');
      expect(fs.existsSync(path.join(targetDir, 'troubleshooting-wu-done.md.template'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'first-wu-mistakes.md.template'))).toBe(true);
      expect(result.synced.length).toBe(2);
    });
  });

  describe('syncSkillsToTemplates', () => {
    it('should sync Claude skills to templates/vendors/claude', async () => {
      const { syncSkillsToTemplates } = await import('../src/sync-templates.js');

      const result = await syncSkillsToTemplates(sourceDir);

      const targetDir = path.join(templatesDir, 'vendors', 'claude', '.claude', 'skills');
      expect(fs.existsSync(path.join(targetDir, 'wu-lifecycle', 'SKILL.md.template'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'worktree-discipline', 'SKILL.md.template'))).toBe(
        true,
      );
      expect(result.synced.length).toBe(2);
    });

    it('should preserve skill metadata frontmatter', async () => {
      const { syncSkillsToTemplates } = await import('../src/sync-templates.js');

      await syncSkillsToTemplates(sourceDir);

      const targetFile = path.join(
        templatesDir,
        'vendors',
        'claude',
        '.claude',
        'skills',
        'wu-lifecycle',
        'SKILL.md.template',
      );
      const content = fs.readFileSync(targetFile, 'utf-8');
      expect(content).toContain('name: wu-lifecycle');
      expect(content).toContain('description:');
    });
  });

  describe('syncCoreDocs', () => {
    it('should sync LUMENFLOW.md with template variables', async () => {
      const { syncCoreDocs } = await import('../src/sync-templates.js');

      const result = await syncCoreDocs(sourceDir);

      const targetFile = path.join(templatesDir, 'core', 'LUMENFLOW.md.template');
      expect(fs.existsSync(targetFile)).toBe(true);

      const content = fs.readFileSync(targetFile, 'utf-8');
      // Should have {{DATE}} instead of hardcoded date
      expect(content).toContain('{{DATE}}');
      // Should have {{PROJECT_ROOT}} instead of hardcoded path
      expect(content).toContain('{{PROJECT_ROOT}}');
      // The temp dir path should have been replaced
      expect(content).not.toContain(tempDir);
    });

    it('should sync constraints.md with template variables', async () => {
      const { syncCoreDocs } = await import('../src/sync-templates.js');

      await syncCoreDocs(sourceDir);

      const targetFile = path.join(templatesDir, 'core', '.lumenflow', 'constraints.md.template');
      expect(fs.existsSync(targetFile)).toBe(true);

      const content = fs.readFileSync(targetFile, 'utf-8');
      expect(content).toContain('{{DATE}}');
    });
  });

  describe('syncTemplates (main function)', () => {
    it('should sync all templates and return summary', async () => {
      const { syncTemplates } = await import('../src/sync-templates.js');

      const result = await syncTemplates(sourceDir);

      expect(result.onboarding.synced.length).toBeGreaterThan(0);
      expect(result.skills.synced.length).toBeGreaterThan(0);
      expect(result.core.synced.length).toBeGreaterThan(0);
    });

    it('should report errors for missing source files', async () => {
      const { syncTemplates } = await import('../src/sync-templates.js');

      // Remove a source file
      fs.unlinkSync(path.join(tempDir, 'LUMENFLOW.md'));

      const result = await syncTemplates(sourceDir);

      expect(result.core.errors.length).toBeGreaterThan(0);
    });
  });

  describe('CLI entry point', () => {
    it('should export main function for CLI', async () => {
      const mod = await import('../src/sync-templates.js');
      expect(typeof mod.main).toBe('function');
    });
  });

  describe('template variable substitution', () => {
    it('should replace YYYY-MM-DD date patterns with {{DATE}}', async () => {
      const { convertToTemplate } = await import('../src/sync-templates.js');

      const input = 'Last updated: 2026-01-26\nCreated: 2025-12-01';
      const output = convertToTemplate(input, '/home/tom/source/hellmai/os');

      expect(output).toBe('Last updated: {{DATE}}\nCreated: {{DATE}}');
    });

    it('should replace absolute project paths with {{PROJECT_ROOT}}', async () => {
      const { convertToTemplate } = await import('../src/sync-templates.js');

      const input = 'cd /home/tom/source/hellmai/os\npnpm wu:done';
      const output = convertToTemplate(input, '/home/tom/source/hellmai/os');

      expect(output).toBe('cd {{PROJECT_ROOT}}\npnpm wu:done');
    });

    it('should handle mixed content', async () => {
      const { convertToTemplate } = await import('../src/sync-templates.js');

      const input = `# Doc
Last updated: 2026-01-26

Run: cd /home/tom/source/hellmai/os && pnpm gates`;
      const output = convertToTemplate(input, '/home/tom/source/hellmai/os');

      expect(output).toContain('{{DATE}}');
      expect(output).toContain('{{PROJECT_ROOT}}');
    });
  });
});
