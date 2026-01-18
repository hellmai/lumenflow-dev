import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { transitionWUStatus } from '../wu-status-transition.js';
import { readWU } from '../wu-yaml.js';

// Check if running in a project with config files
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '../../..');
const hasConfig = existsSync(join(projectRoot, '.lumenflow.config.yaml'));

// Skip if no project config - these are integration tests
describe.skipIf(!hasConfig)('wu-status-transition', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Create temporary directory for each test
    testDir = mkdtempSync(join(tmpdir(), 'wu-status-transition-test-'));
    originalCwd = process.cwd();

    // Create necessary directory structure
    const wuDir = join(testDir, 'docs/04-operations/tasks/wu');
    mkdirSync(wuDir, { recursive: true });

    // Change to test directory for relative path operations
    process.chdir(testDir);
  });

  afterEach(() => {
    // Restore original directory and cleanup
    process.chdir(originalCwd);
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  function createWUFile(id: string, status = 'in_progress', lane = 'Operations') {
    const wuPath = join(testDir, `docs/04-operations/tasks/wu/${id}.yaml`);
    const content = `id: ${id}
title: Test WU
status: ${status}
lane: "${lane}"
type: feature
priority: P2
created: "2025-11-29"
description: Test description
acceptance:
  - Test criteria
code_paths: []
tests:
  manual: []
artifacts: []
dependencies: []
risks: []
notes: ""
requires_review: false`;
    writeFileSync(wuPath, content, 'utf8');
    return wuPath;
  }

  function createBacklogFile() {
    const backlogPath = join(testDir, 'docs/04-operations/tasks/backlog.md');
    const content = `---
sections:
  in_progress: '## 🔧 In progress'
  blocked: '## ⛔ Blocked'
---

# Backlog

## 🔧 In progress

- [WU-100 — Test WU](wu/WU-100.yaml)

## ⛔ Blocked

(No blocked items)
`;
    writeFileSync(backlogPath, content, 'utf8');
    return backlogPath;
  }

  function createStatusFile() {
    const statusPath = join(testDir, 'docs/04-operations/tasks/status.md');
    const content = `# WU Status

## In Progress

- [WU-100 — Test WU](wu/WU-100.yaml)

## Blocked

(No blocked items)
`;
    writeFileSync(statusPath, content, 'utf8');
    return statusPath;
  }

  describe('transitionWUStatus - block direction', () => {
    it('should transition WU from in_progress to blocked', () => {
      const wuPath = createWUFile('WU-100', 'in_progress');
      const backlogPath = createBacklogFile();
      const statusPath = createStatusFile();

      const result = transitionWUStatus({
        id: 'WU-100',
        direction: 'block',
        reason: 'Blocked by WU-200',
      });

      // Verify return value
      expect(result.id).toBe('WU-100');
      expect(result.fromStatus).toBe('in_progress');
      expect(result.toStatus).toBe('blocked');

      // Verify WU YAML updated
      const doc = readWU(wuPath, 'WU-100');
      expect(doc.status).toBe('blocked');
      expect(doc.notes.includes('Blocked')).toBe(true);
      expect(doc.notes.includes('Blocked by WU-200')).toBe(true);

      // Verify backlog.md updated
      const backlogContent = readFileSync(backlogPath, 'utf8');
      expect(backlogContent).toContain('## ⛔ Blocked');
      expect(backlogContent.match(/WU-100.*Blocked by WU-200/)).toBeTruthy();

      // Verify status.md updated
      const statusContent = readFileSync(statusPath, 'utf8');
      expect(statusContent).toContain('## Blocked');
      expect(statusContent.match(/WU-100.*Blocked by WU-200/)).toBeTruthy();
    });

    it('should transition from ready to blocked via in_progress', () => {
      const wuPath = createWUFile('WU-100', 'ready');
      createBacklogFile();
      createStatusFile();

      // First transition to in_progress
      transitionWUStatus({
        id: 'WU-100',
        direction: 'unblock', // unblock moves to in_progress
      });

      // Then block it
      const result = transitionWUStatus({
        id: 'WU-100',
        direction: 'block',
        reason: 'External dependency',
      });

      expect(result.toStatus).toBe('blocked');

      const doc = readWU(wuPath, 'WU-100');
      expect(doc.status).toBe('blocked');
    });

    it('should be idempotent - blocking already blocked WU is safe', () => {
      createWUFile('WU-100', 'blocked');
      createBacklogFile();
      createStatusFile();

      // This should not throw, but also not change anything
      const result = transitionWUStatus({
        id: 'WU-100',
        direction: 'block',
        reason: 'Still blocked',
      });

      // Already blocked, so no state transition
      expect(result.fromStatus).toBe('blocked');
      expect(result.toStatus).toBe('blocked');
    });

    it('should reject invalid state transition', () => {
      createWUFile('WU-100', 'done');
      createBacklogFile();
      createStatusFile();

      // Cannot transition from done to blocked
      expect(() =>
        transitionWUStatus({
          id: 'WU-100',
          direction: 'block',
          reason: 'Cannot block completed WU',
        }),
      ).toThrow(/State transition validation failed/);
    });

    it('should handle block without reason', () => {
      const wuPath = createWUFile('WU-100', 'in_progress');
      createBacklogFile();
      createStatusFile();

      transitionWUStatus({
        id: 'WU-100',
        direction: 'block',
      });

      const doc = readWU(wuPath, 'WU-100');
      expect(doc.status).toBe('blocked');
      expect(doc.notes.includes('Blocked')).toBe(true);
    });
  });

  describe('transitionWUStatus - unblock direction', () => {
    it('should transition WU from blocked to in_progress', () => {
      const wuPath = createWUFile('WU-100', 'blocked');
      const backlogPath = createBacklogFile();
      const statusPath = createStatusFile();

      const result = transitionWUStatus({
        id: 'WU-100',
        direction: 'unblock',
        reason: 'Blocker resolved',
      });

      expect(result.id).toBe('WU-100');
      expect(result.fromStatus).toBe('blocked');
      expect(result.toStatus).toBe('in_progress');

      const doc = readWU(wuPath, 'WU-100');
      expect(doc.status).toBe('in_progress');
      expect(doc.notes.includes('Unblocked')).toBe(true);
      expect(doc.notes.includes('Blocker resolved')).toBe(true);
    });

    it('should be idempotent - unblocking already in_progress WU is safe', () => {
      createWUFile('WU-100', 'in_progress');
      createBacklogFile();
      createStatusFile();

      const result = transitionWUStatus({
        id: 'WU-100',
        direction: 'unblock',
      });

      // Already in_progress, no state change
      expect(result.fromStatus).toBe('in_progress');
      expect(result.toStatus).toBe('in_progress');
    });

    it('should transition from ready to in_progress', () => {
      const wuPath = createWUFile('WU-100', 'ready');
      createBacklogFile();
      createStatusFile();

      const result = transitionWUStatus({
        id: 'WU-100',
        direction: 'unblock', // unblock = move to in_progress
      });

      expect(result.toStatus).toBe('in_progress');

      const doc = readWU(wuPath, 'WU-100');
      expect(doc.status).toBe('in_progress');
    });
  });

  describe('transitionWUStatus - worktree handling', () => {
    it('should remove worktree when blocking with removeWorktree=true', () => {
      createWUFile('WU-100', 'in_progress', 'Operations: Tooling');
      createBacklogFile();
      createStatusFile();

      // Create dummy worktree directory
      const worktreePath = join(testDir, 'worktrees/operations-tooling-wu-100');
      mkdirSync(worktreePath, { recursive: true });

      // Mock git worktree remove
      let removedWorktree: string | null = null;
      const mockGit = {
        removeWorktree: (path: string) => {
          removedWorktree = path;
        },
      };

      transitionWUStatus({
        id: 'WU-100',
        direction: 'block',
        reason: 'Testing worktree removal',
        removeWorktree: true,
        gitAdapter: mockGit,
      });

      // Verify worktree removal was called
      expect(removedWorktree).toBeTruthy();
      expect(removedWorktree).toContain('worktrees/operations-tooling-wu-100');
    });

    it('should create worktree when unblocking with createWorktree=true', () => {
      createWUFile('WU-100', 'blocked', 'Operations: Tooling');
      createBacklogFile();
      createStatusFile();

      // Mock git run
      const gitCommands: string[] = [];
      const mockGit = {
        run: (cmd: string) => {
          gitCommands.push(cmd);
          return '';
        },
      };

      transitionWUStatus({
        id: 'WU-100',
        direction: 'unblock',
        createWorktree: true,
        gitAdapter: mockGit,
      });

      // Verify worktree creation was called
      const worktreeCall = gitCommands.find((cmd) => cmd.includes('git worktree add'));
      expect(worktreeCall).toBeTruthy();
      expect(worktreeCall).toContain('worktrees/operations-tooling-wu-100');
    });

    it('should use custom worktree path if provided', () => {
      createWUFile('WU-100', 'in_progress');
      createBacklogFile();
      createStatusFile();

      // Create dummy worktree at custom path
      const customPath = join(testDir, 'custom-worktrees/wu-100');
      mkdirSync(customPath, { recursive: true });

      let removedWorktree: string | null = null;
      const mockGit = {
        removeWorktree: (path: string) => {
          removedWorktree = path;
        },
      };

      transitionWUStatus({
        id: 'WU-100',
        direction: 'block',
        removeWorktree: true,
        worktreeOverride: customPath,
        gitAdapter: mockGit,
      });

      expect(removedWorktree).toBe(customPath);
    });
  });

  describe('transitionWUStatus - error handling', () => {
    it('should throw if WU file not found', () => {
      createBacklogFile();
      createStatusFile();

      expect(() =>
        transitionWUStatus({
          id: 'WU-999',
          direction: 'block',
        }),
      ).toThrow(/WU file not found/);
    });

    it('should throw if backlog.md not found', () => {
      createWUFile('WU-100');
      createStatusFile();

      expect(() =>
        transitionWUStatus({
          id: 'WU-100',
          direction: 'block',
        }),
      ).toThrow(/Missing.*backlog.md/);
    });

    it('should throw if status.md not found', () => {
      createWUFile('WU-100');
      createBacklogFile();

      expect(() =>
        transitionWUStatus({
          id: 'WU-100',
          direction: 'block',
        }),
      ).toThrow(/Missing.*status.md/);
    });
  });
});
