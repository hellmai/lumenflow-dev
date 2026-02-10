/**
 * @file init-greenfield.test.ts
 * Tests for greenfield onboarding with initiative-first workflow (WU-1364)
 *
 * Verifies:
 * - Init output includes initiative-first workflow guidance
 * - starting-prompt.md has 'When Starting From Product Vision' section
 * - Init auto-creates initial commit when git repo has no commits
 * - Init auto-sets git.requireRemote=false when no remote configured
 * - Default lane-inference template includes Core and Feature as parent lanes
 * - LUMENFLOW.md mentions initiatives and when to use them
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';

import { scaffoldProject, type ScaffoldOptions } from '../init.js';
import * as yaml from 'yaml';

// Constants to avoid duplicate strings
const ARC42_DOCS_STRUCTURE = 'arc42' as const;
const STARTING_PROMPT_FILE = 'starting-prompt.md';
const LUMENFLOW_CONFIG_FILE = '.lumenflow.config.yaml';
const LANE_INFERENCE_FILE = '.lumenflow.lane-inference.yaml';

describe('greenfield onboarding (WU-1364)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-greenfield-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function getOnboardingDir(): string {
    return path.join(
      tempDir,
      'docs',
      '04-operations',
      '_frameworks',
      'lumenflow',
      'agent',
      'onboarding',
    );
  }

  function getArc42Options(): ScaffoldOptions {
    return {
      force: false,
      full: true,
      docsStructure: ARC42_DOCS_STRUCTURE,
    };
  }

  /**
   * Initialize a git repo without commits (empty repo state)
   * Uses execFileSync for safety (no shell injection)
   */
  function initEmptyGitRepo(): void {
    execFileSync('git', ['init'], { cwd: tempDir, stdio: 'pipe' });
    // Configure git user for commit (required in some environments)
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: tempDir,
      stdio: 'pipe',
    });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tempDir, stdio: 'pipe' });
  }

  /**
   * Initialize a git repo with an initial commit
   */
  function initGitRepoWithCommit(): void {
    initEmptyGitRepo();
    fs.writeFileSync(path.join(tempDir, '.gitkeep'), '');
    execFileSync('git', ['add', '.gitkeep'], { cwd: tempDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: tempDir, stdio: 'pipe' });
  }

  describe('AC: starting-prompt.md has initiative-first workflow section', () => {
    it('should include "When Starting From Product Vision" section in starting-prompt.md', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const startingPromptPath = path.join(getOnboardingDir(), STARTING_PROMPT_FILE);
      expect(fs.existsSync(startingPromptPath)).toBe(true);

      const content = fs.readFileSync(startingPromptPath, 'utf-8');
      expect(content).toContain('When Starting From Product Vision');
    });

    it('should describe 4-step initiative workflow in product vision section', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const startingPromptPath = path.join(getOnboardingDir(), STARTING_PROMPT_FILE);
      const content = fs.readFileSync(startingPromptPath, 'utf-8');

      // Should mention initiative creation
      expect(content).toContain('initiative:create');
      // Should mention phased work
      expect(content).toMatch(/phase|INIT-/i);
      // Should mention WU organization under initiatives
      expect(content).toMatch(/initiative.*WU|WU.*initiative/i);
    });

    it('should warn against creating orphan WUs without initiative structure', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const startingPromptPath = path.join(getOnboardingDir(), STARTING_PROMPT_FILE);
      const content = fs.readFileSync(startingPromptPath, 'utf-8');

      // Should have guidance about when NOT to create standalone WUs
      expect(content).toMatch(/don't|avoid|instead.*initiative/i);
    });
  });

  describe('AC: Init renames master branch to main (WU-1497)', () => {
    it('should rename master to main when git init defaults to master', async () => {
      // Simulate git init with master as default branch
      execFileSync('git', ['init', '--initial-branch=master'], { cwd: tempDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], {
        cwd: tempDir,
        stdio: 'pipe',
      });
      execFileSync('git', ['config', 'user.name', 'Test User'], {
        cwd: tempDir,
        stdio: 'pipe',
      });

      // Verify we are on master
      const branchBefore = execFileSync('git', ['branch', '--show-current'], {
        cwd: tempDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();
      expect(branchBefore).toBe('master');

      await scaffoldProject(tempDir, getArc42Options());

      // After scaffolding, branch should be renamed to main
      const branchAfter = execFileSync('git', ['branch', '--show-current'], {
        cwd: tempDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();
      expect(branchAfter).toBe('main');
    });

    it('should not rename when already on main', async () => {
      initEmptyGitRepo();

      // Verify we are on main (modern git default)
      const branchBefore = execFileSync('git', ['branch', '--show-current'], {
        cwd: tempDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();

      // If git defaults to main, this test verifies no error on rename
      // If git defaults to master, the previous test covers that
      if (branchBefore === 'main') {
        await scaffoldProject(tempDir, getArc42Options());

        const branchAfter = execFileSync('git', ['branch', '--show-current'], {
          cwd: tempDir,
          encoding: 'utf-8',
          stdio: 'pipe',
        }).trim();
        expect(branchAfter).toBe('main');
      }
    });

    it('should not rename non-master branches', async () => {
      initGitRepoWithCommit();
      // Create and switch to a feature branch
      execFileSync('git', ['checkout', '-b', 'feature-branch'], {
        cwd: tempDir,
        stdio: 'pipe',
      });

      await scaffoldProject(tempDir, getArc42Options());

      // Should still be on feature-branch (not renamed)
      const branchAfter = execFileSync('git', ['branch', '--show-current'], {
        cwd: tempDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();
      expect(branchAfter).toBe('feature-branch');
    });
  });

  describe('AC: Init auto-creates initial commit when git repo has no commits', () => {
    it('should create initial commit in empty git repo', async () => {
      initEmptyGitRepo();

      // Verify no commits exist
      try {
        execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tempDir, stdio: 'pipe' });
        throw new Error('Expected HEAD to not exist');
      } catch {
        // Expected: fatal: ambiguous argument 'HEAD'
      }

      await scaffoldProject(tempDir, getArc42Options());

      // Now HEAD should exist
      const result = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: tempDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      expect(result.trim()).toMatch(/^[a-f0-9]{40}$/);
    });

    it('should not create extra commit if repo already has commits', async () => {
      initGitRepoWithCommit();

      // Get initial commit count
      const beforeCount = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
        cwd: tempDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();

      await scaffoldProject(tempDir, getArc42Options());

      // Commit count should be the same (init doesn't auto-commit if commits exist)
      const afterCount = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
        cwd: tempDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();

      expect(afterCount).toBe(beforeCount);
    });

    it('should skip auto-commit if not in a git repo', async () => {
      // Not a git repo - just a plain directory
      await scaffoldProject(tempDir, getArc42Options());

      // Should not fail, just skip the git operations
      expect(fs.existsSync(path.join(tempDir, LUMENFLOW_CONFIG_FILE))).toBe(true);
    });
  });

  describe('AC: Init auto-sets git.requireRemote=false when no remote configured', () => {
    it('should set requireRemote=false in config when no origin remote', async () => {
      initGitRepoWithCommit();
      // No remote added

      await scaffoldProject(tempDir, getArc42Options());

      const configPath = path.join(tempDir, LUMENFLOW_CONFIG_FILE);
      const content = fs.readFileSync(configPath, 'utf-8');

      expect(content).toContain('requireRemote: false');
    });

    it('should not set requireRemote=false if origin remote exists', async () => {
      initGitRepoWithCommit();
      // Add a remote
      execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/test/repo.git'], {
        cwd: tempDir,
        stdio: 'pipe',
      });

      await scaffoldProject(tempDir, getArc42Options());

      const configPath = path.join(tempDir, LUMENFLOW_CONFIG_FILE);
      const content = fs.readFileSync(configPath, 'utf-8');

      // Should not have requireRemote: false (remote exists)
      expect(content).not.toContain('requireRemote: false');
    });

    it('should skip remote check if not in a git repo', async () => {
      // Not a git repo
      await scaffoldProject(tempDir, getArc42Options());

      const configPath = path.join(tempDir, LUMENFLOW_CONFIG_FILE);
      const content = fs.readFileSync(configPath, 'utf-8');

      // When not in a git repo, should default to requireRemote: false for safety
      expect(content).toContain('requireRemote: false');
    });
  });

  describe('AC: Default lane-inference template includes Core and Feature parent lanes', () => {
    it('should include Core as a parent lane', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const laneInferencePath = path.join(tempDir, LANE_INFERENCE_FILE);
      expect(fs.existsSync(laneInferencePath)).toBe(true);

      const content = fs.readFileSync(laneInferencePath, 'utf-8');
      // Should have Core as a top-level parent lane (not just Framework: Core)
      expect(content).toMatch(/^Core:/m);
    });

    it('should include Feature as a parent lane', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const laneInferencePath = path.join(tempDir, LANE_INFERENCE_FILE);
      const content = fs.readFileSync(laneInferencePath, 'utf-8');

      // Should have Feature as a top-level parent lane
      expect(content).toMatch(/^Feature:/m);
    });

    it('should support intuitive lane names like "Core: Platform"', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const laneInferencePath = path.join(tempDir, LANE_INFERENCE_FILE);
      const content = fs.readFileSync(laneInferencePath, 'utf-8');

      // Should have sublanes under Core and Feature
      // e.g., Core: followed by sublanes like Platform, Library, etc.
      expect(content).toMatch(/Core:\n\s+\w+:/m);
      expect(content).toMatch(/Feature:\n\s+\w+:/m);
    });
  });

  describe('AC: LUMENFLOW.md mentions initiatives and when to use them', () => {
    it('should mention initiatives in generated LUMENFLOW.md', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const lumenflowPath = path.join(tempDir, 'LUMENFLOW.md');
      const content = fs.readFileSync(lumenflowPath, 'utf-8');

      expect(content).toMatch(/initiative/i);
    });

    it('should explain when to use initiatives vs standalone WUs', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const lumenflowPath = path.join(tempDir, 'LUMENFLOW.md');
      const content = fs.readFileSync(lumenflowPath, 'utf-8');

      // Should mention when to use initiatives
      expect(content).toMatch(/multi-phase|product vision|larger|complex/i);
    });

    it('should reference initiative:create command', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const lumenflowPath = path.join(tempDir, 'LUMENFLOW.md');
      const content = fs.readFileSync(lumenflowPath, 'utf-8');

      expect(content).toContain('initiative:create');
    });
  });

  describe('AC: Init output includes initiative-first workflow guidance', () => {
    // This test verifies the console output, which requires capturing stdout
    // We'll mock console.log to capture the output
    it('should print initiative-first guidance in init output', async () => {
      const consoleLogs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        consoleLogs.push(args.join(' '));
      };

      try {
        // Import and run main() to capture console output
        const { main } = await import('../init.js');

        // Change to temp directory and run init
        const originalCwd = process.cwd();
        process.chdir(tempDir);

        // Mock process.argv for parseInitOptions
        const originalArgv = process.argv;
        process.argv = ['node', 'init', '--full'];

        try {
          await main();
        } finally {
          process.argv = originalArgv;
          process.chdir(originalCwd);
        }

        const output = consoleLogs.join('\n');

        // Should mention initiatives in the "Next steps" or guidance section
        expect(output).toMatch(/initiative|product vision|INIT-/i);
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe('AC: WU-1576 — Init with --client claude auto-runs integrate', () => {
    function getClaudeOptions(): ScaffoldOptions {
      return {
        force: false,
        full: true,
        client: 'claude',
        docsStructure: ARC42_DOCS_STRUCTURE,
      };
    }

    it('should generate enforcement hook scripts during init with --client claude', async () => {
      initEmptyGitRepo();
      await scaffoldProject(tempDir, getClaudeOptions());

      // Enforcement hooks should exist after init (not requiring separate integrate step)
      const hooksDir = path.join(tempDir, '.claude', 'hooks');
      expect(fs.existsSync(path.join(hooksDir, 'enforce-worktree.sh'))).toBe(true);
      expect(fs.existsSync(path.join(hooksDir, 'require-wu.sh'))).toBe(true);
      expect(fs.existsSync(path.join(hooksDir, 'warn-incomplete.sh'))).toBe(true);
    });

    it('should include enforcement hooks in the initial commit', async () => {
      initEmptyGitRepo();
      await scaffoldProject(tempDir, getClaudeOptions());

      // All enforcement hooks should be committed (not left as untracked files)
      const statusOutput = execFileSync('git', ['status', '--porcelain'], {
        cwd: tempDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();

      // No untracked or modified files should remain for hooks
      expect(statusOutput).not.toContain('.claude/hooks/enforce-worktree.sh');
      expect(statusOutput).not.toContain('.claude/hooks/require-wu.sh');
      expect(statusOutput).not.toContain('.claude/hooks/warn-incomplete.sh');
      expect(statusOutput).not.toContain('.claude/settings.json');
    });

    it('should update settings.json with hook configuration during init', async () => {
      initEmptyGitRepo();
      await scaffoldProject(tempDir, getClaudeOptions());

      const settingsPath = path.join(tempDir, '.claude', 'settings.json');
      expect(fs.existsSync(settingsPath)).toBe(true);

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      // Should have PreToolUse hooks for Write|Edit
      expect(settings.hooks?.PreToolUse).toBeDefined();
      const writeEditHook = settings.hooks.PreToolUse.find(
        (h: { matcher: string }) => h.matcher === 'Write|Edit',
      );
      expect(writeEditHook).toBeDefined();
      expect(writeEditHook.hooks.length).toBeGreaterThanOrEqual(2); // enforce-worktree + require-wu
    });

    it('should NOT generate enforcement hooks for non-claude clients', async () => {
      initEmptyGitRepo();
      await scaffoldProject(tempDir, {
        force: false,
        full: true,
        client: 'cursor',
        docsStructure: ARC42_DOCS_STRUCTURE,
      });

      // Cursor client should not have claude enforcement hooks
      const hooksDir = path.join(tempDir, '.claude', 'hooks');
      expect(fs.existsSync(path.join(hooksDir, 'enforce-worktree.sh'))).toBe(false);
    });

    it('should report enforcement hooks in created files list', async () => {
      initEmptyGitRepo();
      const result = await scaffoldProject(tempDir, getClaudeOptions());

      // The result.created should mention enforcement hooks
      const createdStr = result.created.join('\n');
      expect(createdStr).toContain('enforce-worktree.sh');
      expect(createdStr).toContain('require-wu.sh');
      expect(createdStr).toContain('warn-incomplete.sh');
    });
  });

  describe('AC: WU-1576 — Init Next Steps mentions integrate for Claude', () => {
    it('should mention enforcement hooks in Next Steps when --client claude', async () => {
      const consoleLogs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        consoleLogs.push(args.join(' '));
      };

      try {
        const { main } = await import('../init.js');
        const originalCwd = process.cwd();
        process.chdir(tempDir);
        const originalArgv = process.argv;
        process.argv = ['node', 'init', '--full', '--client', 'claude'];

        try {
          await main();
        } finally {
          process.argv = originalArgv;
          process.chdir(originalCwd);
        }

        const output = consoleLogs.join('\n');
        // Should mention that enforcement hooks were installed
        expect(output).toMatch(/enforcement hooks|hooks installed|integrate/i);
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe('AC: WU-1576 — Default lane definitions have zero overlaps', () => {
    it('should generate lane definitions with no overlapping code_paths', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const configPath = path.join(tempDir, LUMENFLOW_CONFIG_FILE);
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = yaml.parse(content);

      const lanes = config.lanes?.definitions ?? [];
      expect(lanes.length).toBeGreaterThan(0);

      // Check every pair of lanes for overlapping code_paths
      for (let i = 0; i < lanes.length; i++) {
        for (let j = i + 1; j < lanes.length; j++) {
          const pathsA = lanes[i].code_paths ?? [];
          const pathsB = lanes[j].code_paths ?? [];
          // No path should appear in both lanes
          const overlap = pathsA.filter((p: string) => pathsB.includes(p));
          expect(overlap).toEqual([]);
        }
      }
    });

    it('should not have glob patterns where one lane is a subset of another', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const configPath = path.join(tempDir, LUMENFLOW_CONFIG_FILE);
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = yaml.parse(content);

      const lanes = config.lanes?.definitions ?? [];

      // Collect all code_paths with their lane names
      const allPaths: Array<{ lane: string; pattern: string }> = [];
      for (const lane of lanes) {
        for (const p of lane.code_paths ?? []) {
          allPaths.push({ lane: lane.name, pattern: p });
        }
      }

      // Check that no path is a prefix/subset of another lane's path
      // e.g., "apps/**" should not coexist with "apps/web/**" in different lanes
      for (const a of allPaths) {
        for (const b of allPaths) {
          if (a.lane === b.lane) continue;
          // Strip glob suffix and check prefix overlap
          const baseA = a.pattern.replace(/\/?\*\*.*$/, '');
          const baseB = b.pattern.replace(/\/?\*\*.*$/, '');
          if (baseA && baseB && baseA !== baseB) {
            const aContainsB = baseB.startsWith(baseA + '/');
            const bContainsA = baseA.startsWith(baseB + '/');
            expect(aContainsB || bContainsA).toBe(false);
          }
        }
      }
    });
  });
});
