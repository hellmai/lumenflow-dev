/**
 * Agent Patterns Registry
 *
 * Central registry for AI agent branch patterns (claude/*, codex/*, copilot/*, cursor/*, etc.)
 * that bypass worktree requirements. Static JSON served from lumenflow.dev,
 * cached locally for 7 days with fallback to defaults.
 *
 * WU-1089: Added merge/override/airgapped modes via resolveAgentPatterns()
 *
 * @module agent-patterns-registry
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { LUMENFLOW_PATHS } from './wu-constants.js';

/** Default agent branch patterns (narrow: just agent/*) */
export const DEFAULT_AGENT_PATTERNS = ['agent/*'];

/** Remote registry URL */
export const REGISTRY_URL = 'https://lumenflow.dev/registry/agent-patterns.json';

/** Cache TTL: 7 days in milliseconds */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Cache file name */
const CACHE_FILE_NAME = 'agent-patterns-cache.json';

/** Default fetch timeout in milliseconds */
const DEFAULT_TIMEOUT_MS = 5000;

/** In-memory cache for patterns */
let memoryCache: string[] | null = null;

/** In-memory cache timestamp */
let memoryCacheTime: number = 0;

/**
 * Registry response schema
 */
interface RegistryResponse {
  version: string;
  patterns: string[];
}

/**
 * Cache file schema
 */
interface CacheData {
  version: string;
  patterns: string[];
  fetchedAt: number;
}

/**
 * Options for getAgentPatterns
 */
export interface GetAgentPatternsOptions {
  /** Override cache directory (default: ~/.lumenflow/cache) */
  cacheDir?: string;
  /** Fetch timeout in milliseconds (default: 5000) */
  timeoutMs?: number;
}

/**
 * Source of agent patterns for observability
 */
export type AgentPatternSource = 'registry' | 'merged' | 'override' | 'config' | 'defaults';

/**
 * Result of resolveAgentPatterns with observability fields
 */
export interface AgentPatternResult {
  /** Resolved patterns to use for agent branch matching */
  patterns: string[];
  /** Source of the patterns for observability */
  source: AgentPatternSource;
  /** Whether the registry was successfully fetched */
  registryFetched: boolean;
}

/**
 * Type for injectable registry fetcher function
 */
export type RegistryFetcher = (options: GetAgentPatternsOptions) => Promise<string[]>;

/**
 * Options for resolveAgentPatterns (WU-1089)
 */
export interface ResolveAgentPatternsOptions {
  /** Injectable registry fetcher for testing (uses getAgentPatterns by default) */
  registryFetcher?: RegistryFetcher;

  /** Patterns from config.git.agentBranchPatterns (merged with registry by default) */
  configPatterns?: string[];

  /** Patterns from config.git.agentBranchPatternsOverride (replaces everything if set) */
  overridePatterns?: string[];

  /** config.git.disableAgentPatternRegistry - skips network fetch (airgapped mode) */
  disableAgentPatternRegistry?: boolean;

  /** Override cache directory (passed to fetcher) */
  cacheDir?: string;

  /** Fetch timeout in milliseconds (passed to fetcher) */
  timeoutMs?: number;
}

/**
 * Get the default cache directory
 *
 * @returns Path to cache directory (~/.lumenflow/cache or LUMENFLOW_HOME/cache)
 */
export function getCacheDir(): string {
  const lumenflowHome = process.env.LUMENFLOW_HOME;
  if (lumenflowHome) {
    return path.join(lumenflowHome, LUMENFLOW_PATHS.HOME_CACHE);
  }
  // WU-1430: Compose home cache path from centralized constants
  return path.join(os.homedir(), LUMENFLOW_PATHS.BASE, LUMENFLOW_PATHS.HOME_CACHE);
}

/**
 * Validate registry response
 *
 * @param data - Data to validate
 * @returns True if valid registry response
 */
function isValidRegistryResponse(data: unknown): data is RegistryResponse {
  if (!data || typeof data !== 'object') return false;

  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.patterns)) return false;
  if (!obj.patterns.every((p) => typeof p === 'string')) return false;

  return true;
}

/**
 * Read cache from disk
 *
 * @param cacheDir - Cache directory
 * @returns Cache data or null if not found/invalid
 */
function readCache(cacheDir: string): CacheData | null {
  try {
    const cacheFile = path.join(cacheDir, CACHE_FILE_NAME);
    if (!fs.existsSync(cacheFile)) return null;

    const content = fs.readFileSync(cacheFile, 'utf8');
    const data = JSON.parse(content) as CacheData;

    // Validate cache structure
    if (!Array.isArray(data.patterns)) return null;
    if (typeof data.fetchedAt !== 'number') return null;

    return data;
  } catch {
    return null;
  }
}

/**
 * Write cache to disk
 *
 * @param cacheDir - Cache directory
 * @param data - Data to cache
 */
function writeCache(cacheDir: string, data: CacheData): void {
  try {
    // Ensure cache directory exists
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cacheFile = path.join(cacheDir, CACHE_FILE_NAME);
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
  } catch {
    // Fail silently - cache is optional
  }
}

/**
 * Fetch patterns from remote registry with timeout
 *
 * @param timeoutMs - Timeout in milliseconds
 * @returns Registry response or null on failure
 */
async function fetchFromRegistry(timeoutMs: number): Promise<RegistryResponse | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(REGISTRY_URL, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'lumenflow-core',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (!isValidRegistryResponse(data)) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Get agent branch patterns from registry with caching
 *
 * Fetches patterns from remote registry, caches locally for 7 days,
 * and falls back to defaults on failure.
 *
 * @param options - Options
 * @returns Array of agent branch patterns (glob format)
 *
 * @example
 * ```typescript
 * const patterns = await getAgentPatterns();
 * // ['claude/*', 'codex/*', 'copilot/*', 'cursor/*', 'agent/*']
 * ```
 */
export async function getAgentPatterns(options: GetAgentPatternsOptions = {}): Promise<string[]> {
  const { cacheDir = getCacheDir(), timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  // Check memory cache first (fast path)
  const now = Date.now();
  if (memoryCache && now - memoryCacheTime < CACHE_TTL_MS) {
    return memoryCache;
  }

  // Check disk cache
  const diskCache = readCache(cacheDir);
  if (diskCache && now - diskCache.fetchedAt < CACHE_TTL_MS) {
    // Fresh disk cache - use it and update memory cache
    memoryCache = diskCache.patterns;
    memoryCacheTime = diskCache.fetchedAt;
    return diskCache.patterns;
  }

  // Cache is stale or missing - try to fetch
  const registryData = await fetchFromRegistry(timeoutMs);

  if (registryData) {
    // Update caches
    const cacheData: CacheData = {
      version: registryData.version,
      patterns: registryData.patterns,
      fetchedAt: now,
    };

    writeCache(cacheDir, cacheData);
    memoryCache = registryData.patterns;
    memoryCacheTime = now;

    return registryData.patterns;
  }

  // Fetch failed - try stale cache as fallback
  if (diskCache) {
    memoryCache = diskCache.patterns;
    memoryCacheTime = diskCache.fetchedAt; // Keep stale time
    return diskCache.patterns;
  }

  // No cache, no network - use defaults
  return DEFAULT_AGENT_PATTERNS;
}

/**
 * Resolve agent branch patterns based on config with merge/override/airgapped support
 *
 * Behavior matrix (WU-1089):
 *
 * | disableRegistry | override patterns | config patterns | Result                 | Source        |
 * |-----------------|-------------------|-----------------|------------------------|---------------|
 * | false           | undefined         | undefined/[]    | registry               | 'registry'    |
 * | false           | undefined         | ['custom/*']    | config + registry      | 'merged'      |
 * | false           | ['only/*']        | any             | override only          | 'override'    |
 * | true            | undefined         | undefined/[]    | defaults               | 'defaults'    |
 * | true            | undefined         | ['custom/*']    | config only            | 'config'      |
 * | true            | ['only/*']        | any             | override only          | 'override'    |
 *
 * When registry fetch fails:
 * - Falls back to config patterns if provided, source = 'config'
 * - Falls back to defaults if no config, source = 'defaults'
 *
 * @param options - Resolution options
 * @returns Result with patterns, source, and registryFetched flag
 *
 * @example Default (fetch from registry)
 * ```typescript
 * const result = await resolveAgentPatterns({});
 * // result.patterns = ['claude/*', 'codex/*', ...] (from registry)
 * // result.source = 'registry'
 * // result.registryFetched = true
 * ```
 *
 * @example Merge mode (config + registry)
 * ```typescript
 * const result = await resolveAgentPatterns({
 *   configPatterns: ['my-agent/*'],
 * });
 * // result.patterns = ['my-agent/*', 'claude/*', 'codex/*', ...]
 * // result.source = 'merged'
 * // result.registryFetched = true
 * ```
 *
 * @example Override mode (explicit replacement)
 * ```typescript
 * const result = await resolveAgentPatterns({
 *   overridePatterns: ['only-this/*'],
 * });
 * // result.patterns = ['only-this/*']
 * // result.source = 'override'
 * // result.registryFetched = false
 * ```
 *
 * @example Airgapped mode (no network)
 * ```typescript
 * const result = await resolveAgentPatterns({
 *   disableAgentPatternRegistry: true,
 *   configPatterns: ['my-agent/*'],
 * });
 * // result.patterns = ['my-agent/*']
 * // result.source = 'config'
 * // result.registryFetched = false
 * ```
 */
export async function resolveAgentPatterns(
  options: ResolveAgentPatternsOptions = {},
): Promise<AgentPatternResult> {
  const {
    registryFetcher = getAgentPatterns,
    configPatterns,
    overridePatterns,
    disableAgentPatternRegistry = false,
    cacheDir,
    timeoutMs,
  } = options;

  // Scenario 3/6: Override mode - overridePatterns replaces everything
  if (overridePatterns && overridePatterns.length > 0) {
    return {
      patterns: overridePatterns,
      source: 'override',
      registryFetched: false,
    };
  }

  // Scenario 4/5: Airgapped mode - disableAgentPatternRegistry skips network
  if (disableAgentPatternRegistry) {
    const hasConfigPatterns = configPatterns && configPatterns.length > 0;
    return {
      patterns: hasConfigPatterns ? configPatterns : DEFAULT_AGENT_PATTERNS,
      source: hasConfigPatterns ? 'config' : 'defaults',
      registryFetched: false,
    };
  }

  // Scenario 1/2: Normal mode - fetch from registry, optionally merge with config
  const hasConfigPatterns = configPatterns && configPatterns.length > 0;

  // Try to fetch from registry
  let registryPatterns: string[] | null = null;
  let fetchedSuccessfully = false;

  try {
    registryPatterns = await registryFetcher({ cacheDir, timeoutMs });
    fetchedSuccessfully = registryPatterns !== null && registryPatterns.length > 0;
  } catch {
    // Fetch failed - will use fallback below
    fetchedSuccessfully = false;
  }

  // If registry fetch succeeded
  if (fetchedSuccessfully && registryPatterns) {
    if (hasConfigPatterns) {
      // Scenario 2: Merge mode - config first, then registry (deduplicated)
      const merged = [...configPatterns];
      for (const pattern of registryPatterns) {
        if (!merged.includes(pattern)) {
          merged.push(pattern);
        }
      }
      return {
        patterns: merged,
        source: 'merged',
        registryFetched: true,
      };
    }

    // Scenario 1: Registry only
    return {
      patterns: registryPatterns,
      source: 'registry',
      registryFetched: true,
    };
  }

  // Registry fetch failed - fallback to config or defaults
  return {
    patterns: hasConfigPatterns ? configPatterns : DEFAULT_AGENT_PATTERNS,
    source: hasConfigPatterns ? 'config' : 'defaults',
    registryFetched: false,
  };
}

/**
 * Clear the in-memory cache
 *
 * Used primarily for testing.
 */
export function clearCache(): void {
  memoryCache = null;
  memoryCacheTime = 0;
}
