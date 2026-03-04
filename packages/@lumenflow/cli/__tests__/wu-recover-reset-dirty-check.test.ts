/**
 * @file wu-recover-reset-dirty-check.test.ts
 * Tests for WU-2249: wu:recover --action reset checks worktree for uncommitted changes
 *
 * TDD: RED phase - Tests written BEFORE implementation
 *
 * Acceptance criteria:
 * - wu:recover --action reset checks worktree for uncommitted changes before deletion
 * - If uncommitted changes exist, abort with list of dirty files and instruction to commit or use --discard-changes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
// Constants imported via vi.hoisted() below to avoid TDZ issues with vi.mock() factories

// vi.hoisted ensures these are available before vi.mock factories run
const { WU_DIR, BACKLOG_PATH, STATUS_PATH, STATE_DIR, WU_EVENTS } = vi.hoisted(() => {
  // Inline the arc42 tasks path to avoid importing @lumenflow/core in hoisted scope
  const arc42Tasks = 'docs/04-operations/tasks';
  return {
    WU_DIR: `${arc42Tasks}/wu`,
    BACKLOG_PATH: `${arc42Tasks}/backlog.md`,
    STATUS_PATH: `${arc42Tasks}/status.md`,
    STATE_DIR: '.lumenflow/state',
    WU_EVENTS: '.lumenflow/state/wu-events.jsonl',
  };
});

// Mock modules before importing the module under test
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    rmSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

vi.mock('@lumenflow/core/wu-yaml', () => ({
  readWU: vi.fn(() => ({
    status: 'in_progress',
    lane: 'Framework: Core State Recovery',
    title: 'Test WU',
  })),
  writeWU: vi.fn(),
}));

vi.mock('@lumenflow/core/wu-paths', () => ({
  WU_PATHS: {
    WU: vi.fn((id: string) => `${WU_DIR}/${id}.yaml`),
    BACKLOG: vi.fn(() => BACKLOG_PATH),
    STATUS: vi.fn(() => STATUS_PATH),
  },
}));

vi.mock('@lumenflow/core/micro-worktree', () => ({
  withMicroWorktree: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@lumenflow/core/lane-lock', () => ({
  releaseLaneLock: vi.fn(() => ({ released: true, notFound: false })),
}));

vi.mock('@lumenflow/core/backlog-generator', () => ({
  generateBacklog: vi.fn().mockResolvedValue('# Backlog'),
  generateStatus: vi.fn().mockResolvedValue('# Status'),
}));

vi.mock('@lumenflow/core/wu-state-store', () => ({
  WU_EVENTS_FILE_NAME: 'wu-events.jsonl',
  WUStateStore: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(undefined),
    getWUState: vi.fn().mockReturnValue(null),
    release: vi.fn().mockResolvedValue(undefined),
    claim: vi.fn().mockResolvedValue(undefined),
  })),
}));

const mockGitStatus = vi.fn().mockResolvedValue('');
const mockWorktreeRemove = vi.fn().mockResolvedValue(undefined);
const mockDeleteBranch = vi.fn().mockResolvedValue(undefined);
const mockRaw = vi.fn().mockResolvedValue(undefined);
const mockGetCurrentBranch = vi.fn().mockResolvedValue('main');

vi.mock('@lumenflow/core/git-adapter', () => ({
  getGitForCwd: vi.fn(() => ({
    getStatus: mockGitStatus,
    worktreeRemove: mockWorktreeRemove,
    deleteBranch: mockDeleteBranch,
    raw: mockRaw,
    getCurrentBranch: mockGetCurrentBranch,
  })),
  createGitForPath: vi.fn(() => ({
    getStatus: mockGitStatus,
    worktreeRemove: mockWorktreeRemove,
    deleteBranch: mockDeleteBranch,
    raw: mockRaw,
    getCurrentBranch: mockGetCurrentBranch,
  })),
}));

vi.mock('../dist/state-path-resolvers.js', () => ({
  resolveStateDir: vi.fn((p: string) => `${p}/${STATE_DIR}`),
  resolveWuEventsRelativePath: vi.fn(() => WU_EVENTS),
}));

describe('WU-2249: reset action checks worktree for uncommitted changes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: worktree exists, clean status
    mockGitStatus.mockResolvedValue('');
  });

  describe('checkWorktreeForDirtyFiles', () => {
    it('returns empty array when worktree is clean', async () => {
      const { checkWorktreeForDirtyFiles } = await import('../dist/wu-recover.js');

      mockGitStatus.mockResolvedValue('');

      const result = await checkWorktreeForDirtyFiles('/fake/worktree/path');
      expect(result).toEqual([]);
    });

    it('returns list of dirty files when worktree has uncommitted changes', async () => {
      const { checkWorktreeForDirtyFiles } = await import('../dist/wu-recover.js');

      mockGitStatus.mockResolvedValue(' M packages/core/src/file.ts\n?? new-file.ts');

      const result = await checkWorktreeForDirtyFiles('/fake/worktree/path');
      expect(result).toHaveLength(2);
      expect(result).toContain(' M packages/core/src/file.ts');
      expect(result).toContain('?? new-file.ts');
    });

    it('returns empty array when worktree path does not exist', async () => {
      const { checkWorktreeForDirtyFiles } = await import('../dist/wu-recover.js');
      const { existsSync } = await import('node:fs');
      vi.mocked(existsSync).mockReturnValueOnce(false);

      const result = await checkWorktreeForDirtyFiles('/nonexistent/path');
      expect(result).toEqual([]);
    });
  });

  describe('getDirtyWorktreeAbortMessage', () => {
    it('lists dirty files and suggests --discard-changes or committing', async () => {
      const { getDirtyWorktreeAbortMessage } = await import('../dist/wu-recover.js');

      const dirtyFiles = [' M src/a.ts', '?? src/b.ts'];
      const message = getDirtyWorktreeAbortMessage('WU-100', dirtyFiles);

      expect(message).toContain('WU-100');
      expect(message).toContain('uncommitted changes');
      expect(message).toContain(' M src/a.ts');
      expect(message).toContain('?? src/b.ts');
      expect(message).toContain('--discard-changes');
      expect(message).toContain('commit');
    });
  });
});
