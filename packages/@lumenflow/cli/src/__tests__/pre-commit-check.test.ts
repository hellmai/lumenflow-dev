// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  detectLumenflowVersionChange,
  extractWuEditStampPathsFromDiff,
  hasAllWuEditStamps,
  validateUpgradeMarker,
} from '../pre-commit-check.js';

describe('pre-commit-check helpers', () => {
  describe('detectLumenflowVersionChange', () => {
    it('returns true when @lumenflow package versions change', () => {
      const diff = `\n+  "@lumenflow/cli": "3.7.2"\n-  "@lumenflow/cli": "3.7.1"\n`;
      expect(detectLumenflowVersionChange(diff)).toBe(true);
    });

    it('returns false for non-lumenflow dependency changes', () => {
      const diff = `\n+  "chalk": "5.6.0"\n-  "chalk": "5.5.0"\n`;
      expect(detectLumenflowVersionChange(diff)).toBe(false);
    });
  });

  describe('WU edit stamps', () => {
    it('extracts stamped paths from added wu-events checkpoint notes', () => {
      const diff =
        '+{"type":"checkpoint","wuId":"WU-123","timestamp":"2026-02-28T12:00:00.000Z","note":"[wu:edit] path=docs/04-operations/tasks/wu/WU-123.yaml"}';

      expect(extractWuEditStampPathsFromDiff(diff)).toEqual([
        'docs/04-operations/tasks/wu/WU-123.yaml',
      ]);
    });

    it('verifies all changed WU YAML paths have matching stamps', () => {
      const changed = ['docs/04-operations/tasks/wu/WU-123.yaml'];
      const stamped = ['docs/04-operations/tasks/wu/WU-123.yaml'];
      expect(hasAllWuEditStamps(changed, stamped)).toBe(true);
    });

    it('fails when a changed WU YAML path is missing a stamp', () => {
      const changed = ['docs/04-operations/tasks/wu/WU-123.yaml'];
      const stamped: string[] = [];
      expect(hasAllWuEditStamps(changed, stamped)).toBe(false);
    });
  });

  describe('validateUpgradeMarker', () => {
    it('accepts marker with consumed status', () => {
      const marker = {
        kind: 'lumenflow-upgrade',
        status: 'consumed',
        created_at: '2026-02-28T12:00:00.000Z',
        consumed_at: '2026-02-28T12:01:00.000Z',
      };
      expect(validateUpgradeMarker(marker).valid).toBe(true);
    });

    it('rejects marker with wrong kind', () => {
      const marker = {
        kind: 'manual-upgrade',
        status: 'consumed',
        created_at: '2026-02-28T12:00:00.000Z',
      };
      expect(validateUpgradeMarker(marker).valid).toBe(false);
    });
  });
});
