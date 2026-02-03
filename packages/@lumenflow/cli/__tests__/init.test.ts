/**
 * @file init.test.ts
 * Test suite for lumenflow init command (WU-1045)
 * WU-1085: Added --help support tests
 * WU-1309: Added docsStructure support
 */

/* eslint-disable sonarjs/no-duplicate-string -- Test file with repeated assertion patterns */
/* eslint-disable @typescript-eslint/no-dynamic-delete -- Necessary for cleanup in tests */

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
    docsStructure: 'arc42', // WU-1309: Explicitly use arc42 for legacy test compatibility
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

    it('should parse --client cline flag correctly (WU-1177)', async () => {
      process.argv = ['node', 'lumenflow-init', '--client', 'cline'];

      const { parseInitOptions } = await import('../src/init.js');
      const opts = parseInitOptions();

      expect(opts.client).toBe('cline');
    });
  });

  // WU-1177: Cline support
  describe('Cline vendor support (WU-1177)', () => {
    it('should create .clinerules file when --client cline is specified', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions, client: 'cline' });

      const clineRulesPath = path.join(tempDir, '.clinerules');
      expect(fs.existsSync(clineRulesPath)).toBe(true);

      const content = fs.readFileSync(clineRulesPath, 'utf-8');
      expect(content).toContain('LumenFlow');
    });

    it('should create .clinerules file when --client all is specified', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions, client: 'all' });

      const clineRulesPath = path.join(tempDir, '.clinerules');
      expect(fs.existsSync(clineRulesPath)).toBe(true);
    });

    it('should not create .clinerules file when --client claude is specified', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions, client: 'claude' });

      const clineRulesPath = path.join(tempDir, '.clinerules');
      expect(fs.existsSync(clineRulesPath)).toBe(false);
    });
  });

  // WU-1177: IDE auto-detection
  describe('IDE auto-detection (WU-1177)', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should detect Claude Code from CLAUDE_PROJECT_DIR env var', async () => {
      process.env.CLAUDE_PROJECT_DIR = '/some/path';
      const { detectIDEEnvironment } = await import('../src/init.js');
      const detected = detectIDEEnvironment();

      expect(detected).toBe('claude');
    });

    it('should detect Claude Code from CLAUDE_CODE env var', async () => {
      process.env.CLAUDE_CODE = '1';
      const { detectIDEEnvironment } = await import('../src/init.js');
      const detected = detectIDEEnvironment();

      expect(detected).toBe('claude');
    });

    it('should detect Cursor from CURSOR_* env vars', async () => {
      process.env.CURSOR_TRACE_ID = 'abc123';
      const { detectIDEEnvironment } = await import('../src/init.js');
      const detected = detectIDEEnvironment();

      expect(detected).toBe('cursor');
    });

    it('should detect Windsurf from WINDSURF_* env vars', async () => {
      process.env.WINDSURF_SESSION_ID = 'xyz789';
      const { detectIDEEnvironment } = await import('../src/init.js');
      const detected = detectIDEEnvironment();

      expect(detected).toBe('windsurf');
    });

    it('should detect VS Code from VSCODE_* env vars', async () => {
      process.env.VSCODE_GIT_ASKPASS_MAIN = '/some/path';
      const { detectIDEEnvironment } = await import('../src/init.js');
      const detected = detectIDEEnvironment();

      expect(detected).toBe('vscode');
    });

    it('should return undefined when no IDE detected', async () => {
      // Clear ALL IDE-related env vars (not just the ones we set in tests)
      const keysToDelete = Object.keys(process.env).filter(
        (key) =>
          key.startsWith('CLAUDE_') ||
          key.startsWith('CURSOR_') ||
          key.startsWith('WINDSURF_') ||
          key.startsWith('VSCODE_'),
      );
      keysToDelete.forEach((key) => delete process.env[key]);

      const { detectIDEEnvironment } = await import('../src/init.js');
      const detected = detectIDEEnvironment();

      expect(detected).toBeUndefined();
    });
  });

  // WU-1394: Recovery hooks scaffolding
  describe('recovery hooks scaffolding (WU-1394)', () => {
    it('should scaffold pre-compact-checkpoint.sh with executable permissions when Claude client is used', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions, client: 'claude' });

      const hookPath = path.join(tempDir, '.claude', 'hooks', 'pre-compact-checkpoint.sh');
      expect(fs.existsSync(hookPath)).toBe(true);

      // Check executable permission (0o755 = rwxr-xr-x)
      const stats = fs.statSync(hookPath);
      // eslint-disable-next-line no-bitwise
      expect(stats.mode & 0o755).toBe(0o755);
    });

    it('should scaffold session-start-recovery.sh with executable permissions when Claude client is used', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions, client: 'claude' });

      const hookPath = path.join(tempDir, '.claude', 'hooks', 'session-start-recovery.sh');
      expect(fs.existsSync(hookPath)).toBe(true);

      // Check executable permission
      const stats = fs.statSync(hookPath);
      // eslint-disable-next-line no-bitwise
      expect(stats.mode & 0o755).toBe(0o755);
    });

    it('should include PreCompact and SessionStart hooks in generated settings.json', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions, client: 'claude' });

      const settingsPath = path.join(tempDir, '.claude', 'settings.json');
      expect(fs.existsSync(settingsPath)).toBe(true);

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.PreCompact).toBeDefined();
      expect(settings.hooks.SessionStart).toBeDefined();

      // Verify PreCompact hook points to the correct script
      expect(settings.hooks.PreCompact[0].hooks[0].command).toContain('pre-compact-checkpoint.sh');

      // Verify SessionStart hooks for compact, resume, clear
      const sessionStartMatchers = settings.hooks.SessionStart.map(
        (h: { matcher: string }) => h.matcher,
      );
      expect(sessionStartMatchers).toContain('compact');
      expect(sessionStartMatchers).toContain('resume');
      expect(sessionStartMatchers).toContain('clear');
    });

    it('should not scaffold recovery hooks when client is not claude', async () => {
      const { scaffoldProject } = await import('../src/init.js');
      await scaffoldProject(tempDir, { ...baseOptions, client: 'cursor' });

      const hookPath = path.join(tempDir, '.claude', 'hooks', 'pre-compact-checkpoint.sh');
      expect(fs.existsSync(hookPath)).toBe(false);
    });
  });

  // WU-1177: Prerequisite checking (non-blocking)
  describe('checkPrerequisites (WU-1177)', () => {
    it('should check Node.js version', async () => {
      const { checkPrerequisites } = await import('../src/init.js');
      const result = checkPrerequisites();

      expect(result.node).toBeDefined();
      expect(result.node.version).toBeDefined();
      expect(result.node.passed).toBeDefined();
    });

    it('should check pnpm version', async () => {
      const { checkPrerequisites } = await import('../src/init.js');
      const result = checkPrerequisites();

      expect(result.pnpm).toBeDefined();
      expect(result.pnpm.version).toBeDefined();
      expect(result.pnpm.passed).toBeDefined();
    });

    it('should check git version', async () => {
      const { checkPrerequisites } = await import('../src/init.js');
      const result = checkPrerequisites();

      expect(result.git).toBeDefined();
      expect(result.git.version).toBeDefined();
      expect(result.git.passed).toBeDefined();
    });

    it('should return all prerequisites even if some fail', async () => {
      const { checkPrerequisites } = await import('../src/init.js');
      const result = checkPrerequisites();

      // Should have all three keys regardless of pass/fail
      expect(Object.keys(result)).toEqual(expect.arrayContaining(['node', 'pnpm', 'git']));
    });
  });
});
