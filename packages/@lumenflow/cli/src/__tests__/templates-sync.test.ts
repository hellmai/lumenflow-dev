/**
 * @file templates-sync.test.ts
 * Tests for templates synchronization and drift detection (WU-1353)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  syncTemplates,
  syncOnboardingDocs,
  syncCoreDocs,
  convertToTemplate,
  checkTemplateDrift,
} from '../sync-templates.js';

// Constants for frequently used path segments (sonarjs/no-duplicate-string)
const PACKAGES_DIR = 'packages';
const LUMENFLOW_SCOPE = '@lumenflow';
const CLI_DIR = 'cli';
const TEMPLATES_DIR = 'templates';
const CORE_DIR = 'core';
const LUMENFLOW_DOT_DIR = '.lumenflow';
const CONSTRAINTS_FILE = 'constraints.md';
const CONSTRAINTS_TEMPLATE = 'constraints.md.template';

describe('templates-sync', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'templates-sync-test-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('convertToTemplate', () => {
    it('should replace dates with {{DATE}} placeholder', () => {
      const content = 'Updated: 2026-02-02\nCreated: 2025-01-15';
      const result = convertToTemplate(content, '/home/test/project');
      expect(result).toBe('Updated: {{DATE}}\nCreated: {{DATE}}');
    });

    it('should preserve content without dates', () => {
      const content = '# Title\n\nSome content without dates.';
      const result = convertToTemplate(content, '/home/test/project');
      expect(result).toBe(content);
    });
  });

  describe('syncCoreDocs', () => {
    beforeEach(() => {
      // Set up directory structure
      const templatesDir = path.join(
        tempDir,
        PACKAGES_DIR,
        LUMENFLOW_SCOPE,
        CLI_DIR,
        TEMPLATES_DIR,
        CORE_DIR,
        LUMENFLOW_DOT_DIR,
      );
      fs.mkdirSync(templatesDir, { recursive: true });

      // Create source constraints.md with v1.1 content
      const lumenflowDir = path.join(tempDir, LUMENFLOW_DOT_DIR);
      fs.mkdirSync(lumenflowDir, { recursive: true });
      fs.writeFileSync(
        path.join(lumenflowDir, CONSTRAINTS_FILE),
        `# LumenFlow Constraints Capsule

**Version:** 1.1
**Last updated:** 2026-02-02

This document contains the 7 non-negotiable constraints.

### 1. Worktree Discipline and Git Safety

**MANDATORY PRE-WRITE CHECK**

**NEVER "QUICK FIX" ON MAIN**
`,
      );

      // Create LUMENFLOW.md
      fs.writeFileSync(
        path.join(tempDir, 'LUMENFLOW.md'),
        `# LumenFlow Workflow Guide

**Last updated:** 2026-02-02

## Critical Rule: Use wu:prep Then wu:done
`,
      );
    });

    it('should sync constraints.md to template', async () => {
      const result = await syncCoreDocs(tempDir, false);

      expect(result.errors).toHaveLength(0);
      expect(result.synced).toContain(
        `${PACKAGES_DIR}/${LUMENFLOW_SCOPE}/${CLI_DIR}/${TEMPLATES_DIR}/${CORE_DIR}/${LUMENFLOW_DOT_DIR}/${CONSTRAINTS_TEMPLATE}`,
      );

      // Verify template content
      const templatePath = path.join(
        tempDir,
        PACKAGES_DIR,
        LUMENFLOW_SCOPE,
        CLI_DIR,
        TEMPLATES_DIR,
        CORE_DIR,
        LUMENFLOW_DOT_DIR,
        CONSTRAINTS_TEMPLATE,
      );
      const templateContent = fs.readFileSync(templatePath, 'utf-8');

      // Should have {{DATE}} placeholder
      expect(templateContent).toContain('{{DATE}}');
      expect(templateContent).not.toContain('2026-02-02');

      // Should have v1.1 content markers
      expect(templateContent).toContain('Version:** 1.1');
      expect(templateContent).toContain('7 non-negotiable constraints');
      expect(templateContent).toContain('MANDATORY PRE-WRITE CHECK');
      expect(templateContent).toContain('NEVER "QUICK FIX" ON MAIN');
    });

    it('should use dry-run mode without writing files', async () => {
      // First, ensure no template exists
      const templatePath = path.join(
        tempDir,
        PACKAGES_DIR,
        LUMENFLOW_SCOPE,
        CLI_DIR,
        TEMPLATES_DIR,
        CORE_DIR,
        LUMENFLOW_DOT_DIR,
        CONSTRAINTS_TEMPLATE,
      );

      // Remove if it exists from beforeEach
      if (fs.existsSync(templatePath)) {
        fs.unlinkSync(templatePath);
      }

      const result = await syncCoreDocs(tempDir, true);

      expect(result.errors).toHaveLength(0);
      expect(result.synced.length).toBeGreaterThan(0);
      expect(fs.existsSync(templatePath)).toBe(false);
    });
  });

  describe('syncOnboardingDocs', () => {
    const ONBOARDING_SUBPATH = [
      'docs',
      '04-operations',
      '_frameworks',
      'lumenflow',
      'agent',
      'onboarding',
    ];
    const FIRST_WU_MISTAKES_FILE = 'first-wu-mistakes.md';

    beforeEach(() => {
      // Set up onboarding source directory
      const onboardingDir = path.join(tempDir, ...ONBOARDING_SUBPATH);
      fs.mkdirSync(onboardingDir, { recursive: true });

      // Create first-wu-mistakes.md with v1.1 content (11 mistakes)
      fs.writeFileSync(
        path.join(onboardingDir, FIRST_WU_MISTAKES_FILE),
        `# First WU Mistakes

**Last updated:** 2026-02-02

## Mistake 1: Not Using Worktrees

pnpm wu:prep --id WU-123

## Mistake 11: "Quick Fixing" on Main

## Quick Checklist

- [ ] Check spec_refs for plans
`,
      );

      // Set up target directory
      const templatesDir = path.join(
        tempDir,
        PACKAGES_DIR,
        LUMENFLOW_SCOPE,
        CLI_DIR,
        TEMPLATES_DIR,
        CORE_DIR,
        'ai',
        'onboarding',
      );
      fs.mkdirSync(templatesDir, { recursive: true });
    });

    it('should sync first-wu-mistakes.md to template', async () => {
      const result = await syncOnboardingDocs(tempDir, false);

      expect(result.errors).toHaveLength(0);
      expect(result.synced).toContain(
        `${PACKAGES_DIR}/${LUMENFLOW_SCOPE}/${CLI_DIR}/${TEMPLATES_DIR}/${CORE_DIR}/ai/onboarding/${FIRST_WU_MISTAKES_FILE}.template`,
      );

      // Verify template content
      const templatePath = path.join(
        tempDir,
        PACKAGES_DIR,
        LUMENFLOW_SCOPE,
        CLI_DIR,
        TEMPLATES_DIR,
        CORE_DIR,
        'ai',
        'onboarding',
        `${FIRST_WU_MISTAKES_FILE}.template`,
      );
      const templateContent = fs.readFileSync(templatePath, 'utf-8');

      // Should have {{DATE}} placeholder
      expect(templateContent).toContain('{{DATE}}');
      expect(templateContent).not.toContain('2026-02-02');

      // Should have v1.1 content markers
      expect(templateContent).toContain('Mistake 11:');
      expect(templateContent).toContain('Quick Fixing" on Main');
      expect(templateContent).toContain('wu:prep');
      expect(templateContent).toContain('spec_refs');
    });
  });

  describe('checkTemplateDrift', () => {
    beforeEach(() => {
      // Set up source files
      const lumenflowDir = path.join(tempDir, LUMENFLOW_DOT_DIR);
      fs.mkdirSync(lumenflowDir, { recursive: true });
      fs.writeFileSync(
        path.join(lumenflowDir, CONSTRAINTS_FILE),
        `# Constraints
**Version:** 1.1
**Last updated:** 2026-02-02
7 constraints`,
      );

      // Set up template directory
      const templatesDir = path.join(
        tempDir,
        PACKAGES_DIR,
        LUMENFLOW_SCOPE,
        CLI_DIR,
        TEMPLATES_DIR,
        CORE_DIR,
        LUMENFLOW_DOT_DIR,
      );
      fs.mkdirSync(templatesDir, { recursive: true });
    });

    it('should detect drift when template is outdated', async () => {
      // Create outdated template (v1.0, 6 constraints)
      const templatePath = path.join(
        tempDir,
        PACKAGES_DIR,
        LUMENFLOW_SCOPE,
        CLI_DIR,
        TEMPLATES_DIR,
        CORE_DIR,
        LUMENFLOW_DOT_DIR,
        CONSTRAINTS_TEMPLATE,
      );
      fs.writeFileSync(
        templatePath,
        `# Constraints
**Version:** 1.0
**Last updated:** {{DATE}}
6 constraints`,
      );

      const drift = await checkTemplateDrift(tempDir);

      expect(drift.hasDrift).toBe(true);
      expect(drift.driftingFiles.length).toBeGreaterThan(0);
      expect(drift.driftingFiles.some((f) => f.includes(CONSTRAINTS_FILE))).toBe(true);
    });

    it('should report no drift when templates are in sync', async () => {
      // First sync templates
      await syncCoreDocs(tempDir, false);

      // Then check for drift
      const drift = await checkTemplateDrift(tempDir);

      // After sync, constraints should not be drifting
      expect(drift.driftingFiles.filter((f) => f.includes(CONSTRAINTS_FILE))).toHaveLength(0);
    });

    it('should return detailed drift report', async () => {
      // Create outdated template
      const templatePath = path.join(
        tempDir,
        PACKAGES_DIR,
        LUMENFLOW_SCOPE,
        CLI_DIR,
        TEMPLATES_DIR,
        CORE_DIR,
        LUMENFLOW_DOT_DIR,
        CONSTRAINTS_TEMPLATE,
      );
      fs.writeFileSync(templatePath, 'outdated content');

      const drift = await checkTemplateDrift(tempDir);

      expect(drift.hasDrift).toBe(true);
      expect(drift.driftingFiles).toBeDefined();
      expect(Array.isArray(drift.driftingFiles)).toBe(true);
    });
  });

  describe('syncTemplates (full sync)', () => {
    beforeEach(() => {
      // Set up minimal directory structure
      const lumenflowDir = path.join(tempDir, LUMENFLOW_DOT_DIR);
      fs.mkdirSync(lumenflowDir, { recursive: true });
      fs.writeFileSync(path.join(lumenflowDir, CONSTRAINTS_FILE), 'content');

      fs.writeFileSync(path.join(tempDir, 'LUMENFLOW.md'), 'content');

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
      fs.writeFileSync(path.join(onboardingDir, 'first-wu-mistakes.md'), 'content');

      const skillsDir = path.join(tempDir, '.claude', 'skills', 'test-skill');
      fs.mkdirSync(skillsDir, { recursive: true });
      fs.writeFileSync(path.join(skillsDir, 'SKILL.md'), 'skill content');
    });

    it('should sync all template categories', async () => {
      const result = await syncTemplates(tempDir, false);

      expect(result.core.errors).toHaveLength(0);
      expect(result.onboarding.errors).toHaveLength(0);
      expect(result.skills.errors).toHaveLength(0);

      // Should sync at least constraints and LUMENFLOW
      expect(result.core.synced.length).toBeGreaterThanOrEqual(2);
      // Should sync onboarding docs
      expect(result.onboarding.synced.length).toBeGreaterThanOrEqual(1);
      // Should sync skills
      expect(result.skills.synced.length).toBeGreaterThanOrEqual(1);
    });
  });
});
