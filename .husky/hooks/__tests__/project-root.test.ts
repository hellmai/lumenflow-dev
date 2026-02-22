import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProjectRoot } from '../project-root.mjs';

const GIT_BINARY = 'git';
const GIT_SHOW_TOPLEVEL_ARGS = ['rev-parse', '--show-toplevel'];

function gitTopLevel(cwd: string): string {
  return execFileSync(GIT_BINARY, ['-C', cwd, ...GIT_SHOW_TOPLEVEL_ARGS], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

describe('resolveProjectRoot', () => {
  it('resolves repository root from a nested in-repo path', () => {
    const expected = gitTopLevel(process.cwd());
    const nestedPath = join(expected, '.husky', 'hooks', '__tests__');

    expect(resolveProjectRoot(nestedPath)).toBe(expected);
  });

  it('resolves repository root even when cwd is outside git checkout', () => {
    const expected = gitTopLevel(process.cwd());
    const outsideRepo = mkdtempSync(join(tmpdir(), 'lf-root-'));

    try {
      expect(resolveProjectRoot(outsideRepo)).toBe(expected);
    } finally {
      rmSync(outsideRepo, { recursive: true, force: true });
    }
  });
});
