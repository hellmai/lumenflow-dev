/**
 * @file git-operations.test.ts
 * @description Tests for git operation CLI commands (WU-1109)
 *
 * Git operations provide WU-aware git wrappers with:
 * - Guard checks for protected branches
 * - Worktree-aware context
 * - Audit logging
 *
 * TDD: RED phase - these tests define expected behavior before implementation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Test imports - these will fail until implementation exists (RED phase)
import {
  getGitStatus,
  parseGitStatusArgs,
  type GitStatusResult,
  type GitStatusArgs,
} from '../git-status.js';

import { getGitDiff, parseGitDiffArgs, type GitDiffResult, type GitDiffArgs } from '../git-diff.js';

import { getGitLog, parseGitLogArgs, type GitLogResult, type GitLogArgs } from '../git-log.js';

import {
  getGitBranch,
  parseGitBranchArgs,
  type GitBranchResult,
  type GitBranchArgs,
} from '../git-branch.js';

import {
  guardMainBranch,
  parseGuardMainBranchArgs,
  type GuardMainBranchResult,
  type GuardMainBranchArgs,
} from '../guard-main-branch.js';

// ============================================================================
// GIT-STATUS TESTS
// ============================================================================

describe('git-status CLI', () => {
  describe('source file existence', () => {
    it('should have the CLI source file', () => {
      const srcPath = join(__dirname, '../git-status.ts');
      expect(existsSync(srcPath)).toBe(true);
    });

    it('should be buildable (dist file exists after build)', () => {
      const distPath = join(__dirname, '../../dist/git-status.js');
      expect(existsSync(distPath)).toBe(true);
    });
  });

  describe('parseGitStatusArgs', () => {
    it('should parse --porcelain flag', () => {
      const args = parseGitStatusArgs(['node', 'git-status', '--porcelain']);
      expect(args.porcelain).toBe(true);
    });

    it('should parse --short flag', () => {
      const args = parseGitStatusArgs(['node', 'git-status', '--short']);
      expect(args.short).toBe(true);
    });

    it('should parse --help flag', () => {
      const args = parseGitStatusArgs(['node', 'git-status', '--help']);
      expect(args.help).toBe(true);
    });

    it('should parse path argument', () => {
      const args = parseGitStatusArgs(['node', 'git-status', 'src/']);
      expect(args.path).toBe('src/');
    });

    it('should default to no flags', () => {
      const args = parseGitStatusArgs(['node', 'git-status']);
      expect(args.porcelain).toBe(false);
      expect(args.short).toBe(false);
    });
  });

  describe('getGitStatus', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = join(tmpdir(), `git-status-test-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
      // Initialize a git repo
      execSync('git init', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'ignore' });
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('should return success for clean repo', async () => {
      const result = await getGitStatus({ baseDir: tempDir });

      expect(result.success).toBe(true);
      expect(result.isClean).toBe(true);
    });

    it('should detect untracked files', async () => {
      await writeFile(join(tempDir, 'new-file.txt'), 'content');

      const result = await getGitStatus({ baseDir: tempDir });

      expect(result.success).toBe(true);
      expect(result.isClean).toBe(false);
      expect(result.untracked).toContain('new-file.txt');
    });

    it('should detect modified files', async () => {
      await writeFile(join(tempDir, 'file.txt'), 'initial');
      execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });
      execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });
      await writeFile(join(tempDir, 'file.txt'), 'modified');

      const result = await getGitStatus({ baseDir: tempDir });

      expect(result.success).toBe(true);
      expect(result.isClean).toBe(false);
      expect(result.modified).toContain('file.txt');
    });

    it('should detect staged files', async () => {
      await writeFile(join(tempDir, 'staged.txt'), 'content');
      execSync('git add staged.txt', { cwd: tempDir, stdio: 'ignore' });

      const result = await getGitStatus({ baseDir: tempDir });

      expect(result.success).toBe(true);
      expect(result.staged).toContain('staged.txt');
    });

    it('should return porcelain output when requested', async () => {
      await writeFile(join(tempDir, 'file.txt'), 'content');

      const result = await getGitStatus({ baseDir: tempDir, porcelain: true });

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output).toContain('?? file.txt');
    });
  });
});

// ============================================================================
// GIT-DIFF TESTS
// ============================================================================

describe('git-diff CLI', () => {
  describe('source file existence', () => {
    it('should have the CLI source file', () => {
      const srcPath = join(__dirname, '../git-diff.ts');
      expect(existsSync(srcPath)).toBe(true);
    });

    it('should be buildable (dist file exists after build)', () => {
      const distPath = join(__dirname, '../../dist/git-diff.js');
      expect(existsSync(distPath)).toBe(true);
    });
  });

  describe('parseGitDiffArgs', () => {
    it('should parse --staged flag', () => {
      const args = parseGitDiffArgs(['node', 'git-diff', '--staged']);
      expect(args.staged).toBe(true);
    });

    it('should parse --cached flag as alias for staged', () => {
      const args = parseGitDiffArgs(['node', 'git-diff', '--cached']);
      expect(args.staged).toBe(true);
    });

    it('should parse --name-only flag', () => {
      const args = parseGitDiffArgs(['node', 'git-diff', '--name-only']);
      expect(args.nameOnly).toBe(true);
    });

    it('should parse --stat flag', () => {
      const args = parseGitDiffArgs(['node', 'git-diff', '--stat']);
      expect(args.stat).toBe(true);
    });

    it('should parse commit ref', () => {
      const args = parseGitDiffArgs(['node', 'git-diff', 'HEAD~1']);
      expect(args.ref).toBe('HEAD~1');
    });

    it('should parse file path', () => {
      const args = parseGitDiffArgs(['node', 'git-diff', '--', 'src/file.ts']);
      expect(args.path).toBe('src/file.ts');
    });

    it('should parse --help flag', () => {
      const args = parseGitDiffArgs(['node', 'git-diff', '--help']);
      expect(args.help).toBe(true);
    });
  });

  describe('getGitDiff', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = join(tmpdir(), `git-diff-test-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
      execSync('git init', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'ignore' });
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('should return empty diff for clean repo', async () => {
      const result = await getGitDiff({ baseDir: tempDir });

      expect(result.success).toBe(true);
      expect(result.hasDiff).toBe(false);
    });

    it('should detect diff in modified files', async () => {
      await writeFile(join(tempDir, 'file.txt'), 'initial');
      execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });
      execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });
      await writeFile(join(tempDir, 'file.txt'), 'modified');

      const result = await getGitDiff({ baseDir: tempDir });

      expect(result.success).toBe(true);
      expect(result.hasDiff).toBe(true);
      expect(result.diff).toContain('-initial');
      expect(result.diff).toContain('+modified');
    });

    it('should show staged diff when --staged flag is used', async () => {
      await writeFile(join(tempDir, 'file.txt'), 'initial');
      execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });
      execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });
      await writeFile(join(tempDir, 'file.txt'), 'modified');
      execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });

      const result = await getGitDiff({ baseDir: tempDir, staged: true });

      expect(result.success).toBe(true);
      expect(result.hasDiff).toBe(true);
    });

    it('should show only file names when --name-only flag is used', async () => {
      await writeFile(join(tempDir, 'file.txt'), 'initial');
      execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });
      execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });
      await writeFile(join(tempDir, 'file.txt'), 'modified');

      const result = await getGitDiff({ baseDir: tempDir, nameOnly: true });

      expect(result.success).toBe(true);
      expect(result.files).toContain('file.txt');
    });
  });
});

// ============================================================================
// GIT-LOG TESTS
// ============================================================================

describe('git-log CLI', () => {
  describe('source file existence', () => {
    it('should have the CLI source file', () => {
      const srcPath = join(__dirname, '../git-log.ts');
      expect(existsSync(srcPath)).toBe(true);
    });

    it('should be buildable (dist file exists after build)', () => {
      const distPath = join(__dirname, '../../dist/git-log.js');
      expect(existsSync(distPath)).toBe(true);
    });
  });

  describe('parseGitLogArgs', () => {
    it('should parse --oneline flag', () => {
      const args = parseGitLogArgs(['node', 'git-log', '--oneline']);
      expect(args.oneline).toBe(true);
    });

    it('should parse -n/--max-count option', () => {
      const args = parseGitLogArgs(['node', 'git-log', '-n', '5']);
      expect(args.maxCount).toBe(5);
    });

    it('should parse --max-count option', () => {
      const args = parseGitLogArgs(['node', 'git-log', '--max-count', '10']);
      expect(args.maxCount).toBe(10);
    });

    it('should parse --format option', () => {
      const args = parseGitLogArgs(['node', 'git-log', '--format', '%h %s']);
      expect(args.format).toBe('%h %s');
    });

    it('should parse --since option', () => {
      const args = parseGitLogArgs(['node', 'git-log', '--since', '2024-01-01']);
      expect(args.since).toBe('2024-01-01');
    });

    it('should parse --author option', () => {
      const args = parseGitLogArgs(['node', 'git-log', '--author', 'test@example.com']);
      expect(args.author).toBe('test@example.com');
    });

    it('should parse ref argument', () => {
      const args = parseGitLogArgs(['node', 'git-log', 'main..feature']);
      expect(args.ref).toBe('main..feature');
    });

    it('should parse --help flag', () => {
      const args = parseGitLogArgs(['node', 'git-log', '--help']);
      expect(args.help).toBe(true);
    });
  });

  describe('getGitLog', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = join(tmpdir(), `git-log-test-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
      execSync('git init', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'ignore' });
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('should return empty log for repo with no commits', async () => {
      const result = await getGitLog({ baseDir: tempDir });

      expect(result.success).toBe(true);
      expect(result.commits).toHaveLength(0);
    });

    it('should return commits when they exist', async () => {
      await writeFile(join(tempDir, 'file.txt'), 'content');
      execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });
      execSync('git commit -m "test commit"', { cwd: tempDir, stdio: 'ignore' });

      const result = await getGitLog({ baseDir: tempDir });

      expect(result.success).toBe(true);
      expect(result.commits.length).toBeGreaterThan(0);
      expect(result.commits[0].message).toContain('test commit');
    });

    it('should respect maxCount option', async () => {
      await writeFile(join(tempDir, 'file.txt'), 'content');
      execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });
      execSync('git commit -m "commit 1"', { cwd: tempDir, stdio: 'ignore' });
      await writeFile(join(tempDir, 'file2.txt'), 'content');
      execSync('git add file2.txt', { cwd: tempDir, stdio: 'ignore' });
      execSync('git commit -m "commit 2"', { cwd: tempDir, stdio: 'ignore' });

      const result = await getGitLog({ baseDir: tempDir, maxCount: 1 });

      expect(result.success).toBe(true);
      expect(result.commits).toHaveLength(1);
    });

    it('should return oneline output when requested', async () => {
      await writeFile(join(tempDir, 'file.txt'), 'content');
      execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });
      execSync('git commit -m "test commit"', { cwd: tempDir, stdio: 'ignore' });

      const result = await getGitLog({ baseDir: tempDir, oneline: true });

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
    });
  });
});

// ============================================================================
// GIT-BRANCH TESTS
// ============================================================================

describe('git-branch CLI', () => {
  describe('source file existence', () => {
    it('should have the CLI source file', () => {
      const srcPath = join(__dirname, '../git-branch.ts');
      expect(existsSync(srcPath)).toBe(true);
    });

    it('should be buildable (dist file exists after build)', () => {
      const distPath = join(__dirname, '../../dist/git-branch.js');
      expect(existsSync(distPath)).toBe(true);
    });
  });

  describe('parseGitBranchArgs', () => {
    it('should parse --list flag', () => {
      const args = parseGitBranchArgs(['node', 'git-branch', '--list']);
      expect(args.list).toBe(true);
    });

    it('should parse -a/--all flag', () => {
      const args = parseGitBranchArgs(['node', 'git-branch', '-a']);
      expect(args.all).toBe(true);
    });

    it('should parse -r/--remotes flag', () => {
      const args = parseGitBranchArgs(['node', 'git-branch', '-r']);
      expect(args.remotes).toBe(true);
    });

    it('should parse --show-current flag', () => {
      const args = parseGitBranchArgs(['node', 'git-branch', '--show-current']);
      expect(args.showCurrent).toBe(true);
    });

    it('should parse --contains option', () => {
      const args = parseGitBranchArgs(['node', 'git-branch', '--contains', 'abc123']);
      expect(args.contains).toBe('abc123');
    });

    it('should parse --help flag', () => {
      const args = parseGitBranchArgs(['node', 'git-branch', '--help']);
      expect(args.help).toBe(true);
    });
  });

  describe('getGitBranch', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = join(tmpdir(), `git-branch-test-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
      execSync('git init', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'ignore' });
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('should return current branch', async () => {
      await writeFile(join(tempDir, 'file.txt'), 'content');
      execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });
      execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });

      const result = await getGitBranch({ baseDir: tempDir, showCurrent: true });

      expect(result.success).toBe(true);
      expect(result.current).toBeDefined();
      // Git defaults to main or master depending on config
      expect(['main', 'master']).toContain(result.current);
    });

    it('should list all branches', async () => {
      await writeFile(join(tempDir, 'file.txt'), 'content');
      execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });
      execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });
      execSync('git checkout -b feature-branch', { cwd: tempDir, stdio: 'ignore' });
      execSync('git checkout main || git checkout master', {
        cwd: tempDir,
        stdio: 'ignore',
        shell: '/bin/bash',
      });

      const result = await getGitBranch({ baseDir: tempDir, list: true });

      expect(result.success).toBe(true);
      expect(result.branches).toBeDefined();
      expect(result.branches?.some((b) => b.name === 'feature-branch')).toBe(true);
    });
  });
});

// ============================================================================
// GUARD-MAIN-BRANCH TESTS
// ============================================================================

describe('guard-main-branch CLI', () => {
  describe('source file existence', () => {
    it('should have the CLI source file', () => {
      const srcPath = join(__dirname, '../guard-main-branch.ts');
      expect(existsSync(srcPath)).toBe(true);
    });

    it('should be buildable (dist file exists after build)', () => {
      const distPath = join(__dirname, '../../dist/guard-main-branch.js');
      expect(existsSync(distPath)).toBe(true);
    });
  });

  describe('parseGuardMainBranchArgs', () => {
    it('should parse --allow-agent-branch flag', () => {
      const args = parseGuardMainBranchArgs(['node', 'guard-main-branch', '--allow-agent-branch']);
      expect(args.allowAgentBranch).toBe(true);
    });

    it('should parse --strict flag', () => {
      const args = parseGuardMainBranchArgs(['node', 'guard-main-branch', '--strict']);
      expect(args.strict).toBe(true);
    });

    it('should parse --help flag', () => {
      const args = parseGuardMainBranchArgs(['node', 'guard-main-branch', '--help']);
      expect(args.help).toBe(true);
    });
  });

  describe('guardMainBranch', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = join(tmpdir(), `guard-main-test-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
      execSync('git init', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'ignore' });
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('should block on main branch', async () => {
      await writeFile(join(tempDir, 'file.txt'), 'content');
      execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });
      execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });

      const result = await guardMainBranch({ baseDir: tempDir });

      expect(result.success).toBe(true);
      expect(result.isProtected).toBe(true);
      expect(result.currentBranch).toMatch(/^(main|master)$/);
    });

    it('should allow on feature branch', async () => {
      await writeFile(join(tempDir, 'file.txt'), 'content');
      execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });
      execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });
      execSync('git checkout -b feature-branch', { cwd: tempDir, stdio: 'ignore' });

      const result = await guardMainBranch({ baseDir: tempDir });

      expect(result.success).toBe(true);
      expect(result.isProtected).toBe(false);
      expect(result.currentBranch).toBe('feature-branch');
    });

    it('should block on lane branch (requires worktree)', async () => {
      await writeFile(join(tempDir, 'file.txt'), 'content');
      execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });
      execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });
      execSync('git checkout -b lane/operations/wu-1234', { cwd: tempDir, stdio: 'ignore' });

      const result = await guardMainBranch({ baseDir: tempDir });

      expect(result.success).toBe(true);
      expect(result.isProtected).toBe(true);
      expect(result.reason).toContain('lane');
    });

    it('should allow agent branch when --allow-agent-branch is set', async () => {
      await writeFile(join(tempDir, 'file.txt'), 'content');
      execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });
      execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });
      execSync('git checkout -b claude/session-123', { cwd: tempDir, stdio: 'ignore' });

      const result = await guardMainBranch({ baseDir: tempDir, allowAgentBranch: true });

      expect(result.success).toBe(true);
      // Agent branch should be allowed when flag is set
      expect(result.isProtected).toBe(false);
    });

    it('should block agent branch in strict mode', async () => {
      await writeFile(join(tempDir, 'file.txt'), 'content');
      execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });
      execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });
      execSync('git checkout -b claude/session-123', { cwd: tempDir, stdio: 'ignore' });

      const result = await guardMainBranch({ baseDir: tempDir, strict: true });

      expect(result.success).toBe(true);
      expect(result.isProtected).toBe(true);
    });

    it('should handle --base-dir argument', () => {
      const args = parseGuardMainBranchArgs([
        'node',
        'guard-main-branch',
        '--base-dir',
        '/tmp/test',
      ]);
      expect(args.baseDir).toBe('/tmp/test');
    });
  });
});

// ============================================================================
// ADDITIONAL COVERAGE TESTS
// ============================================================================

describe('git-status additional coverage', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `git-status-extra-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'ignore' });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should handle deleted files (working tree)', async () => {
    await writeFile(join(tempDir, 'deleted.txt'), 'content');
    execSync('git add deleted.txt', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "add file"', { cwd: tempDir, stdio: 'ignore' });
    execSync('rm deleted.txt', { cwd: tempDir, stdio: 'ignore' });

    const result = await getGitStatus({ baseDir: tempDir });

    expect(result.success).toBe(true);
    expect(result.deleted).toContain('deleted.txt');
  });

  it('should handle staged deletions', async () => {
    await writeFile(join(tempDir, 'staged-delete.txt'), 'content');
    execSync('git add staged-delete.txt', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "add file"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git rm staged-delete.txt', { cwd: tempDir, stdio: 'ignore' });

    const result = await getGitStatus({ baseDir: tempDir });

    expect(result.success).toBe(true);
    expect(result.staged).toContain('staged-delete.txt');
    expect(result.deleted).toContain('staged-delete.txt');
  });

  it('should handle renamed files', async () => {
    await writeFile(join(tempDir, 'original.txt'), 'content');
    execSync('git add original.txt', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "add file"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git mv original.txt renamed.txt', { cwd: tempDir, stdio: 'ignore' });

    const result = await getGitStatus({ baseDir: tempDir });

    expect(result.success).toBe(true);
    expect(result.staged).toContain('renamed.txt');
  });

  it('should handle path argument', async () => {
    await mkdir(join(tempDir, 'subdir'), { recursive: true });
    await writeFile(join(tempDir, 'subdir', 'file.txt'), 'content');
    await writeFile(join(tempDir, 'root.txt'), 'content');

    const result = await getGitStatus({ baseDir: tempDir, path: 'subdir/' });

    expect(result.success).toBe(true);
    // When filtering by path, only files in that path are shown
    expect(result.untracked?.length).toBe(1);
    expect(result.untracked?.[0]).toContain('subdir');
  });

  it('should parse --base-dir argument', () => {
    const args = parseGitStatusArgs(['node', 'git-status', '--base-dir', '/tmp/test']);
    expect(args.baseDir).toBe('/tmp/test');
  });

  it('should handle short format output', async () => {
    await writeFile(join(tempDir, 'file.txt'), 'content');

    const result = await getGitStatus({ baseDir: tempDir, short: true });

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
  });
});

describe('git-diff additional coverage', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `git-diff-extra-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'ignore' });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should handle stat output', async () => {
    await writeFile(join(tempDir, 'file.txt'), 'initial');
    execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });
    await writeFile(join(tempDir, 'file.txt'), 'modified');

    const result = await getGitDiff({ baseDir: tempDir, stat: true });

    expect(result.success).toBe(true);
    expect(result.stat).toBeDefined();
  });

  it('should handle ref argument', async () => {
    await writeFile(join(tempDir, 'file.txt'), 'initial');
    execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });
    await writeFile(join(tempDir, 'file.txt'), 'modified');
    execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "second"', { cwd: tempDir, stdio: 'ignore' });

    const result = await getGitDiff({ baseDir: tempDir, ref: 'HEAD~1' });

    expect(result.success).toBe(true);
    expect(result.hasDiff).toBe(true);
  });

  it('should parse --base-dir argument', () => {
    const args = parseGitDiffArgs(['node', 'git-diff', '--base-dir', '/tmp/test']);
    expect(args.baseDir).toBe('/tmp/test');
  });

  it('should handle path filter after double dash', async () => {
    await writeFile(join(tempDir, 'file1.txt'), 'initial');
    await writeFile(join(tempDir, 'file2.txt'), 'initial');
    execSync('git add .', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });
    await writeFile(join(tempDir, 'file1.txt'), 'modified');
    await writeFile(join(tempDir, 'file2.txt'), 'modified');

    const result = await getGitDiff({ baseDir: tempDir, path: 'file1.txt' });

    expect(result.success).toBe(true);
    expect(result.diff).toContain('file1.txt');
  });
});

describe('git-log additional coverage', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `git-log-extra-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'ignore' });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should handle custom format', async () => {
    await writeFile(join(tempDir, 'file.txt'), 'content');
    execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "test commit"', { cwd: tempDir, stdio: 'ignore' });

    const result = await getGitLog({ baseDir: tempDir, format: '%h %s' });

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    expect(result.output).toContain('test commit');
  });

  it('should handle author filter', async () => {
    await writeFile(join(tempDir, 'file.txt'), 'content');
    execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "test commit"', { cwd: tempDir, stdio: 'ignore' });

    const result = await getGitLog({ baseDir: tempDir, author: 'test@example.com' });

    expect(result.success).toBe(true);
    expect(result.commits.length).toBeGreaterThan(0);
  });

  it('should parse -nN format for max count', () => {
    const args = parseGitLogArgs(['node', 'git-log', '-n5']);
    expect(args.maxCount).toBe(5);
  });

  it('should handle --base-dir argument', () => {
    const args = parseGitLogArgs(['node', 'git-log', '--base-dir', '/tmp/test']);
    expect(args.baseDir).toBe('/tmp/test');
  });
});

describe('git-branch additional coverage', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `git-branch-extra-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'ignore' });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should handle --all flag', async () => {
    await writeFile(join(tempDir, 'file.txt'), 'content');
    execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });

    const result = await getGitBranch({ baseDir: tempDir, all: true });

    expect(result.success).toBe(true);
    expect(result.branches).toBeDefined();
  });

  it('should handle --base-dir argument', () => {
    const args = parseGitBranchArgs(['node', 'git-branch', '--base-dir', '/tmp/test']);
    expect(args.baseDir).toBe('/tmp/test');
  });

  it('should handle -l alias for --list', () => {
    const args = parseGitBranchArgs(['node', 'git-branch', '-l']);
    expect(args.list).toBe(true);
  });

  it('should mark current branch correctly', async () => {
    await writeFile(join(tempDir, 'file.txt'), 'content');
    execSync('git add file.txt', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git checkout -b feature', { cwd: tempDir, stdio: 'ignore' });

    const result = await getGitBranch({ baseDir: tempDir });

    expect(result.success).toBe(true);
    const currentBranch = result.branches?.find((b) => b.isCurrent);
    expect(currentBranch?.name).toBe('feature');
  });
});
