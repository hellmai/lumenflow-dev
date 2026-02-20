// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import YAML from 'yaml';
import { PACK_AUTHORING_TEMPLATE_IDS, type PackAuthoringRequest } from '@lumenflow/core';

const TEMP_DIR_PREFIX = 'pack-author-test';

function createTempDir(): string {
  const dir = join(tmpdir(), `${TEMP_DIR_PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const SAFE_REQUEST: PackAuthoringRequest = {
  pack_id: 'customer-ops',
  version: '1.0.0',
  task_types: ['task'],
  templates: [
    {
      template_id: PACK_AUTHORING_TEMPLATE_IDS.FILE_READ_TEXT,
      tool_name: 'read-customer-notes',
      scope_pattern: 'notes/**/*.md',
    },
    {
      template_id: PACK_AUTHORING_TEMPLATE_IDS.HTTP_GET_JSON,
      tool_name: 'fetch-customer-profile',
      allowed_urls: ['https://api.example.com/v1/customer/profile'],
    },
  ],
};

describe('pack:author command', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('supports spec-file driven request generation', async () => {
    const tempDir = createTempDir();
    tempDirs.push(tempDir);
    const specPath = join(tempDir, 'pack-author-spec.yaml');
    writeFileSync(specPath, YAML.stringify(SAFE_REQUEST), 'utf-8');

    const { loadPackAuthoringRequestFromSpec } = await import('../pack-author.js');
    const request = await loadPackAuthoringRequestFromSpec(specPath);

    expect(request.pack_id).toBe('customer-ops');
    expect(request.templates.length).toBe(2);
    expect(request.templates[0]?.tool_name).toBe('read-customer-notes');
  });

  it('supports interactive request generation', async () => {
    const module = await import('../pack-author.js');
    const buildInteractivePackAuthoringRequest = module.buildInteractivePackAuthoringRequest;

    const promptClient = {
      intro: vi.fn(),
      outro: vi.fn(),
      note: vi.fn(),
      cancel: vi.fn(),
      isCancel: vi.fn().mockReturnValue(false),
      text: vi
        .fn()
        .mockResolvedValueOnce('customer-ops')
        .mockResolvedValueOnce('1.0.0')
        .mockResolvedValueOnce('task,incident')
        .mockResolvedValueOnce('read-customer-notes')
        .mockResolvedValueOnce('notes/**/*.md'),
      select: vi.fn().mockResolvedValueOnce(PACK_AUTHORING_TEMPLATE_IDS.FILE_READ_TEXT),
      confirm: vi.fn().mockResolvedValueOnce(false),
    } as Parameters<typeof buildInteractivePackAuthoringRequest>[0];

    const request = await buildInteractivePackAuthoringRequest(promptClient);

    expect(request.pack_id).toBe('customer-ops');
    expect(request.version).toBe('1.0.0');
    expect(request.task_types).toEqual(['task', 'incident']);
    expect(request.templates).toHaveLength(1);
    expect(request.templates[0]?.template_id).toBe(PACK_AUTHORING_TEMPLATE_IDS.FILE_READ_TEXT);
  });

  it('writes generated artifacts and passes pack:validate for safe templates', async () => {
    const tempDir = createTempDir();
    tempDirs.push(tempDir);

    const { authorPack } = await import('../pack-author.js');
    const result = await authorPack({
      request: SAFE_REQUEST,
      outputDir: tempDir,
      force: false,
      validateGeneratedPack: true,
    });

    expect(existsSync(join(result.packDir, 'manifest.yaml'))).toBe(true);
    expect(existsSync(join(result.packDir, 'tool-impl', 'fetch-customer-profile.ts'))).toBe(true);
    expect(existsSync(join(result.packDir, 'tool-impl', 'read-customer-notes.ts'))).toBe(true);
    expect(result.validation.allPassed).toBe(true);
  });

  it('rejects unsafe wildcard-write template configurations', async () => {
    const tempDir = createTempDir();
    tempDirs.push(tempDir);

    const { authorPack } = await import('../pack-author.js');
    const unsafeRequest: PackAuthoringRequest = {
      pack_id: 'unsafe-pack',
      version: '1.0.0',
      task_types: ['task'],
      templates: [
        {
          template_id: PACK_AUTHORING_TEMPLATE_IDS.FILE_WRITE_TEXT,
          tool_name: 'write-anything',
          scope_pattern: '**',
        },
      ],
    };

    await expect(
      authorPack({
        request: unsafeRequest,
        outputDir: tempDir,
        force: false,
        validateGeneratedPack: true,
      }),
    ).rejects.toThrow(/wildcard write scope/i);
  });
});
