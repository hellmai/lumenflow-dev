// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file lane-edit.test.ts
 * WU-1854: Tests for lane:edit command
 *
 * Tests the pure lane mutation logic extracted for testability.
 * The micro-worktree integration is tested via manual verification.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import YAML from 'yaml';
import { WORKSPACE_CONFIG_FILE_NAME } from '@lumenflow/core/config';
import { WORKSPACE_V2_KEYS } from '@lumenflow/core/config-schema';

import {
  applyLaneEdit,
  parseLaneEditArgs,
  validateLaneEditPreconditions,
  type LaneEditOptions,
  type LaneDefinition,
} from '../lane-edit.js';

const CONFIG_FILE_NAME = WORKSPACE_CONFIG_FILE_NAME;
const LANE_INFERENCE_FILE_NAME = '.lumenflow.lane-inference.yaml';
const SOFTWARE_DELIVERY_KEY = WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY;

describe('lane:edit (WU-1854)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-lane-edit-'));
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

  function writeLaneInference(content: string): void {
    const inferencePath = path.join(tempDir, LANE_INFERENCE_FILE_NAME);
    fs.writeFileSync(inferencePath, content, 'utf-8');
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

  function makeDraftConfig(definitions: LaneDefinition[]): Record<string, unknown> {
    return {
      lanes: {
        definitions,
        lifecycle: {
          status: 'draft',
          updated_at: new Date().toISOString(),
        },
      },
    };
  }

  const VALID_INFERENCE = `Framework:\n  Core:\n    code_paths:\n      - src/core/**\n  CLI:\n    code_paths:\n      - src/cli/**\n`;

  describe('parseLaneEditArgs', () => {
    it('parses --name and --rename', () => {
      const args = ['--name', 'Framework: CLI', '--rename', 'Framework: CLI WU Commands'];
      const opts = parseLaneEditArgs(args);
      expect(opts.name).toBe('Framework: CLI');
      expect(opts.rename).toBe('Framework: CLI WU Commands');
    });

    it('parses --wip-limit as number', () => {
      const args = ['--name', 'Feature: API', '--wip-limit', '3'];
      const opts = parseLaneEditArgs(args);
      expect(opts.name).toBe('Feature: API');
      expect(opts.wipLimit).toBe(3);
    });

    it('parses --add-path', () => {
      const args = ['--name', 'Core: Domain', '--add-path', 'packages/events/'];
      const opts = parseLaneEditArgs(args);
      expect(opts.addPaths).toEqual(['packages/events/']);
    });

    it('parses --remove-path', () => {
      const args = ['--name', 'Core: Domain', '--remove-path', 'packages/old/'];
      const opts = parseLaneEditArgs(args);
      expect(opts.removePaths).toEqual(['packages/old/']);
    });

    it('parses --description', () => {
      const args = ['--name', 'Framework: Core', '--description', 'Core lifecycle management'];
      const opts = parseLaneEditArgs(args);
      expect(opts.description).toBe('Core lifecycle management');
    });

    it('requires --name', () => {
      expect(() => parseLaneEditArgs(['--rename', 'New Name'])).toThrow(/--name is required/);
    });

    it('requires at least one edit flag', () => {
      expect(() => parseLaneEditArgs(['--name', 'Framework: Core'])).toThrow(
        /At least one edit flag/,
      );
    });

    it('rejects negative wip-limit', () => {
      expect(() => parseLaneEditArgs(['--name', 'Framework: Core', '--wip-limit', '-1'])).toThrow(
        /must be a positive integer/,
      );
    });

    it('rejects zero wip-limit', () => {
      expect(() => parseLaneEditArgs(['--name', 'Framework: Core', '--wip-limit', '0'])).toThrow(
        /must be a positive integer/,
      );
    });
  });

  describe('validateLaneEditPreconditions', () => {
    it('blocks when lifecycle is unconfigured', () => {
      writeConfig({
        lanes: {
          definitions: [],
          lifecycle: { status: 'unconfigured' },
        },
      });

      const result = validateLaneEditPreconditions(tempDir);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/locked or draft/);
    });

    it('allows when lifecycle is locked', () => {
      writeConfig(
        makeLockedConfig([{ name: 'Framework: Core', wip_limit: 1, code_paths: ['src/core/**'] }]),
      );
      writeLaneInference(VALID_INFERENCE);

      const result = validateLaneEditPreconditions(tempDir);
      expect(result.ok).toBe(true);
    });

    it('allows when lifecycle is draft', () => {
      writeConfig(
        makeDraftConfig([{ name: 'Framework: Core', wip_limit: 1, code_paths: ['src/core/**'] }]),
      );
      writeLaneInference(VALID_INFERENCE);

      const result = validateLaneEditPreconditions(tempDir);
      expect(result.ok).toBe(true);
    });

    it('fails when config file is missing', () => {
      const result = validateLaneEditPreconditions(tempDir);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/Missing/);
    });
  });

  describe('applyLaneEdit', () => {
    it('renames a lane', () => {
      const definitions: LaneDefinition[] = [
        { name: 'Framework: CLI', wip_limit: 1, code_paths: ['src/cli/**'] },
        { name: 'Framework: Core', wip_limit: 1, code_paths: ['src/core/**'] },
      ];
      const options: LaneEditOptions = {
        name: 'Framework: CLI',
        rename: 'Framework: CLI WU Commands',
      };

      const result = applyLaneEdit(definitions, options);
      expect(result.ok).toBe(true);
      expect(result.definitions![0].name).toBe('Framework: CLI WU Commands');
      expect(result.definitions![1].name).toBe('Framework: Core');
    });

    it('updates wip_limit', () => {
      const definitions: LaneDefinition[] = [
        { name: 'Feature: API', wip_limit: 1, code_paths: ['src/api/**'] },
      ];
      const options: LaneEditOptions = {
        name: 'Feature: API',
        wipLimit: 3,
      };

      const result = applyLaneEdit(definitions, options);
      expect(result.ok).toBe(true);
      expect(result.definitions![0].wip_limit).toBe(3);
    });

    it('adds a code path', () => {
      const definitions: LaneDefinition[] = [
        { name: 'Core: Domain', wip_limit: 1, code_paths: ['packages/domain/**'] },
      ];
      const options: LaneEditOptions = {
        name: 'Core: Domain',
        addPaths: ['packages/events/'],
      };

      const result = applyLaneEdit(definitions, options);
      expect(result.ok).toBe(true);
      expect(result.definitions![0].code_paths).toEqual(['packages/domain/**', 'packages/events/']);
    });

    it('removes a code path', () => {
      const definitions: LaneDefinition[] = [
        {
          name: 'Core: Domain',
          wip_limit: 1,
          code_paths: ['packages/domain/**', 'packages/old/**'],
        },
      ];
      const options: LaneEditOptions = {
        name: 'Core: Domain',
        removePaths: ['packages/old/**'],
      };

      const result = applyLaneEdit(definitions, options);
      expect(result.ok).toBe(true);
      expect(result.definitions![0].code_paths).toEqual(['packages/domain/**']);
    });

    it('updates description', () => {
      const definitions: LaneDefinition[] = [
        { name: 'Framework: Core', wip_limit: 1, code_paths: ['src/core/**'] },
      ];
      const options: LaneEditOptions = {
        name: 'Framework: Core',
        description: 'Core lifecycle management',
      };

      const result = applyLaneEdit(definitions, options);
      expect(result.ok).toBe(true);
      expect(result.definitions![0].description).toBe('Core lifecycle management');
    });

    it('fails when target lane is not found', () => {
      const definitions: LaneDefinition[] = [
        { name: 'Framework: Core', wip_limit: 1, code_paths: ['src/core/**'] },
      ];
      const options: LaneEditOptions = {
        name: 'Nonexistent: Lane',
        wipLimit: 5,
      };

      const result = applyLaneEdit(definitions, options);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not found/);
    });

    it('fails when rename target already exists', () => {
      const definitions: LaneDefinition[] = [
        { name: 'Framework: CLI', wip_limit: 1, code_paths: ['src/cli/**'] },
        { name: 'Framework: Core', wip_limit: 1, code_paths: ['src/core/**'] },
      ];
      const options: LaneEditOptions = {
        name: 'Framework: CLI',
        rename: 'Framework: Core',
      };

      const result = applyLaneEdit(definitions, options);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/already exists/);
    });

    it('fails when removing a path that does not exist', () => {
      const definitions: LaneDefinition[] = [
        { name: 'Core: Domain', wip_limit: 1, code_paths: ['packages/domain/**'] },
      ];
      const options: LaneEditOptions = {
        name: 'Core: Domain',
        removePaths: ['packages/nonexistent/**'],
      };

      const result = applyLaneEdit(definitions, options);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not found in code_paths/);
    });

    it('fails when adding a duplicate path', () => {
      const definitions: LaneDefinition[] = [
        { name: 'Core: Domain', wip_limit: 1, code_paths: ['packages/domain/**'] },
      ];
      const options: LaneEditOptions = {
        name: 'Core: Domain',
        addPaths: ['packages/domain/**'],
      };

      const result = applyLaneEdit(definitions, options);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/already exists/);
    });

    it('applies multiple edits simultaneously', () => {
      const definitions: LaneDefinition[] = [
        { name: 'Framework: CLI', wip_limit: 1, code_paths: ['src/cli/**'] },
      ];
      const options: LaneEditOptions = {
        name: 'Framework: CLI',
        rename: 'Framework: CLI WU Commands',
        wipLimit: 2,
        addPaths: ['src/cli-new/**'],
        description: 'CLI WU commands lane',
      };

      const result = applyLaneEdit(definitions, options);
      expect(result.ok).toBe(true);
      const lane = result.definitions![0];
      expect(lane.name).toBe('Framework: CLI WU Commands');
      expect(lane.wip_limit).toBe(2);
      expect(lane.code_paths).toEqual(['src/cli/**', 'src/cli-new/**']);
      expect(lane.description).toBe('CLI WU commands lane');
    });
  });
});
