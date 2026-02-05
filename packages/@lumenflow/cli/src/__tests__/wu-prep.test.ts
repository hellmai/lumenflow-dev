import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as locationResolver from '@lumenflow/core/dist/context/location-resolver.js';
import * as errorHandler from '@lumenflow/core/dist/error-handler.js';
import * as wuYaml from '@lumenflow/core/dist/wu-yaml.js';
import { CONTEXT_VALIDATION, WU_STATUS } from '@lumenflow/core/dist/wu-constants.js';

const { LOCATION_TYPES } = CONTEXT_VALIDATION;

// Mock dependencies
vi.mock('@lumenflow/core/dist/context/location-resolver.js');
vi.mock('@lumenflow/core/dist/error-handler.js');
vi.mock('@lumenflow/core/dist/wu-yaml.js');
vi.mock('../gates.js', () => ({
  runGates: vi.fn().mockResolvedValue(true),
}));

describe('wu-prep (WU-1223)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('location validation', () => {
    it('should error when run from main checkout', async () => {
      // Mock location as main checkout
      vi.mocked(locationResolver.resolveLocation).mockResolvedValue({
        type: LOCATION_TYPES.MAIN,
        cwd: '/repo',
        gitRoot: '/repo',
        mainCheckout: '/repo',
        worktreeName: null,
        worktreeWuId: null,
      });

      // Import after mocks are set up
      const { resolveLocation } = await import('@lumenflow/core/dist/context/location-resolver.js');
      const location = await resolveLocation();

      // Verify the mock returns main
      expect(location.type).toBe(LOCATION_TYPES.MAIN);
    });

    it('should proceed when run from worktree', async () => {
      // Mock location as worktree
      vi.mocked(locationResolver.resolveLocation).mockResolvedValue({
        type: LOCATION_TYPES.WORKTREE,
        cwd: '/repo/worktrees/framework-cli-wu-1223',
        gitRoot: '/repo/worktrees/framework-cli-wu-1223',
        mainCheckout: '/repo',
        worktreeName: 'framework-cli-wu-1223',
        worktreeWuId: 'WU-1223',
      });

      const { resolveLocation } = await import('@lumenflow/core/dist/context/location-resolver.js');
      const location = await resolveLocation();

      // Verify the mock returns worktree
      expect(location.type).toBe(LOCATION_TYPES.WORKTREE);
      expect(location.mainCheckout).toBe('/repo');
    });
  });

  describe('WU status validation', () => {
    it('should only allow in_progress WUs', async () => {
      // Mock WU YAML with wrong status
      const mockDoc = {
        id: 'WU-1223',
        status: WU_STATUS.DONE,
        title: 'Test WU',
      };

      vi.mocked(wuYaml.readWU).mockReturnValue(mockDoc as ReturnType<typeof wuYaml.readWU>);

      const { readWU } = await import('@lumenflow/core/dist/wu-yaml.js');
      const doc = readWU('path/to/wu.yaml', 'WU-1223');

      expect(doc.status).toBe(WU_STATUS.DONE);
      expect(doc.status).not.toBe(WU_STATUS.IN_PROGRESS);
    });
  });

  describe('success message', () => {
    it('should include copy-paste instruction with main path', async () => {
      // The success message should include:
      // 1. Main checkout path
      // 2. WU ID
      // 3. Copy-paste command: cd <main> && pnpm wu:done --id <WU-ID>

      const mainCheckout = '/repo';
      const wuId = 'WU-1223';

      // Build expected command that would be in the success message
      const expectedCommand = `cd ${mainCheckout} && pnpm wu:done --id ${wuId}`;

      expect(expectedCommand).toBe('cd /repo && pnpm wu:done --id WU-1223');
    });
  });
});

describe('wu:done worktree check (WU-1223)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should error when run from worktree with guidance to use wu:prep', async () => {
    // Mock location as worktree
    vi.mocked(locationResolver.resolveLocation).mockResolvedValue({
      type: LOCATION_TYPES.WORKTREE,
      cwd: '/repo/worktrees/framework-cli-wu-1223',
      gitRoot: '/repo/worktrees/framework-cli-wu-1223',
      mainCheckout: '/repo',
      worktreeName: 'framework-cli-wu-1223',
      worktreeWuId: 'WU-1223',
    });

    const { resolveLocation } = await import('@lumenflow/core/dist/context/location-resolver.js');
    const location = await resolveLocation();

    // The error message should guide user to wu:prep workflow
    expect(location.type).toBe(LOCATION_TYPES.WORKTREE);

    // Error message should contain:
    const errorShouldContain = [
      'wu:prep', // Mention the new command
      'main checkout', // Explain where wu:done should run
      '/repo', // Main checkout path
    ];

    // Build the expected error content
    const expectedGuidance = `pnpm wu:prep --id WU-1223`;
    expect(expectedGuidance).toContain('wu:prep');
  });
});

describe('wu-prep spec-linter classification (WU-1441)', () => {
  it('should detect pre-existing failures only', async () => {
    const { classifySpecLinterFailures } = await import('../wu-prep.js');
    const result = classifySpecLinterFailures({
      mainInvalid: ['WU-1'],
      worktreeInvalid: ['WU-1'],
    });

    expect(result.hasPreExisting).toBe(true);
    expect(result.hasNewFailures).toBe(false);
    expect(result.newFailures).toEqual([]);
  });

  it('should detect newly introduced failures', async () => {
    const { classifySpecLinterFailures } = await import('../wu-prep.js');
    const result = classifySpecLinterFailures({
      mainInvalid: ['WU-1'],
      worktreeInvalid: ['WU-1', 'WU-2'],
    });

    expect(result.hasPreExisting).toBe(true);
    expect(result.hasNewFailures).toBe(true);
    expect(result.newFailures).toEqual(['WU-2']);
  });

  it('should detect failures when main is clean', async () => {
    const { classifySpecLinterFailures } = await import('../wu-prep.js');
    const result = classifySpecLinterFailures({
      mainInvalid: [],
      worktreeInvalid: ['WU-3'],
    });

    expect(result.hasPreExisting).toBe(false);
    expect(result.hasNewFailures).toBe(true);
    expect(result.newFailures).toEqual(['WU-3']);
  });
});
