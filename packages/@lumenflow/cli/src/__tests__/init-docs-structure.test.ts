/**
 * @file init-docs-structure.test.ts
 * Tests for --docs-structure flag and auto-detection (WU-1309)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  scaffoldProject,
  type ScaffoldOptions,
  detectDocsStructure,
  getDocsPath,
} from '../init.js';

// Constants to avoid duplicate strings (sonarjs/no-duplicate-string)
const ARC42_DOCS_STRUCTURE = 'arc42' as const;
const SIMPLE_DOCS_STRUCTURE = 'simple' as const;
const DOCS_04_OPERATIONS = '04-operations';

describe('docs-structure', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-docs-structure-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('detectDocsStructure', () => {
    it('should return "arc42" when docs/04-operations exists', () => {
      fs.mkdirSync(path.join(tempDir, 'docs', DOCS_04_OPERATIONS), { recursive: true });

      const result = detectDocsStructure(tempDir);

      expect(result).toBe(ARC42_DOCS_STRUCTURE);
    });

    it('should return "simple" when docs exists without 04-operations', () => {
      fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'docs', 'README.md'), '# Docs\n');

      const result = detectDocsStructure(tempDir);

      expect(result).toBe(SIMPLE_DOCS_STRUCTURE);
    });

    it('should return "simple" when no docs directory exists', () => {
      const result = detectDocsStructure(tempDir);

      expect(result).toBe(SIMPLE_DOCS_STRUCTURE);
    });

    it('should detect arc42 with any numbered directory (01-*, 02-*, etc.)', () => {
      fs.mkdirSync(path.join(tempDir, 'docs', '01-introduction'), { recursive: true });

      const result = detectDocsStructure(tempDir);

      expect(result).toBe(ARC42_DOCS_STRUCTURE);
    });
  });

  describe('getDocsPath', () => {
    it('should return simple paths for simple structure', () => {
      const paths = getDocsPath(SIMPLE_DOCS_STRUCTURE);

      expect(paths.operations).toBe('docs');
      expect(paths.tasks).toBe('docs/tasks');
      expect(paths.onboarding).toBe('docs/_frameworks/lumenflow/agent/onboarding');
    });

    it('should return arc42 paths for arc42 structure', () => {
      const paths = getDocsPath(ARC42_DOCS_STRUCTURE);

      expect(paths.operations).toBe('docs/04-operations');
      expect(paths.tasks).toBe('docs/04-operations/tasks');
      expect(paths.onboarding).toBe('docs/04-operations/_frameworks/lumenflow/agent/onboarding');
    });
  });

  describe('scaffoldProject with --docs-structure', () => {
    it('should scaffold simple structure with --docs-structure simple', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: true,
        docsStructure: SIMPLE_DOCS_STRUCTURE,
      };

      await scaffoldProject(tempDir, options);

      // Simple structure: docs/tasks, not docs/04-operations/tasks
      expect(fs.existsSync(path.join(tempDir, 'docs', 'tasks'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'docs', DOCS_04_OPERATIONS))).toBe(false);
    });

    it('should scaffold arc42 structure with --docs-structure arc42', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: true,
        docsStructure: ARC42_DOCS_STRUCTURE,
      };

      await scaffoldProject(tempDir, options);

      // Arc42 structure: docs/04-operations/tasks
      expect(fs.existsSync(path.join(tempDir, 'docs', DOCS_04_OPERATIONS, 'tasks'))).toBe(true);
    });

    it('should auto-detect arc42 when docs/04-operations exists', async () => {
      // Create existing arc42 structure
      fs.mkdirSync(path.join(tempDir, 'docs', DOCS_04_OPERATIONS), { recursive: true });

      const options: ScaffoldOptions = {
        force: false,
        full: true,
        // No docsStructure specified - should auto-detect arc42
      };

      await scaffoldProject(tempDir, options);

      // Should use arc42 structure
      expect(fs.existsSync(path.join(tempDir, 'docs', DOCS_04_OPERATIONS, 'tasks'))).toBe(true);
    });

    it('should auto-detect simple when only docs exists', async () => {
      // Create existing simple structure
      fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'docs', 'README.md'), '# Docs\n');

      const options: ScaffoldOptions = {
        force: false,
        full: true,
        // No docsStructure specified - should auto-detect simple
      };

      await scaffoldProject(tempDir, options);

      // Should use simple structure
      expect(fs.existsSync(path.join(tempDir, 'docs', 'tasks'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'docs', DOCS_04_OPERATIONS))).toBe(false);
    });

    it('should respect explicit --docs-structure over auto-detection', async () => {
      // Create existing arc42 structure
      fs.mkdirSync(path.join(tempDir, 'docs', DOCS_04_OPERATIONS), { recursive: true });

      const options: ScaffoldOptions = {
        force: true, // Force overwrite
        full: true,
        docsStructure: SIMPLE_DOCS_STRUCTURE, // Explicitly request simple
      };

      await scaffoldProject(tempDir, options);

      // Should use simple structure despite arc42 existing
      expect(fs.existsSync(path.join(tempDir, 'docs', 'tasks'))).toBe(true);
    });
  });
});
