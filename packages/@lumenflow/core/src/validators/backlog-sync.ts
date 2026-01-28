/**
 * @file backlog-sync.ts
 * @description Validates backlog.md is in sync with WU YAML files (WU-1111)
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { FILE_SYSTEM } from '../wu-constants.js';

export interface BacklogSyncResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  wuCount: number;
  backlogCount: number;
}

function extractWUIDsFromBacklog(content: string): string[] {
  const wuIds: string[] = [];
  const pattern = /WU-\d+/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const wuId = match[0].toUpperCase();
    if (!wuIds.includes(wuId)) {
      wuIds.push(wuId);
    }
  }

  return wuIds;
}

function getWUIDsFromFiles(wuDir: string): string[] {
  if (!existsSync(wuDir)) {
    return [];
  }

  return readdirSync(wuDir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.replace('.yaml', '').toUpperCase());
}

export async function validateBacklogSync(
  options: { cwd?: string } = {},
): Promise<BacklogSyncResult> {
  const { cwd = process.cwd() } = options;
  const errors: string[] = [];
  const warnings: string[] = [];

  const backlogPath = path.join(cwd, 'docs', '04-operations', 'tasks', 'backlog.md');
  const wuDir = path.join(cwd, 'docs', '04-operations', 'tasks', 'wu');

  if (!existsSync(backlogPath)) {
    errors.push(`Backlog file not found: ${backlogPath}`);
    return { valid: false, errors, warnings, wuCount: 0, backlogCount: 0 };
  }

  const wuIdsFromFiles = getWUIDsFromFiles(wuDir);

  const backlogContent = readFileSync(backlogPath, {
    encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
  });
  const wuIdsFromBacklog = extractWUIDsFromBacklog(backlogContent);

  for (const wuId of wuIdsFromFiles) {
    if (!wuIdsFromBacklog.includes(wuId)) {
      errors.push(`${wuId} not found in backlog.md (exists as ${wuId}.yaml)`);
    }
  }

  for (const wuId of wuIdsFromBacklog) {
    if (!wuIdsFromFiles.includes(wuId)) {
      warnings.push(`${wuId} referenced in backlog.md but ${wuId}.yaml not found`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    wuCount: wuIdsFromFiles.length,
    backlogCount: wuIdsFromBacklog.length,
  };
}
