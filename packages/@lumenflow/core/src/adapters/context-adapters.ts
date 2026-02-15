/**
 * Context Adapters
 *
 * WU-1094: INIT-002 Phase 2 - Implement adapters and dependency injection
 *
 * Concrete adapter implementations for context-related port interfaces.
 * These adapters wrap the existing implementation functions to conform
 * to the port interfaces, enabling dependency injection.
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
 * @example
 * // Use default adapter
 * const adapter = new SimpleGitLocationAdapter();
 * const location = await adapter.resolveLocation();
 *
 * @example
 * // Use as port interface
 * const resolver: ILocationResolver = new SimpleGitLocationAdapter();
 */
export class SimpleGitLocationAdapter implements ILocationResolver {
  constructor(private readonly resolveLocationFn: ResolveLocationFn = resolveLocation) {}

  /**
   * Resolve location context for the given working directory.
   *
   * @param cwd - Current working directory (defaults to process.cwd())
   * @returns Promise<LocationContext> - Resolved location context
   */
  async resolveLocation(cwd?: string): Promise<LocationContext> {
    return this.resolveLocationFn(cwd);
  }
}

/**
 * SimpleGitStateAdapter
 *
 * Implements IGitStateReader by delegating to the readGitState function.
 * Uses simple-git library under the hood.
 *
 * @example
 * // Use default adapter
 * const adapter = new SimpleGitStateAdapter();
 * const gitState = await adapter.readGitState();
 *
 * @example
 * // Use as port interface
 * const reader: IGitStateReader = new SimpleGitStateAdapter();
 */
export class SimpleGitStateAdapter implements IGitStateReader {
  constructor(private readonly readGitStateFn: ReadGitStateFn = readGitState) {}

  /**
   * Read current git state for the given working directory.
   *
   * @param cwd - Current working directory (defaults to process.cwd())
   * @returns Promise<GitState> - Current git state
   */
  async readGitState(cwd?: string): Promise<GitState> {
    return this.readGitStateFn(cwd);
  }
}

/**
 * FileSystemWuStateAdapter
 *
 * Implements IWuStateReader by delegating to the readWuState function.
 * Reads WU state from YAML files in the filesystem.
 *
 * @example
 * // Use default adapter
 * const adapter = new FileSystemWuStateAdapter();
 * const wuState = await adapter.readWuState('WU-1094', '/repo');
 *
 * @example
 * // Use as port interface
 * const reader: IWuStateReader = new FileSystemWuStateAdapter();
 */
export class FileSystemWuStateAdapter implements IWuStateReader {
  constructor(private readonly readWuStateFn: ReadWuStateFn = readWuState) {}

  /**
   * Read WU state from YAML and detect inconsistencies.
   *
   * @param wuId - WU ID (e.g., 'WU-1094' or 'wu-1094')
   * @param repoRoot - Repository root path
   * @returns Promise<WuStateResult | null> - WU state or null if not found
   */
  async readWuState(wuId: string, repoRoot: string): Promise<WuStateResult | null> {
    return this.readWuStateFn(wuId, repoRoot);
  }
}
