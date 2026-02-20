// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import {
  PACK_AUTHORING_TEMPLATE_IDS,
  generatePackAuthoringArtifacts,
  type PackAuthoringRequest,
} from '../pack-authoring-template-engine.js';

const BASE_REQUEST: PackAuthoringRequest = {
  pack_id: 'customer-ops',
  version: '1.0.0',
  task_types: ['wu', 'incident'],
  templates: [
    {
      template_id: PACK_AUTHORING_TEMPLATE_IDS.FILE_READ_TEXT,
      tool_name: 'read-customer-notes',
      scope_pattern: 'notes/**/*.md',
    },
    {
      template_id: PACK_AUTHORING_TEMPLATE_IDS.FILE_WRITE_TEXT,
      tool_name: 'write-customer-report',
      scope_pattern: 'reports/**/*.md',
    },
    {
      template_id: PACK_AUTHORING_TEMPLATE_IDS.HTTP_GET_JSON,
      tool_name: 'fetch-customer-profile',
      allowed_urls: ['https://api.example.com/v1/customer/profile'],
    },
  ],
};

describe('pack authoring template engine (WU-1951)', () => {
  it('supports v1 templates for file.read_text, file.write_text, and http.get_json', () => {
    const artifacts = generatePackAuthoringArtifacts(BASE_REQUEST);
    const manifest = YAML.parse(artifacts.manifest_yaml) as {
      tools: Array<{
        name: string;
        permission: string;
        required_scopes: Array<Record<string, unknown>>;
        input_schema?: Record<string, unknown>;
        output_schema?: Record<string, unknown>;
      }>;
    };

    expect(manifest.tools.map((tool) => tool.name)).toEqual([
      'fetch-customer-profile',
      'read-customer-notes',
      'write-customer-report',
    ]);

    const readTool = manifest.tools.find((tool) => tool.name === 'read-customer-notes');
    const writeTool = manifest.tools.find((tool) => tool.name === 'write-customer-report');
    const httpTool = manifest.tools.find((tool) => tool.name === 'fetch-customer-profile');

    expect(readTool?.permission).toBe('read');
    expect(writeTool?.permission).toBe('write');
    expect(httpTool?.permission).toBe('read');

    expect(readTool?.required_scopes).toEqual([
      { type: 'path', pattern: 'notes/**/*.md', access: 'read' },
    ]);
    expect(writeTool?.required_scopes).toEqual([
      { type: 'path', pattern: 'reports/**/*.md', access: 'write' },
    ]);
    expect(httpTool?.required_scopes).toEqual([{ type: 'network', posture: 'full' }]);

    expect(readTool?.input_schema).toMatchObject({
      type: 'object',
      required: ['path'],
    });
    expect(writeTool?.output_schema).toMatchObject({
      type: 'object',
      required: ['bytes_written'],
    });
    expect(httpTool?.input_schema).toMatchObject({
      type: 'object',
      required: ['url'],
    });
  });

  it('rejects unsafe wildcard write scope patterns', () => {
    const request: PackAuthoringRequest = {
      ...BASE_REQUEST,
      templates: [
        {
          template_id: PACK_AUTHORING_TEMPLATE_IDS.FILE_WRITE_TEXT,
          tool_name: 'write-anywhere',
          scope_pattern: '**',
        },
      ],
    };

    expect(() => generatePackAuthoringArtifacts(request)).toThrow(/wildcard write scope/i);
  });

  it('rejects insecure http template URLs', () => {
    const request: PackAuthoringRequest = {
      ...BASE_REQUEST,
      templates: [
        {
          template_id: PACK_AUTHORING_TEMPLATE_IDS.HTTP_GET_JSON,
          tool_name: 'fetch-over-http',
          allowed_urls: ['http://api.example.com/profile'],
        },
      ],
    };

    expect(() => generatePackAuthoringArtifacts(request)).toThrow(/https/i);
  });

  it('generates deterministic artifacts from equivalent input', () => {
    const first = generatePackAuthoringArtifacts({
      ...BASE_REQUEST,
      task_types: ['incident', 'wu', 'incident'],
      templates: [...BASE_REQUEST.templates],
    });
    const second = generatePackAuthoringArtifacts({
      ...BASE_REQUEST,
      task_types: ['wu', 'incident'],
      templates: [...BASE_REQUEST.templates].reverse(),
    });

    expect(first).toEqual(second);
  });
});
