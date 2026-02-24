#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @file pack-author.ts
 * Secure no-code pack authoring command (WU-1952)
 *
 * Supports:
 * - `--spec-file` for automation (YAML or JSON)
 * - Interactive wizard for no-code creation
 * - Deterministic artifact generation via core template engine
 * - Immediate validation via pack:validate
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import YAML from 'yaml';
import {
  createWUParser,
  WU_OPTIONS,
  generatePackAuthoringArtifacts,
  PACK_AUTHORING_TEMPLATE_IDS,
  PackAuthoringRequestSchema,
  createError,
  ErrorCodes,
  type PackAuthorTemplateConfig,
  type PackAuthoringRequest,
} from '@lumenflow/core';
import { PACK_MANIFEST_FILE_NAME, UTF8_ENCODING } from '@lumenflow/kernel';
import { runCLI } from './cli-entry-point.js';
import { validatePack, formatValidationReport, type ValidationResult } from './pack-validate.js';

export const LOG_PREFIX = '[pack:author]';

const DEFAULT_OUTPUT_DIR = 'packs';
const CANCELLED_MESSAGE = 'Pack authoring cancelled.';
const DEFAULT_FILE_TEMPLATE_MAX_BYTES = 131_072;
const DEFAULT_HTTP_TEMPLATE_TIMEOUT_MS = 5_000;
const DEFAULT_HTTP_TEMPLATE_MAX_BYTES = 262_144;

const TEMPLATE_CHOICES = [
  {
    value: PACK_AUTHORING_TEMPLATE_IDS.FILE_READ_TEXT,
    label: 'File Read Text',
    hint: 'Read UTF-8 text files from a constrained scope',
  },
  {
    value: PACK_AUTHORING_TEMPLATE_IDS.FILE_WRITE_TEXT,
    label: 'File Write Text',
    hint: 'Write UTF-8 text files with constrained write scope',
  },
  {
    value: PACK_AUTHORING_TEMPLATE_IDS.HTTP_GET_JSON,
    label: 'HTTP GET JSON',
    hint: 'GET JSON from allow-listed HTTPS URLs',
  },
] as const;

type TemplateChoiceValue = (typeof TEMPLATE_CHOICES)[number]['value'];

interface PromptTextOptions {
  message: string;
  placeholder?: string;
  defaultValue?: string;
  validate?: (value: string | undefined) => string | undefined;
}

interface PromptSelectOptions<TValue extends string> {
  message: string;
  options: Array<{ value: TValue; label: string; hint?: string }>;
}

interface PromptConfirmOptions {
  message: string;
  initialValue?: boolean;
}

export interface PromptClient {
  intro(message: string): void;
  outro(message: string): void;
  note(message: string, title?: string): void;
  cancel(message: string): void;
  isCancel(value: unknown): boolean;
  text(options: PromptTextOptions): Promise<string | symbol>;
  select<TValue extends string>(options: PromptSelectOptions<TValue>): Promise<TValue | symbol>;
  confirm(options: PromptConfirmOptions): Promise<boolean | symbol>;
}

async function createDefaultPromptClient(): Promise<PromptClient> {
  const clack = await import('@clack/prompts');
  return {
    intro: (message: string) => clack.intro(message),
    outro: (message: string) => clack.outro(message),
    note: (message: string, title?: string) => clack.note(message, title),
    cancel: (message: string) => clack.cancel(message),
    isCancel: (value: unknown) => clack.isCancel(value),
    text: (options: PromptTextOptions) => clack.text(options),
    select: <TValue extends string>(options: PromptSelectOptions<TValue>) =>
      clack.select(options as never) as Promise<TValue | symbol>,
    confirm: (options: PromptConfirmOptions) => clack.confirm(options),
  };
}

function parseCsvList(input: string): string[] {
  const values = input
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return [...new Set(values)];
}

function ensureSafeRelativePath(packDir: string, filePath: string): string {
  if (isAbsolute(filePath)) {
    throw createError(
      ErrorCodes.SCOPE_VIOLATION,
      `Generated file path "${filePath}" must be relative.`,
    );
  }

  const resolvedPath = resolve(packDir, filePath);
  const relativePath = relative(packDir, resolvedPath);
  if (relativePath.startsWith('..') || relativePath === '..' || relativePath.length === 0) {
    throw createError(
      ErrorCodes.SCOPE_VIOLATION,
      `Generated file path "${filePath}" escapes the pack directory.`,
    );
  }

  return resolvedPath;
}

async function promptRequiredText(
  prompts: PromptClient,
  options: PromptTextOptions,
  cancelMessage: string,
): Promise<string> {
  const value = await prompts.text(options);
  if (prompts.isCancel(value)) {
    prompts.cancel(cancelMessage);
    throw createError(ErrorCodes.CANCELLED_BY_USER, CANCELLED_MESSAGE);
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw createError(ErrorCodes.INVALID_ARGUMENT, `Invalid input for "${options.message}".`);
  }
  return value.trim();
}

function assertNotCancelled<T>(prompts: PromptClient, value: T | symbol): T {
  if (prompts.isCancel(value)) {
    prompts.cancel(CANCELLED_MESSAGE);
    throw createError(ErrorCodes.CANCELLED_BY_USER, CANCELLED_MESSAGE);
  }
  return value as T;
}

function buildTemplateConfigFromInteractiveInput(options: {
  templateId: TemplateChoiceValue;
  toolName: string;
  scopePattern?: string;
  allowedUrls?: string[];
}): PackAuthorTemplateConfig {
  const { templateId, toolName, scopePattern, allowedUrls } = options;
  if (templateId === PACK_AUTHORING_TEMPLATE_IDS.FILE_READ_TEXT) {
    return {
      template_id: templateId,
      tool_name: toolName,
      scope_pattern: scopePattern ?? '',
      max_bytes: DEFAULT_FILE_TEMPLATE_MAX_BYTES,
    };
  }
  if (templateId === PACK_AUTHORING_TEMPLATE_IDS.FILE_WRITE_TEXT) {
    return {
      template_id: templateId,
      tool_name: toolName,
      scope_pattern: scopePattern ?? '',
      max_bytes: DEFAULT_FILE_TEMPLATE_MAX_BYTES,
    };
  }
  return {
    template_id: templateId,
    tool_name: toolName,
    allowed_urls: allowedUrls ?? [],
    timeout_ms: DEFAULT_HTTP_TEMPLATE_TIMEOUT_MS,
    max_bytes: DEFAULT_HTTP_TEMPLATE_MAX_BYTES,
  };
}

export async function loadPackAuthoringRequestFromSpec(
  specFilePath: string,
): Promise<PackAuthoringRequest> {
  const absoluteSpecPath = resolve(specFilePath);
  let rawContent: string;
  try {
    rawContent = await readFile(absoluteSpecPath, UTF8_ENCODING);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw createError(
      ErrorCodes.FILE_NOT_FOUND,
      `Failed to read spec file "${absoluteSpecPath}": ${message}`,
      {
        cause: error,
      },
    );
  }

  let parsedSpec: unknown;
  try {
    parsedSpec = YAML.parse(rawContent) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw createError(
      ErrorCodes.PARSE_ERROR,
      `Failed to parse spec file "${absoluteSpecPath}": ${message}`,
      {
        cause: error,
      },
    );
  }

  return PackAuthoringRequestSchema.parse(parsedSpec);
}

export async function buildInteractivePackAuthoringRequest(
  promptClient?: PromptClient,
): Promise<PackAuthoringRequest> {
  const prompts = promptClient ?? (await createDefaultPromptClient());
  prompts.intro('LumenFlow Pack Author');

  const packId = await promptRequiredText(
    prompts,
    {
      message: 'Pack ID',
      placeholder: 'customer-ops',
      validate: (value) => {
        if (!value?.trim()) {
          return 'Pack ID is required';
        }
        return undefined;
      },
    },
    CANCELLED_MESSAGE,
  );

  const version = await promptRequiredText(
    prompts,
    {
      message: 'Version',
      placeholder: '1.0.0',
      defaultValue: '1.0.0',
      validate: (value) => {
        if (!value?.trim()) {
          return 'Version is required';
        }
        return undefined;
      },
    },
    CANCELLED_MESSAGE,
  );

  const taskTypesInput = await promptRequiredText(
    prompts,
    {
      message: 'Task types (comma-separated)',
      placeholder: 'task,incident',
      defaultValue: 'task',
      validate: (value) => {
        if (!value?.trim()) {
          return 'At least one task type is required';
        }
        return undefined;
      },
    },
    CANCELLED_MESSAGE,
  );
  const taskTypes = parseCsvList(taskTypesInput);
  if (taskTypes.length === 0) {
    throw createError(ErrorCodes.VALIDATION_ERROR, 'At least one task type is required.');
  }

  const templates: PackAuthorTemplateConfig[] = [];
  let keepAddingTemplates = true;
  while (keepAddingTemplates) {
    const templateId = assertNotCancelled<TemplateChoiceValue>(
      prompts,
      await prompts.select<TemplateChoiceValue>({
        message: 'Choose a template',
        options: [...TEMPLATE_CHOICES],
      }),
    );

    const toolName = await promptRequiredText(
      prompts,
      {
        message: 'Tool name',
        placeholder: 'read-customer-notes',
        validate: (value) => {
          if (!value?.trim()) {
            return 'Tool name is required';
          }
          return undefined;
        },
      },
      CANCELLED_MESSAGE,
    );

    let scopePattern: string | undefined;
    let allowedUrls: string[] | undefined;
    if (
      templateId === PACK_AUTHORING_TEMPLATE_IDS.FILE_READ_TEXT ||
      templateId === PACK_AUTHORING_TEMPLATE_IDS.FILE_WRITE_TEXT
    ) {
      scopePattern = await promptRequiredText(
        prompts,
        {
          message: 'Scope pattern',
          placeholder: 'notes/**/*.md',
          validate: (value) => {
            if (!value?.trim()) {
              return 'Scope pattern is required';
            }
            return undefined;
          },
        },
        CANCELLED_MESSAGE,
      );
    } else {
      const allowedUrlsInput = await promptRequiredText(
        prompts,
        {
          message: 'Allowed HTTPS URLs (comma-separated)',
          placeholder: 'https://api.example.com/v1/customer/profile',
          validate: (value) => {
            if (!value?.trim()) {
              return 'At least one URL is required';
            }
            return undefined;
          },
        },
        CANCELLED_MESSAGE,
      );
      allowedUrls = parseCsvList(allowedUrlsInput);
    }

    templates.push(
      buildTemplateConfigFromInteractiveInput({
        templateId,
        toolName,
        scopePattern,
        allowedUrls,
      }),
    );

    const addAnother = assertNotCancelled<boolean>(
      prompts,
      await prompts.confirm({
        message: 'Add another template?',
        initialValue: false,
      }),
    );
    keepAddingTemplates = addAnother;
  }

  const parsedRequest = PackAuthoringRequestSchema.parse({
    pack_id: packId,
    version,
    task_types: taskTypes,
    templates,
  });

  prompts.note(
    [`Pack: ${parsedRequest.pack_id}`, `Templates: ${String(parsedRequest.templates.length)}`].join(
      '\n',
    ),
    'Pack Request Ready',
  );
  prompts.outro('Pack request captured.');

  return parsedRequest;
}

export interface AuthorPackOptions {
  request: PackAuthoringRequest;
  outputDir: string;
  force?: boolean;
  validateGeneratedPack?: boolean;
}

export interface AuthorPackResult {
  packDir: string;
  filesCreated: string[];
  validation: ValidationResult;
}

export async function authorPack(options: AuthorPackOptions): Promise<AuthorPackResult> {
  const { request, outputDir, force = false, validateGeneratedPack = true } = options;
  const parsedRequest = PackAuthoringRequestSchema.parse(request);
  const artifacts = generatePackAuthoringArtifacts(parsedRequest);

  const packDir = resolve(outputDir, parsedRequest.pack_id);
  if (existsSync(packDir)) {
    if (!force) {
      throw createError(
        ErrorCodes.PACK_ALREADY_EXISTS,
        `Pack directory "${packDir}" already exists. Use --force to overwrite the generated pack.`,
      );
    }
    rmSync(packDir, { recursive: true, force: true });
  }
  mkdirSync(packDir, { recursive: true });

  const filesCreated: string[] = [];

  const manifestPath = join(packDir, PACK_MANIFEST_FILE_NAME);
  writeFileSync(manifestPath, artifacts.manifest_yaml, UTF8_ENCODING);
  filesCreated.push(manifestPath);

  const fileEntries = Object.entries(artifacts.files).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [relativeFilePath, fileContent] of fileEntries) {
    const absoluteFilePath = ensureSafeRelativePath(packDir, relativeFilePath);
    mkdirSync(dirname(absoluteFilePath), { recursive: true });
    writeFileSync(absoluteFilePath, fileContent, UTF8_ENCODING);
    filesCreated.push(absoluteFilePath);
  }

  const validation = await validatePack({ packRoot: packDir });
  if (validateGeneratedPack && !validation.allPassed) {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      `Generated pack "${parsedRequest.pack_id}" failed validation:\n${formatValidationReport(validation)}`,
    );
  }

  return {
    packDir,
    filesCreated,
    validation,
  };
}

const PACK_AUTHOR_OPTIONS = {
  specFile: {
    name: 'specFile',
    flags: '--spec-file <path>',
    description: 'Path to YAML/JSON request file for non-interactive generation',
  },
  output: {
    name: 'output',
    flags: '--output <dir>',
    description: `Output directory root (default: "${DEFAULT_OUTPUT_DIR}")`,
  },
  skipValidate: {
    name: 'skipValidate',
    flags: '--skip-validate',
    description: 'Skip post-generation pack validation',
  },
};

export async function main(): Promise<void> {
  const opts = createWUParser({
    name: 'pack-author',
    description: 'Generate a secure domain pack from templates (spec-file or interactive)',
    options: [
      PACK_AUTHOR_OPTIONS.specFile,
      PACK_AUTHOR_OPTIONS.output,
      PACK_AUTHOR_OPTIONS.skipValidate,
      WU_OPTIONS.force,
    ],
  });

  const specFile = opts.specFile as string | undefined;
  const outputDir = (opts.output as string | undefined) ?? DEFAULT_OUTPUT_DIR;
  const force = Boolean(opts.force);
  const validateGeneratedPack = opts.skipValidate !== true;

  const request = specFile
    ? await loadPackAuthoringRequestFromSpec(specFile)
    : await buildInteractivePackAuthoringRequest();

  console.log(
    `${LOG_PREFIX} Generating pack "${request.pack_id}" v${request.version} in ${resolve(outputDir)}...`,
  );

  const result = await authorPack({
    request,
    outputDir,
    force,
    validateGeneratedPack,
  });

  console.log(`${LOG_PREFIX} Pack generated at: ${result.packDir}`);
  console.log(`${LOG_PREFIX} Files created:`);
  for (const filePath of result.filesCreated) {
    console.log(`  - ${filePath}`);
  }
  if (validateGeneratedPack) {
    console.log(`${LOG_PREFIX} Validation: ${result.validation.allPassed ? 'PASS' : 'FAIL'}`);
  } else {
    console.log(`${LOG_PREFIX} Validation: skipped (--skip-validate)`);
  }
}

if (import.meta.main) {
  void runCLI(main);
}
