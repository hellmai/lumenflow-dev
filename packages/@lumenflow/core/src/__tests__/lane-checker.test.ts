// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

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
import {
  getWipLimitForLane,
  checkWipJustification,
  getLockPolicyForLane,
  checkLaneFree,
} from '../lane-checker.js';
import { WORKSPACE_CONFIG_FILE_NAME, WORKSPACE_V2_KEYS } from '../config-contract.js';
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

/** Test directory path segments for tasks directory */
const TEST_TASKS_DIR_SEGMENTS = ['docs', '04-operations', 'tasks'] as const;

/** Test directory name for WU files */
const TEST_WU_DIR_NAME = 'wu';

/** Mock config for lumenflow-config.js in WU-1308 tests */
const MOCK_GIT_CONFIG = {
  git: { mainBranch: 'main', defaultRemote: 'origin', requireRemote: true },
};

/** Error message for expected throw scenarios */
const EXPECTED_THROW_MESSAGE = 'Should have thrown an error';

/** Canonical workspace key for software-delivery config */
const SOFTWARE_DELIVERY_KEY = WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY;

/**
 * Write software-delivery config to workspace.yaml fixture.
 */
function writeWorkspaceConfig(configPath: string, config: Record<string, unknown>): void {
  const workspace = {
    [SOFTWARE_DELIVERY_KEY]: config,
  };
  writeFileSync(configPath, stringifyYAML(workspace));
}

function withArc42Directories(config: Record<string, unknown>): Record<string, unknown> {
  return {
    directories: {
      wuDir: 'docs/04-operations/tasks/wu',
      statusPath: 'docs/04-operations/tasks/status.md',
      backlogPath: 'docs/04-operations/tasks/backlog.md',
    },
    ...config,
  };
}

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
    const tasksDir = join(testBaseDir, ...TEST_TASKS_DIR_SEGMENTS);
    mkdirSync(tasksDir, { recursive: true });
    mkdirSync(join(tasksDir, TEST_WU_DIR_NAME), { recursive: true });

    configPath = join(testBaseDir, WORKSPACE_CONFIG_FILE_NAME);
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
      writeWorkspaceConfig(configPath, withArc42Directories(config));

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
      writeWorkspaceConfig(configPath, withArc42Directories(config));

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
      writeWorkspaceConfig(configPath, withArc42Directories(config));

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
      writeWorkspaceConfig(configPath, withArc42Directories(config));

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
      writeWorkspaceConfig(configPath, withArc42Directories(config));

      const result = checkWipJustification(TEST_LANE_FRAMEWORK_CORE, { configPath });

      expect(result.valid).toBe(true);
      expect(result.warning).toBeNull();
      expect(result.requiresJustification).toBe(false);
    });

    it('should work with legacy flat array config format', () => {
      const config = {
        lanes: [{ name: TEST_LANE_FRAMEWORK, wip_limit: 2 }],
      };
      writeWorkspaceConfig(configPath, withArc42Directories(config));

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
      writeWorkspaceConfig(configPath, withArc42Directories(config));

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
      writeWorkspaceConfig(configPath, withArc42Directories(config));

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
      writeWorkspaceConfig(configPath, config);

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
      writeWorkspaceConfig(configPath, config);

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
      writeWorkspaceConfig(configPath, config);

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
 * WU-1325: Tests for lock_policy feature
 *
 * Lock policies:
 * - 'all' (default): Lock held through entire WU lifecycle (claim to done)
 * - 'active': Lock released on block, re-acquired on unblock
 * - 'none': No lock files created, WIP checking disabled for this lane
 */
describe('lane-checker lock_policy (WU-1325)', () => {
  let testBaseDir: string;
  let configPath: string;

  beforeEach(() => {
    // Create a unique test directory for each test
    testBaseDir = join(
      tmpdir(),
      // eslint-disable-next-line sonarjs/pseudo-random -- Test isolation needs unique temp dirs
      `${TEST_DIR_PREFIX}lock-policy-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testBaseDir, { recursive: true });

    // Create docs/04-operations/tasks directory structure
    const tasksDir = join(testBaseDir, ...TEST_TASKS_DIR_SEGMENTS);
    mkdirSync(tasksDir, { recursive: true });
    mkdirSync(join(tasksDir, TEST_WU_DIR_NAME), { recursive: true });

    configPath = join(testBaseDir, WORKSPACE_CONFIG_FILE_NAME);
  });

  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(testBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('getLockPolicyForLane', () => {
    it('should return default "all" when no lock_policy specified', () => {
      const config = {
        lanes: {
          definitions: [{ name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 1 }],
        },
      };
      writeWorkspaceConfig(configPath, config);

      const result = getLockPolicyForLane(TEST_LANE_FRAMEWORK_CORE, { configPath });

      expect(result).toBe('all');
    });

    it('should return "all" when lock_policy is explicitly set to "all"', () => {
      const config = {
        lanes: {
          definitions: [{ name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 1, lock_policy: 'all' }],
        },
      };
      writeWorkspaceConfig(configPath, config);

      const result = getLockPolicyForLane(TEST_LANE_FRAMEWORK_CORE, { configPath });

      expect(result).toBe('all');
    });

    it('should return "active" when lock_policy is set to "active"', () => {
      const config = {
        lanes: {
          definitions: [{ name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 1, lock_policy: 'active' }],
        },
      };
      writeWorkspaceConfig(configPath, config);

      const result = getLockPolicyForLane(TEST_LANE_FRAMEWORK_CORE, { configPath });

      expect(result).toBe('active');
    });

    it('should return "none" when lock_policy is set to "none"', () => {
      const config = {
        lanes: {
          definitions: [
            {
              name: TEST_LANE_CONTENT_DOCS,
              wip_limit: 4,
              lock_policy: 'none',
            },
          ],
        },
      };
      writeWorkspaceConfig(configPath, config);

      const result = getLockPolicyForLane(TEST_LANE_CONTENT_DOCS, { configPath });

      expect(result).toBe('none');
    });

    it('should return default "all" when lane not found in config', () => {
      const config = {
        lanes: {
          definitions: [{ name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 1 }],
        },
      };
      writeWorkspaceConfig(configPath, config);

      const result = getLockPolicyForLane(TEST_LANE_NONEXISTENT, { configPath });

      expect(result).toBe('all');
    });

    it('should return default "all" when config file does not exist', () => {
      const result = getLockPolicyForLane(TEST_LANE_FRAMEWORK_CORE, {
        configPath: '/nonexistent/path.yaml',
      });

      expect(result).toBe('all');
    });

    it('should return default "all" when lock_policy has invalid value', () => {
      const config = {
        lanes: {
          definitions: [
            {
              name: TEST_LANE_FRAMEWORK_CORE,
              wip_limit: 1,
              lock_policy: 'invalid_value',
            },
          ],
        },
      };
      writeWorkspaceConfig(configPath, config);

      const result = getLockPolicyForLane(TEST_LANE_FRAMEWORK_CORE, { configPath });

      expect(result).toBe('all');
    });

    it('should work with flat array config format', () => {
      const config = {
        lanes: [{ name: TEST_LANE_FRAMEWORK, wip_limit: 1, lock_policy: 'none' }],
      };
      writeWorkspaceConfig(configPath, config);

      const result = getLockPolicyForLane(TEST_LANE_FRAMEWORK, { configPath });

      expect(result).toBe('none');
    });

    it('should work with legacy nested format (engineering/business)', () => {
      const config = {
        lanes: {
          engineering: [{ name: TEST_LANE_FRAMEWORK, wip_limit: 1, lock_policy: 'active' }],
          business: [{ name: TEST_LANE_CONTENT, wip_limit: 1 }],
        },
      };
      writeWorkspaceConfig(configPath, config);

      const engineeringResult = getLockPolicyForLane(TEST_LANE_FRAMEWORK, { configPath });
      const businessResult = getLockPolicyForLane(TEST_LANE_CONTENT, { configPath });

      expect(engineeringResult).toBe('active');
      expect(businessResult).toBe('all'); // Default when not specified
    });

    it('should be case-insensitive for lane name matching', () => {
      const config = {
        lanes: {
          definitions: [
            {
              name: 'Framework: Core',
              wip_limit: 1,
              lock_policy: 'active',
            },
          ],
        },
      };
      writeWorkspaceConfig(configPath, config);

      const result = getLockPolicyForLane('framework: core', { configPath });

      expect(result).toBe('active');
    });
  });

  describe('lock_policy integration with LaneConfigWithWip', () => {
    it('should coexist with wip_limit and wip_justification', () => {
      const config = {
        lanes: {
          definitions: [
            {
              name: TEST_LANE_CONTENT_DOCS,
              wip_limit: 4,
              wip_justification: 'Docs are low-conflict parallel work',
              lock_policy: 'none',
            },
          ],
        },
      };
      writeWorkspaceConfig(configPath, config);

      // All three fields should work together
      const wipLimit = getWipLimitForLane(TEST_LANE_CONTENT_DOCS, { configPath });
      const justification = checkWipJustification(TEST_LANE_CONTENT_DOCS, { configPath });
      const lockPolicy = getLockPolicyForLane(TEST_LANE_CONTENT_DOCS, { configPath });

      expect(wipLimit).toBe(4);
      expect(justification.justification).toBe('Docs are low-conflict parallel work');
      expect(lockPolicy).toBe('none');
    });
  });
});

/**
 * WU-1324: Tests for checkLaneFree with lock_policy
 *
 * The lock_policy affects how WIP counting works:
 * - 'all' (default): Count in_progress + blocked WUs toward WIP limit
 * - 'active': Count only in_progress WUs (blocked WUs release lane lock)
 * - 'none': Disable WIP checking entirely (lane always free)
 */
describe('lane-checker checkLaneFree with lock_policy (WU-1324)', () => {
  let testBaseDir: string;
  let configPath: string;
  let statusPath: string;
  let wuDir: string;

  /** Test WU IDs */
  const WU_IN_PROGRESS = 'WU-1001';
  const WU_BLOCKED = 'WU-1002';
  const WU_NEW = 'WU-1003';
  const WU_SUPERSEDED = 'WU-1004';
  const WU_DONE = 'WU-1005';
  const WU_CANCELLED = 'WU-1006';

  beforeEach(() => {
    // Create a unique test directory for each test
    testBaseDir = join(
      tmpdir(),
      // eslint-disable-next-line sonarjs/pseudo-random -- Test isolation needs unique temp dirs
      `${TEST_DIR_PREFIX}checklanefree-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testBaseDir, { recursive: true });

    // Create docs/04-operations/tasks directory structure
    const tasksDir = join(testBaseDir, ...TEST_TASKS_DIR_SEGMENTS);
    mkdirSync(tasksDir, { recursive: true });
    wuDir = join(tasksDir, TEST_WU_DIR_NAME);
    mkdirSync(wuDir, { recursive: true });

    configPath = join(testBaseDir, WORKSPACE_CONFIG_FILE_NAME);
    statusPath = join(tasksDir, 'status.md');
  });

  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(testBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Helper to create a WU YAML file
   */
  function createWuFile(wuId: string, lane: string, status: string): void {
    const wuContent = {
      id: wuId,
      title: `Test WU ${wuId}`,
      lane,
      status,
      type: 'feature',
    };
    writeFileSync(join(wuDir, `${wuId}.yaml`), stringifyYAML(wuContent));
  }

  /**
   * Helper to create a status.md file with In Progress and Blocked sections
   */
  function createStatusFile(inProgressWUs: string[], blockedWUs: string[]): void {
    const inProgressSection = inProgressWUs
      .map((id) => `- [${id} — Test WU](wu/${id}.yaml)`)
      .join('\n');
    const blockedSection = blockedWUs.map((id) => `- [${id} — Test WU](wu/${id}.yaml)`).join('\n');

    const content = `# Work Unit Status

_Last updated: 2026-02-02_

## In Progress

${inProgressWUs.length > 0 ? inProgressSection : 'No items currently in progress'}

## Blocked

${blockedWUs.length > 0 ? blockedSection : 'No blocked items'}

## Completed

No completed items
`;
    writeFileSync(statusPath, content);
  }

  describe('policy=all (default behavior)', () => {
    it('should count both in_progress and blocked WUs toward WIP limit', () => {
      // Setup config with policy=all (default)
      const config = {
        lanes: {
          definitions: [{ name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 2, lock_policy: 'all' }],
        },
      };
      writeWorkspaceConfig(configPath, withArc42Directories(config));

      // Create WU files - one in_progress and one blocked
      createWuFile(WU_IN_PROGRESS, TEST_LANE_FRAMEWORK_CORE, 'in_progress');
      createWuFile(WU_BLOCKED, TEST_LANE_FRAMEWORK_CORE, 'blocked');

      // Status.md has one in_progress and one blocked
      createStatusFile([WU_IN_PROGRESS], [WU_BLOCKED]);

      // Test using the already imported checkLaneFree
      const result = checkLaneFree(statusPath, TEST_LANE_FRAMEWORK_CORE, WU_NEW, { configPath });

      // With policy=all, both in_progress and blocked count
      // WIP limit = 2, current count = 2 (1 in_progress + 1 blocked)
      // So lane should NOT be free
      expect(result.free).toBe(false);
      expect(result.currentCount).toBe(2);
      expect(result.wipLimit).toBe(2);
    });

    it('should maintain current behavior when lock_policy is not specified', () => {
      // Setup config without lock_policy (defaults to 'all')
      const config = {
        lanes: {
          definitions: [{ name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 2 }],
        },
      };
      writeWorkspaceConfig(configPath, withArc42Directories(config));

      // Create WU files
      createWuFile(WU_IN_PROGRESS, TEST_LANE_FRAMEWORK_CORE, 'in_progress');
      createWuFile(WU_BLOCKED, TEST_LANE_FRAMEWORK_CORE, 'blocked');
      createStatusFile([WU_IN_PROGRESS], [WU_BLOCKED]);

      const result = checkLaneFree(statusPath, TEST_LANE_FRAMEWORK_CORE, WU_NEW, { configPath });

      // Default policy is 'all', so blocked WUs count
      expect(result.free).toBe(false);
      expect(result.currentCount).toBe(2);
    });

    it('should ignore superseded, done, and cancelled WUs in In Progress section', () => {
      const config = {
        lanes: {
          definitions: [{ name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 1, lock_policy: 'all' }],
        },
      };
      writeWorkspaceConfig(configPath, withArc42Directories(config));

      createWuFile(WU_SUPERSEDED, TEST_LANE_FRAMEWORK_CORE, 'superseded');
      createWuFile(WU_DONE, TEST_LANE_FRAMEWORK_CORE, 'done');
      createWuFile(WU_CANCELLED, TEST_LANE_FRAMEWORK_CORE, 'cancelled');
      createStatusFile([WU_SUPERSEDED, WU_DONE, WU_CANCELLED], []);

      const result = checkLaneFree(statusPath, TEST_LANE_FRAMEWORK_CORE, WU_NEW, { configPath });

      expect(result.free).toBe(true);
      expect(result.currentCount).toBe(0);
      expect(result.inProgressWUs).toEqual([]);
      expect(result.occupiedBy).toBeNull();
    });

    it('should ignore non-active WUs in Blocked section under policy=all', () => {
      const config = {
        lanes: {
          definitions: [{ name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 1, lock_policy: 'all' }],
        },
      };
      writeWorkspaceConfig(configPath, withArc42Directories(config));

      createWuFile(WU_IN_PROGRESS, TEST_LANE_FRAMEWORK_CORE, 'in_progress');
      createWuFile(WU_SUPERSEDED, TEST_LANE_FRAMEWORK_CORE, 'superseded');
      createWuFile(WU_DONE, TEST_LANE_FRAMEWORK_CORE, 'done');
      createWuFile(WU_CANCELLED, TEST_LANE_FRAMEWORK_CORE, 'cancelled');
      createStatusFile([WU_SUPERSEDED, WU_IN_PROGRESS], [WU_DONE, WU_CANCELLED]);

      const result = checkLaneFree(statusPath, TEST_LANE_FRAMEWORK_CORE, WU_NEW, { configPath });

      expect(result.free).toBe(false);
      expect(result.currentCount).toBe(1);
      expect(result.inProgressWUs).toEqual([WU_IN_PROGRESS]);
      expect(result.occupiedBy).toBe(WU_IN_PROGRESS);
    });
  });

  describe('policy=active', () => {
    it('should exclude blocked WUs from WIP count', () => {
      // Setup config with policy=active
      const config = {
        lanes: {
          definitions: [{ name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 2, lock_policy: 'active' }],
        },
      };
      writeWorkspaceConfig(configPath, withArc42Directories(config));

      // Create WU files - one in_progress and one blocked
      createWuFile(WU_IN_PROGRESS, TEST_LANE_FRAMEWORK_CORE, 'in_progress');
      createWuFile(WU_BLOCKED, TEST_LANE_FRAMEWORK_CORE, 'blocked');
      createStatusFile([WU_IN_PROGRESS], [WU_BLOCKED]);

      const result = checkLaneFree(statusPath, TEST_LANE_FRAMEWORK_CORE, WU_NEW, { configPath });

      // With policy=active, only in_progress counts
      // WIP limit = 2, current count = 1 (only in_progress)
      // So lane SHOULD be free
      expect(result.free).toBe(true);
      expect(result.currentCount).toBe(1);
      expect(result.wipLimit).toBe(2);
    });

    it('should still block when in_progress WUs exceed limit', () => {
      // Setup config with policy=active and limit=1
      const config = {
        lanes: {
          definitions: [{ name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 1, lock_policy: 'active' }],
        },
      };
      writeWorkspaceConfig(configPath, withArc42Directories(config));

      // One in_progress WU
      createWuFile(WU_IN_PROGRESS, TEST_LANE_FRAMEWORK_CORE, 'in_progress');
      createStatusFile([WU_IN_PROGRESS], []);

      const result = checkLaneFree(statusPath, TEST_LANE_FRAMEWORK_CORE, WU_NEW, { configPath });

      // With limit=1 and 1 in_progress, lane is occupied
      expect(result.free).toBe(false);
      expect(result.currentCount).toBe(1);
      expect(result.occupiedBy).toBe(WU_IN_PROGRESS);
    });
  });

  describe('policy=none', () => {
    it('should disable WIP checking entirely (always free)', () => {
      // Setup config with policy=none
      const config = {
        lanes: {
          definitions: [{ name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 1, lock_policy: 'none' }],
        },
      };
      writeWorkspaceConfig(configPath, withArc42Directories(config));

      // Multiple WUs in the lane
      createWuFile(WU_IN_PROGRESS, TEST_LANE_FRAMEWORK_CORE, 'in_progress');
      createWuFile(WU_BLOCKED, TEST_LANE_FRAMEWORK_CORE, 'blocked');
      createStatusFile([WU_IN_PROGRESS], [WU_BLOCKED]);

      const result = checkLaneFree(statusPath, TEST_LANE_FRAMEWORK_CORE, WU_NEW, { configPath });

      // With policy=none, WIP checking is disabled
      // Lane should always be free regardless of WU count
      expect(result.free).toBe(true);
    });

    it('should indicate WIP checking is disabled in result', () => {
      // Setup config with policy=none
      const config = {
        lanes: {
          definitions: [{ name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 1, lock_policy: 'none' }],
        },
      };
      writeWorkspaceConfig(configPath, withArc42Directories(config));

      createWuFile(WU_IN_PROGRESS, TEST_LANE_FRAMEWORK_CORE, 'in_progress');
      createStatusFile([WU_IN_PROGRESS], []);

      const result = checkLaneFree(statusPath, TEST_LANE_FRAMEWORK_CORE, WU_NEW, { configPath });

      // Result should indicate no error and lane is free
      expect(result.free).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe('backward compatibility', () => {
    it('should work with status.md that has no Blocked section', () => {
      // Setup config with policy=all
      const config = {
        lanes: {
          definitions: [{ name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 2, lock_policy: 'all' }],
        },
      };
      writeWorkspaceConfig(configPath, withArc42Directories(config));

      // Create status.md without Blocked section
      const content = `# Work Unit Status

## In Progress

- [WU-1001 — Test WU](wu/WU-1001.yaml)

## Completed

No completed items
`;
      writeFileSync(statusPath, content);
      createWuFile(WU_IN_PROGRESS, TEST_LANE_FRAMEWORK_CORE, 'in_progress');

      const result = checkLaneFree(statusPath, TEST_LANE_FRAMEWORK_CORE, WU_NEW, { configPath });

      // Should work and only count in_progress (since no blocked section)
      expect(result.error).toBeNull();
      expect(result.currentCount).toBe(1);
      expect(result.free).toBe(true);
    });

    it('should resolve project root for simple docs/tasks layout without fixed-depth assumptions', () => {
      const config = {
        lanes: {
          definitions: [{ name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 2, lock_policy: 'all' }],
        },
      };
      writeWorkspaceConfig(configPath, config);

      const simpleTasksDir = join(testBaseDir, 'docs', 'tasks');
      const simpleWuDir = join(simpleTasksDir, TEST_WU_DIR_NAME);
      const simpleStatusPath = join(simpleTasksDir, 'status.md');

      mkdirSync(simpleWuDir, { recursive: true });
      writeFileSync(
        join(simpleWuDir, `${WU_IN_PROGRESS}.yaml`),
        stringifyYAML({
          id: WU_IN_PROGRESS,
          title: `Test WU ${WU_IN_PROGRESS}`,
          lane: TEST_LANE_FRAMEWORK_CORE,
          status: 'in_progress',
          type: 'feature',
        }),
      );
      writeFileSync(
        simpleStatusPath,
        `# Work Unit Status

## In Progress

- [${WU_IN_PROGRESS} — Test WU](wu/${WU_IN_PROGRESS}.yaml)

## Blocked

No blocked items

## Completed

No completed items
`,
      );

      const result = checkLaneFree(simpleStatusPath, TEST_LANE_FRAMEWORK_CORE, WU_NEW, {
        configPath,
      });

      expect(result.error).toBeNull();
      expect(result.currentCount).toBe(1);
      expect(result.free).toBe(true);
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

    configFilePath = join(testBaseDir, WORKSPACE_CONFIG_FILE_NAME);

    // Create workspace.yaml with parent lanes defined (via definitions)
    const config = {
      lanes: {
        definitions: [
          { name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 1 },
          { name: TEST_LANE_FRAMEWORK_CLI, wip_limit: 1 },
        ],
      },
    };
    writeWorkspaceConfig(configFilePath, config);

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
        WORKSPACE_CONFIG_FILE_NAME,
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

  describe('WU-2223: control_plane schema + lane validation', () => {
    /** Module path for dynamic import */
    const LANE_CHECKER_MODULE = '../lane-checker.js';

    /**
     * Helper to mock lumenflow-config.js pointing at testBaseDir,
     * preserving real getConfig so the runtime config path is exercised.
     */
    async function importLaneCheckerWithMockedRoot(): Promise<{
      validateLaneFormat: typeof import('../lane-checker.js').validateLaneFormat;
    }> {
      vi.doMock('../lumenflow-config.js', async (importOriginal) => {
        const original = (await importOriginal()) as Record<string, unknown>;
        return {
          ...original,
          findProjectRoot: vi.fn().mockReturnValue(testBaseDir),
          getProjectRoot: vi.fn().mockReturnValue(testBaseDir),
        };
      });
      return import(LANE_CHECKER_MODULE);
    }

    /**
     * When workspace.yaml has a kernel-shape control_plane block,
     * lane validation via the runtime path should still work.
     */
    it('should validate lanes when workspace.yaml has kernel-shape control_plane', async () => {
      // Write workspace.yaml with both software_delivery AND kernel-shape control_plane
      const workspaceWithControlPlane = {
        [SOFTWARE_DELIVERY_KEY]: withArc42Directories({
          lanes: {
            definitions: [
              { name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 1 },
              { name: TEST_LANE_CONTENT_DOCS, wip_limit: 1 },
            ],
          },
        }),
        control_plane: {
          endpoint: 'https://cloud.lumenflow.dev',
          org_id: 'test-org-id',
          project_id: 'test-project-id',
          sync_interval: 30,
          policy_mode: 'tighten-only',
          auth: { token_env: 'LUMENFLOW_CLOUD_TOKEN' },
        },
      };
      writeFileSync(configFilePath, stringifyYAML(workspaceWithControlPlane));

      // Also write lane-inference so sub-lane validation doesn't fail
      const laneInferencePath = join(testBaseDir, CONFIG_FILES.LANE_INFERENCE);
      const laneInference = {
        Framework: {
          Core: { code_paths: ['packages/**/core/**'], keywords: ['core'] },
        },
        Content: {
          Documentation: { code_paths: ['docs/**'], keywords: ['docs'] },
        },
      };
      writeFileSync(laneInferencePath, stringifyYAML(laneInference));

      const { validateLaneFormat } = await importLaneCheckerWithMockedRoot();

      // Use null configPath to exercise runtime getConfig path (not readConfigFromPath)
      const result = validateLaneFormat(TEST_LANE_FRAMEWORK_CORE, null);
      expect(result.valid).toBe(true);
    });

    it('should throw CONFIG_ERROR (not FILE_NOT_FOUND) when config parse fails', async () => {
      // Write workspace.yaml with invalid control_plane to trigger parse failure
      const workspaceWithBadControlPlane = {
        [SOFTWARE_DELIVERY_KEY]: withArc42Directories({
          lanes: {
            definitions: [{ name: TEST_LANE_FRAMEWORK_CORE, wip_limit: 1 }],
          },
        }),
        control_plane: {
          invalid_field: true,
        },
      };
      writeFileSync(configFilePath, stringifyYAML(workspaceWithBadControlPlane));

      const { validateLaneFormat } = await importLaneCheckerWithMockedRoot();

      try {
        // Pass null configPath to trigger runtime config path
        validateLaneFormat(TEST_LANE_FRAMEWORK, null);
        expect.fail(EXPECTED_THROW_MESSAGE);
      } catch (error) {
        // WU-2223: Should be CONFIG_ERROR, not FILE_NOT_FOUND
        expect((error as { code?: string }).code).toBe('CONFIG_ERROR');
      }
    });
  });
});
