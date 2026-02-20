// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU List Helper Tests (WU-1411)
 *
 * Tests for the listWUs helper that merges WUStateStore with YAML metadata.
 *
 * IMPORTANT: These tests use isolated filesystem mocks via vi.doMock.
 * This prevents affecting other test files that use the real filesystem.
 *
 * @see {@link ../wu-list.ts} - Implementation
 * @see {@link ../wu-state-store.ts} - State store for runtime status
 * @see {@link ../wu-yaml.ts} - YAML operations
 */

import { describe, it, expect, beforeEach, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { vol, fs as memfs } from 'memfs';

// Store original modules for restoration
let listWUs: typeof import('../wu-list.js').listWUs;

beforeAll(async () => {
  // Mock filesystem modules before importing wu-list
  vi.doMock('node:fs', () => ({
    ...memfs,
    default: memfs,
  }));
  vi.doMock('node:fs/promises', () => ({
    ...memfs.promises,
    default: memfs.promises,
  }));

  // Dynamically import after mocking
  const wuListModule = await import('../wu-list.js');
  listWUs = wuListModule.listWUs;
});

afterAll(() => {
  // Restore original modules
  vi.doUnmock('node:fs');
  vi.doUnmock('node:fs/promises');
  vi.resetModules();
});

// Types for test assertions
type WUListEntry = Awaited<ReturnType<typeof listWUs>>[number];
type ListWUsOptions = Parameters<typeof listWUs>[0];

describe('listWUs', () => {
  const testProjectRoot = '/test-project';
  const wuDir = `${testProjectRoot}/docs/04-operations/tasks/wu`;
  const stateDir = `${testProjectRoot}/.lumenflow/state`;

  beforeEach(() => {
    // Reset virtual filesystem
    vol.reset();

    // Create directory structure
    vol.mkdirSync(wuDir, { recursive: true });
    vol.mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('basic listing', () => {
    it('returns empty array when no WUs exist', async () => {
      const result = await listWUs({ wuDir, stateDir });

      expect(result).toEqual([]);
    });

    it('returns WUs from YAML files with merged state store status', async () => {
      // Create WU YAML file
      vol.writeFileSync(
        `${wuDir}/WU-100.yaml`,
        `
id: WU-100
title: Test WU
lane: 'Framework: Core'
type: feature
status: ready
priority: P2
created: 2026-01-01
description: A test WU for listing functionality that has enough characters to pass validation.
acceptance:
  - Test criterion
code_paths:
  - packages/@lumenflow/core/src/test.ts
`,
      );

      // Create state store with claim event (overrides YAML status)
      vol.writeFileSync(
        `${stateDir}/wu-events.jsonl`,
        JSON.stringify({
          type: 'claim',
          wuId: 'WU-100',
          lane: 'Framework: Core',
          title: 'Test WU',
          timestamp: '2026-01-15T10:00:00Z',
        }) + '\n',
      );

      const result = await listWUs({ wuDir, stateDir });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'WU-100',
        title: 'Test WU',
        lane: 'Framework: Core',
        status: 'in_progress', // From state store, not YAML
      });
    });

    it('uses YAML status when WU is not in state store', async () => {
      // Create WU YAML file with status=ready
      vol.writeFileSync(
        `${wuDir}/WU-200.yaml`,
        `
id: WU-200
title: Ready WU
lane: 'Content: Documentation'
type: documentation
status: ready
priority: P3
created: 2026-01-02
description: A documentation WU that is ready to be claimed with enough chars for validation.
acceptance:
  - Document feature
`,
      );

      // Empty state store (no events for this WU)
      vol.writeFileSync(`${stateDir}/wu-events.jsonl`, '');

      const result = await listWUs({ wuDir, stateDir });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'WU-200',
        title: 'Ready WU',
        lane: 'Content: Documentation',
        status: 'ready', // From YAML
      });
    });
  });

  describe('filtering', () => {
    beforeEach(() => {
      // Create multiple WU YAML files
      vol.writeFileSync(
        `${wuDir}/WU-300.yaml`,
        `
id: WU-300
title: In Progress WU
lane: 'Framework: Core'
type: feature
status: in_progress
priority: P2
created: 2026-01-03
description: A WU that is currently in progress with sufficient description length for validation.
acceptance:
  - Implement feature
code_paths:
  - packages/@lumenflow/core/src/feature.ts
`,
      );

      vol.writeFileSync(
        `${wuDir}/WU-301.yaml`,
        `
id: WU-301
title: Blocked WU
lane: 'Framework: CLI'
type: bug
status: blocked
priority: P1
created: 2026-01-04
description: A WU that is blocked waiting for dependencies with enough characters for validation.
acceptance:
  - Fix bug
code_paths:
  - packages/@lumenflow/cli/src/fix.ts
`,
      );

      vol.writeFileSync(
        `${wuDir}/WU-302.yaml`,
        `
id: WU-302
title: Done WU
lane: 'Framework: Core'
type: chore
status: done
priority: P3
created: 2026-01-05
description: A completed WU that passed all gates and was merged with enough description chars.
acceptance:
  - Complete task
`,
      );

      // State store with events
      vol.writeFileSync(
        `${stateDir}/wu-events.jsonl`,
        [
          JSON.stringify({
            type: 'claim',
            wuId: 'WU-300',
            lane: 'Framework: Core',
            title: 'In Progress WU',
            timestamp: '2026-01-10T10:00:00Z',
          }),
          JSON.stringify({
            type: 'claim',
            wuId: 'WU-301',
            lane: 'Framework: CLI',
            title: 'Blocked WU',
            timestamp: '2026-01-10T11:00:00Z',
          }),
          JSON.stringify({
            type: 'block',
            wuId: 'WU-301',
            reason: 'Waiting for WU-300',
            timestamp: '2026-01-10T12:00:00Z',
          }),
          JSON.stringify({
            type: 'claim',
            wuId: 'WU-302',
            lane: 'Framework: Core',
            title: 'Done WU',
            timestamp: '2026-01-05T10:00:00Z',
          }),
          JSON.stringify({
            type: 'complete',
            wuId: 'WU-302',
            timestamp: '2026-01-06T10:00:00Z',
          }),
        ].join('\n') + '\n',
      );
    });

    it('filters by status', async () => {
      const result = await listWUs({
        wuDir,
        stateDir,
        status: 'in_progress',
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('WU-300');
      expect(result[0].status).toBe('in_progress');
    });

    it('filters by lane', async () => {
      const result = await listWUs({
        wuDir,
        stateDir,
        lane: 'Framework: Core',
      });

      expect(result).toHaveLength(2);
      const ids = result.map((wu) => wu.id);
      expect(ids).toContain('WU-300');
      expect(ids).toContain('WU-302');
    });

    it('filters by both status and lane', async () => {
      const result = await listWUs({
        wuDir,
        stateDir,
        status: 'done',
        lane: 'Framework: Core',
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('WU-302');
    });

    it('returns empty array when no WUs match filters', async () => {
      const result = await listWUs({
        wuDir,
        stateDir,
        status: 'in_progress',
        lane: 'Content: Documentation',
      });

      expect(result).toEqual([]);
    });
  });

  describe('WUListEntry type', () => {
    it('includes all required fields', async () => {
      vol.writeFileSync(
        `${wuDir}/WU-400.yaml`,
        `
id: WU-400
title: Complete WU Entry
lane: 'Operations: Infrastructure'
type: feature
status: ready
priority: P1
created: 2026-02-01
description: A WU with all fields populated to test the complete entry structure for validation.
acceptance:
  - All fields present
code_paths:
  - apps/github-app/src/test.ts
`,
      );

      const result = await listWUs({ wuDir, stateDir });

      expect(result).toHaveLength(1);
      const wu = result[0];

      // Required fields from WUListEntry
      expect(wu).toHaveProperty('id');
      expect(wu).toHaveProperty('title');
      expect(wu).toHaveProperty('lane');
      expect(wu).toHaveProperty('status');
      expect(wu).toHaveProperty('type');
      expect(wu).toHaveProperty('priority');

      // Verify types
      expect(typeof wu.id).toBe('string');
      expect(typeof wu.title).toBe('string');
      expect(typeof wu.lane).toBe('string');
      expect(typeof wu.status).toBe('string');
      expect(typeof wu.type).toBe('string');
      expect(typeof wu.priority).toBe('string');
    });

    it('includes optional fields when present in YAML', async () => {
      vol.writeFileSync(
        `${wuDir}/WU-401.yaml`,
        `
id: WU-401
title: WU with Initiative
lane: 'Framework: Core'
type: feature
status: ready
priority: P2
created: 2026-02-02
initiative: INIT-001
phase: 1
description: A WU linked to an initiative with phase information that is long enough for validation.
acceptance:
  - Linked to initiative
code_paths:
  - packages/@lumenflow/core/src/init.ts
`,
      );

      const result = await listWUs({ wuDir, stateDir });

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('initiative', 'INIT-001');
      expect(result[0]).toHaveProperty('phase', 1);
    });
  });

  describe('error handling', () => {
    it('handles missing WU directory gracefully', async () => {
      // Remove the WU directory
      vol.rmdirSync(wuDir);

      const result = await listWUs({ wuDir, stateDir });

      expect(result).toEqual([]);
    });

    it('skips invalid YAML files', async () => {
      // Create valid WU
      vol.writeFileSync(
        `${wuDir}/WU-500.yaml`,
        `
id: WU-500
title: Valid WU
lane: 'Framework: Core'
type: feature
status: ready
priority: P2
created: 2026-02-03
description: A valid WU that should be listed even when other files have invalid YAML content.
acceptance:
  - Should be listed
code_paths:
  - packages/@lumenflow/core/src/valid.ts
`,
      );

      // Create invalid YAML file
      vol.writeFileSync(`${wuDir}/WU-501.yaml`, 'invalid: yaml: content: [broken');

      const result = await listWUs({ wuDir, stateDir });

      // Should only return the valid WU
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('WU-500');
    });

    it('handles state store load failures gracefully', async () => {
      // Create WU YAML
      vol.writeFileSync(
        `${wuDir}/WU-600.yaml`,
        `
id: WU-600
title: WU with Corrupted State
lane: 'Framework: Core'
type: feature
status: ready
priority: P2
created: 2026-02-04
description: A WU that exists in YAML but the state store is corrupted and cannot be loaded.
acceptance:
  - Falls back to YAML status
code_paths:
  - packages/@lumenflow/core/src/fallback.ts
`,
      );

      // Create corrupted state file
      vol.writeFileSync(`${stateDir}/wu-events.jsonl`, 'not valid json\n');

      // Should fall back to YAML status
      const result = await listWUs({ wuDir, stateDir });

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('ready'); // From YAML
    });
  });
});
