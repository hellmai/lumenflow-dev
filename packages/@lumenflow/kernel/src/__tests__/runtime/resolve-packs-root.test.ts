// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PACK_MANIFEST_FILE_NAME,
  PACKS_DIR_NAME,
  UTF8_ENCODING,
  WORKSPACE_FILE_NAME,
} from '../../shared-constants.js';
import { initializeKernelRuntime } from '../../runtime/kernel-runtime.js';

const CURRENT_FILE_PATH = fileURLToPath(import.meta.url);
const CURRENT_DIR = path.dirname(CURRENT_FILE_PATH);
const CLI_PACKAGE_ROOT = path.resolve(CURRENT_DIR, '..', '..', '..', '..', 'cli');
const CLI_BUNDLED_PACKS_ROOT = path.join(CLI_PACKAGE_ROOT, PACKS_DIR_NAME);

const PACK_VERSION = '0.1.0';
const TASK_TYPE = 'work-unit';

const cleanupPaths = new Set<string>();

function createWorkspaceConfigText(packId: string): string {
  return [
    'id: workspace-resolve-packs-root-tests',
    'name: Resolve Packs Root Tests',
    'packs:',
    `  - id: ${packId}`,
    `    version: ${PACK_VERSION}`,
    '    integrity: dev',
    '    source: local',
    'lanes:',
    '  - id: framework-core-lifecycle',
    '    title: Framework Core Lifecycle',
    '    allowed_scopes:',
    '      - type: path',
    '        pattern: "**"',
    '        access: read',
    'security:',
    '  allowed_scopes:',
    '    - type: path',
    '      pattern: "**"',
    '      access: read',
    '  network_default: off',
    '  deny_overlays: []',
    'software_delivery: {}',
    'memory_namespace: mem',
    'event_namespace: evt',
  ].join('\n');
}

function createPackManifestText(packId: string): string {
  return [
    `id: ${packId}`,
    `version: ${PACK_VERSION}`,
    'task_types:',
    `  - ${TASK_TYPE}`,
    'tools: []',
    'policies: []',
    'evidence_types: []',
    'state_aliases: {}',
    'lane_templates: []',
  ].join('\n');
}

async function writeWorkspace(root: string, packId: string): Promise<void> {
  await writeFile(
    path.join(root, WORKSPACE_FILE_NAME),
    createWorkspaceConfigText(packId),
    UTF8_ENCODING,
  );
}

async function writePack(packRoot: string, packId: string): Promise<void> {
  await mkdir(packRoot, { recursive: true });
  await writeFile(
    path.join(packRoot, PACK_MANIFEST_FILE_NAME),
    createPackManifestText(packId),
    UTF8_ENCODING,
  );
}

async function initializeRuntime(workspaceRoot: string) {
  return initializeKernelRuntime({
    workspaceRoot,
    taskSpecRoot: path.join(workspaceRoot, 'tasks'),
    eventsFilePath: path.join(workspaceRoot, 'events.jsonl'),
    eventLockFilePath: path.join(workspaceRoot, 'events.lock'),
    evidenceRoot: path.join(workspaceRoot, 'evidence'),
  });
}

describe('resolvePacksRoot', () => {
  afterEach(async () => {
    const paths = Array.from(cleanupPaths);
    cleanupPaths.clear();
    for (const targetPath of paths) {
      await rm(targetPath, { recursive: true, force: true });
    }
  });

  it('loads packs from workspaceRoot/packs when present', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'resolve-packs-root-workspace-'));
    cleanupPaths.add(workspaceRoot);

    const packId = 'wu-2050-workspace-pack';
    await writeWorkspace(workspaceRoot, packId);
    await writePack(path.join(workspaceRoot, PACKS_DIR_NAME, packId), packId);

    await expect(initializeRuntime(workspaceRoot)).resolves.toBeDefined();
  });

  it('falls back to bundled CLI packs when workspace candidates are absent', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'resolve-packs-root-cli-fallback-'));
    cleanupPaths.add(workspaceRoot);

    const packId = 'wu-2050-cli-fallback-pack';
    await writeWorkspace(workspaceRoot, packId);

    const cliBundledPackPath = path.join(CLI_BUNDLED_PACKS_ROOT, packId);
    cleanupPaths.add(cliBundledPackPath);
    await writePack(cliBundledPackPath, packId);

    await expect(initializeRuntime(workspaceRoot)).resolves.toBeDefined();
  });
});
