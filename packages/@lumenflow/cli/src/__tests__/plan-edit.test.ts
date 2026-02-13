/**
 * Tests for plan:edit command (WU-1313)
 *
 * The plan:edit command edits existing plan files in the repo-native plansDir.
 * Uses micro-worktree isolation for atomic commits.
 *
 * TDD: These tests are written BEFORE the implementation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Test constants - avoid sonarjs/no-duplicate-string */
const TEST_PLANS_DIR = 'docs/04-operations/plans';
const TEST_WU_ID = 'WU-1313';

// Mock modules before importing
vi.mock('@lumenflow/core/git-adapter', () => ({
  getGitForCwd: vi.fn(() => ({
    branch: vi.fn().mockResolvedValue({ current: 'main' }),
    status: vi.fn().mockResolvedValue({ isClean: () => true }),
  })),
}));

vi.mock('@lumenflow/core/wu-helpers', () => ({
  ensureOnMain: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@lumenflow/core/micro-worktree', () => ({
  withMicroWorktree: vi.fn(async ({ execute }) => {
    const tempDir = join(tmpdir(), `plan-edit-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    return execute({ worktreePath: tempDir });
  }),
}));

describe('plan:edit command', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `plan-edit-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  describe('updatePlanSection', () => {
    it('should update a section in the plan', async () => {
      const { updatePlanSection } = await import('../plan-edit.js');

      // Setup plan file
      const plansDir = join(tempDir, ...TEST_PLANS_DIR.split('/'));
      mkdirSync(plansDir, { recursive: true });
      const planPath = join(plansDir, `${TEST_WU_ID}-plan.md`);
      writeFileSync(
        planPath,
        `# WU-1313 Plan

## Goal

Original goal content.

## Scope

In scope items.
`,
      );

      // Update goal section
      const changed = updatePlanSection(planPath, 'Goal', 'New goal content from edit.');

      expect(changed).toBe(true);

      const content = readFileSync(planPath, 'utf-8');
      expect(content).toContain('New goal content from edit.');
      expect(content).not.toContain('Original goal content.');
      expect(content).toContain('In scope items.'); // Other sections unchanged
    });

    it('should return false if section not found', async () => {
      const { updatePlanSection } = await import('../plan-edit.js');

      // Setup plan file without the target section
      const plansDir = join(tempDir, ...TEST_PLANS_DIR.split('/'));
      mkdirSync(plansDir, { recursive: true });
      const planPath = join(plansDir, `${TEST_WU_ID}-plan.md`);
      writeFileSync(
        planPath,
        `# WU-1313 Plan

## Goal

Goal content.
`,
      );

      // Try to update non-existent section
      const changed = updatePlanSection(planPath, 'NonExistent', 'New content');

      expect(changed).toBe(false);
    });

    it('should throw if plan file not found', async () => {
      const { updatePlanSection } = await import('../plan-edit.js');

      const planPath = join(tempDir, 'nonexistent.md');

      expect(() => updatePlanSection(planPath, 'Goal', 'content')).toThrow();
    });
  });

  describe('appendToSection', () => {
    it('should append content to an existing section', async () => {
      const { appendToSection } = await import('../plan-edit.js');

      // Setup plan file
      const plansDir = join(tempDir, ...TEST_PLANS_DIR.split('/'));
      mkdirSync(plansDir, { recursive: true });
      const planPath = join(plansDir, `${TEST_WU_ID}-plan.md`);
      writeFileSync(
        planPath,
        `# WU-1313 Plan

## Risks

- Risk 1

## References
`,
      );

      // Append to risks section
      const changed = appendToSection(planPath, 'Risks', '- Risk 2 from append');

      expect(changed).toBe(true);

      const content = readFileSync(planPath, 'utf-8');
      expect(content).toContain('- Risk 1');
      expect(content).toContain('- Risk 2 from append');
    });
  });

  describe('getPlanPath', () => {
    it('should resolve plan path from ID', async () => {
      const { getPlanPath } = await import('../plan-edit.js');

      // Setup plan file
      const plansDir = join(tempDir, ...TEST_PLANS_DIR.split('/'));
      mkdirSync(plansDir, { recursive: true });
      const planPath = join(plansDir, `${TEST_WU_ID}-plan.md`);
      writeFileSync(planPath, '# Plan');

      process.chdir(tempDir);
      const resolved = getPlanPath('WU-1313');

      expect(resolved).toContain(`${TEST_WU_ID}-plan.md`);
    });

    it('should throw if plan not found', async () => {
      const { getPlanPath } = await import('../plan-edit.js');

      process.chdir(tempDir);
      expect(() => getPlanPath('WU-9999')).toThrow();
    });
  });

  describe('getCommitMessage', () => {
    it('should generate correct commit message', async () => {
      const { getCommitMessage } = await import('../plan-edit.js');

      expect(getCommitMessage('WU-1313', 'Goal')).toBe('docs: update Goal section in wu-1313 plan');
      expect(getCommitMessage('INIT-001', 'Scope')).toBe(
        'docs: update Scope section in init-001 plan',
      );
    });
  });
});

describe('plan:edit CLI exports', () => {
  it('should export main function for CLI entry', async () => {
    const planEdit = await import('../plan-edit.js');
    expect(typeof planEdit.main).toBe('function');
  });

  it('should export all required functions', async () => {
    const planEdit = await import('../plan-edit.js');
    expect(typeof planEdit.updatePlanSection).toBe('function');
    expect(typeof planEdit.appendToSection).toBe('function');
    expect(typeof planEdit.getPlanPath).toBe('function');
    expect(typeof planEdit.getCommitMessage).toBe('function');
    expect(typeof planEdit.isRetryExhaustionError).toBe('function');
    expect(typeof planEdit.formatRetryExhaustionError).toBe('function');
    expect(planEdit.PLAN_EDIT_PUSH_RETRY_OVERRIDE).toEqual({
      retries: 8,
      min_delay_ms: 300,
      max_delay_ms: 4000,
    });
    expect(typeof planEdit.LOG_PREFIX).toBe('string');
  });
});
