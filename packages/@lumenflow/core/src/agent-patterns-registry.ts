/**
 * Agent Patterns Registry
 *
 * Central registry for AI agent branch patterns (claude/*, codex/*, copilot/*, cursor/*, etc.)
 * that bypass worktree requirements. Static JSON served from lumenflow.dev,
 * cached locally for 7 days with fallback to defaults.
 *
 * @module agent-patterns-registry
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

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
interface GetAgentPatternsOptions {
  /** Override cache directory (default: ~/.lumenflow/cache) */
  cacheDir?: string;
  /** Fetch timeout in milliseconds (default: 5000) */
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
    return path.join(lumenflowHome, 'cache');
  }
  return path.join(os.homedir(), '.lumenflow', 'cache');
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
 * Clear the in-memory cache
 *
 * Used primarily for testing.
 */
export function clearCache(): void {
  memoryCache = null;
  memoryCacheTime = 0;
}
