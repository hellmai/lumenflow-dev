#!/usr/bin/env node
/**
 * @file state-bootstrap.test.ts
 * @description Tests for state-bootstrap CLI command (WU-1107)
 *
 * state-bootstrap is a one-time migration utility that:
 * - Reads all WU YAML files
 * - Generates corresponding events in the state store
 * - Allows migration from YAML-only repos to event-sourced state
 *
 * TDD: RED phase - these tests define expected behavior before implementation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// These imports will fail until we implement the module (RED phase)
// We define the expected exports here
import {
  parseStateBootstrapArgs,
  inferEventsFromWu,
  generateBootstrapEvents,
  runStateBootstrap,
  STATE_BOOTSTRAP_DEFAULTS,
  type StateBootstrapArgs,
  type WuBootstrapInfo,
  type BootstrapEvent,
  type BootstrapResult,
} from '../state-bootstrap.js';

describe('state-bootstrap CLI', () => {
  describe('source file existence', () => {
    it('should have the CLI source file', () => {
      const srcPath = join(__dirname, '../state-bootstrap.ts');
      expect(existsSync(srcPath)).toBe(true);
    });

    it('should be buildable (dist file exists after build)', () => {
      // This test verifies that tsc compiled the file successfully
      const distPath = join(__dirname, '../../dist/state-bootstrap.js');
      expect(existsSync(distPath)).toBe(true);
    });
  });

  describe('STATE_BOOTSTRAP_DEFAULTS', () => {
    it('should have default WU directory path', () => {
      expect(STATE_BOOTSTRAP_DEFAULTS.wuDir).toBeTypeOf('string');
    });

    it('should have default state directory path', () => {
      expect(STATE_BOOTSTRAP_DEFAULTS.stateDir).toBeTypeOf('string');
    });
  });

  describe('parseStateBootstrapArgs', () => {
    it('should parse --dry-run flag (default)', () => {
      const args = parseStateBootstrapArgs(['node', 'state-bootstrap']);
      expect(args.dryRun).toBe(true);
    });

    it('should parse --execute flag', () => {
      const args = parseStateBootstrapArgs(['node', 'state-bootstrap', '--execute']);
      expect(args.dryRun).toBe(false);
    });

    it('should parse --wu-dir option', () => {
      const args = parseStateBootstrapArgs([
        'node',
        'state-bootstrap',
        '--wu-dir',
        '/custom/wu/path',
      ]);
      expect(args.wuDir).toBe('/custom/wu/path');
    });

    it('should parse --state-dir option', () => {
      const args = parseStateBootstrapArgs([
        'node',
        'state-bootstrap',
        '--state-dir',
        '/custom/state/path',
      ]);
      expect(args.stateDir).toBe('/custom/state/path');
    });

    it('should parse --help flag', () => {
      const args = parseStateBootstrapArgs(['node', 'state-bootstrap', '--help']);
      expect(args.help).toBe(true);
    });

    it('should parse -h flag as help', () => {
      const args = parseStateBootstrapArgs(['node', 'state-bootstrap', '-h']);
      expect(args.help).toBe(true);
    });

    it('should parse --force flag to overwrite existing state', () => {
      const args = parseStateBootstrapArgs(['node', 'state-bootstrap', '--force']);
      expect(args.force).toBe(true);
    });
  });

  describe('inferEventsFromWu', () => {
    it('should generate claim event for in_progress WU', () => {
      const wu: WuBootstrapInfo = {
        id: 'WU-100',
        status: 'in_progress',
        lane: 'Framework: CLI',
        title: 'Test WU',
        created: '2026-01-20',
        claimed_at: '2026-01-20T10:00:00Z',
      };

      const events = inferEventsFromWu(wu);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('claim');
      expect(events[0].wuId).toBe('WU-100');
      expect(events[0].lane).toBe('Framework: CLI');
      expect(events[0].title).toBe('Test WU');
    });

    it('should generate claim and complete events for done WU', () => {
      const wu: WuBootstrapInfo = {
        id: 'WU-100',
        status: 'done',
        lane: 'Framework: CLI',
        title: 'Test WU',
        created: '2026-01-15',
        claimed_at: '2026-01-15T10:00:00Z',
        completed_at: '2026-01-20T15:00:00Z',
      };

      const events = inferEventsFromWu(wu);
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('claim');
      expect(events[1].type).toBe('complete');
      expect(events[1].wuId).toBe('WU-100');
    });

    it('should generate claim and block events for blocked WU', () => {
      const wu: WuBootstrapInfo = {
        id: 'WU-100',
        status: 'blocked',
        lane: 'Framework: CLI',
        title: 'Test WU',
        created: '2026-01-15',
        claimed_at: '2026-01-15T10:00:00Z',
      };

      const events = inferEventsFromWu(wu);
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('claim');
      expect(events[1].type).toBe('block');
    });

    it('should return empty array for ready WU (not yet claimed)', () => {
      const wu: WuBootstrapInfo = {
        id: 'WU-100',
        status: 'ready',
        lane: 'Framework: CLI',
        title: 'Test WU',
        created: '2026-01-20',
      };

      const events = inferEventsFromWu(wu);
      expect(events).toHaveLength(0);
    });

    it('should use created date as fallback for claim timestamp', () => {
      const wu: WuBootstrapInfo = {
        id: 'WU-100',
        status: 'in_progress',
        lane: 'Framework: CLI',
        title: 'Test WU',
        created: '2026-01-20',
        // No claimed_at
      };

      const events = inferEventsFromWu(wu);
      expect(events).toHaveLength(1);
      expect(events[0].timestamp).toContain('2026-01-20');
    });

    it('should handle legacy completed status same as done', () => {
      const wu: WuBootstrapInfo = {
        id: 'WU-100',
        status: 'completed',
        lane: 'Framework: CLI',
        title: 'Test WU',
        created: '2026-01-15',
        claimed_at: '2026-01-15T10:00:00Z',
        completed_at: '2026-01-20T15:00:00Z',
      };

      const events = inferEventsFromWu(wu);
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('claim');
      expect(events[1].type).toBe('complete');
    });
  });

  describe('generateBootstrapEvents', () => {
    it('should generate events for multiple WUs', () => {
      const wus: WuBootstrapInfo[] = [
        {
          id: 'WU-100',
          status: 'in_progress',
          lane: 'Framework: CLI',
          title: 'WU 100',
          created: '2026-01-20',
        },
        {
          id: 'WU-101',
          status: 'done',
          lane: 'Framework: Core',
          title: 'WU 101',
          created: '2026-01-15',
          completed_at: '2026-01-18T10:00:00Z',
        },
        {
          id: 'WU-102',
          status: 'ready',
          lane: 'Framework: CLI',
          title: 'WU 102',
          created: '2026-01-22',
        },
      ];

      const events = generateBootstrapEvents(wus);
      // WU-100: 1 claim, WU-101: 1 claim + 1 complete, WU-102: 0 (ready)
      expect(events).toHaveLength(3);
    });

    it('should order events chronologically', () => {
      const wus: WuBootstrapInfo[] = [
        {
          id: 'WU-102',
          status: 'done',
          lane: 'Framework: CLI',
          title: 'WU 102',
          created: '2026-01-20',
          claimed_at: '2026-01-20T10:00:00Z',
          completed_at: '2026-01-22T10:00:00Z',
        },
        {
          id: 'WU-100',
          status: 'done',
          lane: 'Framework: Core',
          title: 'WU 100',
          created: '2026-01-15',
          claimed_at: '2026-01-15T08:00:00Z',
          completed_at: '2026-01-16T10:00:00Z',
        },
      ];

      const events = generateBootstrapEvents(wus);
      // Events should be ordered: WU-100 claim, WU-100 complete, WU-102 claim, WU-102 complete
      expect(events[0].wuId).toBe('WU-100');
      expect(events[0].type).toBe('claim');
      expect(events[1].wuId).toBe('WU-100');
      expect(events[1].type).toBe('complete');
      expect(events[2].wuId).toBe('WU-102');
      expect(events[2].type).toBe('claim');
    });

    it('should return empty array for empty WU list', () => {
      const events = generateBootstrapEvents([]);
      expect(events).toHaveLength(0);
    });
  });

  describe('runStateBootstrap', () => {
    let tempDir: string;

    beforeEach(() => {
      // Create a temporary directory for test fixtures
      tempDir = join(tmpdir(), `state-bootstrap-test-${Date.now()}`);
      mkdirSync(join(tempDir, 'wu'), { recursive: true });
      mkdirSync(join(tempDir, 'state'), { recursive: true });
    });

    afterEach(() => {
      // Cleanup temp directory
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('should not write events in dry-run mode', async () => {
      // Create a test WU YAML (lane value must be quoted due to colon)
      const wuYaml = `id: WU-100
title: Test WU
lane: "Framework: CLI"
status: in_progress
created: 2026-01-20
`;
      writeFileSync(join(tempDir, 'wu', 'WU-100.yaml'), wuYaml);

      const result = await runStateBootstrap({
        dryRun: true,
        wuDir: join(tempDir, 'wu'),
        stateDir: join(tempDir, 'state'),
        force: false,
        help: false,
      });

      expect(result.success).toBe(true);
      expect(result.eventsGenerated).toBe(1);
      expect(result.eventsWritten).toBe(0);
      expect(existsSync(join(tempDir, 'state', 'wu-events.jsonl'))).toBe(false);
    });

    it('should write events in execute mode', async () => {
      // Create a test WU YAML (lane value must be quoted due to colon)
      const wuYaml = `id: WU-100
title: Test WU
lane: "Framework: CLI"
status: in_progress
created: 2026-01-20
`;
      writeFileSync(join(tempDir, 'wu', 'WU-100.yaml'), wuYaml);

      const result = await runStateBootstrap({
        dryRun: false,
        wuDir: join(tempDir, 'wu'),
        stateDir: join(tempDir, 'state'),
        force: false,
        help: false,
      });

      expect(result.success).toBe(true);
      expect(result.eventsGenerated).toBe(1);
      expect(result.eventsWritten).toBe(1);
      expect(existsSync(join(tempDir, 'state', 'wu-events.jsonl'))).toBe(true);
    });

    it('should fail if state file already exists without --force', async () => {
      // Create existing state file
      writeFileSync(join(tempDir, 'state', 'wu-events.jsonl'), '{"existing":"data"}\n');

      // Create a test WU YAML (lane value must be quoted due to colon)
      const wuYaml = `id: WU-100
title: Test WU
lane: "Framework: CLI"
status: in_progress
created: 2026-01-20
`;
      writeFileSync(join(tempDir, 'wu', 'WU-100.yaml'), wuYaml);

      const result = await runStateBootstrap({
        dryRun: false,
        wuDir: join(tempDir, 'wu'),
        stateDir: join(tempDir, 'state'),
        force: false,
        help: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('exists');
    });

    it('should overwrite state file with --force', async () => {
      // Create existing state file
      writeFileSync(join(tempDir, 'state', 'wu-events.jsonl'), '{"existing":"data"}\n');

      // Create a test WU YAML (lane value must be quoted due to colon)
      const wuYaml = `id: WU-100
title: Test WU
lane: "Framework: CLI"
status: in_progress
created: 2026-01-20
`;
      writeFileSync(join(tempDir, 'wu', 'WU-100.yaml'), wuYaml);

      const result = await runStateBootstrap({
        dryRun: false,
        wuDir: join(tempDir, 'wu'),
        stateDir: join(tempDir, 'state'),
        force: true,
        help: false,
      });

      expect(result.success).toBe(true);
      expect(result.eventsWritten).toBe(1);
    });

    it('should handle missing WU directory gracefully', async () => {
      const result = await runStateBootstrap({
        dryRun: true,
        wuDir: join(tempDir, 'nonexistent'),
        stateDir: join(tempDir, 'state'),
        force: false,
        help: false,
      });

      expect(result.success).toBe(true);
      expect(result.eventsGenerated).toBe(0);
      expect(result.warnings).toContain('WU directory not found');
    });

    it('should skip invalid YAML files', async () => {
      // Create valid WU YAML (lane value must be quoted due to colon)
      const validWuYaml = `id: WU-100
title: Valid WU
lane: "Framework: CLI"
status: in_progress
created: 2026-01-20
`;
      writeFileSync(join(tempDir, 'wu', 'WU-100.yaml'), validWuYaml);

      // Create invalid YAML file
      writeFileSync(join(tempDir, 'wu', 'WU-101.yaml'), 'invalid: yaml: content:');

      const result = await runStateBootstrap({
        dryRun: false,
        wuDir: join(tempDir, 'wu'),
        stateDir: join(tempDir, 'state'),
        force: false,
        help: false,
      });

      expect(result.success).toBe(true);
      expect(result.eventsGenerated).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('should process multiple valid WU files', async () => {
      // Create multiple valid WU YAMLs (lane value must be quoted due to colon)
      for (let i = 100; i <= 105; i++) {
        const wuYaml = `id: WU-${i}
title: Test WU ${i}
lane: "Framework: CLI"
status: ${i <= 102 ? 'done' : 'in_progress'}
created: 2026-01-${10 + i - 100}
${i <= 102 ? `completed_at: 2026-01-${15 + i - 100}T10:00:00Z` : ''}
`;
        writeFileSync(join(tempDir, 'wu', `WU-${i}.yaml`), wuYaml);
      }

      const result = await runStateBootstrap({
        dryRun: false,
        wuDir: join(tempDir, 'wu'),
        stateDir: join(tempDir, 'state'),
        force: false,
        help: false,
      });

      expect(result.success).toBe(true);
      // 3 done WUs = 3 claim + 3 complete = 6 events
      // 3 in_progress WUs = 3 claim = 3 events
      // Total = 9 events
      expect(result.eventsGenerated).toBe(9);
      expect(result.eventsWritten).toBe(9);
    });
  });

  describe('integration: written events are valid', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = join(tmpdir(), `state-bootstrap-integration-${Date.now()}`);
      mkdirSync(join(tempDir, 'wu'), { recursive: true });
      mkdirSync(join(tempDir, 'state'), { recursive: true });
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('should write events that can be loaded by WUStateStore', async () => {
      // lane value must be quoted due to colon
      const wuYaml = `id: WU-100
title: Test WU
lane: "Framework: CLI"
status: done
created: 2026-01-15
claimed_at: 2026-01-15T10:00:00Z
completed_at: 2026-01-20T15:00:00Z
`;
      writeFileSync(join(tempDir, 'wu', 'WU-100.yaml'), wuYaml);

      await runStateBootstrap({
        dryRun: false,
        wuDir: join(tempDir, 'wu'),
        stateDir: join(tempDir, 'state'),
        force: false,
        help: false,
      });

      // Read the generated file
      const content = readFileSync(join(tempDir, 'state', 'wu-events.jsonl'), 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(2); // claim + complete

      // Verify each line is valid JSON with required fields
      for (const line of lines) {
        const event = JSON.parse(line);
        expect(event).toHaveProperty('type');
        expect(event).toHaveProperty('wuId');
        expect(event).toHaveProperty('timestamp');
      }
    });
  });
});
