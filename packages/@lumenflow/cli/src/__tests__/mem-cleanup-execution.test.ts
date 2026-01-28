import { exec } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, it, expect } from 'vitest';

const execAsync = promisify(exec);
const CLI_DIST_PATH = path.resolve(__dirname, '../../dist/mem-cleanup.js');

describe('mem:cleanup CLI execution', () => {
  it('should run --help without crashing', async () => {
    try {
      // We run the actual built JS file to catch ESM/CJS compatibility issues
      const { stdout } = await execAsync(`node ${CLI_DIST_PATH} --help`);
      expect(stdout).toContain('Usage: mem-cleanup');
    } catch (error: any) {
      // If it fails, we want to see why (expecting ReferenceError: require is not defined)
      throw new Error(`Command failed: ${error.message}\nStderr: ${error.stderr}`);
    }
  });
});
