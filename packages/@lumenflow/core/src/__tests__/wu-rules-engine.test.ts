import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../git-adapter.js', () => ({
  createGitForPath: vi.fn(),
}));

import { createGitForPath } from '../git-adapter.js';
import {
  CLI_PACKAGE_JSON_PATH,
  RULE_CODES,
  resolveChangedFiles,
  validateWURules,
  validateWURulesSync,
} from '../wu-rules-engine.js';

type MockGit = {
  branchExists: ReturnType<typeof vi.fn>;
  raw: ReturnType<typeof vi.fn>;
};

function createTmpRepo(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'wu-rules-engine-'));
}

function writeRepoFile(root: string, relativePath: string, content = ''): void {
  const fullPath = path.join(root, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');
}

function makeGitMock(handlers: {
  diffOutput?: string;
  showBase?: string | Error;
  showHead?: string | Error;
  branchExistsOriginMain?: boolean;
  branchExistsMain?: boolean;
  diffError?: Error;
}): MockGit {
  const raw = vi.fn(async (args: string[]) => {
    if (args[0] === 'diff') {
      if (handlers.diffError) {
        throw handlers.diffError;
      }
      return handlers.diffOutput ?? '';
    }

    if (args[0] === 'show') {
      const refPath = args[1] ?? '';
      if (refPath.startsWith('origin/main:') || refPath.startsWith('main:')) {
        if (handlers.showBase instanceof Error) {
          throw handlers.showBase;
        }
        return handlers.showBase ?? '{"bin":{"lumenflow":"dist/index.js"}}';
      }

      if (refPath.startsWith('HEAD:')) {
        if (handlers.showHead instanceof Error) {
          throw handlers.showHead;
        }
        return handlers.showHead ?? '{"bin":{"lumenflow":"dist/index.js"}}';
      }
    }

    throw new Error(`Unexpected git raw call: ${args.join(' ')}`);
  });

  return {
    branchExists: vi.fn().mockImplementation(async (ref: string) => {
      if (ref === 'origin/main') {
        return handlers.branchExistsOriginMain ?? true;
      }
      if (ref === 'main') {
        return handlers.branchExistsMain ?? false;
      }
      return false;
    }),
    raw,
  };
}

describe('wu-rules-engine', () => {
  let repoDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    repoDir = createTmpRepo();
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('passes metadata-only cli package.json change when bin is unchanged', async () => {
    writeRepoFile(repoDir, CLI_PACKAGE_JSON_PATH, '{"name":"@lumenflow/cli"}');

    const git = makeGitMock({
      diffOutput: `${CLI_PACKAGE_JSON_PATH}\n`,
      showBase: '{"bin":{"lumenflow":"dist/index.js"},"homepage":"a"}',
      showHead: '{"bin":{"lumenflow":"dist/index.js"},"homepage":"b"}',
    });
    vi.mocked(createGitForPath).mockReturnValue(git as any);

    const result = await validateWURules(
      {
        id: 'WU-TEST',
        type: 'bug',
        code_paths: [CLI_PACKAGE_JSON_PATH],
        tests: { manual: ['metadata check'] },
        cwd: repoDir,
      },
      { phase: 'reality' },
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.metadata.parityState).toBe('unchanged');
  });

  it('treats missing base package.json + existing head package.json as bin changed (R-006)', async () => {
    writeRepoFile(repoDir, CLI_PACKAGE_JSON_PATH, '{"name":"@lumenflow/cli"}');

    const baseMissing = new Error(
      `fatal: path '${CLI_PACKAGE_JSON_PATH}' does not exist in 'origin/main'`,
    );
    const git = makeGitMock({
      diffOutput: `${CLI_PACKAGE_JSON_PATH}\n`,
      showBase: baseMissing,
      showHead: '{"bin":{"lumenflow":"dist/index.js"}}',
    });
    vi.mocked(createGitForPath).mockReturnValue(git as any);

    const result = await validateWURules(
      {
        id: 'WU-TEST',
        type: 'bug',
        code_paths: [CLI_PACKAGE_JSON_PATH],
        tests: { manual: ['manual check'] },
        cwd: repoDir,
      },
      { phase: 'reality' },
    );

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain(RULE_CODES.PARITY_MISSING_SURFACE);
    expect(result.metadata.parityState).toBe('changed');
  });

  it('emits warning and skips parity when bin diff context is unavailable', async () => {
    writeRepoFile(repoDir, CLI_PACKAGE_JSON_PATH, '{"name":"@lumenflow/cli"}');

    const git = makeGitMock({
      diffOutput: `${CLI_PACKAGE_JSON_PATH}\n`,
      showBase: '{"bin":{"lumenflow":"dist/index.js"}}',
      showHead: new Error('fatal: bad object HEAD'),
    });
    vi.mocked(createGitForPath).mockReturnValue(git as any);

    const result = await validateWURules(
      {
        id: 'WU-TEST',
        type: 'bug',
        code_paths: [CLI_PACKAGE_JSON_PATH],
        tests: { manual: ['manual check'] },
        cwd: repoDir,
      },
      { phase: 'reality' },
    );

    expect(result.valid).toBe(true);
    expect(result.warnings.map((issue) => issue.code)).toContain(RULE_CODES.PARITY_UNAVAILABLE);
  });

  it('fails closed when coverage diff cannot be resolved', async () => {
    writeRepoFile(repoDir, 'packages/@lumenflow/core/src/wu-lint.ts', 'export {};');

    const git = makeGitMock({
      branchExistsOriginMain: false,
      branchExistsMain: false,
    });
    vi.mocked(createGitForPath).mockReturnValue(git as any);

    const result = await validateWURules(
      {
        id: 'WU-TEST',
        type: 'bug',
        code_paths: ['packages/@lumenflow/core/src/wu-lint.ts'],
        tests: { manual: ['manual check'] },
        cwd: repoDir,
      },
      { phase: 'reality' },
    );

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain(RULE_CODES.CODE_PATH_COVERAGE);
  });

  it('supports glob code_paths for existence and coverage', async () => {
    writeRepoFile(repoDir, 'packages/@lumenflow/cli/src/wu-prep.ts', 'export {};');

    const git = makeGitMock({
      diffOutput: 'packages/@lumenflow/cli/src/wu-prep.ts\n',
    });
    vi.mocked(createGitForPath).mockReturnValue(git as any);

    const result = await validateWURules(
      {
        id: 'WU-TEST',
        type: 'bug',
        code_paths: ['packages/@lumenflow/cli/src/**/*.ts'],
        tests: { manual: ['manual check'] },
        cwd: repoDir,
      },
      { phase: 'reality' },
    );

    expect(result.valid).toBe(true);
    expect(result.metadata.missingCodePaths).toEqual([]);
    expect(result.metadata.missingCoverageCodePaths).toEqual([]);
  });

  it('flags prose entries in automated test buckets with move-to-manual hint', async () => {
    writeRepoFile(repoDir, 'packages/@lumenflow/core/src/wu-lint.ts', 'export {};');

    const git = makeGitMock({
      diffOutput: 'packages/@lumenflow/core/src/wu-lint.ts\n',
    });
    vi.mocked(createGitForPath).mockReturnValue(git as any);

    const result = await validateWURules(
      {
        id: 'WU-TEST',
        type: 'bug',
        code_paths: ['packages/@lumenflow/core/src/wu-lint.ts'],
        tests: {
          unit: ['N/A - metadata-only changes, no unit tests needed'],
        },
        cwd: repoDir,
      },
      { phase: 'reality' },
    );

    expect(result.valid).toBe(false);
    const classificationIssue = result.errors.find(
      (issue) => issue.code === RULE_CODES.TEST_CLASSIFICATION,
    );
    expect(classificationIssue?.message).toContain('tests.unit');
    expect(classificationIssue?.suggestion).toContain('tests.manual');
  });

  it('allows manual-only test intent in intent/structural phases', () => {
    const result = validateWURulesSync(
      {
        id: 'WU-TEST',
        type: 'refactor',
        code_paths: ['packages/@lumenflow/core/src/wu-lint.ts'],
        tests: {
          manual: ['metadata-only changes validated manually'],
        },
      },
      { phase: 'intent' },
    );

    expect(result.valid).toBe(true);
  });

  it('keeps structural validation deterministic without git context', () => {
    const result = validateWURulesSync(
      {
        id: 'WU-TEST',
        type: 'refactor',
        code_paths: ['packages/@lumenflow/core/src/wu-lint.ts'],
        tests: {
          manual: ['manual test'],
        },
      },
      { phase: 'structural' },
    );

    expect(result.valid).toBe(true);
    expect(createGitForPath).not.toHaveBeenCalled();
  });

  it('resolves changed files from worktree cwd context', async () => {
    const git = makeGitMock({
      diffOutput: 'packages/@lumenflow/core/src/wu-lint.ts\n',
    });
    vi.mocked(createGitForPath).mockReturnValue(git as any);

    const result = await resolveChangedFiles({
      cwd: '/tmp/worktrees/framework-cli-wu-commands-wu-1680',
      baseRef: 'origin/main',
      headRef: 'HEAD',
    });

    expect(createGitForPath).toHaveBeenCalledWith(
      '/tmp/worktrees/framework-cli-wu-commands-wu-1680',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.files).toEqual(['packages/@lumenflow/core/src/wu-lint.ts']);
    }
  });
});
