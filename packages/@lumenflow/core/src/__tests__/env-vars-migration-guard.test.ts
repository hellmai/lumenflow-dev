import fg from 'fast-glob';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface EnvDotAccessViolation {
  file: string;
  envVar: string;
  line: number;
}

const REPO_ROOT = path.resolve(__dirname, '../../../../..');

const TARGET_PATTERNS = [
  'packages/@lumenflow/core/src/**/*.ts',
  'packages/@lumenflow/cli/src/**/*.ts',
];

const IGNORE_PATTERNS = ['**/__tests__/**'];

const MIGRATED_ENV_VARS = [
  'CI',
  'CLAUDE_PROJECT_DIR',
  'DEBUG',
  'FORCE_COLOR',
  'GITHUB_ACTIONS',
  'GIT_AUTHOR_EMAIL',
  'GIT_EDITOR',
  'GIT_USER',
  'HOSTNAME',
  'NO_COLOR',
  'STALE_LOCK_THRESHOLD_HOURS',
  'TEST_BRANCH',
  'TEST_MODE',
  'TEST_WORKTREE',
  'USER',
  'USERPROFILE',
  'VERBOSE',
] as const;

function scanFileForRawEnvDotAccess(file: string): EnvDotAccessViolation[] {
  const source = readFileSync(file, 'utf-8');
  const lines = source.split(/\r?\n/);
  const violations: EnvDotAccessViolation[] = [];
  const pattern = new RegExp(String.raw`process\.env\.(${MIGRATED_ENV_VARS.join('|')})\b`, 'g');

  lines.forEach((line, index) => {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(line)) !== null) {
      const envVar = match[1];
      if (!envVar) {
        continue;
      }
      violations.push({
        file: path.relative(REPO_ROOT, file),
        envVar,
        line: index + 1,
      });
    }
  });

  return violations;
}

describe('WU-2172: env var migration guard', () => {
  it('does not use raw process.env dot access for migrated env vars in runtime code', async () => {
    const files = await fg(TARGET_PATTERNS, {
      cwd: REPO_ROOT,
      absolute: true,
      onlyFiles: true,
      ignore: IGNORE_PATTERNS,
    });

    const violations = files.flatMap(scanFileForRawEnvDotAccess);
    const summary = violations
      .map((v) => `${v.file}:${v.line} -> process.env.${v.envVar}`)
      .join('\n');

    expect(
      violations,
      summary.length > 0 ? `Raw env dot-access violations:\n${summary}` : undefined,
    ).toHaveLength(0);
  });
});
