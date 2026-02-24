// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';

// Mock getConfig before importing the module under test
vi.mock('@lumenflow/core/config', () => ({
  getConfig: vi.fn(),
}));

// Import after mock setup
import { getConfig } from '@lumenflow/core/config';
import { LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { WU_EVENTS_FILE_NAME } from '@lumenflow/core/wu-state-store';
import { resolveStateDir, resolveWuEventsRelativePath } from '../state-path-resolvers.js';

const mockedGetConfig = vi.mocked(getConfig);

describe('state-path-resolvers', () => {
  const PROJECT_ROOT = '/tmp/test-project';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveStateDir', () => {
    it('returns config-based state dir joined with project root', () => {
      mockedGetConfig.mockReturnValue({
        state: { stateDir: '.lumenflow/state' },
      } as ReturnType<typeof getConfig>);

      const result = resolveStateDir(PROJECT_ROOT);
      expect(result).toBe(path.join(PROJECT_ROOT, '.lumenflow/state'));
    });

    it('supports custom state dirs from consumer config', () => {
      mockedGetConfig.mockReturnValue({
        state: { stateDir: '.custom/state-dir' },
      } as ReturnType<typeof getConfig>);

      const result = resolveStateDir(PROJECT_ROOT);
      expect(result).toBe(path.join(PROJECT_ROOT, '.custom/state-dir'));
    });

    it('falls back to LUMENFLOW_PATHS.STATE_DIR when getConfig throws', () => {
      mockedGetConfig.mockImplementation(() => {
        throw new Error('No workspace.yaml found');
      });

      const result = resolveStateDir(PROJECT_ROOT);
      expect(result).toBe(path.join(PROJECT_ROOT, LUMENFLOW_PATHS.STATE_DIR));
    });

    it('passes projectRoot to getConfig for correct config resolution', () => {
      mockedGetConfig.mockReturnValue({
        state: { stateDir: '.lumenflow/state' },
      } as ReturnType<typeof getConfig>);

      resolveStateDir(PROJECT_ROOT);
      expect(mockedGetConfig).toHaveBeenCalledWith({ projectRoot: PROJECT_ROOT });
    });
  });

  describe('resolveWuEventsRelativePath', () => {
    it('returns forward-slash path using config stateDir and WU_EVENTS_FILE_NAME', () => {
      mockedGetConfig.mockReturnValue({
        state: { stateDir: '.lumenflow/state' },
      } as ReturnType<typeof getConfig>);

      const result = resolveWuEventsRelativePath(PROJECT_ROOT);
      // Must use forward slashes (for git add compatibility) and the constant filename
      expect(result).toBe(`.lumenflow/state/${WU_EVENTS_FILE_NAME}`);
      expect(result).toContain('wu-events.jsonl');
      // Must NOT contain backslashes
      expect(result).not.toContain('\\');
    });

    it('supports custom state dirs from consumer config', () => {
      mockedGetConfig.mockReturnValue({
        state: { stateDir: '.custom/state-dir' },
      } as ReturnType<typeof getConfig>);

      const result = resolveWuEventsRelativePath(PROJECT_ROOT);
      expect(result).toBe(`.custom/state-dir/${WU_EVENTS_FILE_NAME}`);
    });

    it('falls back to LUMENFLOW_PATHS.WU_EVENTS when getConfig throws', () => {
      mockedGetConfig.mockImplementation(() => {
        throw new Error('Config not available');
      });

      const result = resolveWuEventsRelativePath(PROJECT_ROOT);
      expect(result).toBe(LUMENFLOW_PATHS.WU_EVENTS);
    });

    it('normalizes backslashes from Windows-style stateDir paths', () => {
      mockedGetConfig.mockReturnValue({
        state: { stateDir: '.lumenflow\\state' },
      } as ReturnType<typeof getConfig>);

      const result = resolveWuEventsRelativePath(PROJECT_ROOT);
      expect(result).not.toContain('\\');
      expect(result).toBe(`.lumenflow/state/${WU_EVENTS_FILE_NAME}`);
    });

    it('passes projectRoot to getConfig for correct config resolution', () => {
      mockedGetConfig.mockReturnValue({
        state: { stateDir: '.lumenflow/state' },
      } as ReturnType<typeof getConfig>);

      resolveWuEventsRelativePath(PROJECT_ROOT);
      expect(mockedGetConfig).toHaveBeenCalledWith({ projectRoot: PROJECT_ROOT });
    });
  });
});
