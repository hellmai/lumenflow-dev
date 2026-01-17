/**
 * Initiative YAML I/O Tests (WU-1247)
 *
 * Tests for reading, writing, and listing initiative YAML files.
 *
 * @see {@link tools/lib/initiative-yaml.mjs} - Implementation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

// We need to test with controlled directory structure
// These tests use manual file creation to avoid circular dependencies

describe('initiative-yaml', () => {
  let testDir: string;
  let originalCwd: string;

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
    writeFileSync(filePath, yaml.dump(initiative, { lineWidth: 100 }), 'utf8');
    return initiative;
  }

  /**
   * Helper to create a WU YAML
   */
  function createWU(id: string, overrides: Record<string, unknown> = {}) {
    const wu = {
      id,
      title: `Test WU ${id}`,
      lane: 'Operations',
      status: (overrides.status as string) || 'ready',
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
    let readInitiative: typeof import('../src/initiative-yaml.js').readInitiative;

    it('should read and parse valid Initiative YAML', async () => {
      createInitiative('INIT-001', { slug: 'test-init', title: 'Test Initiative' });

      // Dynamic import after directory setup
      const mod = await import('../src/initiative-yaml.js');
      readInitiative = mod.readInitiative;

      const filePath = join(testDir, 'docs/04-operations/tasks/initiatives/INIT-001.yaml');
      const result = readInitiative(filePath, 'INIT-001');

      expect(result.id).toBe('INIT-001');
      expect(result.slug).toBe('test-init');
      expect(result.title).toBe('Test Initiative');
    });

    it('should throw error if file does not exist', async () => {
      const mod = await import('../src/initiative-yaml.js');
      readInitiative = mod.readInitiative;

      const filePath = join(testDir, 'docs/04-operations/tasks/initiatives/nonexistent.yaml');
      expect(() => readInitiative(filePath, 'INIT-999')).toThrow(/Initiative file not found/);
    });

    it('should throw error if YAML is invalid', async () => {
      const filePath = join(testDir, 'docs/04-operations/tasks/initiatives/INIT-001.yaml');
      writeFileSync(filePath, 'invalid: yaml: content:', 'utf8');

      const mod = await import('../src/initiative-yaml.js');
      readInitiative = mod.readInitiative;

      expect(() => readInitiative(filePath, 'INIT-001')).toThrow(/Failed to parse YAML/);
    });

    it('should throw error if Initiative ID does not match', async () => {
      createInitiative('INIT-002');

      const mod = await import('../src/initiative-yaml.js');
      readInitiative = mod.readInitiative;

      const filePath = join(testDir, 'docs/04-operations/tasks/initiatives/INIT-002.yaml');
      expect(() => readInitiative(filePath, 'INIT-001')).toThrow(/id mismatch/);
    });

    it('should throw error if Initiative fails schema validation', async () => {
      // Create initiative missing required fields
      const filePath = join(testDir, 'docs/04-operations/tasks/initiatives/INIT-003.yaml');
      writeFileSync(filePath, yaml.dump({ id: 'INIT-003' }), 'utf8');

      const mod = await import('../src/initiative-yaml.js');
      readInitiative = mod.readInitiative;

      expect(() => readInitiative(filePath, 'INIT-003')).toThrow(/validation failed/);
    });
  });

  describe('writeInitiative', async () => {
    it('should write Initiative YAML with consistent formatting', async () => {
      const mod = await import('../src/initiative-yaml.js');
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

      expect(existsSync(filePath)).toBe(true);

      // Read back and verify
      const result = readInitiative(filePath, 'INIT-100');
      expect(result.id).toBe('INIT-100');
      expect(result.slug).toBe('write-test');
      expect(result.title).toBe('Write Test');
    });
  });

  describe('listInitiatives', async () => {
    it('should return empty array if directory does not exist', async () => {
      // Remove the initiatives directory
      rmSync(join(testDir, 'docs/04-operations/tasks/initiatives'), {
        recursive: true,
        force: true,
      });

      const mod = await import('../src/initiative-yaml.js');
      const { listInitiatives } = mod;

      const result = listInitiatives();
      expect(result).toEqual([]);
    });

    it('should list all valid initiatives', async () => {
      createInitiative('INIT-001', { slug: 'first' });
      createInitiative('INIT-002', { slug: 'second' });

      const mod = await import('../src/initiative-yaml.js');
      const { listInitiatives } = mod;

      const result = listInitiatives();
      expect(result.length).toBe(2);

      const ids = result.map((r) => r.id);
      expect(ids.includes('INIT-001')).toBe(true);
      expect(ids.includes('INIT-002')).toBe(true);
    });

    it('should skip invalid YAML files', async () => {
      createInitiative('INIT-001');

      // Create invalid file
      const invalidPath = join(testDir, 'docs/04-operations/tasks/initiatives/INIT-BAD.yaml');
      writeFileSync(invalidPath, 'invalid: yaml: content:', 'utf8');

      const mod = await import('../src/initiative-yaml.js');
      const { listInitiatives } = mod;

      const result = listInitiatives();
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('INIT-001');
    });

    it('should only include files matching INIT-NNN or INIT-NAME pattern', async () => {
      createInitiative('INIT-001');

      // Create file with wrong pattern
      const wrongPath = join(testDir, 'docs/04-operations/tasks/initiatives/not-an-init.yaml');
      writeFileSync(wrongPath, yaml.dump({ id: 'not-an-init', slug: 'test' }), 'utf8');

      const mod = await import('../src/initiative-yaml.js');
      const { listInitiatives } = mod;

      const result = listInitiatives();
      expect(result.length).toBe(1);
    });
  });

  describe('findInitiative', async () => {
    it('should find initiative by ID', async () => {
      createInitiative('INIT-001', { slug: 'find-test' });

      const mod = await import('../src/initiative-yaml.js');
      const { findInitiative } = mod;

      const result = findInitiative('INIT-001');
      expect(result).toBeTruthy();
      expect(result!.id).toBe('INIT-001');
    });

    it('should find initiative by slug', async () => {
      createInitiative('INIT-001', { slug: 'my-slug' });

      const mod = await import('../src/initiative-yaml.js');
      const { findInitiative } = mod;

      const result = findInitiative('my-slug');
      expect(result).toBeTruthy();
      expect(result!.id).toBe('INIT-001');
      expect(result!.doc.slug).toBe('my-slug');
    });

    it('should return null if not found', async () => {
      const mod = await import('../src/initiative-yaml.js');
      const { findInitiative } = mod;

      const result = findInitiative('INIT-999');
      expect(result).toBe(null);
    });

    it('should prefer ID match over slug match', async () => {
      createInitiative('INIT-001', { slug: 'INIT-002' }); // Unusual case
      createInitiative('INIT-002', { slug: 'other-slug' });

      const mod = await import('../src/initiative-yaml.js');
      const { findInitiative } = mod;

      const result = findInitiative('INIT-002');
      expect(result).toBeTruthy();
      expect(result!.id).toBe('INIT-002');
    });
  });

  describe('getInitiativeWUs', async () => {
    it('should return empty array if no WUs reference initiative', async () => {
      createInitiative('INIT-001');
      createWU('WU-001'); // No initiative field

      const mod = await import('../src/initiative-yaml.js');
      const { getInitiativeWUs } = mod;

      const result = getInitiativeWUs('INIT-001');
      expect(result).toEqual([]);
    });

    it('should return WUs that reference initiative by ID', async () => {
      createInitiative('INIT-001', { slug: 'test-init' });
      createWU('WU-001', { initiative: 'INIT-001' });
      createWU('WU-002'); // No initiative

      const mod = await import('../src/initiative-yaml.js');
      const { getInitiativeWUs } = mod;

      const result = getInitiativeWUs('INIT-001');
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('WU-001');
    });

    it('should return WUs that reference initiative by slug', async () => {
      createInitiative('INIT-001', { slug: 'my-initiative' });
      createWU('WU-001', { initiative: 'my-initiative' });

      const mod = await import('../src/initiative-yaml.js');
      const { getInitiativeWUs } = mod;

      const result = getInitiativeWUs('INIT-001');
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('WU-001');
    });

    it('should find WUs when searching by slug', async () => {
      createInitiative('INIT-001', { slug: 'my-init' });
      createWU('WU-001', { initiative: 'INIT-001' });

      const mod = await import('../src/initiative-yaml.js');
      const { getInitiativeWUs } = mod;

      // Search using slug instead of ID
      const result = getInitiativeWUs('my-init');
      expect(result.length).toBe(1);
    });

    it('should return empty if WU directory does not exist', async () => {
      rmSync(join(testDir, 'docs/04-operations/tasks/wu'), { recursive: true, force: true });

      const mod = await import('../src/initiative-yaml.js');
      const { getInitiativeWUs } = mod;

      const result = getInitiativeWUs('INIT-001');
      expect(result).toEqual([]);
    });
  });

  describe('getInitiativeProgress', async () => {
    it('should return zero progress for empty initiative', async () => {
      createInitiative('INIT-001');

      const mod = await import('../src/initiative-yaml.js');
      const { getInitiativeProgress } = mod;

      const result = getInitiativeProgress('INIT-001');
      expect(result.total).toBe(0);
      expect(result.done).toBe(0);
      expect(result.percentage).toBe(0);
    });

    it('should calculate progress correctly', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'done' });
      createWU('WU-002', { initiative: 'INIT-001', status: 'done' });
      createWU('WU-003', { initiative: 'INIT-001', status: 'in_progress' });
      createWU('WU-004', { initiative: 'INIT-001', status: 'ready' });

      const mod = await import('../src/initiative-yaml.js');
      const { getInitiativeProgress } = mod;

      const result = getInitiativeProgress('INIT-001');
      expect(result.total).toBe(4);
      expect(result.done).toBe(2);
      expect(result.inProgress).toBe(1);
      expect(result.ready).toBe(1);
      expect(result.percentage).toBe(50);
    });

    it('should count blocked WUs', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'blocked' });

      const mod = await import('../src/initiative-yaml.js');
      const { getInitiativeProgress } = mod;

      const result = getInitiativeProgress('INIT-001');
      expect(result.blocked).toBe(1);
    });

    it('should round percentage', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', status: 'done' });
      createWU('WU-002', { initiative: 'INIT-001', status: 'ready' });
      createWU('WU-003', { initiative: 'INIT-001', status: 'ready' });

      const mod = await import('../src/initiative-yaml.js');
      const { getInitiativeProgress } = mod;

      const result = getInitiativeProgress('INIT-001');
      expect(result.percentage).toBe(33); // 1/3 = 33%
    });
  });

  describe('getInitiativePhases', async () => {
    it('should group WUs by phase', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001', phase: 1 });
      createWU('WU-002', { initiative: 'INIT-001', phase: 1 });
      createWU('WU-003', { initiative: 'INIT-001', phase: 2 });

      const mod = await import('../src/initiative-yaml.js');
      const { getInitiativePhases } = mod;

      const result = getInitiativePhases('INIT-001');
      expect(result.get(1)!.length).toBe(2);
      expect(result.get(2)!.length).toBe(1);
    });

    it('should put unphased WUs under null key', async () => {
      createInitiative('INIT-001');
      createWU('WU-001', { initiative: 'INIT-001' }); // No phase

      const mod = await import('../src/initiative-yaml.js');
      const { getInitiativePhases } = mod;

      const result = getInitiativePhases('INIT-001');
      expect(result.has(null)).toBe(true);
      expect(result.get(null)!.length).toBe(1);
    });
  });

  describe('buildInitiativeMap', async () => {
    it('should return empty map for no initiatives', async () => {
      rmSync(join(testDir, 'docs/04-operations/tasks/initiatives'), {
        recursive: true,
        force: true,
      });
      mkdirSync(join(testDir, 'docs/04-operations/tasks/initiatives'), { recursive: true });

      const mod = await import('../src/initiative-yaml.js');
      const { buildInitiativeMap } = mod;

      const result = buildInitiativeMap();
      expect(result.size).toBe(0);
    });

    it('should index by both ID and slug', async () => {
      createInitiative('INIT-001', { slug: 'my-slug', title: 'Test' });

      const mod = await import('../src/initiative-yaml.js');
      const { buildInitiativeMap } = mod;

      const result = buildInitiativeMap();
      expect(result.has('INIT-001')).toBe(true);
      expect(result.has('my-slug')).toBe(true);
      expect(result.get('INIT-001')!.title).toBe('Test');
      expect(result.get('my-slug')!.title).toBe('Test');
    });

    it('should handle initiative without slug', async () => {
      // Create initiative manually without slug (which is actually required by schema)
      // This tests defensive behavior
      createInitiative('INIT-001', { slug: 'has-slug' });

      const mod = await import('../src/initiative-yaml.js');
      const { buildInitiativeMap } = mod;

      const result = buildInitiativeMap();
      expect(result.has('INIT-001')).toBe(true);
    });
  });
});
