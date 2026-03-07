// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Event Sourcer (WU-2013)
 *
 * Handles event sourcing operations for WU lifecycle:
 * - Loading and replaying events from JSONL file
 * - Appending new events with validation
 *
 * Single responsibility: event file I/O and replay.
 *
 * @see {@link ./wu-state-store.ts} - Facade that delegates to this service
 * @see {@link ./wu-state-indexer.ts} - Applies events to in-memory state
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateWUEvent, type WUEvent } from './wu-state-schema.js';
import type { WUStateIndexer } from './wu-state-indexer.js';
import { getErrorMessage, createError, ErrorCodes } from './error-handler.js';

/**
 * WU events file name constant
 */
export const WU_EVENTS_FILE_NAME = 'wu-events.jsonl';
export const WU_BRIEF_EVIDENCE_NOTE_PREFIX = '[wu:brief]';
export const WU_BRIEF_EVIDENCE_MODES = ['prompt', 'evidence-only', 'claim-auto'] as const;

export type WuBriefEvidenceMode = (typeof WU_BRIEF_EVIDENCE_MODES)[number];

export interface WuBriefEvidence {
  wuId: string;
  timestamp: string;
  note: string;
  nextSteps?: string;
  clientName?: string;
  mode?: WuBriefEvidenceMode;
  promptHash?: string;
}

const WU_BRIEF_HASH_REGEX = /^[a-f0-9]{64}$/;

function parseWuBriefEvidenceMetadata(nextSteps: unknown): Map<string, string> {
  const metadata = new Map<string, string>();
  if (typeof nextSteps !== 'string' || nextSteps.trim().length === 0) {
    return metadata;
  }

  for (const token of nextSteps.split(';')) {
    const trimmedToken = token.trim();
    if (trimmedToken.length === 0) {
      continue;
    }

    const separatorIndex = trimmedToken.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmedToken.slice(0, separatorIndex).trim();
    const value = trimmedToken.slice(separatorIndex + 1).trim();
    if (key.length === 0 || value.length === 0) {
      continue;
    }

    metadata.set(key, value);
  }

  return metadata;
}

function isWuBriefEvidenceMode(value: unknown): value is WuBriefEvidenceMode {
  return (
    typeof value === 'string' && WU_BRIEF_EVIDENCE_MODES.includes(value as WuBriefEvidenceMode)
  );
}

function hashesEqualTimingSafe(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Returns true when a checkpoint note represents wu:brief evidence.
 */
export function isWuBriefEvidenceNote(note: unknown): note is string {
  return typeof note === 'string' && note.startsWith(WU_BRIEF_EVIDENCE_NOTE_PREFIX);
}

/**
 * Extract attested brief hash from checkpoint nextSteps payload.
 */
export function extractWuBriefEvidenceHash(nextSteps: unknown): string | null {
  const hash = parseWuBriefEvidenceMetadata(nextSteps).get('hash');
  return hash && WU_BRIEF_HASH_REGEX.test(hash) ? hash : null;
}

/**
 * Extract brief client name from checkpoint nextSteps payload.
 */
export function extractWuBriefEvidenceClient(nextSteps: unknown): string | null {
  const clientName = parseWuBriefEvidenceMetadata(nextSteps).get('client');
  return clientName && clientName.length > 0 ? clientName : null;
}

/**
 * Extract brief mode from checkpoint nextSteps payload.
 *
 * Older evidence may not have an explicit mode. In that case, fall back to
 * signatures that can be inferred safely without misclassifying ambiguous
 * legacy prompt records.
 */
export function extractWuBriefEvidenceMode(nextSteps: unknown): WuBriefEvidenceMode | null {
  const metadata = parseWuBriefEvidenceMetadata(nextSteps);
  const explicitMode = metadata.get('mode');
  if (isWuBriefEvidenceMode(explicitMode)) {
    return explicitMode;
  }

  const clientName = metadata.get('client');
  if (clientName === 'wu:claim:auto') {
    return 'claim-auto';
  }

  return extractWuBriefEvidenceHash(nextSteps) ? 'prompt' : null;
}

/**
 * Compute evidence age in whole minutes.
 * Returns null when the timestamp cannot be parsed.
 */
export function getWuBriefEvidenceAgeMinutes(
  timestamp: string,
  now: Date = new Date(),
): number | null {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const ageMs = Math.max(0, now.getTime() - parsed);
  return Math.floor(ageMs / (60 * 1000));
}

/**
 * Evaluate whether wu:brief evidence is stale for a configured threshold.
 * Unparseable timestamps are treated as stale to keep policy enforcement conservative.
 */
export function isWuBriefEvidenceStale(options: {
  timestamp: string;
  freshnessMinutes: number;
  now?: Date;
}): boolean {
  const ageMinutes = getWuBriefEvidenceAgeMinutes(options.timestamp, options.now);
  if (ageMinutes === null) {
    return true;
  }
  return ageMinutes >= options.freshnessMinutes;
}

const FILE_NOT_FOUND_ERROR_CODE = 'ENOENT';

function getErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  if (!('code' in error)) {
    return null;
  }

  const { code } = error;
  return typeof code === 'string' ? code : null;
}

function parseValidatedEvents(content: string): WUEvent[] {
  const events: WUEvent[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (typeof rawLine !== 'string') {
      continue;
    }
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw createError(
        ErrorCodes.PARSE_ERROR,
        `Malformed JSON on line ${i + 1}: ${getErrorMessage(error)}`,
      );
    }

    const validation = validateWUEvent(parsed);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw createError(
        ErrorCodes.VALIDATION_ERROR,
        `Validation error on line ${i + 1}: ${issues}`,
      );
    }

    events.push(validation.data);
  }

  return events;
}

async function readEventsFileSafely(eventsFilePath: string): Promise<string> {
  try {
    return await fs.readFile(eventsFilePath, 'utf-8');
  } catch (error) {
    if (getErrorCode(error) === FILE_NOT_FOUND_ERROR_CODE) {
      return '';
    }
    throw error;
  }
}

/**
 * Find the latest wu:brief checkpoint evidence in a list of validated events.
 */
export function findLatestWuBriefEvidence(
  events: readonly WUEvent[],
  wuId: string,
): WuBriefEvidence | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event || event.type !== 'checkpoint') {
      continue;
    }

    if (event.wuId === wuId && isWuBriefEvidenceNote(event.note)) {
      const nextSteps = typeof event.nextSteps === 'string' ? event.nextSteps : undefined;
      const clientName = extractWuBriefEvidenceClient(nextSteps);
      const mode = extractWuBriefEvidenceMode(nextSteps);
      const promptHash = extractWuBriefEvidenceHash(nextSteps);
      return {
        wuId: event.wuId,
        timestamp: event.timestamp,
        note: event.note,
        ...(nextSteps ? { nextSteps } : {}),
        ...(clientName ? { clientName } : {}),
        ...(mode ? { mode } : {}),
        ...(promptHash ? { promptHash } : {}),
      };
    }
  }

  return null;
}

/**
 * Returns true when any wu:brief checkpoint for WU contains the expected hash.
 */
export function hasWuBriefEvidenceHash(
  events: readonly WUEvent[],
  wuId: string,
  expectedHash: string,
): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event || event.type !== 'checkpoint') {
      continue;
    }
    if (event.wuId !== wuId || !isWuBriefEvidenceNote(event.note)) {
      continue;
    }
    const hash = extractWuBriefEvidenceHash(event.nextSteps);
    if (hash && hashesEqualTimingSafe(hash, expectedHash)) {
      return true;
    }
  }
  return false;
}

/**
 * Read wu-events and return latest wu:brief evidence for a WU (if any).
 */
export async function getLatestWuBriefEvidence(
  baseDir: string,
  wuId: string,
): Promise<WuBriefEvidence | null> {
  const eventsFilePath = path.join(baseDir, WU_EVENTS_FILE_NAME);
  const content = await readEventsFileSafely(eventsFilePath);
  if (!content.trim()) {
    return null;
  }

  return findLatestWuBriefEvidence(parseValidatedEvents(content), wuId);
}

/**
 * Read wu-events and check whether any wu:brief checkpoint for WU contains expected hash.
 */
export async function hasMatchingWuBriefEvidenceHash(
  baseDir: string,
  wuId: string,
  expectedHash: string,
): Promise<boolean> {
  const eventsFilePath = path.join(baseDir, WU_EVENTS_FILE_NAME);
  const content = await readEventsFileSafely(eventsFilePath);
  if (!content.trim()) {
    return false;
  }
  return hasWuBriefEvidenceHash(parseValidatedEvents(content), wuId, expectedHash);
}

/**
 * WU Event Sourcer
 *
 * Manages event file I/O: loading events from JSONL, replaying them
 * into a WUStateIndexer and appending new validated events.
 */
export class WUEventSourcer {
  private readonly baseDir: string;
  private readonly eventsFilePath: string;
  private readonly indexer: WUStateIndexer;

  constructor(baseDir: string, indexer: WUStateIndexer) {
    this.baseDir = baseDir;
    this.eventsFilePath = path.join(baseDir, WU_EVENTS_FILE_NAME);
    this.indexer = indexer;
  }

  /** Get the events file path (used by facade for external consumers). */
  getEventsFilePath(): string {
    return this.eventsFilePath;
  }

  /**
   * Load and replay events from JSONL file into the indexer.
   *
   * Handles:
   * - Missing file: returns empty state
   * - Empty file: returns empty state
   * - Empty lines: skipped gracefully
   * - Malformed JSON: throws error with line info
   * - Invalid events: throws validation error
   *
   * @throws Error If file contains malformed JSON or invalid events
   */
  async load(): Promise<void> {
    this.indexer.clear();

    const content = await readEventsFileSafely(this.eventsFilePath);
    if (!content.trim()) {
      return;
    }

    const events = parseValidatedEvents(content);
    for (const event of events) {
      this.indexer.applyEvent(event);
    }
  }

  /**
   * Append an event to the events file.
   * Validates event before appending. Creates directories if needed.
   *
   * @throws Error If event fails validation
   */
  async appendEvent(event: WUEvent): Promise<void> {
    const validation = validateWUEvent(event);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw createError(ErrorCodes.VALIDATION_ERROR, `Validation error: ${issues}`);
    }

    const line = `${JSON.stringify(event)}\n`;
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.appendFile(this.eventsFilePath, line, 'utf-8');
  }

  /** Append an event to disk and apply it to the indexer. */
  async appendAndApply(event: WUEvent): Promise<void> {
    await this.appendEvent(event);
    this.indexer.applyEvent(event);
  }
}
