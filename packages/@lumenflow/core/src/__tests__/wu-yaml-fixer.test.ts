import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  autoFixWUYaml,
  applyFixes,
  detectFixableIssues,
  FIXABLE_ISSUES,
} from '../wu-yaml-fixer.js';

describe('wu-yaml-fixer', () => {
  it('detects common fixable issues in a WU doc', () => {
    const issues = detectFixableIssues({
      created: '2026-02-15T09:42:01.000Z',
      assigned_to: 'tom',
      type: 'docs',
      phase: '2',
      priority: 'p1',
    });

    expect(issues.map((issue) => issue.type)).toEqual([
      FIXABLE_ISSUES.DATE_ISO_TIMESTAMP,
      FIXABLE_ISSUES.USERNAME_NOT_EMAIL,
      FIXABLE_ISSUES.TYPE_ALIAS,
      FIXABLE_ISSUES.PHASE_STRING,
      FIXABLE_ISSUES.PRIORITY_LOWERCASE,
    ]);
  });

  it('applies detected fixes in-place', () => {
    const doc: Record<string, unknown> = {
      created: '2026-02-15T09:42:01.000Z',
      assigned_to: 'tom',
      type: 'docs',
      phase: '2',
      priority: 'p1',
    };

    const issues = detectFixableIssues(doc);
    const fixed = applyFixes(doc, issues);

    expect(fixed).toBe(5);
    expect(doc).toMatchObject({
      created: '2026-02-15',
      assigned_to: 'tom@example.com',
      type: 'documentation',
      phase: 2,
      priority: 'P1',
    });
  });

  it('supports dry-run and backup behavior for file fixes', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'wu-yaml-fixer-'));
    try {
      const wuPath = path.join(tempDir, 'WU-1713.yaml');
      await writeFile(
        wuPath,
        [
          'id: WU-1713',
          'created: 2026-02-15T09:42:01.000Z',
          'assigned_to: tom',
          'type: docs',
          'phase: "3"',
          'priority: p2',
        ].join('\n'),
        'utf-8',
      );

      const dryRun = autoFixWUYaml(wuPath, { dryRun: true });
      expect(dryRun.fixed).toBe(0);
      expect(dryRun.wouldFix).toBeGreaterThan(0);

      const result = autoFixWUYaml(wuPath, { backup: true });
      expect(result.fixed).toBeGreaterThan(0);
      expect(result.backupPath).toBe(`${wuPath}.bak`);
      expect(existsSync(`${wuPath}.bak`)).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
