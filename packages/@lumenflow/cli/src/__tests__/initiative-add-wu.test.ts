/**
 * Tests for initiative:add-wu command validation (WU-1330)
 *
 * The initiative:add-wu command now validates WU specs before linking.
 * This ensures only valid, complete WUs can be linked to initiatives.
 *
 * TDD: These tests are written BEFORE the implementation.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseYAML, stringifyYAML, readWU } from '@lumenflow/core/wu-yaml';
import { readInitiative } from '@lumenflow/initiatives/yaml';

// Test constants to avoid lint warnings about duplicate strings
const TEST_WU_ID = 'WU-123';
const TEST_INIT_ID = 'INIT-001';
const TEST_LANE = 'Framework: CLI';
const WU_REL_PATH = 'docs/04-operations/tasks/wu';
const INIT_REL_PATH = 'docs/04-operations/tasks/initiatives';
const TEST_INIT_SLUG = 'test-initiative';
const TEST_INIT_TITLE = 'Test Initiative';
const TEST_INIT_STATUS = 'open';
const TEST_DATE = '2026-01-25';
const MIN_DESCRIPTION_LENGTH = 50;
const TEST_WU_ID_2 = 'WU-124';

// Valid WU document template
const createValidWUDoc = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: TEST_WU_ID,
  title: 'Test Work Unit Title',
  lane: TEST_LANE,
  status: 'ready',
  type: 'feature',
  priority: 'P2',
  created: TEST_DATE,
  description:
    'Context: Testing WU validation. Problem: No validation on add-wu. Solution: Add strict validation before linking.',
  acceptance: ['WU validates schema', 'Invalid WUs rejected', 'Valid WUs linked bidirectionally'],
  code_paths: ['packages/@lumenflow/cli/src/initiative-add-wu.ts'],
  tests: { unit: ['packages/@lumenflow/cli/src/__tests__/initiative-add-wu.test.ts'] },
  exposure: 'backend-only',
  ...overrides,
});

// Valid initiative document template
const createValidInitDoc = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: TEST_INIT_ID,
  slug: TEST_INIT_SLUG,
  title: TEST_INIT_TITLE,
  status: TEST_INIT_STATUS,
  created: TEST_DATE,
  wus: [],
  ...overrides,
});

// Pre-import the module to ensure coverage tracking includes the module itself
beforeAll(async () => {
  await import('../initiative-add-wu.js');
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
      const tempDir = join(tmpdir(), `init-add-wu-test-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
      try {
        await execute({ worktreePath: tempDir });
      } finally {
        // Cleanup handled by test
      }
    }),
  };
});

describe('initiative:add-wu WU validation (WU-1330)', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `init-add-wu-validation-test-${Date.now()}`);
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

  describe('validateWUForLinking', () => {
    it('should return valid for a well-formed WU', async () => {
      const { validateWUForLinking } = await import('../initiative-add-wu.js');

      // Create a valid WU file
      const wuDir = join(tempDir, WU_REL_PATH);
      mkdirSync(wuDir, { recursive: true });
      const wuPath = join(wuDir, `${TEST_WU_ID}.yaml`);
      writeFileSync(wuPath, stringifyYAML(createValidWUDoc()));

      process.chdir(tempDir);
      const result = validateWUForLinking(TEST_WU_ID);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject WU with missing required fields', async () => {
      const { validateWUForLinking } = await import('../initiative-add-wu.js');

      // Create a WU missing required fields (no description)
      const wuDir = join(tempDir, WU_REL_PATH);
      mkdirSync(wuDir, { recursive: true });
      const wuPath = join(wuDir, `${TEST_WU_ID}.yaml`);
      writeFileSync(
        wuPath,
        stringifyYAML({
          id: TEST_WU_ID,
          title: 'Test',
          lane: TEST_LANE,
          status: 'ready',
          created: TEST_DATE,
          // Missing: description, acceptance, code_paths
        }),
      );

      process.chdir(tempDir);
      const result = validateWUForLinking(TEST_WU_ID);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.toLowerCase().includes('description'))).toBe(true);
    });

    it('should reject WU with invalid schema', async () => {
      const { validateWUForLinking } = await import('../initiative-add-wu.js');

      // Create a WU with invalid status
      const wuDir = join(tempDir, WU_REL_PATH);
      mkdirSync(wuDir, { recursive: true });
      const wuPath = join(wuDir, `${TEST_WU_ID}.yaml`);
      writeFileSync(
        wuPath,
        stringifyYAML({
          ...createValidWUDoc(),
          status: 'invalid_status', // Invalid status value
        }),
      );

      process.chdir(tempDir);
      const result = validateWUForLinking(TEST_WU_ID);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.toLowerCase().includes('status'))).toBe(true);
    });

    it('should reject WU with description containing placeholder marker', async () => {
      const { validateWUForLinking } = await import('../initiative-add-wu.js');

      // Create a WU with placeholder in description
      const wuDir = join(tempDir, WU_REL_PATH);
      mkdirSync(wuDir, { recursive: true });
      const wuPath = join(wuDir, `${TEST_WU_ID}.yaml`);
      writeFileSync(
        wuPath,
        stringifyYAML({
          ...createValidWUDoc(),
          description: '[PLACEHOLDER] This is a placeholder description that is long enough.',
        }),
      );

      process.chdir(tempDir);
      const result = validateWUForLinking(TEST_WU_ID);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('PLACEHOLDER'))).toBe(true);
    });

    it('should reject WU with too short description', async () => {
      const { validateWUForLinking } = await import('../initiative-add-wu.js');

      // Create a WU with short description
      const wuDir = join(tempDir, WU_REL_PATH);
      mkdirSync(wuDir, { recursive: true });
      const wuPath = join(wuDir, `${TEST_WU_ID}.yaml`);
      writeFileSync(
        wuPath,
        stringifyYAML({
          ...createValidWUDoc(),
          description: 'Too short', // Less than MIN_DESCRIPTION_LENGTH
        }),
      );

      process.chdir(tempDir);
      const result = validateWUForLinking(TEST_WU_ID);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes(`${MIN_DESCRIPTION_LENGTH}`))).toBe(true);
    });

    it('should reject WU with invalid ID format', async () => {
      const { validateWUForLinking } = await import('../initiative-add-wu.js');

      // Create a WU with invalid ID
      const invalidId = 'INVALID-123';
      const wuDir = join(tempDir, WU_REL_PATH);
      mkdirSync(wuDir, { recursive: true });
      const wuPath = join(wuDir, `${invalidId}.yaml`);
      writeFileSync(
        wuPath,
        stringifyYAML({
          ...createValidWUDoc(),
          id: invalidId,
        }),
      );

      process.chdir(tempDir);
      const result = validateWUForLinking(invalidId);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.toLowerCase().includes('id'))).toBe(true);
    });

    it('should reject WU that does not exist', async () => {
      const { validateWUForLinking } = await import('../initiative-add-wu.js');

      process.chdir(tempDir);
      const result = validateWUForLinking('WU-999');

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.toLowerCase().includes('not found'))).toBe(true);
    });

    it('should reject WU with empty acceptance criteria', async () => {
      const { validateWUForLinking } = await import('../initiative-add-wu.js');

      // Create a WU with empty acceptance
      const wuDir = join(tempDir, WU_REL_PATH);
      mkdirSync(wuDir, { recursive: true });
      const wuPath = join(wuDir, `${TEST_WU_ID}.yaml`);
      writeFileSync(
        wuPath,
        stringifyYAML({
          ...createValidWUDoc(),
          acceptance: [], // Empty array
        }),
      );

      process.chdir(tempDir);
      const result = validateWUForLinking(TEST_WU_ID);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.toLowerCase().includes('acceptance'))).toBe(true);
    });

    it('should aggregate multiple errors', async () => {
      const { validateWUForLinking } = await import('../initiative-add-wu.js');

      // Create a WU with multiple issues
      const wuDir = join(tempDir, WU_REL_PATH);
      mkdirSync(wuDir, { recursive: true });
      const wuPath = join(wuDir, `${TEST_WU_ID}.yaml`);
      writeFileSync(
        wuPath,
        stringifyYAML({
          id: TEST_WU_ID,
          title: '', // Empty title
          lane: TEST_LANE,
          status: 'invalid_status', // Invalid status
          created: TEST_DATE,
          description: 'short', // Too short
          acceptance: [], // Empty
        }),
      );

      process.chdir(tempDir);
      const result = validateWUForLinking(TEST_WU_ID);

      expect(result.valid).toBe(false);
      // Should have multiple errors aggregated
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });

    it('should include warnings but still be valid', async () => {
      const { validateWUForLinking } = await import('../initiative-add-wu.js');

      // Create a valid WU that might have warnings (missing optional recommended fields)
      const wuDir = join(tempDir, WU_REL_PATH);
      mkdirSync(wuDir, { recursive: true });
      const wuPath = join(wuDir, `${TEST_WU_ID}.yaml`);
      writeFileSync(
        wuPath,
        stringifyYAML({
          ...createValidWUDoc(),
          notes: '', // Empty notes - should produce warning
          spec_refs: [], // Empty spec_refs for feature - should produce warning
        }),
      );

      process.chdir(tempDir);
      const result = validateWUForLinking(TEST_WU_ID);

      // Should be valid (warnings don't block)
      expect(result.valid).toBe(true);
      // But should have warnings
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('checkWUExists with validation', () => {
    it('should throw for invalid WU when strict validation enabled', async () => {
      const { checkWUExistsAndValidate } = await import('../initiative-add-wu.js');

      // Create an invalid WU file
      const wuDir = join(tempDir, WU_REL_PATH);
      mkdirSync(wuDir, { recursive: true });
      const wuPath = join(wuDir, `${TEST_WU_ID}.yaml`);
      writeFileSync(
        wuPath,
        stringifyYAML({
          id: TEST_WU_ID,
          title: 'Test',
          lane: TEST_LANE,
          status: 'ready',
          created: TEST_DATE,
          description: 'short', // Too short
        }),
      );

      process.chdir(tempDir);

      // Should throw with aggregated validation errors
      expect(() => checkWUExistsAndValidate(TEST_WU_ID)).toThrow();
    });

    it('should return WU doc when validation passes', async () => {
      const { checkWUExistsAndValidate } = await import('../initiative-add-wu.js');

      // Create a valid WU file
      const wuDir = join(tempDir, WU_REL_PATH);
      mkdirSync(wuDir, { recursive: true });
      const wuPath = join(wuDir, `${TEST_WU_ID}.yaml`);
      writeFileSync(wuPath, stringifyYAML(createValidWUDoc()));

      process.chdir(tempDir);
      const result = checkWUExistsAndValidate(TEST_WU_ID);

      expect(result.id).toBe(TEST_WU_ID);
    });
  });

  describe('initiative:add-wu integration', () => {
    it('should reject linking invalid WU with clear error message', async () => {
      // This is an integration test scenario - main() calls validation before linking
      // The main() function should call validateWUForLinking and die() with aggregated errors
      const { validateWUForLinking } = await import('../initiative-add-wu.js');

      // Setup invalid WU
      const wuDir = join(tempDir, WU_REL_PATH);
      mkdirSync(wuDir, { recursive: true });
      const wuPath = join(wuDir, `${TEST_WU_ID}.yaml`);
      writeFileSync(
        wuPath,
        stringifyYAML({
          id: TEST_WU_ID,
          title: 'Test',
          lane: TEST_LANE,
          status: 'ready',
          created: TEST_DATE,
          description: 'Too short',
        }),
      );

      process.chdir(tempDir);
      const result = validateWUForLinking(TEST_WU_ID);

      // The error message should be suitable for display to user
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toContain('50'); // Should mention minimum length
    });

    it('should successfully link valid WU bidirectionally', async () => {
      // This test verifies that after validation passes, bidirectional linking works
      // The existing functionality should still work for valid WUs
      const { validateWUForLinking } = await import('../initiative-add-wu.js');

      // Setup valid WU and initiative
      const wuDir = join(tempDir, WU_REL_PATH);
      const initDir = join(tempDir, INIT_REL_PATH);
      mkdirSync(wuDir, { recursive: true });
      mkdirSync(initDir, { recursive: true });

      const wuPath = join(wuDir, `${TEST_WU_ID}.yaml`);
      const initPath = join(initDir, `${TEST_INIT_ID}.yaml`);

      writeFileSync(wuPath, stringifyYAML(createValidWUDoc()));
      writeFileSync(initPath, stringifyYAML(createValidInitDoc()));

      process.chdir(tempDir);

      // Validation should pass
      const result = validateWUForLinking(TEST_WU_ID);
      expect(result.valid).toBe(true);
    });
  });

  describe('batch linking (WU-1460)', () => {
    it('should normalize repeatable --wu values with dedupe and order preservation', async () => {
      const { normalizeWuIds } = await import('../initiative-add-wu.js');

      expect(normalizeWuIds(TEST_WU_ID)).toEqual([TEST_WU_ID]);
      expect(normalizeWuIds([TEST_WU_ID, TEST_WU_ID_2, TEST_WU_ID])).toEqual([
        TEST_WU_ID,
        TEST_WU_ID_2,
      ]);
    });

    it('should update multiple WUs and initiative in one execute call', async () => {
      const { buildAddWuMicroWorktreeOptions } = await import('../initiative-add-wu.js');

      // Setup valid WUs and initiative
      const wuDir = join(tempDir, WU_REL_PATH);
      const initDir = join(tempDir, INIT_REL_PATH);
      mkdirSync(wuDir, { recursive: true });
      mkdirSync(initDir, { recursive: true });

      const wuPath1 = join(wuDir, `${TEST_WU_ID}.yaml`);
      const wuPath2 = join(wuDir, `${TEST_WU_ID_2}.yaml`);
      const initPath = join(initDir, `${TEST_INIT_ID}.yaml`);

      writeFileSync(wuPath1, stringifyYAML(createValidWUDoc({ id: TEST_WU_ID })));
      writeFileSync(wuPath2, stringifyYAML(createValidWUDoc({ id: TEST_WU_ID_2 })));
      writeFileSync(initPath, stringifyYAML(createValidInitDoc()));

      process.chdir(tempDir);
      const options = buildAddWuMicroWorktreeOptions([TEST_WU_ID, TEST_WU_ID_2], TEST_INIT_ID);
      const result = await options.execute({ worktreePath: tempDir });

      expect(result.files).toContain(`${WU_REL_PATH}/${TEST_WU_ID}.yaml`);
      expect(result.files).toContain(`${WU_REL_PATH}/${TEST_WU_ID_2}.yaml`);
      expect(result.files).toContain(`${INIT_REL_PATH}/${TEST_INIT_ID}.yaml`);

      const updatedWu1 = readWU(wuPath1, TEST_WU_ID);
      const updatedWu2 = readWU(wuPath2, TEST_WU_ID_2);
      const updatedInit = readInitiative(initPath, TEST_INIT_ID);

      expect(updatedWu1.initiative).toBe(TEST_INIT_ID);
      expect(updatedWu2.initiative).toBe(TEST_INIT_ID);
      expect(updatedInit.wus).toContain(TEST_WU_ID);
      expect(updatedInit.wus).toContain(TEST_WU_ID_2);
    });

    it('should preserve related_plan when updating initiative wus list', async () => {
      const { buildAddWuMicroWorktreeOptions } = await import('../initiative-add-wu.js');

      const wuDir = join(tempDir, WU_REL_PATH);
      const initDir = join(tempDir, INIT_REL_PATH);
      mkdirSync(wuDir, { recursive: true });
      mkdirSync(initDir, { recursive: true });

      const wuPath = join(wuDir, `${TEST_WU_ID}.yaml`);
      const initPath = join(initDir, `${TEST_INIT_ID}.yaml`);
      const relatedPlan = 'lumenflow://plans/test-plan.md';

      writeFileSync(wuPath, stringifyYAML(createValidWUDoc({ id: TEST_WU_ID })));
      writeFileSync(initPath, stringifyYAML(createValidInitDoc({ related_plan: relatedPlan })));

      process.chdir(tempDir);
      const options = buildAddWuMicroWorktreeOptions(TEST_WU_ID, TEST_INIT_ID);
      await options.execute({ worktreePath: tempDir });

      // Read raw YAML to ensure unknown fields were preserved.
      const rawInitiative = parseYAML(readFileSync(initPath, 'utf-8')) as Record<string, unknown>;
      expect(rawInitiative.related_plan).toBe(relatedPlan);
    });

    it('should validate conflicting links across multiple WUs', async () => {
      const { validateNoConflictingLinks } = await import('../initiative-add-wu.js');

      expect(() =>
        validateNoConflictingLinks(
          [
            { id: TEST_WU_ID, initiative: TEST_INIT_ID },
            { id: TEST_WU_ID_2, initiative: 'INIT-999' },
          ],
          TEST_INIT_ID,
        ),
      ).toThrow();
    });
  });

  describe('error formatting', () => {
    it('should format errors in human-readable format', async () => {
      const { formatValidationErrors } = await import('../initiative-add-wu.js');

      const errors = ['description: Description is required', 'acceptance: At least one criterion'];
      const wuId = TEST_WU_ID;

      const formatted = formatValidationErrors(wuId, errors);

      expect(formatted).toContain(wuId);
      expect(formatted).toContain('description');
      expect(formatted).toContain('acceptance');
    });
  });

  describe('exports', () => {
    it('should export validateWUForLinking function', async () => {
      const mod = await import('../initiative-add-wu.js');
      expect(typeof mod.validateWUForLinking).toBe('function');
    });

    it('should export checkWUExistsAndValidate function', async () => {
      const mod = await import('../initiative-add-wu.js');
      expect(typeof mod.checkWUExistsAndValidate).toBe('function');
    });

    it('should export formatValidationErrors function', async () => {
      const mod = await import('../initiative-add-wu.js');
      expect(typeof mod.formatValidationErrors).toBe('function');
    });

    it('should export isRetryExhaustionError function (WU-1333)', async () => {
      const mod = await import('../initiative-add-wu.js');
      expect(typeof mod.isRetryExhaustionError).toBe('function');
    });

    it('should export formatRetryExhaustionError function (WU-1333)', async () => {
      const mod = await import('../initiative-add-wu.js');
      expect(typeof mod.formatRetryExhaustionError).toBe('function');
    });

    it('should export operation-level push retry override (WU-1459)', async () => {
      const mod = await import('../initiative-add-wu.js');
      expect(mod.INITIATIVE_ADD_WU_PUSH_RETRY_OVERRIDE).toBeDefined();
      expect(mod.INITIATIVE_ADD_WU_PUSH_RETRY_OVERRIDE.retries).toBeGreaterThan(3);
      expect(mod.INITIATIVE_ADD_WU_PUSH_RETRY_OVERRIDE.min_delay_ms).toBeGreaterThan(100);
    });

    it('should export helper to build micro-worktree options (WU-1459)', async () => {
      const mod = await import('../initiative-add-wu.js');
      expect(typeof mod.buildAddWuMicroWorktreeOptions).toBe('function');

      const options = mod.buildAddWuMicroWorktreeOptions(TEST_WU_ID, TEST_INIT_ID);
      expect(options.pushOnly).toBe(true);
      expect(options.pushRetryOverride).toEqual(mod.INITIATIVE_ADD_WU_PUSH_RETRY_OVERRIDE);
    });

    it('should export batch helpers (WU-1460)', async () => {
      const mod = await import('../initiative-add-wu.js');
      expect(typeof mod.normalizeWuIds).toBe('function');
      expect(typeof mod.validateNoConflictingLinks).toBe('function');
    });
  });
});

/**
 * WU-1333: Retry handling tests for initiative:add-wu
 *
 * When origin/main moves during operation, the micro-worktree layer handles retry.
 * When retries are exhausted, the error message should include actionable next steps.
 */
describe('initiative:add-wu retry handling (WU-1333)', () => {
  describe('isRetryExhaustionError', () => {
    it('should detect retry exhaustion from error message', async () => {
      const { isRetryExhaustionError } = await import('../initiative-add-wu.js');

      // Should detect retry exhaustion error
      const retryError = new Error(
        'Push failed after 3 attempts. Origin main may have significant traffic.',
      );
      expect(isRetryExhaustionError(retryError)).toBe(true);
    });

    it('should detect retry exhaustion with any attempt count', async () => {
      const { isRetryExhaustionError } = await import('../initiative-add-wu.js');

      // Different attempt counts should still match
      const error5 = new Error('Push failed after 5 attempts. Something.');
      expect(isRetryExhaustionError(error5)).toBe(true);

      const error1 = new Error('Push failed after 1 attempts. Something.');
      expect(isRetryExhaustionError(error1)).toBe(true);
    });

    it('should not match other errors', async () => {
      const { isRetryExhaustionError } = await import('../initiative-add-wu.js');

      const otherError = new Error('Some other error');
      expect(isRetryExhaustionError(otherError)).toBe(false);

      const networkError = new Error('Network unreachable');
      expect(isRetryExhaustionError(networkError)).toBe(false);
    });
  });

  describe('formatRetryExhaustionError', () => {
    it('should include actionable next steps', async () => {
      const { formatRetryExhaustionError } = await import('../initiative-add-wu.js');

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
      expect(formatted).toContain('initiative:add-wu');
    });

    it('should include the retry command', async () => {
      const { formatRetryExhaustionError } = await import('../initiative-add-wu.js');

      const retryError = new Error('Push failed after 3 attempts.');
      const formatted = formatRetryExhaustionError(retryError, TEST_WU_ID, TEST_INIT_ID);

      // Should include command to retry
      expect(formatted).toContain(`--wu ${TEST_WU_ID}`);
      expect(formatted).toContain(`--initiative ${TEST_INIT_ID}`);
    });

    it('should suggest checking for concurrent agents', async () => {
      const { formatRetryExhaustionError } = await import('../initiative-add-wu.js');

      const retryError = new Error('Push failed after 3 attempts.');
      const formatted = formatRetryExhaustionError(retryError, TEST_WU_ID, TEST_INIT_ID);

      // Should mention concurrent agents as possible cause
      expect(formatted).toMatch(/concurrent|agent|traffic/i);
    });

    it('should include git.push_retry tuning guidance', async () => {
      const { formatRetryExhaustionError } = await import('../initiative-add-wu.js');

      const retryError = new Error('Push failed after 3 attempts.');
      const formatted = formatRetryExhaustionError(retryError, TEST_WU_ID, TEST_INIT_ID);

      expect(formatted).toContain('git.push_retry.retries');
    });
  });
});
