/**
 * Tests for pack:search command (WU-1839)
 *
 * Acceptance criteria:
 * 1. Searches registry API with query
 * 2. Displays results with name, description, version
 * 3. Shows install count per pack
 *
 * TDD: These tests are written BEFORE the implementation.
 */
import { describe, it, expect } from 'vitest';

describe('pack:search command', () => {
  describe('searchPacks', () => {
    // AC1: Searches registry API with query
    it('should call the registry API with the query parameter', async () => {
      const { searchPacks } = await import('../pack-search.js');

      const calls: { url: string }[] = [];
      const mockFetch: typeof fetch = async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        calls.push({ url });
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'software-delivery',
                description: 'Git tools and quality gates',
                version: '1.0.0',
                install_count: 42,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      await searchPacks({
        query: 'software',
        registryUrl: 'https://registry.lumenflow.dev',
        fetchFn: mockFetch,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(
        'https://registry.lumenflow.dev/api/registry/packs/search?q=software',
      );
    });

    it('should URL-encode the query parameter', async () => {
      const { searchPacks } = await import('../pack-search.js');

      const calls: { url: string }[] = [];
      const mockFetch: typeof fetch = async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        calls.push({ url });
        return new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      await searchPacks({
        query: 'my pack',
        registryUrl: 'https://registry.lumenflow.dev',
        fetchFn: mockFetch,
      });

      expect(calls[0].url).toBe(
        'https://registry.lumenflow.dev/api/registry/packs/search?q=my%20pack',
      );
    });

    // AC2: Displays results with name, description, version
    it('should return results with name, description, and version', async () => {
      const { searchPacks } = await import('../pack-search.js');

      const mockFetch: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'software-delivery',
                description: 'Git tools and quality gates',
                version: '2.1.0',
                install_count: 100,
              },
              {
                id: 'customer-support',
                description: 'Ticket management tools',
                version: '1.0.0',
                install_count: 15,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      const result = await searchPacks({
        query: 'tools',
        registryUrl: 'https://registry.lumenflow.dev',
        fetchFn: mockFetch,
      });

      expect(result.success).toBe(true);
      expect(result.packs).toHaveLength(2);

      expect(result.packs[0].id).toBe('software-delivery');
      expect(result.packs[0].description).toBe('Git tools and quality gates');
      expect(result.packs[0].version).toBe('2.1.0');

      expect(result.packs[1].id).toBe('customer-support');
      expect(result.packs[1].description).toBe('Ticket management tools');
      expect(result.packs[1].version).toBe('1.0.0');
    });

    // AC3: Shows install count per pack
    it('should include install count for each pack', async () => {
      const { searchPacks } = await import('../pack-search.js');

      const mockFetch: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'software-delivery',
                description: 'Git tools',
                version: '1.0.0',
                install_count: 42,
              },
              {
                id: 'customer-support',
                description: 'Tickets',
                version: '1.0.0',
                install_count: 0,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      const result = await searchPacks({
        query: 'pack',
        registryUrl: 'https://registry.lumenflow.dev',
        fetchFn: mockFetch,
      });

      expect(result.success).toBe(true);
      expect(result.packs[0].installCount).toBe(42);
      expect(result.packs[1].installCount).toBe(0);
    });

    it('should return empty results when no packs match', async () => {
      const { searchPacks } = await import('../pack-search.js');

      const mockFetch: typeof fetch = async () => {
        return new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const result = await searchPacks({
        query: 'nonexistent-pack-xyz',
        registryUrl: 'https://registry.lumenflow.dev',
        fetchFn: mockFetch,
      });

      expect(result.success).toBe(true);
      expect(result.packs).toHaveLength(0);
    });

    it('should return error when registry request fails', async () => {
      const { searchPacks } = await import('../pack-search.js');

      const mockFetch: typeof fetch = async () => {
        return new Response('Internal Server Error', {
          status: 500,
          statusText: 'Internal Server Error',
        });
      };

      const result = await searchPacks({
        query: 'software',
        registryUrl: 'https://registry.lumenflow.dev',
        fetchFn: mockFetch,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('500');
    });

    it('should return error when fetch throws a network error', async () => {
      const { searchPacks } = await import('../pack-search.js');

      const mockFetch: typeof fetch = async () => {
        throw new Error('Network unreachable');
      };

      const result = await searchPacks({
        query: 'software',
        registryUrl: 'https://registry.lumenflow.dev',
        fetchFn: mockFetch,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network unreachable');
    });

    it('should use custom registry URL', async () => {
      const { searchPacks } = await import('../pack-search.js');

      const calls: { url: string }[] = [];
      const mockFetch: typeof fetch = async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        calls.push({ url });
        return new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      await searchPacks({
        query: 'test',
        registryUrl: 'https://custom.registry.example.com',
        fetchFn: mockFetch,
      });

      expect(calls[0].url).toContain('https://custom.registry.example.com');
    });
  });

  describe('formatSearchResults', () => {
    it('should format results as a table string with headers', async () => {
      const { formatSearchResults } = await import('../pack-search.js');

      const output = formatSearchResults([
        {
          id: 'software-delivery',
          description: 'Git tools and quality gates',
          version: '2.1.0',
          installCount: 100,
        },
      ]);

      expect(output).toContain('software-delivery');
      expect(output).toContain('Git tools and quality gates');
      expect(output).toContain('2.1.0');
      expect(output).toContain('100');
    });

    it('should return a no-results message for empty array', async () => {
      const { formatSearchResults } = await import('../pack-search.js');

      const output = formatSearchResults([]);

      expect(output).toContain('No packs found');
    });

    it('should include column headers', async () => {
      const { formatSearchResults } = await import('../pack-search.js');

      const output = formatSearchResults([
        {
          id: 'test-pack',
          description: 'Test',
          version: '1.0.0',
          installCount: 5,
        },
      ]);

      expect(output).toContain('Name');
      expect(output).toContain('Description');
      expect(output).toContain('Version');
      expect(output).toContain('Installs');
    });
  });

  describe('pack:search CLI exports', () => {
    it('should export main function for CLI entry', async () => {
      const mod = await import('../pack-search.js');
      expect(typeof mod.main).toBe('function');
    });

    it('should export LOG_PREFIX constant', async () => {
      const mod = await import('../pack-search.js');
      expect(typeof mod.LOG_PREFIX).toBe('string');
    });

    it('should export searchPacks function', async () => {
      const mod = await import('../pack-search.js');
      expect(typeof mod.searchPacks).toBe('function');
    });

    it('should export formatSearchResults function', async () => {
      const mod = await import('../pack-search.js');
      expect(typeof mod.formatSearchResults).toBe('function');
    });
  });
});
