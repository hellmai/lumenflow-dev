// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import YAML from 'yaml';
import { z } from 'zod';
import { createError, ErrorCodes } from './error-handler.js';

const PACK_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[:-][a-z][a-z0-9-]*)*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;
const SCOPE_TRAVERSAL_PATTERN = /(^|\/)\.\.(\/|$)/;
const DISALLOWED_SCOPE_PATTERNS = new Set(['*', '**', '**/*', './**', './**/*']);
const MAX_TOOL_FILE_BYTES = 1_048_576;
const MIN_HTTP_TIMEOUT_MS = 100;
const MAX_HTTP_TIMEOUT_MS = 30_000;
const DEFAULT_HTTP_TIMEOUT_MS = 5_000;
const DEFAULT_HTTP_MAX_BYTES = 262_144;
const DEFAULT_FILE_MAX_BYTES = 131_072;
const NULL_BYTE = '\0';

const TEMPLATE_VALIDATION_MESSAGES = {
  PACK_ID:
    'pack_id must be kebab-case, start with a letter, and contain only lowercase letters, numbers, and hyphens',
  TOOL_NAME:
    'tool_name must be lowercase and use safe separators (: or -), for example "file:read-notes" or "read-customer-notes"',
  VERSION: 'version must be valid semantic version (for example 1.0.0)',
  SCOPE_TRAVERSAL: 'scope_pattern cannot contain path traversal segments',
  SCOPE_NULL_BYTE: 'scope_pattern cannot include null-byte characters',
  SCOPE_BROAD:
    'scope_pattern is too broad; wildcard write scope is forbidden. Use a constrained pattern (for example reports/**/*.md)',
  HTTP_HTTPS: 'allowed_urls must use https://',
  HTTP_CREDENTIALS: 'allowed_urls cannot embed credentials',
  HTTP_FRAGMENT_QUERY: 'allowed_urls must not include query params or fragments',
} as const;

export const PACK_AUTHORING_TEMPLATE_IDS = {
  FILE_READ_TEXT: 'file.read_text',
  FILE_WRITE_TEXT: 'file.write_text',
  HTTP_GET_JSON: 'http.get_json',
} as const;

export type PackAuthoringTemplateId =
  (typeof PACK_AUTHORING_TEMPLATE_IDS)[keyof typeof PACK_AUTHORING_TEMPLATE_IDS];

const StrictPackIdSchema = z.string().regex(PACK_ID_PATTERN, TEMPLATE_VALIDATION_MESSAGES.PACK_ID);
const StrictToolNameSchema = z
  .string()
  .regex(TOOL_NAME_PATTERN, TEMPLATE_VALIDATION_MESSAGES.TOOL_NAME);
const StrictVersionSchema = z.string().regex(SEMVER_PATTERN, TEMPLATE_VALIDATION_MESSAGES.VERSION);

function validateScopePattern(scopePattern: string, allowBroadPattern: boolean): void {
  if (scopePattern.includes(NULL_BYTE)) {
    throw createError(
      ErrorCodes.TEMPLATE_VALIDATION_ERROR,
      TEMPLATE_VALIDATION_MESSAGES.SCOPE_NULL_BYTE,
    );
  }

  if (SCOPE_TRAVERSAL_PATTERN.test(scopePattern)) {
    throw createError(
      ErrorCodes.TEMPLATE_VALIDATION_ERROR,
      TEMPLATE_VALIDATION_MESSAGES.SCOPE_TRAVERSAL,
    );
  }

  const normalized = scopePattern.trim();
  if (!allowBroadPattern && DISALLOWED_SCOPE_PATTERNS.has(normalized)) {
    throw createError(
      ErrorCodes.TEMPLATE_VALIDATION_ERROR,
      TEMPLATE_VALIDATION_MESSAGES.SCOPE_BROAD,
    );
  }
}

function validateAllowedUrl(value: string): void {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:') {
    throw createError(
      ErrorCodes.TEMPLATE_VALIDATION_ERROR,
      TEMPLATE_VALIDATION_MESSAGES.HTTP_HTTPS,
    );
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw createError(
      ErrorCodes.TEMPLATE_VALIDATION_ERROR,
      TEMPLATE_VALIDATION_MESSAGES.HTTP_CREDENTIALS,
    );
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    throw createError(
      ErrorCodes.TEMPLATE_VALIDATION_ERROR,
      TEMPLATE_VALIDATION_MESSAGES.HTTP_FRAGMENT_QUERY,
    );
  }
}

const FileReadTextTemplateSchema = z
  .object({
    template_id: z.literal(PACK_AUTHORING_TEMPLATE_IDS.FILE_READ_TEXT),
    tool_name: StrictToolNameSchema,
    scope_pattern: z.string().min(1),
    max_bytes: z.number().int().min(1).max(MAX_TOOL_FILE_BYTES).default(DEFAULT_FILE_MAX_BYTES),
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      validateScopePattern(value.scope_pattern, false);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scope_pattern'],
        message: error instanceof Error ? error.message : 'Invalid scope_pattern',
      });
    }
  });

const FileWriteTextTemplateSchema = z
  .object({
    template_id: z.literal(PACK_AUTHORING_TEMPLATE_IDS.FILE_WRITE_TEXT),
    tool_name: StrictToolNameSchema,
    scope_pattern: z.string().min(1),
    max_bytes: z.number().int().min(1).max(MAX_TOOL_FILE_BYTES).default(DEFAULT_FILE_MAX_BYTES),
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      validateScopePattern(value.scope_pattern, false);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scope_pattern'],
        message: error instanceof Error ? error.message : 'Invalid scope_pattern',
      });
    }
  });

const HttpGetJsonTemplateSchema = z
  .object({
    template_id: z.literal(PACK_AUTHORING_TEMPLATE_IDS.HTTP_GET_JSON),
    tool_name: StrictToolNameSchema,
    allowed_urls: z.array(z.string().url()).min(1).max(64),
    timeout_ms: z
      .number()
      .int()
      .min(MIN_HTTP_TIMEOUT_MS)
      .max(MAX_HTTP_TIMEOUT_MS)
      .default(DEFAULT_HTTP_TIMEOUT_MS),
    max_bytes: z.number().int().min(1).max(MAX_TOOL_FILE_BYTES).default(DEFAULT_HTTP_MAX_BYTES),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const [index, allowedUrl] of value.allowed_urls.entries()) {
      if (seen.has(allowedUrl)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['allowed_urls', index],
          message: `Duplicate URL "${allowedUrl}" is not allowed`,
        });
        continue;
      }
      seen.add(allowedUrl);
      try {
        validateAllowedUrl(allowedUrl);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['allowed_urls', index],
          message: error instanceof Error ? error.message : 'Invalid allowed_urls value',
        });
      }
    }
  });

export const PackAuthorTemplateConfigSchema = z.discriminatedUnion('template_id', [
  FileReadTextTemplateSchema,
  FileWriteTextTemplateSchema,
  HttpGetJsonTemplateSchema,
]);

export type PackAuthorTemplateConfig = z.infer<typeof PackAuthorTemplateConfigSchema>;

export const PackAuthoringRequestSchema = z
  .object({
    pack_id: StrictPackIdSchema,
    version: StrictVersionSchema,
    task_types: z.array(z.string().min(1)).min(1),
    templates: z.array(PackAuthorTemplateConfigSchema).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seenToolNames = new Set<string>();
    for (let index = 0; index < value.templates.length; index += 1) {
      const toolName = value.templates[index]?.tool_name;
      if (!toolName) {
        continue;
      }
      if (seenToolNames.has(toolName)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['templates', index, 'tool_name'],
          message: `Duplicate tool_name "${toolName}" is not allowed`,
        });
      }
      seenToolNames.add(toolName);
    }
  });

export type PackAuthoringRequest = z.infer<typeof PackAuthoringRequestSchema>;

interface GeneratedTemplateArtifact {
  tool: Record<string, unknown>;
  file_path: string;
  file_content: string;
}

export interface PackAuthoringArtifacts {
  manifest_yaml: string;
  files: Record<string, string>;
}

function toCamelCase(input: string): string {
  const words = input
    .split(/[^a-z0-9]+/g)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
  if (words.length === 0) {
    return 'tool';
  }
  const [firstWord, ...restWords] = words;
  const first = firstWord ? firstWord.toLowerCase() : 'tool';
  const rest = restWords.map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`);
  return [first, ...rest].join('');
}

function normalizeTemplateOrder(templates: PackAuthorTemplateConfig[]): PackAuthorTemplateConfig[] {
  return [...templates].sort((left, right) => {
    if (left.tool_name === right.tool_name) {
      return left.template_id.localeCompare(right.template_id);
    }
    return left.tool_name.localeCompare(right.tool_name);
  });
}

function normalizeTaskTypes(taskTypes: string[]): string[] {
  const deduped = [...new Set(taskTypes.map((taskType) => taskType.trim()).filter(Boolean))];
  return deduped.sort((left, right) => left.localeCompare(right));
}

function normalizeAllowedUrls(allowedUrls: string[]): string[] {
  return [...new Set(allowedUrls)].sort((left, right) => left.localeCompare(right));
}

function deriveScopePrefix(scopePattern: string): string {
  const trimmed = scopePattern.trim();
  const wildcardIndex = trimmed.search(/[*?[{]/);
  const prefixCandidate = wildcardIndex === -1 ? trimmed : trimmed.slice(0, wildcardIndex);
  const normalizedPrefix = prefixCandidate.replace(/^\.?\//, '').replace(/\/+$/, '');
  if (normalizedPrefix.length === 0) {
    throw createError(
      ErrorCodes.TEMPLATE_VALIDATION_ERROR,
      TEMPLATE_VALIDATION_MESSAGES.SCOPE_BROAD,
    );
  }
  return normalizedPrefix;
}

function escapeSingleQuoted(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function buildReadTemplate(
  config: z.infer<typeof FileReadTextTemplateSchema>,
): GeneratedTemplateArtifact {
  const functionName = `${toCamelCase(config.tool_name)}Tool`;
  const toolSlug = config.tool_name.replaceAll(':', '-');
  const scopePrefix = deriveScopePrefix(config.scope_pattern);
  const filePath = `tool-impl/${toolSlug}.ts`;

  const fileContent = [
    "import { readFile } from 'node:fs/promises';",
    "import path from 'node:path';",
    '',
    `const SCOPE_PREFIX = '${escapeSingleQuoted(scopePrefix)}';`,
    `const MAX_BYTES = ${config.max_bytes};`,
    '',
    'function normalizePath(value: unknown): string | null {',
    "  if (typeof value !== 'string' || value.trim().length === 0) {",
    '    return null;',
    '  }',
    '  const workspaceRoot = process.cwd();',
    '  const absolutePath = path.resolve(workspaceRoot, value);',
    '  const relativePath = path.relative(workspaceRoot, absolutePath).replaceAll(',
    '    path.sep,',
    "    '/',",
    '  );',
    "  if (relativePath.startsWith('..')) {",
    '    return null;',
    '  }',
    '  if (!relativePath.startsWith(SCOPE_PREFIX)) {',
    '    return null;',
    '  }',
    '  return absolutePath;',
    '}',
    '',
    `export async function ${functionName}(input: unknown) {`,
    '  const rawPath = (input as { path?: unknown })?.path;',
    '  const normalizedPath = normalizePath(rawPath);',
    '  if (!normalizedPath) {',
    '    return {',
    '      success: false,',
    "      error: { code: 'INVALID_INPUT', message: 'path is required and must stay in scope' },",
    '    };',
    '  }',
    '  const content = await readFile(normalizedPath, { encoding: "utf-8" });',
    '  if (Buffer.byteLength(content, "utf-8") > MAX_BYTES) {',
    '    return {',
    '      success: false,',
    "      error: { code: 'PAYLOAD_TOO_LARGE', message: 'file exceeds configured max_bytes' },",
    '    };',
    '  }',
    '  return {',
    '    success: true,',
    '    data: {',
    '      content,',
    '      bytes: Buffer.byteLength(content, "utf-8"),',
    '    },',
    '  };',
    '}',
    '',
  ].join('\n');

  return {
    tool: {
      name: config.tool_name,
      entry: `${filePath}#${functionName}`,
      permission: 'read',
      required_scopes: [{ type: 'path', pattern: config.scope_pattern, access: 'read' }],
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string', minLength: 1 },
        },
      },
      output_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['content', 'bytes'],
        properties: {
          content: { type: 'string' },
          bytes: { type: 'integer', minimum: 0 },
        },
      },
    },
    file_path: filePath,
    file_content: fileContent,
  };
}

function buildWriteTemplate(
  config: z.infer<typeof FileWriteTextTemplateSchema>,
): GeneratedTemplateArtifact {
  const functionName = `${toCamelCase(config.tool_name)}Tool`;
  const toolSlug = config.tool_name.replaceAll(':', '-');
  const scopePrefix = deriveScopePrefix(config.scope_pattern);
  const filePath = `tool-impl/${toolSlug}.ts`;

  const fileContent = [
    "import { mkdir, writeFile } from 'node:fs/promises';",
    "import path from 'node:path';",
    '',
    `const SCOPE_PREFIX = '${escapeSingleQuoted(scopePrefix)}';`,
    `const MAX_BYTES = ${config.max_bytes};`,
    '',
    'function normalizePath(value: unknown): string | null {',
    "  if (typeof value !== 'string' || value.trim().length === 0) {",
    '    return null;',
    '  }',
    '  const workspaceRoot = process.cwd();',
    '  const absolutePath = path.resolve(workspaceRoot, value);',
    '  const relativePath = path.relative(workspaceRoot, absolutePath).replaceAll(',
    '    path.sep,',
    "    '/',",
    '  );',
    "  if (relativePath.startsWith('..')) {",
    '    return null;',
    '  }',
    '  if (!relativePath.startsWith(SCOPE_PREFIX)) {',
    '    return null;',
    '  }',
    '  return absolutePath;',
    '}',
    '',
    `export async function ${functionName}(input: unknown) {`,
    '  const payload = input as { path?: unknown; content?: unknown };',
    '  const normalizedPath = normalizePath(payload?.path);',
    '  if (!normalizedPath) {',
    '    return {',
    '      success: false,',
    "      error: { code: 'INVALID_INPUT', message: 'path is required and must stay in scope' },",
    '    };',
    '  }',
    "  if (typeof payload?.content !== 'string') {",
    '    return {',
    '      success: false,',
    "      error: { code: 'INVALID_INPUT', message: 'content must be a string' },",
    '    };',
    '  }',
    '  const bytes = Buffer.byteLength(payload.content, "utf-8");',
    '  if (bytes > MAX_BYTES) {',
    '    return {',
    '      success: false,',
    "      error: { code: 'PAYLOAD_TOO_LARGE', message: 'content exceeds configured max_bytes' },",
    '    };',
    '  }',
    '  await mkdir(path.dirname(normalizedPath), { recursive: true });',
    '  await writeFile(normalizedPath, payload.content, { encoding: "utf-8" });',
    '  return {',
    '    success: true,',
    '    data: {',
    '      bytes_written: bytes,',
    '    },',
    '  };',
    '}',
    '',
  ].join('\n');

  return {
    tool: {
      name: config.tool_name,
      entry: `${filePath}#${functionName}`,
      permission: 'write',
      required_scopes: [{ type: 'path', pattern: config.scope_pattern, access: 'write' }],
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'content'],
        properties: {
          path: { type: 'string', minLength: 1 },
          content: { type: 'string' },
        },
      },
      output_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['bytes_written'],
        properties: {
          bytes_written: { type: 'integer', minimum: 0 },
        },
      },
    },
    file_path: filePath,
    file_content: fileContent,
  };
}

function buildHttpTemplate(
  config: z.infer<typeof HttpGetJsonTemplateSchema>,
): GeneratedTemplateArtifact {
  const functionName = `${toCamelCase(config.tool_name)}Tool`;
  const toolSlug = config.tool_name.replaceAll(':', '-');
  const filePath = `tool-impl/${toolSlug}.ts`;
  const allowedUrls = normalizeAllowedUrls(config.allowed_urls);
  const allowedUrlsSerialized = JSON.stringify(allowedUrls);

  const fileContent = [
    `const ALLOWED_URLS = new Set(${allowedUrlsSerialized});`,
    `const TIMEOUT_MS = ${config.timeout_ms};`,
    `const MAX_BYTES = ${config.max_bytes};`,
    '',
    `export async function ${functionName}(input: unknown) {`,
    '  const url = (input as { url?: unknown })?.url;',
    "  if (typeof url !== 'string' || !ALLOWED_URLS.has(url)) {",
    '    return {',
    '      success: false,',
    "      error: { code: 'INVALID_INPUT', message: 'url is required and must be in allow-list' },",
    '    };',
    '  }',
    '  const abortController = new AbortController();',
    '  const timeout = setTimeout(() => abortController.abort(), TIMEOUT_MS);',
    '  try {',
    '    const response = await fetch(url, {',
    "      method: 'GET',",
    "      headers: { accept: 'application/json' },",
    '      signal: abortController.signal,',
    '    });',
    "    const contentType = response.headers.get('content-type') ?? '';",
    "    if (!contentType.toLowerCase().includes('application/json')) {",
    '      return {',
    '        success: false,',
    "        error: { code: 'INVALID_OUTPUT', message: 'response content-type must be application/json' },",
    '      };',
    '    }',
    '    const payload = await response.text();',
    '    if (Buffer.byteLength(payload, "utf-8") > MAX_BYTES) {',
    '      return {',
    '        success: false,',
    "        error: { code: 'PAYLOAD_TOO_LARGE', message: 'response exceeds configured max_bytes' },",
    '      };',
    '    }',
    '    return {',
    '      success: response.ok,',
    '      data: {',
    '        status: response.status,',
    '        body: JSON.parse(payload),',
    '      },',
    '      error: response.ok',
    '        ? undefined',
    "        : { code: 'HTTP_ERROR', message: `request failed with status ${response.status}` },",
    '    };',
    '  } catch (error) {',
    '    return {',
    '      success: false,',
    "      error: { code: 'TOOL_EXECUTION_FAILED', message: error instanceof Error ? error.message : 'http request failed' },",
    '    };',
    '  } finally {',
    '    clearTimeout(timeout);',
    '  }',
    '}',
    '',
  ].join('\n');

  return {
    tool: {
      name: config.tool_name,
      entry: `${filePath}#${functionName}`,
      permission: 'read',
      required_scopes: [{ type: 'network', posture: 'full' }],
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['url'],
        properties: {
          url: { type: 'string', enum: allowedUrls },
        },
      },
      output_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['status', 'body'],
        properties: {
          status: { type: 'integer', minimum: 100, maximum: 599 },
          body: { type: 'object' },
        },
      },
    },
    file_path: filePath,
    file_content: fileContent,
  };
}

function buildTemplateArtifact(config: PackAuthorTemplateConfig): GeneratedTemplateArtifact {
  if (config.template_id === PACK_AUTHORING_TEMPLATE_IDS.FILE_READ_TEXT) {
    return buildReadTemplate(config);
  }
  if (config.template_id === PACK_AUTHORING_TEMPLATE_IDS.FILE_WRITE_TEXT) {
    return buildWriteTemplate(config);
  }
  return buildHttpTemplate(config);
}

export function generatePackAuthoringArtifacts(input: unknown): PackAuthoringArtifacts {
  const parsed = PackAuthoringRequestSchema.parse(input);
  const templates = normalizeTemplateOrder(parsed.templates).map((template) =>
    buildTemplateArtifact(template),
  );
  const taskTypes = normalizeTaskTypes(parsed.task_types);

  const manifest = {
    id: parsed.pack_id,
    version: parsed.version,
    task_types: taskTypes,
    tools: templates.map((template) => template.tool),
    policies: [],
    evidence_types: [],
    state_aliases: {},
    lane_templates: [],
  };

  const manifestYaml = YAML.stringify(manifest, { lineWidth: 0 });
  const sortedFileEntries = templates
    .map((template) => [template.file_path, template.file_content] as const)
    .sort(([left], [right]) => left.localeCompare(right));

  return {
    manifest_yaml: manifestYaml,
    files: Object.fromEntries(sortedFileEntries),
  };
}
