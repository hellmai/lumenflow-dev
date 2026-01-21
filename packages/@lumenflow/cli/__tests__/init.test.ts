/**
 * @file init.test.ts
 * Test suite for lumenflow init command (WU-1045)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('lumenflow init command (WU-1045)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const baseOptions = {
    force: false,
    full: false,
    framework: undefined,
    defaultClient: 'none',
  } as const;

  describe('scaffoldProject (minimal)', () => {
    it('should create .lumenflow.config.yaml with defaults', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions });

      const configPath = path.join(tempDir, '.lumenflow.config.yaml');
      expect(fs.existsSync(configPath)).toBe(true);

      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('version');
      expect(content).toContain('directories');
    });

    it('should create LUMENFLOW.md', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions });

      const lumenflowPath = path.join(tempDir, 'LUMENFLOW.md');
      expect(fs.existsSync(lumenflowPath)).toBe(true);

      const content = fs.readFileSync(lumenflowPath, 'utf-8');
      expect(content).toContain('ALWAYS Run wu:done');
      expect(content).toContain('LUMENFLOW.md');
      expect(content).toContain('.lumenflow/agents');
    });

    it('should create .lumenflow/constraints.md', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions });

      const constraintsPath = path.join(tempDir, '.lumenflow', 'constraints.md');
      expect(fs.existsSync(constraintsPath)).toBe(true);

      const content = fs.readFileSync(constraintsPath, 'utf-8');
      expect(content).toContain('Non-Negotiable Constraints');
      expect(content).toContain('Mini Audit Checklist');
    });

    it('should create .lumenflow/agents directory', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions });

      const agentsDir = path.join(tempDir, '.lumenflow', 'agents');
      expect(fs.existsSync(agentsDir)).toBe(true);
      expect(fs.statSync(agentsDir).isDirectory()).toBe(true);
    });

    it('should not scaffold full docs by default', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions });

      const backlogPath = path.join(tempDir, 'docs', '04-operations', 'tasks', 'backlog.md');
      expect(fs.existsSync(backlogPath)).toBe(false);
    });

    it('should not overwrite existing files without --force', async () => {
      const { scaffoldProject } = await import('../src/init.js');

      const existingContent = '# Existing LUMENFLOW.md';
      const lumenflowPath = path.join(tempDir, 'LUMENFLOW.md');
      fs.writeFileSync(lumenflowPath, existingContent);

      await scaffoldProject(tempDir, { ...baseOptions });

      const content = fs.readFileSync(lumenflowPath, 'utf-8');
      expect(content).toBe(existingContent);
    });

    it('should overwrite existing files with --force', async () => {
      const { scaffoldProject } = await import('../src/init.js');

      const existingContent = '# Existing LUMENFLOW.md';
      const lumenflowPath = path.join(tempDir, 'LUMENFLOW.md');
      fs.writeFileSync(lumenflowPath, existingContent);

      await scaffoldProject(tempDir, { ...baseOptions, force: true });

      const content = fs.readFileSync(lumenflowPath, 'utf-8');
      expect(content).not.toBe(existingContent);
      expect(content).toContain('ALWAYS Run wu:done');
    });

    it('should return list of created files', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      const result = await scaffoldProject(tempDir, { ...baseOptions });

      expect(result.created).toContain('.lumenflow.config.yaml');
      expect(result.created).toContain('LUMENFLOW.md');
      expect(result.created).toContain('.lumenflow/agents');
    });

    it('should return list of skipped files when not using --force', async () => {
      const { scaffoldProject } = await import('../src/init.js');

      fs.writeFileSync(path.join(tempDir, 'LUMENFLOW.md'), '# Existing');

      const result = await scaffoldProject(tempDir, { ...baseOptions });

      expect(result.skipped).toContain('LUMENFLOW.md');
    });
  });

  describe('full mode', () => {
    it('should scaffold docs/04-operations tasks structure with --full', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions, full: true });

      const backlogPath = path.join(tempDir, 'docs', '04-operations', 'tasks', 'backlog.md');
      const statusPath = path.join(tempDir, 'docs', '04-operations', 'tasks', 'status.md');
      const templatePath = path.join(
        tempDir,
        'docs',
        '04-operations',
        'tasks',
        'templates',
        'wu-template.yaml',
      );

      expect(fs.existsSync(backlogPath)).toBe(true);
      expect(fs.existsSync(statusPath)).toBe(true);
      expect(fs.existsSync(templatePath)).toBe(true);
    });
  });

  describe('framework overlay', () => {
    it('should scaffold framework hint + overlay docs with --framework', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions, framework: 'Next.js' });

      const hintPath = path.join(tempDir, '.lumenflow.framework.yaml');
      const overlayPath = path.join(
        tempDir,
        'docs',
        '04-operations',
        '_frameworks',
        'next-js',
        'README.md',
      );

      expect(fs.existsSync(hintPath)).toBe(true);
      expect(fs.existsSync(overlayPath)).toBe(true);

      const content = fs.readFileSync(hintPath, 'utf-8');
      expect(content).toContain('framework: "Next.js"');
    });
  });

  describe('vendor overlays', () => {
    it('should scaffold Claude overlay when default client is claude-code', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions, defaultClient: 'claude-code' });

      expect(fs.existsSync(path.join(tempDir, 'CLAUDE.md'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.claude', 'agents'))).toBe(true);
    });

    it('should not scaffold Claude overlay when default client is none', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions });

      expect(fs.existsSync(path.join(tempDir, 'CLAUDE.md'))).toBe(false);
    });
  });
});
