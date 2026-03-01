// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file lane-create.test.ts
 * WU-2258: Tests for lane:create command
 *
 * TDD RED phase: define behavior for creating lanes safely via tooling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import YAML from 'yaml';
import { WORKSPACE_CONFIG_FILE_NAME } from '@lumenflow/core/config';
import { WORKSPACE_V2_KEYS } from '@lumenflow/core/config-schema';

import {
  applyLaneCreate,
  parseLaneCreateArgs,
  validateLaneCreateName,
  validateLaneCreatePreconditions,
  type LaneCreateOptions,
  type LaneDefinition,
} from '../lane-create.js';

const CONFIG_FILE_NAME = WORKSPACE_CONFIG_FILE_NAME;
const SOFTWARE_DELIVERY_KEY = WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY;

describe('lane:create (WU-2258)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-lane-create-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function writeConfig(doc: Record<string, unknown>): void {
    const configPath = path.join(tempDir, CONFIG_FILE_NAME);
    const workspace = {
      [SOFTWARE_DELIVERY_KEY]: doc,
    };
    fs.writeFileSync(configPath, YAML.stringify(workspace), 'utf-8');
  }

  function makeLockedConfig(definitions: LaneDefinition[]): Record<string, unknown> {
    return {
      lanes: {
        definitions,
        lifecycle: {
          status: 'locked',
          updated_at: new Date().toISOString(),
        },
      },
    };
  }

  describe('parseLaneCreateArgs', () => {
    it('parses required and optional flags', () => {
      const opts = parseLaneCreateArgs([
        '--name',
        'Framework: Kernel',
        '--wip-limit',
        '2',
        '--add-path',
        'packages/@lumenflow/kernel/**',
        '--add-path',
        'packages/@lumenflow/runtime/**',
        '--description',
        'Kernel lane for core runtime changes',
      ]);

      expect(opts).toEqual({
        name: 'Framework: Kernel',
        wipLimit: 2,
        addPaths: ['packages/@lumenflow/kernel/**', 'packages/@lumenflow/runtime/**'],
        description: 'Kernel lane for core runtime changes',
      });
    });

    it('uses wip-limit=1 by default', () => {
      const opts = parseLaneCreateArgs(['--name', 'Framework: Kernel']);
      expect(opts.wipLimit).toBe(1);
    });

    it('requires --name', () => {
      expect(() => parseLaneCreateArgs(['--wip-limit', '2'])).toThrow(/--name is required/);
    });

    it('rejects invalid wip-limit values', () => {
      expect(() => parseLaneCreateArgs(['--name', 'Framework: Kernel', '--wip-limit', '0'])).toThrow(
        /must be a positive integer/,
      );
      expect(() =>
        parseLaneCreateArgs(['--name', 'Framework: Kernel', '--wip-limit', '-1']),
      ).toThrow(/must be a positive integer/);
    });
  });

  describe('validateLaneCreatePreconditions', () => {
    it('allows locked lifecycle', () => {
      writeConfig(
        makeLockedConfig([{ name: 'Framework: Core', wip_limit: 1, code_paths: ['src/core/**'] }]),
      );

      const result = validateLaneCreatePreconditions(tempDir);
      expect(result.ok).toBe(true);
    });

    it('blocks unconfigured lifecycle', () => {
      writeConfig({
        lanes: {
          definitions: [],
          lifecycle: { status: 'unconfigured' },
        },
      });

      const result = validateLaneCreatePreconditions(tempDir);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/locked or draft/);
    });
  });

  describe('validateLaneCreateName', () => {
    it('accepts valid lane format with existing parent taxonomy', () => {
      writeConfig(
        makeLockedConfig([
          { name: 'Framework: Core', wip_limit: 1, code_paths: ['src/core/**'] },
          { name: 'Operations: Tooling', wip_limit: 1, code_paths: ['tools/**'] },
        ]),
      );

      const result = validateLaneCreateName('Framework: Kernel', tempDir);
      expect(result.valid).toBe(true);
    });

    it('rejects invalid lane format', () => {
      writeConfig(
        makeLockedConfig([{ name: 'Framework: Core', wip_limit: 1, code_paths: ['src/core/**'] }]),
      );

      const result = validateLaneCreateName('framework-kernel', tempDir);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid lane format/i);
    });
  });

  describe('applyLaneCreate', () => {
    it('adds a new lane and keeps definitions ordered by name', () => {
      const definitions: LaneDefinition[] = [
        { name: 'Framework: Core', wip_limit: 1, code_paths: ['src/core/**'] },
        { name: 'Operations: Tooling', wip_limit: 1, code_paths: ['tools/**'] },
      ];

      const options: LaneCreateOptions = {
        name: 'Framework: Kernel',
        wipLimit: 2,
        addPaths: ['packages/@lumenflow/kernel/**'],
        description: 'Kernel lane',
      };

      const result = applyLaneCreate(definitions, options);
      expect(result.ok).toBe(true);
      expect(result.definitions?.map((lane) => lane.name)).toEqual([
        'Framework: Core',
        'Framework: Kernel',
        'Operations: Tooling',
      ]);
      expect(result.definitions?.[1]).toMatchObject({
        name: 'Framework: Kernel',
        wip_limit: 2,
        code_paths: ['packages/@lumenflow/kernel/**'],
        description: 'Kernel lane',
      });
    });

    it('rejects duplicate lane names', () => {
      const definitions: LaneDefinition[] = [
        { name: 'Framework: Core', wip_limit: 1, code_paths: ['src/core/**'] },
      ];

      const result = applyLaneCreate(definitions, {
        name: 'Framework: Core',
        wipLimit: 1,
        addPaths: ['src/core/**'],
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/already exists/);
    });
  });
});
