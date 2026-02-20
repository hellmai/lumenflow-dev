// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tests for pack:scaffold command (WU-1823)
 *
 * Acceptance criteria:
 * 1. Generates valid manifest.yaml with skeleton content
 * 2. Generates tool implementation boilerplate with correct function signature
 * 3. Validates pack-id and version format
 * 4. Generated pack passes pack:validate (verified by manifest schema)
 *
 * TDD: These tests are written BEFORE the implementation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import YAML from 'yaml';
import { DomainPackManifestSchema } from '@lumenflow/kernel';

describe('pack:scaffold command', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `pack-scaffold-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('validatePackId', () => {
    it('should accept valid kebab-case pack IDs', async () => {
      const { validatePackId } = await import('../pack-scaffold.js');

      expect(() => validatePackId('my-domain')).not.toThrow();
      expect(() => validatePackId('software-delivery')).not.toThrow();
      expect(() => validatePackId('customer-support')).not.toThrow();
      expect(() => validatePackId('a')).not.toThrow();
    });

    it('should reject invalid pack IDs', async () => {
      const { validatePackId } = await import('../pack-scaffold.js');

      expect(() => validatePackId('')).toThrow();
      expect(() => validatePackId('My Domain')).toThrow();
      expect(() => validatePackId('my_domain')).toThrow();
      expect(() => validatePackId('MyDomain')).toThrow();
      expect(() => validatePackId('my domain')).toThrow();
      expect(() => validatePackId('.hidden')).toThrow();
      expect(() => validatePackId('-start-dash')).toThrow();
      expect(() => validatePackId('end-dash-')).toThrow();
    });
  });

  describe('validateVersion', () => {
    it('should accept valid semver versions', async () => {
      const { validateVersion } = await import('../pack-scaffold.js');

      expect(() => validateVersion('0.1.0')).not.toThrow();
      expect(() => validateVersion('1.0.0')).not.toThrow();
      expect(() => validateVersion('2.3.4')).not.toThrow();
      expect(() => validateVersion('1.0.0-beta.1')).not.toThrow();
    });

    it('should reject invalid versions', async () => {
      const { validateVersion } = await import('../pack-scaffold.js');

      expect(() => validateVersion('')).toThrow();
      expect(() => validateVersion('1.0')).toThrow();
      expect(() => validateVersion('v1.0.0')).toThrow();
      expect(() => validateVersion('abc')).toThrow();
    });
  });

  describe('scaffoldPack', () => {
    it('should create pack directory structure', async () => {
      const { scaffoldPack } = await import('../pack-scaffold.js');

      const result = scaffoldPack({
        outputDir: tempDir,
        packId: 'my-domain',
        version: '0.1.0',
      });

      const packDir = join(tempDir, 'my-domain');
      expect(existsSync(packDir)).toBe(true);
      expect(existsSync(join(packDir, 'manifest.yaml'))).toBe(true);
      expect(existsSync(join(packDir, 'tools'))).toBe(true);
      expect(existsSync(join(packDir, 'tool-impl'))).toBe(true);
      expect(existsSync(join(packDir, 'README.md'))).toBe(true);
      expect(result.packDir).toBe(packDir);
    });

    // AC1: Generates valid manifest.yaml with skeleton content
    it('should generate valid manifest.yaml with skeleton content', async () => {
      const { scaffoldPack } = await import('../pack-scaffold.js');

      scaffoldPack({
        outputDir: tempDir,
        packId: 'my-domain',
        version: '0.1.0',
      });

      const manifestPath = join(tempDir, 'my-domain', 'manifest.yaml');
      const manifestContent = readFileSync(manifestPath, 'utf-8');
      const manifest = YAML.parse(manifestContent);

      expect(manifest.id).toBe('my-domain');
      expect(manifest.version).toBe('0.1.0');
      expect(manifest.task_types).toEqual(expect.arrayContaining([expect.any(String)]));
      expect(Array.isArray(manifest.tools)).toBe(true);
      expect(Array.isArray(manifest.policies)).toBe(true);
    });

    // AC2: Generates tool implementation boilerplate with correct function signature
    it('should generate tool implementation boilerplate', async () => {
      const { scaffoldPack } = await import('../pack-scaffold.js');

      scaffoldPack({
        outputDir: tempDir,
        packId: 'my-domain',
        version: '0.1.0',
        toolNames: ['my-tool'],
      });

      const toolImplPath = join(tempDir, 'my-domain', 'tool-impl', 'my-tool.ts');
      expect(existsSync(toolImplPath)).toBe(true);

      const toolContent = readFileSync(toolImplPath, 'utf-8');
      // Must have a function with correct tool signature (ToolRequest, ToolContext)
      expect(toolContent).toContain('ToolRequest');
      expect(toolContent).toContain('ToolContext');
      expect(toolContent).toContain('ToolResult');
      expect(toolContent).toContain('export');
    });

    it('should generate tool descriptor in tools directory', async () => {
      const { scaffoldPack } = await import('../pack-scaffold.js');

      scaffoldPack({
        outputDir: tempDir,
        packId: 'my-domain',
        version: '0.1.0',
        toolNames: ['my-tool'],
      });

      const toolDescPath = join(tempDir, 'my-domain', 'tools', 'my-tool.ts');
      expect(existsSync(toolDescPath)).toBe(true);

      const content = readFileSync(toolDescPath, 'utf-8');
      expect(content).toContain('my-tool');
    });

    // AC3: Validates pack-id and version format (already covered by validatePackId/validateVersion tests)
    // But also verify scaffoldPack rejects invalid inputs
    it('should reject invalid pack-id in scaffoldPack', async () => {
      const { scaffoldPack } = await import('../pack-scaffold.js');

      expect(() =>
        scaffoldPack({
          outputDir: tempDir,
          packId: 'INVALID ID',
          version: '0.1.0',
        }),
      ).toThrow();
    });

    it('should reject invalid version in scaffoldPack', async () => {
      const { scaffoldPack } = await import('../pack-scaffold.js');

      expect(() =>
        scaffoldPack({
          outputDir: tempDir,
          packId: 'my-domain',
          version: 'bad',
        }),
      ).toThrow();
    });

    // AC4: Generated pack passes pack:validate (manifest schema validation)
    it('should generate manifest that passes DomainPackManifestSchema validation', async () => {
      const { scaffoldPack } = await import('../pack-scaffold.js');

      scaffoldPack({
        outputDir: tempDir,
        packId: 'my-domain',
        version: '0.1.0',
        taskTypes: ['custom-task'],
        toolNames: ['my-tool'],
      });

      const manifestPath = join(tempDir, 'my-domain', 'manifest.yaml');
      const manifestContent = readFileSync(manifestPath, 'utf-8');
      const manifest = YAML.parse(manifestContent);

      // This is the critical test: the generated manifest must pass the kernel schema
      const result = DomainPackManifestSchema.safeParse(manifest);
      expect(result.success).toBe(true);
    });

    it('should not overwrite existing pack directory', async () => {
      const { scaffoldPack } = await import('../pack-scaffold.js');

      // Create existing directory
      mkdirSync(join(tempDir, 'existing-pack'), { recursive: true });

      expect(() =>
        scaffoldPack({
          outputDir: tempDir,
          packId: 'existing-pack',
          version: '0.1.0',
        }),
      ).toThrow(/already exists/);
    });

    it('should use default task type when none provided', async () => {
      const { scaffoldPack } = await import('../pack-scaffold.js');

      scaffoldPack({
        outputDir: tempDir,
        packId: 'my-domain',
        version: '0.1.0',
      });

      const manifestPath = join(tempDir, 'my-domain', 'manifest.yaml');
      const manifest = YAML.parse(readFileSync(manifestPath, 'utf-8'));

      expect(manifest.task_types.length).toBeGreaterThanOrEqual(1);
    });

    it('should use custom task types when provided', async () => {
      const { scaffoldPack } = await import('../pack-scaffold.js');

      scaffoldPack({
        outputDir: tempDir,
        packId: 'my-domain',
        version: '0.1.0',
        taskTypes: ['investigation', 'remediation'],
      });

      const manifestPath = join(tempDir, 'my-domain', 'manifest.yaml');
      const manifest = YAML.parse(readFileSync(manifestPath, 'utf-8'));

      expect(manifest.task_types).toEqual(['investigation', 'remediation']);
    });

    it('should scaffold multiple tools when provided', async () => {
      const { scaffoldPack } = await import('../pack-scaffold.js');

      scaffoldPack({
        outputDir: tempDir,
        packId: 'my-domain',
        version: '0.1.0',
        toolNames: ['read-data', 'write-data'],
      });

      expect(existsSync(join(tempDir, 'my-domain', 'tool-impl', 'read-data.ts'))).toBe(true);
      expect(existsSync(join(tempDir, 'my-domain', 'tool-impl', 'write-data.ts'))).toBe(true);
      expect(existsSync(join(tempDir, 'my-domain', 'tools', 'read-data.ts'))).toBe(true);
      expect(existsSync(join(tempDir, 'my-domain', 'tools', 'write-data.ts'))).toBe(true);

      // Manifest should reference both tools
      const manifest = YAML.parse(
        readFileSync(join(tempDir, 'my-domain', 'manifest.yaml'), 'utf-8'),
      );
      expect(manifest.tools.length).toBe(2);
      expect(manifest.tools[0].name).toBe('read-data');
      expect(manifest.tools[1].name).toBe('write-data');
    });

    it('should generate README with pack name and description', async () => {
      const { scaffoldPack } = await import('../pack-scaffold.js');

      scaffoldPack({
        outputDir: tempDir,
        packId: 'my-domain',
        version: '0.1.0',
      });

      const readmePath = join(tempDir, 'my-domain', 'README.md');
      const content = readFileSync(readmePath, 'utf-8');
      expect(content).toContain('my-domain');
      expect(content).toContain('0.1.0');
    });
  });

  describe('pack:scaffold CLI exports', () => {
    it('should export main function for CLI entry', async () => {
      const mod = await import('../pack-scaffold.js');
      expect(typeof mod.main).toBe('function');
    });

    it('should export LOG_PREFIX constant', async () => {
      const mod = await import('../pack-scaffold.js');
      expect(typeof mod.LOG_PREFIX).toBe('string');
    });
  });
});
