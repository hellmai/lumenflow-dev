import { describe, expect, it } from 'vitest';
import config from '../vitest.config.ts';

describe('CLI vitest config (WU-1465)', () => {
  it('includes e2e test paths in include globs', () => {
    const include = config.test?.include ?? [];
    expect(include).toContain('e2e/**/*.test.ts');
  });

  it('fails when no tests are discovered', () => {
    expect(config.test?.passWithNoTests).toBe(false);
  });
});
