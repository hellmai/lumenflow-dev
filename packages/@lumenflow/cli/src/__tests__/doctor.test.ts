/**
 * Doctor CLI Tests (WU-1386)
 *
 * Tests for the agent-friction checks extension to lumenflow doctor:
 * - Managed-file dirty checks (uncommitted changes to managed files)
 * - WU validity check (--deep flag runs wu:validate --all)
 * - Worktree sanity check (orphan detection from wu:prune)
 * - Exit codes: 0=healthy, 1=warnings, 2=errors
 * - Auto-run after init (non-blocking)
 *
 * Note: These tests use real git operations (not mocked) to verify
 * the actual implementation behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

/**
 * Import the module under test
 */
import { runDoctor, runDoctorForInit } from '../doctor.js';

/**
 * Test constants
 */
const HUSKY_DIR = '.husky';
const SCRIPTS_DIR = 'scripts';
const DOCS_TASKS_DIR = 'docs/04-operations/tasks';

/**
 * Test directory path
 */
let testDir: string;

/**
 * Helper to create a minimal valid project structure
 */
function setupMinimalProject(baseDir: string): void {
  // Create husky
  mkdirSync(join(baseDir, HUSKY_DIR), { recursive: true });
  writeFileSync(join(baseDir, HUSKY_DIR, 'pre-commit'), '#!/bin/sh\n', 'utf-8');

  // Create safe-git
  mkdirSync(join(baseDir, SCRIPTS_DIR), { recursive: true });
  writeFileSync(join(baseDir, SCRIPTS_DIR, 'safe-git'), '#!/bin/sh\n', 'utf-8');

  // Create AGENTS.md
  writeFileSync(join(baseDir, 'AGENTS.md'), '# Agents\n', 'utf-8');

  // Create .lumenflow.config.yaml
  writeFileSync(join(baseDir, '.lumenflow.config.yaml'), 'lanes: []\n', 'utf-8');
}

/**
 * Helper to initialize git in test directory
 */
function initGit(baseDir: string): void {
  execFileSync('git', ['init', '-b', 'main'], { cwd: baseDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], {
    cwd: baseDir,
    stdio: 'pipe',
  });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: baseDir, stdio: 'pipe' });
}

describe('doctor CLI (WU-1386) - Agent Friction Checks', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'doctor-test-'));
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('managed-file dirty check', () => {
    it('should detect uncommitted changes to .lumenflow.config.yaml', async () => {
      setupMinimalProject(testDir);
      initGit(testDir);

      // Commit initial state
      execFileSync('git', ['add', '.'], { cwd: testDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'initial'], { cwd: testDir, stdio: 'pipe' });

      // Modify managed file
      writeFileSync(
        join(testDir, '.lumenflow.config.yaml'),
        'lanes: []\nmodified: true\n',
        'utf-8',
      );

      const result = await runDoctor(testDir);

      expect(result.workflowHealth).toBeDefined();
      expect(result.workflowHealth?.managedFilesDirty.passed).toBe(false);
      expect(result.workflowHealth?.managedFilesDirty.files).toContain('.lumenflow.config.yaml');
    });

    it('should detect uncommitted changes to docs/04-operations/tasks/**', async () => {
      setupMinimalProject(testDir);
      initGit(testDir);

      // Create and commit a placeholder file in the tasks directory first
      // This is needed because git shows untracked directories as just "?? docs/"
      // but shows files in tracked directories with full paths
      mkdirSync(join(testDir, DOCS_TASKS_DIR, 'wu'), { recursive: true });
      writeFileSync(
        join(testDir, DOCS_TASKS_DIR, 'wu', 'WU-000.yaml'),
        'id: WU-000\nstatus: done\nlane: Framework: CLI\n',
        'utf-8',
      );

      // Commit initial state including the placeholder
      execFileSync('git', ['add', '.'], { cwd: testDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'initial'], { cwd: testDir, stdio: 'pipe' });

      // Now add a new WU file (uncommitted) - git will show full path
      writeFileSync(
        join(testDir, DOCS_TASKS_DIR, 'wu', 'WU-001.yaml'),
        'id: WU-001\nstatus: ready\nlane: Framework: CLI\n',
        'utf-8',
      );

      const result = await runDoctor(testDir);

      expect(result.workflowHealth?.managedFilesDirty.passed).toBe(false);
      expect(result.workflowHealth?.managedFilesDirty.files).toContain(
        'docs/04-operations/tasks/wu/WU-001.yaml',
      );
    });

    it('should pass when no managed files have uncommitted changes', async () => {
      setupMinimalProject(testDir);
      initGit(testDir);

      // Commit all files
      execFileSync('git', ['add', '.'], { cwd: testDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'initial'], { cwd: testDir, stdio: 'pipe' });

      const result = await runDoctor(testDir);

      expect(result.workflowHealth?.managedFilesDirty.passed).toBe(true);
      expect(result.workflowHealth?.managedFilesDirty.files).toHaveLength(0);
    });

    it('should detect changes to AGENTS.md and CLAUDE.md', async () => {
      setupMinimalProject(testDir);
      writeFileSync(join(testDir, 'CLAUDE.md'), '# Claude\n', 'utf-8');
      initGit(testDir);

      // Commit initial state
      execFileSync('git', ['add', '.'], { cwd: testDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'initial'], { cwd: testDir, stdio: 'pipe' });

      // Modify both files
      writeFileSync(join(testDir, 'AGENTS.md'), '# Agents\nmodified\n', 'utf-8');
      writeFileSync(join(testDir, 'CLAUDE.md'), '# Claude\nmodified\n', 'utf-8');

      const result = await runDoctor(testDir);

      expect(result.workflowHealth?.managedFilesDirty.passed).toBe(false);
      expect(result.workflowHealth?.managedFilesDirty.files).toContain('AGENTS.md');
      expect(result.workflowHealth?.managedFilesDirty.files).toContain('CLAUDE.md');
    });

    it('should gracefully handle non-git directories', async () => {
      setupMinimalProject(testDir);
      // Don't init git

      const result = await runDoctor(testDir);

      // Should pass with graceful degradation message
      expect(result.workflowHealth?.managedFilesDirty.passed).toBe(true);
      expect(result.workflowHealth?.managedFilesDirty.message).toContain('skipped');
    });
  });

  describe('worktree sanity check', () => {
    it('should pass with graceful degradation in isolated test environment', async () => {
      setupMinimalProject(testDir);
      initGit(testDir);
      execFileSync('git', ['add', '.'], { cwd: testDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'initial'], { cwd: testDir, stdio: 'pipe' });

      const result = await runDoctor(testDir);

      // In isolated test env, wu:prune isn't available so it gracefully degrades
      // The check passes with a skip message or runs successfully
      expect(result.workflowHealth?.worktreeSanity.passed).toBe(true);
    });

    it('should gracefully handle non-git directories', async () => {
      setupMinimalProject(testDir);
      // Don't init git

      const result = await runDoctor(testDir);

      // Should pass with graceful degradation
      expect(result.workflowHealth?.worktreeSanity.passed).toBe(true);
      expect(result.workflowHealth?.worktreeSanity.message).toContain('skipped');
    });
  });

  describe('--deep flag (WU validity check)', () => {
    it('should skip WU validation by default (fast mode)', async () => {
      setupMinimalProject(testDir);

      const result = await runDoctor(testDir);

      // WU validation should be undefined in default mode
      expect(result.workflowHealth?.wuValidity).toBeUndefined();
    });

    it('should include wuValidity in --deep mode', async () => {
      setupMinimalProject(testDir);
      mkdirSync(join(testDir, DOCS_TASKS_DIR, 'wu'), { recursive: true });
      writeFileSync(
        join(testDir, DOCS_TASKS_DIR, 'wu', 'WU-001.yaml'),
        'id: WU-001\nstatus: ready\nlane: Framework: CLI\n',
        'utf-8',
      );

      const result = await runDoctor(testDir, { deep: true });

      // WU validation should be included in deep mode
      // In isolated test env, wu:validate may not be available (graceful degradation)
      expect(result.workflowHealth?.wuValidity).toBeDefined();
      // Either it ran successfully or gracefully skipped
      expect(result.workflowHealth?.wuValidity?.passed).toBe(true);
    });

    it('should gracefully handle missing wu:validate CLI', async () => {
      setupMinimalProject(testDir);
      // No WU directory - should still handle gracefully

      const result = await runDoctor(testDir, { deep: true });

      // No WU directory means passed=true with "No WU directory found" message
      expect(result.workflowHealth?.wuValidity).toBeDefined();
      expect(result.workflowHealth?.wuValidity?.passed).toBe(true);
      expect(result.workflowHealth?.wuValidity?.message).toContain('No WU');
    });
  });

  describe('exit codes', () => {
    it('should return exitCode 0 when all checks pass', async () => {
      setupMinimalProject(testDir);
      initGit(testDir);
      execFileSync('git', ['add', '.'], { cwd: testDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'initial'], { cwd: testDir, stdio: 'pipe' });

      const result = await runDoctor(testDir);

      expect(result.exitCode).toBe(0);
    });

    it('should return exitCode 1 when warnings are present', async () => {
      setupMinimalProject(testDir);
      initGit(testDir);
      execFileSync('git', ['add', '.'], { cwd: testDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'initial'], { cwd: testDir, stdio: 'pipe' });

      // Modify managed file to create warning
      writeFileSync(
        join(testDir, '.lumenflow.config.yaml'),
        'lanes: []\nmodified: true\n',
        'utf-8',
      );

      const result = await runDoctor(testDir);

      expect(result.exitCode).toBe(1);
    });

    it('should return exitCode 2 when critical errors are present', async () => {
      // No husky hooks - critical error
      mkdirSync(join(testDir, SCRIPTS_DIR), { recursive: true });
      writeFileSync(join(testDir, SCRIPTS_DIR, 'safe-git'), '#!/bin/sh\n', 'utf-8');
      writeFileSync(join(testDir, 'AGENTS.md'), '# Agents\n', 'utf-8');
      writeFileSync(join(testDir, '.lumenflow.config.yaml'), 'lanes: []\n', 'utf-8');

      const result = await runDoctor(testDir);

      expect(result.exitCode).toBe(2);
    });
  });

  describe('doctor result structure', () => {
    it('should include workflowHealth section in result', async () => {
      setupMinimalProject(testDir);

      const result = await runDoctor(testDir);

      // New workflowHealth section should be present
      expect(result.workflowHealth).toBeDefined();
      expect(result.workflowHealth?.managedFilesDirty).toBeDefined();
      expect(result.workflowHealth?.worktreeSanity).toBeDefined();
    });
  });
});

describe('doctor auto-run after init (WU-1386)', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'doctor-init-test-'));
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should never block init even with warnings', async () => {
    setupMinimalProject(testDir);
    initGit(testDir);
    execFileSync('git', ['add', '.'], { cwd: testDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: testDir, stdio: 'pipe' });

    // Modify managed file to create warning
    writeFileSync(join(testDir, '.lumenflow.config.yaml'), 'lanes: []\nmodified: true\n', 'utf-8');

    const result = await runDoctorForInit(testDir);

    // Should return warnings but not block
    expect(result.blocked).toBe(false);
    expect(result.warnings).toBeGreaterThan(0);
  });

  it('should print warnings but return success', async () => {
    setupMinimalProject(testDir);

    const result = await runDoctorForInit(testDir);

    // Non-blocking mode should always indicate success
    expect(result.blocked).toBe(false);
  });
});
