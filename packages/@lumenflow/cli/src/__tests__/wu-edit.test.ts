// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-1225: Tests for wu-edit append-by-default behavior
 *
 * Validates that array fields (code_paths, risks, acceptance, etc.)
 * now append by default instead of replacing, making behavior consistent
 * across all array options.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getConfig } from '@lumenflow/core/config';
import {
  applyEdits,
  buildWuEditStampNote,
  getWuEditCommitFiles,
  hasScopeRelevantBranchChanges,
  mergeStringField,
  normalizeReplaceCodePathsArgv,
  validateDoneWUEdits,
  validateWorktreeExecutionContext,
} from '../wu-edit.js';

describe('wu-edit applyEdits', () => {
  describe('WU-1225: code_paths append-by-default', () => {
    const baseWU = {
      id: 'WU-1225',
      status: 'ready',
      code_paths: ['existing/path.ts'],
    };

    it('appends code_paths by default (no flags)', () => {
      const opts = { codePaths: ['new/path.ts'] };
      const result = applyEdits(baseWU, opts);
      expect(result.code_paths).toEqual(['existing/path.ts', 'new/path.ts']);
    });

    it('appends code_paths when --append is set (backwards compat)', () => {
      const opts = { codePaths: ['new/path.ts'], append: true };
      const result = applyEdits(baseWU, opts);
      expect(result.code_paths).toEqual(['existing/path.ts', 'new/path.ts']);
    });

    it('replaces code_paths when --replace-code-paths is set', () => {
      const opts = { codePaths: ['new/path.ts'], replaceCodePaths: true };
      const result = applyEdits(baseWU, opts);
      expect(result.code_paths).toEqual(['new/path.ts']);
    });
  });

  describe('WU-1225: risks append-by-default', () => {
    const baseWU = {
      id: 'WU-1225',
      status: 'ready',
      risks: ['existing risk'],
    };

    it('appends risks by default', () => {
      const opts = { risks: ['new risk'] };
      const result = applyEdits(baseWU, opts);
      expect(result.risks).toEqual(['existing risk', 'new risk']);
    });

    it('replaces risks when --replace-risks is set', () => {
      const opts = { risks: ['new risk'], replaceRisks: true };
      const result = applyEdits(baseWU, opts);
      expect(result.risks).toEqual(['new risk']);
    });
  });

  describe('WU-1225: blocked_by append-by-default', () => {
    const baseWU = {
      id: 'WU-1225',
      status: 'ready',
      blocked_by: ['WU-100'],
    };

    it('appends blocked_by by default', () => {
      const opts = { blockedBy: 'WU-200' };
      const result = applyEdits(baseWU, opts);
      expect(result.blocked_by).toEqual(['WU-100', 'WU-200']);
    });

    it('replaces blocked_by when --replace-blocked-by is set', () => {
      const opts = { blockedBy: 'WU-200', replaceBlockedBy: true };
      const result = applyEdits(baseWU, opts);
      expect(result.blocked_by).toEqual(['WU-200']);
    });
  });

  describe('WU-1225: dependencies append-by-default', () => {
    const baseWU = {
      id: 'WU-1225',
      status: 'ready',
      dependencies: ['WU-50'],
    };

    it('appends dependencies by default', () => {
      const opts = { addDep: 'WU-60' };
      const result = applyEdits(baseWU, opts);
      expect(result.dependencies).toEqual(['WU-50', 'WU-60']);
    });

    it('replaces dependencies when --replace-dependencies is set', () => {
      const opts = { addDep: 'WU-60', replaceDependencies: true };
      const result = applyEdits(baseWU, opts);
      expect(result.dependencies).toEqual(['WU-60']);
    });
  });

  describe('WU-1144: acceptance already appends by default', () => {
    const baseWU = {
      id: 'WU-1225',
      status: 'ready',
      acceptance: ['existing criterion'],
    };

    it('appends acceptance by default', () => {
      const opts = { acceptance: ['new criterion'] };
      const result = applyEdits(baseWU, opts);
      expect(result.acceptance).toEqual(['existing criterion', 'new criterion']);
    });

    it('replaces acceptance when --replace-acceptance is set', () => {
      const opts = { acceptance: ['new criterion'], replaceAcceptance: true };
      const result = applyEdits(baseWU, opts);
      expect(result.acceptance).toEqual(['new criterion']);
    });
  });
});

/**
 * WU-1492: Tests for validateDoneWUEdits and branch-pr mode handling
 *
 * Verifies that done WU edits are correctly gated (existing behavior
 * is unchanged) and that branch-pr is not misclassified.
 */
describe('WU-1492: branch-pr mode wu:edit classification', () => {
  it('blocks non-metadata edits on done WUs (existing behavior)', () => {
    const result = validateDoneWUEdits({ description: 'new desc' });
    expect(result.valid).toBe(false);
    expect(result.disallowedEdits).toContain('--description');
  });

  it('allows initiative edit on done WUs (existing behavior)', () => {
    const result = validateDoneWUEdits({ initiative: 'INIT-016' });
    expect(result.valid).toBe(true);
  });
});

describe('wu-edit mergeStringField', () => {
  it('appends by default', () => {
    const result = mergeStringField('existing', 'new', false);
    expect(result).toBe('existing\n\nnew');
  });

  it('replaces when shouldReplace is true', () => {
    const result = mergeStringField('existing', 'new', true);
    expect(result).toBe('new');
  });

  it('returns new value if existing is empty', () => {
    const result = mergeStringField('', 'new', false);
    expect(result).toBe('new');
  });

  it('returns new value if existing is undefined', () => {
    const result = mergeStringField(undefined, 'new', false);
    expect(result).toBe('new');
  });
});

describe('WU-1594: backlog sync artifacts for wu:edit', () => {
  it('includes backlog.md in commit files for lane/spec metadata sync', () => {
    const files = getWuEditCommitFiles('WU-1594', [
      'docs/04-operations/tasks/initiatives/INIT-023.yaml',
    ]);

    expect(files).toContain('docs/04-operations/tasks/wu/WU-1594.yaml');
    expect(files).toContain('docs/04-operations/tasks/backlog.md');
    expect(files).toContain('docs/04-operations/tasks/initiatives/INIT-023.yaml');
  });
});

describe('WU-1618: replace-code-paths UX', () => {
  it('normalizes inline replace-code-paths value into --code-paths input', () => {
    const argv = [
      'node',
      'wu-edit.js',
      '--id',
      'WU-1618',
      '--replace-code-paths',
      'packages/a.ts,packages/b.ts',
    ];

    const normalized = normalizeReplaceCodePathsArgv(argv);
    expect(normalized).toEqual([
      'node',
      'wu-edit.js',
      '--id',
      'WU-1618',
      '--replace-code-paths',
      '--code-paths',
      'packages/a.ts,packages/b.ts',
    ]);
  });

  it('does not inject code-paths when replace-code-paths has no value', () => {
    const argv = ['node', 'wu-edit.js', '--id', 'WU-1618', '--replace-code-paths', '--notes', 'x'];
    const normalized = normalizeReplaceCodePathsArgv(argv);
    expect(normalized).toEqual(argv);
  });
});

describe('WU-1618: scope-relevant branch change detection', () => {
  it('returns false for metadata-only branch changes', () => {
    const config = getConfig({ projectRoot: process.cwd() });
    const result = hasScopeRelevantBranchChanges([
      `${config.state.stateDir}/wu-events.jsonl`,
      config.directories.backlogPath,
      config.directories.statusPath,
      `${config.directories.wuDir}/WU-1618.yaml`,
    ]);
    expect(result).toBe(false);
  });

  it('returns true when source changes are present', () => {
    const result = hasScopeRelevantBranchChanges([
      '.lumenflow/state/wu-events.jsonl',
      'packages/@lumenflow/cli/src/wu-edit.ts',
    ]);
    expect(result).toBe(true);
  });
});

describe('WU-2275: wu:edit stamp notes', () => {
  it('formats canonical wu:edit stamp note with path', () => {
    const note = buildWuEditStampNote('docs/04-operations/tasks/wu/WU-2275.yaml');
    expect(note).toBe('[wu:edit] path=docs/04-operations/tasks/wu/WU-2275.yaml');
  });

  it('invokes stamp-event append during wu:edit execution paths', () => {
    const source = readFileSync(new URL('../wu-edit.ts', import.meta.url), 'utf-8');
    expect(source).toContain('appendWuEditStampEvent');
  });
});

describe('WU-2290: wu:edit worktree execution context guard', () => {
  const TARGET_WORKTREE = '/repo/worktrees/framework-cli-wu-commands-wu-2290';
  const WU_ID = 'WU-2290';
  const RETRY_COMMAND = 'pnpm wu:edit --id WU-2290 --notes "test note"';

  it('allows edits when cwd is the claimed worktree', () => {
    expect(() =>
      validateWorktreeExecutionContext(TARGET_WORKTREE, TARGET_WORKTREE, WU_ID, RETRY_COMMAND),
    ).not.toThrow();
  });

  it('allows edits when cwd is inside the claimed worktree', () => {
    expect(() =>
      validateWorktreeExecutionContext(
        `${TARGET_WORKTREE}/packages/@lumenflow/cli`,
        TARGET_WORKTREE,
        WU_ID,
        RETRY_COMMAND,
      ),
    ).not.toThrow();
  });

  it('blocks edits when invoked from main checkout', () => {
    expect(() =>
      validateWorktreeExecutionContext('/repo', TARGET_WORKTREE, WU_ID, RETRY_COMMAND),
    ).toThrowError(new RegExp(`Cannot edit in_progress WU ${WU_ID} from this checkout`));
  });

  it('includes target worktree path and copy-paste retry command in failure output', () => {
    let errorMessage = '';
    try {
      validateWorktreeExecutionContext('/repo', TARGET_WORKTREE, WU_ID, RETRY_COMMAND);
    } catch (error) {
      if (error instanceof Error) {
        errorMessage = error.message;
      }
    }

    expect(errorMessage).toContain(`Claimed worktree: ${TARGET_WORKTREE}`);
    expect(errorMessage).toContain(`cd ${TARGET_WORKTREE}`);
    expect(errorMessage).toContain(RETRY_COMMAND);
  });
});
