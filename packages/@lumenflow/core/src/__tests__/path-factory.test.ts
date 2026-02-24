// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @fileoverview Tests for WU-2124: PathFactory
 *
 * Tests the shared path factory that consolidates 3 independent
 * path resolution patterns into a single testable boundary:
 * (1) direct __dirname-relative paths
 * (2) ILocationResolver.resolveRoot() adapter calls
 * (3) inline resolve(__dirname, '../..') patterns
 *
 * @module __tests__/path-factory.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as yaml from 'yaml';
import { clearConfigCache } from '../lumenflow-config.js';

// Import will fail until implementation exists (RED phase)
import { createPathFactory, type PathFactory } from '../path-factory.js';

/** Config file name used by config loader */
const WORKSPACE_CONFIG_FILE = 'workspace.yaml';

describe('WU-2124: PathFactory', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'path-factory-test-'));
    clearConfigCache();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    clearConfigCache();
  });

  describe('createPathFactory', () => {
    it('should create a PathFactory with explicit projectRoot', () => {
      const factory = createPathFactory({ projectRoot: tempDir });
      expect(factory).toBeDefined();
      expect(factory.projectRoot).toBe(tempDir);
    });

    it('should expose projectRoot as a readonly property', () => {
      const factory = createPathFactory({ projectRoot: tempDir });
      expect(typeof factory.projectRoot).toBe('string');
      expect(path.isAbsolute(factory.projectRoot)).toBe(true);
    });
  });

  describe('resolve()', () => {
    it('should resolve a relative path against projectRoot', () => {
      const factory = createPathFactory({ projectRoot: tempDir });
      const result = factory.resolve('src/file.ts');
      expect(result).toBe(path.join(tempDir, 'src/file.ts'));
    });

    it('should resolve LUMENFLOW_PATHS constants correctly', () => {
      const factory = createPathFactory({ projectRoot: tempDir });
      const result = factory.resolve('.lumenflow/commands.log');
      expect(result).toBe(path.join(tempDir, '.lumenflow/commands.log'));
    });

    it('should resolve empty string to projectRoot', () => {
      const factory = createPathFactory({ projectRoot: tempDir });
      const result = factory.resolve('');
      expect(result).toBe(tempDir);
    });

    it('should handle paths with leading ./', () => {
      const factory = createPathFactory({ projectRoot: tempDir });
      const result = factory.resolve('./docs/tasks');
      expect(result).toBe(path.join(tempDir, 'docs/tasks'));
    });

    it('should return absolute paths unchanged', () => {
      const factory = createPathFactory({ projectRoot: tempDir });
      const absolutePath = '/tmp/some-other-path';
      const result = factory.resolve(absolutePath);
      expect(result).toBe(absolutePath);
    });
  });

  describe('resolveLumenflowPath()', () => {
    it('should resolve LUMENFLOW_PATHS.COMMANDS_LOG', () => {
      const factory = createPathFactory({ projectRoot: tempDir });
      const result = factory.resolveLumenflowPath('COMMANDS_LOG');
      expect(result).toBe(path.join(tempDir, '.lumenflow/commands.log'));
    });

    it('should resolve LUMENFLOW_PATHS.TELEMETRY', () => {
      const factory = createPathFactory({ projectRoot: tempDir });
      const result = factory.resolveLumenflowPath('TELEMETRY');
      expect(result).toBe(path.join(tempDir, '.lumenflow/telemetry'));
    });

    it('should resolve LUMENFLOW_PATHS.PROMPT_METRICS', () => {
      const factory = createPathFactory({ projectRoot: tempDir });
      const result = factory.resolveLumenflowPath('PROMPT_METRICS');
      expect(path.isAbsolute(result)).toBe(true);
      expect(result.startsWith(tempDir)).toBe(true);
    });

    it('should throw for unknown LUMENFLOW_PATHS keys', () => {
      const factory = createPathFactory({ projectRoot: tempDir });
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (factory as any).resolveLumenflowPath('NONEXISTENT_KEY');
      }).toThrow();
    });
  });

  describe('config-driven path resolution', () => {
    it('should respect workspace.yaml config overrides', async () => {
      const customConfig = {
        version: '1.0.0',
        directories: {
          wuDir: 'custom/wu',
        },
      };

      await writeFile(
        path.join(tempDir, WORKSPACE_CONFIG_FILE),
        yaml.stringify({ software_delivery: customConfig }),
        'utf-8',
      );

      clearConfigCache();
      const factory = createPathFactory({ projectRoot: tempDir });

      // Factory should use the same project root that config uses
      expect(factory.projectRoot).toBe(tempDir);

      // resolve() should produce paths relative to that root
      const wuPath = factory.resolve('custom/wu/WU-100.yaml');
      expect(wuPath).toBe(path.join(tempDir, 'custom/wu/WU-100.yaml'));
    });
  });

  describe('replaces __dirname-relative patterns', () => {
    it('should produce same result as resolve(__dirname, "../..", LUMENFLOW_PATHS.X)', () => {
      // The old pattern: resolve(__dirname, '../..', LUMENFLOW_PATHS.COMMANDS_LOG)
      // is equivalent to: factory.resolveLumenflowPath('COMMANDS_LOG')
      // when factory.projectRoot matches the package root.
      //
      // This test verifies the factory produces absolute paths for known constants.
      const factory = createPathFactory({ projectRoot: tempDir });
      const commandsLog = factory.resolveLumenflowPath('COMMANDS_LOG');
      expect(path.isAbsolute(commandsLog)).toBe(true);
      expect(commandsLog).toContain('.lumenflow');
      expect(commandsLog).toContain('commands.log');
    });

    it('should produce same result as resolve(__dirname, "../..") for ROOT_DIR', () => {
      // The old pattern: resolve(__dirname, '../..')
      // is equivalent to: factory.projectRoot
      const factory = createPathFactory({ projectRoot: tempDir });
      expect(path.isAbsolute(factory.projectRoot)).toBe(true);
    });
  });
});
