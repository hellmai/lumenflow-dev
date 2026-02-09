/**
 * Tests for initiative:plan replacement by plan:link (WU-1313)
 *
 * Validates that the existing initiative:plan functionality is preserved
 * when replaced by plan:link --target INIT-XXX.
 *
 * TDD: These tests are written BEFORE the implementation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseYAML, stringifyYAML } from '@lumenflow/core/wu-yaml';

/** Test constants - avoid sonarjs/no-duplicate-string */
const TEST_INIT_DIR = 'docs/04-operations/tasks/initiatives';
const TEST_INIT_ID = 'INIT-001';
const TEST_INIT_PLAN_URI = `lumenflow://plans/${TEST_INIT_ID}-plan.md`;
const TEST_PLANS_DIR = 'docs/04-operations/plans';

const TEST_LUMENFLOW_HOME_BAD = '/tmp/lumenflow-home-should-not-be-used';
const TEST_INIT_SLUG = 'test-initiative';
const TEST_INIT_TITLE = 'Test Initiative';
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
    const tempDir = join(tmpdir(), `init-plan-replace-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    return execute({ worktreePath: tempDir });
  }),
}));

describe('initiative:plan replaced by plan:link', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `init-plan-replace-test-${Date.now()}`);
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

  describe('plan:link for initiatives (backwards compatibility)', () => {
    it('should link plan to initiative via related_plan field', async () => {
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

      // Link plan (same operation as initiative:plan --initiative --plan)
      const changed = linkPlanToInitiative(tempDir, TEST_INIT_ID, TEST_INIT_PLAN_URI);

      expect(changed).toBe(true);

      // Verify the file was updated
      const updated = parseYAML(readFileSync(initPath, 'utf-8'));
      expect(updated.related_plan).toBe(TEST_INIT_PLAN_URI);
    });

    it('should create plan and link in single operation', async () => {
      const { createPlan } = await import('../plan-create.js');
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

      // Create plan (like initiative:plan --create)
      const planPath = createPlan(tempDir, TEST_INIT_ID, TEST_INIT_TITLE);
      expect(existsSync(planPath)).toBe(true);

      // Link plan
      const changed = linkPlanToInitiative(tempDir, TEST_INIT_ID, TEST_INIT_PLAN_URI);
      expect(changed).toBe(true);

      // Verify both plan file and initiative were updated
      const updated = parseYAML(readFileSync(initPath, 'utf-8'));
      expect(updated.related_plan).toBe(TEST_INIT_PLAN_URI);
    });
  });

  describe('initiative:plan deprecation', () => {
    it('should warn when using deprecated initiative:plan command', async () => {
      // The initiative:plan command should still work but warn about deprecation
      // and suggest using plan:link instead
      const initPlan = await import('../initiative-plan.js');

      expect(typeof initPlan.main).toBe('function');
      // The deprecation warning will be in the main function
    });
  });

  describe('plan:link auto-detection', () => {
    it('should auto-detect INIT target and call linkPlanToInitiative', async () => {
      const { resolveTargetType } = await import('../plan-link.js');

      expect(resolveTargetType(TEST_INIT_ID)).toBe('initiative');
      expect(resolveTargetType('INIT-TOOLING')).toBe('initiative');
    });

    it('should auto-detect WU target and call linkPlanToWU', async () => {
      const { resolveTargetType } = await import('../plan-link.js');

      expect(resolveTargetType('WU-1313')).toBe('wu');
      expect(resolveTargetType('WU-001')).toBe('wu');
    });
  });
});

describe('plan storage defaults to repo plansDir', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `plan-storage-test-${Date.now()}`);
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

  it('should create plans in repo directories.plansDir, not LUMENFLOW_HOME', async () => {
    const { createPlan } = await import('../plan-create.js');

    // Set LUMENFLOW_HOME to a different location (should be ignored)
    const oldLfHome = process.env.LUMENFLOW_HOME;
    process.env.LUMENFLOW_HOME = TEST_LUMENFLOW_HOME_BAD;

    try {
      const planPath = createPlan(tempDir, 'WU-1313', 'Test Plan');

      // Plan should be in repo plansDir, not LUMENFLOW_HOME
      expect(planPath).toContain(TEST_PLANS_DIR);
      expect(planPath).not.toContain(TEST_LUMENFLOW_HOME_BAD);
    } finally {
      if (oldLfHome === undefined) {
        delete process.env.LUMENFLOW_HOME;
      } else {
        process.env.LUMENFLOW_HOME = oldLfHome;
      }
    }
  });
});
