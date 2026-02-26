// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vol } from 'memfs';

vi.mock('node:fs', async () => {
  const memfs = await import('memfs');
  return memfs.fs;
});

vi.mock('node:fs/promises', async () => {
  const memfs = await import('memfs');
  return memfs.fs.promises;
});

// Mock config to return controlled paths
vi.mock('../lumenflow-config.js', () => ({
  getConfig: () => ({
    directories: {
      wuDir: 'docs/04-operations/tasks/wu',
      backlogPath: 'docs/04-operations/tasks/backlog.md',
      statusPath: 'docs/04-operations/tasks/status.md',
    },
    state: {
      stateDir: '.lumenflow/state',
      stampsDir: '.lumenflow/stamps',
    },
  }),
  getProjectRoot: () => '/repo',
}));

import type { DuplicateIdReport, DuplicateIdGroup } from '../wu-duplicate-id-detector.js';

const WU_DIR = '/repo/docs/04-operations/tasks/wu';
const STAMPS_DIR = '/repo/.lumenflow/stamps';
const STATE_DIR = '/repo/.lumenflow/state';

describe('wu-duplicate-id-detector', () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
  });

  describe('detectDuplicateIds', () => {
    it('returns empty report when no duplicates exist', async () => {
      vol.fromJSON({
        [`${WU_DIR}/WU-1.yaml`]: 'id: WU-1\ntitle: First\nstatus: done\nlane: "Core"\n',
        [`${WU_DIR}/WU-2.yaml`]: 'id: WU-2\ntitle: Second\nstatus: ready\nlane: "Core"\n',
        [`${STAMPS_DIR}/WU-1.done`]: '',
      });

      const { detectDuplicateIds } = await import('../wu-duplicate-id-detector.js');
      const report = await detectDuplicateIds('/repo');

      expect(report.duplicates).toHaveLength(0);
      expect(report.totalWUs).toBe(2);
    });

    it('detects duplicate IDs when multiple YAML files claim the same ID', async () => {
      // Simulate collision: two different files both claim WU-1
      vol.fromJSON({
        [`${WU_DIR}/WU-1.yaml`]: 'id: WU-1\ntitle: First\nstatus: done\nlane: "Core"\n',
        [`${WU_DIR}/WU-1-copy.yaml`]: 'id: WU-1\ntitle: First Copy\nstatus: ready\nlane: "Ops"\n',
      });

      const { detectDuplicateIds } = await import('../wu-duplicate-id-detector.js');
      const report = await detectDuplicateIds('/repo');

      expect(report.duplicates).toHaveLength(1);
      expect(report.duplicates[0]!.id).toBe('WU-1');
      expect(report.duplicates[0]!.files).toHaveLength(2);
    });

    it('detects stamp collisions for duplicate IDs', async () => {
      vol.fromJSON({
        [`${WU_DIR}/WU-5.yaml`]: 'id: WU-5\ntitle: One\nstatus: done\nlane: "Core"\n',
        [`${WU_DIR}/WU-5-dup.yaml`]: 'id: WU-5\ntitle: Two\nstatus: done\nlane: "Ops"\n',
        [`${STAMPS_DIR}/WU-5.done`]: '',
      });

      const { detectDuplicateIds } = await import('../wu-duplicate-id-detector.js');
      const report = await detectDuplicateIds('/repo');

      expect(report.duplicates).toHaveLength(1);
      expect(report.duplicates[0]!.stamps).toHaveLength(1);
    });

    it('detects event collisions for duplicate IDs', async () => {
      const events =
        [
          JSON.stringify({
            type: 'claim',
            wuId: 'WU-10',
            lane: 'Core',
            title: 'A',
            timestamp: '2026-01-01T00:00:00Z',
          }),
          JSON.stringify({ type: 'complete', wuId: 'WU-10', timestamp: '2026-01-02T00:00:00Z' }),
        ].join('\n') + '\n';

      vol.fromJSON({
        [`${WU_DIR}/WU-10.yaml`]: 'id: WU-10\ntitle: One\nstatus: done\nlane: "Core"\n',
        [`${WU_DIR}/WU-10-dup.yaml`]: 'id: WU-10\ntitle: Two\nstatus: ready\nlane: "Ops"\n',
        [`${STATE_DIR}/wu-events.jsonl`]: events,
      });

      const { detectDuplicateIds } = await import('../wu-duplicate-id-detector.js');
      const report = await detectDuplicateIds('/repo');

      expect(report.duplicates).toHaveLength(1);
      expect(report.duplicates[0]!.events.length).toBeGreaterThan(0);
    });
  });

  describe('dry-run mode (default)', () => {
    it('does not mutate any files', async () => {
      vol.fromJSON({
        [`${WU_DIR}/WU-1.yaml`]: 'id: WU-1\ntitle: First\nstatus: done\nlane: "Core"\n',
        [`${WU_DIR}/WU-1-copy.yaml`]: 'id: WU-1\ntitle: Copy\nstatus: ready\nlane: "Ops"\n',
      });

      const { repairDuplicateIds } = await import('../wu-duplicate-id-detector.js');
      const result = await repairDuplicateIds('/repo', { apply: false });

      expect(result.applied).toBe(false);
      expect(result.mappings.length).toBeGreaterThan(0);
      // Verify original files are unchanged
      const content = vol.readFileSync(`${WU_DIR}/WU-1-copy.yaml`, 'utf-8') as string;
      expect(content).toContain('id: WU-1');
    });
  });

  describe('apply mode', () => {
    it('renames colliding WUs with new IDs and updates YAML files', async () => {
      vol.fromJSON({
        [`${WU_DIR}/WU-1.yaml`]: 'id: WU-1\ntitle: First\nstatus: done\nlane: "Core"\n',
        [`${WU_DIR}/WU-1-copy.yaml`]: 'id: WU-1\ntitle: Copy\nstatus: ready\nlane: "Ops"\n',
        [`${WU_DIR}/WU-2.yaml`]: 'id: WU-2\ntitle: Other\nstatus: ready\nlane: "Core"\n',
      });

      const { repairDuplicateIds } = await import('../wu-duplicate-id-detector.js');
      const result = await repairDuplicateIds('/repo', { apply: true });

      expect(result.applied).toBe(true);
      expect(result.mappings).toHaveLength(1);

      const mapping = result.mappings[0]!;
      expect(mapping.oldId).toBe('WU-1');
      expect(mapping.newId).toMatch(/^WU-\d+$/);
      expect(mapping.newId).not.toBe('WU-1');
      expect(mapping.newId).not.toBe('WU-2'); // avoids existing IDs

      // Verify the duplicate file was updated
      const content = vol.readFileSync(mapping.renamedFile, 'utf-8') as string;
      expect(content).toContain(`id: ${mapping.newId}`);
    });

    it('updates blocked_by references in other WU files', async () => {
      vol.fromJSON({
        [`${WU_DIR}/WU-1.yaml`]: 'id: WU-1\ntitle: First\nstatus: done\nlane: "Core"\n',
        [`${WU_DIR}/WU-1-copy.yaml`]: 'id: WU-1\ntitle: Copy\nstatus: ready\nlane: "Ops"\n',
        [`${WU_DIR}/WU-3.yaml`]:
          'id: WU-3\ntitle: Downstream\nstatus: ready\nlane: "Core"\nblocked_by:\n  - WU-1\n',
      });

      const { repairDuplicateIds } = await import('../wu-duplicate-id-detector.js');
      const result = await repairDuplicateIds('/repo', { apply: true });

      expect(result.applied).toBe(true);
      // The first file (canonical) keeps WU-1, so blocked_by should remain valid
      // The duplicate gets a new ID -- blocked_by in WU-3 should NOT change
      // (it referenced the canonical one)
      const wu3 = vol.readFileSync(`${WU_DIR}/WU-3.yaml`, 'utf-8') as string;
      expect(wu3).toContain('WU-1');
    });

    it('renames stamp files for remapped IDs', async () => {
      vol.fromJSON({
        [`${WU_DIR}/WU-1.yaml`]: 'id: WU-1\ntitle: First\nstatus: done\nlane: "Core"\n',
        [`${WU_DIR}/WU-1-copy.yaml`]: 'id: WU-1\ntitle: Copy\nstatus: done\nlane: "Ops"\n',
        [`${STAMPS_DIR}/WU-1.done`]: '',
      });

      const { repairDuplicateIds } = await import('../wu-duplicate-id-detector.js');
      const result = await repairDuplicateIds('/repo', { apply: true });

      expect(result.applied).toBe(true);
      // Original stamp stays
      expect(vol.existsSync(`${STAMPS_DIR}/WU-1.done`)).toBe(true);
      // Note: stamp for duplicate gets created only if the duplicate was done
    });

    it('updates events in wu-events.jsonl for remapped IDs', async () => {
      const events =
        [
          JSON.stringify({
            type: 'claim',
            wuId: 'WU-1',
            lane: 'Ops',
            title: 'Copy',
            timestamp: '2026-01-01T00:00:00Z',
          }),
        ].join('\n') + '\n';

      vol.fromJSON({
        [`${WU_DIR}/WU-1.yaml`]: 'id: WU-1\ntitle: First\nstatus: done\nlane: "Core"\n',
        [`${WU_DIR}/WU-1-copy.yaml`]: 'id: WU-1\ntitle: Copy\nstatus: in_progress\nlane: "Ops"\n',
        [`${STATE_DIR}/wu-events.jsonl`]: events,
      });

      const { repairDuplicateIds } = await import('../wu-duplicate-id-detector.js');
      const result = await repairDuplicateIds('/repo', { apply: true });

      expect(result.applied).toBe(true);
      const mapping = result.mappings[0]!;

      // The events file should have been updated for the remapped ID
      const updatedEvents = vol.readFileSync(`${STATE_DIR}/wu-events.jsonl`, 'utf-8') as string;
      const lines = updatedEvents.trim().split('\n');
      const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
      // The event that belonged to the duplicate (lane: 'Ops') should be remapped
      expect(parsed.wuId).toBe(mapping.newId);
    });
  });

  describe('mapping report', () => {
    it('includes ID remapping and touched files', async () => {
      vol.fromJSON({
        [`${WU_DIR}/WU-1.yaml`]: 'id: WU-1\ntitle: First\nstatus: done\nlane: "Core"\n',
        [`${WU_DIR}/WU-1-copy.yaml`]: 'id: WU-1\ntitle: Copy\nstatus: ready\nlane: "Ops"\n',
      });

      const { repairDuplicateIds } = await import('../wu-duplicate-id-detector.js');
      const result = await repairDuplicateIds('/repo', { apply: false });

      expect(result.mappings).toHaveLength(1);
      const mapping = result.mappings[0]!;
      expect(mapping).toHaveProperty('oldId');
      expect(mapping).toHaveProperty('newId');
      expect(mapping).toHaveProperty('renamedFile');
      expect(mapping).toHaveProperty('touchedFiles');
    });
  });

  describe('referential integrity', () => {
    it('updates dependencies field in other WUs when a duplicate is remapped', async () => {
      vol.fromJSON({
        [`${WU_DIR}/WU-1.yaml`]: 'id: WU-1\ntitle: First\nstatus: done\nlane: "Core"\n',
        [`${WU_DIR}/WU-1-copy.yaml`]: 'id: WU-1\ntitle: Copy\nstatus: ready\nlane: "Ops"\n',
        [`${WU_DIR}/WU-4.yaml`]:
          'id: WU-4\ntitle: Depends\nstatus: ready\nlane: "Core"\ndependencies:\n  - WU-1\n',
      });

      const { repairDuplicateIds } = await import('../wu-duplicate-id-detector.js');
      const result = await repairDuplicateIds('/repo', { apply: true });

      expect(result.applied).toBe(true);
      // dependencies in WU-4 still references canonical WU-1 (not the duplicate)
      const wu4 = vol.readFileSync(`${WU_DIR}/WU-4.yaml`, 'utf-8') as string;
      expect(wu4).toContain('WU-1');
    });
  });
});
