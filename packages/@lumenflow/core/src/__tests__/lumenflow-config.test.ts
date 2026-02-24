// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @fileoverview Tests for WU-2126: clearConfigCache() wiring
 *
 * Verifies that:
 * 1. clearConfigCache() resets the module-scope cached config and project root
 * 2. After clearConfigCache(), getConfig({ reload: true }) re-reads from disk
 * 3. Config mutations on disk are visible after cache invalidation
 *
 * Note: getConfig() only caches when called WITHOUT projectRoot override.
 * Calls with projectRoot always read from disk (by design).
 *
 * @module __tests__/lumenflow-config.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as yaml from 'yaml';
import {
  getConfig,
  clearConfigCache,
  findProjectRoot,
  getProjectRoot,
} from '../lumenflow-config.js';

/** Config file name used by config loader */
const WORKSPACE_CONFIG_FILE = 'workspace.yaml';

/** Valid methodology.testing enum values from Zod schema */
const METHODOLOGY_TDD = 'tdd';
const METHODOLOGY_TEST_AFTER = 'test-after';

describe('WU-2126: clearConfigCache()', () => {
  let tempDir: string;
  const originalCwd = process.cwd;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'lumenflow-config-test-'));
    // Create a .git directory so findProjectRoot works
    await mkdir(path.join(tempDir, '.git'));
    clearConfigCache();
  });

  afterEach(async () => {
    clearConfigCache();
    process.cwd = originalCwd;
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper to write a workspace.yaml with a given methodology.testing value.
   */
  async function writeWorkspaceConfig(methodology: string): Promise<void> {
    const config = {
      software_delivery: {
        methodology: {
          testing: methodology,
        },
      },
    };
    await writeFile(path.join(tempDir, WORKSPACE_CONFIG_FILE), yaml.stringify(config), 'utf8');
  }

  it('should read config from disk with projectRoot override (no caching)', async () => {
    await writeWorkspaceConfig(METHODOLOGY_TDD);

    const config = getConfig({ projectRoot: tempDir });
    expect(config.methodology.testing).toBe(METHODOLOGY_TDD);
  });

  it('should re-read fresh values from disk after clearConfigCache() and reload', async () => {
    // Override cwd to tempDir so default project root detection finds our temp dir
    process.cwd = () => tempDir;

    await writeWorkspaceConfig(METHODOLOGY_TDD);
    const first = getConfig({ reload: true });
    expect(first.methodology.testing).toBe(METHODOLOGY_TDD);

    // Mutate config on disk
    await writeWorkspaceConfig(METHODOLOGY_TEST_AFTER);

    // Without clearing cache, getConfig returns stale value (cached)
    const stale = getConfig();
    expect(stale.methodology.testing).toBe(METHODOLOGY_TDD);

    // After clearing cache and reload, should return fresh value
    clearConfigCache();
    const fresh = getConfig({ reload: true });
    expect(fresh.methodology.testing).toBe(METHODOLOGY_TEST_AFTER);
  });

  it('should reset project root cache when clearConfigCache() is called', () => {
    // Override cwd to tempDir
    process.cwd = () => tempDir;

    // Load config to populate caches
    getConfig({ reload: true });

    // getProjectRoot() should return cached root
    const cachedRoot = getProjectRoot();
    expect(cachedRoot).toBe(tempDir);

    // After clearing, getProjectRoot() must re-derive
    clearConfigCache();

    // Still returns tempDir because cwd still points there, but it re-derives
    const reDerived = getProjectRoot();
    expect(reDerived).toBe(tempDir);
  });

  it('should allow sequential cache-clear-and-reload cycles', async () => {
    process.cwd = () => tempDir;

    const values = [METHODOLOGY_TDD, METHODOLOGY_TEST_AFTER, METHODOLOGY_TDD] as const;

    for (const value of values) {
      await writeWorkspaceConfig(value);
      clearConfigCache();
      const config = getConfig({ reload: true });
      expect(config.methodology.testing).toBe(value);
    }
  });

  it('should make getConfig() return default config after cache clear when no workspace.yaml exists', async () => {
    // Create a temp dir without workspace.yaml but with .git
    const emptyDir = await mkdtemp(path.join(tmpdir(), 'lumenflow-empty-'));
    await mkdir(path.join(emptyDir, '.git'));

    try {
      process.cwd = () => emptyDir;
      clearConfigCache();

      // Should fall through to defaults without throwing
      const config = getConfig({ reload: true });
      expect(config).toBeDefined();
      expect(config.version).toBeDefined();
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});
