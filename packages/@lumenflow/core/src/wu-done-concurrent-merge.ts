/**
 * WU-1145: Concurrent backlog merge utilities
 *
 * This module provides utilities for merging state stores from worktree
 * and main branches to prevent loss of concurrent WU completions.
 *
 * Problem: When wu:done regenerates backlog.md, it only uses the worktree's
 * state store, losing any WUs that were completed on main since the worktree
 * was created.
 *
 * Solution: Before regenerating backlog.md, merge events from both state
 * stores using event deduplication by identity (type, wuId, timestamp).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WUStateStore, WU_EVENTS_FILE_NAME } from './wu-state-store.js';
import { validateWUEvent, type WUEvent } from './wu-state-schema.js';
import { generateBacklog, generateStatus } from './backlog-generator.js';
import { getStateStoreDirFromBacklog } from './wu-paths.js';
import { getGitForCwd } from './git-adapter.js';
import { REMOTES, BRANCHES, LUMENFLOW_PATHS, WU_STATUS } from './wu-constants.js';

/**
 * Creates a unique key for an event to detect duplicates.
 * Events are considered identical if they have the same type, wuId, and timestamp.
 */
function getEventKey(event: WUEvent): string {
  return `${event.type}:${event.wuId}:${event.timestamp}`;
}

/**
 * Fetch wu-events.jsonl content from origin/main using git show.
 *
 * This allows us to read the state from main without switching branches
 * or having access to the main checkout directory.
 *
 * @returns Events content from origin/main, or null if not available
 */
export async function fetchMainEventsContent(): Promise<string | null> {
  try {
    const git = getGitForCwd();

    // First, fetch to ensure we have the latest main
    try {
      await git.fetch(REMOTES.ORIGIN, BRANCHES.MAIN);
    } catch {
      // If fetch fails (e.g., offline), continue with cached version
      console.warn('[wu-done] Warning: Could not fetch latest main, using cached version');
    }

    // Try to read wu-events.jsonl from origin/main
    const eventsPath = `${LUMENFLOW_PATHS.STATE_DIR}/${WU_EVENTS_FILE_NAME}`;
    const content = await git.raw(['show', `${REMOTES.ORIGIN}/${BRANCHES.MAIN}:${eventsPath}`]);
    return content;
  } catch (error) {
    // File may not exist on main (e.g., new repo or first WU)
    // Or we may not be in a git repo
    return null;
  }
}

/**
 * Parse wu-events.jsonl content into validated events
 */
function parseEventsFile(content: string, sourceLabel: string): WUEvent[] {
  const events: WUEvent[] = [];
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch (error) {
      console.warn(`[wu-done] Warning: Malformed JSON in ${sourceLabel} line ${i + 1}, skipping`);
      continue;
    }

    const validation = validateWUEvent(parsed);
    if (!validation.success) {
      console.warn(`[wu-done] Warning: Invalid event in ${sourceLabel} line ${i + 1}, skipping`);
      continue;
    }

    events.push(validation.data);
  }

  return events;
}

/**
 * Load events from a state directory
 */
function loadEventsFromDir(stateDir: string, label: string): WUEvent[] {
  const eventsPath = join(stateDir, WU_EVENTS_FILE_NAME);

  if (!existsSync(eventsPath)) {
    return [];
  }

  const content = readFileSync(eventsPath, { encoding: 'utf-8' });
  return parseEventsFile(content, label);
}

/**
 * Merge events from two sources, preserving order and deduplicating.
 *
 * The merge strategy:
 * 1. Start with all events from main (the "base" timeline)
 * 2. Add any events from worktree that aren't in main
 *
 * This ensures:
 * - Concurrent completions on main are preserved
 * - The worktree's claim/in_progress events are included
 * - No duplicate events
 */
function mergeEvents(mainEvents: WUEvent[], worktreeEvents: WUEvent[]): WUEvent[] {
  const seen = new Set<string>();
  const merged: WUEvent[] = [];

  // First, add all main events
  for (const event of mainEvents) {
    const key = getEventKey(event);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(event);
    }
  }

  // Then add worktree events that aren't in main
  for (const event of worktreeEvents) {
    const key = getEventKey(event);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(event);
    }
  }

  // Sort by timestamp to ensure chronological order
  merged.sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    return timeA - timeB;
  });

  return merged;
}

/**
 * Merge state stores from worktree and main.
 *
 * This creates a new WUStateStore instance that contains the merged
 * state from both sources, preserving all concurrent modifications.
 *
 * @param worktreeStateDir - Path to worktree's .lumenflow/state directory
 * @param mainStateDir - Path to main's .lumenflow/state directory
 * @returns A WUStateStore with merged state
 */
export async function mergeStateStores(
  worktreeStateDir: string,
  mainStateDir: string,
): Promise<WUStateStore> {
  // Load events from both sources
  const worktreeEvents = loadEventsFromDir(worktreeStateDir, 'worktree');
  const mainEvents = loadEventsFromDir(mainStateDir, 'main');

  // Merge events
  const mergedEvents = mergeEvents(mainEvents, worktreeEvents);

  // Create a new store and replay merged events
  const store = new WUStateStore(worktreeStateDir);

  for (const event of mergedEvents) {
    store.applyEvent(event);
  }

  return store;
}

/**
 * Compute backlog content with merged state from worktree and main.
 *
 * This is a drop-in replacement for computeBacklogContent that handles
 * concurrent modifications by merging state stores before generation.
 *
 * @param backlogPath - Path to backlog.md in the worktree
 * @param wuId - WU ID being completed
 * @param title - WU title
 * @param mainStateDir - Path to main's .lumenflow/state directory
 * @returns Merged backlog.md content
 */
export async function computeBacklogContentWithMerge(
  backlogPath: string,
  wuId: string,
  title: string,
  mainStateDir: string,
): Promise<string> {
  const worktreeStateDir = getStateStoreDirFromBacklog(backlogPath);

  // Merge state stores
  const mergedStore = await mergeStateStores(worktreeStateDir, mainStateDir);

  // Check if the WU is already done in the merged state
  const currentState = mergedStore.getWUState(wuId);

  if (!currentState) {
    throw new Error(`WU ${wuId} not found in merged state store`);
  }

  // If not already done, create and apply the complete event
  if (currentState.status !== WU_STATUS.DONE) {
    const completeEvent = mergedStore.createCompleteEvent(wuId);
    mergedStore.applyEvent(completeEvent);
  }

  // Generate backlog from merged state
  return generateBacklog(mergedStore);
}

/**
 * Get the merged events content for wu-events.jsonl
 *
 * This returns the content that should be written to wu-events.jsonl
 * after merging worktree and main state stores.
 *
 * @param worktreeStateDir - Path to worktree's .lumenflow/state directory
 * @param mainStateDir - Path to main's .lumenflow/state directory
 * @param wuId - WU ID being completed (to add complete event)
 * @returns JSONL content for the merged events file
 */
export async function getMergedEventsContent(
  worktreeStateDir: string,
  mainStateDir: string,
  wuId: string,
): Promise<string> {
  // Load events from both sources
  const worktreeEvents = loadEventsFromDir(worktreeStateDir, 'worktree');
  const mainEvents = loadEventsFromDir(mainStateDir, 'main');

  // Merge events
  const mergedEvents = mergeEvents(mainEvents, worktreeEvents);

  // Check if we need to add a complete event
  const lastEventForWU = [...mergedEvents].reverse().find((e) => e.wuId === wuId);

  if (!lastEventForWU || lastEventForWU.type !== 'complete') {
    // Create a temporary store to generate the complete event
    const tempStore = new WUStateStore(worktreeStateDir);
    for (const event of mergedEvents) {
      tempStore.applyEvent(event);
    }

    const currentState = tempStore.getWUState(wuId);
    if (currentState && currentState.status === WU_STATUS.IN_PROGRESS) {
      const completeEvent = tempStore.createCompleteEvent(wuId);
      mergedEvents.push(completeEvent);
    }
  }

  // Convert to JSONL
  return mergedEvents.map((event) => JSON.stringify(event)).join('\n') + '\n';
}

/**
 * Merge worktree state with origin/main state using git show.
 *
 * This function:
 * 1. Fetches the wu-events.jsonl content from origin/main using git show
 * 2. Parses events from both worktree and main
 * 3. Merges them with deduplication
 * 4. Returns a store with the merged state
 *
 * This is the integration point for wu:done to preserve concurrent changes.
 *
 * @param worktreeStateDir - Path to worktree's .lumenflow/state directory
 * @returns A WUStateStore with merged state, or just worktree state if main unavailable
 */
export async function mergeWithMainState(worktreeStateDir: string): Promise<WUStateStore> {
  // Load worktree events
  const worktreeEvents = loadEventsFromDir(worktreeStateDir, 'worktree');

  // Try to fetch main events via git show
  const mainContent = await fetchMainEventsContent();
  const mainEvents = mainContent ? parseEventsFile(mainContent, 'origin/main') : [];

  if (mainEvents.length > 0) {
    console.log(
      `[wu-done] Merging state: ${worktreeEvents.length} worktree events + ${mainEvents.length} main events`,
    );
  }

  // Merge events
  const mergedEvents = mergeEvents(mainEvents, worktreeEvents);

  // Create a new store and replay merged events
  const store = new WUStateStore(worktreeStateDir);

  for (const event of mergedEvents) {
    store.applyEvent(event);
  }

  return store;
}

/**
 * Compute backlog content with merged state from origin/main.
 *
 * This is the main integration function for wu:done. It:
 * 1. Loads the worktree's state
 * 2. Fetches and merges state from origin/main
 * 3. Applies the complete event for the WU being done
 * 4. Generates backlog from the merged state
 *
 * @param backlogPath - Path to backlog.md in the worktree
 * @param wuId - WU ID being completed
 * @returns Merged backlog.md content
 */
export async function computeBacklogContentWithMainMerge(
  backlogPath: string,
  wuId: string,
): Promise<string> {
  const worktreeStateDir = getStateStoreDirFromBacklog(backlogPath);

  // Merge with main state
  const mergedStore = await mergeWithMainState(worktreeStateDir);

  // Check if the WU exists in the merged state
  const currentState = mergedStore.getWUState(wuId);

  if (!currentState) {
    throw new Error(
      `WU ${wuId} not found in merged state store. ` +
        `This may indicate the WU was never properly claimed.`,
    );
  }

  // If not already done, create and apply the complete event
  if (currentState.status !== WU_STATUS.DONE) {
    if (currentState.status !== WU_STATUS.IN_PROGRESS) {
      throw new Error(`WU ${wuId} is in status "${currentState.status}", expected "${WU_STATUS.IN_PROGRESS}"`);
    }
    const completeEvent = mergedStore.createCompleteEvent(wuId);
    mergedStore.applyEvent(completeEvent);
  }

  // Generate backlog from merged state
  return generateBacklog(mergedStore);
}

/**
 * Compute status.md content with merged state from origin/main.
 *
 * WU-1319: This function generates status.md from the merged state store
 * instead of editing the local file snapshot. This prevents reintroducing
 * stale "In Progress" entries when concurrent WUs complete on main.
 *
 * @param backlogPath - Path to backlog.md in the worktree (used to find state dir)
 * @param wuId - WU ID being completed
 * @param mainStateDir - Optional explicit path to main state dir (for testing)
 * @returns Merged status.md content
 */
export async function computeStatusContentWithMainMerge(
  backlogPath: string,
  wuId: string,
  mainStateDir?: string,
): Promise<string> {
  const worktreeStateDir = getStateStoreDirFromBacklog(backlogPath);

  let mergedStore: WUStateStore;

  if (mainStateDir) {
    // Direct merge with provided main state dir (for testing)
    mergedStore = await mergeStateStores(worktreeStateDir, mainStateDir);
  } else {
    // Merge with main state via git show
    mergedStore = await mergeWithMainState(worktreeStateDir);
  }

  // Check if the WU exists in the merged state
  const currentState = mergedStore.getWUState(wuId);

  if (!currentState) {
    throw new Error(
      `WU ${wuId} not found in merged state store. ` +
        `This may indicate the WU was never properly claimed.`,
    );
  }

  // If not already done, create and apply the complete event
  if (currentState.status !== WU_STATUS.DONE) {
    if (currentState.status !== WU_STATUS.IN_PROGRESS) {
      throw new Error(`WU ${wuId} is in status "${currentState.status}", expected "${WU_STATUS.IN_PROGRESS}"`);
    }
    const completeEvent = mergedStore.createCompleteEvent(wuId);
    mergedStore.applyEvent(completeEvent);
  }

  // Generate status from merged state
  return generateStatus(mergedStore);
}

/**
 * Compute wu-events.jsonl content with merged state from origin/main.
 *
 * Returns the JSONL content that should be written to wu-events.jsonl,
 * containing merged events from both worktree and main, plus the completion event.
 *
 * @param backlogPath - Path to backlog.md in the worktree
 * @param wuId - WU ID being completed
 * @returns Object with events path and merged content, or null if no update needed
 */
export async function computeWUEventsContentWithMainMerge(
  backlogPath: string,
  wuId: string,
): Promise<{ eventsPath: string; content: string } | null> {
  const worktreeStateDir = getStateStoreDirFromBacklog(backlogPath);

  // Load worktree events
  const worktreeEvents = loadEventsFromDir(worktreeStateDir, 'worktree');

  // Try to fetch main events via git show
  const mainContent = await fetchMainEventsContent();
  const mainEvents = mainContent ? parseEventsFile(mainContent, 'origin/main') : [];

  // Merge events
  const mergedEvents = mergeEvents(mainEvents, worktreeEvents);

  // Check if WU is already done
  const tempStore = new WUStateStore(worktreeStateDir);
  for (const event of mergedEvents) {
    tempStore.applyEvent(event);
  }

  const currentState = tempStore.getWUState(wuId);
  if (!currentState) {
    throw new Error(`WU ${wuId} not found in merged state store`);
  }

  if (currentState.status === WU_STATUS.DONE) {
    // Already done, no update needed
    return null;
  }

  if (currentState.status !== WU_STATUS.IN_PROGRESS) {
    throw new Error(`WU ${wuId} is in status "${currentState.status}", expected "${WU_STATUS.IN_PROGRESS}"`);
  }

  // Add complete event
  const completeEvent = tempStore.createCompleteEvent(wuId);
  mergedEvents.push(completeEvent);

  const eventsPath = join(worktreeStateDir, WU_EVENTS_FILE_NAME);
  const content = mergedEvents.map((event) => JSON.stringify(event)).join('\n') + '\n';

  return { eventsPath, content };
}
