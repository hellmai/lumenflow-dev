/**
 * @file supabase-docs-linter.ts
 * @description Runs Supabase docs linter when available (optional in consumer repos)
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface SupabaseDocsLinterResult {
  ok: boolean;
  skipped: boolean;
  message?: string;
  errors?: string[];
}

export interface SupabaseDocsLinterOptions {
  cwd?: string;
  logger?: { log: (message: string) => void; warn?: (message: string) => void };
}

export async function runSupabaseDocsLinter(
  options: SupabaseDocsLinterOptions = {},
): Promise<SupabaseDocsLinterResult> {
  const { cwd = process.cwd(), logger = console } = options;
  const linterPath = path.join(cwd, 'packages', 'linters', 'supabase-docs-linter.js');

  if (!existsSync(linterPath)) {
    return {
      ok: true,
      skipped: true,
      message: 'Supabase docs linter not found; skipping.',
    };
  }

  const moduleUrl = pathToFileURL(linterPath).href;
  const module = await import(moduleUrl);
  const runFn = module.runSupabaseDocsLinter ?? module.default;

  if (typeof runFn !== 'function') {
    return {
      ok: false,
      skipped: false,
      errors: ['Supabase docs linter does not export runSupabaseDocsLinter.'],
    };
  }

  const result = await runFn({ cwd, logger });
  if (result && typeof result === 'object' && 'ok' in result) {
    return {
      ok: Boolean(result.ok),
      skipped: Boolean(result.skipped),
      message: result.message,
      errors: result.errors,
    };
  }

  return {
    ok: true,
    skipped: false,
    message: 'Supabase docs linter completed.',
  };
}
