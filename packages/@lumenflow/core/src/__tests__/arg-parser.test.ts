import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWUArgs } from '../arg-parser.mjs';

describe('parseWUArgs', () => {
  describe('common flags', () => {
    it('should parse --id flag', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--id', 'WU-123']);
      assert.equal(result.id, 'WU-123');
    });

    it('should parse --lane flag', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--lane', 'Operations']);
      assert.equal(result.lane, 'Operations');
    });

    it('should parse --reason flag', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--reason', 'Waiting for review']);
      assert.equal(result.reason, 'Waiting for review');
    });

    it('should parse --worktree flag', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--worktree', 'worktrees/ops-wu-123']);
      assert.equal(result.worktree, 'worktrees/ops-wu-123');
    });

    it('should parse --branch flag', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--branch', 'lane/ops/wu-123']);
      assert.equal(result.branch, 'lane/ops/wu-123');
    });
  });

  describe('boolean flags', () => {
    it('should parse --no-auto as noAuto boolean', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--no-auto']);
      assert.equal(result.noAuto, true);
    });

    it('should parse --force as force boolean', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--force']);
      assert.equal(result.force, true);
    });

    it('should parse --branch-only as branchOnly boolean', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--branch-only']);
      assert.equal(result.branchOnly, true);
    });

    it('should parse --pr-mode as prMode boolean', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--pr-mode']);
      assert.equal(result.prMode, true);
    });

    it('should parse --remove-worktree as removeWorktree boolean', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--remove-worktree']);
      assert.equal(result.removeWorktree, true);
    });

    it('should parse --create-worktree as createWorktree boolean', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--create-worktree']);
      assert.equal(result.createWorktree, true);
    });

    it('should parse --delete-branch as deleteBranch boolean', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--delete-branch']);
      assert.equal(result.deleteBranch, true);
    });

    it('should parse --no-remove as noRemove boolean', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--no-remove']);
      assert.equal(result.noRemove, true);
    });

    it('should parse --no-merge as noMerge boolean', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--no-merge']);
      assert.equal(result.noMerge, true);
    });

    it('should parse --help as help boolean', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--help']);
      assert.equal(result.help, true);
    });

    it('should parse -h as help boolean', () => {
      const result = parseWUArgs(['node', 'script.mjs', '-h']);
      assert.equal(result.help, true);
    });
  });

  describe('special flags', () => {
    it('should parse --skip-gates with skipGates boolean', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--skip-gates']);
      assert.equal(result.skipGates, true);
    });

    it('should parse --allow-todo as allowTodo boolean', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--allow-todo']);
      assert.equal(result.allowTodo, true);
    });

    it('should parse --fix-wu flag', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--fix-wu', 'WU-456']);
      assert.equal(result.fixWu, 'WU-456');
    });

    it('should parse --force-overlap as forceOverlap boolean', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--force-overlap']);
      assert.equal(result.forceOverlap, true);
    });

    it('should parse --create-pr as createPr boolean', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--create-pr']);
      assert.equal(result.createPr, true);
    });

    it('should parse --override-owner as overrideOwner boolean', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--override-owner']);
      assert.equal(result.overrideOwner, true);
    });
  });

  describe('combined flags', () => {
    it('should parse multiple flags together', () => {
      const result = parseWUArgs([
        'node',
        'script.mjs',
        '--id',
        'WU-123',
        '--lane',
        'Operations',
        '--force',
      ]);
      assert.equal(result.id, 'WU-123');
      assert.equal(result.lane, 'Operations');
      assert.equal(result.force, true);
    });

    it('should parse all common flags together', () => {
      const result = parseWUArgs([
        'node',
        'script.mjs',
        '--id',
        'WU-999',
        '--lane',
        'Intelligence',
        '--worktree',
        'worktrees/intel-wu-999',
        '--branch',
        'lane/intel/wu-999',
        '--reason',
        'Testing',
        '--no-auto',
        '--force',
      ]);
      assert.equal(result.id, 'WU-999');
      assert.equal(result.lane, 'Intelligence');
      assert.equal(result.worktree, 'worktrees/intel-wu-999');
      assert.equal(result.branch, 'lane/intel/wu-999');
      assert.equal(result.reason, 'Testing');
      assert.equal(result.noAuto, true);
      assert.equal(result.force, true);
    });
  });

  describe('pnpm compatibility', () => {
    it('should skip pnpm separator --', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--', '--id', 'WU-123']);
      assert.equal(result.id, 'WU-123');
    });

    it('should handle multiple -- separators', () => {
      const result = parseWUArgs([
        'node',
        'script.mjs',
        '--',
        '--id',
        'WU-123',
        '--',
        '--lane',
        'Operations',
      ]);
      assert.equal(result.id, 'WU-123');
      assert.equal(result.lane, 'Operations');
    });
  });

  describe('positional arguments', () => {
    it('should support WU ID as positional argument', () => {
      const result = parseWUArgs(['node', 'script.mjs', 'WU-123']);
      assert.equal(result.id, 'WU-123');
    });

    it('should prefer --id flag over positional', () => {
      const result = parseWUArgs(['node', 'script.mjs', 'WU-999', '--id', 'WU-123']);
      assert.equal(result.id, 'WU-123');
    });

    it('should use positional if no --id flag provided', () => {
      const result = parseWUArgs(['node', 'script.mjs', 'WU-456', '--lane', 'Operations']);
      assert.equal(result.id, 'WU-456');
      assert.equal(result.lane, 'Operations');
    });
  });

  describe('error handling', () => {
    it('should throw on unknown flag', () => {
      assert.throws(
        () => parseWUArgs(['node', 'script.mjs', '--unknown-flag']),
        /Unknown option '--unknown-flag'/
      );
    });

    it('should throw on flag missing required value', () => {
      assert.throws(
        () => parseWUArgs(['node', 'script.mjs', '--id']),
        /Option '--id <value>' argument missing/
      );
    });
  });

  describe('default values', () => {
    it('should return empty object when no args provided', () => {
      const result = parseWUArgs(['node', 'script.mjs']);
      assert.deepEqual(result, {});
    });

    it('should not set undefined values for missing flags', () => {
      const result = parseWUArgs(['node', 'script.mjs', '--id', 'WU-123']);
      assert.equal(result.id, 'WU-123');
      assert.equal(result.lane, undefined);
      assert.equal(result.force, undefined);
    });
  });
});
