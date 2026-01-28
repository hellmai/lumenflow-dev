import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';
import path from 'path';

const SAFE_GIT_PATH = path.resolve(__dirname, '../../bin/safe-git');

describe('safe-git', () => {
    // We mock child_process execution where possible, but for integration testing a script
    // we often execute it directly. Since safe-git is a shell script, we executed it.

    it('should fail when running "worktree remove"', () => {
        try {
            execFileSync(SAFE_GIT_PATH, ['worktree', 'remove', 'some-path'], { stdio: 'pipe' });
            expect.fail('Should have thrown an error');
        } catch (error: any) {
            expect(error.status).toBe(1);
            expect(error.stderr.toString()).toContain('BLOCKED: Manual \'git worktree remove\' is unsafe');
        }
    });

    it('should pass through safe commands', () => {
        // We verify it calls git by mocking git or checking output.
        // Since we can't easily mock the system git in a real shell script execution without PATH manip,
        // we'll check that it runs git --version correctly.

        const output = execFileSync(SAFE_GIT_PATH, ['--version'], { encoding: 'utf-8' });
        expect(output).toContain('git version');
    });
});
