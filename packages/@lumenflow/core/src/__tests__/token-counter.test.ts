import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('token-counter process exit boundaries', () => {
  it('does not register SIGINT handlers that call process.exit in core library code', async () => {
    const source = await readFile(new URL('../token-counter.ts', import.meta.url), 'utf8');

    expect(source).not.toContain("process.on('SIGINT'");
    expect(source).not.toContain('process.exit(');
  });
});
