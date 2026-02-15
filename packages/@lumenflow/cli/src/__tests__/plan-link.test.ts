/**
 * Tests for plan:link command (WU-1313)
 *
 * The plan:link command links existing plan files to WUs (via plan field, WU-1683)
 * or initiatives (via related_plan). This replaces the initiative:plan command.
 *
 * TDD: These tests are written BEFORE the implementation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseYAML, stringifyYAML } from '@lumenflow/core/wu-yaml';

/** Test constants - avoid sonarjs/no-duplicate-string */
const TEST_WU_DIR = 'docs/04-operations/tasks/wu';
const TEST_INIT_DIR = 'docs/04-operations/tasks/initiatives';
const TEST_PLANS_DIR = 'docs/04-operations/plans';
const TEST_WU_ID = 'WU-1313';
const TEST_INIT_ID = 'INIT-001';
const TEST_WU_PLAN_URI = `lumenflow://plans/${TEST_WU_ID}-plan.md`;
const TEST_INIT_PLAN_URI = `lumenflow://plans/${TEST_INIT_ID}-plan.md`;
const TEST_LANE = 'Framework: CLI';
const TEST_INIT_SLUG = 'test-initiative';
const TEST_INIT_TITLE = 'Test Initiative';
const TEST_WU_TITLE = 'Test WU';
const TEST_STATUS_OPEN = 'open';
const TEST_DATE = '2026-01-25';

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
    const tempDir = join(tmpdir(), `plan-link-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    return execute({ worktreePath: tempDir });
  }),
}));

describe('plan:link command', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `plan-link-test-${Date.now()}`);
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

  describe('linkPlanToWU', () => {
    it('should set plan field on WU YAML (WU-1683)', async () => {
      const { linkPlanToWU } = await import('../plan-link.js');

      // Setup mock WU file
      const wuDir = join(tempDir, ...TEST_WU_DIR.split('/'));
      mkdirSync(wuDir, { recursive: true });
      const wuPath = join(wuDir, `${TEST_WU_ID}.yaml`);
      const wuDoc = {
        id: TEST_WU_ID,
        title: TEST_WU_TITLE,
        lane: TEST_LANE,
        status: 'ready',
        type: 'feature',
      };
      writeFileSync(wuPath, stringifyYAML(wuDoc));

      // Link plan
      const changed = linkPlanToWU(tempDir, TEST_WU_ID, TEST_WU_PLAN_URI);

      expect(changed).toBe(true);

      // Verify the file was updated with plan field (not spec_refs)
      const updated = parseYAML(readFileSync(wuPath, 'utf-8'));
      expect(updated.plan).toBe(TEST_WU_PLAN_URI);
    });

    it('should replace existing plan and not touch spec_refs (WU-1683)', async () => {
      const { linkPlanToWU } = await import('../plan-link.js');

      // Setup mock WU file with existing spec_refs and old plan
      const wuDir = join(tempDir, ...TEST_WU_DIR.split('/'));
      mkdirSync(wuDir, { recursive: true });
      const wuPath = join(wuDir, `${TEST_WU_ID}.yaml`);
      const wuDoc = {
        id: TEST_WU_ID,
        title: TEST_WU_TITLE,
        lane: TEST_LANE,
        status: 'ready',
        type: 'feature',
        plan: 'lumenflow://plans/old-plan.md',
        spec_refs: ['lumenflow://plans/existing-plan.md'],
      };
      writeFileSync(wuPath, stringifyYAML(wuDoc));

      // Link new plan
      const changed = linkPlanToWU(tempDir, TEST_WU_ID, TEST_WU_PLAN_URI);

      expect(changed).toBe(true);

      // Verify plan was replaced and spec_refs untouched
      const updated = parseYAML(readFileSync(wuPath, 'utf-8'));
      expect(updated.plan).toBe(TEST_WU_PLAN_URI);
      expect(updated.spec_refs).toContain('lumenflow://plans/existing-plan.md');
    });

    it('should be idempotent if plan already linked (WU-1683)', async () => {
      const { linkPlanToWU } = await import('../plan-link.js');

      // Setup mock WU file with plan already linked via plan field
      const wuDir = join(tempDir, ...TEST_WU_DIR.split('/'));
      mkdirSync(wuDir, { recursive: true });
      const wuPath = join(wuDir, `${TEST_WU_ID}.yaml`);
      const wuDoc = {
        id: TEST_WU_ID,
        title: TEST_WU_TITLE,
        lane: TEST_LANE,
        status: 'ready',
        type: 'feature',
        plan: TEST_WU_PLAN_URI,
      };
      writeFileSync(wuPath, stringifyYAML(wuDoc));

      // Link same plan again
      const changed = linkPlanToWU(tempDir, TEST_WU_ID, TEST_WU_PLAN_URI);

      expect(changed).toBe(false);
    });

    it('should throw if WU not found', async () => {
      const { linkPlanToWU } = await import('../plan-link.js');

      expect(() => linkPlanToWU(tempDir, 'WU-9999', 'lumenflow://plans/plan.md')).toThrow();
    });

    it('should set plan field even when spec_refs has invalid type (WU-1683)', async () => {
      const { linkPlanToWU } = await import('../plan-link.js');

      const wuDir = join(tempDir, ...TEST_WU_DIR.split('/'));
      mkdirSync(wuDir, { recursive: true });
      const wuPath = join(wuDir, `${TEST_WU_ID}.yaml`);
      writeFileSync(
        wuPath,
        [
          `id: ${TEST_WU_ID}`,
          `title: ${TEST_WU_TITLE}`,
          `lane: "${TEST_LANE}"`,
          'status: ready',
          'type: feature',
          'spec_refs: lumenflow://plans/old.md',
          '',
        ].join('\n'),
      );

      // WU-1683: linkPlanToWU no longer touches spec_refs, only sets plan field
      const changed = linkPlanToWU(tempDir, TEST_WU_ID, TEST_WU_PLAN_URI);
      expect(changed).toBe(true);

      const updated = parseYAML(readFileSync(wuPath, 'utf-8'));
      expect(updated.plan).toBe(TEST_WU_PLAN_URI);
    });
  });

  describe('linkPlanToInitiative', () => {
    it('should add related_plan field to initiative YAML', async () => {
      const { linkPlanToInitiative } = await import('../plan-link.js');

      // Setup mock initiative file
      const initDir = join(tempDir, ...TEST_INIT_DIR.split('/'));
      mkdirSync(initDir, { recursive: true });
      const initPath = join(initDir, `${TEST_INIT_ID}.yaml`);
      const initDoc = {
        id: TEST_INIT_ID,
        slug: TEST_INIT_SLUG,
        title: TEST_INIT_TITLE,
        status: TEST_STATUS_OPEN,
        created: TEST_DATE,
      };
      writeFileSync(initPath, stringifyYAML(initDoc));

      // Link plan
      const changed = linkPlanToInitiative(tempDir, TEST_INIT_ID, TEST_INIT_PLAN_URI);

      expect(changed).toBe(true);

      // Verify the file was updated
      const updated = parseYAML(readFileSync(initPath, 'utf-8'));
      expect(updated.related_plan).toBe(TEST_INIT_PLAN_URI);
    });

    it('should be idempotent if plan already linked', async () => {
      const { linkPlanToInitiative } = await import('../plan-link.js');

      // Setup mock initiative file with plan already linked
      const initDir = join(tempDir, ...TEST_INIT_DIR.split('/'));
      mkdirSync(initDir, { recursive: true });
      const initPath = join(initDir, `${TEST_INIT_ID}.yaml`);
      const initDoc = {
        id: TEST_INIT_ID,
        slug: TEST_INIT_SLUG,
        title: TEST_INIT_TITLE,
        status: TEST_STATUS_OPEN,
        created: TEST_DATE,
        related_plan: TEST_INIT_PLAN_URI,
      };
      writeFileSync(initPath, stringifyYAML(initDoc));

      // Link same plan again
      const changed = linkPlanToInitiative(tempDir, TEST_INIT_ID, TEST_INIT_PLAN_URI);

      expect(changed).toBe(false);
    });

    it('should warn but proceed if replacing existing plan', async () => {
      const { linkPlanToInitiative } = await import('../plan-link.js');
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Setup mock initiative with different plan
      const initDir = join(tempDir, ...TEST_INIT_DIR.split('/'));
      mkdirSync(initDir, { recursive: true });
      const initPath = join(initDir, `${TEST_INIT_ID}.yaml`);
      const initDoc = {
        id: TEST_INIT_ID,
        slug: TEST_INIT_SLUG,
        title: TEST_INIT_TITLE,
        status: TEST_STATUS_OPEN,
        created: TEST_DATE,
        related_plan: 'lumenflow://plans/old-plan.md',
      };
      writeFileSync(initPath, stringifyYAML(initDoc));

      // Link new plan
      const changed = linkPlanToInitiative(tempDir, TEST_INIT_ID, 'lumenflow://plans/new-plan.md');

      expect(changed).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Replacing existing'));

      consoleSpy.mockRestore();
    });

    it('should fail with clear error when related_plan has invalid type', async () => {
      const { linkPlanToInitiative } = await import('../plan-link.js');

      const initDir = join(tempDir, ...TEST_INIT_DIR.split('/'));
      mkdirSync(initDir, { recursive: true });
      const initPath = join(initDir, `${TEST_INIT_ID}.yaml`);
      writeFileSync(
        initPath,
        [
          `id: ${TEST_INIT_ID}`,
          `slug: ${TEST_INIT_SLUG}`,
          `title: ${TEST_INIT_TITLE}`,
          `status: ${TEST_STATUS_OPEN}`,
          `created: ${TEST_DATE}`,
          'related_plan:',
          '  bad: value',
          '',
        ].join('\n'),
      );

      expect(() => linkPlanToInitiative(tempDir, TEST_INIT_ID, TEST_INIT_PLAN_URI)).toThrow(
        /related_plan.*string/i,
      );
    });
  });

  describe('validatePlanExists', () => {
    it('should pass for existing plan file', async () => {
      const { validatePlanExists } = await import('../plan-link.js');

      const plansDir = join(tempDir, ...TEST_PLANS_DIR.split('/'));
      mkdirSync(plansDir, { recursive: true });
      const planPath = join(plansDir, `${TEST_WU_ID}-plan.md`);
      writeFileSync(planPath, '# Plan');

      expect(() => validatePlanExists(tempDir, TEST_WU_PLAN_URI)).not.toThrow();
    });

    it('should throw for non-existent plan file', async () => {
      const { validatePlanExists } = await import('../plan-link.js');

      expect(() => validatePlanExists(tempDir, 'lumenflow://plans/nonexistent.md')).toThrow();
    });
  });

  describe('resolveTargetType', () => {
    it('should detect WU IDs', async () => {
      const { resolveTargetType } = await import('../plan-link.js');

      expect(resolveTargetType(TEST_WU_ID)).toBe('wu');
      expect(resolveTargetType('WU-001')).toBe('wu');
      expect(resolveTargetType('WU-99999')).toBe('wu');
    });

    it('should detect initiative IDs', async () => {
      const { resolveTargetType } = await import('../plan-link.js');

      expect(resolveTargetType(TEST_INIT_ID)).toBe('initiative');
      expect(resolveTargetType('INIT-TOOLING')).toBe('initiative');
    });

    it('should throw for invalid IDs', async () => {
      const { resolveTargetType } = await import('../plan-link.js');

      expect(() => resolveTargetType('invalid')).toThrow();
      expect(() => resolveTargetType('')).toThrow();
    });
  });
});

describe('plan:link CLI exports', () => {
  it('should export main function for CLI entry', async () => {
    const planLink = await import('../plan-link.js');
    expect(typeof planLink.main).toBe('function');
  });

  it('should export all required functions', async () => {
    const planLink = await import('../plan-link.js');
    expect(typeof planLink.linkPlanToWU).toBe('function');
    expect(typeof planLink.linkPlanToInitiative).toBe('function');
    expect(typeof planLink.validatePlanExists).toBe('function');
    expect(typeof planLink.resolveTargetType).toBe('function');
    expect(typeof planLink.isRetryExhaustionError).toBe('function');
    expect(typeof planLink.formatRetryExhaustionError).toBe('function');
    expect(planLink.PLAN_LINK_PUSH_RETRY_OVERRIDE).toEqual({
      retries: 8,
      min_delay_ms: 300,
      max_delay_ms: 4000,
    });
    expect(typeof planLink.LOG_PREFIX).toBe('string');
  });
});
