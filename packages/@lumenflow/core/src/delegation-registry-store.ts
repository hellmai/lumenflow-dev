// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Delegation Registry Store (WU-1944)
 *
 * Event-sourced state store for tracking sub-agent delegations.
 * Stores events in .lumenflow/state/delegation-registry.jsonl (append-only, git-friendly).
 *
 * Features:
 * - Event sourcing with replay for current state
 * - Atomic append operations
 * - O(1) queries by parent WU, target WU, and status
 *
 * @see {@link packages/@lumenflow/cli/src/lib/__tests__/delegation-registry-store.test.ts} - Tests
 * @see {@link packages/@lumenflow/cli/src/lib/delegation-registry-schema.ts} - Schema definitions
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  validateDelegationEvent,
  generateDelegationId,
  DelegationStatus,
  type DelegationEvent,
  type DelegationIntentValue,
} from './delegation-registry-schema.js';
import { createError, ErrorCodes } from './error-handler.js';

/** Delegation registry file name constant */
export const DELEGATION_REGISTRY_FILE_NAME = 'delegation-registry.jsonl';

/**
 * Delegation Registry Store class
 *
 * Manages delegation registry state via event sourcing pattern.
 * Events are appended to JSONL file, state is rebuilt by replaying events.
 */
export class DelegationRegistryStore {
  private readonly baseDir: string;
  private readonly registryFilePath: string;
  private readonly delegations: Map<string, DelegationEvent>;
  private readonly byParent: Map<string, string[]>;
  private readonly byTarget: Map<string, string>;

  /**
   * @param {string} baseDir - Directory containing .lumenflow/state/
   */
  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.registryFilePath = path.join(baseDir, DELEGATION_REGISTRY_FILE_NAME);

    // In-memory state (rebuilt from events)
    this.delegations = new Map();

    // Index: parentWuId -> delegationIds[]
    this.byParent = new Map();

    // Index: targetWuId -> delegationId
    this.byTarget = new Map();
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
   * @returns {Promise<void>}
   * @throws {Error} If file contains malformed JSON or invalid events
   *
   * @example
   * const store = new DelegationRegistryStore('/path/to/project');
   * await store.load();
   * const pending = store.getPendingDelegations();
   */
  async load(): Promise<void> {
    // Reset state
    this.delegations.clear();
    this.byParent.clear();
    this.byTarget.clear();

    // Check if file exists
    let content: string;
    try {
      content = await fs.readFile(this.registryFilePath, 'utf-8');
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
      const rawLine = lines[i];
      if (typeof rawLine !== 'string') {
        continue;
      }
      const line = rawLine.trim();

      // Skip empty lines
      if (!line) {
        continue;
      }

      // Parse JSON line
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        throw createError(
          ErrorCodes.PARSE_ERROR,
          `Malformed JSON on line ${i + 1}: ${error.message}`,
        );
      }

      // Validate against schema
      const validation = validateDelegationEvent(parsed);
      if (!validation.success) {
        const issues = validation.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', ');
        throw createError(
          ErrorCodes.VALIDATION_ERROR,
          `Validation error on line ${i + 1}: ${issues}`,
        );
      }

      const event = validation.data;

      // Apply event to state (latest event for same ID wins)
      this._applyEvent(event);
    }
  }

  /**
   * Applies an event to the in-memory state.
   * If event for same delegation ID exists, updates it (latest wins).
   *
   * @private
   */
  private _applyEvent(event: DelegationEvent): void {
    const { id, parentWuId, targetWuId } = event;

    // Update main state map
    this.delegations.set(id, event);

    // Update parent index
    if (!this.byParent.has(parentWuId)) {
      this.byParent.set(parentWuId, []);
    }
    const parentDelegations = this.byParent.get(parentWuId);
    if (!parentDelegations) {
      return;
    }
    if (!parentDelegations.includes(id)) {
      parentDelegations.push(id);
    }

    // Update target index
    this.byTarget.set(targetWuId, id);
  }

  /**
   * Appends an event to the registry file.
   *
   * Uses append mode to avoid full file rewrite.
   * Creates file and parent directories if they don't exist.
   * Validates event before appending.
   *
   * @private
   * @throws {Error} If event fails validation
   */
  private async _appendEvent(event: DelegationEvent): Promise<void> {
    // Validate event before appending
    const validation = validateDelegationEvent(event);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw createError(ErrorCodes.VALIDATION_ERROR, `Validation error: ${issues}`);
    }

    const line = JSON.stringify(event) + '\n';

    // Ensure parent directory exists before appending
    await fs.mkdir(this.baseDir, { recursive: true });

    // Use append flag to avoid rewriting the file
    await fs.appendFile(this.registryFilePath, line, 'utf-8');
  }

  /**
   * Records a new delegation event with pending status.
   *
   * @param {string} parentWuId - Parent WU ID (orchestrator)
   * @param {string} targetWuId - Target WU ID (delegated work)
   * @param {string} lane - Lane for the delegated work
   * @param {DelegationIntentValue} [intent] - Optional intent source (e.g., delegation)
   * @returns {Promise<string>} The generated delegation ID
   * @throws {Error} If validation fails
   *
   * @example
   * const delegationId = await store.record('WU-1000', 'WU-1001', 'Operations: Tooling');
   */
  async record(
    parentWuId: string,
    targetWuId: string,
    lane: string,
    intent?: DelegationIntentValue,
  ): Promise<string> {
    const id = generateDelegationId(parentWuId, targetWuId);

    const event = {
      id,
      parentWuId,
      targetWuId,
      lane,
      ...(intent ? { intent } : {}),
      delegatedAt: new Date().toISOString(),
      status: DelegationStatus.PENDING,
      completedAt: null,
    };

    await this._appendEvent(event);
    this._applyEvent(event);

    return id;
  }

  /**
   * Updates the status of a delegation.
   *
   * @param {string} delegationId - Delegation ID to update
   * @param {string} status - New status
   * @returns {Promise<void>}
   * @throws {Error} If delegation ID not found
   *
   * @example
   * await store.updateStatus('dlg-a1b2', 'completed');
   */
  async updateStatus(delegationId: string, status: string): Promise<void> {
    const existing = this.delegations.get(delegationId);
    if (!existing) {
      throw createError(ErrorCodes.DELEGATION_NOT_FOUND, `Delegation ID ${delegationId} not found`);
    }

    const event: DelegationEvent = {
      ...existing,
      status: status as DelegationEvent['status'],
      completedAt: new Date().toISOString(),
    };

    await this._appendEvent(event);
    this._applyEvent(event);
  }

  /**
   * Records claim-time pickup evidence for a delegation entry.
   *
   * WU-1605: This distinguishes intent-only delegation records from
   * delegated work that was actually picked up via wu:claim.
   *
   * @param {string} delegationId - Delegation ID to update
   * @param {string} pickedUpBy - Agent identity that claimed the target WU
   * @param {string} [pickedUpAt] - Optional ISO timestamp (defaults to now)
   * @returns {Promise<void>}
   * @throws {Error} If delegation ID not found
   */
  async recordPickup(delegationId: string, pickedUpBy: string, pickedUpAt?: string): Promise<void> {
    const existing = this.delegations.get(delegationId);
    if (!existing) {
      throw createError(ErrorCodes.DELEGATION_NOT_FOUND, `Delegation ID ${delegationId} not found`);
    }

    const event: DelegationEvent = {
      ...existing,
      pickedUpBy,
      pickedUpAt: pickedUpAt ?? new Date().toISOString(),
    };

    await this._appendEvent(event);
    this._applyEvent(event);
  }

  /**
   * Gets all delegations for a parent WU.
   *
   * @param {string} parentWuId - Parent WU ID
   * @returns {DelegationEvent[]} Array of delegation events
   *
   * @example
   * const delegations = store.getByParent('WU-1000');
   */
  getByParent(parentWuId: string): DelegationEvent[] {
    const delegationIds = this.byParent.get(parentWuId) ?? [];
    return delegationIds
      .map((id) => this.delegations.get(id))
      .filter((event): event is DelegationEvent => event !== undefined);
  }

  /**
   * Gets delegation for a target WU.
   *
   * @param {string} targetWuId - Target WU ID
   * @returns {DelegationEvent | null} Delegation event or null
   *
   * @example
   * const delegation = store.getByTarget('WU-1001');
   */
  getByTarget(targetWuId: string): DelegationEvent | null {
    const delegationId = this.byTarget.get(targetWuId);
    if (!delegationId) {
      return null;
    }
    return this.delegations.get(delegationId) ?? null;
  }

  /**
   * Gets all pending delegations.
   *
   * @returns {DelegationEvent[]} Array of pending delegation events
   *
   * @example
   * const pending = store.getPendingDelegations();
   */
  getPendingDelegations(): DelegationEvent[] {
    return Array.from(this.delegations.values()).filter(
      (delegation) => delegation.status === DelegationStatus.PENDING,
    );
  }

  /**
   * Gets all delegations as an array.
   *
   * @returns {DelegationEvent[]} Array of all delegation events
   *
   * @example
   * const allDelegations = store.getAllDelegations();
   */
  getAllDelegations(): DelegationEvent[] {
    return Array.from(this.delegations.values());
  }

  /**
   * Gets delegation by ID.
   *
   * @param {string} delegationId - Delegation ID
   * @returns {DelegationEvent | null} Delegation event or null
   *
   * @example
   * const delegation = store.getById('dlg-a1b2');
   */
  getById(delegationId: string): DelegationEvent | null {
    return this.delegations.get(delegationId) ?? null;
  }
}
