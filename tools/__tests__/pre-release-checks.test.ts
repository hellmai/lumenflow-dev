import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validatePreRelease } from '../pre-release-checks';

vi.mock('node:fs/promises');

describe('validatePreRelease', () => {
  const mockPackageJson = {
    bin: {
      'cmd-a': './bin/a.js',
      'cmd-b': './bin/b.js',
    },
    files: ['dist'],
  };

  const mockReadme = `
# Package
## Commands
- \`cmd-a\` - Does A
- \`cmd-b\` - Does B
`;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should pass if all bin entries are in README', async () => {
    // Mock package.json read
    vi.spyOn(fs, 'readFile').mockImplementation(async (filePath) => {
      if (typeof filePath === 'string' && filePath.endsWith('package.json')) {
        return JSON.stringify(mockPackageJson);
      }
      if (typeof filePath === 'string' && filePath.endsWith('README.md')) {
        return mockReadme;
      }
      throw new Error(`Unexpected file read: ${filePath}`);
    });

    // Mock stat for templates dir (assuming it doesn't exist for this test)
    vi.spyOn(fs, 'stat').mockRejectedValue(new Error('ENOENT'));

    await expect(validatePreRelease()).resolves.not.toThrow();
  });

  it('should fail if a bin entry is missing from README', async () => {
    const readmeMissingB = `
# Package
## Commands
- \`cmd-a\` - Does A
`;

    vi.spyOn(fs, 'readFile').mockImplementation(async (filePath) => {
      if (typeof filePath === 'string' && filePath.endsWith('package.json')) {
        return JSON.stringify(mockPackageJson);
      }
      if (typeof filePath === 'string' && filePath.endsWith('README.md')) {
        return readmeMissingB;
      }
      throw new Error(`Unexpected file read: ${filePath}`);
    });

    vi.spyOn(fs, 'stat').mockRejectedValue(new Error('ENOENT'));

    await expect(validatePreRelease()).rejects.toThrow(
      /Missing documentation for bin entry: cmd-b/,
    );
  });

  it('should fail if templates dir exists but is not in files array', async () => {
    const packageJsonNoTemplates = {
      ...mockPackageJson,
      files: ['dist'], // 'templates' missing
    };

    vi.spyOn(fs, 'readFile').mockImplementation(async (filePath) => {
      if (typeof filePath === 'string' && filePath.endsWith('package.json')) {
        return JSON.stringify(packageJsonNoTemplates);
      }
      if (typeof filePath === 'string' && filePath.endsWith('README.md')) {
        return mockReadme;
      }
      throw new Error(`Unexpected file read: ${filePath}`);
    });

    // Mock stat for templates dir to succeed (it exists)
    vi.spyOn(fs, 'stat').mockResolvedValue({ isDirectory: () => true } as any);

    await expect(validatePreRelease()).rejects.toThrow(/'templates' directory exists/);
  });

  it('should pass if templates dir exists and is in files array', async () => {
    const packageJsonWithTemplates = {
      ...mockPackageJson,
      files: ['dist', 'templates'],
    };

    vi.spyOn(fs, 'readFile').mockImplementation(async (filePath) => {
      if (typeof filePath === 'string' && filePath.endsWith('package.json')) {
        return JSON.stringify(packageJsonWithTemplates);
      }
      if (typeof filePath === 'string' && filePath.endsWith('README.md')) {
        return mockReadme;
      }
      throw new Error(`Unexpected file read: ${filePath}`);
    });

    vi.spyOn(fs, 'stat').mockResolvedValue({ isDirectory: () => true } as any);

    await expect(validatePreRelease()).resolves.not.toThrow();
  });
});
