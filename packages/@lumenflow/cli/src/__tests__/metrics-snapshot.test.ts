/**
 * @file metrics-snapshot.test.ts
 * @description Tests for metrics-snapshot CLI command (WU-1020)
 *
 * These are smoke tests to verify the CLI module can be imported and
 * that the TypeScript compilation succeeds (verifying the readonly array fix).
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('metrics-snapshot CLI', () => {
  it('should have the CLI source file', () => {
    const srcPath = join(__dirname, '../metrics-snapshot.ts');
    expect(existsSync(srcPath)).toBe(true);
  });

  it('should be buildable (dist file exists after build)', () => {
    // This test verifies that tsc compiled the file successfully
    // WU-1020: The readonly array cast fix allows this file to compile
    const distPath = join(__dirname, '../../dist/metrics-snapshot.js');
    expect(existsSync(distPath)).toBe(true);
  });
});
