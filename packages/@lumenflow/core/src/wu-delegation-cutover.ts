// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Delegation Cutover (WU-2013, WU-1674)
 *
 * One-time migration from spawn-era to delegation-era state files.
 * Archives legacy state and rebuilds wu-events.jsonl from WU YAML specs.
 *
 * @see {@link ./wu-event-sourcer.ts} - Calls this during first load
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { validateWUEvent, type WUEvent } from './wu-state-schema.js';
import { LUMENFLOW_PATHS, PATTERNS, WU_STATUS } from './wu-constants.js';

const CUTOVER = Object.freeze({
  MARKER_FILE: '.delegation-cutover-done',
  ARCHIVE_DIR: 'archive',
  ARCHIVE_PREFIX: 'delegation-cutover-',
  LEGACY_REGISTRY_FILE: 'spawn-registry.jsonl',
  DELEGATION_REGISTRY_FILE: 'delegation-registry.jsonl',
  LEGACY_EVENT_TYPE: 'spawn',
  DONE_STAMP_SUFFIX: '.done',
  WU_FILE_PREFIX: 'WU-',
});

const WU_DOCS_SEGMENTS = ['docs', '04-operations', 'tasks', 'wu'];
const STAMP_SEGMENTS = [LUMENFLOW_PATHS.BASE, 'stamps'];
const BLOCKED_REASON = 'Bootstrapped from WU YAML (original reason unknown)';

type BootstrapEvent = Extract<WUEvent, { type: 'claim' | 'block' | 'complete' }>;

interface BootstrapWUInfo {
  id: string;
  status: string;
  lane: string;
  title: string;
  created?: string;
  claimed_at?: string;
  completed_at?: string;
}

/** True when stateDir is <repo>/.lumenflow/state */
export function isCanonicalStateDir(stateDir: string): boolean {
  return (
    path.basename(stateDir) === path.basename(LUMENFLOW_PATHS.STATE_DIR) &&
    path.basename(path.dirname(stateDir)) === LUMENFLOW_PATHS.BASE
  );
}

function sanitizeTimestamp(ts: string): string {
  return ts.replace(/[:.]/g, '-');
}

function toIsoTimestamp(raw: string | undefined, fallback?: string): string {
  const candidate = raw ?? fallback;
  if (!candidate) return new Date().toISOString();
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function readLegacyEventTypes(eventPath: string): Set<string> {
  const types = new Set<string>();
  if (!existsSync(eventPath)) return types;
  for (const rawLine of readFileSync(eventPath, 'utf-8').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const p = JSON.parse(line) as { type?: unknown };
      if (typeof p.type === 'string') types.add(p.type);
    } catch {
      types.add(CUTOVER.LEGACY_EVENT_TYPE);
      break;
    }
  }
  return types;
}

function isLegacyCutoverRequired(stateDir: string, eventsPath: string): boolean {
  if (existsSync(path.join(stateDir, CUTOVER.LEGACY_REGISTRY_FILE))) return true;
  return readLegacyEventTypes(eventsPath).has(CUTOVER.LEGACY_EVENT_TYPE);
}

function resolveProjectRoot(stateDir: string): string {
  let current = stateDir;
  for (let depth = 0; depth < 6; depth++) {
    if (existsSync(path.join(current, ...WU_DOCS_SEGMENTS))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (isCanonicalStateDir(stateDir)) return path.dirname(path.dirname(stateDir));
  return path.dirname(stateDir);
}

function moveFileToArchive(src: string, dest: string): void {
  if (!existsSync(src)) return;
  mkdirSync(path.dirname(dest), { recursive: true });
  try {
    renameSync(src, dest);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
      copyFileSync(src, dest);
      unlinkSync(src);
      return;
    }
    throw e;
  }
}

function loadWuBootstrapInfo(filePath: string): BootstrapWUInfo | null {
  try {
    const p = parseYaml(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    if (!p || typeof p !== 'object') return null;
    const id = typeof p.id === 'string' ? p.id : undefined;
    if (!id || !PATTERNS.WU_ID.test(id)) return null;
    const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : undefined);
    return {
      id,
      status: str('status') ?? WU_STATUS.READY,
      lane: str('lane') ?? 'Unknown',
      title: str('title') ?? 'Untitled',
      created: str('created'),
      claimed_at: str('claimed_at'),
      completed_at: str('completed_at'),
    };
  } catch {
    return null;
  }
}

function readBootstrapWUs(projectRoot: string): BootstrapWUInfo[] {
  const wuDir = path.join(projectRoot, ...WU_DOCS_SEGMENTS);
  if (!existsSync(wuDir)) return [];
  const results: BootstrapWUInfo[] = [];
  for (const entry of readdirSync(wuDir, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      !entry.name.startsWith(CUTOVER.WU_FILE_PREFIX) ||
      !entry.name.endsWith('.yaml')
    )
      continue;
    const info = loadWuBootstrapInfo(path.join(wuDir, entry.name));
    if (info) results.push(info);
  }
  return results;
}

function readDoneStampTimes(projectRoot: string): Map<string, string> {
  const stampDir = path.join(projectRoot, ...STAMP_SEGMENTS);
  const stamps = new Map<string, string>();
  if (!existsSync(stampDir)) return stamps;
  for (const entry of readdirSync(stampDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(CUTOVER.DONE_STAMP_SUFFIX)) continue;
    const wuId = entry.name.slice(0, -CUTOVER.DONE_STAMP_SUFFIX.length);
    if (!PATTERNS.WU_ID.test(wuId)) continue;
    try {
      stamps.set(wuId, statSync(path.join(stampDir, entry.name)).mtime.toISOString());
    } catch {
      /* ignore unreadable stamps */
    }
  }
  return stamps;
}

function buildBootstrapEvents(
  wus: BootstrapWUInfo[],
  doneStampTimes: Map<string, string>,
): BootstrapEvent[] {
  const events: BootstrapEvent[] = [];
  for (const wu of wus) {
    const st = wu.status.toLowerCase();
    const stampAt = doneStampTimes.get(wu.id);
    const isDone = st === WU_STATUS.DONE || st === WU_STATUS.COMPLETED || stampAt !== undefined;
    const isReadyLike = st === WU_STATUS.READY || st === WU_STATUS.BACKLOG || st === WU_STATUS.TODO;
    if (isReadyLike && !isDone) continue;

    const claimTs = toIsoTimestamp(wu.claimed_at, wu.created ?? stampAt);
    events.push({ type: 'claim', wuId: wu.id, lane: wu.lane, title: wu.title, timestamp: claimTs });

    if (st === WU_STATUS.BLOCKED && !isDone) {
      const blockedAt = new Date(claimTs);
      blockedAt.setSeconds(blockedAt.getSeconds() + 1);
      events.push({
        type: 'block',
        wuId: wu.id,
        reason: BLOCKED_REASON,
        timestamp: blockedAt.toISOString(),
      });
      continue;
    }
    if (isDone) {
      events.push({
        type: 'complete',
        wuId: wu.id,
        timestamp: toIsoTimestamp(wu.completed_at, stampAt ?? claimTs),
      });
    }
  }
  return events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function writeBootstrappedEvents(eventsPath: string, events: BootstrapEvent[]): void {
  mkdirSync(path.dirname(eventsPath), { recursive: true });
  const lines = events.map((e) => {
    const v = validateWUEvent(e);
    if (!v.success) throw new Error('Generated bootstrap event failed validation');
    return JSON.stringify(v.data);
  });
  writeFileSync(eventsPath, lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf-8');
}

/** Run delegation cutover migration if needed. */
export async function runDelegationCutoverIfNeeded(
  baseDir: string,
  eventsFilePath: string,
): Promise<void> {
  if (!isCanonicalStateDir(baseDir)) return;
  const markerPath = path.join(baseDir, CUTOVER.MARKER_FILE);
  if (existsSync(markerPath)) return;
  if (!isLegacyCutoverRequired(baseDir, eventsFilePath)) return;

  const archiveDir = path.join(
    baseDir,
    CUTOVER.ARCHIVE_DIR,
    `${CUTOVER.ARCHIVE_PREFIX}${sanitizeTimestamp(new Date().toISOString())}`,
  );
  mkdirSync(archiveDir, { recursive: true });

  moveFileToArchive(eventsFilePath, path.join(archiveDir, path.basename(eventsFilePath)));
  moveFileToArchive(
    path.join(baseDir, CUTOVER.LEGACY_REGISTRY_FILE),
    path.join(archiveDir, CUTOVER.LEGACY_REGISTRY_FILE),
  );

  const projectRoot = resolveProjectRoot(baseDir);
  const bootstrapEvents = buildBootstrapEvents(
    readBootstrapWUs(projectRoot),
    readDoneStampTimes(projectRoot),
  );
  writeBootstrappedEvents(eventsFilePath, bootstrapEvents);

  const delegationReg = path.join(baseDir, CUTOVER.DELEGATION_REGISTRY_FILE);
  if (!existsSync(delegationReg)) writeFileSync(delegationReg, '', 'utf-8');

  writeFileSync(
    markerPath,
    `${JSON.stringify(
      {
        migratedAt: new Date().toISOString(),
        archiveDir,
        bootstrapEvents: bootstrapEvents.length,
      },
      null,
      2,
    )}\n`,
    'utf-8',
  );
}
