#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createWUParser } from '@lumenflow/core';
import { runCLI } from './cli-entry-point.js';

const LOG_PREFIX = '[lumenflow:pre-commit-check]';
const UPGRADE_MARKER_RELATIVE_PATH = '.lumenflow/state/lumenflow-upgrade-marker.json';
const WU_EVENTS_RELATIVE_PATH = '.lumenflow/state/wu-events.jsonl';

const LUMENFLOW_VERSION_PATTERN = /@lumenflow\/(agent|cli|core|initiatives|memory|metrics|shims)/;
const WU_YAML_PATH_PATTERN = /^docs\/04-operations\/tasks\/wu\/WU-\d+\.ya?ml$/i;
const WU_EDIT_STAMP_PATTERN = /\[wu:edit\]\s+path=([^"\\\s]+)/g;

export interface UpgradeMarker {
  kind: string;
  status: 'pending' | 'consumed';
  version?: string;
  created_at: string;
  consumed_at?: string;
}

interface ParsedOptions {
  ci: boolean;
  base?: string;
  head: string;
}

interface MarkerValidationResult {
  valid: boolean;
  error?: string;
}

interface DiffContext {
  ci: boolean;
  base: string;
  head: string;
}

function parseOptions(): ParsedOptions {
  const opts = createWUParser({
    name: 'lumenflow-pre-commit-check',
    description: 'Run LumenFlow pre-commit enforcement checks',
    options: [
      {
        name: 'ci',
        flags: '--ci',
        description: 'Use CI diff mode (range-based) instead of staged diff mode',
      },
      {
        name: 'base',
        flags: '--base <ref>',
        description: 'Base git ref/sha for CI mode',
      },
      {
        name: 'head',
        flags: '--head <ref>',
        description: 'Head git ref/sha for CI mode (default: HEAD)',
      },
    ],
  });

  return {
    ci: opts.ci ?? false,
    base: opts.base,
    head: opts.head ?? 'HEAD',
  };
}

function runGit(command: string): string {
  return execSync(command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function quotePath(filePath: string): string {
  return `'${filePath.replace(/'/g, "'\\''")}'`;
}

function resolveCiBase(base: string | undefined, head: string): string {
  if (base) return base;

  try {
    return runGit(`git merge-base origin/main ${head}`);
  } catch {
    return 'HEAD~1';
  }
}

function getChangedFiles(context: DiffContext): string[] {
  if (context.ci) {
    const output = runGit(`git diff --name-only ${context.base}...${context.head}`);
    return output
      ? output
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      : [];
  }

  const output = runGit('git diff --cached --name-only');
  return output
    ? output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
}

function getDiffForFiles(context: DiffContext, files: string[]): string {
  if (files.length === 0) return '';
  const quotedPaths = files.map(quotePath).join(' ');
  if (context.ci) {
    return runGit(`git diff ${context.base}...${context.head} -- ${quotedPaths}`);
  }
  return runGit(`git diff --cached -- ${quotedPaths}`);
}

export function detectLumenflowVersionChange(diffText: string): boolean {
  return LUMENFLOW_VERSION_PATTERN.test(diffText);
}

export function extractWuEditStampPathsFromDiff(diffText: string): string[] {
  const stampedPaths = new Set<string>();
  for (const line of diffText.split('\n')) {
    if (!line.startsWith('+')) continue;

    WU_EDIT_STAMP_PATTERN.lastIndex = 0;
    const match = WU_EDIT_STAMP_PATTERN.exec(line);
    if (!match?.[1]) continue;
    stampedPaths.add(match[1]);
  }
  return [...stampedPaths];
}

export function hasAllWuEditStamps(changedWuPaths: string[], stampedPaths: string[]): boolean {
  const stamped = new Set(stampedPaths);
  return changedWuPaths.every((path) => stamped.has(path));
}

export function validateUpgradeMarker(marker: unknown): MarkerValidationResult {
  if (!marker || typeof marker !== 'object') {
    return { valid: false, error: 'Upgrade marker must be an object' };
  }

  const candidate = marker as Record<string, unknown>;
  if (candidate.kind !== 'lumenflow-upgrade') {
    return { valid: false, error: 'Upgrade marker kind must be lumenflow-upgrade' };
  }
  if (candidate.status !== 'pending' && candidate.status !== 'consumed') {
    return { valid: false, error: 'Upgrade marker status must be pending or consumed' };
  }
  if (typeof candidate.created_at !== 'string' || candidate.created_at.length === 0) {
    return { valid: false, error: 'Upgrade marker missing created_at' };
  }

  return { valid: true };
}

function readUpgradeMarker(projectRoot: string): UpgradeMarker {
  const absolutePath = join(projectRoot, UPGRADE_MARKER_RELATIVE_PATH);
  if (!existsSync(absolutePath)) {
    throw new Error(
      `${LOG_PREFIX} Missing upgrade marker at ${UPGRADE_MARKER_RELATIVE_PATH}. Use pnpm lumenflow:upgrade.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf-8'));
  } catch (error) {
    throw new Error(`${LOG_PREFIX} Invalid JSON in upgrade marker: ${(error as Error).message}`, {
      cause: error,
    });
  }

  const validation = validateUpgradeMarker(parsed);
  if (!validation.valid) {
    throw new Error(`${LOG_PREFIX} Invalid upgrade marker: ${validation.error}`);
  }
  return parsed as UpgradeMarker;
}

function writeUpgradeMarker(projectRoot: string, marker: UpgradeMarker): void {
  const absolutePath = join(projectRoot, UPGRADE_MARKER_RELATIVE_PATH);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, JSON.stringify(marker, null, 2) + '\n', 'utf-8');
}

function stageMarkerForHookMode(): void {
  execSync(`git add ${quotePath(UPGRADE_MARKER_RELATIVE_PATH)}`, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function enforceUpgradeMarker(
  changedFiles: string[],
  context: DiffContext,
  projectRoot: string,
): void {
  const depFiles = changedFiles.filter(
    (file) => file === 'package.json' || file === 'pnpm-lock.yaml',
  );
  if (depFiles.length === 0) return;

  const depDiff = getDiffForFiles(context, depFiles);
  if (!detectLumenflowVersionChange(depDiff)) return;

  if (!changedFiles.includes(UPGRADE_MARKER_RELATIVE_PATH)) {
    throw new Error(
      `${LOG_PREFIX} BLOCKED: @lumenflow/* version changes require ${UPGRADE_MARKER_RELATIVE_PATH}. Use pnpm lumenflow:upgrade.`,
    );
  }

  const marker = readUpgradeMarker(projectRoot);
  if (!context.ci && marker.status === 'pending') {
    marker.status = 'consumed';
    marker.consumed_at = new Date().toISOString();
    writeUpgradeMarker(projectRoot, marker);
    stageMarkerForHookMode();
  }

  if (context.ci && marker.status !== 'consumed') {
    throw new Error(
      `${LOG_PREFIX} BLOCKED: Upgrade marker must be consumed before merge. Run commit with pre-commit hook enabled.`,
    );
  }
}

function enforceWuEditStamps(changedFiles: string[], context: DiffContext): void {
  const changedWuYaml = changedFiles.filter((file) => WU_YAML_PATH_PATTERN.test(file));
  if (changedWuYaml.length === 0) return;

  const eventsDiff = getDiffForFiles(context, [WU_EVENTS_RELATIVE_PATH]);
  const stampedPaths = extractWuEditStampPathsFromDiff(eventsDiff);
  if (hasAllWuEditStamps(changedWuYaml, stampedPaths)) return;

  const stampedSet = new Set(stampedPaths);
  const missing = changedWuYaml.filter((path) => !stampedSet.has(path));
  throw new Error(
    `${LOG_PREFIX} BLOCKED: WU YAML edits require wu:edit stamp events in ${WU_EVENTS_RELATIVE_PATH}.\nMissing stamps for:\n- ${missing.join('\n- ')}`,
  );
}

export async function main(): Promise<void> {
  const opts = parseOptions();
  const base = resolveCiBase(opts.base, opts.head);
  const context: DiffContext = {
    ci: opts.ci,
    base,
    head: opts.head,
  };
  const projectRoot = process.cwd();

  const changedFiles = getChangedFiles(context);
  if (changedFiles.length === 0) return;

  enforceUpgradeMarker(changedFiles, context, projectRoot);
  enforceWuEditStamps(changedFiles, context);
}

if (import.meta.main) {
  void runCLI(main);
}
