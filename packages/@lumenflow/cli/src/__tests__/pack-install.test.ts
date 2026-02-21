// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tests for pack:install command (WU-1827)
 *
 * Acceptance criteria:
 * 1. Adds PackPin entry to workspace.yaml
 * 2. Runs pack:validate on resolved pack
 * 3. Computes and pins integrity hash
 * 4. Errors if pack fails validation
 *
 * TDD: These tests are written BEFORE the implementation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import YAML from 'yaml';

describe('pack:install command', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `pack-install-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
      software_delivery: {},
      memory_namespace: 'test',
      event_namespace: 'test',
    };
    writeFileSync(join(workspaceDir, 'workspace.yaml'), YAML.stringify(workspace), 'utf-8');
  }

  describe('installPack', () => {
    // AC1: Adds PackPin entry to workspace.yaml
    it('should add a PackPin entry to workspace.yaml for a local pack', async () => {
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

      // Read back workspace.yaml and verify the PackPin was added
      const workspaceContent = readFileSync(join(tempDir, 'workspace.yaml'), 'utf-8');
      const workspace = YAML.parse(workspaceContent) as { packs: unknown[] };

      expect(workspace.packs).toHaveLength(1);
      const pin = workspace.packs[0] as {
        id: string;
        version: string;
        source: string;
        integrity: string;
      };
      expect(pin.id).toBe('test-pack');
      expect(pin.version).toBe('1.0.0');
      expect(pin.source).toBe('local');
      expect(pin.integrity).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('should add a PackPin with url for git source', async () => {
      const { installPack } = await import('../pack-install.js');

      const packDir = join(tempDir, 'packs', 'test-pack');
      writeValidPack(packDir);
      writeWorkspaceYaml(tempDir);

      const gitUrl = 'https://github.com/example/test-pack.git';
      const result = await installPack({
        workspaceRoot: tempDir,
        packId: 'test-pack',
        source: 'git',
        version: '1.0.0',
        url: gitUrl,
        packRoot: packDir,
      });

      expect(result.success).toBe(true);

      const workspaceContent = readFileSync(join(tempDir, 'workspace.yaml'), 'utf-8');
      const workspace = YAML.parse(workspaceContent) as { packs: unknown[] };

      const pin = workspace.packs[0] as { id: string; url: string; source: string };
      expect(pin.id).toBe('test-pack');
      expect(pin.source).toBe('git');
      expect(pin.url).toBe(gitUrl);
    });

    it('should preserve existing packs in workspace.yaml', async () => {
      const { installPack } = await import('../pack-install.js');

      const packDir = join(tempDir, 'packs', 'new-pack');
      mkdirSync(join(packDir, 'tools'), { recursive: true });
      writeFileSync(
        join(packDir, 'manifest.yaml'),
        [
          'id: new-pack',
          'version: 0.2.0',
          'task_types:',
          '  - task',
          'tools: []',
          'policies: []',
          'evidence_types: []',
          'state_aliases: {}',
          'lane_templates: []',
        ].join('\n'),
        'utf-8',
      );

      const existingPin = {
        id: 'existing-pack',
        version: '1.0.0',
        integrity: 'dev',
        source: 'local',
      };
      writeWorkspaceYaml(tempDir, [existingPin]);

      const result = await installPack({
        workspaceRoot: tempDir,
        packId: 'new-pack',
        source: 'local',
        version: '0.2.0',
        packRoot: packDir,
      });

      expect(result.success).toBe(true);

      const workspaceContent = readFileSync(join(tempDir, 'workspace.yaml'), 'utf-8');
      const workspace = YAML.parse(workspaceContent) as { packs: unknown[] };

      // Should have both packs
      expect(workspace.packs).toHaveLength(2);
      const ids = (workspace.packs as { id: string }[]).map((p) => p.id);
      expect(ids).toContain('existing-pack');
      expect(ids).toContain('new-pack');
    });

    it('should update existing PackPin if pack already in workspace', async () => {
      const { installPack } = await import('../pack-install.js');

      const packDir = join(tempDir, 'packs', 'test-pack');
      writeValidPack(packDir);

      const oldPin = {
        id: 'test-pack',
        version: '0.9.0',
        integrity: 'dev',
        source: 'local',
      };
      writeWorkspaceYaml(tempDir, [oldPin]);

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

      // Should still have exactly one pack (updated, not duplicated)
      expect(workspace.packs).toHaveLength(1);
      const pin = workspace.packs[0] as { id: string; version: string; integrity: string };
      expect(pin.id).toBe('test-pack');
      expect(pin.version).toBe('1.0.0');
      expect(pin.integrity).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    // AC2: Runs pack:validate on resolved pack
    it('should include validation result in install output', async () => {
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
      expect(result.validation).toBeDefined();
      expect(result.validation.allPassed).toBe(true);
    });

    // AC3: Computes and pins integrity hash
    it('should compute and store sha256 integrity hash', async () => {
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
      expect(result.integrity).toMatch(/^sha256:[a-f0-9]{64}$/);

      // Verify it's also in workspace.yaml
      const workspaceContent = readFileSync(join(tempDir, 'workspace.yaml'), 'utf-8');
      const workspace = YAML.parse(workspaceContent) as { packs: unknown[] };
      const pin = workspace.packs[0] as { integrity: string };
      expect(pin.integrity).toBe(result.integrity);
    });

    // AC4: Errors if pack fails validation
    it('should fail if pack has invalid manifest', async () => {
      const { installPack } = await import('../pack-install.js');

      const packDir = join(tempDir, 'packs', 'bad-pack');
      mkdirSync(packDir, { recursive: true });
      writeFileSync(join(packDir, 'manifest.yaml'), 'id: bad-pack\nversion: not-semver', 'utf-8');
      writeWorkspaceYaml(tempDir);

      const result = await installPack({
        workspaceRoot: tempDir,
        packId: 'bad-pack',
        source: 'local',
        version: '1.0.0',
        packRoot: packDir,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('validation');

      // workspace.yaml should NOT be modified
      const workspaceContent = readFileSync(join(tempDir, 'workspace.yaml'), 'utf-8');
      const workspace = YAML.parse(workspaceContent) as { packs: unknown[] };
      expect(workspace.packs).toHaveLength(0);
    });

    it('should fail if pack directory does not exist', async () => {
      const { installPack } = await import('../pack-install.js');

      writeWorkspaceYaml(tempDir);

      const result = await installPack({
        workspaceRoot: tempDir,
        packId: 'nonexistent',
        source: 'local',
        version: '1.0.0',
        packRoot: join(tempDir, 'packs', 'nonexistent'),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should fail if workspace.yaml does not exist', async () => {
      const { installPack } = await import('../pack-install.js');

      const packDir = join(tempDir, 'packs', 'test-pack');
      writeValidPack(packDir);

      const result = await installPack({
        workspaceRoot: tempDir,
        packId: 'test-pack',
        source: 'local',
        version: '1.0.0',
        packRoot: packDir,
      });

      // Since workspace.yaml doesn't exist, it should fail
      // (user must run lumenflow init first)
      expect(result.success).toBe(false);
      expect(result.error).toContain('workspace.yaml');
    });

    it('should add registry_url for registry source', async () => {
      const { installPack } = await import('../pack-install.js');

      const packDir = join(tempDir, 'packs', 'test-pack');
      writeValidPack(packDir);
      writeWorkspaceYaml(tempDir);

      const registryUrl = 'https://custom.registry.dev';
      const result = await installPack({
        workspaceRoot: tempDir,
        packId: 'test-pack',
        source: 'registry',
        version: '1.0.0',
        registryUrl,
        packRoot: packDir,
      });

      expect(result.success).toBe(true);

      const workspaceContent = readFileSync(join(tempDir, 'workspace.yaml'), 'utf-8');
      const workspace = YAML.parse(workspaceContent) as { packs: unknown[] };

      const pin = workspace.packs[0] as { source: string; registry_url: string };
      expect(pin.source).toBe('registry');
      expect(pin.registry_url).toBe(registryUrl);
    });
  });

  describe('pack:install CLI exports', () => {
    it('should export main function for CLI entry', async () => {
      const mod = await import('../pack-install.js');
      expect(typeof mod.main).toBe('function');
    });

    it('should export LOG_PREFIX constant', async () => {
      const mod = await import('../pack-install.js');
      expect(typeof mod.LOG_PREFIX).toBe('string');
    });
  });
});
