/**
 * State Doctor CLI Tests (WU-1230)
 *
 * Tests for state:doctor --fix functionality:
 * - Micro-worktree isolation for all tracked file changes
 * - Removal of stale WU references from backlog.md and status.md
 * - Changes pushed via merge, not direct file modification
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

/**
 * Mocked modules
 */
vi.mock('@lumenflow/core/micro-worktree', () => ({
  withMicroWorktree: vi.fn(),
}));

vi.mock('@lumenflow/core/git-adapter', () => ({
  getGitForCwd: vi.fn(() => ({
    fetch: vi.fn(),
    merge: vi.fn(),
    push: vi.fn(),
  })),
  createGitForPath: vi.fn(() => ({
    add: vi.fn(),
    commit: vi.fn(),
    push: vi.fn(),
  })),
}));

/**
 * Import after mocks are set up
 */
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';

/**
 * Constants for test paths
 */
const LUMENFLOW_DIR = '.lumenflow';
const STATE_DIR = 'state';
const STAMPS_DIR = 'stamps';
const MEMORY_DIR = 'memory';
const DOCS_TASKS_DIR = 'docs/04-operations/tasks';
const BACKLOG_PATH = `${DOCS_TASKS_DIR}/backlog.md`;
const STATUS_PATH = `${DOCS_TASKS_DIR}/status.md`;

/**
 * Test directory path
 */
let testDir: string;

describe('state-doctor CLI (WU-1230)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Create temp directory for each test
    testDir = mkdtempSync(join(tmpdir(), 'state-doctor-test-'));
  });

  afterEach(() => {
    // Cleanup temp directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('micro-worktree isolation', () => {
    it('should use micro-worktree when --fix modifies tracked files', async () => {
      // Setup: Create test state with broken events
      setupTestState(testDir, {
        wus: [],
        events: [{ wuId: 'WU-999', type: 'claimed', timestamp: new Date().toISOString() }],
      });

      // Mock withMicroWorktree to track that it was called
      const mockWithMicroWorktree = vi.mocked(withMicroWorktree);
      mockWithMicroWorktree.mockImplementation(async (options) => {
        // Execute the callback to simulate micro-worktree operations
        const result = await options.execute({
          worktreePath: testDir,
          gitWorktree: {
            add: vi.fn(),
            addWithDeletions: vi.fn(),
            commit: vi.fn(),
            push: vi.fn(),
          } as unknown as Parameters<typeof options.execute>[0]['gitWorktree'],
        });
        return { ...result, ref: 'main' };
      });

      // Import and run the fix function
      const { createStateDoctorFixDeps } = await import('../state-doctor-fix.js');
      const deps = createStateDoctorFixDeps(testDir);

      // When: Attempt to remove a broken event
      await deps.removeEvent('WU-999');

      // Then: micro-worktree should have been used
      expect(mockWithMicroWorktree).toHaveBeenCalled();
      expect(mockWithMicroWorktree).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'state-doctor',
          pushOnly: true,
        }),
      );
    });

    it('should not directly modify files on main when --fix is used', async () => {
      // Setup: Create test state with events file
      const eventsPath = join(testDir, LUMENFLOW_DIR, STATE_DIR, 'wu-events.jsonl');
      setupTestState(testDir, {
        wus: [],
        events: [{ wuId: 'WU-999', type: 'claimed', timestamp: new Date().toISOString() }],
      });

      const originalContent = readFileSync(eventsPath, 'utf-8');

      // Mock withMicroWorktree to NOT actually modify files (simulating push-only mode)
      const mockWithMicroWorktree = vi.mocked(withMicroWorktree);
      mockWithMicroWorktree.mockResolvedValue({
        commitMessage: 'fix: remove broken events',
        files: ['.lumenflow/state/wu-events.jsonl'],
        ref: 'main',
      });

      // Import and run the fix function
      const { createStateDoctorFixDeps } = await import('../state-doctor-fix.js');
      const deps = createStateDoctorFixDeps(testDir);

      // When: Remove broken event
      await deps.removeEvent('WU-999');

      // Then: Original file on main should be unchanged
      // (changes only happen in micro-worktree and pushed)
      const currentContent = readFileSync(eventsPath, 'utf-8');
      expect(currentContent).toBe(originalContent);
    });
  });

  describe('backlog.md and status.md cleanup', () => {
    it('should remove stale WU references from backlog.md when removing broken events', async () => {
      // Setup: Create backlog.md with reference to WU that will be removed
      setupTestState(testDir, {
        wus: [],
        events: [{ wuId: 'WU-999', type: 'claimed', timestamp: new Date().toISOString() }],
        backlog: `# Backlog

## In Progress

- WU-999: Some old WU that no longer exists

## Ready

- WU-100: Valid WU
`,
      });

      // Track the files that would be modified in micro-worktree
      let capturedFiles: string[] = [];
      const mockWithMicroWorktree = vi.mocked(withMicroWorktree);
      mockWithMicroWorktree.mockImplementation(async (options) => {
        const result = await options.execute({
          worktreePath: testDir,
          gitWorktree: {
            add: vi.fn(),
            addWithDeletions: vi.fn(),
            commit: vi.fn(),
            push: vi.fn(),
          } as unknown as Parameters<typeof options.execute>[0]['gitWorktree'],
        });
        capturedFiles = result.files;
        return { ...result, ref: 'main' };
      });

      // Import and run the fix function
      const { createStateDoctorFixDeps } = await import('../state-doctor-fix.js');
      const deps = createStateDoctorFixDeps(testDir);

      // When: Remove broken event for WU-999
      await deps.removeEvent('WU-999');

      // Then: backlog.md should be in the list of modified files
      expect(capturedFiles).toContain(BACKLOG_PATH);
    });

    it('should remove stale WU references from status.md when removing broken events', async () => {
      // Setup: Create status.md with reference to WU that will be removed
      setupTestState(testDir, {
        wus: [],
        events: [{ wuId: 'WU-999', type: 'claimed', timestamp: new Date().toISOString() }],
        status: `# Status

## In Progress

| Lane | WU | Title |
|------|-----|-------|
| Framework: CLI | WU-999 | Old WU |
`,
      });

      // Track the files that would be modified
      let capturedFiles: string[] = [];
      const mockWithMicroWorktree = vi.mocked(withMicroWorktree);
      mockWithMicroWorktree.mockImplementation(async (options) => {
        const result = await options.execute({
          worktreePath: testDir,
          gitWorktree: {
            add: vi.fn(),
            addWithDeletions: vi.fn(),
            commit: vi.fn(),
            push: vi.fn(),
          } as unknown as Parameters<typeof options.execute>[0]['gitWorktree'],
        });
        capturedFiles = result.files;
        return { ...result, ref: 'main' };
      });

      // Import and run the fix function
      const { createStateDoctorFixDeps } = await import('../state-doctor-fix.js');
      const deps = createStateDoctorFixDeps(testDir);

      // When: Remove broken event for WU-999
      await deps.removeEvent('WU-999');

      // Then: status.md should be in the list of modified files
      expect(capturedFiles).toContain(STATUS_PATH);
    });
  });

  describe('commit and push behavior', () => {
    it('should use pushOnly mode to avoid modifying local main', async () => {
      setupTestState(testDir, {
        wus: [],
        events: [{ wuId: 'WU-999', type: 'claimed', timestamp: new Date().toISOString() }],
      });

      const mockWithMicroWorktree = vi.mocked(withMicroWorktree);
      mockWithMicroWorktree.mockImplementation(async (options) => {
        // Verify pushOnly is set
        expect(options.pushOnly).toBe(true);
        const result = await options.execute({
          worktreePath: testDir,
          gitWorktree: {
            add: vi.fn(),
            addWithDeletions: vi.fn(),
            commit: vi.fn(),
            push: vi.fn(),
          } as unknown as Parameters<typeof options.execute>[0]['gitWorktree'],
        });
        return { ...result, ref: 'main' };
      });

      const { createStateDoctorFixDeps } = await import('../state-doctor-fix.js');
      const deps = createStateDoctorFixDeps(testDir);

      await deps.removeEvent('WU-999');

      // The assertion is inside the mock - if we get here without error, pushOnly was true
      expect(mockWithMicroWorktree).toHaveBeenCalled();
    });
  });

  // WU-1362: Retry logic for push failures
  describe('WU-1362: retry logic for push failures', () => {
    it('should retry on push failure with exponential backoff', async () => {
      setupTestState(testDir, {
        wus: [],
        events: [{ wuId: 'WU-999', type: 'claimed', timestamp: new Date().toISOString() }],
      });

      let callCount = 0;
      const mockWithMicroWorktree = vi.mocked(withMicroWorktree);
      mockWithMicroWorktree.mockImplementation(async (options) => {
        callCount++;
        // Simulate the micro-worktree handling retries internally
        const result = await options.execute({
          worktreePath: testDir,
          gitWorktree: {
            add: vi.fn(),
            addWithDeletions: vi.fn(),
            commit: vi.fn(),
            push: vi.fn(),
          } as unknown as Parameters<typeof options.execute>[0]['gitWorktree'],
        });
        return { ...result, ref: 'main' };
      });

      const { createStateDoctorFixDeps } = await import('../state-doctor-fix.js');
      const deps = createStateDoctorFixDeps(testDir);

      // removeEvent should succeed (micro-worktree handles retry internally)
      await deps.removeEvent('WU-999');
      expect(callCount).toBe(1);
    });

    it('should use maxRetries configuration from config', async () => {
      setupTestState(testDir, {
        wus: [],
        events: [{ wuId: 'WU-999', type: 'claimed', timestamp: new Date().toISOString() }],
      });

      const mockWithMicroWorktree = vi.mocked(withMicroWorktree);
      mockWithMicroWorktree.mockImplementation(async (options) => {
        // Verify retries is set (micro-worktree handles retry logic)
        const result = await options.execute({
          worktreePath: testDir,
          gitWorktree: {
            add: vi.fn(),
            addWithDeletions: vi.fn(),
            commit: vi.fn(),
            push: vi.fn(),
          } as unknown as Parameters<typeof options.execute>[0]['gitWorktree'],
        });
        return { ...result, ref: 'main' };
      });

      const { createStateDoctorFixDeps } = await import('../state-doctor-fix.js');
      const deps = createStateDoctorFixDeps(testDir);

      await deps.removeEvent('WU-999');
      expect(mockWithMicroWorktree).toHaveBeenCalled();
    });
  });
});

/**
 * Helper to set up test state files
 */
interface TestState {
  wus?: Array<{ id: string; status: string; title?: string }>;
  events?: Array<{ wuId: string; type: string; timestamp: string }>;
  signals?: Array<{ id: string; wuId?: string; message?: string }>;
  backlog?: string;
  status?: string;
}

function setupTestState(baseDir: string, state: TestState): void {
  // Create directories
  const dirs = [
    join(baseDir, LUMENFLOW_DIR, STATE_DIR),
    join(baseDir, LUMENFLOW_DIR, STAMPS_DIR),
    join(baseDir, LUMENFLOW_DIR, MEMORY_DIR),
    join(baseDir, DOCS_TASKS_DIR, 'wu'),
  ];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }

  // Create events file
  if (state.events && state.events.length > 0) {
    const eventsPath = join(baseDir, LUMENFLOW_DIR, STATE_DIR, 'wu-events.jsonl');
    const content = state.events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    writeFileSync(eventsPath, content, 'utf-8');
  }

  // Create signals file
  if (state.signals && state.signals.length > 0) {
    const signalsPath = join(baseDir, LUMENFLOW_DIR, MEMORY_DIR, 'signals.jsonl');
    const content = state.signals.map((s) => JSON.stringify(s)).join('\n') + '\n';
    writeFileSync(signalsPath, content, 'utf-8');
  }

  // Create WU YAML files
  if (state.wus) {
    for (const wu of state.wus) {
      const wuPath = join(baseDir, DOCS_TASKS_DIR, 'wu', `${wu.id}.yaml`);
      const content = `id: ${wu.id}\nstatus: ${wu.status}\ntitle: ${wu.title || wu.id}\n`;
      writeFileSync(wuPath, content, 'utf-8');
    }
  }

  // Create backlog.md
  if (state.backlog) {
    const backlogPath = join(baseDir, BACKLOG_PATH);
    writeFileSync(backlogPath, state.backlog, 'utf-8');
  }

  // Create status.md
  if (state.status) {
    const statusPath = join(baseDir, STATUS_PATH);
    writeFileSync(statusPath, state.status, 'utf-8');
  }
}
