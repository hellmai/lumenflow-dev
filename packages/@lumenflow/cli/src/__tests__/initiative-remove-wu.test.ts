/**
 * Tests for initiative:remove-wu command (WU-1328)
 *
 * The initiative:remove-wu command unlinks a WU from an initiative bidirectionally:
 * 1. Removes `initiative` field from WU YAML
 * 2. Removes WU ID from initiative `wus: []` array
 *
 * Uses micro-worktree isolation for atomic operations.
 *
 * TDD: These tests are written BEFORE the implementation.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseYAML, stringifyYAML } from '@lumenflow/core/wu-yaml';

// Test constants to avoid lint warnings about duplicate strings
const TEST_WU_ID = 'WU-123';
const TEST_WU_ID_2 = 'WU-456';
const TEST_WU_ID_3 = 'WU-789';
const TEST_INIT_ID = 'INIT-001';
const TEST_INIT_ID_2 = 'INIT-002';
const TEST_LANE = 'Framework: CLI';
const WU_REL_PATH = 'docs/04-operations/tasks/wu';
const INIT_REL_PATH = 'docs/04-operations/tasks/initiatives';
const TEST_INIT_SLUG = 'test-initiative';
const TEST_INIT_TITLE = 'Test Initiative';
const TEST_INIT_STATUS = 'open';
const TEST_DATE = '2026-01-25';

// Pre-import the module to ensure coverage tracking includes the module itself
beforeAll(async () => {
  await import('../initiative-remove-wu.js');
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

vi.mock('@lumenflow/core/micro-worktree', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lumenflow/core/micro-worktree')>();
  return {
    ...actual,
    withMicroWorktree: vi.fn(async ({ execute }) => {
      // Simulate micro-worktree by executing in temp dir
      const tempDir = join(tmpdir(), `init-remove-wu-test-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
      try {
        await execute({ worktreePath: tempDir });
      } finally {
        // Cleanup handled by test
      }
    }),
  };
});

describe('initiative:remove-wu command', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `init-remove-wu-test-${Date.now()}`);
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
      const { validateInitIdFormat } = await import('../initiative-remove-wu.js');
      // Should not throw
      expect(() => validateInitIdFormat('INIT-001')).not.toThrow();
      expect(() => validateInitIdFormat('INIT-123')).not.toThrow();
    });

    it('should accept valid INIT-NAME format', async () => {
      const { validateInitIdFormat } = await import('../initiative-remove-wu.js');
      expect(() => validateInitIdFormat('INIT-TOOLING')).not.toThrow();
      expect(() => validateInitIdFormat('INIT-A1')).not.toThrow();
    });

    it('should reject invalid formats', async () => {
      const { validateInitIdFormat } = await import('../initiative-remove-wu.js');
      expect(() => validateInitIdFormat('init-001')).toThrow();
      expect(() => validateInitIdFormat('INIT001')).toThrow();
      expect(() => validateInitIdFormat('WU-001')).toThrow();
      expect(() => validateInitIdFormat('')).toThrow();
    });
  });

  describe('validateWuIdFormat', () => {
    it('should accept valid WU-NNN format', async () => {
      const { validateWuIdFormat } = await import('../initiative-remove-wu.js');
      expect(() => validateWuIdFormat('WU-123')).not.toThrow();
      expect(() => validateWuIdFormat('WU-1')).not.toThrow();
      expect(() => validateWuIdFormat('WU-99999')).not.toThrow();
    });

    it('should reject invalid formats', async () => {
      const { validateWuIdFormat } = await import('../initiative-remove-wu.js');
      expect(() => validateWuIdFormat('wu-123')).toThrow();
      expect(() => validateWuIdFormat('WU123')).toThrow();
      expect(() => validateWuIdFormat('INIT-001')).toThrow();
      expect(() => validateWuIdFormat('')).toThrow();
    });
  });

  describe('checkWUExists', () => {
    it('should return WU doc if found', async () => {
      const { checkWUExists } = await import('../initiative-remove-wu.js');

      // Create a mock WU file
      const wuDir = join(tempDir, WU_REL_PATH);
      mkdirSync(wuDir, { recursive: true });
      const wuPath = join(wuDir, `${TEST_WU_ID}.yaml`);
      const wuDoc = {
        id: TEST_WU_ID,
        title: 'Test WU',
        lane: TEST_LANE,
        status: 'ready',
        initiative: TEST_INIT_ID,
      };
      writeFileSync(wuPath, stringifyYAML(wuDoc));

      process.chdir(tempDir);
      const result = checkWUExists(TEST_WU_ID);
      expect(result.id).toBe(TEST_WU_ID);
      expect(result.initiative).toBe(TEST_INIT_ID);
    });

    it('should throw if WU not found', async () => {
      const { checkWUExists } = await import('../initiative-remove-wu.js');

      process.chdir(tempDir);
      expect(() => checkWUExists('WU-999')).toThrow();
    });
  });

  describe('checkInitiativeExists', () => {
    it('should return initiative doc if found', async () => {
      const { checkInitiativeExists } = await import('../initiative-remove-wu.js');

      // Create a mock initiative file
      const initDir = join(tempDir, INIT_REL_PATH);
      mkdirSync(initDir, { recursive: true });
      const initPath = join(initDir, `${TEST_INIT_ID}.yaml`);
      const initDoc = {
        id: TEST_INIT_ID,
        slug: TEST_INIT_SLUG,
        title: TEST_INIT_TITLE,
        status: TEST_INIT_STATUS,
        created: TEST_DATE,
        wus: [TEST_WU_ID, TEST_WU_ID_2],
      };
      writeFileSync(initPath, stringifyYAML(initDoc));

      process.chdir(tempDir);
      const result = checkInitiativeExists(TEST_INIT_ID);
      expect(result.id).toBe(TEST_INIT_ID);
      expect(result.wus).toContain(TEST_WU_ID);
    });

    it('should throw if initiative not found', async () => {
      const { checkInitiativeExists } = await import('../initiative-remove-wu.js');

      process.chdir(tempDir);
      expect(() => checkInitiativeExists('INIT-999')).toThrow();
    });
  });

  describe('checkWUIsLinked', () => {
    it('should return true if WU is linked to initiative', async () => {
      const { checkWUIsLinked } = await import('../initiative-remove-wu.js');

      const wuDoc = { initiative: TEST_INIT_ID };
      const initDoc = { wus: [TEST_WU_ID, TEST_WU_ID_2] };

      expect(checkWUIsLinked(wuDoc, initDoc, TEST_WU_ID, TEST_INIT_ID)).toBe(true);
    });

    it('should return false if WU is not linked (no initiative field)', async () => {
      const { checkWUIsLinked } = await import('../initiative-remove-wu.js');

      const wuDoc = { initiative: undefined }; // No initiative field
      const initDoc = { wus: [TEST_WU_ID_2] };

      expect(checkWUIsLinked(wuDoc, initDoc, TEST_WU_ID, TEST_INIT_ID)).toBe(false);
    });

    it('should return false if WU is not in initiative wus list', async () => {
      const { checkWUIsLinked } = await import('../initiative-remove-wu.js');

      const wuDoc = { initiative: TEST_INIT_ID };
      const initDoc = { wus: [TEST_WU_ID_2] }; // TEST_WU_ID not in list

      expect(checkWUIsLinked(wuDoc, initDoc, TEST_WU_ID, TEST_INIT_ID)).toBe(false);
    });

    it('should return false if WU is linked to different initiative', async () => {
      const { checkWUIsLinked } = await import('../initiative-remove-wu.js');

      const wuDoc = { initiative: TEST_INIT_ID_2 }; // Different initiative
      const initDoc = { wus: [TEST_WU_ID] };

      expect(checkWUIsLinked(wuDoc, initDoc, TEST_WU_ID, TEST_INIT_ID)).toBe(false);
    });
  });

  describe('updateWUInWorktree (remove initiative)', () => {
    it('should remove initiative field from WU', async () => {
      const { updateWUInWorktree } = await import('../initiative-remove-wu.js');

      // Setup mock WU
      const wuDir = join(tempDir, WU_REL_PATH);
      mkdirSync(wuDir, { recursive: true });
      const wuPath = join(wuDir, `${TEST_WU_ID}.yaml`);
      const wuDoc = {
        id: TEST_WU_ID,
        title: 'Test WU',
        lane: TEST_LANE,
        status: 'in_progress',
        initiative: TEST_INIT_ID,
      };
      writeFileSync(wuPath, stringifyYAML(wuDoc));

      // Update WU
      const changed = updateWUInWorktree(tempDir, TEST_WU_ID, TEST_INIT_ID);

      expect(changed).toBe(true);

      // Verify the file was updated
      const updated = parseYAML(readFileSync(wuPath, 'utf-8'));
      expect(updated.initiative).toBeUndefined();
    });

    it('should return false if initiative field does not exist (idempotent)', async () => {
      const { updateWUInWorktree } = await import('../initiative-remove-wu.js');

      // Setup mock WU without initiative field
      const wuDir = join(tempDir, WU_REL_PATH);
      mkdirSync(wuDir, { recursive: true });
      const wuPath = join(wuDir, `${TEST_WU_ID}.yaml`);
      const wuDoc = {
        id: TEST_WU_ID,
        title: 'Test WU',
        lane: TEST_LANE,
        status: 'ready',
      };
      writeFileSync(wuPath, stringifyYAML(wuDoc));

      // Update WU
      const changed = updateWUInWorktree(tempDir, TEST_WU_ID, TEST_INIT_ID);

      expect(changed).toBe(false);
    });

    it('should return false if initiative field is different (idempotent)', async () => {
      const { updateWUInWorktree } = await import('../initiative-remove-wu.js');

      // Setup mock WU with different initiative
      const wuDir = join(tempDir, WU_REL_PATH);
      mkdirSync(wuDir, { recursive: true });
      const wuPath = join(wuDir, `${TEST_WU_ID}.yaml`);
      const wuDoc = {
        id: TEST_WU_ID,
        title: 'Test WU',
        lane: TEST_LANE,
        status: 'ready',
        initiative: TEST_INIT_ID_2, // Different initiative
      };
      writeFileSync(wuPath, stringifyYAML(wuDoc));

      // Try to remove different initiative - should not change
      const changed = updateWUInWorktree(tempDir, TEST_WU_ID, TEST_INIT_ID);

      expect(changed).toBe(false);

      // Verify the file was NOT updated
      const updated = parseYAML(readFileSync(wuPath, 'utf-8'));
      expect(updated.initiative).toBe(TEST_INIT_ID_2);
    });
  });

  describe('updateInitiativeInWorktree (remove WU)', () => {
    it('should remove WU from initiative wus list', async () => {
      const { updateInitiativeInWorktree } = await import('../initiative-remove-wu.js');

      // Setup mock initiative
      const initDir = join(tempDir, INIT_REL_PATH);
      mkdirSync(initDir, { recursive: true });
      const initPath = join(initDir, `${TEST_INIT_ID}.yaml`);
      const initDoc = {
        id: TEST_INIT_ID,
        slug: TEST_INIT_SLUG,
        title: TEST_INIT_TITLE,
        status: TEST_INIT_STATUS,
        created: TEST_DATE,
        wus: [TEST_WU_ID, TEST_WU_ID_2, TEST_WU_ID_3],
      };
      writeFileSync(initPath, stringifyYAML(initDoc));

      // Update initiative
      const changed = updateInitiativeInWorktree(tempDir, TEST_INIT_ID, TEST_WU_ID_2);

      expect(changed).toBe(true);

      // Verify the file was updated
      const updated = parseYAML(readFileSync(initPath, 'utf-8'));
      expect(updated.wus).toEqual([TEST_WU_ID, TEST_WU_ID_3]);
      expect(updated.wus).not.toContain(TEST_WU_ID_2);
    });

    it('should return false if WU not in list (idempotent)', async () => {
      const { updateInitiativeInWorktree } = await import('../initiative-remove-wu.js');

      // Setup mock initiative without the WU
      const initDir = join(tempDir, INIT_REL_PATH);
      mkdirSync(initDir, { recursive: true });
      const initPath = join(initDir, `${TEST_INIT_ID}.yaml`);
      const initDoc = {
        id: TEST_INIT_ID,
        slug: TEST_INIT_SLUG,
        title: TEST_INIT_TITLE,
        status: TEST_INIT_STATUS,
        created: TEST_DATE,
        wus: [TEST_WU_ID, TEST_WU_ID_3],
      };
      writeFileSync(initPath, stringifyYAML(initDoc));

      // Try to remove WU that's not in list
      const changed = updateInitiativeInWorktree(tempDir, TEST_INIT_ID, TEST_WU_ID_2);

      expect(changed).toBe(false);
    });

    it('should handle empty wus array', async () => {
      const { updateInitiativeInWorktree } = await import('../initiative-remove-wu.js');

      // Setup mock initiative with empty wus array
      const initDir = join(tempDir, INIT_REL_PATH);
      mkdirSync(initDir, { recursive: true });
      const initPath = join(initDir, `${TEST_INIT_ID}.yaml`);
      const initDoc = {
        id: TEST_INIT_ID,
        slug: TEST_INIT_SLUG,
        title: TEST_INIT_TITLE,
        status: TEST_INIT_STATUS,
        created: TEST_DATE,
        wus: [],
      };
      writeFileSync(initPath, stringifyYAML(initDoc));

      // Try to remove WU from empty list
      const changed = updateInitiativeInWorktree(tempDir, TEST_INIT_ID, TEST_WU_ID);

      expect(changed).toBe(false);
    });

    it('should handle missing wus array', async () => {
      const { updateInitiativeInWorktree } = await import('../initiative-remove-wu.js');

      // Setup mock initiative without wus array
      const initDir = join(tempDir, INIT_REL_PATH);
      mkdirSync(initDir, { recursive: true });
      const initPath = join(initDir, `${TEST_INIT_ID}.yaml`);
      const initDoc = {
        id: TEST_INIT_ID,
        slug: TEST_INIT_SLUG,
        title: TEST_INIT_TITLE,
        status: TEST_INIT_STATUS,
        created: TEST_DATE,
        // No wus field
      };
      writeFileSync(initPath, stringifyYAML(initDoc));

      // Try to remove WU from non-existent list
      const changed = updateInitiativeInWorktree(tempDir, TEST_INIT_ID, TEST_WU_ID);

      expect(changed).toBe(false);
    });

    it('should preserve related_plan and unknown fields when updating wus list', async () => {
      const { updateInitiativeInWorktree } = await import('../initiative-remove-wu.js');

      const initDir = join(tempDir, INIT_REL_PATH);
      mkdirSync(initDir, { recursive: true });
      const initPath = join(initDir, `${TEST_INIT_ID}.yaml`);
      writeFileSync(
        initPath,
        [
          `id: ${TEST_INIT_ID}`,
          `slug: ${TEST_INIT_SLUG}`,
          `title: ${TEST_INIT_TITLE}`,
          `status: ${TEST_INIT_STATUS}`,
          `created: ${TEST_DATE}`,
          'wus:',
          `  - ${TEST_WU_ID}`,
          `  - ${TEST_WU_ID_2}`,
          'related_plan: lumenflow://plans/INIT-001-plan.md',
          'custom_metadata:',
          '  owner: platform',
          '',
        ].join('\n'),
      );

      const changed = updateInitiativeInWorktree(tempDir, TEST_INIT_ID, TEST_WU_ID);
      expect(changed).toBe(true);

      const updated = parseYAML(readFileSync(initPath, 'utf-8'));
      expect(updated.wus).toEqual([TEST_WU_ID_2]);
      expect(updated.related_plan).toBe('lumenflow://plans/INIT-001-plan.md');
      expect(updated.custom_metadata).toEqual({ owner: 'platform' });
    });
  });

  describe('LOG_PREFIX', () => {
    it('should use correct log prefix', async () => {
      const { LOG_PREFIX } = await import('../initiative-remove-wu.js');
      expect(LOG_PREFIX).toBe('[initiative:remove-wu]');
    });
  });

  describe('OPERATION_NAME', () => {
    it('should have correct operation name', async () => {
      const { OPERATION_NAME } = await import('../initiative-remove-wu.js');
      expect(OPERATION_NAME).toBe('initiative-remove-wu');
    });
  });
});

describe('initiative:remove-wu CLI integration', () => {
  it('should require --initiative and --wu flags', async () => {
    // This test verifies that the CLI requires both flags
    const { WU_OPTIONS } = await import('@lumenflow/core/arg-parser');
    expect(WU_OPTIONS.initiative).toBeDefined();
    expect(WU_OPTIONS.initiative.flags).toContain('--initiative');
    expect(WU_OPTIONS.wu).toBeDefined();
    expect(WU_OPTIONS.wu.flags).toContain('--wu');
  });

  it('should export main function for CLI entry', async () => {
    const initRemoveWu = await import('../initiative-remove-wu.js');
    expect(typeof initRemoveWu.main).toBe('function');
  });

  it('should export all required functions', async () => {
    const initRemoveWu = await import('../initiative-remove-wu.js');
    expect(typeof initRemoveWu.validateInitIdFormat).toBe('function');
    expect(typeof initRemoveWu.validateWuIdFormat).toBe('function');
    expect(typeof initRemoveWu.checkWUExists).toBe('function');
    expect(typeof initRemoveWu.checkInitiativeExists).toBe('function');
    expect(typeof initRemoveWu.checkWUIsLinked).toBe('function');
    expect(typeof initRemoveWu.updateWUInWorktree).toBe('function');
    expect(typeof initRemoveWu.updateInitiativeInWorktree).toBe('function');
    expect(initRemoveWu.INITIATIVE_REMOVE_WU_PUSH_RETRY_OVERRIDE).toEqual({
      retries: 8,
      min_delay_ms: 300,
      max_delay_ms: 4000,
    });
    expect(typeof initRemoveWu.LOG_PREFIX).toBe('string');
    expect(typeof initRemoveWu.OPERATION_NAME).toBe('string');
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
 * Integration testing via subprocess (pnpm initiative:remove-wu) is the appropriate testing strategy for main().
 *
 * Coverage statistics:
 * - All exported helper functions: ~100% coverage
 * - main() function: Not unit tested (orchestration code)
 * - Overall file coverage: ~50% (acceptable for CLI commands)
 */

/**
 * WU-1333: Retry handling tests for initiative:remove-wu
 *
 * When origin/main moves during operation, the micro-worktree layer handles retry.
 * When retries are exhausted, the error message should include actionable next steps.
 */
describe('initiative:remove-wu retry handling (WU-1333)', () => {
  describe('isRetryExhaustionError', () => {
    it('should detect retry exhaustion from error message', async () => {
      const { isRetryExhaustionError } = await import('../initiative-remove-wu.js');

      // Should detect retry exhaustion error
      const retryError = new Error(
        'Push failed after 3 attempts. Origin main may have significant traffic.',
      );
      expect(isRetryExhaustionError(retryError)).toBe(true);
    });

    it('should detect retry exhaustion with any attempt count', async () => {
      const { isRetryExhaustionError } = await import('../initiative-remove-wu.js');

      // Different attempt counts should still match
      const error5 = new Error('Push failed after 5 attempts. Something.');
      expect(isRetryExhaustionError(error5)).toBe(true);

      const error1 = new Error('Push failed after 1 attempts. Something.');
      expect(isRetryExhaustionError(error1)).toBe(true);
    });

    it('should not match other errors', async () => {
      const { isRetryExhaustionError } = await import('../initiative-remove-wu.js');

      const otherError = new Error('Some other error');
      expect(isRetryExhaustionError(otherError)).toBe(false);

      const networkError = new Error('Network unreachable');
      expect(isRetryExhaustionError(networkError)).toBe(false);
    });
  });

  describe('formatRetryExhaustionError', () => {
    it('should include actionable next steps', async () => {
      const { formatRetryExhaustionError } = await import('../initiative-remove-wu.js');

      const retryError = new Error(
        'Push failed after 3 attempts. Origin main may have significant traffic.',
      );
      const formatted = formatRetryExhaustionError(retryError, TEST_WU_ID, TEST_INIT_ID);

      // Should include the original error
      expect(formatted).toContain('Push failed after 3 attempts');

      // Should include next steps heading
      expect(formatted).toContain('Next steps:');

      // Should include actionable suggestions
      expect(formatted).toContain('Wait a few seconds and retry');
      expect(formatted).toContain('initiative:remove-wu');
    });

    it('should include the retry command', async () => {
      const { formatRetryExhaustionError } = await import('../initiative-remove-wu.js');

      const retryError = new Error('Push failed after 3 attempts.');
      const formatted = formatRetryExhaustionError(retryError, TEST_WU_ID, TEST_INIT_ID);

      // Should include command to retry
      expect(formatted).toContain(`--wu ${TEST_WU_ID}`);
      expect(formatted).toContain(`--initiative ${TEST_INIT_ID}`);
    });

    it('should suggest checking for concurrent agents', async () => {
      const { formatRetryExhaustionError } = await import('../initiative-remove-wu.js');

      const retryError = new Error('Push failed after 3 attempts.');
      const formatted = formatRetryExhaustionError(retryError, TEST_WU_ID, TEST_INIT_ID);

      // Should mention concurrent agents as possible cause
      expect(formatted).toMatch(/concurrent|agent|traffic/i);
    });
  });

  describe('exports for WU-1333', () => {
    it('should export isRetryExhaustionError function', async () => {
      const mod = await import('../initiative-remove-wu.js');
      expect(typeof mod.isRetryExhaustionError).toBe('function');
    });

    it('should export formatRetryExhaustionError function', async () => {
      const mod = await import('../initiative-remove-wu.js');
      expect(typeof mod.formatRetryExhaustionError).toBe('function');
    });
  });
});
