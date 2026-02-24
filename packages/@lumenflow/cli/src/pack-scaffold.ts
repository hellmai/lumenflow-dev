#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @file pack-scaffold.ts
 * Scaffold a new LumenFlow domain pack (WU-1823)
 *
 * Usage:
 *   pnpm pack:scaffold --id my-domain --version 0.1.0
 *   pnpm pack:scaffold --id my-domain --version 0.1.0 --task-type investigation --tool my-tool
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { createWUParser, WU_OPTIONS, createError, ErrorCodes } from '@lumenflow/core';
import { runCLI } from './cli-entry-point.js';

export const LOG_PREFIX = '[pack:scaffold]';

// --- Validation constants ---

const PACK_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

const DEFAULT_TASK_TYPE = 'task';
const DEFAULT_OUTPUT_DIR = 'packs';

// --- Validation functions ---

/**
 * Validate a pack ID is kebab-case, non-empty, starts with letter.
 * @throws {Error} if pack ID is invalid
 */
export function validatePackId(packId: string): void {
  if (!packId || !PACK_ID_PATTERN.test(packId)) {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      `Invalid pack ID "${packId}". Must be kebab-case (lowercase letters, numbers, hyphens), ` +
        `start with a letter, and not start/end with a hyphen. Examples: "my-domain", "customer-support"`,
    );
  }
}

/**
 * Validate a version string is valid semver.
 * @throws {Error} if version is invalid
 */
export function validateVersion(version: string): void {
  if (!version || !SEMVER_PATTERN.test(version)) {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      `Invalid version "${version}". Must be valid semver (e.g., "0.1.0", "1.0.0", "2.3.4-beta.1")`,
    );
  }
}

// --- Scaffold types ---

export interface ScaffoldPackOptions {
  outputDir: string;
  packId: string;
  version: string;
  taskTypes?: string[];
  toolNames?: string[];
}

export interface ScaffoldPackResult {
  packDir: string;
  filesCreated: string[];
}

// --- Template generators ---

function generateManifestYaml(options: {
  packId: string;
  version: string;
  taskTypes: string[];
  toolNames: string[];
}): string {
  const { packId, version, taskTypes, toolNames } = options;

  const tools = toolNames.map((toolName) => ({
    name: toolName,
    entry: `tool-impl/${toolName}.ts#${toCamelCase(toolName)}Tool`,
    permission: 'read',
    required_scopes: [
      {
        type: 'path',
        pattern: '**',
        access: 'read',
      },
    ],
  }));

  const manifest = {
    id: packId,
    version,
    task_types: taskTypes,
    tools,
    policies: [],
    evidence_types: [],
    state_aliases: {},
    lane_templates: [],
  };

  return YAML.stringify(manifest, { lineWidth: 120 });
}

function generateToolImpl(toolName: string, packId: string): string {
  const camelName = toCamelCase(toolName);

  return `// ${packId} pack - ${toolName} tool implementation
//
// This file contains the runtime logic for the "${toolName}" tool.
// It is invoked by the LumenFlow kernel when an agent calls this tool.

import type { ToolRequest, ToolContext, ToolResult } from '@lumenflow/kernel';

/**
 * ${toolName} tool handler.
 *
 * @param request - The tool invocation request from the kernel
 * @param context - Execution context (workspace, task, scopes)
 * @returns Tool result with output or error
 */
export async function ${camelName}Tool(
  request: ToolRequest,
  context: ToolContext,
): Promise<ToolResult> {
  // TODO: Implement ${toolName} logic
  return {
    success: true,
    output: \`${toolName} executed for task \${context.taskId}\`,
  };
}
`;
}

function generateToolDescriptor(toolName: string): string {
  const camelName = toCamelCase(toolName);

  return `// Tool descriptor for "${toolName}"
//
// This file re-exports the tool implementation for use in the manifest.
// The manifest.yaml references tool-impl/${toolName}.ts#${camelName}Tool

export { ${camelName}Tool } from '../tool-impl/${toolName}.js';
`;
}

function generateReadme(packId: string, version: string): string {
  return `# ${packId}

LumenFlow domain pack - version ${version}

## Overview

This pack provides pack-specific tools and policies for the LumenFlow kernel.

## Structure

\`\`\`
${packId}/
  manifest.yaml    # Pack manifest (tools, policies, task types)
  tool-impl/       # Tool runtime implementations
  tools/           # Tool descriptor re-exports
  README.md        # This file
\`\`\`

## Getting Started

1. Define your task types in \`manifest.yaml\`
2. Implement tool logic in \`tool-impl/\`
3. Register tools in the manifest
4. Validate with: \`pnpm pack:validate --id ${packId}\`

## Tools

See \`manifest.yaml\` for the list of registered tools.
`;
}

// --- Helpers ---

function toCamelCase(kebab: string): string {
  return kebab.replace(/-([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

// --- Core scaffold function ---

/**
 * Scaffold a new domain pack directory structure.
 *
 * Creates:
 * - <outputDir>/<packId>/manifest.yaml
 * - <outputDir>/<packId>/tool-impl/<toolName>.ts (for each tool)
 * - <outputDir>/<packId>/tools/<toolName>.ts (for each tool)
 * - <outputDir>/<packId>/README.md
 *
 * @throws {Error} if pack ID or version is invalid, or directory already exists
 */
export function scaffoldPack(options: ScaffoldPackOptions): ScaffoldPackResult {
  const { outputDir, packId, version, taskTypes, toolNames = [] } = options;

  // Validate inputs
  validatePackId(packId);
  validateVersion(version);

  const resolvedTaskTypes = taskTypes && taskTypes.length > 0 ? taskTypes : [DEFAULT_TASK_TYPE];

  const packDir = join(outputDir, packId);

  // Prevent overwriting
  if (existsSync(packDir)) {
    throw createError(
      ErrorCodes.PACK_ALREADY_EXISTS,
      `Pack directory "${packDir}" already exists. Remove it first or choose a different ID.`,
    );
  }

  // Create directory structure
  const toolImplDir = join(packDir, 'tool-impl');
  const toolsDir = join(packDir, 'tools');

  mkdirSync(toolImplDir, { recursive: true });
  mkdirSync(toolsDir, { recursive: true });

  const filesCreated: string[] = [];

  // Generate manifest.yaml
  const manifestContent = generateManifestYaml({
    packId,
    version,
    taskTypes: resolvedTaskTypes,
    toolNames,
  });
  const manifestPath = join(packDir, 'manifest.yaml');
  writeFileSync(manifestPath, manifestContent, 'utf-8');
  filesCreated.push(manifestPath);

  // Generate tool files
  for (const toolName of toolNames) {
    const implPath = join(toolImplDir, `${toolName}.ts`);
    writeFileSync(implPath, generateToolImpl(toolName, packId), 'utf-8');
    filesCreated.push(implPath);

    const descPath = join(toolsDir, `${toolName}.ts`);
    writeFileSync(descPath, generateToolDescriptor(toolName), 'utf-8');
    filesCreated.push(descPath);
  }

  // Generate README
  const readmePath = join(packDir, 'README.md');
  writeFileSync(readmePath, generateReadme(packId, version), 'utf-8');
  filesCreated.push(readmePath);

  return { packDir, filesCreated };
}

// --- CLI options ---

const PACK_SCAFFOLD_OPTIONS = {
  packId: {
    name: 'id',
    flags: '--id <packId>',
    description: 'Pack ID in kebab-case (e.g., "my-domain", "customer-support")',
  },
  version: {
    name: 'version',
    flags: '--version <version>',
    description: 'Pack version in semver format (e.g., "0.1.0")',
  },
  taskType: {
    name: 'taskType',
    flags: '--task-type <type>',
    description: 'Task type name (repeatable)',
    isRepeatable: true,
  },
  tool: {
    name: 'tool',
    flags: '--tool <name>',
    description: 'Tool name to scaffold (repeatable)',
    isRepeatable: true,
  },
  output: {
    name: 'output',
    flags: '--output <dir>',
    description: `Output directory (default: "${DEFAULT_OUTPUT_DIR}")`,
  },
};

/**
 * CLI main entry point for pack:scaffold
 */
export async function main(): Promise<void> {
  const opts = createWUParser({
    name: 'pack-scaffold',
    description: 'Scaffold a new LumenFlow domain pack',
    options: [
      PACK_SCAFFOLD_OPTIONS.packId,
      PACK_SCAFFOLD_OPTIONS.version,
      PACK_SCAFFOLD_OPTIONS.taskType,
      PACK_SCAFFOLD_OPTIONS.tool,
      PACK_SCAFFOLD_OPTIONS.output,
      WU_OPTIONS.force,
    ],
    required: ['id', 'version'],
  });

  const packId = opts.id as string;
  const version = opts.version as string;
  const taskTypes = (opts.taskType as string[] | undefined) ?? [];
  const toolNames = (opts.tool as string[] | undefined) ?? [];
  const outputDir = (opts.output as string | undefined) ?? DEFAULT_OUTPUT_DIR;

  console.log(`${LOG_PREFIX} Scaffolding pack "${packId}" v${version}...`);

  const result = scaffoldPack({
    outputDir,
    packId,
    version,
    taskTypes: taskTypes.length > 0 ? taskTypes : undefined,
    toolNames: toolNames.length > 0 ? toolNames : undefined,
  });

  console.log(`${LOG_PREFIX} Pack scaffolded at: ${result.packDir}`);
  console.log(`${LOG_PREFIX} Files created:`);
  for (const file of result.filesCreated) {
    console.log(`  - ${file}`);
  }
  console.log(`${LOG_PREFIX} Next steps:`);
  console.log(`  1. Edit manifest.yaml to define your tools and policies`);
  console.log(`  2. Implement tool logic in tool-impl/`);
  console.log(`  3. Validate with: pnpm pack:validate --id ${packId}`);
}

// Run if executed directly
if (import.meta.main) {
  void runCLI(main);
}
