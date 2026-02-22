import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const GITIGNORE_PATH = join(__dirname, '..', '.gitignore');
const NEXT_ENV_ENTRY = 'next-env.d.ts';

describe('apps/web/.gitignore', () => {
  it('includes next-env.d.ts to prevent build side-effects', () => {
    const content = readFileSync(GITIGNORE_PATH, 'utf8');
    const entries = content.split('\n').map((line) => line.trim());
    expect(entries).toContain(NEXT_ENV_ENTRY);
  });
});
