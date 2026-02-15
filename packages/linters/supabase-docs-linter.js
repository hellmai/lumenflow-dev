#!/usr/bin/env node
/**
 * Supabase docs linter stub for LumenFlow dogfooding.
 *
 * This validates that Supabase tables are documented.
 * Stub passes since hellmai/lumenflow has no Supabase.
 */

export function runSupabaseDocsLinter({ logger = console } = {}) {
  logger.log('[supabase-docs] Supabase docs linter (stub - passes, no Supabase in this repo)');
  return { ok: true, skipped: true, message: 'Supabase docs linter skipped (stub).' };
}

if (import.meta.main) {
  const result = runSupabaseDocsLinter();
  process.exit(result.ok ? 0 : 1);
}
