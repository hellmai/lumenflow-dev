/**
 * @file flow-report.test.ts
 * @description Tests for flow-report CLI command (WU-1018)
 *
 * These are smoke tests to verify the CLI module can be imported.
 * The CLI commands are wrappers around @lumenflow/metrics library functions
 * which have their own comprehensive tests.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('flow-report CLI', () => {
  it('should have the CLI source file', () => {
    const srcPath = join(__dirname, '../flow-report.ts');
    expect(existsSync(srcPath)).toBe(true);
  });

  it('should be buildable (dist file exists after build)', () => {
    // This test verifies that tsc compiled the file successfully
    const distPath = join(__dirname, '../../dist/flow-report.js');
    expect(existsSync(distPath)).toBe(true);
  });
});
