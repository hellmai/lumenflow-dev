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

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

describe('orchestrate-initiative checkpoint-per-wave', () => {
  let testDir;
  let originalCwd;

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
  function createInitiative(id, overrides = {}) {
    const initiative = {
      id,
      slug: overrides.slug || id.toLowerCase().replace('init-', 'test-'),
      title: overrides.title || `Test Initiative ${id}`,
      status: overrides.status || 'open',
      owner: overrides.owner || 'test-owner',
      created: overrides.created || '2025-01-01',
      description: overrides.description || 'Test description',
      ...overrides,
    };

    const filePath = join(testDir, 'docs/04-operations/tasks/initiatives', `${id}.yaml`);
    writeFileSync(filePath, yaml.dump(initiative, { lineWidth: 100 }), 'utf8');
    return initiative;
  }

  /**
   * Helper to create a WU YAML
   */
  function createWU(id, overrides = {}) {
    const wu = {
      id,
      title: `Test WU ${id}`,
      lane: overrides.lane || 'Operations',
      status: overrides.status || 'ready',
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
    writeFileSync(filePath, yaml.dump(wu, { lineWidth: 100 }), 'utf8');
    return wu;
  }

  /**
   * Helper to create a stamp file
   */
  function createStamp(wuId) {
    const stampPath = join(testDir, '.beacon/stamps', `${wuId}.done`);
    writeFileSync(stampPath, `${wuId} completed\n`, 'utf8');
  }

  /**
   * Helper to read wave manifest
   */
  function readWaveManifest(initId, waveNum) {
    const manifestPath = join(testDir, '.beacon/artifacts/waves', `${initId}-wave-${waveNum}.json`);
    if (!existsSync(manifestPath)) return null;
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  }

  describe('buildCheckpointWave', () => {
    it('should create wave manifest file with correct structure', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'ready' });
      createWU('WU-002', { initiative: 'INIT-001', status: 'ready' });

      const mod = await import('../initiative-orchestrator.mjs');
      const { buildCheckpointWave } = mod;

      // This function should exist and create a manifest
      const result = buildCheckpointWave('INIT-001');

      assert.ok(result, 'buildCheckpointWave should return a result');
      assert.ok(result.manifestPath, 'result should contain manifestPath');
      assert.ok(existsSync(result.manifestPath), 'manifest file should exist');

      const manifest = readWaveManifest('INIT-001', result.wave);
      assert.equal(manifest.initiative, 'INIT-001');
      assert.ok(Array.isArray(manifest.wus), 'manifest.wus should be array');
    });

    it('should only include status:ready WUs in wave', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'ready' });
      createWU('WU-002', { initiative: 'INIT-001', status: 'in_progress' });
      createWU('WU-003', { initiative: 'INIT-001', status: 'done' });
      createWU('WU-004', { initiative: 'INIT-001', status: 'blocked' });

      const mod = await import('../initiative-orchestrator.mjs');
      const { buildCheckpointWave } = mod;

      const result = buildCheckpointWave('INIT-001');
      const manifest = readWaveManifest('INIT-001', result.wave);

      // Should only have WU-001 (status: ready)
      const wuIds = manifest.wus.map((w) => w.id);
      assert.ok(wuIds.includes('WU-001'), 'ready WU should be included');
      assert.ok(!wuIds.includes('WU-002'), 'in_progress WU should be excluded');
      assert.ok(!wuIds.includes('WU-003'), 'done WU should be excluded');
      assert.ok(!wuIds.includes('WU-004'), 'blocked WU should be excluded');
    });

    it('should skip WUs that have stamps (idempotent)', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'ready' });
      createWU('WU-002', { initiative: 'INIT-001', status: 'ready' });
      createStamp('WU-001'); // WU-001 already done

      const mod = await import('../initiative-orchestrator.mjs');
      const { buildCheckpointWave } = mod;

      const result = buildCheckpointWave('INIT-001');
      const manifest = readWaveManifest('INIT-001', result.wave);

      // Should only have WU-002 (WU-001 has stamp)
      const wuIds = manifest.wus.map((w) => w.id);
      assert.ok(!wuIds.includes('WU-001'), 'WU with stamp should be skipped');
      assert.ok(wuIds.includes('WU-002'), 'WU without stamp should be included');
    });

    it('should enforce max one WU per lane per wave', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'ready', lane: 'Operations' });
      createWU('WU-002', { initiative: 'INIT-001', status: 'ready', lane: 'Operations' });
      createWU('WU-003', { initiative: 'INIT-001', status: 'ready', lane: 'Intelligence' });

      const mod = await import('../initiative-orchestrator.mjs');
      const { buildCheckpointWave } = mod;

      const result = buildCheckpointWave('INIT-001');
      const manifest = readWaveManifest('INIT-001', result.wave);

      // Should only have 1 Operations WU and 1 Intelligence WU per wave
      const operationsWUs = manifest.wus.filter((w) => w.lane === 'Operations');
      const intelligenceWUs = manifest.wus.filter((w) => w.lane === 'Intelligence');

      assert.ok(operationsWUs.length <= 1, 'max 1 Operations WU per wave');
      assert.ok(intelligenceWUs.length <= 1, 'max 1 Intelligence WU per wave');
    });

    it('should auto-detect wave number based on existing manifests', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'ready' });

      // Pre-create wave 0 manifest
      const wave0ManifestPath = join(testDir, '.beacon/artifacts/waves', 'INIT-001-wave-0.json');
      writeFileSync(
        wave0ManifestPath,
        JSON.stringify({ initiative: 'INIT-001', wave: 0, wus: [] }),
        'utf8'
      );

      const mod = await import('../initiative-orchestrator.mjs');
      const { buildCheckpointWave } = mod;

      const result = buildCheckpointWave('INIT-001');

      // Should auto-increment to wave 1
      assert.equal(result.wave, 1, 'should auto-increment wave number');
    });

    it('should return null/empty when all WUs are complete', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'done' });
      createStamp('WU-001');

      const mod = await import('../initiative-orchestrator.mjs');
      const { buildCheckpointWave } = mod;

      const result = buildCheckpointWave('INIT-001');

      // Should indicate nothing to spawn
      assert.ok(
        result === null || result.wus?.length === 0,
        'should return null or empty when all complete'
      );
    });

    // WU-2277: dry-run should not create wave artifacts
    it('should NOT create manifest file when dryRun is true', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'ready' });
      createWU('WU-002', { initiative: 'INIT-001', status: 'ready' });

      const mod = await import('../initiative-orchestrator.mjs');
      const { buildCheckpointWave } = mod;

      // Call with dryRun option
      const result = buildCheckpointWave('INIT-001', { dryRun: true });

      // Should still return wave data for stdout output
      assert.ok(result, 'should return wave data even in dry-run');
      assert.ok(result.wus.length > 0, 'should have WUs in result');

      // But manifest file should NOT exist
      const manifestPath = join(
        testDir,
        '.beacon/artifacts/waves',
        `INIT-001-wave-${result.wave}.json`
      );
      assert.ok(!existsSync(manifestPath), 'manifest file should NOT be created in dry-run mode');
    });

    it('should still create manifest file when dryRun is false or undefined', async () => {
      createInitiative('INIT-002');
      createWU('WU-010', { initiative: 'INIT-002', status: 'ready' });

      const mod = await import('../initiative-orchestrator.mjs');
      const { buildCheckpointWave } = mod;

      // Call without dryRun (default behavior)
      const result = buildCheckpointWave('INIT-002');

      // Manifest file SHOULD exist
      assert.ok(existsSync(result.manifestPath), 'manifest file should exist when not dry-run');
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

      const mod = await import('../initiative-orchestrator.mjs');
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
      assert.ok(output.includes('Wave 0 manifest'), 'should include wave info');
      assert.ok(output.includes('WU-001'), 'should list WU-001');
      assert.ok(output.includes('WU-002'), 'should list WU-002');
      assert.ok(output.includes('Resume with'), 'should include resume instructions');
    });

    it('should include resume instructions', async () => {
      const mod = await import('../initiative-orchestrator.mjs');
      const { formatCheckpointOutput } = mod;

      const output = formatCheckpointOutput({
        initiative: 'INIT-001',
        wave: 0,
        wus: [{ id: 'WU-001', lane: 'Operations' }],
        manifestPath: '.beacon/artifacts/waves/INIT-001-wave-0.json',
      });

      // Should include instructions on how to resume
      assert.ok(output.includes('Resume'), 'should include resume instructions');
      assert.ok(
        output.includes('orchestrate:initiative') || output.includes('pnpm'),
        'should reference the command'
      );
    });
  });

  describe('CLI flag validation', () => {
    it('should error when -c combined with --dry-run', async () => {
      // This tests CLI argument validation
      // The actual CLI behavior - we test the validation logic

      const mod = await import('../initiative-orchestrator.mjs');
      const { validateCheckpointFlags } = mod;

      // The function should exist and throw for invalid combinations
      assert.throws(
        () => validateCheckpointFlags({ checkpointPerWave: true, dryRun: true }),
        /cannot combine/i,
        'should reject -c with --dry-run'
      );
    });

    it('should allow -c without --dry-run', async () => {
      const mod = await import('../initiative-orchestrator.mjs');
      const { validateCheckpointFlags } = mod;

      // Should not throw
      assert.doesNotThrow(() =>
        validateCheckpointFlags({ checkpointPerWave: true, dryRun: false })
      );
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
        'utf8'
      );

      const mod = await import('../initiative-orchestrator.mjs');
      const { buildCheckpointWave } = mod;

      const result = buildCheckpointWave('INIT-001');

      // WU-001 was in wave 0, so should not appear again
      // Only WU-002 should be in wave 1
      if (result && result.wus) {
        const wuIds = result.wus.map((w) => w.id);
        assert.ok(!wuIds.includes('WU-001'), 'WU already in manifest should be skipped');
      }
    });

    it('should use idempotency precedence: stamp > signal > manifest', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'ready' });

      // Create stamp (highest precedence)
      createStamp('WU-001');

      // Even if manifest doesn't have it, stamp should win
      const mod = await import('../initiative-orchestrator.mjs');
      const { buildCheckpointWave } = mod;

      const result = buildCheckpointWave('INIT-001');

      // Should not spawn WU-001 because stamp exists
      if (result && result.wus) {
        const wuIds = result.wus.map((w) => w.id);
        assert.ok(!wuIds.includes('WU-001'), 'stamp takes precedence');
      }
    });
  });

  describe('wave manifest structure', () => {
    it('should include required fields in manifest', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'ready' });

      const mod = await import('../initiative-orchestrator.mjs');
      const { buildCheckpointWave } = mod;

      const result = buildCheckpointWave('INIT-001');
      const manifest = readWaveManifest('INIT-001', result.wave);

      // Verify required fields per implementation plan
      assert.ok(manifest.initiative, 'manifest should have initiative');
      assert.ok(typeof manifest.wave === 'number', 'manifest should have wave number');
      assert.ok(manifest.created_at, 'manifest should have created_at');
      assert.ok(Array.isArray(manifest.wus), 'manifest should have wus array');
    });

    it('should include WU metadata in manifest', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'ready', lane: 'Operations' });

      const mod = await import('../initiative-orchestrator.mjs');
      const { buildCheckpointWave } = mod;

      const result = buildCheckpointWave('INIT-001');
      const manifest = readWaveManifest('INIT-001', result.wave);

      const wu = manifest.wus.find((w) => w.id === 'WU-001');
      assert.ok(wu, 'WU should be in manifest');
      assert.equal(wu.lane, 'Operations', 'WU should have lane');
      assert.equal(wu.status, 'spawned', 'WU status in manifest should be spawned');
    });
  });
});
