import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { transitionWUStatus } from '../wu-status-transition.js';
import { readWU } from '../wu-yaml.js';

describe('wu-status-transition', () => {
  let testDir;
  let originalCwd;

  beforeEach(() => {
    // Create temporary directory for each test
    testDir = mkdtempSync(join(tmpdir(), 'wu-status-transition-test-'));
    originalCwd = process.cwd();

    // Create necessary directory structure
    const wuDir = join(testDir, 'docs/04-operations/tasks/wu');
    const tasksDir = join(testDir, 'docs/04-operations/tasks');
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

  function createWUFile(id, status = 'in_progress', lane = 'Operations') {
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
      assert.equal(result.id, 'WU-100');
      assert.equal(result.fromStatus, 'in_progress');
      assert.equal(result.toStatus, 'blocked');

      // Verify WU YAML updated
      const doc = readWU(wuPath, 'WU-100');
      assert.equal(doc.status, 'blocked');
      assert.ok(doc.notes.includes('Blocked'));
      assert.ok(doc.notes.includes('Blocked by WU-200'));

      // Verify backlog.md updated
      const backlogContent = readFileSync(backlogPath, 'utf8');
      assert.ok(backlogContent.includes('## ⛔ Blocked'));
      assert.ok(backlogContent.match(/WU-100.*Blocked by WU-200/));

      // Verify status.md updated
      const statusContent = readFileSync(statusPath, 'utf8');
      assert.ok(statusContent.includes('## Blocked'));
      assert.ok(statusContent.match(/WU-100.*Blocked by WU-200/));
    });

    it('should transition from ready to blocked via in_progress', () => {
      const wuPath = createWUFile('WU-100', 'ready');
      const backlogPath = createBacklogFile();
      const statusPath = createStatusFile();

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

      assert.equal(result.toStatus, 'blocked');

      const doc = readWU(wuPath, 'WU-100');
      assert.equal(doc.status, 'blocked');
    });

    it('should be idempotent - blocking already blocked WU is safe', () => {
      const wuPath = createWUFile('WU-100', 'blocked');
      const backlogPath = createBacklogFile();
      const statusPath = createStatusFile();

      // This should not throw, but also not change anything
      const result = transitionWUStatus({
        id: 'WU-100',
        direction: 'block',
        reason: 'Still blocked',
      });

      // Already blocked, so no state transition
      assert.equal(result.fromStatus, 'blocked');
      assert.equal(result.toStatus, 'blocked');
    });

    it('should reject invalid state transition', () => {
      createWUFile('WU-100', 'done');
      createBacklogFile();
      createStatusFile();

      // Cannot transition from done to blocked
      assert.throws(
        () =>
          transitionWUStatus({
            id: 'WU-100',
            direction: 'block',
            reason: 'Cannot block completed WU',
          }),
        /State transition validation failed/
      );
    });

    it('should handle block without reason', () => {
      const wuPath = createWUFile('WU-100', 'in_progress');
      const backlogPath = createBacklogFile();
      const statusPath = createStatusFile();

      transitionWUStatus({
        id: 'WU-100',
        direction: 'block',
      });

      const doc = readWU(wuPath, 'WU-100');
      assert.equal(doc.status, 'blocked');
      assert.ok(doc.notes.includes('Blocked'));
      // Reason is optional, so notes should still be added
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

      assert.equal(result.id, 'WU-100');
      assert.equal(result.fromStatus, 'blocked');
      assert.equal(result.toStatus, 'in_progress');

      const doc = readWU(wuPath, 'WU-100');
      assert.equal(doc.status, 'in_progress');
      assert.ok(doc.notes.includes('Unblocked'));
      assert.ok(doc.notes.includes('Blocker resolved'));
    });

    it('should be idempotent - unblocking already in_progress WU is safe', () => {
      const wuPath = createWUFile('WU-100', 'in_progress');
      const backlogPath = createBacklogFile();
      const statusPath = createStatusFile();

      const result = transitionWUStatus({
        id: 'WU-100',
        direction: 'unblock',
      });

      // Already in_progress, no state change
      assert.equal(result.fromStatus, 'in_progress');
      assert.equal(result.toStatus, 'in_progress');
    });

    it('should transition from ready to in_progress', () => {
      const wuPath = createWUFile('WU-100', 'ready');
      const backlogPath = createBacklogFile();
      const statusPath = createStatusFile();

      const result = transitionWUStatus({
        id: 'WU-100',
        direction: 'unblock', // unblock = move to in_progress
      });

      assert.equal(result.toStatus, 'in_progress');

      const doc = readWU(wuPath, 'WU-100');
      assert.equal(doc.status, 'in_progress');
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
      let removedWorktree = null;
      const mockGit = {
        removeWorktree: (path) => {
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
      assert.ok(removedWorktree, 'removeWorktree should have been called');
      assert.ok(removedWorktree.includes('worktrees/operations-tooling-wu-100'));
    });

    it('should create worktree when unblocking with createWorktree=true', () => {
      createWUFile('WU-100', 'blocked', 'Operations: Tooling');
      createBacklogFile();
      createStatusFile();

      // Mock git run
      const gitCommands = [];
      const mockGit = {
        run: (cmd) => {
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
      assert.ok(worktreeCall, 'Expected git worktree add to be called');
      assert.ok(worktreeCall.includes('worktrees/operations-tooling-wu-100'));
    });

    it('should use custom worktree path if provided', () => {
      createWUFile('WU-100', 'in_progress');
      createBacklogFile();
      createStatusFile();

      // Create dummy worktree at custom path
      const customPath = join(testDir, 'custom-worktrees/wu-100');
      mkdirSync(customPath, { recursive: true });

      let removedWorktree = null;
      const mockGit = {
        removeWorktree: (path) => {
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

      assert.equal(removedWorktree, customPath);
    });
  });

  describe('transitionWUStatus - error handling', () => {
    it('should throw if WU file not found', () => {
      createBacklogFile();
      createStatusFile();

      assert.throws(
        () =>
          transitionWUStatus({
            id: 'WU-999',
            direction: 'block',
          }),
        /WU file not found/
      );
    });

    it('should throw if backlog.md not found', () => {
      createWUFile('WU-100');
      createStatusFile();

      assert.throws(
        () =>
          transitionWUStatus({
            id: 'WU-100',
            direction: 'block',
          }),
        /Missing.*backlog.md/
      );
    });

    it('should throw if status.md not found', () => {
      createWUFile('WU-100');
      createBacklogFile();

      assert.throws(
        () =>
          transitionWUStatus({
            id: 'WU-100',
            direction: 'block',
          }),
        /Missing.*status.md/
      );
    });
  });
});
