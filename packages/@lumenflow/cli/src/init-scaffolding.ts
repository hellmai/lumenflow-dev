// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file init-scaffolding.ts
 * File-system scaffolding helpers for LumenFlow init command (WU-1644)
 *
 * Extracted from init.ts -- file creation, directory creation,
 * template loading/processing, and merge-mode handling.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createError, ErrorCodes } from '@lumenflow/core';
// WU-1171: Import merge block utilities
import { updateMergeBlock } from './merge-block.js';

/**
 * WU-1171: File creation mode
 */
export type FileMode = 'skip' | 'merge' | 'force';

export interface ScaffoldResult {
  created: string[];
  skipped: string[];
  /** WU-1171: Files that were merged (not overwritten) */
  merged?: string[];
  /** WU-1171: Warnings encountered during scaffolding */
  warnings?: string[];
  /** WU-1576: Files created by client integration adapters (enforcement hooks etc.) */
  integrationFiles?: string[];
  /** WU-1965: Files that were overwritten by --force mode */
  overwritten?: string[];
}

/**
 * Process template content by replacing placeholders
 */
export function processTemplate(content: string, tokens: Record<string, string>): string {
  let output = content;
  for (const [key, value] of Object.entries(tokens)) {
    // eslint-disable-next-line security/detect-non-literal-regexp -- key is from internal token map, not user input
    output = output.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return output;
}

export function getRelativePath(targetDir: string, filePath: string): string {
  return path.relative(targetDir, filePath).split(path.sep).join('/');
}

/**
 * WU-1171: Get templates directory path
 */
export function getTemplatesDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Check for dist/templates (production) or ../templates (development)
  const distTemplates = path.join(__dirname, '..', 'templates');
  if (fs.existsSync(distTemplates)) {
    return distTemplates;
  }

  throw createError(ErrorCodes.FILE_NOT_FOUND, `Templates directory not found at ${distTemplates}`);
}

/**
 * WU-1171: Load a template file
 */
export function loadTemplate(templatePath: string): string {
  const templatesDir = getTemplatesDir();
  const fullPath = path.join(templatesDir, templatePath);

  if (!fs.existsSync(fullPath)) {
    throw createError(ErrorCodes.FILE_NOT_FOUND, `Template not found: ${templatePath}`);
  }

  return fs.readFileSync(fullPath, 'utf-8');
}

/**
 * Convert boolean or FileMode to FileMode
 */
export function resolveBooleanToFileMode(mode: FileMode | boolean): FileMode {
  if (typeof mode === 'boolean') {
    return mode ? 'force' : 'skip';
  }
  return mode;
}

/**
 * Handle merge mode file update
 */
export function handleMergeMode(
  filePath: string,
  content: string,
  result: ScaffoldResult,
  relativePath: string,
): void {
  const existingContent = fs.readFileSync(filePath, 'utf-8');
  const mergeResult = updateMergeBlock(existingContent, content);

  if (mergeResult.unchanged) {
    result.skipped.push(relativePath);
    return;
  }

  if (mergeResult.warning) {
    result.warnings?.push(`${relativePath}: ${mergeResult.warning}`);
  }

  fs.writeFileSync(filePath, mergeResult.content);
  result.merged?.push(relativePath);
}

/**
 * Write a new file, creating parent directories if needed
 */
export function writeNewFile(
  filePath: string,
  content: string,
  result: ScaffoldResult,
  relativePath: string,
): void {
  const parentDir = path.dirname(filePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  fs.writeFileSync(filePath, content);
  result.created.push(relativePath);
}

/**
 * Create a directory if missing
 */
export async function createDirectory(
  dirPath: string,
  result: ScaffoldResult,
  targetDir: string,
): Promise<void> {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    result.created.push(getRelativePath(targetDir, dirPath));
  }
}

/**
 * WU-1171: Create a file with support for skip, merge, and force modes
 *
 * @param filePath - Path to the file to create
 * @param content - Content to write (or merge block content in merge mode)
 * @param mode - 'skip' (default), 'merge', or 'force'
 * @param result - ScaffoldResult to track created/skipped/merged files
 * @param targetDir - Target directory for relative path calculation
 */
export async function createFile(
  filePath: string,
  content: string,
  mode: FileMode | boolean,
  result: ScaffoldResult,
  targetDir: string,
): Promise<void> {
  const relativePath = getRelativePath(targetDir, filePath);

  // Handle boolean for backwards compatibility (true = force, false = skip)
  const resolvedMode = resolveBooleanToFileMode(mode);

  // Ensure merged/warnings/overwritten arrays exist
  result.merged = result.merged ?? [];
  result.warnings = result.warnings ?? [];
  result.overwritten = result.overwritten ?? [];

  const fileExists = fs.existsSync(filePath);

  if (fileExists && resolvedMode === 'skip') {
    result.skipped.push(relativePath);
    return;
  }

  if (fileExists && resolvedMode === 'merge') {
    handleMergeMode(filePath, content, result, relativePath);
    return;
  }

  // WU-1965: Track overwritten files when force mode replaces an existing file
  if (fileExists && resolvedMode === 'force') {
    result.overwritten.push(relativePath);
  }

  // Force mode or file doesn't exist: write new content
  writeNewFile(filePath, content, result, relativePath);
}

/**
 * WU-1394: Create an executable script file with proper permissions
 * Similar to createFile but sets 0o755 mode for shell scripts
 */
export async function createExecutableScript(
  filePath: string,
  content: string,
  mode: FileMode | boolean,
  result: ScaffoldResult,
  targetDir: string,
): Promise<void> {
  const relativePath = getRelativePath(targetDir, filePath);
  const resolvedMode = resolveBooleanToFileMode(mode);

  result.merged = result.merged ?? [];
  result.warnings = result.warnings ?? [];
  result.overwritten = result.overwritten ?? [];

  const fileExists = fs.existsSync(filePath);

  if (fileExists && resolvedMode === 'skip') {
    result.skipped.push(relativePath);
    return;
  }

  // WU-1965: Track overwritten files
  if (fileExists && (resolvedMode === 'force' || resolvedMode === 'merge')) {
    result.overwritten.push(relativePath);
  }

  // Write file with executable permissions
  const parentDir = path.dirname(filePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  fs.writeFileSync(filePath, content, { mode: 0o755 });
  result.created.push(relativePath);
}
