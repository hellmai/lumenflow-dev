#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @file pack-hash.test.ts
 * Tests for the pack:hash CLI command (WU-1825)
 *
 * Verifies that the command:
 * - Outputs sha256:hex string for a valid pack
 * - Hash matches computeDeterministicPackHash output
 * - Exits with error for invalid pack-id
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeDeterministicPackHash } from '@lumenflow/kernel';
import { computePackHash, resolvePackRoot, LOG_PREFIX } from '../pack-hash.js';

describe('pack:hash', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pack-hash-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('resolvePackRoot', () => {
    it('resolves --pack-root directly when provided', () => {
      const result = resolvePackRoot({
        directPackRoot: '/some/path/to/pack',
      });
      expect(result).toBe('/some/path/to/pack');
    });

    it('resolves --id with default packs root', () => {
      const result = resolvePackRoot({
        packId: 'software-delivery',
        packsRoot: 'packages/@lumenflow/packs',
      });
      expect(result).toContain('packages/@lumenflow/packs/software-delivery');
    });

    it('resolves --id with custom packs root', () => {
      const result = resolvePackRoot({
        packId: 'my-pack',
        packsRoot: '/custom/packs',
      });
      expect(result).toBe('/custom/packs/my-pack');
    });

    it('returns null when neither --id nor --pack-root provided', () => {
      const result = resolvePackRoot({});
      expect(result).toBeNull();
    });
  });

  describe('computePackHash', () => {
    it('outputs sha256:hex string for a valid pack', async () => {
      // Create a minimal pack directory
      const packDir = join(tempDir, 'test-pack');
      await mkdir(packDir, { recursive: true });
      await writeFile(join(packDir, 'manifest.yaml'), 'id: test-pack\nversion: 0.1.0\n');
      await writeFile(join(packDir, 'README.md'), '# Test Pack\n');

      const result = await computePackHash({ packRoot: packDir });

      // Must match sha256:<64 hex chars> pattern
      expect(result).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('hash matches computeDeterministicPackHash output', async () => {
      // Create a pack directory with known contents
      const packDir = join(tempDir, 'hash-match-pack');
      await mkdir(packDir, { recursive: true });
      await writeFile(join(packDir, 'manifest.yaml'), 'id: hash-match\nversion: 1.0.0\n');
      await writeFile(join(packDir, 'tool.ts'), 'export const x = 1;\n');

      const cliResult = await computePackHash({ packRoot: packDir });
      const kernelResult = await computeDeterministicPackHash({ packRoot: packDir });

      expect(cliResult).toBe(`sha256:${kernelResult}`);
    });

    it('throws for non-existent pack directory', async () => {
      const nonExistentDir = join(tempDir, 'does-not-exist');

      await expect(computePackHash({ packRoot: nonExistentDir })).rejects.toThrow();
    });
  });

  describe('LOG_PREFIX', () => {
    it('has correct format', () => {
      expect(LOG_PREFIX).toBe('[pack:hash]');
    });
  });
});
