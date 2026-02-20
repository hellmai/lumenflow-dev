#!/usr/bin/env node
/**
 * @file pack-search.ts
 * Search for LumenFlow domain packs in a registry (WU-1839)
 *
 * Queries the registry API for packs matching a search term and displays
 * results with name, description, version, and install count.
 *
 * Usage:
 *   pnpm pack:search software
 *   pnpm pack:search --query "git tools" --registry-url https://custom.registry.dev
 */

import { createWUParser } from '@lumenflow/core';
import Table from 'cli-table3';
import { runCLI } from './cli-entry-point.js';

export const LOG_PREFIX = '[pack:search]';

// --- Constants ---

const DEFAULT_REGISTRY_URL = 'https://registry.lumenflow.dev';
const SEARCH_API_PATH = '/api/registry/packs/search';
const NO_RESULTS_MESSAGE = 'No packs found matching your query.';

// --- Result types ---

export interface PackSearchResult {
  id: string;
  description: string;
  version: string;
  installCount: number;
}

export interface SearchPacksResult {
  success: boolean;
  error?: string;
  packs: PackSearchResult[];
}

// --- Options ---

export interface SearchPacksOptions {
  query: string;
  registryUrl: string;
  /** Injectable fetch function for testability (hexagonal port). */
  fetchFn: typeof fetch;
}

// --- Registry response types ---

interface RegistryPackEntry {
  id: string;
  description: string;
  version: string;
  install_count: number;
}

interface RegistrySearchResponse {
  results: RegistryPackEntry[];
}

// --- Core search function ---

/**
 * Search for packs in the registry.
 *
 * Sends a GET request to the registry search endpoint:
 *   GET {registryUrl}/api/registry/packs/search?q={query}
 *
 * Returns SearchPacksResult with success=false if the request fails.
 */
export async function searchPacks(options: SearchPacksOptions): Promise<SearchPacksResult> {
  const { query, registryUrl, fetchFn } = options;

  const encodedQuery = encodeURIComponent(query);
  const url = `${registryUrl}${SEARCH_API_PATH}?q=${encodedQuery}`;

  let response: Response;
  try {
    response = await fetchFn(url);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Registry search failed: ${message}`, packs: [] };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => 'No response body');
    return {
      success: false,
      error: `Registry search failed: ${String(response.status)} ${response.statusText} - ${body}`,
      packs: [],
    };
  }

  let data: RegistrySearchResponse;
  try {
    data = (await response.json()) as RegistrySearchResponse;
  } catch {
    return { success: false, error: 'Failed to parse registry response as JSON', packs: [] };
  }

  const packs: PackSearchResult[] = (data.results || []).map((entry) => ({
    id: entry.id,
    description: entry.description,
    version: entry.version,
    installCount: entry.install_count,
  }));

  return { success: true, packs };
}

// --- Output formatting ---

/**
 * Format search results as a table string for CLI output.
 *
 * Uses cli-table3 (already a project dependency) for consistent
 * terminal table rendering.
 *
 * @returns Formatted table string or no-results message
 */
export function formatSearchResults(packs: PackSearchResult[]): string {
  if (packs.length === 0) {
    return NO_RESULTS_MESSAGE;
  }

  const table = new Table({
    head: ['Name', 'Description', 'Version', 'Installs'],
    colWidths: [30, 45, 10, 10],
    wordWrap: true,
  });

  for (const pack of packs) {
    table.push([pack.id, pack.description, pack.version, String(pack.installCount)]);
  }

  return table.toString();
}

// --- CLI options ---

const PACK_SEARCH_OPTIONS = {
  query: {
    name: 'query',
    flags: '--query <query>',
    description: 'Search query string',
  },
  registryUrl: {
    name: 'registryUrl',
    flags: '--registry-url <url>',
    description: `Registry URL (default: "${DEFAULT_REGISTRY_URL}")`,
  },
};

/**
 * CLI main entry point for pack:search
 */
export async function main(): Promise<void> {
  const opts = createWUParser({
    name: 'pack-search',
    description: 'Search for LumenFlow domain packs in a registry',
    options: [PACK_SEARCH_OPTIONS.query, PACK_SEARCH_OPTIONS.registryUrl],
    allowPositionalId: true,
  });

  // Support both --query "term" and positional: pack:search "term"
  // When allowPositionalId is true, createWUParser puts the first positional
  // arg into opts.id. We prefer --query if provided, fall back to positional.
  const query = (opts.query as string | undefined) ?? (opts.id as string | undefined);
  const registryUrl = (opts.registryUrl as string | undefined) ?? DEFAULT_REGISTRY_URL;

  if (!query) {
    console.error(`${LOG_PREFIX} Error: Provide a search query as an argument or via --query`);
    process.exit(1);
  }

  console.log(`${LOG_PREFIX} Searching registry: ${registryUrl}`);
  console.log(`${LOG_PREFIX} Query: "${query}"`);

  const result = await searchPacks({
    query,
    registryUrl,
    fetchFn: globalThis.fetch,
  });

  if (!result.success) {
    console.error(`${LOG_PREFIX} Search failed: ${result.error}`);
    process.exit(1);
  }

  console.log('');
  console.log(formatSearchResults(result.packs));

  if (result.packs.length > 0) {
    console.log('');
    console.log(
      `${LOG_PREFIX} Found ${String(result.packs.length)} pack${result.packs.length === 1 ? '' : 's'}.`,
    );
  }
}

// Run if executed directly
if (import.meta.main) {
  void runCLI(main);
}
