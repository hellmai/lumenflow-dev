
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findSuggestedTestPaths } from '../wu-preflight-validators.js';
import fg from 'fast-glob';

vi.mock('fast-glob');

describe('findSuggestedTestPaths', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('finds exact matches', async () => {
        vi.mocked(fg).mockResolvedValueOnce(['path/to/found.ts']);

        const result = await findSuggestedTestPaths(['missing.ts'], '/root');

        expect(result['missing.ts']).toContain('path/to/found.ts');
        expect(fg).toHaveBeenCalledWith('**/missing.ts', expect.objectContaining({ cwd: '/root' }));
    });

    it('finds basename with different extensions', async () => {
        vi.mocked(fg)
            .mockResolvedValueOnce([]) // Exact match
            .mockResolvedValueOnce(['path/to/found.tsx']); // Extension match

        const result = await findSuggestedTestPaths(['missing.ts'], '/root');

        expect(result['missing.ts']).toContain('path/to/found.tsx');
        expect(fg).toHaveBeenCalledWith('**/missing.{ts,js,mjs,tsx,jsx}', expect.objectContaining({ cwd: '/root' }));
    });

    it('finds code file for missing test', async () => {
        vi.mocked(fg)
            .mockResolvedValueOnce([]) // Exact match
            .mockResolvedValueOnce([]) // Extension match
            .mockResolvedValueOnce(['path/to/source.ts']); // Code match

        const result = await findSuggestedTestPaths(['missing.test.ts'], '/root');

        expect(result['missing.test.ts']).toContain('path/to/source.ts');
        expect(fg).toHaveBeenCalledWith('**/missing.{ts,js,mjs,tsx,jsx}', expect.objectContaining({ cwd: '/root' }));
    });
});
