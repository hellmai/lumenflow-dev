/**
 * Tests for plan:create command (WU-1313)
 *
 * The plan:create command creates plan files in the repo-native plansDir.
 * Plans can be linked to WUs (via spec_refs) or initiatives (via related_plan).
 *
 * TDD: These tests are written BEFORE the implementation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
    const tempDir = join(tmpdir(), `plan-create-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    return execute({ worktreePath: tempDir });
  }),
}));

describe('plan:create command', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `plan-create-test-${Date.now()}`);
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

  describe('createPlan', () => {
    it('should create a plan file in repo plansDir', async () => {
      const { createPlan } = await import('../plan-create.js');

      const plansDir = join(tempDir, 'docs', '04-operations', 'plans');
      mkdirSync(plansDir, { recursive: true });

      const planPath = createPlan(tempDir, 'WU-1313', 'Implement plan tooling');

      expect(existsSync(planPath)).toBe(true);
      const content = readFileSync(planPath, 'utf-8');
      expect(content).toContain('# WU-1313');
      expect(content).toContain('Implement plan tooling');
      expect(content).toContain('## Goal');
      expect(content).toContain('## Scope');
      expect(content).toContain('## Approach');
    });

    it('should create plans directory if it does not exist', async () => {
      const { createPlan } = await import('../plan-create.js');

      // Do NOT pre-create the plans directory
      const planPath = createPlan(tempDir, 'WU-1313', 'Test Plan');

      expect(existsSync(planPath)).toBe(true);
      expect(planPath).toContain('docs/04-operations/plans');
    });

    it('should not overwrite existing plan file', async () => {
      const { createPlan } = await import('../plan-create.js');

      const plansDir = join(tempDir, 'docs', '04-operations', 'plans');
      mkdirSync(plansDir, { recursive: true });

      // Create existing file
      const existingPath = join(plansDir, 'WU-1313-plan.md');
      writeFileSync(existingPath, '# Existing Content');

      expect(() => createPlan(tempDir, 'WU-1313', 'New Title')).toThrow();
    });

    it('should support initiative ID format', async () => {
      const { createPlan } = await import('../plan-create.js');

      const planPath = createPlan(tempDir, 'INIT-001', 'Initiative Plan');

      expect(existsSync(planPath)).toBe(true);
      const content = readFileSync(planPath, 'utf-8');
      expect(content).toContain('# INIT-001');
      expect(content).toContain('Initiative Plan');
    });
  });

  describe('getPlanUri', () => {
    it('should return lumenflow:// URI for plan', async () => {
      const { getPlanUri } = await import('../plan-create.js');

      expect(getPlanUri('WU-1313')).toBe('lumenflow://plans/WU-1313-plan.md');
      expect(getPlanUri('INIT-001')).toBe('lumenflow://plans/INIT-001-plan.md');
    });
  });

  describe('validatePlanId', () => {
    it('should accept valid WU and INIT IDs', async () => {
      const { validatePlanId } = await import('../plan-create.js');

      expect(() => validatePlanId('WU-1313')).not.toThrow();
      expect(() => validatePlanId('INIT-001')).not.toThrow();
      expect(() => validatePlanId('INIT-TOOLING')).not.toThrow();
    });

    it('should reject invalid IDs', async () => {
      const { validatePlanId } = await import('../plan-create.js');

      expect(() => validatePlanId('invalid')).toThrow();
      expect(() => validatePlanId('')).toThrow();
      expect(() => validatePlanId('WU1313')).toThrow();
    });
  });

  describe('getCommitMessage', () => {
    it('should generate correct commit message', async () => {
      const { getCommitMessage } = await import('../plan-create.js');

      expect(getCommitMessage('WU-1313', 'Feature Plan')).toBe(
        'docs: create plan for wu-1313 - Feature Plan',
      );
      expect(getCommitMessage('INIT-001', 'Auth System')).toBe(
        'docs: create plan for init-001 - Auth System',
      );
    });
  });
});

describe('plan:create CLI exports', () => {
  it('should export main function for CLI entry', async () => {
    const planCreate = await import('../plan-create.js');
    expect(typeof planCreate.main).toBe('function');
  });

  it('should export all required functions', async () => {
    const planCreate = await import('../plan-create.js');
    expect(typeof planCreate.createPlan).toBe('function');
    expect(typeof planCreate.getPlanUri).toBe('function');
    expect(typeof planCreate.validatePlanId).toBe('function');
    expect(typeof planCreate.getCommitMessage).toBe('function');
    expect(typeof planCreate.LOG_PREFIX).toBe('string');
  });
});
