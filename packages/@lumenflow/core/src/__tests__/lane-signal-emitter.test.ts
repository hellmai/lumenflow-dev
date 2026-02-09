/**
 * @file lane-signal-emitter.test.ts
 * @description WU-1498 lane-signal telemetry tests
 *
 * Verifies:
 * - NDJSON emission payload includes wuId, lane, actualFiles, timestamp
 * - actualFiles are derived from git diff (main...laneBranch)
 * - emission is fail-open (never blocks completion flow)
 * - completion paths are wired to invoke the shared emitter helper
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LANE_SIGNALS_NDJSON,
  collectActualFilesForLaneBranch,
  emitLaneSignalForCompletion,
  parseActualFilesFromDiffOutput,
} from '../wu-done-branch-only.js';

function repoRootFromThisFile(): string {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(thisDir, '..', '..', '..', '..', '..');
}

describe('lane-signal emitter (WU-1498)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseActualFilesFromDiffOutput', () => {
    it('parses newline-delimited git diff output into file paths', () => {
      const parsed = parseActualFilesFromDiffOutput(
        'packages/@lumenflow/core/src/wu-done-worktree.ts\npackages/@lumenflow/core/src/wu-done-pr.ts\n\n',
      );

      expect(parsed).toEqual([
        'packages/@lumenflow/core/src/wu-done-worktree.ts',
        'packages/@lumenflow/core/src/wu-done-pr.ts',
      ]);
    });

    it('returns empty array for empty or whitespace-only output', () => {
      expect(parseActualFilesFromDiffOutput('')).toEqual([]);
      expect(parseActualFilesFromDiffOutput(' \n \n')).toEqual([]);
    });
  });

  describe('collectActualFilesForLaneBranch', () => {
    it('collects actual files from main...lane diff', async () => {
      const gitAdapter = {
        raw: vi
          .fn()
          .mockResolvedValue(
            'packages/@lumenflow/core/src/wu-done-worktree.ts\npackages/@lumenflow/core/src/wu-done-branch-only.ts\n',
          ),
      };

      const files = await collectActualFilesForLaneBranch(
        'lane/framework-core-lifecycle/wu-1498',
        gitAdapter,
      );

      expect(gitAdapter.raw).toHaveBeenCalledWith([
        'diff',
        '--name-only',
        'main...lane/framework-core-lifecycle/wu-1498',
      ]);
      expect(files).toEqual([
        'packages/@lumenflow/core/src/wu-done-worktree.ts',
        'packages/@lumenflow/core/src/wu-done-branch-only.ts',
      ]);
    });

    it('fails open and returns empty list if git diff fails', async () => {
      const gitAdapter = {
        raw: vi.fn().mockRejectedValue(new Error('simulated diff failure')),
      };
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const files = await collectActualFilesForLaneBranch(
        'lane/framework-core-lifecycle/wu-1498',
        gitAdapter,
      );

      expect(files).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not compute lane-signal actualFiles'),
      );
    });
  });

  describe('emitLaneSignalForCompletion', () => {
    it('emits NDJSON payload with required fields', async () => {
      const gitAdapter = {
        raw: vi
          .fn()
          .mockResolvedValue(
            'packages/@lumenflow/core/src/wu-done-worktree.ts\npackages/@lumenflow/core/src/wu-done-pr.ts\n',
          ),
      };
      const emitFn = vi.fn();

      await emitLaneSignalForCompletion({
        wuId: 'WU-1498',
        lane: 'Framework: Core Lifecycle',
        laneBranch: 'lane/framework-core-lifecycle/wu-1498',
        completionMode: 'worktree',
        gitAdapter,
        emitFn,
      });

      expect(emitFn).toHaveBeenCalledTimes(1);
      const [filePath, event] = emitFn.mock.calls[0];
      expect(filePath).toBe(LANE_SIGNALS_NDJSON);
      expect(event.wuId).toBe('WU-1498');
      expect(event.lane).toBe('Framework: Core Lifecycle');
      expect(event.completionMode).toBe('worktree');
      expect(event.actualFiles).toEqual([
        'packages/@lumenflow/core/src/wu-done-worktree.ts',
        'packages/@lumenflow/core/src/wu-done-pr.ts',
      ]);
      expect(typeof event.timestamp).toBe('string');
      expect(new Date(event.timestamp).toString()).not.toBe('Invalid Date');
    });

    it('is fail-open when emit function throws', async () => {
      const gitAdapter = { raw: vi.fn().mockResolvedValue('') };
      const emitFn = vi.fn(() => {
        throw new Error('simulated emit failure');
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(
        emitLaneSignalForCompletion({
          wuId: 'WU-1498',
          lane: 'Framework: Core Lifecycle',
          laneBranch: 'lane/framework-core-lifecycle/wu-1498',
          completionMode: 'branch-only',
          gitAdapter,
          emitFn,
        }),
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Lane-signal emission failed (fail-open)'),
      );
    });
  });

  describe('completion path wiring', () => {
    it('worktree completion path calls the shared lane-signal helper', () => {
      const repoRoot = repoRootFromThisFile();
      const source = readFileSync(
        path.join(repoRoot, 'packages/@lumenflow/core/src/wu-done-worktree.ts'),
        'utf-8',
      );

      expect(source).toContain('emitLaneSignalForCompletion(');
    });

    it('branch-only and branch-pr completion paths call the shared lane-signal helper', () => {
      const repoRoot = repoRootFromThisFile();
      const source = readFileSync(
        path.join(repoRoot, 'packages/@lumenflow/core/src/wu-done-branch-only.ts'),
        'utf-8',
      );
      const matches = source.match(/emitLaneSignalForCompletion\(/g) ?? [];

      expect(matches.length).toBeGreaterThanOrEqual(2);
    });
  });
});
