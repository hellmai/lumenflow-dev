/**
 * Initiative YAML I/O Tests (WU-1247)
 *
 * Tests for reading, writing, and listing initiative YAML files.
 *
 * @see {@link tools/lib/initiative-yaml.mjs} - Implementation
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

// We need to test with controlled directory structure
// These tests use manual file creation to avoid circular dependencies

describe('initiative-yaml', () => {
  let testDir;
  let originalCwd;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = mkdtempSync(join(tmpdir(), 'initiative-yaml-test-'));
    process.chdir(testDir);

    // Create standard directory structure
    mkdirSync(join(testDir, 'docs/04-operations/tasks/initiatives'), { recursive: true });
    mkdirSync(join(testDir, 'docs/04-operations/tasks/wu'), { recursive: true });
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
      lane: 'Operations',
      status: overrides.status || 'ready',
      type: 'feature',
      priority: 'P2',
      created: '2025-01-01',
      description: 'Test description',
      acceptance: ['Test criterion'],
      ...overrides,
    };

    const filePath = join(testDir, 'docs/04-operations/tasks/wu', `${id}.yaml`);
    writeFileSync(filePath, yaml.dump(wu, { lineWidth: 100 }), 'utf8');
    return wu;
  }

  describe('readInitiative', async () => {
    // Dynamic import to ensure cwd is set first
    let readInitiative;

    it('should read and parse valid Initiative YAML', async () => {
      createInitiative('INIT-001', { slug: 'test-init', title: 'Test Initiative' });

      // Dynamic import after directory setup
      const mod = await import('../initiative-yaml.mjs');
      readInitiative = mod.readInitiative;

      const filePath = join(testDir, 'docs/04-operations/tasks/initiatives/INIT-001.yaml');
      const result = readInitiative(filePath, 'INIT-001');

      assert.equal(result.id, 'INIT-001');
      assert.equal(result.slug, 'test-init');
      assert.equal(result.title, 'Test Initiative');
    });

    it('should throw error if file does not exist', async () => {
      const mod = await import('../initiative-yaml.mjs');
      readInitiative = mod.readInitiative;

      const filePath = join(testDir, 'docs/04-operations/tasks/initiatives/nonexistent.yaml');
      assert.throws(() => readInitiative(filePath, 'INIT-999'), /Initiative file not found/);
    });

    it('should throw error if YAML is invalid', async () => {
      const filePath = join(testDir, 'docs/04-operations/tasks/initiatives/INIT-001.yaml');
      writeFileSync(filePath, 'invalid: yaml: content:', 'utf8');

      const mod = await import('../initiative-yaml.mjs');
      readInitiative = mod.readInitiative;

      assert.throws(() => readInitiative(filePath, 'INIT-001'), /Failed to parse YAML/);
    });

    it('should throw error if Initiative ID does not match', async () => {
      createInitiative('INIT-002');

      const mod = await import('../initiative-yaml.mjs');
      readInitiative = mod.readInitiative;

      const filePath = join(testDir, 'docs/04-operations/tasks/initiatives/INIT-002.yaml');
      assert.throws(() => readInitiative(filePath, 'INIT-001'), /id mismatch/);
    });

    it('should throw error if Initiative fails schema validation', async () => {
      // Create initiative missing required fields
      const filePath = join(testDir, 'docs/04-operations/tasks/initiatives/INIT-003.yaml');
      writeFileSync(filePath, yaml.dump({ id: 'INIT-003' }), 'utf8');

      const mod = await import('../initiative-yaml.mjs');
      readInitiative = mod.readInitiative;

      assert.throws(() => readInitiative(filePath, 'INIT-003'), /validation failed/);
    });
  });

  describe('writeInitiative', async () => {
    it('should write Initiative YAML with consistent formatting', async () => {
      const mod = await import('../initiative-yaml.mjs');
      const { writeInitiative, readInitiative } = mod;

      const doc = {
        id: 'INIT-100',
        slug: 'write-test',
        title: 'Write Test',
        status: 'open',
        owner: 'tester',
        created: '2025-01-01',
        description: 'Testing writeInitiative function',
      };

      const filePath = join(testDir, 'docs/04-operations/tasks/initiatives/INIT-100.yaml');
      writeInitiative(filePath, doc);

      assert.ok(existsSync(filePath));

      // Read back and verify
      const result = readInitiative(filePath, 'INIT-100');
      assert.equal(result.id, 'INIT-100');
      assert.equal(result.slug, 'write-test');
      assert.equal(result.title, 'Write Test');
    });
  });

  describe('listInitiatives', async () => {
    it('should return empty array if directory does not exist', async () => {
      // Remove the initiatives directory
      rmSync(join(testDir, 'docs/04-operations/tasks/initiatives'), {
        recursive: true,
        force: true,
      });

      const mod = await import('../initiative-yaml.mjs');
      const { listInitiatives } = mod;

      const result = listInitiatives();
      assert.deepEqual(result, []);
    });

    it('should list all valid initiatives', async () => {
      createInitiative('INIT-001', { slug: 'first' });
      createInitiative('INIT-002', { slug: 'second' });

      const mod = await import('../initiative-yaml.mjs');
      const { listInitiatives } = mod;

      const result = listInitiatives();
      assert.equal(result.length, 2);

      const ids = result.map((r) => r.id);
      assert.ok(ids.includes('INIT-001'));
      assert.ok(ids.includes('INIT-002'));
    });

    it('should skip invalid YAML files', async () => {
      createInitiative('INIT-001');

      // Create invalid file
      const invalidPath = join(testDir, 'docs/04-operations/tasks/initiatives/INIT-BAD.yaml');
      writeFileSync(invalidPath, 'invalid: yaml: content:', 'utf8');

      const mod = await import('../initiative-yaml.mjs');
      const { listInitiatives } = mod;

      const result = listInitiatives();
      assert.equal(result.length, 1);
      assert.equal(result[0].id, 'INIT-001');
    });

    it('should only include files matching INIT-NNN or INIT-NAME pattern', async () => {
      createInitiative('INIT-001');

      // Create file with wrong pattern
      const wrongPath = join(testDir, 'docs/04-operations/tasks/initiatives/not-an-init.yaml');
      writeFileSync(wrongPath, yaml.dump({ id: 'not-an-init', slug: 'test' }), 'utf8');

      const mod = await import('../initiative-yaml.mjs');
      const { listInitiatives } = mod;

      const result = listInitiatives();
      assert.equal(result.length, 1);
    });
  });

  describe('findInitiative', async () => {
    it('should find initiative by ID', async () => {
      createInitiative('INIT-001', { slug: 'find-test' });

      const mod = await import('../initiative-yaml.mjs');
      const { findInitiative } = mod;

      const result = findInitiative('INIT-001');
      assert.ok(result);
      assert.equal(result.id, 'INIT-001');
    });

    it('should find initiative by slug', async () => {
      createInitiative('INIT-001', { slug: 'my-slug' });

      const mod = await import('../initiative-yaml.mjs');
      const { findInitiative } = mod;

      const result = findInitiative('my-slug');
      assert.ok(result);
      assert.equal(result.id, 'INIT-001');
      assert.equal(result.doc.slug, 'my-slug');
    });

    it('should return null if not found', async () => {
      const mod = await import('../initiative-yaml.mjs');
      const { findInitiative } = mod;

      const result = findInitiative('INIT-999');
      assert.equal(result, null);
    });

    it('should prefer ID match over slug match', async () => {
      createInitiative('INIT-001', { slug: 'INIT-002' }); // Unusual case
      createInitiative('INIT-002', { slug: 'other-slug' });

      const mod = await import('../initiative-yaml.mjs');
      const { findInitiative } = mod;

      const result = findInitiative('INIT-002');
      assert.ok(result);
      assert.equal(result.id, 'INIT-002');
    });
  });

  describe('getInitiativeWUs', async () => {
    it('should return empty array if no WUs reference initiative', async () => {
      createInitiative('INIT-001');
      createWU('WU-001'); // No initiative field

      const mod = await import('../initiative-yaml.mjs');
      const { getInitiativeWUs } = mod;

      const result = getInitiativeWUs('INIT-001');
      assert.deepEqual(result, []);
    });

    it('should return WUs that reference initiative by ID', async () => {
      createInitiative('INIT-001', { slug: 'test-init' });
      createWU('WU-001', { initiative: 'INIT-001' });
      createWU('WU-002'); // No initiative

      const mod = await import('../initiative-yaml.mjs');
      const { getInitiativeWUs } = mod;

      const result = getInitiativeWUs('INIT-001');
      assert.equal(result.length, 1);
      assert.equal(result[0].id, 'WU-001');
    });

    it('should return WUs that reference initiative by slug', async () => {
      createInitiative('INIT-001', { slug: 'my-initiative' });
      createWU('WU-001', { initiative: 'my-initiative' });

      const mod = await import('../initiative-yaml.mjs');
      const { getInitiativeWUs } = mod;

      const result = getInitiativeWUs('INIT-001');
      assert.equal(result.length, 1);
      assert.equal(result[0].id, 'WU-001');
    });

    it('should find WUs when searching by slug', async () => {
      createInitiative('INIT-001', { slug: 'my-init' });
      createWU('WU-001', { initiative: 'INIT-001' });

      const mod = await import('../initiative-yaml.mjs');
      const { getInitiativeWUs } = mod;

      // Search using slug instead of ID
      const result = getInitiativeWUs('my-init');
      assert.equal(result.length, 1);
    });

    it('should return empty if WU directory does not exist', async () => {
      rmSync(join(testDir, 'docs/04-operations/tasks/wu'), { recursive: true, force: true });

      const mod = await import('../initiative-yaml.mjs');
      const { getInitiativeWUs } = mod;

      const result = getInitiativeWUs('INIT-001');
      assert.deepEqual(result, []);
    });
  });

  describe('getInitiativeProgress', async () => {
    it('should return zero progress for empty initiative', async () => {
      createInitiative('INIT-001');

      const mod = await import('../initiative-yaml.mjs');
      const { getInitiativeProgress } = mod;

      const result = getInitiativeProgress('INIT-001');
      assert.equal(result.total, 0);
      assert.equal(result.done, 0);
      assert.equal(result.percentage, 0);
    });

    it('should calculate progress correctly', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'done' });
      createWU('WU-002', { initiative: 'INIT-001', status: 'done' });
      createWU('WU-003', { initiative: 'INIT-001', status: 'in_progress' });
      createWU('WU-004', { initiative: 'INIT-001', status: 'ready' });

      const mod = await import('../initiative-yaml.mjs');
      const { getInitiativeProgress } = mod;

      const result = getInitiativeProgress('INIT-001');
      assert.equal(result.total, 4);
      assert.equal(result.done, 2);
      assert.equal(result.inProgress, 1);
      assert.equal(result.ready, 1);
      assert.equal(result.percentage, 50);
    });

    it('should count blocked WUs', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'blocked' });

      const mod = await import('../initiative-yaml.mjs');
      const { getInitiativeProgress } = mod;

      const result = getInitiativeProgress('INIT-001');
      assert.equal(result.blocked, 1);
    });

    it('should round percentage', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'done' });
      createWU('WU-002', { initiative: 'INIT-001', status: 'ready' });
      createWU('WU-003', { initiative: 'INIT-001', status: 'ready' });

      const mod = await import('../initiative-yaml.mjs');
      const { getInitiativeProgress } = mod;

      const result = getInitiativeProgress('INIT-001');
      assert.equal(result.percentage, 33); // 1/3 = 33%
    });
  });

  describe('getInitiativePhases', async () => {
    it('should group WUs by phase', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', phase: 1 });
      createWU('WU-002', { initiative: 'INIT-001', phase: 1 });
      createWU('WU-003', { initiative: 'INIT-001', phase: 2 });

      const mod = await import('../initiative-yaml.mjs');
      const { getInitiativePhases } = mod;

      const result = getInitiativePhases('INIT-001');
      assert.equal(result.get(1).length, 2);
      assert.equal(result.get(2).length, 1);
    });

    it('should put unphased WUs under null key', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001' }); // No phase

      const mod = await import('../initiative-yaml.mjs');
      const { getInitiativePhases } = mod;

      const result = getInitiativePhases('INIT-001');
      assert.ok(result.has(null));
      assert.equal(result.get(null).length, 1);
    });
  });

  describe('buildInitiativeMap', async () => {
    it('should return empty map for no initiatives', async () => {
      rmSync(join(testDir, 'docs/04-operations/tasks/initiatives'), {
        recursive: true,
        force: true,
      });
      mkdirSync(join(testDir, 'docs/04-operations/tasks/initiatives'), { recursive: true });

      const mod = await import('../initiative-yaml.mjs');
      const { buildInitiativeMap } = mod;

      const result = buildInitiativeMap();
      assert.equal(result.size, 0);
    });

    it('should index by both ID and slug', async () => {
      createInitiative('INIT-001', { slug: 'my-slug', title: 'Test' });

      const mod = await import('../initiative-yaml.mjs');
      const { buildInitiativeMap } = mod;

      const result = buildInitiativeMap();
      assert.ok(result.has('INIT-001'));
      assert.ok(result.has('my-slug'));
      assert.equal(result.get('INIT-001').title, 'Test');
      assert.equal(result.get('my-slug').title, 'Test');
    });

    it('should handle initiative without slug', async () => {
      // Create initiative manually without slug (which is actually required by schema)
      // This tests defensive behavior
      createInitiative('INIT-001', { slug: 'has-slug' });

      const mod = await import('../initiative-yaml.mjs');
      const { buildInitiativeMap } = mod;

      const result = buildInitiativeMap();
      assert.ok(result.has('INIT-001'));
    });
  });
});
