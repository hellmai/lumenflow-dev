/**
 * Tests for CLI entry point error handling
 *
 * Verifies that runCLI wrapper properly:
 * - Catches async errors from main()
 * - Logs error messages to stderr
 * - Exits with EXIT_CODES.ERROR on failure
 *
 * WU-1071: Also verifies that CLI entry points use import.meta.main pattern
 * instead of the broken process.argv[1] === fileURLToPath(import.meta.url) pattern.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { runCLI } from '../cli-entry-point.js';
import { EXIT_CODES } from '@lumenflow/core/dist/wu-constants.js';

describe('runCLI', () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let mockConsoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it('should call main() and do nothing on success', async () => {
    const main = vi.fn().mockResolvedValue(undefined);

    await runCLI(main);

    expect(main).toHaveBeenCalledOnce();
    expect(mockExit).not.toHaveBeenCalled();
    expect(mockConsoleError).not.toHaveBeenCalled();
  });

  it('should catch errors and exit with ERROR code', async () => {
    const error = new Error('Test error message');
    const main = vi.fn().mockRejectedValue(error);

    await runCLI(main);

    expect(main).toHaveBeenCalledOnce();
    expect(mockConsoleError).toHaveBeenCalledWith('Test error message');
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODES.ERROR);
  });

  it('should handle errors without message property', async () => {
    const main = vi.fn().mockRejectedValue('string error');

    await runCLI(main);

    expect(mockConsoleError).toHaveBeenCalledWith('string error');
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODES.ERROR);
  });

  it('should handle null/undefined errors', async () => {
    const main = vi.fn().mockRejectedValue(null);

    await runCLI(main);

    expect(mockConsoleError).toHaveBeenCalledWith('Unknown error');
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODES.ERROR);
  });
});

/**
 * WU-1071/WU-1181: Verify CLI entry points use import.meta.main pattern
 *
 * The old pattern `process.argv[1] === fileURLToPath(import.meta.url)` fails with
 * pnpm symlinks because process.argv[1] is the symlink path but import.meta.url
 * resolves to the real path - they never match so main() is never called.
 *
 * The fix is to use `import.meta.main` (Node.js 22.16.0+ built-in) which correctly
 * handles symlinks.
 *
 * WU-1181: Extended to validate ALL CLI files with entry guards, not just a subset.
 */
describe('WU-1071/WU-1181: CLI entry point patterns', () => {
  // Files that should NOT be checked for entry guards
  // (helper modules, index files, tests, or files without CLI entry points)
  const EXCLUDED_FILES = new Set([
    'cli-entry-point.ts', // Helper module, not a CLI entry point itself
    'index.ts', // Re-exports only
    'merge-block.ts', // Not a CLI entry point (no main guard needed)
    'wu-done-check.ts', // Not a CLI entry point (no main guard needed)
    'wu-spawn-completion.ts', // Not a CLI entry point (helper module)
    'agent-session.ts', // Not a CLI entry point (helper module)
    'agent-session-end.ts', // Not a CLI entry point (helper module)
    'agent-log-issue.ts', // Not a CLI entry point (helper module)
    'orchestrate-init-status.ts', // Not a CLI entry point (helper module)
    'orchestrate-initiative.ts', // Not a CLI entry point (helper module)
    'orchestrate-monitor.ts', // Not a CLI entry point (helper module)
    'initiative-edit.ts', // Not a CLI entry point (no main guard)
    'wu-block.ts', // Not a CLI entry point (no main guard)
    'wu-unblock.ts', // Not a CLI entry point (no main guard)
    'wu-release.ts', // Not a CLI entry point (no main guard)
    'wu-delete.ts', // Not a CLI entry point (no main guard)
    'init.ts', // Not a CLI entry point (no main guard)
  ]);

  // Old broken pattern that fails with pnpm symlinks
  const OLD_BROKEN_PATTERN =
    /if\s*\(\s*process\.argv\[1\]\s*===\s*fileURLToPath\(import\.meta\.url\)\s*\)/;

  // New working pattern using import.meta.main
  const NEW_WORKING_PATTERN = /if\s*\(\s*import\.meta\.main\s*\)/;

  /**
   * Discovers all CLI files with entry guards by scanning the src directory.
   * A file is considered to have an entry guard if it contains either:
   * - The old broken pattern: if (process.argv[1] === fileURLToPath(import.meta.url))
   * - The new working pattern: if (import.meta.main)
   */
  function discoverCLIFilesWithEntryGuards(): string[] {
    const srcDir = path.resolve(__dirname, '..');
    const files = readdirSync(srcDir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !EXCLUDED_FILES.has(f),
    );

    return files.filter((file) => {
      const content = readFileSync(path.join(srcDir, file), 'utf-8');
      return OLD_BROKEN_PATTERN.test(content) || NEW_WORKING_PATTERN.test(content);
    });
  }

  it('should discover all CLI files with entry guards', () => {
    const cliFiles = discoverCLIFilesWithEntryGuards();

    // WU-1181: There should be a significant number of CLI files with entry guards
    // This test ensures we're actually discovering files, not returning an empty list
    expect(cliFiles.length).toBeGreaterThan(40);
  });

  it('should use import.meta.main instead of process.argv[1] comparison in ALL CLI files', () => {
    const srcDir = path.resolve(__dirname, '..');
    const cliFiles = discoverCLIFilesWithEntryGuards();

    const errors: string[] = [];

    for (const file of cliFiles) {
      const filePath = path.join(srcDir, file);
      const content = readFileSync(filePath, 'utf-8');

      // Should NOT have old broken pattern
      if (OLD_BROKEN_PATTERN.test(content)) {
        errors.push(`${file} uses the old broken pattern (process.argv[1] === fileURLToPath)`);
      }

      // Should have new working pattern
      if (!NEW_WORKING_PATTERN.test(content)) {
        errors.push(`${file} does not use import.meta.main pattern`);
      }
    }

    if (errors.length > 0) {
      expect.fail(`Entry point pattern violations:\n${errors.join('\n')}`);
    }
  });

  it('should not have unused fileURLToPath imports in CLI files with entry guards', () => {
    const srcDir = path.resolve(__dirname, '..');
    const cliFiles = discoverCLIFilesWithEntryGuards();

    const errors: string[] = [];

    for (const file of cliFiles) {
      const filePath = path.join(srcDir, file);
      const content = readFileSync(filePath, 'utf-8');

      // If the file imports fileURLToPath, it should actually use it somewhere
      // (not just for the now-removed entry guard pattern)
      const hasFileURLToPathImport =
        /import\s*{[^}]*fileURLToPath[^}]*}\s*from\s*['"]node:url['"]/.test(content);
      const usesFileURLToPath = /fileURLToPath\(/.test(content);

      if (hasFileURLToPathImport && !usesFileURLToPath) {
        errors.push(`${file} imports fileURLToPath but does not use it - remove unused import`);
      }
    }

    if (errors.length > 0) {
      expect.fail(`Unused fileURLToPath imports:\n${errors.join('\n')}`);
    }
  });

  it('cli-entry-point.ts JSDoc should document import.meta.main pattern', () => {
    const srcDir = path.resolve(__dirname, '..');
    const cliEntryPointPath = path.join(srcDir, 'cli-entry-point.ts');
    const content = readFileSync(cliEntryPointPath, 'utf-8');

    // JSDoc example should show import.meta.main pattern, not the old one
    expect(
      content.includes('import.meta.main'),
      'cli-entry-point.ts JSDoc should mention import.meta.main',
    ).toBe(true);
  });
});
