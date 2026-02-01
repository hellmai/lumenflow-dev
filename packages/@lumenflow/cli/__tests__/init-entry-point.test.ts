/**
 * @file init-entry-point.test.ts
 * Test that init.ts CLI entry point calls main() when executed (WU-1297)
 *
 * Root cause: init.ts exports main() but never calls it when run as CLI.
 * Other CLI commands use the `import.meta.main` pattern to invoke main().
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** The pattern that identifies CLI entry point auto-execution */
const ENTRY_POINT_PATTERN = 'import.meta.main';

describe('init.ts CLI entry point (WU-1297)', () => {
  /**
   * Test that init.ts contains the import.meta.main pattern.
   * This pattern ensures main() is called when the script runs as an entry point.
   */
  it('should contain import.meta.main check to call main() on execution', () => {
    const initPath = path.join(__dirname, '..', 'src', 'init.ts');
    const content = fs.readFileSync(initPath, 'utf-8');

    // The file should contain the import.meta.main pattern
    expect(content).toContain(ENTRY_POINT_PATTERN);

    // The pattern should be used to call main()
    // Standard patterns are:
    // - if (import.meta.main) { main().catch(...) }
    // - import.meta.main && main()
    const hasMainCall =
      content.includes(ENTRY_POINT_PATTERN) &&
      (content.includes('main()') || content.includes('main('));

    expect(hasMainCall).toBe(true);
  });

  /**
   * Test that the import.meta.main block includes error handling.
   * CLI entry points should catch errors and exit with non-zero code.
   */
  it('should have error handling in the entry point block', () => {
    const initPath = path.join(__dirname, '..', 'src', 'init.ts');
    const content = fs.readFileSync(initPath, 'utf-8');

    // The entry point should have .catch() error handling
    const hasErrorHandling =
      content.includes(ENTRY_POINT_PATTERN) &&
      (content.includes('.catch(') || content.includes('process.exit(1)'));

    expect(hasErrorHandling).toBe(true);
  });

  /**
   * Verify the main() function is exported (for testing and programmatic use).
   */
  it('should export main() function', async () => {
    const initModule = await import('../src/init.js');

    expect(typeof initModule.main).toBe('function');
  });

  /**
   * Compare with a known-good CLI entry point to verify pattern consistency.
   */
  it('should match the entry point pattern used by other CLI commands', () => {
    const initPath = path.join(__dirname, '..', 'src', 'init.ts');
    const initContent = fs.readFileSync(initPath, 'utf-8');

    // Check against a known-good pattern (wu-status.ts uses import.meta.main)
    const wuStatusPath = path.join(__dirname, '..', 'src', 'wu-status.ts');
    const wuStatusContent = fs.readFileSync(wuStatusPath, 'utf-8');

    // wu-status.ts should have the pattern (sanity check)
    expect(wuStatusContent).toContain(ENTRY_POINT_PATTERN);
    expect(wuStatusContent).toContain('main()');

    // init.ts should also have the same pattern
    expect(initContent).toContain(ENTRY_POINT_PATTERN);
  });
});
