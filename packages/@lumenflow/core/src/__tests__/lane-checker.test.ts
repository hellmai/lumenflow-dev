/**
 * Tests for lane-checker module - WIP justification feature
 *
 * WU-1187: Require wip_justification when WIP > 1
 *
 * Philosophy: If you need WIP > 1, you need better lanes, not higher limits.
 * This is soft enforcement: logs a warning at claim time, but doesn't block.
 *
 * @see {@link ../lane-checker.ts}
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getWipLimitForLane, checkWipJustification } from '../lane-checker.js';
import { stringifyYAML } from '../wu-yaml.js';
import { CONFIG_FILES } from '../wu-constants.js';

// Test constants to avoid magic string duplication
const TEST_LANE_FRAMEWORK_CORE = 'Framework: Core';
const TEST_LANE_FRAMEWORK_CLI = 'Framework: CLI';
const TEST_LANE_CONTENT_DOCS = 'Content: Documentation';
const TEST_LANE_OPS_INFRA = 'Operations: Infrastructure';
const TEST_LANE_FRAMEWORK = 'Framework';
const TEST_LANE_NONEXISTENT = 'Nonexistent: Lane';
const TEST_LANE_CONTENT = 'Content';

/** Test directory prefix for lane-checker tests */
const TEST_DIR_PREFIX = 'lane-checker-test-';

/** Mock config for lumenflow-config.js in WU-1308 tests */
const MOCK_GIT_CONFIG = {
  git: { mainBranch: 'main', defaultRemote: 'origin', requireRemote: true },
};

/** Error message for expected throw scenarios */
const EXPECTED_THROW_MESSAGE = 'Should have thrown an error';

describe('lane-checker WIP justification', () => {
  let testBaseDir: string;
  let configPath: string;

  beforeEach(() => {
    // Create a unique test directory for each test
    testBaseDir = join(
      tmpdir(),
      // eslint-disable-next-line sonarjs/pseudo-random -- Test isolation needs unique temp dirs
      `${TEST_DIR_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testBaseDir, { recursive: true });

    // Create docs/04-operations/tasks directory structure
    const tasksDir = join(testBaseDir, 'docs', '04-operations', 'tasks');
    mkdirSync(tasksDir, { recursive: true });
    mkdirSync(join(tasksDir, 'wu'), { recursive: true });

    configPath = join(testBaseDir, '.lumenflow.config.yaml');
  });

  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(testBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('checkWipJustification', () => {
    it('should return valid=true when wip_limit is 1 (no justification needed)', () => {
      const config = {
        lanes: {
          definitions: [{ name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 1 }],
        },
      };
      writeFileSync(configPath, stringifyYAML(config));

      const result = checkWipJustification(TEST_LANE_FRAMEWORK_CORE, { configPath });

      expect(result.valid).toBe(true);
      expect(result.warning).toBeNull();
      expect(result.requiresJustification).toBe(false);
    });

    it('should return valid=true when wip_limit > 1 and wip_justification exists', () => {
      const config = {
        lanes: {
          definitions: [
            {
              name: TEST_LANE_CONTENT_DOCS,
              wip_limit: 4,
              wip_justification: 'Docs WUs are low-conflict parallel work',
            },
          ],
        },
      };
      writeFileSync(configPath, stringifyYAML(config));

      const result = checkWipJustification(TEST_LANE_CONTENT_DOCS, { configPath });

      expect(result.valid).toBe(true);
      expect(result.warning).toBeNull();
      expect(result.justification).toBe('Docs WUs are low-conflict parallel work');
      expect(result.requiresJustification).toBe(false);
    });

    it('should return warning when wip_limit > 1 without wip_justification', () => {
      const config = {
        lanes: {
          definitions: [{ name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 2 }],
        },
      };
      writeFileSync(configPath, stringifyYAML(config));

      const result = checkWipJustification(TEST_LANE_FRAMEWORK_CORE, { configPath });

      expect(result.valid).toBe(true); // Soft enforcement - warning only
      expect(result.warning).toContain('wip_justification');
      expect(result.warning).toContain('WIP limit of 2');
      expect(result.requiresJustification).toBe(true);
    });

    it('should return warning with philosophy message about lane structure', () => {
      const config = {
        lanes: {
          definitions: [{ name: TEST_LANE_OPS_INFRA, wip_limit: 3 }],
        },
      };
      writeFileSync(configPath, stringifyYAML(config));

      const result = checkWipJustification(TEST_LANE_OPS_INFRA, { configPath });

      expect(result.warning).toContain('better lanes');
    });

    it('should return valid=true when wip_limit is undefined (defaults to 1)', () => {
      const config = {
        lanes: {
          definitions: [
            { name: TEST_LANE_FRAMEWORK_CORE }, // No wip_limit - defaults to 1
          ],
        },
      };
      writeFileSync(configPath, stringifyYAML(config));

      const result = checkWipJustification(TEST_LANE_FRAMEWORK_CORE, { configPath });

      expect(result.valid).toBe(true);
      expect(result.warning).toBeNull();
      expect(result.requiresJustification).toBe(false);
    });

    it('should work with legacy flat array config format', () => {
      const config = {
        lanes: [{ name: TEST_LANE_FRAMEWORK, wip_limit: 2 }],
      };
      writeFileSync(configPath, stringifyYAML(config));

      const result = checkWipJustification(TEST_LANE_FRAMEWORK, { configPath });

      expect(result.valid).toBe(true);
      expect(result.warning).toContain('wip_justification');
      expect(result.requiresJustification).toBe(true);
    });

    it('should work with legacy nested format (engineering/business)', () => {
      const config = {
        lanes: {
          engineering: [{ name: TEST_LANE_FRAMEWORK, wip_limit: 2 }],
          business: [{ name: TEST_LANE_CONTENT, wip_limit: 1 }],
        },
      };
      writeFileSync(configPath, stringifyYAML(config));

      const result = checkWipJustification(TEST_LANE_FRAMEWORK, { configPath });

      expect(result.valid).toBe(true);
      expect(result.warning).toContain('wip_justification');
    });

    it('should return valid=true when config file does not exist', () => {
      // configPath points to non-existent file
      const result = checkWipJustification(TEST_LANE_FRAMEWORK_CORE, {
        configPath: '/nonexistent/path.yaml',
      });

      expect(result.valid).toBe(true);
      expect(result.warning).toBeNull();
      expect(result.requiresJustification).toBe(false);
    });

    it('should return valid=true when lane not found in config (defaults to WIP=1)', () => {
      const config = {
        lanes: {
          definitions: [{ name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 1 }],
        },
      };
      writeFileSync(configPath, stringifyYAML(config));

      const result = checkWipJustification(TEST_LANE_NONEXISTENT, { configPath });

      expect(result.valid).toBe(true);
      expect(result.warning).toBeNull();
      expect(result.requiresJustification).toBe(false);
    });
  });

  describe('LaneConfigWithWip schema - wip_justification field', () => {
    it('should accept lane config with wip_justification string field', () => {
      const config = {
        lanes: {
          definitions: [
            {
              name: TEST_LANE_CONTENT_DOCS,
              wip_limit: 4,
              wip_justification: 'Documentation WUs rarely conflict',
            },
          ],
        },
      };
      writeFileSync(configPath, stringifyYAML(config));

      // If getWipLimitForLane works, the config was parsed successfully
      const wipLimit = getWipLimitForLane(TEST_LANE_CONTENT_DOCS, { configPath });
      expect(wipLimit).toBe(4);
    });

    it('should accept lane config without wip_justification (optional field)', () => {
      const config = {
        lanes: {
          definitions: [{ name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 1 }],
        },
      };
      writeFileSync(configPath, stringifyYAML(config));

      const wipLimit = getWipLimitForLane(TEST_LANE_FRAMEWORK_CORE, { configPath });
      expect(wipLimit).toBe(1);
    });
  });

  describe('backward compatibility', () => {
    it('should work with existing config without wip_justification field', () => {
      // This is the current production config structure
      const config = {
        version: '2.0',
        project: 'lumenflow',
        lanes: {
          definitions: [
            { name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 1 },
            { name: TEST_LANE_CONTENT_DOCS, wip_limit: 4 },
          ],
        },
      };
      writeFileSync(configPath, stringifyYAML(config));

      // Both should work without breaking
      const coreLimit = getWipLimitForLane(TEST_LANE_FRAMEWORK_CORE, { configPath });
      const docsLimit = getWipLimitForLane(TEST_LANE_CONTENT_DOCS, { configPath });

      expect(coreLimit).toBe(1);
      expect(docsLimit).toBe(4);

      // Justification check should work too
      const coreResult = checkWipJustification(TEST_LANE_FRAMEWORK_CORE, { configPath });
      const docsResult = checkWipJustification(TEST_LANE_CONTENT_DOCS, { configPath });

      expect(coreResult.valid).toBe(true);
      expect(coreResult.requiresJustification).toBe(false);

      expect(docsResult.valid).toBe(true);
      expect(docsResult.requiresJustification).toBe(true); // Needs justification because wip_limit > 1
      expect(docsResult.warning).toBeTruthy();
    });
  });
});

/**
 * WU-1308: Tests for lane-inference file missing error message
 *
 * When a sub-lane is used but .lumenflow.lane-inference.yaml is missing,
 * the error should explicitly name the missing file and suggest how to fix.
 */
describe('lane-checker missing lane-inference file error (WU-1308)', () => {
  let testBaseDir: string;
  let configFilePath: string;

  beforeEach(() => {
    vi.resetModules();

    // Create a unique test directory for each test
    testBaseDir = join(
      tmpdir(),
      // eslint-disable-next-line sonarjs/pseudo-random -- Test isolation needs unique temp dirs
      `${TEST_DIR_PREFIX}inference-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testBaseDir, { recursive: true });

    configFilePath = join(testBaseDir, '.lumenflow.config.yaml');

    // Create .lumenflow.config.yaml with parent lanes defined (via definitions)
    const config = {
      lanes: {
        definitions: [
          { name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 1 },
          { name: TEST_LANE_FRAMEWORK_CLI, wip_limit: 1 },
        ],
      },
    };
    writeFileSync(configFilePath, stringifyYAML(config));

    // NOTE: .lumenflow.lane-inference.yaml is intentionally NOT created
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      rmSync(testBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('validateLaneFormat with missing lane-inference file', () => {
    /** Module path for dynamic import (extracted to avoid duplication) */
    const LANE_CHECKER_MODULE = '../lane-checker.js';

    /**
     * Helper to mock lumenflow-config.js and import lane-checker with mocked deps.
     * Combines mock setup and dynamic import to avoid duplication.
     */
    async function importMockedLaneChecker(): Promise<{
      validateLaneFormat: typeof import('../lane-checker.js').validateLaneFormat;
    }> {
      vi.doMock('../lumenflow-config.js', () => ({
        findProjectRoot: vi.fn().mockReturnValue(testBaseDir),
        getProjectRoot: vi.fn().mockReturnValue(testBaseDir),
        getConfig: vi.fn().mockReturnValue(MOCK_GIT_CONFIG),
      }));
      return import(LANE_CHECKER_MODULE);
    }

    it('should throw error that mentions the missing file name', async () => {
      const { validateLaneFormat } = await importMockedLaneChecker();

      try {
        validateLaneFormat(TEST_LANE_FRAMEWORK_CORE, configFilePath);
        expect.fail(EXPECTED_THROW_MESSAGE);
      } catch (error) {
        // Error should mention the lane-inference file name
        expect((error as Error).message).toContain(CONFIG_FILES.LANE_INFERENCE);
      }
    });

    it('should throw error that includes lane:suggest command', async () => {
      const { validateLaneFormat } = await importMockedLaneChecker();

      try {
        validateLaneFormat(TEST_LANE_FRAMEWORK_CORE, configFilePath);
        expect.fail(EXPECTED_THROW_MESSAGE);
      } catch (error) {
        // Error should include actionable fix command
        expect((error as Error).message).toContain('lane:suggest');
      }
    });

    it('should throw error that explains the file is for lane taxonomy', async () => {
      const { validateLaneFormat } = await importMockedLaneChecker();

      try {
        validateLaneFormat(TEST_LANE_FRAMEWORK_CORE, configFilePath);
        expect.fail(EXPECTED_THROW_MESSAGE);
      } catch (error) {
        // Error should explain the purpose of the file
        expect((error as Error).message.toLowerCase()).toContain('taxonomy');
      }
    });

    it('should use FILE_NOT_FOUND error code', async () => {
      const { validateLaneFormat } = await importMockedLaneChecker();

      try {
        validateLaneFormat(TEST_LANE_FRAMEWORK_CORE, configFilePath);
        expect.fail(EXPECTED_THROW_MESSAGE);
      } catch (error) {
        // Error should have the correct error code
        expect((error as { code?: string }).code).toBe('FILE_NOT_FOUND');
      }
    });
  });
});
