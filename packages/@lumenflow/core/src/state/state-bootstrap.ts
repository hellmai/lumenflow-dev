/**
 * State Bootstrap (WU-2539)
 *
 * Bootstraps event-sourced state from WU YAML files.
 *
 * @module @lumenflow/core/state
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { WUStatus, UNCLAIMED_STATUSES, TERMINAL_STATUSES } from '../shared/wu-status.js';

/**
 * Bootstrap result.
 */
export interface BootstrapResult {
  eventCount: number;
  warning?: string;
  dryRun?: boolean;
  skipped?: number;
}

/**
 * Bootstrap options.
 */
export interface BootstrapOptions {
  dryRun?: boolean;
}

/**
 * State event type.
 */
interface StateEvent {
  type: 'claim' | 'block' | 'complete';
  wuId: string;
  lane?: string;
  title?: string;
  reason?: string;
  timestamp: string;
}

/**
 * WU YAML structure (partial).
 */
interface WUYaml {
  id?: string;
  title?: string;
  lane?: string;
  status?: string;
  claimed_at?: string;
  completed_at?: string;
  created?: string;
}

/**
 * Validated WU data with required fields.
 */
interface ValidatedWU {
  id: string;
  status: string;
  title?: string;
  lane?: string;
  claimed_at?: string;
  completed_at?: string;
  created?: string;
}

/**
 * Parses a timestamp from various formats.
 */
function parseTimestamp(timestamp?: string): string {
  if (!timestamp) {
    return new Date().toISOString();
  }

  if (typeof timestamp === 'string' && timestamp.includes('T')) {
    return timestamp;
  }

  const date = new Date(timestamp);
  return date.toISOString();
}

/**
 * Simple YAML parser for WU files.
 * Parses key: value pairs from YAML content.
 */
function parseSimpleYaml(content: string): WUYaml {
  const result: Record<string, string> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, colonIndex).trim();
    let value = trimmed.slice(colonIndex + 1).trim();

    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result as WUYaml;
}

/**
 * Check if events file already has content (for idempotency).
 */
async function checkExistingState(eventsFilePath: string): Promise<BootstrapResult | null> {
  try {
    const existingContent = await fs.readFile(eventsFilePath, 'utf-8');
    const lines = existingContent
      .trim()
      .split('\n')
      .filter((l) => l.trim());
    if (lines.length > 0) {
      return {
        warning: 'Store already populated',
        eventCount: lines.length,
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  return null;
}

/**
 * Read WU YAML files from the directory.
 */
async function readWuFiles(wuDir: string): Promise<string[] | null> {
  try {
    const files = await fs.readdir(wuDir);
    return files.filter((file) => file.endsWith('.yaml'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Generate events for a single validated WU based on its status.
 */
function generateEventsForWu(wu: ValidatedWU): StateEvent[] {
  const events: StateEvent[] = [];

  const claimTimestamp = parseTimestamp(wu.claimed_at ?? wu.created);
  events.push({
    type: 'claim',
    wuId: wu.id,
    lane: wu.lane ?? 'Unknown',
    title: wu.title ?? 'Untitled',
    timestamp: claimTimestamp,
  });

  if (wu.status === WUStatus.BLOCKED) {
    events.push({
      type: 'block',
      wuId: wu.id,
      reason: 'Blocked (migrated from YAML)',
      timestamp: claimTimestamp,
    });
  }

  if (TERMINAL_STATUSES.includes(wu.status)) {
    const completeTimestamp = parseTimestamp(wu.completed_at ?? wu.claimed_at ?? wu.created);
    events.push({
      type: 'complete',
      wuId: wu.id,
      timestamp: completeTimestamp,
    });
  }

  return events;
}

/**
 * Bootstraps state store from existing WU YAML files.
 *
 * @param baseDir - Base directory (repository root)
 * @param options - Bootstrap options
 * @returns Bootstrap result
 */
export async function bootstrap(
  baseDir: string,
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const { dryRun = false } = options;

  const stateDir = path.join(baseDir, '._legacy/state');
  const wuDir = path.join(baseDir, 'docs/04-operations/tasks/wu');
  const eventsFilePath = path.join(stateDir, 'wu-events.jsonl');

  const existingState = await checkExistingState(eventsFilePath);
  if (existingState) {
    return existingState;
  }

  const wuYamlFiles = await readWuFiles(wuDir);
  if (wuYamlFiles === null) {
    return { eventCount: 0 };
  }

  const events: StateEvent[] = [];
  let skipped = 0;

  for (const file of wuYamlFiles) {
    if (file.startsWith('TEMPLATE')) {
      continue;
    }

    const filePath = path.join(wuDir, file);
    let wu: WUYaml;

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      wu = parseSimpleYaml(content);
    } catch {
      skipped++;
      continue;
    }

    if (!wu.id || !wu.status) {
      skipped++;
      continue;
    }

    if (UNCLAIMED_STATUSES.includes(wu.status)) {
      continue;
    }

    // Type narrowing: id and status are now guaranteed to be strings
    const validatedWu: ValidatedWU = {
      id: wu.id,
      status: wu.status,
      title: wu.title,
      lane: wu.lane,
      claimed_at: wu.claimed_at,
      completed_at: wu.completed_at,
      created: wu.created,
    };

    events.push(...generateEventsForWu(validatedWu));
  }

  if (dryRun) {
    return { dryRun: true, eventCount: events.length, skipped };
  }

  await fs.mkdir(stateDir, { recursive: true });
  const jsonlContent = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
  await fs.writeFile(eventsFilePath, jsonlContent, 'utf-8');

  return { eventCount: events.length, skipped };
}
