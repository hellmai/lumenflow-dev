/**
 * @file init-template-portability.test.ts
 * Tests for template portability - no absolute paths (WU-1309)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { scaffoldProject, type ScaffoldOptions } from '../init.js';

// Constants to avoid duplicate strings (sonarjs/no-duplicate-string)
const ARC42_DOCS_STRUCTURE = 'arc42' as const;
const PROJECT_ROOT_PLACEHOLDER = '<project-root>';

describe('template portability', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-portability-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('no absolute paths in templates', () => {
    it('should use <project-root> placeholder instead of absolute paths', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: true,
        client: 'claude',
      };

      await scaffoldProject(tempDir, options);

      // Check LUMENFLOW.md for absolute paths
      const lumenflowContent = fs.readFileSync(path.join(tempDir, 'LUMENFLOW.md'), 'utf-8');
      expect(lumenflowContent).not.toMatch(/\/home\//);
      expect(lumenflowContent).not.toMatch(/\/Users\//);
      expect(lumenflowContent).not.toMatch(/C:\\/);

      // Should contain <project-root> placeholder for portable references
      expect(lumenflowContent).toContain(PROJECT_ROOT_PLACEHOLDER);
    });

    it('should not contain hardcoded user paths in AGENTS.md', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const agentsContent = fs.readFileSync(path.join(tempDir, 'AGENTS.md'), 'utf-8');
      expect(agentsContent).not.toMatch(/\/home\/[a-zA-Z0-9_-]+\//);
      expect(agentsContent).not.toMatch(/\/Users\/[a-zA-Z0-9_-]+\//);
      expect(agentsContent).not.toMatch(/C:\\Users\\[a-zA-Z0-9_-]+\\/);
    });

    it('should not contain hardcoded paths in quick-ref-commands.md', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: true,
        docsStructure: ARC42_DOCS_STRUCTURE,
      };

      await scaffoldProject(tempDir, options);

      // Find the quick-ref-commands.md based on docs structure (arc42)
      const quickRefPath = path.join(
        tempDir,
        'docs',
        '04-operations',
        '_frameworks',
        'lumenflow',
        'agent',
        'onboarding',
        'quick-ref-commands.md',
      );

      if (fs.existsSync(quickRefPath)) {
        const quickRefContent = fs.readFileSync(quickRefPath, 'utf-8');
        expect(quickRefContent).not.toMatch(/\/home\/[a-zA-Z0-9_-]+\//);
        expect(quickRefContent).not.toMatch(/\/Users\/[a-zA-Z0-9_-]+\//);
        expect(quickRefContent).toContain(PROJECT_ROOT_PLACEHOLDER);
      }
    });

    it('should use relative paths for docs cross-references', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: true,
        client: 'claude',
        docsStructure: ARC42_DOCS_STRUCTURE,
      };

      await scaffoldProject(tempDir, options);

      // Starting prompt should have relative paths to other docs
      const onboardingDir = path.join(
        tempDir,
        'docs',
        '04-operations',
        '_frameworks',
        'lumenflow',
        'agent',
        'onboarding',
      );
      const startingPromptPath = path.join(onboardingDir, 'starting-prompt.md');

      if (fs.existsSync(startingPromptPath)) {
        const content = fs.readFileSync(startingPromptPath, 'utf-8');
        // Should use relative paths like ../../../../../../LUMENFLOW.md

        expect(content).toMatch(/\[.*?\]\([./]+.*?\.md\)/);
      }
    });
  });

  describe('PROJECT_ROOT token replacement', () => {
    it('should replace {{PROJECT_ROOT}} with <project-root> placeholder', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const lumenflowContent = fs.readFileSync(path.join(tempDir, 'LUMENFLOW.md'), 'utf-8');

      // Should not have unreplaced {{PROJECT_ROOT}} tokens
      expect(lumenflowContent).not.toContain('{{PROJECT_ROOT}}');

      // Should have the portable placeholder
      expect(lumenflowContent).toContain('<project-root>');
    });
  });
});
