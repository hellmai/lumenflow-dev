import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findSectionBounds, moveBullet, readBacklogFile } from '../backlog-editor.js';

function createFixture(): { backlogPath: string; cleanup: () => void } {
  const tempDir = mkdtempSync(join(tmpdir(), 'backlog-editor-'));
  const backlogPath = join(tempDir, 'backlog.md');

  writeFileSync(
    backlogPath,
    [
      '---',
      'sections:',
      '  ready:',
      "    heading: '## Ready'",
      '---',
      '## Ready',
      '',
      '- [WU-1 — First item](wu/WU-1.yaml) — Framework: Core',
      '',
      '## In Progress',
      '',
      '(No items currently in progress)',
      '',
    ].join('\n'),
  );

  return {
    backlogPath,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  };
}

describe('backlog-editor', () => {

  it('finds section bounds case-insensitively', () => {
    const fixture = createFixture();
    try {
      const { lines } = readBacklogFile(fixture.backlogPath);
      const ready = findSectionBounds(lines, '## ready');
      const inProgress = findSectionBounds(lines, '## in progress');

      expect(ready).not.toBeNull();
      expect(inProgress).not.toBeNull();
      expect(ready?.start).toBe(0);
      expect(ready?.end).toBe(4);
      expect(inProgress?.start).toBe(4);
    } finally {
      fixture.cleanup();
    }
  });

  it('moves a bullet between sections and replaces no-items marker', () => {
    const fixture = createFixture();
    try {
      moveBullet(fixture.backlogPath, {
        fromSection: '## Ready',
        toSection: '## In Progress',
        bulletPattern: 'WU-1',
        newBullet: '- [WU-1 — First item](wu/WU-1.yaml) — Framework: Core',
      });

      const { lines } = readBacklogFile(fixture.backlogPath);
      const ready = findSectionBounds(lines, '## Ready');
      const inProgress = findSectionBounds(lines, '## In Progress');

      expect(ready).not.toBeNull();
      expect(inProgress).not.toBeNull();

      const readyLines = lines.slice(ready!.start, ready!.end).join('\n');
      const inProgressLines = lines.slice(inProgress!.start, inProgress!.end).join('\n');

      expect(readyLines).not.toContain('WU-1');
      expect(inProgressLines).toContain('WU-1');
      expect(inProgressLines).not.toContain('(No items currently in progress)');
    } finally {
      fixture.cleanup();
    }
  });
});
