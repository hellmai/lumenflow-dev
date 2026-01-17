import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseWUArgs } from '../arg-parser.js';

describe('parseWUArgs', () => {
  describe('common flags', () => {
    it('should parse --id flag', () => {
      const result = parseWUArgs(['node', 'script.js', '--id', 'WU-123']);
      expect(result.id).toBe('WU-123');
    });

    it('should parse --lane flag', () => {
      const result = parseWUArgs(['node', 'script.js', '--lane', 'Operations']);
      expect(result.lane).toBe('Operations');
    });

    it('should parse --reason flag', () => {
      const result = parseWUArgs(['node', 'script.js', '--reason', 'Waiting for review']);
      expect(result.reason).toBe('Waiting for review');
    });

    it('should parse --worktree flag', () => {
      const result = parseWUArgs(['node', 'script.js', '--worktree', 'worktrees/ops-wu-123']);
      expect(result.worktree).toBe('worktrees/ops-wu-123');
    });

    it('should parse --branch flag', () => {
      const result = parseWUArgs(['node', 'script.js', '--branch', 'lane/ops/wu-123']);
      expect(result.branch).toBe('lane/ops/wu-123');
    });
  });

  describe('boolean flags', () => {
    it('should parse --no-auto as noAuto boolean', () => {
      const result = parseWUArgs(['node', 'script.js', '--no-auto']);
      expect(result.noAuto).toBe(true);
    });

    it('should parse --force as force boolean', () => {
      const result = parseWUArgs(['node', 'script.js', '--force']);
      expect(result.force).toBe(true);
    });

    it('should parse --branch-only as branchOnly boolean', () => {
      const result = parseWUArgs(['node', 'script.js', '--branch-only']);
      expect(result.branchOnly).toBe(true);
    });

    it('should parse --pr-mode as prMode boolean', () => {
      const result = parseWUArgs(['node', 'script.js', '--pr-mode']);
      expect(result.prMode).toBe(true);
    });

    it('should parse --remove-worktree as removeWorktree boolean', () => {
      const result = parseWUArgs(['node', 'script.js', '--remove-worktree']);
      expect(result.removeWorktree).toBe(true);
    });

    it('should parse --create-worktree as createWorktree boolean', () => {
      const result = parseWUArgs(['node', 'script.js', '--create-worktree']);
      expect(result.createWorktree).toBe(true);
    });

    it('should parse --delete-branch as deleteBranch boolean', () => {
      const result = parseWUArgs(['node', 'script.js', '--delete-branch']);
      expect(result.deleteBranch).toBe(true);
    });

    it('should parse --no-remove as noRemove boolean', () => {
      const result = parseWUArgs(['node', 'script.js', '--no-remove']);
      expect(result.noRemove).toBe(true);
    });

    it('should parse --no-merge as noMerge boolean', () => {
      const result = parseWUArgs(['node', 'script.js', '--no-merge']);
      expect(result.noMerge).toBe(true);
    });

    it('should parse --help as help boolean', () => {
      const result = parseWUArgs(['node', 'script.js', '--help']);
      expect(result.help).toBe(true);
    });

    it('should parse -h as help boolean', () => {
      const result = parseWUArgs(['node', 'script.js', '-h']);
      expect(result.help).toBe(true);
    });
  });

  describe('special flags', () => {
    it('should parse --skip-gates with skipGates boolean', () => {
      const result = parseWUArgs(['node', 'script.js', '--skip-gates']);
      expect(result.skipGates).toBe(true);
    });

    it('should parse --allow-todo as allowTodo boolean', () => {
      const result = parseWUArgs(['node', 'script.js', '--allow-todo']);
      expect(result.allowTodo).toBe(true);
    });

    it('should parse --fix-wu flag', () => {
      const result = parseWUArgs(['node', 'script.js', '--fix-wu', 'WU-456']);
      expect(result.fixWu).toBe('WU-456');
    });

    it('should parse --force-overlap as forceOverlap boolean', () => {
      const result = parseWUArgs(['node', 'script.js', '--force-overlap']);
      expect(result.forceOverlap).toBe(true);
    });

    it('should parse --create-pr as createPr boolean', () => {
      const result = parseWUArgs(['node', 'script.js', '--create-pr']);
      expect(result.createPr).toBe(true);
    });

    it('should parse --override-owner as overrideOwner boolean', () => {
      const result = parseWUArgs(['node', 'script.js', '--override-owner']);
      expect(result.overrideOwner).toBe(true);
    });
  });

  describe('combined flags', () => {
    it('should parse multiple flags together', () => {
      const result = parseWUArgs([
        'node',
        'script.js',
        '--id',
        'WU-123',
        '--lane',
        'Operations',
        '--force',
      ]);
      expect(result.id).toBe('WU-123');
      expect(result.lane).toBe('Operations');
      expect(result.force).toBe(true);
    });

    it('should parse all common flags together', () => {
      const result = parseWUArgs([
        'node',
        'script.js',
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
      expect(result.id).toBe('WU-999');
      expect(result.lane).toBe('Intelligence');
      expect(result.worktree).toBe('worktrees/intel-wu-999');
      expect(result.branch).toBe('lane/intel/wu-999');
      expect(result.reason).toBe('Testing');
      expect(result.noAuto).toBe(true);
      expect(result.force).toBe(true);
    });
  });

  describe('pnpm compatibility', () => {
    it('should skip pnpm separator --', () => {
      const result = parseWUArgs(['node', 'script.js', '--', '--id', 'WU-123']);
      expect(result.id).toBe('WU-123');
    });

    it('should handle multiple -- separators', () => {
      const result = parseWUArgs([
        'node',
        'script.js',
        '--',
        '--id',
        'WU-123',
        '--',
        '--lane',
        'Operations',
      ]);
      expect(result.id).toBe('WU-123');
      expect(result.lane).toBe('Operations');
    });
  });

  describe('positional arguments', () => {
    it('should support WU ID as positional argument', () => {
      const result = parseWUArgs(['node', 'script.js', 'WU-123']);
      expect(result.id).toBe('WU-123');
    });

    it('should prefer --id flag over positional', () => {
      const result = parseWUArgs(['node', 'script.js', 'WU-999', '--id', 'WU-123']);
      expect(result.id).toBe('WU-123');
    });

    it('should use positional if no --id flag provided', () => {
      const result = parseWUArgs(['node', 'script.js', 'WU-456', '--lane', 'Operations']);
      expect(result.id).toBe('WU-456');
      expect(result.lane).toBe('Operations');
    });
  });

  describe('error handling', () => {
    it('should throw on unknown flag', () => {
      expect(() => parseWUArgs(['node', 'script.js', '--unknown-flag'])).toThrow(/unknown option/i);
    });

    it('should throw on flag missing required value', () => {
      expect(() => parseWUArgs(['node', 'script.js', '--id'])).toThrow(/argument missing/i);
    });
  });

  describe('default values', () => {
    it('should return empty object when no args provided', () => {
      const result = parseWUArgs(['node', 'script.js']);
      expect(result).toEqual({});
    });

    it('should not set undefined values for missing flags', () => {
      const result = parseWUArgs(['node', 'script.js', '--id', 'WU-123']);
      expect(result.id).toBe('WU-123');
      expect(result.lane).toBe(undefined);
      expect(result.force).toBe(undefined);
    });
  });
});
