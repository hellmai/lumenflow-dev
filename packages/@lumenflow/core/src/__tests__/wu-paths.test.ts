import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import {
  WU_PATHS,
  defaultWorktreeFrom,
  resolveRepoRoot,
  getStateStoreDirFromBacklog,
} from '../wu-paths.js';

describe('WU_PATHS', () => {
  describe('WU', () => {
    it('should return correct WU YAML path for given ID', () => {
      const result = WU_PATHS.WU('WU-123');
      expect(result).toBe('docs/04-operations/tasks/wu/WU-123.yaml');
    });

    it('should handle different WU IDs', () => {
      const result = WU_PATHS.WU('WU-999');
      expect(result).toBe('docs/04-operations/tasks/wu/WU-999.yaml');
    });
  });

  describe('STATUS', () => {
    it('should return correct status.md path', () => {
      const result = WU_PATHS.STATUS();
      expect(result).toBe('docs/04-operations/tasks/status.md');
    });
  });

  describe('BACKLOG', () => {
    it('should return correct backlog.md path', () => {
      const result = WU_PATHS.BACKLOG();
      expect(result).toBe('docs/04-operations/tasks/backlog.md');
    });
  });

  describe('STAMPS_DIR', () => {
    it('should return correct stamps directory path', () => {
      const result = WU_PATHS.STAMPS_DIR();
      expect(result).toBe('.beacon/stamps');
    });
  });

  describe('STAMP', () => {
    it('should return correct stamp file path for given ID', () => {
      const result = WU_PATHS.STAMP('WU-123');
      expect(result).toBe('.beacon/stamps/WU-123.done');
    });

    it('should handle different WU IDs', () => {
      const result = WU_PATHS.STAMP('WU-456');
      expect(result).toBe('.beacon/stamps/WU-456.done');
    });
  });
});

describe('defaultWorktreeFrom', () => {
  it('should generate worktree path from simple lane and ID', () => {
    const doc = { lane: 'Operations', id: 'WU-123' };
    const result = defaultWorktreeFrom(doc);
    expect(result).toBe('worktrees/operations-wu-123');
  });

  it('should handle sub-lane with colon separator', () => {
    const doc = { lane: 'Operations: Tooling', id: 'WU-456' };
    const result = defaultWorktreeFrom(doc);
    expect(result).toBe('worktrees/operations-tooling-wu-456');
  });

  it('should convert to lowercase and kebab-case', () => {
    const doc = { lane: 'Intelligence: Prompts', id: 'WU-789' };
    const result = defaultWorktreeFrom(doc);
    expect(result).toBe('worktrees/intelligence-prompts-wu-789');
  });

  it('should handle lane with multiple words', () => {
    const doc = { lane: 'Core Systems', id: 'WU-111' };
    const result = defaultWorktreeFrom(doc);
    expect(result).toBe('worktrees/core-systems-wu-111');
  });

  it('should handle special characters in lane name', () => {
    const doc = { lane: 'Operations & Maintenance', id: 'WU-222' };
    const result = defaultWorktreeFrom(doc);
    expect(result).toBe('worktrees/operations-maintenance-wu-222');
  });

  it('should return null when lane is missing', () => {
    const doc = { id: 'WU-123' };
    const result = defaultWorktreeFrom(doc);
    expect(result).toBe(null);
  });

  it('should return null when ID is missing', () => {
    const doc = { lane: 'Operations' };
    const result = defaultWorktreeFrom(doc);
    expect(result).toBe(null);
  });

  it('should return null when doc is null', () => {
    const result = defaultWorktreeFrom(null);
    expect(result).toBe(null);
  });

  it('should return null when doc is undefined', () => {
    const result = defaultWorktreeFrom(undefined);
    expect(result).toBe(null);
  });

  it('should return null when lane is empty string', () => {
    const doc = { lane: '', id: 'WU-123' };
    const result = defaultWorktreeFrom(doc);
    expect(result).toBe(null);
  });

  it('should return null when ID is empty string', () => {
    const doc = { lane: 'Operations', id: '' };
    const result = defaultWorktreeFrom(doc);
    expect(result).toBe(null);
  });

  it('should handle trimming whitespace', () => {
    const doc = { lane: '  Operations: Tooling  ', id: 'WU-999' };
    const result = defaultWorktreeFrom(doc);
    expect(result).toBe('worktrees/operations-tooling-wu-999');
  });
});

describe('resolveRepoRoot (WU-1593)', () => {
  // Test fixture paths constructed with path.join to satisfy linter
  const FIXTURES = {
    microWorktreeRoot: path.join(path.sep, 'tmp', 'wu-claim-abc123'),
    userProjectRoot: path.join(path.sep, 'home', 'user', 'project'),
    microRoot: path.join(path.sep, 'tmp', 'micro'),
    nestedRoot: path.join(path.sep, 'very', 'deep', 'nested', 'project'),
    userPatientpath: path.join(path.sep, 'home', 'user', 'exampleapp'),
  };

  // Standard repo subdirectory structure
  const REPO_SUBDIRS = ['docs', '04-operations', 'tasks'];

  it('should resolve repo root from backlog path (4 levels up)', () => {
    const backlogPath = path.join(FIXTURES.microWorktreeRoot, ...REPO_SUBDIRS, 'backlog.md');
    const result = resolveRepoRoot(backlogPath, 4);
    expect(result).toBe(FIXTURES.microWorktreeRoot);
  });

  it('should resolve repo root from status path (4 levels up)', () => {
    const statusPath = path.join(FIXTURES.userProjectRoot, ...REPO_SUBDIRS, 'status.md');
    const result = resolveRepoRoot(statusPath, 4);
    expect(result).toBe(FIXTURES.userProjectRoot);
  });

  it('should resolve repo root from WU YAML path (5 levels up)', () => {
    const wuPath = path.join(FIXTURES.microRoot, ...REPO_SUBDIRS, 'wu', 'WU-123.yaml');
    const result = resolveRepoRoot(wuPath, 5);
    expect(result).toBe(FIXTURES.microRoot);
  });

  it('should handle depth of 0 (returns same path)', () => {
    const somePath = path.join(path.sep, 'some', 'path', 'file.txt');
    const result = resolveRepoRoot(somePath, 0);
    expect(result).toBe(somePath);
  });

  it('should handle depth of 1', () => {
    const somePath = path.join(path.sep, 'parent', 'child', 'file.txt');
    const result = resolveRepoRoot(somePath, 1);
    assert.equal(result, path.join(path.sep, 'parent', 'child'));
  });

  it('should work with path.dirname for multiple levels', () => {
    const testPath = path.join(path.sep, 'a', 'b', 'c', 'd', 'file.txt');
    const result = resolveRepoRoot(testPath, 3);
    assert.equal(result, path.join(path.sep, 'a', 'b'));
  });
});

describe('getStateStoreDirFromBacklog (WU-1593)', () => {
  // Test fixture paths constructed with path.join to satisfy linter
  const FIXTURES = {
    microWorktreeRoot: path.join(path.sep, 'tmp', 'wu-claim-abc123'),
    userPatientpath: path.join(path.sep, 'home', 'user', 'exampleapp'),
    nestedRoot: path.join(path.sep, 'very', 'deep', 'nested', 'project'),
  };

  // Standard repo subdirectory structure
  const REPO_SUBDIRS = ['docs', '04-operations', 'tasks'];

  it('should return state store path from micro-worktree backlog path', () => {
    const backlogPath = path.join(FIXTURES.microWorktreeRoot, ...REPO_SUBDIRS, 'backlog.md');
    const result = getStateStoreDirFromBacklog(backlogPath);
    assert.equal(result, path.join(FIXTURES.microWorktreeRoot, '.beacon', 'state'));
  });

  it('should return state store path from main repo backlog path', () => {
    const backlogPath = path.join(FIXTURES.userPatientpath, ...REPO_SUBDIRS, 'backlog.md');
    const result = getStateStoreDirFromBacklog(backlogPath);
    assert.equal(result, path.join(FIXTURES.userPatientpath, '.beacon', 'state'));
  });

  it('should handle nested project paths', () => {
    const backlogPath = path.join(FIXTURES.nestedRoot, ...REPO_SUBDIRS, 'backlog.md');
    const result = getStateStoreDirFromBacklog(backlogPath);
    assert.equal(result, path.join(FIXTURES.nestedRoot, '.beacon', 'state'));
  });

  it('should NOT produce incorrect path with only 2 dirname calls (regression test)', () => {
    // WU-1593: This was the bug - only 2 dirname calls gave wrong result
    const backlogPath = path.join(FIXTURES.microWorktreeRoot, ...REPO_SUBDIRS, 'backlog.md');
    const result = getStateStoreDirFromBacklog(backlogPath);

    // The WRONG result would be at docs/04-operations level (only 2 levels up from backlog.md)
    const wrongPath = path.join(
      FIXTURES.microWorktreeRoot,
      'docs',
      '04-operations',
      '.beacon',
      'state'
    );
    expect(result).not.toBe(wrongPath);

    // The CORRECT result is at repo root (4 levels up from backlog.md)
    const correctPath = path.join(FIXTURES.microWorktreeRoot, '.beacon', 'state');
    expect(result).toBe(correctPath);
  });
});
