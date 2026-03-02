// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SIDEKICK_PACK_ID, SIDEKICK_PACK_VERSION } from '../constants.js';
import {
  SIDEKICK_MANIFEST,
  SIDEKICK_TOOL_NAMES,
  getSidekickManifestToolByName,
  getSidekickToolCount,
} from '../manifest.js';

const MANIFEST_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'manifest.yaml',
);

const EXPECTED_TOOL_NAMES = [
  'task:create',
  'task:list',
  'task:complete',
  'task:schedule',
  'memory:store',
  'memory:recall',
  'memory:forget',
  'channel:configure',
  'channel:send',
  'channel:receive',
  'routine:create',
  'routine:list',
  'routine:run',
  'sidekick:init',
  'sidekick:status',
  'sidekick:export',
] as const;

describe('sidekick manifest contract', () => {
  it('exports tool implementation subpaths for consumers', async () => {
    const packageJsonPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'package.json',
    );
    const packageJsonRaw = await readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonRaw) as {
      exports?: Record<string, string>;
    };

    const expectedExports: Record<string, string> = {
      './tool-impl/channel-tools': './dist/tool-impl/channel-tools.js',
      './tool-impl/memory-tools': './dist/tool-impl/memory-tools.js',
      './tool-impl/routine-tools': './dist/tool-impl/routine-tools.js',
      './tool-impl/shared': './dist/tool-impl/shared.js',
      './tool-impl/storage': './dist/tool-impl/storage.js',
      './tool-impl/system-tools': './dist/tool-impl/system-tools.js',
      './tool-impl/task-tools': './dist/tool-impl/task-tools.js',
    };

    for (const [exportKey, exportPath] of Object.entries(expectedExports)) {
      expect(packageJson.exports?.[exportKey]).toBe(exportPath);
    }
  });

  it('defines the expected pack identity', () => {
    expect(SIDEKICK_MANIFEST.id).toBe(SIDEKICK_PACK_ID);
    expect(SIDEKICK_MANIFEST.version).toBe(SIDEKICK_PACK_VERSION);
  });

  it('declares exactly 16 tools', () => {
    expect(SIDEKICK_MANIFEST.tools).toHaveLength(16);
    expect(SIDEKICK_TOOL_NAMES).toHaveLength(16);
    expect(getSidekickToolCount()).toBe(16);
  });

  it('contains all expected tool names', () => {
    const manifestToolNames = SIDEKICK_MANIFEST.tools.map((tool) => tool.name).sort();
    const expectedSorted = [...EXPECTED_TOOL_NAMES].sort();
    expect(manifestToolNames).toEqual(expectedSorted);
  });

  it('assigns correct permissions to each tool', () => {
    const readTools = [
      'task:list',
      'memory:recall',
      'channel:receive',
      'routine:list',
      'routine:run',
      'sidekick:status',
      'sidekick:export',
    ];
    const writeTools = [
      'task:create',
      'task:complete',
      'task:schedule',
      'memory:store',
      'memory:forget',
      'channel:configure',
      'channel:send',
      'routine:create',
      'sidekick:init',
    ];

    for (const name of readTools) {
      const tool = getSidekickManifestToolByName(name);
      expect(tool?.permission, `${name} should be read`).toBe('read');
    }

    for (const name of writeTools) {
      const tool = getSidekickManifestToolByName(name);
      expect(tool?.permission, `${name} should be write`).toBe('write');
    }
  });

  it('write tools have both read and write scopes', () => {
    const writeTools = SIDEKICK_MANIFEST.tools.filter((tool) => tool.permission === 'write');

    for (const tool of writeTools) {
      const hasRead = tool.required_scopes.some(
        (scope) => scope.access === 'read' && scope.pattern.includes('.sidekick/'),
      );
      const hasWrite = tool.required_scopes.some(
        (scope) => scope.access === 'write' && scope.pattern.includes('.sidekick/'),
      );
      expect(hasRead, `${tool.name} should have read scope`).toBe(true);
      expect(hasWrite, `${tool.name} should have write scope`).toBe(true);
    }
  });

  it('read tools have only read scopes', () => {
    const readTools = SIDEKICK_MANIFEST.tools.filter((tool) => tool.permission === 'read');

    for (const tool of readTools) {
      const hasWrite = tool.required_scopes.some((scope) => scope.access === 'write');
      expect(hasWrite, `${tool.name} should not have write scope`).toBe(false);
    }
  });

  it('all scopes use .sidekick/ prefix pattern', () => {
    for (const tool of SIDEKICK_MANIFEST.tools) {
      for (const scope of tool.required_scopes) {
        expect(scope.pattern, `${tool.name} scope pattern`).toMatch(/^\.sidekick\//);
      }
    }
  });

  it('all tools have input and output schemas', () => {
    for (const tool of SIDEKICK_MANIFEST.tools) {
      expect(tool.input_schema, `${tool.name} should have input_schema`).toBeTypeOf('object');
      expect(tool.output_schema, `${tool.name} should have output_schema`).toBeTypeOf('object');
    }
  });

  it('has at least one policy', () => {
    expect(SIDEKICK_MANIFEST.policies.length).toBeGreaterThanOrEqual(1);
    expect(SIDEKICK_MANIFEST.policies[0]?.trigger).toBe('on_tool_request');
    expect(SIDEKICK_MANIFEST.policies[0]?.decision).toBe('allow');
  });

  it('keeps manifest.yaml and programmatic manifest in sync', async () => {
    const raw = await readFile(MANIFEST_PATH, 'utf8');
    const lines = raw.split('\n');
    const yamlTools: Array<{ name: string; entry: string; permission: string }> = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]?.trim() ?? '';
      if (!line.startsWith('- name:')) {
        continue;
      }

      const name = line.slice('- name:'.length).trim();
      const entryLine = (lines[index + 1] ?? '').trim();
      const permissionLine = (lines[index + 2] ?? '').trim();
      const entry = entryLine.startsWith('entry:') ? entryLine.slice('entry:'.length).trim() : '';
      const permission = permissionLine.startsWith('permission:')
        ? permissionLine.slice('permission:'.length).trim()
        : '';

      yamlTools.push({ name, entry, permission });
    }

    yamlTools.sort((left, right) => left.name.localeCompare(right.name));

    expect(yamlTools).toHaveLength(16);

    const programmaticTools = SIDEKICK_MANIFEST.tools
      .map((tool) => ({
        name: tool.name,
        entry: tool.entry,
        permission: tool.permission,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    expect(yamlTools).toEqual(programmaticTools);
  });

  it('routine:run is read-only (plan-only, no execution)', () => {
    const tool = getSidekickManifestToolByName('routine:run');
    expect(tool?.permission).toBe('read');
  });

  it('sidekick:export is read-only (returns data, no file write)', () => {
    const tool = getSidekickManifestToolByName('sidekick:export');
    expect(tool?.permission).toBe('read');
  });

  it('sidekick:init has write permission', () => {
    const tool = getSidekickManifestToolByName('sidekick:init');
    expect(tool?.permission).toBe('write');
  });

  it('routes tools to correct entry files', () => {
    const entryMap: Record<string, string> = {
      'task:create': 'tool-impl/task-tools.ts',
      'task:list': 'tool-impl/task-tools.ts',
      'task:complete': 'tool-impl/task-tools.ts',
      'task:schedule': 'tool-impl/task-tools.ts',
      'memory:store': 'tool-impl/memory-tools.ts',
      'memory:recall': 'tool-impl/memory-tools.ts',
      'memory:forget': 'tool-impl/memory-tools.ts',
      'channel:configure': 'tool-impl/channel-tools.ts',
      'channel:send': 'tool-impl/channel-tools.ts',
      'channel:receive': 'tool-impl/channel-tools.ts',
      'routine:create': 'tool-impl/routine-tools.ts',
      'routine:list': 'tool-impl/routine-tools.ts',
      'routine:run': 'tool-impl/routine-tools.ts',
      'sidekick:init': 'tool-impl/system-tools.ts',
      'sidekick:status': 'tool-impl/system-tools.ts',
      'sidekick:export': 'tool-impl/system-tools.ts',
    };

    for (const [name, expectedEntry] of Object.entries(entryMap)) {
      const tool = getSidekickManifestToolByName(name);
      expect(tool?.entry, `${name} entry`).toBe(expectedEntry);
    }
  });
});
