/**
 * State Bootstrap Tests (WU-2539)
 *
 * Tests for bootstrapping event-sourced state from WU YAML files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap, type BootstrapResult } from '../../src/state/state-bootstrap.js';

describe('State Bootstrap', () => {
  let tempDir: string;
  let wuDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'state-bootstrap-test-'));
    wuDir = join(tempDir, 'docs/04-operations/tasks/wu');
    stateDir = join(tempDir, '._legacy/state');
    await mkdir(wuDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const createWuYaml = async (
    id: string,
    status: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> => {
    const content = `id: ${id}
title: Test WU ${id}
lane: Operations: Tooling
status: ${status}
${Object.entries(extra)
  .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
  .join('\n')}
`;
    await writeFile(join(wuDir, `${id}.yaml`), content, 'utf-8');
  };

  describe('bootstrap', () => {
    it('returns warning when store already populated', async () => {
      // Pre-populate state file
      const existingEvent = JSON.stringify({
        type: 'claim',
        wuId: 'WU-100',
        lane: 'Operations',
        title: 'Existing',
        timestamp: '2025-01-01T00:00:00.000Z',
      });
      await writeFile(join(stateDir, 'wu-events.jsonl'), existingEvent + '\n', 'utf-8');

      const result = await bootstrap(tempDir, { dryRun: false });

      expect(result.warning).toContain('already populated');
    });

    it('skips unclaimed WUs (ready status)', async () => {
      await createWuYaml('WU-100', 'ready');

      const result = await bootstrap(tempDir, { dryRun: true });

      expect(result.eventCount).toBe(0);
    });

    it('emits claim event for in_progress WUs', async () => {
      await createWuYaml('WU-100', 'in_progress', {
        claimed_at: '2025-01-15T10:00:00.000Z',
      });

      const result = await bootstrap(tempDir, { dryRun: true });

      expect(result.eventCount).toBe(1);
    });

    it('emits claim + block events for blocked WUs', async () => {
      await createWuYaml('WU-100', 'blocked', {
        claimed_at: '2025-01-15T10:00:00.000Z',
      });

      const result = await bootstrap(tempDir, { dryRun: true });

      expect(result.eventCount).toBe(2); // claim + block
    });

    it('emits claim + complete events for done WUs', async () => {
      await createWuYaml('WU-100', 'done', {
        claimed_at: '2025-01-15T10:00:00.000Z',
        completed_at: '2025-01-15T12:00:00.000Z',
      });

      const result = await bootstrap(tempDir, { dryRun: true });

      expect(result.eventCount).toBe(2); // claim + complete
    });

    it('emits events for cancelled WUs (terminal status)', async () => {
      await createWuYaml('WU-100', 'cancelled', {
        claimed_at: '2025-01-15T10:00:00.000Z',
      });

      const result = await bootstrap(tempDir, { dryRun: true });

      expect(result.eventCount).toBe(2); // claim + complete (terminal)
    });

    it('skips template files', async () => {
      await writeFile(join(wuDir, 'TEMPLATE.yaml'), 'id: TEMPLATE\nstatus: ready\n', 'utf-8');
      await createWuYaml('WU-100', 'in_progress');

      const result = await bootstrap(tempDir, { dryRun: true });

      expect(result.eventCount).toBe(1); // Only WU-100
    });

    it('skips malformed YAML files', async () => {
      await writeFile(join(wuDir, 'WU-BROKEN.yaml'), 'this: is: not: valid: yaml', 'utf-8');
      await createWuYaml('WU-100', 'in_progress');

      const result = await bootstrap(tempDir, { dryRun: true });

      expect(result.skipped).toBeGreaterThan(0);
      expect(result.eventCount).toBe(1);
    });

    it('writes events to file in non-dry-run mode', async () => {
      await createWuYaml('WU-100', 'in_progress', {
        claimed_at: '2025-01-15T10:00:00.000Z',
      });

      const result = await bootstrap(tempDir, { dryRun: false });

      expect(result.dryRun).toBeFalsy();
      expect(result.eventCount).toBe(1);

      // Verify file was written
      const content = await readFile(join(stateDir, 'wu-events.jsonl'), 'utf-8');
      expect(content).toContain('WU-100');
      expect(content).toContain('claim');
    });

    it('does not write events in dry-run mode', async () => {
      await createWuYaml('WU-100', 'in_progress');

      const result = await bootstrap(tempDir, { dryRun: true });

      expect(result.dryRun).toBe(true);

      // Verify file was NOT written
      await expect(readFile(join(stateDir, 'wu-events.jsonl'), 'utf-8')).rejects.toThrow();
    });

    it('handles multiple WUs', async () => {
      await createWuYaml('WU-100', 'in_progress');
      await createWuYaml('WU-101', 'done');
      await createWuYaml('WU-102', 'ready');
      await createWuYaml('WU-103', 'blocked');

      const result = await bootstrap(tempDir, { dryRun: true });

      // WU-100: 1 event (claim)
      // WU-101: 2 events (claim + complete)
      // WU-102: 0 events (ready/unclaimed)
      // WU-103: 2 events (claim + block)
      expect(result.eventCount).toBe(5);
    });
  });
});
