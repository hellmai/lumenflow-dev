import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '../../..');
const WORKSPACE_PACKAGES = ['core', 'initiatives', 'memory', 'agent', 'metrics'] as const;

interface ExportEntryObject {
  import?: string;
}

interface PackageJsonWithExports {
  exports?: Record<string, string | ExportEntryObject>;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractExportPath(entry: string | ExportEntryObject | undefined): string | undefined {
  if (!entry) {
    return undefined;
  }
  if (typeof entry === 'string') {
    return entry;
  }
  if (typeof entry.import === 'string') {
    return entry.import;
  }
  return undefined;
}

function buildWorkspaceAliases(): Array<{ find: RegExp; replacement: string }> {
  const aliases: Array<{ find: RegExp; replacement: string }> = [];

  for (const packageName of WORKSPACE_PACKAGES) {
    const packageDir = path.resolve(WORKSPACE_ROOT, `packages/@lumenflow/${packageName}`);
    const packageJsonPath = path.join(packageDir, 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageJsonWithExports;
    const exportsMap = packageJson.exports ?? {};

    for (const [subpath, exportEntry] of Object.entries(exportsMap)) {
      const distPath = extractExportPath(exportEntry);
      if (!distPath || !distPath.startsWith('./dist/') || !distPath.endsWith('.js')) {
        continue;
      }

      const sourcePath = path.resolve(
        packageDir,
        distPath.replace('./dist/', './src/').replace(/\.js$/, '.ts'),
      );

      if (subpath === '.') {
        aliases.push({
          find: new RegExp(`^@lumenflow/${escapeRegex(packageName)}$`),
          replacement: sourcePath,
        });
        continue;
      }

      if (subpath.startsWith('./')) {
        const exportName = subpath.slice(2);
        aliases.push({
          find: new RegExp(
            `^@lumenflow/${escapeRegex(packageName)}/${escapeRegex(exportName)}$`,
          ),
          replacement: sourcePath,
        });
      }
    }
  }

  return aliases;
}

const workspaceAliases = buildWorkspaceAliases();

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      '__tests__/**/*.test.ts',
      'src/__tests__/**/*.test.ts',
      'e2e/**/*.test.ts',
      'e2e/**/*.spec.ts',
      '**/*.spec.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: false, // Fail fast if include globs don't match any tests.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'clover', 'json'],
      exclude: ['**/__tests__/**', '**/*.test.ts', '**/dist/**'],
    },
  },
});
