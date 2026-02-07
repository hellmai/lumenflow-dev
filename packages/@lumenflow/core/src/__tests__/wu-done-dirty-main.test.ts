/**
 * @file wu-done-dirty-main.test.ts
 * @description Tests for WU-1503: dirty-main pre-merge guard in wu:done
 *
 * Validates:
 * - git status --porcelain parsing for modified and untracked files
 * - Unrelated file detection by comparing against code_paths + metadata allowlist
 * - Blocking with actionable remediation guidance
 * - --force bypass support (audited)
 */

import { describe, it, expect } from 'vitest';

import {
  validateDirtyMain,
  buildDirtyMainErrorMessage,
  METADATA_ALLOWLIST_PATTERNS,
} from '../wu-done-validation.js';

describe('validateDirtyMain (WU-1503)', () => {
  const wuId = 'WU-1503';
  const codePaths = [
    'packages/@lumenflow/cli/src/wu-done.ts',
    'packages/@lumenflow/core/src/wu-done-validators.ts',
    'packages/@lumenflow/core/src/wu-done-worktree.ts',
  ];

  describe('clean main', () => {
    it('returns valid when git status is empty', () => {
      const result = validateDirtyMain('', wuId, codePaths);
      expect(result.valid).toBe(true);
      expect(result.unrelatedFiles).toEqual([]);
    });

    it('returns valid when git status is whitespace-only', () => {
      const result = validateDirtyMain('  \n  \n', wuId, codePaths);
      expect(result.valid).toBe(true);
      expect(result.unrelatedFiles).toEqual([]);
    });
  });

  describe('WU-related dirty files (should pass)', () => {
    it('allows modified files that match code_paths', () => {
      const status = ' M packages/@lumenflow/cli/src/wu-done.ts\n';
      const result = validateDirtyMain(status, wuId, codePaths);
      expect(result.valid).toBe(true);
      expect(result.unrelatedFiles).toEqual([]);
    });

    it('allows multiple modified code_paths files', () => {
      const status = [
        ' M packages/@lumenflow/cli/src/wu-done.ts',
        ' M packages/@lumenflow/core/src/wu-done-validators.ts',
      ].join('\n');
      const result = validateDirtyMain(status, wuId, codePaths);
      expect(result.valid).toBe(true);
    });

    it('allows metadata allowlist files (WU YAML)', () => {
      const status = ` M docs/04-operations/tasks/wu/${wuId}.yaml\n`;
      const result = validateDirtyMain(status, wuId, codePaths);
      expect(result.valid).toBe(true);
    });

    it('allows metadata allowlist files (status.md)', () => {
      const status = ' M docs/04-operations/tasks/status.md\n';
      const result = validateDirtyMain(status, wuId, codePaths);
      expect(result.valid).toBe(true);
    });

    it('allows metadata allowlist files (backlog.md)', () => {
      const status = ' M docs/04-operations/tasks/backlog.md\n';
      const result = validateDirtyMain(status, wuId, codePaths);
      expect(result.valid).toBe(true);
    });

    it('allows metadata allowlist files (stamps)', () => {
      const status = `?? .lumenflow/stamps/${wuId}.done\n`;
      const result = validateDirtyMain(status, wuId, codePaths);
      expect(result.valid).toBe(true);
    });

    it('allows metadata allowlist files (wu-events.jsonl)', () => {
      const status = ' M .lumenflow/state/wu-events.jsonl\n';
      const result = validateDirtyMain(status, wuId, codePaths);
      expect(result.valid).toBe(true);
    });
  });

  describe('unrelated dirty files (should block)', () => {
    it('blocks when unrelated files are modified', () => {
      const status = ' M packages/@lumenflow/memory/src/memory-store.ts\n';
      const result = validateDirtyMain(status, wuId, codePaths);
      expect(result.valid).toBe(false);
      expect(result.unrelatedFiles).toContain('packages/@lumenflow/memory/src/memory-store.ts');
    });

    it('blocks on untracked files outside code_paths', () => {
      const status = '?? some-random-file.txt\n';
      const result = validateDirtyMain(status, wuId, codePaths);
      expect(result.valid).toBe(false);
      expect(result.unrelatedFiles).toContain('some-random-file.txt');
    });

    it('identifies multiple unrelated files', () => {
      const status = [
        ' M packages/@lumenflow/cli/src/wu-done.ts', // related
        ' M packages/@lumenflow/memory/src/memory-store.ts', // unrelated
        '?? random.txt', // unrelated
        ' M docs/04-operations/tasks/status.md', // metadata allowlist
      ].join('\n');
      const result = validateDirtyMain(status, wuId, codePaths);
      expect(result.valid).toBe(false);
      expect(result.unrelatedFiles).toHaveLength(2);
      expect(result.unrelatedFiles).toContain('packages/@lumenflow/memory/src/memory-store.ts');
      expect(result.unrelatedFiles).toContain('random.txt');
    });
  });

  describe('git status --porcelain parsing', () => {
    it('handles staged (M_) files', () => {
      const status = 'M  unrelated-file.ts\n';
      const result = validateDirtyMain(status, wuId, codePaths);
      expect(result.valid).toBe(false);
      expect(result.unrelatedFiles).toContain('unrelated-file.ts');
    });

    it('handles unstaged (_M) files', () => {
      const status = ' M unrelated-file.ts\n';
      const result = validateDirtyMain(status, wuId, codePaths);
      expect(result.valid).toBe(false);
    });

    it('handles added (??) untracked files', () => {
      const status = '?? new-unrelated-file.ts\n';
      const result = validateDirtyMain(status, wuId, codePaths);
      expect(result.valid).toBe(false);
    });

    it('handles deleted (D_) files', () => {
      const status = 'D  unrelated-file.ts\n';
      const result = validateDirtyMain(status, wuId, codePaths);
      expect(result.valid).toBe(false);
    });

    it('handles renamed (R_) files with arrow notation', () => {
      const status = 'R  old-name.ts -> new-name.ts\n';
      const result = validateDirtyMain(status, wuId, codePaths);
      expect(result.valid).toBe(false);
      // Should use the destination path
      expect(result.unrelatedFiles).toContain('new-name.ts');
    });

    it('skips empty lines in porcelain output', () => {
      const status = ' M packages/@lumenflow/cli/src/wu-done.ts\n\n\n';
      const result = validateDirtyMain(status, wuId, codePaths);
      expect(result.valid).toBe(true);
    });
  });

  describe('code_paths matching', () => {
    it('handles empty code_paths array', () => {
      const status = ' M some-file.ts\n';
      const result = validateDirtyMain(status, wuId, []);
      // With no code_paths, only metadata allowlist matches - some-file.ts is unrelated
      expect(result.valid).toBe(false);
    });

    it('matches files that are children of code_paths directories', () => {
      // code_paths sometimes reference directories
      const dirCodePaths = ['packages/@lumenflow/cli/src/'];
      const status = ' M packages/@lumenflow/cli/src/some-new-file.ts\n';
      const result = validateDirtyMain(status, wuId, dirCodePaths);
      expect(result.valid).toBe(true);
    });
  });

  describe('metadata allowlist patterns', () => {
    it('exports METADATA_ALLOWLIST_PATTERNS constant', () => {
      expect(METADATA_ALLOWLIST_PATTERNS).toBeDefined();
      expect(Array.isArray(METADATA_ALLOWLIST_PATTERNS)).toBe(true);
      expect(METADATA_ALLOWLIST_PATTERNS.length).toBeGreaterThan(0);
    });

    it('allowlist includes status.md', () => {
      expect(
        METADATA_ALLOWLIST_PATTERNS.some(
          (p) => typeof p === 'string' && p.includes('status.md'),
        ),
      ).toBe(true);
    });

    it('allowlist includes backlog.md', () => {
      expect(
        METADATA_ALLOWLIST_PATTERNS.some(
          (p) => typeof p === 'string' && p.includes('backlog.md'),
        ),
      ).toBe(true);
    });

    it('allowlist includes wu-events.jsonl', () => {
      expect(
        METADATA_ALLOWLIST_PATTERNS.some(
          (p) => typeof p === 'string' && p.includes('wu-events.jsonl'),
        ),
      ).toBe(true);
    });
  });
});

describe('buildDirtyMainErrorMessage (WU-1503)', () => {
  it('includes WU ID in error message', () => {
    const message = buildDirtyMainErrorMessage('WU-1503', ['random.txt']);
    expect(message).toContain('WU-1503');
  });

  it('lists all unrelated files', () => {
    const unrelated = ['file1.ts', 'file2.ts', 'file3.ts'];
    const message = buildDirtyMainErrorMessage('WU-1503', unrelated);
    for (const f of unrelated) {
      expect(message).toContain(f);
    }
  });

  it('includes actionable remediation guidance', () => {
    const message = buildDirtyMainErrorMessage('WU-1503', ['random.txt']);
    // Should tell user what to do
    expect(message).toContain('git');
    expect(message).toContain('wu:done');
  });

  it('mentions --force bypass', () => {
    const message = buildDirtyMainErrorMessage('WU-1503', ['random.txt']);
    expect(message).toContain('--force');
  });

  it('does NOT mention --stash-dirty (AC4: not introduced)', () => {
    const message = buildDirtyMainErrorMessage('WU-1503', ['random.txt']);
    expect(message).not.toContain('--stash-dirty');
    expect(message).not.toContain('stash');
  });
});
