/**
 * @file init.test.ts
 * Test suite for lumenflow init command (WU-1005)
 *
 * Tests scaffolding of new LumenFlow projects:
 * - .lumenflow.yaml configuration
 * - CLAUDE.md development guide
 * - AGENTS.md agent context
 * - ._legacy/ stamps directory
 * - docs/ WU storage structure
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('lumenflow init command (WU-1005)', () => {
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
      await scaffoldProject(tempDir, { force: false });

      const configPath = path.join(tempDir, '.lumenflow.yaml');
      expect(fs.existsSync(configPath)).toBe(true);

      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('version:');
      expect(content).toContain('lanes:');
    });

    it('should create CLAUDE.md template', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { force: false });

      const claudePath = path.join(tempDir, 'CLAUDE.md');
      expect(fs.existsSync(claudePath)).toBe(true);

      const content = fs.readFileSync(claudePath, 'utf-8');
      expect(content).toContain('TDD');
      expect(content).toContain('Worktree Discipline');
      expect(content).toContain('pnpm wu:claim');
    });

    it('should create AGENTS.md template', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { force: false });

      const agentsPath = path.join(tempDir, 'AGENTS.md');
      expect(fs.existsSync(agentsPath)).toBe(true);

      const content = fs.readFileSync(agentsPath, 'utf-8');
      expect(content).toContain('Context Loading');
      expect(content).toContain('Worktree');
    });

    it('should create ._legacy/ directory', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { force: false });

      const legacyDir = path.join(tempDir, '._legacy');
      expect(fs.existsSync(legacyDir)).toBe(true);
      expect(fs.statSync(legacyDir).isDirectory()).toBe(true);

      // Should have stamps subdirectory
      const stampsDir = path.join(legacyDir, 'stamps');
      expect(fs.existsSync(stampsDir)).toBe(true);
    });

    it('should create docs/ structure for WUs', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { force: false });

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
      const existingContent = '# Existing CLAUDE.md';
      const claudePath = path.join(tempDir, 'CLAUDE.md');
      fs.writeFileSync(claudePath, existingContent);

      await scaffoldProject(tempDir, { force: false });

      // Should preserve existing content
      const content = fs.readFileSync(claudePath, 'utf-8');
      expect(content).toBe(existingContent);
    });

    it('should overwrite existing files with --force', async () => {
      const { scaffoldProject } = await import('../src/init.js');

      // Create existing file
      const existingContent = '# Existing CLAUDE.md';
      const claudePath = path.join(tempDir, 'CLAUDE.md');
      fs.writeFileSync(claudePath, existingContent);

      await scaffoldProject(tempDir, { force: true });

      // Should have new template content
      const content = fs.readFileSync(claudePath, 'utf-8');
      expect(content).not.toBe(existingContent);
      expect(content).toContain('TDD');
    });

    it('should return list of created files', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      const result = await scaffoldProject(tempDir, { force: false });

      expect(result.created).toContain('.lumenflow.yaml');
      expect(result.created).toContain('CLAUDE.md');
      expect(result.created).toContain('AGENTS.md');
      expect(result.created).toContain('._legacy/stamps');
      expect(result.created).toContain('docs/04-operations/tasks/wu');
    });

    it('should return list of skipped files when not using --force', async () => {
      const { scaffoldProject } = await import('../src/init.js');

      // Create existing file
      fs.writeFileSync(path.join(tempDir, 'CLAUDE.md'), '# Existing');

      const result = await scaffoldProject(tempDir, { force: false });

      expect(result.skipped).toContain('CLAUDE.md');
    });
  });
});
