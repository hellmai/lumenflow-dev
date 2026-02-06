/**
 * WU-1485: Verify no hook error message suggests LUMENFLOW_FORCE bypass
 *
 * These tests scan hook source files to ensure error messages printed to stderr
 * do not teach agents how to bypass hooks. The LUMENFLOW_FORCE mechanism itself
 * must still work, but error messages must suggest workflow-correct commands
 * (wu:done, wu:recover) instead.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKTREE_ROOT = process.cwd();

/**
 * Extract stderr-printed lines from a .mjs hook file.
 * These are lines that call console.error() or console.warn() with string content.
 * We exclude:
 * - Lines that CHECK process.env.LUMENFLOW_FORCE (the mechanism itself)
 * - Lines in the logForceBypass function body (audit logging, not user-facing)
 * - Comments (lines starting with // or *)
 */
function extractStderrMessages(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const stderrLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    // Skip env checks (the mechanism itself, not error messages)
    if (trimmed.includes('process.env.LUMENFLOW_FORCE')) continue;
    // Include lines that print to stderr
    if (trimmed.includes('console.error(') || trimmed.includes('console.warn(')) {
      stderrLines.push(trimmed);
    }
  }

  return stderrLines;
}

/**
 * Extract stderr-printed lines from a .sh hook file.
 * These are lines that use echo ... >&2.
 */
function extractShellStderrMessages(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const stderrLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments
    if (trimmed.startsWith('#')) continue;
    // Skip variable checks (the mechanism itself)
    if (
      trimmed.includes('LUMENFLOW_FORCE:-') ||
      (trimmed.includes('LUMENFLOW_FORCE=') && !trimmed.includes('echo'))
    )
      continue;
    // Include lines that print to stderr
    if (trimmed.includes('>&2')) {
      stderrLines.push(trimmed);
    }
  }

  return stderrLines;
}

describe('WU-1485: No LUMENFLOW_FORCE suggestions in hook error messages', () => {
  describe('.husky/hooks/ MJS hooks', () => {
    const mjsHooks = ['pre-commit.mjs', 'commit-msg.mjs', 'pre-push.mjs', 'prepare-commit-msg.mjs'];

    for (const hookFile of mjsHooks) {
      it(`${hookFile} error messages do not suggest LUMENFLOW_FORCE`, () => {
        const filePath = join(WORKTREE_ROOT, '.husky/hooks', hookFile);
        const stderrLines = extractStderrMessages(filePath);

        const forceSuggestions = stderrLines.filter(
          (line) => line.includes('LUMENFLOW_FORCE=1') || line.includes('LUMENFLOW_FORCE_REASON'),
        );

        expect(forceSuggestions).toEqual([]);
      });

      it(`${hookFile} error messages suggest wu:done or wu:recover instead`, () => {
        const filePath = join(WORKTREE_ROOT, '.husky/hooks', hookFile);
        const content = readFileSync(filePath, 'utf8');

        // If the hook has error blocks (console.error with BLOCKED), it should suggest workflow commands
        if (content.includes('BLOCKED')) {
          expect(content).toMatch(/wu:done|wu:recover/);
        }
      });
    }
  });

  describe('scripts/hooks/ shell hooks', () => {
    const shellHooks = ['check-lockfile.sh', 'scan-secrets.sh', 'validate-paths.sh'];

    for (const hookFile of shellHooks) {
      it(`${hookFile} error messages do not suggest LUMENFLOW_FORCE`, () => {
        const filePath = join(WORKTREE_ROOT, 'scripts/hooks', hookFile);
        const stderrLines = extractShellStderrMessages(filePath);

        const forceSuggestions = stderrLines.filter(
          (line) => line.includes('LUMENFLOW_FORCE=1') || line.includes('LUMENFLOW_FORCE_REASON'),
        );

        expect(forceSuggestions).toEqual([]);
      });
    }
  });

  describe('CLI templates', () => {
    it('pre-commit.template error messages do not suggest LUMENFLOW_FORCE', () => {
      const filePath = join(
        WORKTREE_ROOT,
        'packages/@lumenflow/cli/templates/core/.husky/pre-commit.template',
      );
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n');

      // Find lines that echo to stderr and suggest LUMENFLOW_FORCE
      const stderrForceSuggestions = lines.filter((line) => {
        const trimmed = line.trim();
        // Skip comments
        if (trimmed.startsWith('#')) return false;
        // Skip env checks (the mechanism itself)
        if (trimmed.startsWith('if [') || trimmed.startsWith('if [[ ')) return false;
        // Include stderr lines that suggest LUMENFLOW_FORCE
        return (
          trimmed.includes('>&2') &&
          (trimmed.includes('LUMENFLOW_FORCE=1') || trimmed.includes('LUMENFLOW_FORCE_REASON'))
        );
      });

      expect(stderrForceSuggestions).toEqual([]);
    });

    it('pre-commit.template suggests wu:done or wu:recover in error messages', () => {
      const filePath = join(
        WORKTREE_ROOT,
        'packages/@lumenflow/cli/templates/core/.husky/pre-commit.template',
      );
      const content = readFileSync(filePath, 'utf8');

      expect(content).toMatch(/wu:done|wu:recover/);
    });
  });

  describe('LUMENFLOW_FORCE mechanism still works', () => {
    it('pre-commit.mjs still checks LUMENFLOW_FORCE env var for bypass', () => {
      const filePath = join(WORKTREE_ROOT, '.husky/hooks/pre-commit.mjs');
      const content = readFileSync(filePath, 'utf8');

      // The mechanism (env var check) must still exist
      expect(content).toContain("process.env.LUMENFLOW_FORCE === '1'");
    });

    it('commit-msg.mjs still checks LUMENFLOW_FORCE env var for bypass', () => {
      const filePath = join(WORKTREE_ROOT, '.husky/hooks/commit-msg.mjs');
      const content = readFileSync(filePath, 'utf8');

      expect(content).toContain("process.env.LUMENFLOW_FORCE === '1'");
    });

    it('pre-push.mjs still checks LUMENFLOW_FORCE env var for bypass', () => {
      const filePath = join(WORKTREE_ROOT, '.husky/hooks/pre-push.mjs');
      const content = readFileSync(filePath, 'utf8');

      expect(content).toContain("process.env.LUMENFLOW_FORCE === '1'");
    });

    it('shell hooks still check LUMENFLOW_FORCE env var for bypass', () => {
      for (const hookFile of ['check-lockfile.sh', 'scan-secrets.sh', 'validate-paths.sh']) {
        const filePath = join(WORKTREE_ROOT, 'scripts/hooks', hookFile);
        const content = readFileSync(filePath, 'utf8');

        expect(content).toContain('LUMENFLOW_FORCE');
      }
    });
  });
});
