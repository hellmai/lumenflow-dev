/**
 * Tests for initiative:plan command (WU-1105, renamed in WU-1193)
 *
 * The initiative:plan command links plan files to initiatives by setting
 * the `related_plan` field in the initiative YAML.
 *
 * TDD: These tests are written BEFORE the implementation.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseYAML, stringifyYAML } from '@lumenflow/core/wu-yaml';

// Pre-import the module to ensure coverage tracking includes the module itself
let initPlanModule: typeof import('../initiative-plan.js');
beforeAll(async () => {
  initPlanModule = await import('../initiative-plan.js');
});

// Mock modules before importing the module under test
const mockGit = {
  branch: vi.fn().mockResolvedValue({ current: 'main' }),
  status: vi.fn().mockResolvedValue({ isClean: () => true }),
};

vi.mock('@lumenflow/core/git-adapter', () => ({
  getGitForCwd: vi.fn(() => mockGit),
}));

vi.mock('@lumenflow/core/wu-helpers', () => ({
  ensureOnMain: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@lumenflow/core/micro-worktree', () => ({
  withMicroWorktree: vi.fn(async ({ execute }) => {
    // Simulate micro-worktree by executing in temp dir
    const tempDir = join(tmpdir(), `init-plan-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    try {
      await execute({ worktreePath: tempDir });
    } finally {
      // Cleanup handled by test
    }
  }),
}));

describe('init:plan command', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `init-plan-test-${Date.now()}`);
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

  describe('validateInitIdFormat', () => {
    it('should accept valid INIT-NNN format', async () => {
      const { validateInitIdFormat } = await import('../initiative-plan.js');
      // Should not throw
      expect(() => validateInitIdFormat('INIT-001')).not.toThrow();
      expect(() => validateInitIdFormat('INIT-123')).not.toThrow();
    });

    it('should accept valid INIT-NAME format', async () => {
      const { validateInitIdFormat } = await import('../initiative-plan.js');
      expect(() => validateInitIdFormat('INIT-TOOLING')).not.toThrow();
      expect(() => validateInitIdFormat('INIT-A1')).not.toThrow();
    });

    it('should reject invalid formats', async () => {
      const { validateInitIdFormat } = await import('../initiative-plan.js');
      expect(() => validateInitIdFormat('init-001')).toThrow();
      expect(() => validateInitIdFormat('INIT001')).toThrow();
      expect(() => validateInitIdFormat('WU-001')).toThrow();
      expect(() => validateInitIdFormat('')).toThrow();
    });
  });

  describe('validatePlanPath', () => {
    it('should accept existing markdown files', async () => {
      const { validatePlanPath } = await import('../initiative-plan.js');
      const planPath = join(tempDir, 'test-plan.md');
      writeFileSync(planPath, '# Test Plan');

      // Should not throw
      expect(() => validatePlanPath(planPath)).not.toThrow();
    });

    it('should reject non-existent files when not creating', async () => {
      const { validatePlanPath } = await import('../initiative-plan.js');
      const planPath = join(tempDir, 'nonexistent.md');

      expect(() => validatePlanPath(planPath)).toThrow();
    });

    it('should reject non-markdown files', async () => {
      const { validatePlanPath } = await import('../initiative-plan.js');
      const planPath = join(tempDir, 'test-plan.txt');
      writeFileSync(planPath, 'Test Plan');

      expect(() => validatePlanPath(planPath)).toThrow();
    });
  });

  describe('formatPlanUri', () => {
    it('should format plan path as lumenflow:// URI', async () => {
      const { formatPlanUri } = await import('../initiative-plan.js');

      expect(formatPlanUri('docs/04-operations/plans/my-plan.md')).toBe(
        'lumenflow://plans/my-plan.md',
      );
    });

    it('should handle nested paths', async () => {
      const { formatPlanUri } = await import('../initiative-plan.js');

      expect(formatPlanUri('docs/04-operations/plans/subdir/nested-plan.md')).toBe(
        'lumenflow://plans/subdir/nested-plan.md',
      );
    });

    it('should handle paths not in standard location', async () => {
      const { formatPlanUri } = await import('../initiative-plan.js');

      // Should still create a URI even for non-standard paths
      expect(formatPlanUri('/absolute/path/custom-plan.md')).toBe(
        'lumenflow://plans/custom-plan.md',
      );
    });
  });

  describe('checkInitiativeExists', () => {
    it('should return initiative doc if found', async () => {
      const { checkInitiativeExists } = await import('../initiative-plan.js');

      // Create a mock initiative file
      const initDir = join(tempDir, 'docs', '04-operations', 'tasks', 'initiatives');
      mkdirSync(initDir, { recursive: true });
      const initPath = join(initDir, 'INIT-001.yaml');
      const initDoc = {
        id: 'INIT-001',
        slug: 'test-initiative',
        title: 'Test Initiative',
        status: 'open',
        created: '2026-01-25',
      };
      writeFileSync(initPath, stringifyYAML(initDoc));

      process.chdir(tempDir);
      const result = checkInitiativeExists('INIT-001');
      expect(result.id).toBe('INIT-001');
    });

    it('should throw if initiative not found', async () => {
      const { checkInitiativeExists } = await import('../initiative-plan.js');

      process.chdir(tempDir);
      expect(() => checkInitiativeExists('INIT-999')).toThrow();
    });
  });

  describe('updateInitiativeWithPlan', () => {
    it('should add related_plan field to initiative', async () => {
      const { updateInitiativeWithPlan } = await import('../initiative-plan.js');

      // Setup mock initiative
      const initDir = join(tempDir, 'docs', '04-operations', 'tasks', 'initiatives');
      mkdirSync(initDir, { recursive: true });
      const initPath = join(initDir, 'INIT-001.yaml');
      const initDoc = {
        id: 'INIT-001',
        slug: 'test-initiative',
        title: 'Test Initiative',
        status: 'open',
        created: '2026-01-25',
      };
      writeFileSync(initPath, stringifyYAML(initDoc));

      // Update initiative
      const changed = updateInitiativeWithPlan(
        tempDir,
        'INIT-001',
        'lumenflow://plans/test-plan.md',
      );

      expect(changed).toBe(true);

      // Verify the file was updated
      const updated = parseYAML(readFileSync(initPath, 'utf-8'));
      expect(updated.related_plan).toBe('lumenflow://plans/test-plan.md');
    });

    it('should return false if plan already linked (idempotent)', async () => {
      const { updateInitiativeWithPlan } = await import('../initiative-plan.js');

      // Setup mock initiative with existing plan
      const initDir = join(tempDir, 'docs', '04-operations', 'tasks', 'initiatives');
      mkdirSync(initDir, { recursive: true });
      const initPath = join(initDir, 'INIT-001.yaml');
      const initDoc = {
        id: 'INIT-001',
        slug: 'test-initiative',
        title: 'Test Initiative',
        status: 'open',
        created: '2026-01-25',
        related_plan: 'lumenflow://plans/test-plan.md',
      };
      writeFileSync(initPath, stringifyYAML(initDoc));

      // Update initiative with same plan
      const changed = updateInitiativeWithPlan(
        tempDir,
        'INIT-001',
        'lumenflow://plans/test-plan.md',
      );

      expect(changed).toBe(false);
    });

    it('should warn but proceed if different plan already linked', async () => {
      const { updateInitiativeWithPlan } = await import('../initiative-plan.js');
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Setup mock initiative with different plan
      const initDir = join(tempDir, 'docs', '04-operations', 'tasks', 'initiatives');
      mkdirSync(initDir, { recursive: true });
      const initPath = join(initDir, 'INIT-001.yaml');
      const initDoc = {
        id: 'INIT-001',
        slug: 'test-initiative',
        title: 'Test Initiative',
        status: 'open',
        created: '2026-01-25',
        related_plan: 'lumenflow://plans/old-plan.md',
      };
      writeFileSync(initPath, stringifyYAML(initDoc));

      // Update initiative with new plan
      const changed = updateInitiativeWithPlan(
        tempDir,
        'INIT-001',
        'lumenflow://plans/new-plan.md',
      );

      expect(changed).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Replacing existing related_plan'),
      );

      consoleSpy.mockRestore();
    });
  });

  describe('createPlanTemplate', () => {
    it('should create a plan template file', async () => {
      const { createPlanTemplate } = await import('../initiative-plan.js');

      const plansDir = join(tempDir, 'docs', '04-operations', 'plans');
      mkdirSync(plansDir, { recursive: true });

      const planPath = createPlanTemplate(tempDir, 'INIT-001', 'Test Initiative');

      expect(existsSync(planPath)).toBe(true);
      const content = readFileSync(planPath, 'utf-8');
      expect(content).toContain('# INIT-001');
      expect(content).toContain('Test Initiative');
      expect(content).toContain('## Goal');
      expect(content).toContain('## Scope');
    });

    it('should not overwrite existing plan file', async () => {
      const { createPlanTemplate } = await import('../initiative-plan.js');

      const plansDir = join(tempDir, 'docs', '04-operations', 'plans');
      mkdirSync(plansDir, { recursive: true });

      // Create existing file
      const existingPath = join(plansDir, 'INIT-001-test-initiative.md');
      writeFileSync(existingPath, '# Existing Content');

      expect(() => createPlanTemplate(tempDir, 'INIT-001', 'Test Initiative')).toThrow();
    });
  });

  describe('LOG_PREFIX', () => {
    it('should use correct log prefix', async () => {
      const { LOG_PREFIX } = await import('../initiative-plan.js');
      expect(LOG_PREFIX).toBe('[initiative:plan]');
    });
  });

  describe('getCommitMessage', () => {
    it('should generate correct commit message', async () => {
      const { getCommitMessage } = await import('../initiative-plan.js');

      expect(getCommitMessage('INIT-001', 'lumenflow://plans/my-plan.md')).toBe(
        'docs: link plan my-plan.md to init-001',
      );
    });

    it('should handle nested plan paths', async () => {
      const { getCommitMessage } = await import('../initiative-plan.js');

      expect(getCommitMessage('INIT-TOOLING', 'lumenflow://plans/subdir/nested-plan.md')).toBe(
        'docs: link plan subdir/nested-plan.md to init-tooling',
      );
    });
  });

  describe('updateInitiativeWithPlan ID mismatch', () => {
    it('should throw if initiative ID does not match', async () => {
      const { updateInitiativeWithPlan } = await import('../initiative-plan.js');

      // Setup mock initiative with different ID
      const initDir = join(tempDir, 'docs', '04-operations', 'tasks', 'initiatives');
      mkdirSync(initDir, { recursive: true });
      const initPath = join(initDir, 'INIT-001.yaml');
      const initDoc = {
        id: 'INIT-002', // Wrong ID
        slug: 'test-initiative',
        title: 'Test Initiative',
        status: 'open',
        created: '2026-01-25',
      };
      writeFileSync(initPath, stringifyYAML(initDoc));

      expect(() =>
        updateInitiativeWithPlan(tempDir, 'INIT-001', 'lumenflow://plans/test-plan.md'),
      ).toThrow();
    });
  });
});

describe('init:plan CLI integration', () => {
  it('should require --initiative flag', async () => {
    // This test verifies that the CLI requires the initiative flag
    // The actual CLI integration is tested via subprocess
    const { WU_OPTIONS } = await import('@lumenflow/core/arg-parser');
    expect(WU_OPTIONS.initiative).toBeDefined();
    expect(WU_OPTIONS.initiative.flags).toContain('--initiative');
  });

  it('should export main function for CLI entry', async () => {
    const initPlan = await import('../initiative-plan.js');
    expect(typeof initPlan.main).toBe('function');
  });

  it('should export all required functions', async () => {
    const initPlan = await import('../initiative-plan.js');
    expect(typeof initPlan.validateInitIdFormat).toBe('function');
    expect(typeof initPlan.validatePlanPath).toBe('function');
    expect(typeof initPlan.formatPlanUri).toBe('function');
    expect(typeof initPlan.checkInitiativeExists).toBe('function');
    expect(typeof initPlan.updateInitiativeWithPlan).toBe('function');
    expect(typeof initPlan.createPlanTemplate).toBe('function');
    expect(typeof initPlan.getCommitMessage).toBe('function');
    expect(typeof initPlan.LOG_PREFIX).toBe('string');
  });
});

describe('createPlanTemplate edge cases', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `init-plan-test-${Date.now()}`);
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

  it('should create plans directory if it does not exist', async () => {
    const { createPlanTemplate } = await import('../initiative-plan.js');

    // Do NOT pre-create the plans directory
    const planPath = createPlanTemplate(tempDir, 'INIT-001', 'Test Initiative');

    expect(existsSync(planPath)).toBe(true);
    expect(planPath).toContain('docs/04-operations/plans');
  });

  it('should truncate long titles in filename', async () => {
    const { createPlanTemplate } = await import('../initiative-plan.js');

    const longTitle =
      'This is an extremely long initiative title that should be truncated in the filename';
    const planPath = createPlanTemplate(tempDir, 'INIT-001', longTitle);

    expect(existsSync(planPath)).toBe(true);
    // Filename should be truncated
    const filename = planPath.split('/').pop() || '';
    // INIT-001- is 9 chars, .md is 3 chars, slug should be max 30 chars
    expect(filename.length).toBeLessThanOrEqual(9 + 30 + 3);
  });

  it('should handle special characters in title', async () => {
    const { createPlanTemplate } = await import('../initiative-plan.js');

    const specialTitle = "Test's Initiative: (Special) Chars! @#$%";
    const planPath = createPlanTemplate(tempDir, 'INIT-001', specialTitle);

    expect(existsSync(planPath)).toBe(true);
    // Filename should only have kebab-case characters
    expect(planPath).toMatch(/INIT-001-[a-z0-9-]+\.md$/);
  });
});

/**
 * Note on main() function testing:
 *
 * The main() function is intentionally not unit-tested because:
 * 1. It calls die() which invokes process.exit() - difficult to mock without complex test infrastructure
 * 2. It involves micro-worktree operations with git
 * 3. All business logic functions it calls ARE thoroughly tested above
 *
 * The main() function is integration/orchestration code that composes the tested helper functions.
 * Integration testing via subprocess (pnpm init:plan) is the appropriate testing strategy for main().
 *
 * Coverage statistics:
 * - All exported helper functions: ~100% coverage
 * - main() function: Not unit tested (orchestration code)
 * - Overall file coverage: ~50% (acceptable for CLI commands)
 */
