/**
 * Tests for pack:install --source registry HTTP fetch path (WU-1875)
 *
 * Acceptance criteria:
 * 1. pack:install --source registry fetches tarball from registry API endpoint
 * 2. SHA-256 integrity verification before tarball extraction
 * 3. FetchFn port injected for testability (no real HTTP calls in tests)
 * 4. Meaningful error messages for network failures, integrity mismatches, and 404s
 * 5. Backward compatible: local and git sources continue to work
 *
 * TDD: These tests are written BEFORE the implementation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import type { FetchFn } from '../pack-install.js';

describe('pack:install --source registry (WU-1875)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `pack-install-registry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
  function writeValidPack(packDir: string): void {
    mkdirSync(join(packDir, 'tools'), { recursive: true });
    writeFileSync(
      join(packDir, 'manifest.yaml'),
      [
        'id: test-pack',
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
   * Helper: create a minimal workspace.yaml.
   */
  function writeWorkspaceYaml(workspaceDir: string, packs: unknown[] = []): void {
    const workspace = {
      id: 'test-workspace',
      name: 'Test Workspace',
      packs,
      lanes: [
        {
          id: 'framework-core',
          title: 'Framework Core',
          allowed_scopes: [],
        },
      ],
      policies: {},
      security: {
        allowed_scopes: [{ type: 'path', pattern: '**', access: 'read' }],
        network_default: 'off',
        deny_overlays: [],
      },
      memory_namespace: 'test',
      event_namespace: 'test',
    };
    writeFileSync(join(workspaceDir, 'workspace.yaml'), YAML.stringify(workspace), 'utf-8');
  }

  /**
   * Helper: create a tarball from a pack directory and return its buffer + sha256 hash.
   */
  function createPackTarball(packDir: string): { buffer: Buffer; sha256: string } {
    const tarballPath = join(tempDir, 'test-pack.tar.gz');
    execFileSync('tar', ['-czf', tarballPath, '-C', packDir, '.']);
    const buffer = readFileSync(tarballPath) as Buffer;
    const hash = createHash('sha256').update(buffer).digest('hex');
    return { buffer, sha256: hash };
  }

  /**
   * Helper: create a mock FetchFn that returns a given buffer with integrity header.
   */
  function createMockFetchFn(
    tarballBuffer: Buffer,
    integrity: string,
    options?: { status?: number; statusText?: string },
  ): FetchFn {
    const status = options?.status ?? 200;
    const statusText = options?.statusText ?? 'OK';

    return vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText,
      headers: new Headers({
        'content-type': 'application/gzip',
      }),
      arrayBuffer: () =>
        Promise.resolve(
          tarballBuffer.buffer.slice(
            tarballBuffer.byteOffset,
            tarballBuffer.byteOffset + tarballBuffer.byteLength,
          ),
        ),
      text: () => Promise.resolve(`${status} ${statusText}`),
    } as unknown as Response);
  }

  /**
   * Helper: create a mock FetchFn that rejects (network error).
   */
  function createFailingFetchFn(errorMessage: string): FetchFn {
    return vi.fn().mockRejectedValue(new Error(errorMessage));
  }

  // --- AC1: pack:install --source registry fetches tarball from registry API endpoint ---

  describe('AC1: fetches tarball from registry API endpoint', () => {
    it('should fetch tarball from {registryUrl}/api/registry/packs/{id}/versions/{version}/tarball', async () => {
      const { installPackFromRegistry } = await import('../pack-install.js');

      const packDir = join(tempDir, 'source-pack');
      writeValidPack(packDir);
      writeWorkspaceYaml(tempDir);

      const { buffer, sha256 } = createPackTarball(packDir);
      const mockFetch = createMockFetchFn(buffer, sha256);

      const result = await installPackFromRegistry({
        workspaceRoot: tempDir,
        packId: 'test-pack',
        version: '1.0.0',
        registryUrl: 'https://registry.lumenflow.dev',
        integrity: `sha256:${sha256}`,
        fetchFn: mockFetch,
      });

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify the URL called
      const calledUrl = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toBe(
        'https://registry.lumenflow.dev/api/registry/packs/test-pack/versions/1.0.0/tarball',
      );
    });

    it('should install pack pin into workspace.yaml with registry source', async () => {
      const { installPackFromRegistry } = await import('../pack-install.js');

      const packDir = join(tempDir, 'source-pack');
      writeValidPack(packDir);
      writeWorkspaceYaml(tempDir);

      const { buffer, sha256 } = createPackTarball(packDir);
      const mockFetch = createMockFetchFn(buffer, sha256);

      const result = await installPackFromRegistry({
        workspaceRoot: tempDir,
        packId: 'test-pack',
        version: '1.0.0',
        registryUrl: 'https://registry.lumenflow.dev',
        integrity: `sha256:${sha256}`,
        fetchFn: mockFetch,
      });

      expect(result.success).toBe(true);
      expect(result.integrity).toMatch(/^sha256:[a-f0-9]{64}$/);

      // Read back workspace.yaml and verify the PackPin
      const workspaceContent = readFileSync(join(tempDir, 'workspace.yaml'), 'utf-8');
      const workspace = YAML.parse(workspaceContent) as { packs: unknown[] };

      expect(workspace.packs).toHaveLength(1);
      const pin = workspace.packs[0] as {
        id: string;
        version: string;
        source: string;
        integrity: string;
        registry_url: string;
      };
      expect(pin.id).toBe('test-pack');
      expect(pin.version).toBe('1.0.0');
      expect(pin.source).toBe('registry');
      expect(pin.registry_url).toBe('https://registry.lumenflow.dev');
    });
  });

  // --- AC2: SHA-256 integrity verification before tarball extraction ---

  describe('AC2: SHA-256 integrity verification', () => {
    it('should verify SHA-256 hash of downloaded tarball before extraction', async () => {
      const { installPackFromRegistry } = await import('../pack-install.js');

      const packDir = join(tempDir, 'source-pack');
      writeValidPack(packDir);
      writeWorkspaceYaml(tempDir);

      const { buffer, sha256 } = createPackTarball(packDir);
      const mockFetch = createMockFetchFn(buffer, sha256);

      const result = await installPackFromRegistry({
        workspaceRoot: tempDir,
        packId: 'test-pack',
        version: '1.0.0',
        registryUrl: 'https://registry.lumenflow.dev',
        integrity: `sha256:${sha256}`,
        fetchFn: mockFetch,
      });

      expect(result.success).toBe(true);
    });

    it('should fail with integrity mismatch error when hash does not match', async () => {
      const { installPackFromRegistry } = await import('../pack-install.js');

      const packDir = join(tempDir, 'source-pack');
      writeValidPack(packDir);
      writeWorkspaceYaml(tempDir);

      const { buffer } = createPackTarball(packDir);
      const wrongHash = 'a'.repeat(64);
      const mockFetch = createMockFetchFn(buffer, wrongHash);

      const result = await installPackFromRegistry({
        workspaceRoot: tempDir,
        packId: 'test-pack',
        version: '1.0.0',
        registryUrl: 'https://registry.lumenflow.dev',
        integrity: `sha256:${wrongHash}`,
        fetchFn: mockFetch,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/integrity/i);
    });
  });

  // --- AC3: FetchFn port injected for testability ---

  describe('AC3: FetchFn port injection', () => {
    it('should use injected FetchFn instead of global fetch', async () => {
      const { installPackFromRegistry } = await import('../pack-install.js');

      const packDir = join(tempDir, 'source-pack');
      writeValidPack(packDir);
      writeWorkspaceYaml(tempDir);

      const { buffer, sha256 } = createPackTarball(packDir);
      const mockFetch = createMockFetchFn(buffer, sha256);

      await installPackFromRegistry({
        workspaceRoot: tempDir,
        packId: 'test-pack',
        version: '1.0.0',
        registryUrl: 'https://registry.lumenflow.dev',
        integrity: `sha256:${sha256}`,
        fetchFn: mockFetch,
      });

      // The mock should have been called, proving no real HTTP calls were made
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should export FetchFn type for external consumers', async () => {
      // This test verifies the type is exported (compile-time check)
      const mod = await import('../pack-install.js');
      // installPackFromRegistry should exist
      expect(typeof mod.installPackFromRegistry).toBe('function');
    });
  });

  // --- AC4: Meaningful error messages ---

  describe('AC4: meaningful error messages', () => {
    it('should return meaningful error for network failures', async () => {
      const { installPackFromRegistry } = await import('../pack-install.js');

      writeWorkspaceYaml(tempDir);

      const mockFetch = createFailingFetchFn('ECONNREFUSED: connection refused');

      const result = await installPackFromRegistry({
        workspaceRoot: tempDir,
        packId: 'test-pack',
        version: '1.0.0',
        registryUrl: 'https://registry.lumenflow.dev',
        integrity: 'sha256:' + 'a'.repeat(64),
        fetchFn: mockFetch,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('should return meaningful error for 404 Not Found', async () => {
      const { installPackFromRegistry } = await import('../pack-install.js');

      writeWorkspaceYaml(tempDir);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve('Pack not found'),
      } as unknown as Response);

      const result = await installPackFromRegistry({
        workspaceRoot: tempDir,
        packId: 'nonexistent-pack',
        version: '1.0.0',
        registryUrl: 'https://registry.lumenflow.dev',
        integrity: 'sha256:' + 'a'.repeat(64),
        fetchFn: mockFetch,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/404|not found/i);
    });

    it('should return meaningful error for 500 server errors', async () => {
      const { installPackFromRegistry } = await import('../pack-install.js');

      writeWorkspaceYaml(tempDir);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Server error'),
      } as unknown as Response);

      const result = await installPackFromRegistry({
        workspaceRoot: tempDir,
        packId: 'test-pack',
        version: '1.0.0',
        registryUrl: 'https://registry.lumenflow.dev',
        integrity: 'sha256:' + 'a'.repeat(64),
        fetchFn: mockFetch,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/500/);
    });
  });

  // --- AC5: Backward compatible: local and git sources continue to work ---

  describe('AC5: backward compatibility', () => {
    it('should still support local source (no fetch needed)', async () => {
      const { installPack } = await import('../pack-install.js');

      const packDir = join(tempDir, 'packs', 'test-pack');
      writeValidPack(packDir);
      writeWorkspaceYaml(tempDir);

      const result = await installPack({
        workspaceRoot: tempDir,
        packId: 'test-pack',
        source: 'local',
        version: '1.0.0',
        packRoot: packDir,
      });

      expect(result.success).toBe(true);

      const workspaceContent = readFileSync(join(tempDir, 'workspace.yaml'), 'utf-8');
      const workspace = YAML.parse(workspaceContent) as { packs: unknown[] };
      const pin = workspace.packs[0] as { id: string; source: string };
      expect(pin.id).toBe('test-pack');
      expect(pin.source).toBe('local');
    });

    it('should still support git source (no fetch needed)', async () => {
      const { installPack } = await import('../pack-install.js');

      const packDir = join(tempDir, 'packs', 'test-pack');
      writeValidPack(packDir);
      writeWorkspaceYaml(tempDir);

      const result = await installPack({
        workspaceRoot: tempDir,
        packId: 'test-pack',
        source: 'git',
        version: '1.0.0',
        url: 'https://github.com/example/test-pack.git',
        packRoot: packDir,
      });

      expect(result.success).toBe(true);

      const workspaceContent = readFileSync(join(tempDir, 'workspace.yaml'), 'utf-8');
      const workspace = YAML.parse(workspaceContent) as { packs: unknown[] };
      const pin = workspace.packs[0] as { id: string; source: string; url: string };
      expect(pin.id).toBe('test-pack');
      expect(pin.source).toBe('git');
      expect(pin.url).toBe('https://github.com/example/test-pack.git');
    });
  });
});
