/**
 * Tests for pack:publish command (WU-1838)
 *
 * Acceptance criteria:
 * 1. Runs pack:validate before publish
 * 2. Creates tarball of pack contents
 * 3. Uploads to registry with authentication
 * 4. Errors if validation fails
 *
 * TDD: These tests are written BEFORE the implementation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('pack:publish command', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `pack-publish-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /**
   * Helper: create a valid pack directory at the given path.
   */
  function writeValidPack(packDir: string, packId = 'test-pack'): void {
    mkdirSync(join(packDir, 'tools'), { recursive: true });
    writeFileSync(
      join(packDir, 'manifest.yaml'),
      [
        `id: ${packId}`,
        'version: 1.0.0',
        'task_types:',
        '  - task',
        'tools:',
        '  - name: fs:read',
        '    entry: tools/fs-read.ts',
        '    permission: read',
        '    required_scopes:',
        '      - type: path',
        '        pattern: "**"',
        '        access: read',
        'policies:',
        '  - id: workspace.default',
        '    trigger: on_tool_request',
        '    decision: allow',
        'evidence_types:',
        '  - trace',
        'state_aliases:',
        '  active: in_progress',
        'lane_templates:',
        '  - id: framework-core',
        '    title: Framework Core',
      ].join('\n'),
      'utf-8',
    );
    writeFileSync(
      join(packDir, 'tools', 'fs-read.ts'),
      ['import { readFile } from "node:fs/promises";', 'export const tool = readFile;'].join('\n'),
      'utf-8',
    );
  }

  /**
   * Helper: create a mock registry upload function.
   */
  function createMockUploader() {
    const calls: { url: string; tarballPath: string; token: string; integrity: string }[] = [];
    const fn = async (options: {
      registryUrl: string;
      packId: string;
      version: string;
      tarballPath: string;
      token: string;
      integrity: string;
    }) => {
      calls.push({
        url: options.registryUrl,
        tarballPath: options.tarballPath,
        token: options.token,
        integrity: options.integrity,
      });
    };
    return { fn, calls };
  }

  describe('publishPack', () => {
    // AC1: Runs pack:validate before publish
    it('should run validation before publishing', async () => {
      const { publishPack } = await import('../pack-publish.js');

      const packDir = join(tempDir, 'packs', 'test-pack');
      writeValidPack(packDir);
      const uploader = createMockUploader();

      const result = await publishPack({
        packRoot: packDir,
        registryUrl: 'https://registry.lumenflow.dev',
        token: 'test-token',
        uploadFn: uploader.fn,
      });

      expect(result.success).toBe(true);
      expect(result.validation).toBeDefined();
      expect(result.validation!.allPassed).toBe(true);
    });

    // AC4: Errors if validation fails
    it('should fail if pack validation fails', async () => {
      const { publishPack } = await import('../pack-publish.js');

      const packDir = join(tempDir, 'packs', 'bad-pack');
      mkdirSync(packDir, { recursive: true });
      writeFileSync(join(packDir, 'manifest.yaml'), 'id: bad-pack\nversion: not-semver', 'utf-8');
      const uploader = createMockUploader();

      const result = await publishPack({
        packRoot: packDir,
        registryUrl: 'https://registry.lumenflow.dev',
        token: 'test-token',
        uploadFn: uploader.fn,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('validation');

      // Should NOT have called upload
      expect(uploader.calls).toHaveLength(0);
    });

    it('should fail if pack directory does not exist', async () => {
      const { publishPack } = await import('../pack-publish.js');

      const uploader = createMockUploader();

      const result = await publishPack({
        packRoot: join(tempDir, 'nonexistent'),
        registryUrl: 'https://registry.lumenflow.dev',
        token: 'test-token',
        uploadFn: uploader.fn,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      // Should NOT have called upload
      expect(uploader.calls).toHaveLength(0);
    });

    // AC2: Creates tarball of pack contents
    it('should create a tarball of the pack', async () => {
      const { publishPack } = await import('../pack-publish.js');

      const packDir = join(tempDir, 'packs', 'test-pack');
      writeValidPack(packDir);
      const uploader = createMockUploader();

      const result = await publishPack({
        packRoot: packDir,
        registryUrl: 'https://registry.lumenflow.dev',
        token: 'test-token',
        uploadFn: uploader.fn,
      });

      expect(result.success).toBe(true);
      expect(result.tarballPath).toBeDefined();
      expect(existsSync(result.tarballPath!)).toBe(true);
      expect(result.tarballPath!).toMatch(/\.tar\.gz$/);
    });

    // AC3: Uploads to registry with authentication
    it('should upload to registry with authentication token', async () => {
      const { publishPack } = await import('../pack-publish.js');

      const packDir = join(tempDir, 'packs', 'test-pack');
      writeValidPack(packDir);
      const uploader = createMockUploader();

      const result = await publishPack({
        packRoot: packDir,
        registryUrl: 'https://registry.lumenflow.dev',
        token: 'my-secret-token',
        uploadFn: uploader.fn,
      });

      expect(result.success).toBe(true);
      expect(uploader.calls).toHaveLength(1);
      expect(uploader.calls[0].token).toBe('my-secret-token');
      expect(uploader.calls[0].url).toBe('https://registry.lumenflow.dev');
    });

    it('should include integrity hash in upload', async () => {
      const { publishPack } = await import('../pack-publish.js');

      const packDir = join(tempDir, 'packs', 'test-pack');
      writeValidPack(packDir);
      const uploader = createMockUploader();

      const result = await publishPack({
        packRoot: packDir,
        registryUrl: 'https://registry.lumenflow.dev',
        token: 'test-token',
        uploadFn: uploader.fn,
      });

      expect(result.success).toBe(true);
      expect(result.integrity).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(uploader.calls[0].integrity).toBe(result.integrity);
    });

    it('should include tarball path in upload call', async () => {
      const { publishPack } = await import('../pack-publish.js');

      const packDir = join(tempDir, 'packs', 'test-pack');
      writeValidPack(packDir);
      const uploader = createMockUploader();

      const result = await publishPack({
        packRoot: packDir,
        registryUrl: 'https://registry.lumenflow.dev',
        token: 'test-token',
        uploadFn: uploader.fn,
      });

      expect(result.success).toBe(true);
      expect(uploader.calls[0].tarballPath).toBe(result.tarballPath);
    });

    it('should fail if no authentication token is provided', async () => {
      const { publishPack } = await import('../pack-publish.js');

      const packDir = join(tempDir, 'packs', 'test-pack');
      writeValidPack(packDir);
      const uploader = createMockUploader();

      const result = await publishPack({
        packRoot: packDir,
        registryUrl: 'https://registry.lumenflow.dev',
        token: '',
        uploadFn: uploader.fn,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('token');
      expect(uploader.calls).toHaveLength(0);
    });

    it('should fail if upload function throws', async () => {
      const { publishPack } = await import('../pack-publish.js');

      const packDir = join(tempDir, 'packs', 'test-pack');
      writeValidPack(packDir);

      const failingUploader = async () => {
        throw new Error('Registry unavailable');
      };

      const result = await publishPack({
        packRoot: packDir,
        registryUrl: 'https://registry.lumenflow.dev',
        token: 'test-token',
        uploadFn: failingUploader,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Registry unavailable');
    });

    it('should read pack id and version from manifest', async () => {
      const { publishPack } = await import('../pack-publish.js');

      const packDir = join(tempDir, 'packs', 'custom-pack');
      writeValidPack(packDir, 'custom-pack');
      const uploader = createMockUploader();

      const result = await publishPack({
        packRoot: packDir,
        registryUrl: 'https://registry.lumenflow.dev',
        token: 'test-token',
        uploadFn: uploader.fn,
      });

      expect(result.success).toBe(true);
      expect(result.packId).toBe('custom-pack');
      expect(result.version).toBe('1.0.0');
    });

    it('should use custom registry URL', async () => {
      const { publishPack } = await import('../pack-publish.js');

      const packDir = join(tempDir, 'packs', 'test-pack');
      writeValidPack(packDir);
      const uploader = createMockUploader();

      const result = await publishPack({
        packRoot: packDir,
        registryUrl: 'https://custom.registry.example.com',
        token: 'test-token',
        uploadFn: uploader.fn,
      });

      expect(result.success).toBe(true);
      expect(uploader.calls[0].url).toBe('https://custom.registry.example.com');
    });
  });

  describe('createPackTarball', () => {
    it('should create a .tar.gz file in the output directory', async () => {
      const { createPackTarball } = await import('../pack-publish.js');

      const packDir = join(tempDir, 'packs', 'test-pack');
      writeValidPack(packDir);

      const outputDir = join(tempDir, 'output');
      mkdirSync(outputDir, { recursive: true });

      const tarballPath = await createPackTarball({
        packRoot: packDir,
        outputDir,
        packId: 'test-pack',
        version: '1.0.0',
      });

      expect(existsSync(tarballPath)).toBe(true);
      expect(tarballPath).toMatch(/test-pack-1\.0\.0\.tar\.gz$/);
    });

    it('should include pack files in the tarball', async () => {
      const { createPackTarball } = await import('../pack-publish.js');

      const packDir = join(tempDir, 'packs', 'test-pack');
      writeValidPack(packDir);

      const outputDir = join(tempDir, 'output');
      mkdirSync(outputDir, { recursive: true });

      const tarballPath = await createPackTarball({
        packRoot: packDir,
        outputDir,
        packId: 'test-pack',
        version: '1.0.0',
      });

      // Verify tarball was created and is non-empty
      const { statSync } = await import('node:fs');
      const stat = statSync(tarballPath);
      expect(stat.size).toBeGreaterThan(0);
    });
  });

  describe('pack:publish CLI exports', () => {
    it('should export main function for CLI entry', async () => {
      const mod = await import('../pack-publish.js');
      expect(typeof mod.main).toBe('function');
    });

    it('should export LOG_PREFIX constant', async () => {
      const mod = await import('../pack-publish.js');
      expect(typeof mod.LOG_PREFIX).toBe('string');
    });

    it('should export publishPack function', async () => {
      const mod = await import('../pack-publish.js');
      expect(typeof mod.publishPack).toBe('function');
    });

    it('should export createPackTarball function', async () => {
      const mod = await import('../pack-publish.js');
      expect(typeof mod.createPackTarball).toBe('function');
    });
  });
});
