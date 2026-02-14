/**
 * WU State Store (WU-1570, WU-2240)
 *
 * Event-sourced state store for WU lifecycle following INIT-007 pattern.
 * Stores events in .lumenflow/state/wu-events.jsonl (append-only, git-friendly).
 *
 * Features:
 * - Event sourcing with replay for current state
 * - Atomic append operations (WU-2240: temp file + fsync + rename)
 * - O(1) queries by status and lane via in-memory indexes
 * - State machine validation for legal transitions
 * - File locking with stale detection (WU-2240)
 * - Corruption recovery via repairStateFile (WU-2240)
 *
 * @see {@link packages/@lumenflow/cli/src/__tests__/state-store-concurrent.test.ts} - Concurrent access tests
 * @see {@link packages/@lumenflow/cli/src/lib/wu-state-schema.ts} - Schema definitions
 */

import fs from 'node:fs/promises';
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
  openSync,
  closeSync,
  fsyncSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse as parseYaml } from 'yaml';
import { validateWUEvent, type WUEvent } from './wu-state-schema.js';
import { LUMENFLOW_PATHS, PATTERNS, WU_STATUS } from './wu-constants.js';

/**
 * Lock timeout in milliseconds (5 minutes)
 */
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Lock retry configuration
 */
const LOCK_RETRY_DELAY_MS = 50;
const LOCK_MAX_RETRIES = 100; // 5 seconds total

/**
 * WU events file name constant
 */
export const WU_EVENTS_FILE_NAME = 'wu-events.jsonl';

/**
 * Delegation cutover constants (WU-1674)
 */
const DELEGATION_CUTOVER = Object.freeze({
  MARKER_FILE: '.delegation-cutover-done',
  ARCHIVE_DIR: 'archive',
  ARCHIVE_PREFIX: 'delegation-cutover-',
  LEGACY_REGISTRY_FILE: 'spawn-registry.jsonl',
  DELEGATION_REGISTRY_FILE: 'delegation-registry.jsonl',
  LEGACY_EVENT_TYPE: 'spawn',
  RELATIONSHIP_EVENT_TYPE: 'delegation',
  DONE_STAMP_SUFFIX: '.done',
  WU_FILE_PREFIX: 'WU-',
});

const DELEGATION_CUTOVER_PATHS = Object.freeze({
  WU_DOCS_SEGMENTS: ['docs', '04-operations', 'tasks', 'wu'],
  STAMP_SEGMENTS: [LUMENFLOW_PATHS.BASE, 'stamps'],
});

const BOOTSTRAP_STATUSES = Object.freeze({
  READY: 'ready',
  BACKLOG: 'backlog',
  TODO: 'todo',
  BLOCKED: 'blocked',
  DONE: 'done',
  COMPLETED: 'completed',
});

const BOOTSTRAP_REASON = Object.freeze({
  BLOCKED: 'Bootstrapped from WU YAML (original reason unknown)',
});

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

/**
 * Returns true when the state dir matches the canonical project location:
 * <repo>/.lumenflow/state
 */
function isCanonicalStateDir(stateDir: string): boolean {
  const stateLeaf = path.basename(LUMENFLOW_PATHS.STATE_DIR);
  return (
    path.basename(stateDir) === stateLeaf &&
    path.basename(path.dirname(stateDir)) === LUMENFLOW_PATHS.BASE
  );
}

function sanitizeTimestamp(timestamp: string): string {
  return timestamp.replace(/[:.]/g, '-');
}

function toIsoTimestamp(raw: string | undefined, fallback?: string): string {
  const candidate = raw ?? fallback;
  if (!candidate) {
    return new Date().toISOString();
  }

  if (candidate.includes('T')) {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function readLegacyEventType(eventPath: string): Set<string> {
  const eventTypes = new Set<string>();
  if (!existsSync(eventPath)) {
    return eventTypes;
  }

  const lines = readFileSync(eventPath, 'utf-8').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as { type?: unknown };
      if (typeof parsed.type === 'string') {
        eventTypes.add(parsed.type);
      }
    } catch {
      // Corrupt legacy line: treat as legacy to force archival/rebootstrap.
      eventTypes.add(DELEGATION_CUTOVER.LEGACY_EVENT_TYPE);
      break;
    }
  }

  return eventTypes;
}

function isLegacyCutoverRequired(stateDir: string, eventsPath: string): boolean {
  const legacyRegistryPath = path.join(stateDir, DELEGATION_CUTOVER.LEGACY_REGISTRY_FILE);
  if (existsSync(legacyRegistryPath)) {
    return true;
  }

  const eventTypes = readLegacyEventType(eventsPath);
  return eventTypes.has(DELEGATION_CUTOVER.LEGACY_EVENT_TYPE);
}

function resolveProjectRoot(stateDir: string): string {
  let current = stateDir;
  for (let depth = 0; depth < 6; depth++) {
    const wuDir = path.join(current, ...DELEGATION_CUTOVER_PATHS.WU_DOCS_SEGMENTS);
    if (existsSync(wuDir)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  if (isCanonicalStateDir(stateDir)) {
    return path.dirname(path.dirname(stateDir));
  }

  return path.dirname(stateDir);
}

function moveFileToArchive(sourcePath: string, archivePath: string): void {
  if (!existsSync(sourcePath)) {
    return;
  }

  mkdirSync(path.dirname(archivePath), { recursive: true });
  try {
    renameSync(sourcePath, archivePath);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'EXDEV') {
      copyFileSync(sourcePath, archivePath);
      unlinkSync(sourcePath);
      return;
    }
    throw error;
  }
}

function loadWuBootstrapInfo(filePath: string): BootstrapWUInfo | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = parseYaml(content) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const id = typeof parsed.id === 'string' ? parsed.id : undefined;
    if (!id || !PATTERNS.WU_ID.test(id)) {
      return null;
    }

    return {
      id,
      status: typeof parsed.status === 'string' ? parsed.status : BOOTSTRAP_STATUSES.READY,
      lane: typeof parsed.lane === 'string' ? parsed.lane : 'Unknown',
      title: typeof parsed.title === 'string' ? parsed.title : 'Untitled',
      created: typeof parsed.created === 'string' ? parsed.created : undefined,
      claimed_at: typeof parsed.claimed_at === 'string' ? parsed.claimed_at : undefined,
      completed_at: typeof parsed.completed_at === 'string' ? parsed.completed_at : undefined,
    };
  } catch {
    return null;
  }
}

function readBootstrapWUs(projectRoot: string): BootstrapWUInfo[] {
  const wuDir = path.join(projectRoot, ...DELEGATION_CUTOVER_PATHS.WU_DOCS_SEGMENTS);
  if (!existsSync(wuDir)) {
    return [];
  }

  const results: BootstrapWUInfo[] = [];
  const entries = readdirSync(wuDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.startsWith(DELEGATION_CUTOVER.WU_FILE_PREFIX)) {
      continue;
    }
    if (!entry.name.endsWith('.yaml')) {
      continue;
    }

    const info = loadWuBootstrapInfo(path.join(wuDir, entry.name));
    if (info) {
      results.push(info);
    }
  }

  return results;
}

function readDoneStampTimes(projectRoot: string): Map<string, string> {
  const stampDir = path.join(projectRoot, ...DELEGATION_CUTOVER_PATHS.STAMP_SEGMENTS);
  const doneStamps = new Map<string, string>();

  if (!existsSync(stampDir)) {
    return doneStamps;
  }

  const entries = readdirSync(stampDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(DELEGATION_CUTOVER.DONE_STAMP_SUFFIX)) {
      continue;
    }

    const wuId = entry.name.slice(0, -DELEGATION_CUTOVER.DONE_STAMP_SUFFIX.length);
    if (!PATTERNS.WU_ID.test(wuId)) {
      continue;
    }

    try {
      const stampPath = path.join(stampDir, entry.name);
      doneStamps.set(wuId, statSync(stampPath).mtime.toISOString());
    } catch {
      // Ignore unreadable stamp files during bootstrap.
    }
  }

  return doneStamps;
}

function buildBootstrapEvents(
  wus: BootstrapWUInfo[],
  doneStampTimes: Map<string, string>,
): BootstrapEvent[] {
  const events: BootstrapEvent[] = [];

  for (const wu of wus) {
    const normalizedStatus = wu.status.toLowerCase();
    const stampCompletedAt = doneStampTimes.get(wu.id);
    const isDone =
      normalizedStatus === BOOTSTRAP_STATUSES.DONE ||
      normalizedStatus === BOOTSTRAP_STATUSES.COMPLETED ||
      stampCompletedAt !== undefined;

    const isReadyLike =
      normalizedStatus === BOOTSTRAP_STATUSES.READY ||
      normalizedStatus === BOOTSTRAP_STATUSES.BACKLOG ||
      normalizedStatus === BOOTSTRAP_STATUSES.TODO;

    if (isReadyLike && !isDone) {
      continue;
    }

    const claimTimestamp = toIsoTimestamp(wu.claimed_at, wu.created ?? stampCompletedAt);
    events.push({
      type: 'claim',
      wuId: wu.id,
      lane: wu.lane,
      title: wu.title,
      timestamp: claimTimestamp,
    });

    if (normalizedStatus === BOOTSTRAP_STATUSES.BLOCKED && !isDone) {
      const blockedAt = new Date(claimTimestamp);
      blockedAt.setSeconds(blockedAt.getSeconds() + 1);
      events.push({
        type: 'block',
        wuId: wu.id,
        reason: BOOTSTRAP_REASON.BLOCKED,
        timestamp: blockedAt.toISOString(),
      });
      continue;
    }

    if (isDone) {
      const completedAt = toIsoTimestamp(wu.completed_at, stampCompletedAt ?? claimTimestamp);
      events.push({
        type: 'complete',
        wuId: wu.id,
        timestamp: completedAt,
      });
    }
  }

  return events.sort((left, right) => {
    return new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();
  });
}

function writeBootstrappedEvents(eventsPath: string, events: BootstrapEvent[]): void {
  mkdirSync(path.dirname(eventsPath), { recursive: true });

  const lines = events.map((event) => {
    const validation = validateWUEvent(event);
    if (!validation.success) {
      throw new Error('Generated bootstrap event failed validation');
    }
    return JSON.stringify(validation.data);
  });

  const content = lines.length > 0 ? `${lines.join('\n')}\n` : '';
  writeFileSync(eventsPath, content, 'utf-8');
}

/**
 * WU state entry in the in-memory store
 */
export interface WUStateEntry {
  status: string;
  lane: string;
  title: string;
  completedAt?: string;
  lastCheckpoint?: string;
  lastCheckpointNote?: string;
}

/**
 * Lock file data structure
 */
export interface LockData {
  pid: number;
  timestamp: number;
  hostname: string;
}

/**
 * Checkpoint options
 */
export interface CheckpointOptions {
  sessionId?: string;
  progress?: string;
  nextSteps?: string;
}

/**
 * Repair result
 */
export interface RepairResult {
  success: boolean;
  linesKept: number;
  linesRemoved: number;
  backupPath: string | null;
  warnings: string[];
}

/**
 * WU State Store class
 *
 * Manages WU lifecycle state via event sourcing pattern.
 * Events are appended to JSONL file, state is rebuilt by replaying events.
 */
export class WUStateStore {
  private readonly baseDir: string;
  private readonly eventsFilePath: string;
  private wuState: Map<string, WUStateEntry>;
  private byStatus: Map<string, Set<string>>;
  private byLane: Map<string, Set<string>>;
  private byParent: Map<string, Set<string>>;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.eventsFilePath = path.join(baseDir, WU_EVENTS_FILE_NAME);

    // In-memory state (rebuilt from events)
    this.wuState = new Map();
    this.byStatus = new Map();
    this.byLane = new Map();
    this.byParent = new Map();
  }

  /**
   * WU-1674: On first run, archive spawn-era state files and rebuild wu-events.jsonl
   * using delegation-era semantics. This migration only runs for canonical state dirs
   * (<repo>/.lumenflow/state) and is guarded by a one-time marker file.
   */
  private async _runDelegationCutoverIfNeeded(): Promise<void> {
    if (!isCanonicalStateDir(this.baseDir)) {
      return;
    }

    const markerPath = path.join(this.baseDir, DELEGATION_CUTOVER.MARKER_FILE);
    if (existsSync(markerPath)) {
      return;
    }

    if (!isLegacyCutoverRequired(this.baseDir, this.eventsFilePath)) {
      return;
    }

    const archiveDir = path.join(
      this.baseDir,
      DELEGATION_CUTOVER.ARCHIVE_DIR,
      `${DELEGATION_CUTOVER.ARCHIVE_PREFIX}${sanitizeTimestamp(new Date().toISOString())}`,
    );
    mkdirSync(archiveDir, { recursive: true });

    const legacyRegistryPath = path.join(this.baseDir, DELEGATION_CUTOVER.LEGACY_REGISTRY_FILE);
    moveFileToArchive(this.eventsFilePath, path.join(archiveDir, WU_EVENTS_FILE_NAME));
    moveFileToArchive(
      legacyRegistryPath,
      path.join(archiveDir, DELEGATION_CUTOVER.LEGACY_REGISTRY_FILE),
    );

    const projectRoot = resolveProjectRoot(this.baseDir);
    const wus = readBootstrapWUs(projectRoot);
    const doneStampTimes = readDoneStampTimes(projectRoot);
    const bootstrapEvents = buildBootstrapEvents(wus, doneStampTimes);
    writeBootstrappedEvents(this.eventsFilePath, bootstrapEvents);

    const delegationRegistryPath = path.join(
      this.baseDir,
      DELEGATION_CUTOVER.DELEGATION_REGISTRY_FILE,
    );
    if (!existsSync(delegationRegistryPath)) {
      writeFileSync(delegationRegistryPath, '', 'utf-8');
    }

    const markerPayload = {
      migratedAt: new Date().toISOString(),
      archiveDir,
      bootstrapEvents: bootstrapEvents.length,
    };
    writeFileSync(markerPath, `${JSON.stringify(markerPayload, null, 2)}\n`, 'utf-8');
  }

  /**
   * Loads and replays events from JSONL file into current state.
   *
   * Handles:
   * - Missing file: returns empty state
   * - Empty file: returns empty state
   * - Empty lines: skipped gracefully
   * - Malformed JSON: throws error with line info
   * - Invalid events: throws validation error
   *
   * @throws Error If file contains malformed JSON or invalid events
   *
   * @example
   * const store = new WUStateStore('/path/to/project');
   * await store.load();
   * const inProgress = store.getByStatus('in_progress');
   */
  async load(): Promise<void> {
    // Reset state
    this.wuState.clear();
    this.byStatus.clear();
    this.byLane.clear();
    this.byParent.clear();

    await this._runDelegationCutoverIfNeeded();

    // Check if file exists
    let content: string;
    try {
      content = await fs.readFile(this.eventsFilePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist - return empty state
        return;
      }
      throw error;
    }

    // Parse JSONL content
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines
      if (!line) {
        continue;
      }

      // Parse JSON line
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        throw new Error(`Malformed JSON on line ${i + 1}: ${(error as Error).message}`);
      }

      // Validate against schema
      const validation = validateWUEvent(parsed);
      if (!validation.success) {
        const issues = validation.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', ');
        throw new Error(`Validation error on line ${i + 1}: ${issues}`);
      }

      const event = validation.data;

      // Apply event to state
      this._applyEvent(event);
    }
  }

  /**
   * Transition WU to a new status if it exists.
   */
  private _transitionToStatus(wuId: string, newStatus: string): void {
    const current = this.wuState.get(wuId);
    if (current) {
      this._setState(wuId, newStatus, current.lane, current.title);
    }
  }

  /**
   * Applies an event to the in-memory state.
   */
  private _applyEvent(event: WUEvent): void {
    const { wuId, type } = event;

    if (type === 'create' || type === 'claim') {
      const claimEvent = event as WUEvent & { lane: string; title: string };
      this._setState(wuId, WU_STATUS.IN_PROGRESS, claimEvent.lane, claimEvent.title);
      return;
    }

    if (type === 'block') {
      this._transitionToStatus(wuId, WU_STATUS.BLOCKED);
      return;
    }

    if (type === 'unblock') {
      this._transitionToStatus(wuId, WU_STATUS.IN_PROGRESS);
      return;
    }

    if (type === 'complete') {
      this._transitionToStatus(wuId, WU_STATUS.DONE);
      // WU-2244: Store completion timestamp for accurate date reporting
      const current = this.wuState.get(wuId);
      if (current) {
        current.completedAt = event.timestamp;
      }
      return;
    }

    if (type === 'checkpoint') {
      const checkpointEvent = event as WUEvent & { note?: string };
      const currentCheckpoint = this.wuState.get(wuId);
      if (currentCheckpoint) {
        currentCheckpoint.lastCheckpoint = event.timestamp;
        currentCheckpoint.lastCheckpointNote = checkpointEvent.note;
      }
      return;
    }

    if (type === DELEGATION_CUTOVER.RELATIONSHIP_EVENT_TYPE) {
      const delegationEvent = event as WUEvent & { parentWuId: string };
      const { parentWuId } = delegationEvent;
      if (!this.byParent.has(parentWuId)) {
        this.byParent.set(parentWuId, new Set());
      }
      this.byParent.get(parentWuId)!.add(wuId);
      return;
    }

    // WU-1080: Handle release event - transitions from in_progress to ready
    if (type === 'release') {
      this._transitionToStatus(wuId, WU_STATUS.READY);
    }
  }

  /**
   * Sets WU state and updates indexes.
   */
  private _setState(wuId: string, status: string, lane: string, title: string): void {
    // Remove from old status index
    const oldState = this.wuState.get(wuId);
    if (oldState) {
      const oldStatusSet = this.byStatus.get(oldState.status);
      if (oldStatusSet) {
        oldStatusSet.delete(wuId);
      }

      // Remove from old lane index
      const oldLaneSet = this.byLane.get(oldState.lane);
      if (oldLaneSet) {
        oldLaneSet.delete(wuId);
      }
    }

    // Update state
    this.wuState.set(wuId, { status, lane, title });

    // Add to new status index
    if (!this.byStatus.has(status)) {
      this.byStatus.set(status, new Set());
    }
    this.byStatus.get(status)!.add(wuId);

    // Add to new lane index
    if (!this.byLane.has(lane)) {
      this.byLane.set(lane, new Set());
    }
    this.byLane.get(lane)!.add(wuId);
  }

  /**
   * Appends an event to the events file.
   *
   * Uses append mode to avoid full file rewrite.
   * Creates file and parent directories if they don't exist.
   * Validates event before appending.
   *
   * @throws Error If event fails validation
   */
  private async _appendEvent(event: WUEvent): Promise<void> {
    // Validate event before appending
    const validation = validateWUEvent(event);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw new Error(`Validation error: ${issues}`);
    }

    const line = `${JSON.stringify(event)}\n`;

    // WU-1740: Ensure parent directory exists before appending
    // fs.appendFile creates the file but not parent directories
    await fs.mkdir(this.baseDir, { recursive: true });

    // Use append flag to avoid rewriting the file
    await fs.appendFile(this.eventsFilePath, line, 'utf-8');
  }

  /**
   * Claims a WU (transitions to in_progress).
   *
   * @throws Error If WU is already in_progress
   *
   * @example
   * await store.claim('WU-1570', 'Operations: Tooling', 'Test WU');
   */
  async claim(wuId: string, lane: string, title: string): Promise<void> {
    // Check state machine: can't claim if already in_progress
    const currentState = this.wuState.get(wuId);
    if (currentState && currentState.status === WU_STATUS.IN_PROGRESS) {
      throw new Error(`WU ${wuId} is already ${WU_STATUS.IN_PROGRESS}`);
    }

    const event = {
      type: 'claim' as const,
      wuId,
      lane,
      title,
      timestamp: new Date().toISOString(),
    };

    await this._appendEvent(event as WUEvent);
    this._applyEvent(event as WUEvent);
  }

  /**
   * Completes a WU (transitions to done).
   *
   * @throws Error If WU is not in_progress
   *
   * @example
   * await store.complete('WU-1570');
   */
  async complete(wuId: string): Promise<void> {
    // Check state machine: can only complete if in_progress
    const currentState = this.wuState.get(wuId);
    if (!currentState || currentState.status !== WU_STATUS.IN_PROGRESS) {
      throw new Error(`WU ${wuId} is not ${WU_STATUS.IN_PROGRESS}`);
    }

    const event = {
      type: 'complete' as const,
      wuId,
      timestamp: new Date().toISOString(),
    };

    await this._appendEvent(event as WUEvent);
    this._applyEvent(event as WUEvent);
  }

  /**
   * Get current in-memory state for a WU.
   */
  getWUState(wuId: string): WUStateEntry | undefined {
    return this.wuState.get(wuId);
  }

  /**
   * Create a complete event without writing to disk.
   *
   * Used by transactional flows where event log writes are staged and committed atomically.
   *
   * @throws Error If WU is not in_progress or event fails validation
   */
  createCompleteEvent(wuId: string, timestamp: string = new Date().toISOString()): WUEvent {
    const currentState = this.wuState.get(wuId);
    if (!currentState || currentState.status !== WU_STATUS.IN_PROGRESS) {
      throw new Error(`WU ${wuId} is not ${WU_STATUS.IN_PROGRESS}`);
    }

    const event = { type: 'complete' as const, wuId, timestamp };
    const validation = validateWUEvent(event);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw new Error(`Validation error: ${issues}`);
    }
    return validation.data;
  }

  /**
   * Apply a validated event to in-memory state without writing to disk.
   *
   * @throws Error If event fails validation
   */
  applyEvent(event: WUEvent): void {
    const validation = validateWUEvent(event);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw new Error(`Validation error: ${issues}`);
    }
    this._applyEvent(validation.data);
  }

  /**
   * Blocks a WU (transitions to blocked).
   *
   * @throws Error If WU is not in_progress
   *
   * @example
   * await store.block('WU-1570', 'Blocked by dependency');
   */
  async block(wuId: string, reason: string): Promise<void> {
    // Check state machine: can only block if in_progress
    const currentState = this.wuState.get(wuId);
    if (!currentState || currentState.status !== WU_STATUS.IN_PROGRESS) {
      throw new Error(`WU ${wuId} is not ${WU_STATUS.IN_PROGRESS}`);
    }

    const event = {
      type: 'block' as const,
      wuId,
      reason,
      timestamp: new Date().toISOString(),
    };

    await this._appendEvent(event as WUEvent);
    this._applyEvent(event as WUEvent);
  }

  /**
   * Unblocks a WU (transitions back to in_progress).
   *
   * @throws Error If WU is not blocked
   *
   * @example
   * await store.unblock('WU-1570');
   */
  async unblock(wuId: string): Promise<void> {
    // Check state machine: can only unblock if blocked
    const currentState = this.wuState.get(wuId);
    if (!currentState || currentState.status !== WU_STATUS.BLOCKED) {
      throw new Error(`WU ${wuId} is not ${WU_STATUS.BLOCKED}`);
    }

    const event = {
      type: 'unblock' as const,
      wuId,
      timestamp: new Date().toISOString(),
    };

    await this._appendEvent(event as WUEvent);
    this._applyEvent(event as WUEvent);
  }

  /**
   * Records a checkpoint for a WU (WU-1748: cross-agent visibility).
   *
   * Checkpoints are recorded for visibility but don't change WU state.
   * Used to track progress and detect abandoned WUs.
   *
   * @example
   * await store.checkpoint('WU-1748', 'Completed worktree scanner', {
   *   progress: 'Scanner implemented and tests passing',
   *   nextSteps: 'Integrate into orchestrate:monitor'
   * });
   */
  async checkpoint(wuId: string, note: string, options: CheckpointOptions = {}): Promise<void> {
    const { sessionId, progress, nextSteps } = options;

    const event: Record<string, unknown> = {
      type: 'checkpoint' as const,
      wuId,
      note,
      timestamp: new Date().toISOString(),
    };

    if (sessionId) event.sessionId = sessionId;
    if (progress) event.progress = progress;
    if (nextSteps) event.nextSteps = nextSteps;

    await this._appendEvent(event as WUEvent);
    this._applyEvent(event as WUEvent);
  }

  /**
   * Gets WU IDs by status (O(1) lookup).
   *
   * @example
   * const inProgress = store.getByStatus('in_progress');
   * for (const wuId of inProgress) {
   *   console.log(wuId);
   * }
   */
  getByStatus(status: string): Set<string> {
    return this.byStatus.get(status) ?? new Set();
  }

  /**
   * Gets WU IDs by lane (O(1) lookup).
   *
   * @example
   * const tooling = store.getByLane('Operations: Tooling');
   * for (const wuId of tooling) {
   *   console.log(wuId);
   * }
   */
  getByLane(lane: string): Set<string> {
    return this.byLane.get(lane) ?? new Set();
  }

  /**
   * Gets child WU IDs delegated from a parent WU (O(1) lookup).
   * WU-1947: Parent-child relationship tracking.
   *
   * @example
   * const children = store.getChildWUs('WU-100');
   * for (const childId of children) {
   *   console.log(`Child WU: ${childId}`);
   * }
   */
  getChildWUs(parentWuId: string): Set<string> {
    return this.byParent.get(parentWuId) ?? new Set();
  }

  /**
   * Records a delegation relationship between parent and child WUs.
   * WU-1947: Parent-child relationship tracking.
   *
   * @example
   * await store.delegate('WU-200', 'WU-100', 'dlg-abc123');
   */
  async delegate(childWuId: string, parentWuId: string, delegationId: string): Promise<void> {
    const event = {
      type: DELEGATION_CUTOVER.RELATIONSHIP_EVENT_TYPE,
      wuId: childWuId,
      parentWuId,
      delegationId,
      timestamp: new Date().toISOString(),
    };

    await this._appendEvent(event as WUEvent);
    this._applyEvent(event as WUEvent);
  }

  /**
   * Releases an in_progress WU back to ready state (WU-1080: orphan recovery).
   *
   * Use this when an agent is interrupted mid-WU and the WU needs to be
   * made available for reclaiming by another agent.
   *
   * @throws Error If WU is not in_progress
   *
   * @example
   * await store.release('WU-1080', 'Agent interrupted mid-WU');
   */
  async release(wuId: string, reason: string): Promise<void> {
    // Check state machine: can only release if in_progress
    const currentState = this.wuState.get(wuId);
    if (!currentState || currentState.status !== WU_STATUS.IN_PROGRESS) {
      throw new Error(`WU ${wuId} is not ${WU_STATUS.IN_PROGRESS}`);
    }

    const event = {
      type: 'release' as const,
      wuId,
      reason,
      timestamp: new Date().toISOString(),
    };

    await this._appendEvent(event as WUEvent);
    this._applyEvent(event as WUEvent);
  }

  /**
   * Create a release event without writing to disk.
   *
   * Used by transactional flows where event log writes are staged and committed atomically.
   * WU-1080: Orphan recovery support.
   *
   * @throws Error If WU is not in_progress or event fails validation
   */
  createReleaseEvent(
    wuId: string,
    reason: string,
    timestamp: string = new Date().toISOString(),
  ): WUEvent {
    const currentState = this.wuState.get(wuId);
    if (!currentState || currentState.status !== WU_STATUS.IN_PROGRESS) {
      throw new Error(`WU ${wuId} is not ${WU_STATUS.IN_PROGRESS}`);
    }

    const event = { type: 'release' as const, wuId, reason, timestamp };
    const validation = validateWUEvent(event);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw new Error(`Validation error: ${issues}`);
    }
    return validation.data;
  }
}

/**
 * Check if a process with given PID is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without affecting it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a lock is stale (expired or dead process)
 *
 * WU-2240: Prepared for proper-lockfile integration
 */
export function isLockStale(lockData: LockData): boolean {
  const now = Date.now();
  const lockAge = now - lockData.timestamp;

  // Check timeout first (5 minutes)
  if (lockAge > LOCK_TIMEOUT_MS) {
    return true;
  }

  // Check if on same host - if different host, can't check PID
  if (lockData.hostname !== os.hostname()) {
    // Different host, only rely on timeout
    return false;
  }

  // Same host - check if process is still alive
  return !isProcessRunning(lockData.pid);
}

/**
 * Safely remove a lock file, ignoring errors
 */
function safeUnlink(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // Ignore removal errors
  }
}

/**
 * Read and parse existing lock file
 */
function readLockFile(lockPath: string): LockData | null {
  try {
    const content = readFileSync(lockPath, 'utf-8');
    return JSON.parse(content) as LockData;
  } catch {
    return null;
  }
}

/**
 * Handle existing lock file - returns true if should retry
 */
async function handleExistingLock(lockPath: string): Promise<boolean> {
  const existingLock = readLockFile(lockPath);
  if (!existingLock) {
    // Corrupted lock file - remove and retry
    safeUnlink(lockPath);
    return true;
  }

  if (isLockStale(existingLock)) {
    safeUnlink(lockPath);
    return true;
  }

  // Lock is held by active process - wait and retry
  await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
  return true;
}

/**
 * Try to create a lock file atomically
 */
async function tryCreateLock(lockPath: string, lockData: LockData): Promise<boolean> {
  try {
    mkdirSync(path.dirname(lockPath), { recursive: true });
    const fd = openSync(lockPath, 'wx');
    const content = JSON.stringify(lockData);
    writeFileSync(fd, content, 'utf-8');
    fsyncSync(fd);
    closeSync(fd);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
      return false;
    }
    throw error;
  }
}

/**
 * Acquire a file lock for the events file
 *
 * Uses a JSON lock file containing PID, timestamp, and hostname.
 * Implements stale lock detection via:
 * - PID check (on same host)
 * - 5-minute timeout (across hosts)
 *
 * WU-2240: Prepared for proper-lockfile integration
 *
 * @throws Error If lock cannot be acquired after retries
 */
export async function acquireLock(lockPath: string): Promise<void> {
  const lockData: LockData = {
    pid: process.pid,
    timestamp: Date.now(),
    hostname: os.hostname(),
  };

  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
    if (existsSync(lockPath)) {
      const shouldRetry = await handleExistingLock(lockPath);
      if (shouldRetry) continue;
    }

    const acquired = await tryCreateLock(lockPath, lockData);
    if (acquired) return;
  }

  throw new Error(`Failed to acquire lock after ${LOCK_MAX_RETRIES} attempts`);
}

/**
 * Release a file lock
 *
 * WU-2240: Prepared for proper-lockfile integration
 */
export function releaseLock(lockPath: string): void {
  safeUnlink(lockPath);
}

/**
 * Repair a corrupted state file by removing invalid lines.
 *
 * WU-2240: Corruption recovery for wu-events.jsonl
 *
 * Features:
 * - Creates backup before repair
 * - Removes malformed JSON lines
 * - Removes lines that fail schema validation
 * - Returns detailed repair statistics
 *
 * @example
 * const stateFilePath = path.join(process.cwd(), '.lumenflow', 'state', 'wu-events.jsonl');
 * const result = await repairStateFile(stateFilePath);
 * if (result.success) {
 *   console.log(`Repaired: kept ${result.linesKept}, removed ${result.linesRemoved}`);
 * }
 */
export async function repairStateFile(filePath: string): Promise<RepairResult> {
  const warnings: string[] = [];
  let linesKept = 0;
  let linesRemoved = 0;

  // Check if file exists
  if (!existsSync(filePath)) {
    return {
      success: true,
      linesKept: 0,
      linesRemoved: 0,
      backupPath: null,
      warnings: ['File does not exist, nothing to repair'],
    };
  }

  // Read the original content
  const originalContent = readFileSync(filePath, 'utf-8');
  const lines = originalContent.split('\n');

  // Create backup with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.backup.${timestamp}`;
  writeFileSync(backupPath, originalContent, 'utf-8');

  // Process each line
  const validLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines
    if (!line) {
      continue;
    }

    // Try to parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      linesRemoved++;
      warnings.push(`Line ${i + 1}: Malformed JSON removed`);
      continue;
    }

    // Validate against schema
    const validation = validateWUEvent(parsed);
    if (!validation.success) {
      linesRemoved++;
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      warnings.push(`Line ${i + 1}: Invalid event removed (${issues})`);
      continue;
    }

    // Line is valid
    validLines.push(line);
    linesKept++;
  }

  // Write repaired file atomically
  const tempPath = `${filePath}.tmp.${process.pid}`;
  const repairedContent = validLines.length > 0 ? `${validLines.join('\n')}\n` : '';

  try {
    const fd = openSync(tempPath, 'w');
    writeFileSync(fd, repairedContent, 'utf-8');
    fsyncSync(fd);
    closeSync(fd);

    // Atomic rename
    renameSync(tempPath, filePath);

    // Fsync directory
    const dirPath = path.dirname(filePath);
    const dirFd = openSync(dirPath, 'r');
    fsyncSync(dirFd);
    closeSync(dirFd);
  } catch (error) {
    // Cleanup temp file on failure
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }

  // Add warning if file is now empty
  if (linesKept === 0 && linesRemoved > 0) {
    warnings.push('All lines were invalid - file is now empty');
  }

  return {
    success: true,
    linesKept,
    linesRemoved,
    backupPath,
    warnings,
  };
}
