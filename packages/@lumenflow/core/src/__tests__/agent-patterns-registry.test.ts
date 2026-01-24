/**
 * @fileoverview Tests for agent-patterns-registry module
 *
 * Tests the central registry for AI agent branch patterns with:
 * - Fetch from remote registry (lumenflow.dev)
 * - 7-day local cache
 * - Fallback to defaults when offline/error
 *
 * @module __tests__/agent-patterns-registry.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Module under test - will be created after tests
import {
  getAgentPatterns,
  clearCache,
  getCacheDir,
  REGISTRY_URL,
  DEFAULT_AGENT_PATTERNS,
  CACHE_TTL_MS,
} from '../agent-patterns-registry.js';

describe('agent-patterns-registry', () => {
  let tempDir: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    // Create temp directory for cache tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-test-'));

    // Clear module cache
    clearCache();

    // Store original fetch
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    // Restore fetch
    globalThis.fetch = originalFetch;

    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    // Clear module cache
    clearCache();
  });

  describe('constants', () => {
    it('should export default agent patterns', () => {
      expect(DEFAULT_AGENT_PATTERNS).toEqual(['agent/*']);
    });

    it('should export registry URL pointing to lumenflow.dev', () => {
      expect(REGISTRY_URL).toBe('https://lumenflow.dev/registry/agent-patterns.json');
    });

    it('should export 7-day cache TTL', () => {
      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
      expect(CACHE_TTL_MS).toBe(SEVEN_DAYS_MS);
    });
  });

  describe('getAgentPatterns', () => {
    describe('when remote registry is available', () => {
      it('should fetch patterns from remote registry', async () => {
        const remotePatterns = {
          version: '1.0.0',
          patterns: ['claude/*', 'codex/*', 'copilot/*', 'cursor/*', 'agent/*'],
        };

        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(remotePatterns),
        });

        const patterns = await getAgentPatterns({ cacheDir: tempDir });

        expect(patterns).toEqual(remotePatterns.patterns);
        expect(globalThis.fetch).toHaveBeenCalledWith(REGISTRY_URL, expect.any(Object));
      });

      it('should cache fetched patterns locally', async () => {
        const remotePatterns = {
          version: '1.0.0',
          patterns: ['claude/*', 'codex/*'],
        };

        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(remotePatterns),
        });

        await getAgentPatterns({ cacheDir: tempDir });

        // Check cache file exists
        const cacheFile = path.join(tempDir, 'agent-patterns-cache.json');
        expect(fs.existsSync(cacheFile)).toBe(true);

        // Check cache content
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        expect(cached.patterns).toEqual(remotePatterns.patterns);
        expect(cached.fetchedAt).toBeDefined();
      });

      it('should use cached patterns when cache is fresh', async () => {
        const cachedData = {
          version: '1.0.0',
          patterns: ['cached/*'],
          fetchedAt: Date.now(), // Fresh cache
        };

        // Pre-populate cache
        const cacheFile = path.join(tempDir, 'agent-patterns-cache.json');
        fs.writeFileSync(cacheFile, JSON.stringify(cachedData));

        globalThis.fetch = vi.fn();

        const patterns = await getAgentPatterns({ cacheDir: tempDir });

        // Should use cache, not fetch
        expect(patterns).toEqual(['cached/*']);
        expect(globalThis.fetch).not.toHaveBeenCalled();
      });

      it('should refetch when cache is stale (older than 7 days)', async () => {
        const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;
        const cachedData = {
          version: '1.0.0',
          patterns: ['stale/*'],
          fetchedAt: Date.now() - EIGHT_DAYS_MS, // Stale cache
        };

        // Pre-populate stale cache
        const cacheFile = path.join(tempDir, 'agent-patterns-cache.json');
        fs.writeFileSync(cacheFile, JSON.stringify(cachedData));

        const remotePatterns = {
          version: '1.1.0',
          patterns: ['fresh/*'],
        };

        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(remotePatterns),
        });

        const patterns = await getAgentPatterns({ cacheDir: tempDir });

        // Should fetch fresh patterns
        expect(patterns).toEqual(['fresh/*']);
        expect(globalThis.fetch).toHaveBeenCalled();
      });
    });

    describe('when remote registry is unavailable', () => {
      it('should return default patterns when fetch fails', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

        const patterns = await getAgentPatterns({ cacheDir: tempDir });

        expect(patterns).toEqual(DEFAULT_AGENT_PATTERNS);
      });

      it('should return default patterns when response is not ok', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
        });

        const patterns = await getAgentPatterns({ cacheDir: tempDir });

        expect(patterns).toEqual(DEFAULT_AGENT_PATTERNS);
      });

      it('should return default patterns when JSON is invalid', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.reject(new Error('Invalid JSON')),
        });

        const patterns = await getAgentPatterns({ cacheDir: tempDir });

        expect(patterns).toEqual(DEFAULT_AGENT_PATTERNS);
      });

      it('should use stale cache when fetch fails', async () => {
        const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;
        const cachedData = {
          version: '1.0.0',
          patterns: ['stale-but-valid/*'],
          fetchedAt: Date.now() - TEN_DAYS_MS, // Very stale
        };

        // Pre-populate stale cache
        const cacheFile = path.join(tempDir, 'agent-patterns-cache.json');
        fs.writeFileSync(cacheFile, JSON.stringify(cachedData));

        // Fetch fails
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

        const patterns = await getAgentPatterns({ cacheDir: tempDir });

        // Should use stale cache as fallback
        expect(patterns).toEqual(['stale-but-valid/*']);
      });
    });

    describe('fetch timeout', () => {
      it('should timeout fetch after reasonable duration', async () => {
        // Mock fetch that respects abort signal (like real fetch)
        globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
          return new Promise((_resolve, reject) => {
            // Listen for abort signal
            if (options?.signal) {
              options.signal.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'));
              });
            }
            // Otherwise never resolves - simulates hanging request
          });
        });

        // Should not hang forever - use abort signal
        const start = Date.now();
        const patterns = await getAgentPatterns({ cacheDir: tempDir, timeoutMs: 100 });
        const elapsed = Date.now() - start;

        // Should return defaults after timeout (aborted)
        expect(patterns).toEqual(DEFAULT_AGENT_PATTERNS);
        expect(elapsed).toBeLessThan(1000); // Should timeout quickly
      }, 10000); // Extended test timeout
    });

    describe('cache directory', () => {
      it('should create cache directory if it does not exist', async () => {
        const nonExistentDir = path.join(tempDir, 'nested', 'cache', 'dir');
        expect(fs.existsSync(nonExistentDir)).toBe(false);

        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ version: '1.0.0', patterns: ['test/*'] }),
        });

        await getAgentPatterns({ cacheDir: nonExistentDir });

        expect(fs.existsSync(nonExistentDir)).toBe(true);
      });

      it('should use default cache directory when not specified', () => {
        const defaultDir = getCacheDir();
        // Should be in a reasonable location (home dir or temp)
        expect(defaultDir).toBeDefined();
        expect(typeof defaultDir).toBe('string');
      });
    });

    describe('response validation', () => {
      it('should reject responses without patterns array', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ version: '1.0.0' }), // Missing patterns
        });

        const patterns = await getAgentPatterns({ cacheDir: tempDir });

        expect(patterns).toEqual(DEFAULT_AGENT_PATTERNS);
      });

      it('should reject responses with non-array patterns', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ version: '1.0.0', patterns: 'not-an-array' }),
        });

        const patterns = await getAgentPatterns({ cacheDir: tempDir });

        expect(patterns).toEqual(DEFAULT_AGENT_PATTERNS);
      });

      it('should reject responses with non-string pattern entries', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ version: '1.0.0', patterns: [123, null] }),
        });

        const patterns = await getAgentPatterns({ cacheDir: tempDir });

        expect(patterns).toEqual(DEFAULT_AGENT_PATTERNS);
      });
    });
  });

  describe('clearCache', () => {
    it('should clear in-memory cache', async () => {
      const remotePatterns = {
        version: '1.0.0',
        patterns: ['test/*'],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(remotePatterns),
      });

      // First call fetches
      await getAgentPatterns({ cacheDir: tempDir });
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      // Clear cache
      clearCache();

      // Remove file cache to force re-fetch
      const cacheFile = path.join(tempDir, 'agent-patterns-cache.json');
      if (fs.existsSync(cacheFile)) {
        fs.unlinkSync(cacheFile);
      }

      // Second call should fetch again
      await getAgentPatterns({ cacheDir: tempDir });
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
  });
});
