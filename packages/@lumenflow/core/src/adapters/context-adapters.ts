// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Context Adapters
 *
 * WU-1094: INIT-002 Phase 2 - Implement adapters and dependency injection
 * WU-2128: Standardize error return contracts
 *
 * Concrete adapter implementations for context-related port interfaces.
 * These adapters wrap the existing implementation functions to conform
 * to the port interfaces, enabling dependency injection.
 *
 * Error Contract (WU-2128):
 * - Port methods (resolveLocation, readGitState, readWuState) THROW on failure
 *   (boundary contracts at the hexagonal architecture edge).
 * - Safe methods (*Safe) RETURN Result<T, Error> for callers that prefer
 *   explicit error handling without try-catch.
 *
 * Adapters:
 * - SimpleGitLocationAdapter - Implements ILocationResolver
 * - SimpleGitStateAdapter - Implements IGitStateReader
 * - FileSystemWuStateAdapter - Implements IWuStateReader
 *
 * @module adapters/context-adapters
 */

import type {
  ILocationResolver,
  IGitStateReader,
  IWuStateReader,
  LocationContext,
  GitState,
  WuStateResult,
} from '../ports/context.ports.js';

import type { Result } from '../domain/result.js';
import { tryCatchAsync } from '../domain/result.js';

// Import existing implementations
import { resolveLocation } from '../context/location-resolver.js';
import { readGitState } from '../context/git-state-reader.js';
import { readWuState } from '../context/wu-state-reader.js';

type ResolveLocationFn = (cwd?: string) => Promise<LocationContext>;
type ReadGitStateFn = (cwd?: string) => Promise<GitState>;
type ReadWuStateFn = (wuId: string, repoRoot: string) => Promise<WuStateResult | null>;

/**
 * SimpleGitLocationAdapter
 *
 * Implements ILocationResolver by delegating to the resolveLocation function.
 * Uses simple-git library under the hood.
 *
 * Error Contract (WU-2128):
 * - resolveLocation() THROWS on failure (port contract)
 * - resolveLocationSafe() RETURNS Result<LocationContext> (adapter contract)
 *
 * @example
 * // Use default adapter (port contract - throws)
 * const adapter = new SimpleGitLocationAdapter();
 * const location = await adapter.resolveLocation();
 *
 * @example
 * // Use safe adapter (Result contract - never throws)
 * const result = await adapter.resolveLocationSafe();
 * if (result.ok) {
 *   console.log(result.value.type);
 * }
 *
 * @example
 * // Use as port interface
 * const resolver: ILocationResolver = new SimpleGitLocationAdapter();
 */
export class SimpleGitLocationAdapter implements ILocationResolver {
  constructor(private readonly resolveLocationFn: ResolveLocationFn = resolveLocation) {}

  /**
   * Resolve location context for the given working directory.
   * Port contract: THROWS on failure.
   *
   * @param cwd - Current working directory (defaults to process.cwd())
   * @returns Promise<LocationContext> - Resolved location context
   * @throws Error if location resolution fails
   */
  async resolveLocation(cwd?: string): Promise<LocationContext> {
    return this.resolveLocationFn(cwd);
  }

  /**
   * Resolve location context, returning a Result instead of throwing.
   * Adapter contract: RETURNS Result<LocationContext>.
   *
   * @param cwd - Current working directory (defaults to process.cwd())
   * @returns Promise<Result<LocationContext>> - Success with context or Failure with error
   */
  async resolveLocationSafe(cwd?: string): Promise<Result<LocationContext>> {
    return tryCatchAsync(() => this.resolveLocationFn(cwd));
  }
}

/**
 * SimpleGitStateAdapter
 *
 * Implements IGitStateReader by delegating to the readGitState function.
 * Uses simple-git library under the hood.
 *
 * Error Contract (WU-2128):
 * - readGitState() THROWS on failure (port contract)
 * - readGitStateSafe() RETURNS Result<GitState> (adapter contract)
 *
 * @example
 * // Use default adapter (port contract - throws)
 * const adapter = new SimpleGitStateAdapter();
 * const gitState = await adapter.readGitState();
 *
 * @example
 * // Use safe adapter (Result contract - never throws)
 * const result = await adapter.readGitStateSafe();
 * if (result.ok) {
 *   console.log(result.value.branch);
 * }
 *
 * @example
 * // Use as port interface
 * const reader: IGitStateReader = new SimpleGitStateAdapter();
 */
export class SimpleGitStateAdapter implements IGitStateReader {
  constructor(private readonly readGitStateFn: ReadGitStateFn = readGitState) {}

  /**
   * Read current git state for the given working directory.
   * Port contract: THROWS on failure.
   *
   * @param cwd - Current working directory (defaults to process.cwd())
   * @returns Promise<GitState> - Current git state
   * @throws Error if git state reading fails
   */
  async readGitState(cwd?: string): Promise<GitState> {
    return this.readGitStateFn(cwd);
  }

  /**
   * Read current git state, returning a Result instead of throwing.
   * Adapter contract: RETURNS Result<GitState>.
   *
   * @param cwd - Current working directory (defaults to process.cwd())
   * @returns Promise<Result<GitState>> - Success with state or Failure with error
   */
  async readGitStateSafe(cwd?: string): Promise<Result<GitState>> {
    return tryCatchAsync(() => this.readGitStateFn(cwd));
  }
}

/**
 * FileSystemWuStateAdapter
 *
 * Implements IWuStateReader by delegating to the readWuState function.
 * Reads WU state from YAML files in the filesystem.
 *
 * Error Contract (WU-2128):
 * - readWuState() THROWS on failure (port contract)
 * - readWuStateSafe() RETURNS Result<WuStateResult | null> (adapter contract)
 *
 * @example
 * // Use default adapter (port contract - throws)
 * const adapter = new FileSystemWuStateAdapter();
 * const wuState = await adapter.readWuState('WU-1094', '/repo');
 *
 * @example
 * // Use safe adapter (Result contract - never throws)
 * const result = await adapter.readWuStateSafe('WU-1094', '/repo');
 * if (result.ok && result.value) {
 *   console.log(result.value.status);
 * }
 *
 * @example
 * // Use as port interface
 * const reader: IWuStateReader = new FileSystemWuStateAdapter();
 */
export class FileSystemWuStateAdapter implements IWuStateReader {
  constructor(private readonly readWuStateFn: ReadWuStateFn = readWuState) {}

  /**
   * Read WU state from YAML and detect inconsistencies.
   * Port contract: THROWS on failure.
   *
   * @param wuId - WU ID (e.g., 'WU-1094' or 'wu-1094')
   * @param repoRoot - Repository root path
   * @returns Promise<WuStateResult | null> - WU state or null if not found
   * @throws Error if YAML reading/parsing fails
   */
  async readWuState(wuId: string, repoRoot: string): Promise<WuStateResult | null> {
    return this.readWuStateFn(wuId, repoRoot);
  }

  /**
   * Read WU state, returning a Result instead of throwing.
   * Adapter contract: RETURNS Result<WuStateResult | null>.
   *
   * @param wuId - WU ID (e.g., 'WU-1094' or 'wu-1094')
   * @param repoRoot - Repository root path
   * @returns Promise<Result<WuStateResult | null>> - Success with state or Failure with error
   */
  async readWuStateSafe(wuId: string, repoRoot: string): Promise<Result<WuStateResult | null>> {
    return tryCatchAsync(() => this.readWuStateFn(wuId, repoRoot));
  }
}
