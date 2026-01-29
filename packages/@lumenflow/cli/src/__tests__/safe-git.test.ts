import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const CLI_SAFE_GIT_PATH = path.resolve(__dirname, '../../bin/safe-git');
const SCRIPTS_SAFE_GIT_PATH = path.resolve(__dirname, '../../../../../scripts/safe-git');

describe('safe-git', () => {
  // We mock child_process execution where possible, but for integration testing a script
  // we often execute it directly. Since safe-git is a shell script, we executed it.

  it('should fail when running "worktree remove" (CLI wrapper)', () => {
    try {
      execFileSync(CLI_SAFE_GIT_PATH, ['worktree', 'remove', 'some-path'], { stdio: 'pipe' });
      expect.fail('Should have thrown an error');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(error.stderr.toString()).toContain("BLOCKED: Manual 'git worktree remove' is unsafe");
    }
  });

  it('should fail when running "worktree remove" (scripts wrapper)', () => {
    try {
      execFileSync(SCRIPTS_SAFE_GIT_PATH, ['worktree', 'remove', 'some-path'], { stdio: 'pipe' });
      expect.fail('Should have thrown an error');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(error.stderr.toString()).toContain('Manual');
      expect(error.stderr.toString()).toContain('worktree remove');
    }
  });

  it('should fail when running "reset --hard" (scripts wrapper)', () => {
    try {
      execFileSync(SCRIPTS_SAFE_GIT_PATH, ['reset', '--hard', 'HEAD'], { stdio: 'pipe' });
      expect.fail('Should have thrown an error');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(error.stderr.toString()).toContain('reset --hard');
    }
  });

  it('should fail when running "clean -fd" (scripts wrapper)', () => {
    try {
      execFileSync(SCRIPTS_SAFE_GIT_PATH, ['clean', '-fd'], { stdio: 'pipe' });
      expect.fail('Should have thrown an error');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(error.stderr.toString()).toContain('clean -fd');
    }
  });

  it('should fail when running "push --force" (scripts wrapper)', () => {
    try {
      execFileSync(SCRIPTS_SAFE_GIT_PATH, ['push', '--force'], { stdio: 'pipe' });
      expect.fail('Should have thrown an error');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(error.stderr.toString()).toContain('push --force');
    }
  });

  it('should pass through safe commands', () => {
    // We verify it calls git by mocking git or checking output.
    // Since we can't easily mock the system git in a real shell script execution without PATH manip,
    // we'll check that it runs git --version correctly.

    const output = execFileSync(CLI_SAFE_GIT_PATH, ['--version'], { encoding: 'utf-8' });
    expect(output).toContain('git version');
  });
});
