/**
 * @file migration-deployer.mjs
 * @description Migration deployment utilities for Supabase schema sync
 * WU-1983: Sync production schema and establish migration deployment workflow
 *
 * Provides:
 * - Local migration file discovery
 * - Migration name extraction (timestamp + name)
 * - Integration point for MCP-based deployment
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Default migrations directory path (relative to repo root)
 */
export const MIGRATIONS_DIR = 'supabase/supabase/migrations';

/**
 * Migration file pattern (YYYYMMDDHHMMSS_name.sql)
 * @type {RegExp}
 */
const MIGRATION_FILE_PATTERN = /^(\d{14})_(.+)\.sql$/;

/**
 * Extract migration info from filename
 * @param {string} filename - Migration filename (e.g., '20251224125733_patient_documents_storage.sql')
 * @returns {{ timestamp: string, name: string, fullName: string } | null}
 */
export function parseMigrationFilename(filename) {
  const match = MIGRATION_FILE_PATTERN.exec(filename);
  if (!match) return null;

  return {
    timestamp: match[1],
    name: match[2],
    fullName: `${match[1]}_${match[2]}`,
  };
}

/**
 * Discover local migration files
 * @param {string} baseDir - Base directory (repo root)
 * @returns {{ files: Array<{ filename: string, timestamp: string, name: string, fullName: string, path: string }>, errors: string[] }}
 */
export function discoverLocalMigrations(baseDir) {
  const migrationsPath = path.join(baseDir, MIGRATIONS_DIR);
  const errors = [];
  const files = [];

  if (!existsSync(migrationsPath)) {
    errors.push(`Migrations directory not found: ${migrationsPath}`);
    return { files, errors };
  }

  try {
    const entries = readdirSync(migrationsPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.sql')) continue;

      const parsed = parseMigrationFilename(entry.name);
      if (!parsed) {
        errors.push(`Invalid migration filename format: ${entry.name}`);
        continue;
      }

      files.push({
        filename: entry.name,
        timestamp: parsed.timestamp,
        name: parsed.name,
        fullName: parsed.fullName,
        path: path.join(migrationsPath, entry.name),
      });
    }

    // Sort by timestamp (ascending)
    files.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  } catch (err) {
    errors.push(`Error reading migrations directory: ${err.message}`);
  }

  return { files, errors };
}

/**
 * Read migration SQL content
 * @param {string} migrationPath - Full path to migration file
 * @returns {string} SQL content
 */
export function readMigrationContent(migrationPath) {
  return readFileSync(migrationPath, 'utf8');
}

/**
 * Check if WU code_paths includes Supabase migrations
 * @param {string[]} codePaths - Array of code paths from WU YAML
 * @returns {boolean} True if migrations are in scope
 */
export function hasMigrationChanges(codePaths) {
  if (!Array.isArray(codePaths)) return false;

  const migrationPatterns = ['supabase/', 'supabase/supabase/migrations/', MIGRATIONS_DIR];

  return codePaths.some((codePath) =>
    migrationPatterns.some(
      (pattern) => codePath.startsWith(pattern) || codePath === pattern.slice(0, -1),
    ),
  );
}

/**
 * Compare local migrations with production (for drift detection)
 * @param {Array<{ fullName: string }>} localMigrations - Local migration list
 * @param {Array<{ name: string }>} productionMigrations - Production migration list (from MCP)
 * @returns {{ missing: string[], extra: string[], synced: boolean }}
 */
export function compareMigrations(localMigrations, productionMigrations) {
  const localNames = new Set(localMigrations.map((m) => m.fullName));
  const prodNames = new Set(productionMigrations.map((m) => m.name));

  // Migrations in local but not in production
  const missing = localMigrations.filter((m) => !prodNames.has(m.fullName)).map((m) => m.fullName);

  // Migrations in production but not in local (unusual but possible)
  const extra = productionMigrations.filter((m) => !localNames.has(m.name)).map((m) => m.name);

  return {
    missing,
    extra,
    synced: missing.length === 0 && extra.length === 0,
  };
}

/**
 * Format migration deployment report
 * @param {{ missing: string[], extra: string[], synced: boolean }} comparison
 * @returns {string} Formatted report
 */
export function formatMigrationReport(comparison) {
  const lines = [];

  if (comparison.synced) {
    lines.push('Migrations are in sync between local and production.');
    return lines.join('\n');
  }

  if (comparison.missing.length > 0) {
    lines.push('Migrations missing from production:');
    comparison.missing.forEach((name) => lines.push(`  - ${name}`));
    lines.push('');
  }

  if (comparison.extra.length > 0) {
    lines.push('Migrations in production but not local (unexpected):');
    comparison.extra.forEach((name) => lines.push(`  - ${name}`));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Build MCP migration deployment command (for documentation/agents)
 * @param {string} migrationName - Full migration name (e.g., '20251224125733_patient_documents_storage')
 * @param {string} sql - Migration SQL content
 * @returns {string} MCP command description
 */
export function buildMCPDeploymentHint(migrationName, sql) {
  return `To deploy ${migrationName} to production:

Use mcp__supabase__apply_migration with:
  - name: "${migrationName}"
  - sql: <content of migration file>

Or use mcp__supabase__execute_sql for individual statements.`;
}
