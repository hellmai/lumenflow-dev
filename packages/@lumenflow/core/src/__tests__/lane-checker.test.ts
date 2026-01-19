import { describe, it, expect } from 'vitest';
import { validateLaneFormat, extractParent, getSubLanesForParent } from '../lane-checker.js';
import { ErrorCodes } from '../error-handler.js';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Check if running in a project with config files
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '../../..');
const hasConfig = existsSync(join(projectRoot, '.lumenflow.config.yaml'));
const hasLaneInference = existsSync(join(projectRoot, '.lumenflow.lane-inference.yaml'));
const hasFullConfig = hasConfig && hasLaneInference;

/**
 * WU-1022: Tests for LumenFlow OS lane taxonomy
 *
 * LumenFlow OS uses:
 * - Framework: Core, CLI, Memory, Agent, Metrics, Initiatives, Shims
 * - Operations: Infrastructure, CI/CD
 * - Content: Documentation
 */
describe.skipIf(!hasFullConfig)('validateLaneFormat - LumenFlow OS taxonomy', () => {
  describe('sub-lane validation', () => {
    it('accepts "Framework: Core" as a valid sub-lane', () => {
      const { valid, parent } = validateLaneFormat('Framework: Core');
      expect(valid).toBe(true);
      expect(parent).toBe('Framework');
    });

    it('accepts "Framework: CLI" as a valid sub-lane', () => {
      const { valid, parent } = validateLaneFormat('Framework: CLI');
      expect(valid).toBe(true);
      expect(parent).toBe('Framework');
    });

    it('accepts "Framework: Memory" as a valid sub-lane', () => {
      const { valid, parent } = validateLaneFormat('Framework: Memory');
      expect(valid).toBe(true);
      expect(parent).toBe('Framework');
    });

    it('accepts "Operations: Infrastructure" as a valid sub-lane', () => {
      const { valid, parent } = validateLaneFormat('Operations: Infrastructure');
      expect(valid).toBe(true);
      expect(parent).toBe('Operations');
    });

    it('accepts "Operations: CI/CD" as a valid sub-lane', () => {
      const { valid, parent } = validateLaneFormat('Operations: CI/CD');
      expect(valid).toBe(true);
      expect(parent).toBe('Operations');
    });

    it('accepts "Content: Documentation" as a valid sub-lane', () => {
      const { valid, parent } = validateLaneFormat('Content: Documentation');
      expect(valid).toBe(true);
      expect(parent).toBe('Content');
    });

    it('rejects unknown sub-lane for Framework parent', () => {
      expect(() => validateLaneFormat('Framework: Unknown')).toThrow(
        /Unknown sub-lane: "Unknown" for parent lane "Framework"/,
      );
    });

    it('rejects typo in sub-lane name', () => {
      expect(() => validateLaneFormat('Framework: Cor')).toThrow(
        /Unknown sub-lane: "Cor" for parent lane "Framework"/,
      );
    });
  });

  describe('parent-only lane validation', () => {
    it('rejects parent-only "Framework" lane (taxonomy exists)', () => {
      try {
        validateLaneFormat('Framework');
        expect.fail('Should have thrown');
      } catch (err: unknown) {
        const error = err as {
          code: string;
          message: string;
          details: { validSubLanes: string[] };
        };
        expect(error.code).toBe(ErrorCodes.INVALID_LANE);
        expect(/Sub-lane required/.test(error.message)).toBeTruthy();
        expect(error.details.validSubLanes).toContain('Core');
        expect(error.details.validSubLanes).toContain('CLI');
      }
    });

    it('rejects parent-only "Operations" lane (taxonomy exists)', () => {
      try {
        validateLaneFormat('Operations');
        expect.fail('Should have thrown');
      } catch (err: unknown) {
        const error = err as {
          code: string;
          message: string;
          details: { validSubLanes: string[] };
        };
        expect(error.code).toBe(ErrorCodes.INVALID_LANE);
        expect(/Sub-lane required/.test(error.message)).toBeTruthy();
        expect(error.details.validSubLanes).toContain('Infrastructure');
        expect(error.details.validSubLanes).toContain('CI/CD');
      }
    });

    it('rejects parent-only "Content" lane (taxonomy exists)', () => {
      try {
        validateLaneFormat('Content');
        expect.fail('Should have thrown');
      } catch (err: unknown) {
        const error = err as {
          code: string;
          message: string;
          details: { validSubLanes: string[] };
        };
        expect(error.code).toBe(ErrorCodes.INVALID_LANE);
        expect(/Sub-lane required/.test(error.message)).toBeTruthy();
        expect(error.details.validSubLanes).toContain('Documentation');
      }
    });
  });

  describe('strict option for backward compatibility', () => {
    it('strict: true (default) throws for parent-only with taxonomy', () => {
      try {
        validateLaneFormat('Framework');
        expect.fail('Should have thrown');
      } catch (err: unknown) {
        const error = err as { code: string };
        expect(error.code).toBe(ErrorCodes.INVALID_LANE);
      }
    });

    it('strict: false warns but does not throw for parent-only with taxonomy', () => {
      // Should not throw - returns valid result but logs warning
      const { valid, parent } = validateLaneFormat('Framework', null, { strict: false });
      expect(valid).toBe(true);
      expect(parent).toBe('Framework');
    });

    it('strict option does not affect valid sub-lanes', () => {
      const result1 = validateLaneFormat('Framework: CLI', null, { strict: true });
      const result2 = validateLaneFormat('Framework: CLI', null, { strict: false });
      expect(result1.valid).toBe(true);
      expect(result2.valid).toBe(true);
    });
  });

  describe('getSubLanesForParent', () => {
    it('returns sub-lanes for Framework', () => {
      const subLanes = getSubLanesForParent('Framework');
      expect(subLanes).toContain('Core');
      expect(subLanes).toContain('CLI');
      expect(subLanes).toContain('Memory');
      expect(subLanes).toContain('Agent');
      expect(subLanes).toContain('Metrics');
      expect(subLanes).toContain('Initiatives');
      expect(subLanes).toContain('Shims');
    });

    it('returns sub-lanes for Operations', () => {
      const subLanes = getSubLanesForParent('Operations');
      expect(subLanes).toContain('Infrastructure');
      expect(subLanes).toContain('CI/CD');
    });

    it('returns sub-lanes for Content', () => {
      const subLanes = getSubLanesForParent('Content');
      expect(subLanes).toContain('Documentation');
    });

    it('handles case-insensitive parent lookup', () => {
      const subLanes = getSubLanesForParent('framework');
      expect(subLanes).toContain('Core');
    });
  });

  describe('extractParent', () => {
    it('extracts parent from sub-lane format', () => {
      expect(extractParent('Framework: CLI')).toBe('Framework');
    });

    it('extracts parent from Operations sub-lane', () => {
      expect(extractParent('Operations: Infrastructure')).toBe('Operations');
    });

    it('returns parent-only lane as-is', () => {
      expect(extractParent('Framework')).toBe('Framework');
    });

    it('handles trimming whitespace', () => {
      expect(extractParent('  Framework: CLI  ')).toBe('Framework');
    });
  });

  describe('format validation errors', () => {
    it('rejects multiple colons', () => {
      expect(() => validateLaneFormat('Framework: Core: Extra')).toThrow(
        /contains multiple colons/,
      );
    });

    it('rejects space before colon', () => {
      expect(() => validateLaneFormat('Framework : CLI')).toThrow(/has space before colon/);
    });

    it('rejects missing space after colon', () => {
      expect(() => validateLaneFormat('Framework:CLI')).toThrow(/missing space after colon/);
    });
  });
});

// WU-1016: Tests for configurable WIP limits per lane
import { checkLaneFree, getWipLimitForLane } from '../lane-checker.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('WU-1016: Configurable WIP limits per lane', () => {
  let tempDir: string;
  let statusPath: string;
  let wuDir: string;
  let configPath: string;

  beforeEach(() => {
    // Create a temporary directory for test files
    tempDir = mkdtempSync(join(tmpdir(), 'lane-checker-test-'));
    statusPath = join(tempDir, 'docs', '04-operations', 'tasks', 'status.md');
    wuDir = join(tempDir, 'docs', '04-operations', 'tasks', 'wu');
    configPath = join(tempDir, '.lumenflow.config.yaml');

    // Create required directories
    mkdirSync(dirname(statusPath), { recursive: true });
    mkdirSync(wuDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getWipLimitForLane', () => {
    it('returns 1 as default when lane not in config', () => {
      // Config with no wip_limit specified
      writeFileSync(
        configPath,
        `version: '2.0'
lanes:
  - name: 'Core'
    code_paths:
      - 'packages/@lumenflow/core/**'
`,
      );

      const limit = getWipLimitForLane('Core', { configPath });
      expect(limit).toBe(1);
    });

    it('returns configured wip_limit when specified', () => {
      writeFileSync(
        configPath,
        `version: '2.0'
lanes:
  - name: 'Core'
    wip_limit: 3
    code_paths:
      - 'packages/@lumenflow/core/**'
`,
      );

      const limit = getWipLimitForLane('Core', { configPath });
      expect(limit).toBe(3);
    });

    it('handles case-insensitive lane lookup', () => {
      writeFileSync(
        configPath,
        `version: '2.0'
lanes:
  - name: 'Core'
    wip_limit: 2
    code_paths:
      - 'packages/@lumenflow/core/**'
`,
      );

      const limit = getWipLimitForLane('core', { configPath });
      expect(limit).toBe(2);
    });

    it('returns 1 when lane not found in config', () => {
      writeFileSync(
        configPath,
        `version: '2.0'
lanes:
  - name: 'Core'
    wip_limit: 3
`,
      );

      const limit = getWipLimitForLane('UnknownLane', { configPath });
      expect(limit).toBe(1);
    });
  });

  describe('checkLaneFree with configurable WIP limits', () => {
    it('allows claiming when WU count is below wip_limit', () => {
      // Create config with wip_limit: 2
      writeFileSync(
        configPath,
        `version: '2.0'
lanes:
  - name: 'Core'
    wip_limit: 2
    code_paths:
      - 'packages/@lumenflow/core/**'
`,
      );

      // Create status.md with 1 WU in progress
      writeFileSync(
        statusPath,
        `# Status

## In Progress

- [WU-100 — Existing WU](wu/WU-100.yaml)

## Blocked

## Completed
`,
      );

      // Create WU YAML for the existing WU
      writeFileSync(
        join(wuDir, 'WU-100.yaml'),
        `id: WU-100
title: Existing WU
lane: Core
status: in_progress
`,
      );

      // With wip_limit=2, lane should be free for WU-200 (1 existing < 2 limit)
      const result = checkLaneFree(statusPath, 'Core', 'WU-200', { configPath });
      expect(result.free).toBe(true);
      expect(result.occupiedBy).toBeNull();
    });

    it('blocks claiming when WU count equals wip_limit', () => {
      // Create config with wip_limit: 2
      writeFileSync(
        configPath,
        `version: '2.0'
lanes:
  - name: 'Core'
    wip_limit: 2
    code_paths:
      - 'packages/@lumenflow/core/**'
`,
      );

      // Create status.md with 2 WUs in progress
      writeFileSync(
        statusPath,
        `# Status

## In Progress

- [WU-100 — First WU](wu/WU-100.yaml)
- [WU-101 — Second WU](wu/WU-101.yaml)

## Blocked

## Completed
`,
      );

      // Create WU YAMLs for existing WUs
      writeFileSync(
        join(wuDir, 'WU-100.yaml'),
        `id: WU-100
title: First WU
lane: Core
status: in_progress
`,
      );
      writeFileSync(
        join(wuDir, 'WU-101.yaml'),
        `id: WU-101
title: Second WU
lane: Core
status: in_progress
`,
      );

      // With wip_limit=2, lane should NOT be free (2 existing == 2 limit)
      const result = checkLaneFree(statusPath, 'Core', 'WU-200', { configPath });
      expect(result.free).toBe(false);
      expect(result.occupiedBy).toBe('WU-100'); // Returns first occupying WU
    });

    it('defaults to wip_limit=1 when not specified in config', () => {
      // Create config without wip_limit
      writeFileSync(
        configPath,
        `version: '2.0'
lanes:
  - name: 'Core'
    code_paths:
      - 'packages/@lumenflow/core/**'
`,
      );

      // Create status.md with 1 WU in progress
      writeFileSync(
        statusPath,
        `# Status

## In Progress

- [WU-100 — Existing WU](wu/WU-100.yaml)

## Blocked

## Completed
`,
      );

      // Create WU YAML
      writeFileSync(
        join(wuDir, 'WU-100.yaml'),
        `id: WU-100
title: Existing WU
lane: Core
status: in_progress
`,
      );

      // With default wip_limit=1, lane should NOT be free (1 existing == 1 limit)
      const result = checkLaneFree(statusPath, 'Core', 'WU-200', { configPath });
      expect(result.free).toBe(false);
      expect(result.occupiedBy).toBe('WU-100');
    });

    it('counts only WUs in the same lane', () => {
      // Create config with wip_limit: 1 for both lanes
      writeFileSync(
        configPath,
        `version: '2.0'
lanes:
  - name: 'Core'
    wip_limit: 1
  - name: 'CLI'
    wip_limit: 1
`,
      );

      // Create status.md with WUs in different lanes
      writeFileSync(
        statusPath,
        `# Status

## In Progress

- [WU-100 — Core WU](wu/WU-100.yaml)
- [WU-101 — CLI WU](wu/WU-101.yaml)

## Blocked

## Completed
`,
      );

      // Create WU YAMLs in different lanes
      writeFileSync(
        join(wuDir, 'WU-100.yaml'),
        `id: WU-100
title: Core WU
lane: Core
status: in_progress
`,
      );
      writeFileSync(
        join(wuDir, 'WU-101.yaml'),
        `id: WU-101
title: CLI WU
lane: CLI
status: in_progress
`,
      );

      // Core lane has 1 WU (at limit), should be blocked
      const coreResult = checkLaneFree(statusPath, 'Core', 'WU-200', { configPath });
      expect(coreResult.free).toBe(false);

      // CLI lane also has 1 WU (at limit), should be blocked
      const cliResult = checkLaneFree(statusPath, 'CLI', 'WU-201', { configPath });
      expect(cliResult.free).toBe(false);
    });

    it('returns free when no WUs in progress', () => {
      writeFileSync(
        configPath,
        `version: '2.0'
lanes:
  - name: 'Core'
    wip_limit: 1
`,
      );

      writeFileSync(
        statusPath,
        `# Status

## In Progress

No items currently in progress

## Blocked

## Completed
`,
      );

      const result = checkLaneFree(statusPath, 'Core', 'WU-100', { configPath });
      expect(result.free).toBe(true);
    });

    it('returns the list of occupying WU IDs in result', () => {
      writeFileSync(
        configPath,
        `version: '2.0'
lanes:
  - name: 'Core'
    wip_limit: 2
`,
      );

      writeFileSync(
        statusPath,
        `# Status

## In Progress

- [WU-100 — First WU](wu/WU-100.yaml)
- [WU-101 — Second WU](wu/WU-101.yaml)

## Blocked

## Completed
`,
      );

      writeFileSync(
        join(wuDir, 'WU-100.yaml'),
        `id: WU-100
title: First WU
lane: Core
status: in_progress
`,
      );
      writeFileSync(
        join(wuDir, 'WU-101.yaml'),
        `id: WU-101
title: Second WU
lane: Core
status: in_progress
`,
      );

      const result = checkLaneFree(statusPath, 'Core', 'WU-200', { configPath });
      expect(result.free).toBe(false);
      expect(result.inProgressWUs).toContain('WU-100');
      expect(result.inProgressWUs).toContain('WU-101');
      expect(result.wipLimit).toBe(2);
      expect(result.currentCount).toBe(2);
    });
  });
});
