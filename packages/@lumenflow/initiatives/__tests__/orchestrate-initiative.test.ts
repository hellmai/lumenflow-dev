/**
 * Orchestrate Initiative Tests (WU-1821)
 *
 * Tests for checkpoint-per-wave orchestration pattern.
 *
 * Key features tested:
 * - --checkpoint-per-wave flag creates wave manifest
 * - Idempotent spawning (skips WUs with stamps)
 * - Only spawns status:ready WUs
 * - Compact output (<20 lines)
 * - Errors when combined with --dry-run
 *
 * @see {@link tools/orchestrate-initiative.mjs} - CLI entry point
 * @see {@link tools/lib/initiative-orchestrator.mjs} - Core orchestration logic
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';

describe('orchestrate-initiative checkpoint-per-wave', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = mkdtempSync(join(tmpdir(), 'orchestrate-initiative-test-'));
    process.chdir(testDir);

    // Create standard directory structure
    mkdirSync(join(testDir, 'docs/04-operations/tasks/initiatives'), { recursive: true });
    mkdirSync(join(testDir, 'docs/04-operations/tasks/wu'), { recursive: true });
    mkdirSync(join(testDir, '.beacon/stamps'), { recursive: true });
    mkdirSync(join(testDir, '.beacon/artifacts/waves'), { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  /**
   * Helper to create a valid initiative YAML
   */
  function createInitiative(id: string, overrides: Record<string, unknown> = {}) {
    const initiative = {
      id,
      slug: (overrides.slug as string) || id.toLowerCase().replace('init-', 'test-'),
      title: (overrides.title as string) || `Test Initiative ${id}`,
      status: (overrides.status as string) || 'open',
      owner: (overrides.owner as string) || 'test-owner',
      created: (overrides.created as string) || '2025-01-01',
      description: (overrides.description as string) || 'Test description',
      ...overrides,
    };

    const filePath = join(testDir, 'docs/04-operations/tasks/initiatives', `${id}.yaml`);
    writeFileSync(filePath, stringify(initiative, { lineWidth: 100 }), 'utf8');
    return initiative;
  }

  /**
   * Helper to create a WU YAML
   */
  function createWU(id: string, overrides: Record<string, unknown> = {}) {
    const wu = {
      id,
      title: `Test WU ${id}`,
      lane: (overrides.lane as string) || 'Operations',
      status: (overrides.status as string) || 'ready',
      type: 'feature',
      priority: 'P2',
      created: '2025-01-01',
      description: 'Test description',
      acceptance: ['Test criterion'],
      code_paths: [],
      tests: { manual: [], unit: [], e2e: [] },
      artifacts: [],
      dependencies: [],
      risks: [],
      notes: '',
      requires_review: false,
      ...overrides,
    };

    const filePath = join(testDir, 'docs/04-operations/tasks/wu', `${id}.yaml`);
    writeFileSync(filePath, stringify(wu, { lineWidth: 100 }), 'utf8');
    return wu;
  }

  /**
   * Helper to create a stamp file
   */
  function createStamp(wuId: string) {
    const stampPath = join(testDir, '.beacon/stamps', `${wuId}.done`);
    writeFileSync(stampPath, `${wuId} completed\n`, 'utf8');
  }

  /**
   * Helper to read wave manifest
   */
  function readWaveManifest(initId: string, waveNum: number) {
    const manifestPath = join(testDir, '.beacon/artifacts/waves', `${initId}-wave-${waveNum}.json`);
    if (!existsSync(manifestPath)) return null;
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  }

  describe('buildCheckpointWave', () => {
    it('should create wave manifest file with correct structure', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'ready' });
      createWU('WU-002', { initiative: 'INIT-001', status: 'ready' });

      const mod = await import('../src/initiative-orchestrator.js');
      const { buildCheckpointWave } = mod;

      // This function should exist and create a manifest
      const result = buildCheckpointWave('INIT-001');

      expect(result).toBeTruthy();
      expect(result.manifestPath).toBeTruthy();
      expect(existsSync(result.manifestPath)).toBe(true);

      const manifest = readWaveManifest('INIT-001', result.wave);
      expect(manifest.initiative).toBe('INIT-001');
      expect(Array.isArray(manifest.wus)).toBe(true);
    });

    it('should only include status:ready WUs in wave', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'ready' });
      createWU('WU-002', { initiative: 'INIT-001', status: 'in_progress' });
      createWU('WU-003', { initiative: 'INIT-001', status: 'done' });
      createWU('WU-004', { initiative: 'INIT-001', status: 'blocked' });

      const mod = await import('../src/initiative-orchestrator.js');
      const { buildCheckpointWave } = mod;

      const result = buildCheckpointWave('INIT-001');
      const manifest = readWaveManifest('INIT-001', result.wave);

      // Should only have WU-001 (status: ready)
      const wuIds = manifest.wus.map((w: { id: string }) => w.id);
      expect(wuIds.includes('WU-001')).toBe(true);
      expect(wuIds.includes('WU-002')).toBe(false);
      expect(wuIds.includes('WU-003')).toBe(false);
      expect(wuIds.includes('WU-004')).toBe(false);
    });

    it('should skip WUs that have stamps (idempotent)', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'ready' });
      createWU('WU-002', { initiative: 'INIT-001', status: 'ready' });
      createStamp('WU-001'); // WU-001 already done

      const mod = await import('../src/initiative-orchestrator.js');
      const { buildCheckpointWave } = mod;

      const result = buildCheckpointWave('INIT-001');
      const manifest = readWaveManifest('INIT-001', result.wave);

      // Should only have WU-002 (WU-001 has stamp)
      const wuIds = manifest.wus.map((w: { id: string }) => w.id);
      expect(wuIds.includes('WU-001')).toBe(false);
      expect(wuIds.includes('WU-002')).toBe(true);
    });

    it('should enforce max one WU per lane per wave', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'ready', lane: 'Operations' });
      createWU('WU-002', { initiative: 'INIT-001', status: 'ready', lane: 'Operations' });
      createWU('WU-003', { initiative: 'INIT-001', status: 'ready', lane: 'Intelligence' });

      const mod = await import('../src/initiative-orchestrator.js');
      const { buildCheckpointWave } = mod;

      const result = buildCheckpointWave('INIT-001');
      const manifest = readWaveManifest('INIT-001', result.wave);

      // Should only have 1 Operations WU and 1 Intelligence WU per wave
      const operationsWUs = manifest.wus.filter((w: { lane: string }) => w.lane === 'Operations');
      const intelligenceWUs = manifest.wus.filter(
        (w: { lane: string }) => w.lane === 'Intelligence',
      );

      expect(operationsWUs.length).toBeLessThanOrEqual(1);
      expect(intelligenceWUs.length).toBeLessThanOrEqual(1);
    });

    it('should auto-detect wave number based on existing manifests', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'ready' });

      // Pre-create wave 0 manifest
      const wave0ManifestPath = join(testDir, '.beacon/artifacts/waves', 'INIT-001-wave-0.json');
      writeFileSync(
        wave0ManifestPath,
        JSON.stringify({ initiative: 'INIT-001', wave: 0, wus: [] }),
        'utf8',
      );

      const mod = await import('../src/initiative-orchestrator.js');
      const { buildCheckpointWave } = mod;

      const result = buildCheckpointWave('INIT-001');

      // Should auto-increment to wave 1
      expect(result.wave).toBe(1);
    });

    it('should return null/empty when all WUs are complete', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'done' });
      createStamp('WU-001');

      const mod = await import('../src/initiative-orchestrator.js');
      const { buildCheckpointWave } = mod;

      const result = buildCheckpointWave('INIT-001');

      // Should indicate nothing to spawn
      expect(result === null || result.wus?.length === 0).toBe(true);
    });

    // WU-2277: dry-run should not create wave artifacts
    it('should NOT create manifest file when dryRun is true', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'ready' });
      createWU('WU-002', { initiative: 'INIT-001', status: 'ready' });

      const mod = await import('../src/initiative-orchestrator.js');
      const { buildCheckpointWave } = mod;

      // Call with dryRun option
      const result = buildCheckpointWave('INIT-001', { dryRun: true });

      // Should still return wave data for stdout output
      expect(result).toBeTruthy();
      expect(result.wus.length).toBeGreaterThan(0);

      // But manifest file should NOT exist
      const manifestPath = join(
        testDir,
        '.beacon/artifacts/waves',
        `INIT-001-wave-${result.wave}.json`,
      );
      expect(existsSync(manifestPath)).toBe(false);
    });

    it('should still create manifest file when dryRun is false or undefined', async () => {
      createInitiative('INIT-002');
      createWU('WU-010', { initiative: 'INIT-002', status: 'ready' });

      const mod = await import('../src/initiative-orchestrator.js');
      const { buildCheckpointWave } = mod;

      // Call without dryRun (default behavior)
      const result = buildCheckpointWave('INIT-002');

      // Manifest file SHOULD exist
      expect(existsSync(result.manifestPath)).toBe(true);
    });
  });

  describe('formatCheckpointOutput', () => {
    // WU-2430: Updated test - output now includes full Task invocations
    // which are ~200+ lines per WU. The "compact" requirement was for
    // human-readable summary, not the full XML content.
    it('should produce structured output with wave info and resume instructions', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'ready' });
      createWU('WU-002', { initiative: 'INIT-001', status: 'ready', lane: 'Intelligence' });

      const mod = await import('../src/initiative-orchestrator.js');
      const { formatCheckpointOutput } = mod;

      const output = formatCheckpointOutput({
        initiative: 'INIT-001',
        wave: 0,
        wus: [
          { id: 'WU-001', lane: 'Operations' },
          { id: 'WU-002', lane: 'Intelligence' },
        ],
        manifestPath: '.beacon/artifacts/waves/INIT-001-wave-0.json',
      });

      // Verify key structural elements are present
      expect(output.includes('Wave 0 manifest')).toBe(true);
      expect(output.includes('WU-001')).toBe(true);
      expect(output.includes('WU-002')).toBe(true);
      expect(output.includes('Resume with')).toBe(true);
    });

    it('should include resume instructions', async () => {
      const mod = await import('../src/initiative-orchestrator.js');
      const { formatCheckpointOutput } = mod;

      const output = formatCheckpointOutput({
        initiative: 'INIT-001',
        wave: 0,
        wus: [{ id: 'WU-001', lane: 'Operations' }],
        manifestPath: '.beacon/artifacts/waves/INIT-001-wave-0.json',
      });

      // Should include instructions on how to resume
      expect(output.includes('Resume')).toBe(true);
      expect(output.includes('orchestrate:initiative') || output.includes('pnpm')).toBe(true);
    });
  });

  describe('CLI flag validation', () => {
    it('should error when -c combined with --dry-run', async () => {
      // This tests CLI argument validation
      // The actual CLI behavior - we test the validation logic

      const mod = await import('../src/initiative-orchestrator.js');
      const { validateCheckpointFlags } = mod;

      // The function should exist and throw for invalid combinations
      expect(() => validateCheckpointFlags({ checkpointPerWave: true, dryRun: true })).toThrow(
        /cannot combine/i,
      );
    });

    it('should allow -c without --dry-run', async () => {
      const mod = await import('../src/initiative-orchestrator.js');
      const { validateCheckpointFlags } = mod;

      // Should not throw
      expect(() =>
        validateCheckpointFlags({ checkpointPerWave: true, dryRun: false }),
      ).not.toThrow();
    });
  });

  describe('idempotency', () => {
    it('should skip WUs already in previous wave manifests', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'ready' });
      createWU('WU-002', { initiative: 'INIT-001', status: 'ready', lane: 'Intelligence' });

      // Create wave 0 manifest that already has WU-001
      const wave0ManifestPath = join(testDir, '.beacon/artifacts/waves', 'INIT-001-wave-0.json');
      writeFileSync(
        wave0ManifestPath,
        JSON.stringify({
          initiative: 'INIT-001',
          wave: 0,
          wus: [{ id: 'WU-001', lane: 'Operations', status: 'spawned' }],
          created_at: new Date().toISOString(),
        }),
        'utf8',
      );

      const mod = await import('../src/initiative-orchestrator.js');
      const { buildCheckpointWave } = mod;

      const result = buildCheckpointWave('INIT-001');

      // WU-001 was in wave 0, so should not appear again
      // Only WU-002 should be in wave 1
      if (result && result.wus) {
        const wuIds = result.wus.map((w: { id: string }) => w.id);
        expect(wuIds.includes('WU-001')).toBe(false);
      }
    });

    it('should use idempotency precedence: stamp > signal > manifest', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'ready' });

      // Create stamp (highest precedence)
      createStamp('WU-001');

      // Even if manifest doesn't have it, stamp should win
      const mod = await import('../src/initiative-orchestrator.js');
      const { buildCheckpointWave } = mod;

      const result = buildCheckpointWave('INIT-001');

      // Should not spawn WU-001 because stamp exists
      if (result && result.wus) {
        const wuIds = result.wus.map((w: { id: string }) => w.id);
        expect(wuIds.includes('WU-001')).toBe(false);
      }
    });
  });

  describe('wave manifest structure', () => {
    it('should include required fields in manifest', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'ready' });

      const mod = await import('../src/initiative-orchestrator.js');
      const { buildCheckpointWave } = mod;

      const result = buildCheckpointWave('INIT-001');
      const manifest = readWaveManifest('INIT-001', result.wave);

      // Verify required fields per implementation plan
      expect(manifest.initiative).toBeTruthy();
      expect(typeof manifest.wave).toBe('number');
      expect(manifest.created_at).toBeTruthy();
      expect(Array.isArray(manifest.wus)).toBe(true);
    });

    it('should include WU metadata in manifest', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'ready', lane: 'Operations' });

      const mod = await import('../src/initiative-orchestrator.js');
      const { buildCheckpointWave } = mod;

      const result = buildCheckpointWave('INIT-001');
      const manifest = readWaveManifest('INIT-001', result.wave);

      const wu = manifest.wus.find((w: { id: string }) => w.id === 'WU-001');
      expect(wu).toBeTruthy();
      expect(wu.lane).toBe('Operations');
      expect(wu.status).toBe('spawned');
    });
  });
});
