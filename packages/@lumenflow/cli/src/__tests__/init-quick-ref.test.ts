/**
 * @file init-quick-ref.test.ts
 * Tests for quick-ref commands content (WU-1309)
 * Verifies: correct init command, complete wu:create example
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { scaffoldProject, type ScaffoldOptions } from '../init.js';

// Constants to avoid duplicate strings (sonarjs/no-duplicate-string)
const ARC42_DOCS_STRUCTURE = 'arc42' as const;

describe('quick-ref commands', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-quickref-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function getQuickRefPath(docsStructure: 'simple' | 'arc42' = ARC42_DOCS_STRUCTURE): string {
    if (docsStructure === 'simple') {
      return path.join(
        tempDir,
        'docs',
        '_frameworks',
        'lumenflow',
        'agent',
        'onboarding',
        'quick-ref-commands.md',
      );
    }
    return path.join(
      tempDir,
      'docs',
      '04-operations',
      '_frameworks',
      'lumenflow',
      'agent',
      'onboarding',
      'quick-ref-commands.md',
    );
  }

  function getArc42Options(): ScaffoldOptions {
    return {
      force: false,
      full: true,
      docsStructure: ARC42_DOCS_STRUCTURE,
    };
  }

  describe('init command documentation', () => {
    it('should show correct lumenflow init command', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const quickRefPath = getQuickRefPath();
      const content = fs.readFileSync(quickRefPath, 'utf-8');

      // Should document the init command correctly
      expect(content).toContain('lumenflow init');
      // Should show the various init flags
      expect(content).toContain('--full');
    });

    it('should document --docs-structure flag in quick-ref', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const quickRefPath = getQuickRefPath();
      const content = fs.readFileSync(quickRefPath, 'utf-8');

      // Should document the docs-structure option
      expect(content).toContain('--docs-structure');
      expect(content).toMatch(/simple|arc42/);
    });
  });

  describe('wu:create example', () => {
    it('should include a complete wu:create example with all required fields', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const quickRefPath = getQuickRefPath();
      const content = fs.readFileSync(quickRefPath, 'utf-8');

      // Should have a complete wu:create example
      expect(content).toContain('wu:create');
      expect(content).toContain('--lane');
      expect(content).toContain('--title');
      expect(content).toContain('--description');
      expect(content).toContain('--acceptance');
      expect(content).toContain('--code-paths');
      expect(content).toContain('--exposure');
    });

    it('should show test-paths in wu:create example', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const quickRefPath = getQuickRefPath();
      const content = fs.readFileSync(quickRefPath, 'utf-8');

      // Should include test paths
      expect(content).toMatch(/--test-paths-(unit|e2e)/);
    });

    it('should show spec-refs in wu:create example for feature WUs', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const quickRefPath = getQuickRefPath();
      const content = fs.readFileSync(quickRefPath, 'utf-8');

      // Should include spec-refs for feature WUs
      expect(content).toContain('--spec-refs');
    });
  });

  describe('AGENTS.md quick-ref link', () => {
    it('should have correct quick-ref link for arc42 structure', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const agentsContent = fs.readFileSync(path.join(tempDir, 'AGENTS.md'), 'utf-8');

      // Should point to arc42 path
      expect(agentsContent).toContain(
        'docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md',
      );
    });

    it('should have correct quick-ref link for simple structure', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: true,
        docsStructure: 'simple',
      };

      await scaffoldProject(tempDir, options);

      const agentsContent = fs.readFileSync(path.join(tempDir, 'AGENTS.md'), 'utf-8');

      // Should point to simple path (without 04-operations)
      expect(agentsContent).toContain(
        'docs/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md',
      );
      expect(agentsContent).not.toContain('04-operations');
    });
  });

  describe('quick-ref command tables', () => {
    it('should have project setup commands including init', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const quickRefPath = getQuickRefPath();
      const content = fs.readFileSync(quickRefPath, 'utf-8');

      // Should have a project setup section

      expect(content).toMatch(/##.*?Setup|##.*?Project/i);
      expect(content).toContain('lumenflow init');
    });

    it('should have WU management commands', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const quickRefPath = getQuickRefPath();
      const content = fs.readFileSync(quickRefPath, 'utf-8');

      // Should have WU commands
      expect(content).toContain('wu:create');
      expect(content).toContain('wu:claim');
      expect(content).toContain('wu:done');
      expect(content).toContain('wu:block');
    });

    it('should have gates commands', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const quickRefPath = getQuickRefPath();
      const content = fs.readFileSync(quickRefPath, 'utf-8');

      // Should have gates commands
      expect(content).toContain('pnpm gates');
      expect(content).toContain('--docs-only');
    });
  });

  describe('workflow sequence', () => {
    it('should have a complete workflow sequence example', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const quickRefPath = getQuickRefPath();
      const content = fs.readFileSync(quickRefPath, 'utf-8');

      // Should have workflow sequence
      expect(content).toMatch(/workflow|sequence/i);
      // Should show the full flow: create -> claim -> work -> commit -> gates -> done
      expect(content).toContain('wu:create');
      expect(content).toContain('wu:claim');
      expect(content).toContain('pnpm gates');
      expect(content).toContain('wu:done');
    });
  });
});
