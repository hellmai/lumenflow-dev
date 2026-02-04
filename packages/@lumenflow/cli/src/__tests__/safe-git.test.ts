import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const CLI_SAFE_GIT_PATH = path.resolve(__dirname, '../../bin/safe-git');
const SCRIPTS_SAFE_GIT_PATH = path.resolve(__dirname, '../../../../../scripts/safe-git');

// Constants for duplicate strings
const SHOULD_HAVE_THROWN = 'Should have thrown an error';
const GIT_CMD = 'git';
const USER_EMAIL_CONFIG = 'user.email';
const USER_NAME_CONFIG = 'user.name';
const TEST_EMAIL = 'test@test.com';
const TEST_USERNAME = 'Test';
const FORCE_BYPASSES_LOG = 'force-bypasses.log';

// Create a temporary directory for testing to avoid polluting the real .lumenflow directory
const createTempDir = (): string => {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'safe-git-test-'));
};

describe('safe-git', () => {
  // We mock child_process execution where possible, but for integration testing a script
  // we often execute it directly. Since safe-git is a shell script, we executed it.

  it('should fail when running "worktree remove" (CLI wrapper)', () => {
    try {
      execFileSync(CLI_SAFE_GIT_PATH, ['worktree', 'remove', 'some-path'], { stdio: 'pipe' });
      expect.fail(SHOULD_HAVE_THROWN);
    } catch (error: unknown) {
      const err = error as { status: number; stderr: Buffer };
      expect(err.status).toBe(1);
      expect(err.stderr.toString()).toContain("BLOCKED: Manual 'git worktree remove' is unsafe");
    }
  });

  it('should fail when running "worktree remove" (scripts wrapper)', () => {
    try {
      execFileSync(SCRIPTS_SAFE_GIT_PATH, ['worktree', 'remove', 'some-path'], { stdio: 'pipe' });
      expect.fail(SHOULD_HAVE_THROWN);
    } catch (error: unknown) {
      const err = error as { status: number; stderr: Buffer };
      expect(err.status).toBe(1);
      expect(err.stderr.toString()).toContain('Manual');
      expect(err.stderr.toString()).toContain('worktree remove');
    }
  });

  it('should fail when running "reset --hard" (scripts wrapper)', () => {
    try {
      execFileSync(SCRIPTS_SAFE_GIT_PATH, ['reset', '--hard', 'HEAD'], { stdio: 'pipe' });
      expect.fail(SHOULD_HAVE_THROWN);
    } catch (error: unknown) {
      const err = error as { status: number; stderr: Buffer };
      expect(err.status).toBe(1);
      expect(err.stderr.toString()).toContain('reset --hard');
    }
  });

  it('should fail when running "clean -fd" (scripts wrapper)', () => {
    try {
      execFileSync(SCRIPTS_SAFE_GIT_PATH, ['clean', '-fd'], { stdio: 'pipe' });
      expect.fail(SHOULD_HAVE_THROWN);
    } catch (error: unknown) {
      const err = error as { status: number; stderr: Buffer };
      expect(err.status).toBe(1);
      expect(err.stderr.toString()).toContain('clean -fd');
    }
  });

  it('should fail when running "push --force" (scripts wrapper)', () => {
    try {
      execFileSync(SCRIPTS_SAFE_GIT_PATH, ['push', '--force'], { stdio: 'pipe' });
      expect.fail(SHOULD_HAVE_THROWN);
    } catch (error: unknown) {
      const err = error as { status: number; stderr: Buffer };
      expect(err.status).toBe(1);
      expect(err.stderr.toString()).toContain('push --force');
    }
  });

  it('should pass through safe commands', () => {
    // We verify it calls git by mocking git or checking output.
    // Since we can't easily mock the system git in a real shell script execution without PATH manip,
    // we'll check that it runs git --version correctly.

    const output = execFileSync(CLI_SAFE_GIT_PATH, ['--version'], { encoding: 'utf-8' });
    expect(output).toContain('git version');
  });

  describe('LUMENFLOW_FORCE bypass', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir();
    });

    afterEach(() => {
      // Clean up temp directory
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should bypass blocked commands when LUMENFLOW_FORCE=1', () => {
      // Using git --version as a safe test with force flag
      // The key is that the env var should be respected and not block
      const output = execFileSync(SCRIPTS_SAFE_GIT_PATH, ['--version'], {
        encoding: 'utf-8',
        env: { ...process.env, LUMENFLOW_FORCE: '1' },
      });
      expect(output).toContain('git version');
    });

    it('should log bypass to force-bypasses.log when LUMENFLOW_FORCE=1', () => {
      // We need to test that a blocked command, when forced, writes to the audit log
      // Since reset --hard is dangerous, we use a mock approach
      // The script should create the audit log entry before executing

      // Create a temporary git repo for this test
      const testRepo = path.join(tempDir, 'test-repo');
      fs.mkdirSync(testRepo, { recursive: true });
      execFileSync(GIT_CMD, ['init'], { cwd: testRepo, stdio: 'pipe' });
      execFileSync(GIT_CMD, ['config', USER_EMAIL_CONFIG, TEST_EMAIL], {
        cwd: testRepo,
        stdio: 'pipe',
      });
      execFileSync(GIT_CMD, ['config', USER_NAME_CONFIG, TEST_USERNAME], {
        cwd: testRepo,
        stdio: 'pipe',
      });

      // Create a file and commit
      fs.writeFileSync(path.join(testRepo, 'test.txt'), 'test');
      execFileSync(GIT_CMD, ['add', '.'], { cwd: testRepo, stdio: 'pipe' });
      execFileSync(GIT_CMD, ['commit', '-m', 'init'], { cwd: testRepo, stdio: 'pipe' });

      // Run safe-git with force to reset --hard (should succeed with log)
      execFileSync(SCRIPTS_SAFE_GIT_PATH, ['reset', '--hard', 'HEAD'], {
        cwd: testRepo,
        encoding: 'utf-8',
        env: { ...process.env, LUMENFLOW_FORCE: '1' },
      });

      // Check that the force bypass log exists and contains the entry
      const bypassLog = path.join(testRepo, '.lumenflow', FORCE_BYPASSES_LOG);
      expect(fs.existsSync(bypassLog)).toBe(true);
      const logContent = fs.readFileSync(bypassLog, 'utf-8');
      expect(logContent).toContain('reset --hard');
      expect(logContent).toContain('BYPASSED');
    });

    it('should include LUMENFLOW_FORCE_REASON in audit log when provided', () => {
      const testRepo = path.join(tempDir, 'test-repo-reason');
      fs.mkdirSync(testRepo, { recursive: true });
      execFileSync(GIT_CMD, ['init'], { cwd: testRepo, stdio: 'pipe' });
      execFileSync(GIT_CMD, ['config', USER_EMAIL_CONFIG, TEST_EMAIL], {
        cwd: testRepo,
        stdio: 'pipe',
      });
      execFileSync(GIT_CMD, ['config', USER_NAME_CONFIG, TEST_USERNAME], {
        cwd: testRepo,
        stdio: 'pipe',
      });

      fs.writeFileSync(path.join(testRepo, 'test.txt'), 'test');
      execFileSync(GIT_CMD, ['add', '.'], { cwd: testRepo, stdio: 'pipe' });
      execFileSync(GIT_CMD, ['commit', '-m', 'init'], { cwd: testRepo, stdio: 'pipe' });

      const testReason = 'user-approved: testing bypass';
      execFileSync(SCRIPTS_SAFE_GIT_PATH, ['reset', '--hard', 'HEAD'], {
        cwd: testRepo,
        encoding: 'utf-8',
        env: { ...process.env, LUMENFLOW_FORCE: '1', LUMENFLOW_FORCE_REASON: testReason },
      });

      const bypassLog = path.join(testRepo, '.lumenflow', FORCE_BYPASSES_LOG);
      const logContent = fs.readFileSync(bypassLog, 'utf-8');
      expect(logContent).toContain(testReason);
    });

    it('should print warning when LUMENFLOW_FORCE used without REASON', () => {
      const testRepo = path.join(tempDir, 'test-repo-no-reason');
      fs.mkdirSync(testRepo, { recursive: true });
      execFileSync(GIT_CMD, ['init'], { cwd: testRepo, stdio: 'pipe' });
      execFileSync(GIT_CMD, ['config', USER_EMAIL_CONFIG, TEST_EMAIL], {
        cwd: testRepo,
        stdio: 'pipe',
      });
      execFileSync(GIT_CMD, ['config', USER_NAME_CONFIG, TEST_USERNAME], {
        cwd: testRepo,
        stdio: 'pipe',
      });

      fs.writeFileSync(path.join(testRepo, 'test.txt'), 'test');
      execFileSync(GIT_CMD, ['add', '.'], { cwd: testRepo, stdio: 'pipe' });
      execFileSync(GIT_CMD, ['commit', '-m', 'init'], { cwd: testRepo, stdio: 'pipe' });

      // Execute with LUMENFLOW_FORCE=1 but no reason
      execFileSync(SCRIPTS_SAFE_GIT_PATH, ['reset', '--hard', 'HEAD'], {
        cwd: testRepo,
        encoding: 'utf-8',
        env: { ...process.env, LUMENFLOW_FORCE: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Check the bypasslog for the NO_REASON marker
      const bypassLog = path.join(testRepo, '.lumenflow', FORCE_BYPASSES_LOG);
      const logContent = fs.readFileSync(bypassLog, 'utf-8');
      expect(logContent).toContain('NO_REASON');
    });
  });
});
