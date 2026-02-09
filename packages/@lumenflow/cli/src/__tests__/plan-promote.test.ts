/**
 * Tests for plan:promote command (WU-1313)
 *
 * The plan:promote command promotes a plan from draft to approved status,
 * or creates WUs from plan sections.
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
    const tempDir = join(tmpdir(), `plan-promote-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    return execute({ worktreePath: tempDir });
  }),
}));

describe('plan:promote command', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `plan-promote-test-${Date.now()}`);
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

  describe('promotePlan', () => {
    it('should add approved status marker to plan', async () => {
      const { promotePlan } = await import('../plan-promote.js');

      // Setup plan file
      const plansDir = join(tempDir, ...TEST_PLANS_DIR.split('/'));
      mkdirSync(plansDir, { recursive: true });
      const planPath = join(plansDir, `${TEST_WU_ID}-plan.md`);
      writeFileSync(
        planPath,
        `# WU-1313 Plan

Created: 2026-02-01

## Goal

Implement plan tooling.
`,
      );

      // Promote plan
      const changed = promotePlan(planPath);

      expect(changed).toBe(true);

      const content = readFileSync(planPath, 'utf-8');
      expect(content).toContain('Status: approved');
      expect(content).toContain('Approved:');
    });

    it('should return false if plan already approved', async () => {
      const { promotePlan } = await import('../plan-promote.js');

      // Setup plan file with approved status
      const plansDir = join(tempDir, ...TEST_PLANS_DIR.split('/'));
      mkdirSync(plansDir, { recursive: true });
      const planPath = join(plansDir, `${TEST_WU_ID}-plan.md`);
      writeFileSync(
        planPath,
        `# WU-1313 Plan

Created: 2026-02-01
Status: approved
Approved: 2026-02-01

## Goal

Implement plan tooling.
`,
      );

      // Try to promote again
      const changed = promotePlan(planPath);

      expect(changed).toBe(false);
    });

    it('should throw if plan file not found', async () => {
      const { promotePlan } = await import('../plan-promote.js');

      const planPath = join(tempDir, 'nonexistent.md');

      expect(() => promotePlan(planPath)).toThrow();
    });
  });

  describe('validatePlanComplete', () => {
    it('should pass for complete plan', async () => {
      const { validatePlanComplete } = await import('../plan-promote.js');

      // Setup complete plan file
      const plansDir = join(tempDir, ...TEST_PLANS_DIR.split('/'));
      mkdirSync(plansDir, { recursive: true });
      const planPath = join(plansDir, `${TEST_WU_ID}-plan.md`);
      writeFileSync(
        planPath,
        `# WU-1313 Plan

Created: 2026-02-01

## Goal

Clear goal statement here.

## Scope

- In scope: A
- Out of scope: B

## Approach

Step 1: Do X
Step 2: Do Y
`,
      );

      const result = validatePlanComplete(planPath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail for plan with empty sections', async () => {
      const { validatePlanComplete } = await import('../plan-promote.js');

      // Setup incomplete plan file
      const plansDir = join(tempDir, ...TEST_PLANS_DIR.split('/'));
      mkdirSync(plansDir, { recursive: true });
      const planPath = join(plansDir, `${TEST_WU_ID}-plan.md`);
      writeFileSync(
        planPath,
        `# WU-1313 Plan

Created: 2026-02-01

## Goal

## Scope

## Approach
`,
      );

      const result = validatePlanComplete(planPath);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('Goal'))).toBe(true);
    });
  });

  describe('getPlanPath', () => {
    it('should resolve plan path from ID', async () => {
      const { getPlanPath } = await import('../plan-promote.js');

      // Setup plan file
      const plansDir = join(tempDir, ...TEST_PLANS_DIR.split('/'));
      mkdirSync(plansDir, { recursive: true });
      const planPath = join(plansDir, `${TEST_WU_ID}-plan.md`);
      writeFileSync(planPath, '# Plan');

      process.chdir(tempDir);
      const resolved = getPlanPath('WU-1313');

      expect(resolved).toContain(`${TEST_WU_ID}-plan.md`);
    });
  });

  describe('getCommitMessage', () => {
    it('should generate correct commit message', async () => {
      const { getCommitMessage } = await import('../plan-promote.js');

      expect(getCommitMessage('WU-1313')).toBe('docs: promote wu-1313 plan to approved');
      expect(getCommitMessage('INIT-001')).toBe('docs: promote init-001 plan to approved');
    });
  });
});

describe('plan:promote CLI exports', () => {
  it('should export main function for CLI entry', async () => {
    const planPromote = await import('../plan-promote.js');
    expect(typeof planPromote.main).toBe('function');
  });

  it('should export all required functions', async () => {
    const planPromote = await import('../plan-promote.js');
    expect(typeof planPromote.promotePlan).toBe('function');
    expect(typeof planPromote.validatePlanComplete).toBe('function');
    expect(typeof planPromote.getPlanPath).toBe('function');
    expect(typeof planPromote.getCommitMessage).toBe('function');
    expect(typeof planPromote.LOG_PREFIX).toBe('string');
  });
});
