/**
 * @file init.test.ts
 * Test suite for lumenflow init command (WU-1045)
 * WU-1085: Added --help support tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  // WU-1083: Agent onboarding docs and skills scaffolding
  describe('agent onboarding docs (WU-1083)', () => {
    const onboardingDir = 'docs/04-operations/_frameworks/lumenflow/agent/onboarding';

    it('should scaffold agent onboarding docs with --full', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions, full: true });

      const quickRefPath = path.join(tempDir, onboardingDir, 'quick-ref-commands.md');
      const firstMistakesPath = path.join(tempDir, onboardingDir, 'first-wu-mistakes.md');
      const troubleshootingPath = path.join(tempDir, onboardingDir, 'troubleshooting-wu-done.md');
      const safetyCardPath = path.join(tempDir, onboardingDir, 'agent-safety-card.md');
      const checklistPath = path.join(tempDir, onboardingDir, 'wu-create-checklist.md');

      expect(fs.existsSync(quickRefPath)).toBe(true);
      expect(fs.existsSync(firstMistakesPath)).toBe(true);
      expect(fs.existsSync(troubleshootingPath)).toBe(true);
      expect(fs.existsSync(safetyCardPath)).toBe(true);
      expect(fs.existsSync(checklistPath)).toBe(true);
    });

    it('should include wu-create-checklist.md with required fields table', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions, full: true });

      const checklistPath = path.join(tempDir, onboardingDir, 'wu-create-checklist.md');
      const content = fs.readFileSync(checklistPath, 'utf-8');

      // Verify required content per acceptance criteria
      expect(content).toContain('Required Fields');
      expect(content).toContain('--id');
      expect(content).toContain('--lane');
      expect(content).toContain('--title');
      expect(content).toContain('--description');
      expect(content).toContain('--acceptance');
    });

    it('should include lane format rules in wu-create-checklist.md', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions, full: true });

      const checklistPath = path.join(tempDir, onboardingDir, 'wu-create-checklist.md');
      const content = fs.readFileSync(checklistPath, 'utf-8');

      // Verify lane format documentation
      expect(content).toContain('Parent: Sublane');
      expect(content).toContain('.lumenflow.config.yaml');
    });

    it('should include plan storage locations in wu-create-checklist.md', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions, full: true });

      const checklistPath = path.join(tempDir, onboardingDir, 'wu-create-checklist.md');
      const content = fs.readFileSync(checklistPath, 'utf-8');

      // Verify plan storage documentation
      expect(content).toContain('~/.lumenflow/plans');
      expect(content).toContain('--spec-refs');
    });

    it('should scaffold onboarding docs for Claude vendor even without --full', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions, defaultClient: 'claude-code' });

      // Agent onboarding docs should be created when Claude vendor is detected
      const checklistPath = path.join(tempDir, onboardingDir, 'wu-create-checklist.md');
      expect(fs.existsSync(checklistPath)).toBe(true);
    });
  });

  describe('Claude skills scaffolding (WU-1083)', () => {
    it('should scaffold .claude/skills/ with wu-lifecycle, worktree-discipline, lumenflow-gates', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions, defaultClient: 'claude-code' });

      const wuLifecyclePath = path.join(tempDir, '.claude', 'skills', 'wu-lifecycle', 'SKILL.md');
      const worktreePath = path.join(
        tempDir,
        '.claude',
        'skills',
        'worktree-discipline',
        'SKILL.md',
      );
      const gatesPath = path.join(tempDir, '.claude', 'skills', 'lumenflow-gates', 'SKILL.md');

      expect(fs.existsSync(wuLifecyclePath)).toBe(true);
      expect(fs.existsSync(worktreePath)).toBe(true);
      expect(fs.existsSync(gatesPath)).toBe(true);
    });

    it('should create wu-lifecycle skill with state machine and core commands', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions, defaultClient: 'claude-code' });

      const skillPath = path.join(tempDir, '.claude', 'skills', 'wu-lifecycle', 'SKILL.md');
      const content = fs.readFileSync(skillPath, 'utf-8');

      expect(content).toContain('wu:claim');
      expect(content).toContain('wu:done');
      expect(content).toContain('ready');
      expect(content).toContain('in_progress');
    });

    it('should create worktree-discipline skill with absolute path trap prevention', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions, defaultClient: 'claude-code' });

      const skillPath = path.join(tempDir, '.claude', 'skills', 'worktree-discipline', 'SKILL.md');
      const content = fs.readFileSync(skillPath, 'utf-8');

      expect(content).toContain('absolute path');
      expect(content).toContain('worktree');
      expect(content).toContain('relative');
    });

    it('should create lumenflow-gates skill with gate sequence', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions, defaultClient: 'claude-code' });

      const skillPath = path.join(tempDir, '.claude', 'skills', 'lumenflow-gates', 'SKILL.md');
      const content = fs.readFileSync(skillPath, 'utf-8');

      expect(content).toContain('pnpm gates');
      expect(content).toContain('format');
      expect(content).toContain('lint');
      expect(content).toContain('typecheck');
    });

    it('should not scaffold skills when default client is none', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions });

      const skillsDir = path.join(tempDir, '.claude', 'skills');
      expect(fs.existsSync(skillsDir)).toBe(false);
    });
  });

  // WU-1085: CLI argument parsing with --help support
  describe('CLI argument parsing (WU-1085)', () => {
    let mockExit: ReturnType<typeof vi.spyOn>;
    let mockConsoleLog: ReturnType<typeof vi.spyOn>;
    let originalArgv: string[];

    beforeEach(() => {
      originalArgv = process.argv;
      mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      process.argv = originalArgv;
      mockExit.mockRestore();
      mockConsoleLog.mockRestore();
      vi.resetModules();
    });

    it('should show help when --help flag is passed and not run scaffolding', async () => {
      // Simulate --help flag
      process.argv = ['node', 'lumenflow-init', '--help'];

      // Import the module - the --help should trigger help display and exit
      const { parseInitOptions } = await import('../src/init.js');

      // Should throw/exit when --help is passed (Commander behavior)
      expect(() => parseInitOptions()).toThrow();
    });

    it('should show help when -h flag is passed', async () => {
      process.argv = ['node', 'lumenflow-init', '-h'];

      const { parseInitOptions } = await import('../src/init.js');

      expect(() => parseInitOptions()).toThrow();
    });

    it('should show version when --version flag is passed', async () => {
      process.argv = ['node', 'lumenflow-init', '--version'];

      const { parseInitOptions } = await import('../src/init.js');

      expect(() => parseInitOptions()).toThrow();
    });

    it('should parse --full flag correctly', async () => {
      process.argv = ['node', 'lumenflow-init', '--full'];

      const { parseInitOptions } = await import('../src/init.js');
      const opts = parseInitOptions();

      expect(opts.full).toBe(true);
    });

    it('should parse --force flag correctly', async () => {
      process.argv = ['node', 'lumenflow-init', '--force'];

      const { parseInitOptions } = await import('../src/init.js');
      const opts = parseInitOptions();

      expect(opts.force).toBe(true);
    });

    it('should parse --framework flag correctly', async () => {
      process.argv = ['node', 'lumenflow-init', '--framework', 'Next.js'];

      const { parseInitOptions } = await import('../src/init.js');
      const opts = parseInitOptions();

      expect(opts.framework).toBe('Next.js');
    });

    it('should parse --vendor flag correctly', async () => {
      process.argv = ['node', 'lumenflow-init', '--vendor', 'claude'];

      const { parseInitOptions } = await import('../src/init.js');
      const opts = parseInitOptions();

      expect(opts.vendor).toBe('claude');
    });

    it('should parse --preset flag correctly', async () => {
      process.argv = ['node', 'lumenflow-init', '--preset', 'node'];

      const { parseInitOptions } = await import('../src/init.js');
      const opts = parseInitOptions();

      expect(opts.preset).toBe('node');
    });
  });
});
