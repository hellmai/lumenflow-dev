import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readBacklogFile,
  writeBacklogFile,
  findSectionBounds,
  removeBulletFromSection,
  addBulletToSection,
  moveBullet,
} from '../backlog-editor.js';

describe('backlog-editor', () => {
  let testDir;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'backlog-editor-test-'));
  });

  afterEach(() => {
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('readBacklogFile', () => {
    it('should read file and separate frontmatter from content', () => {
      const filePath = join(testDir, 'backlog.md');
      const content = `---
headings:
  ready: '## 🚀 Ready'
  in_progress: '## 🔧 In progress'
---
## 🚀 Ready

- [WU-123 — Test](docs/04-operations/tasks/wu/WU-123.yaml)

## 🔧 In progress

(No items currently in progress)`;
      writeFileSync(filePath, content, 'utf8');

      const result = readBacklogFile(filePath);
      assert.ok(result.frontmatter.includes('headings:'));
      assert.ok(result.lines[0].includes('## 🚀 Ready'));
    });

    it('should handle files without frontmatter', () => {
      const filePath = join(testDir, 'backlog.md');
      const content = `## 🚀 Ready\n\n- [WU-123 — Test](link)`;
      writeFileSync(filePath, content, 'utf8');

      const result = readBacklogFile(filePath);
      assert.equal(result.frontmatter, '');
      assert.ok(result.lines[0].includes('## 🚀 Ready'));
    });
  });

  describe('writeBacklogFile', () => {
    it('should write file with frontmatter and content', () => {
      const filePath = join(testDir, 'backlog.md');
      const frontmatter = `---\nheadings:\n  ready: '## Ready'\n---\n`;
      const lines = ['## Ready', '', '- [WU-123 — Test](link)'];

      writeBacklogFile(filePath, frontmatter, lines);

      const result = readBacklogFile(filePath);
      assert.ok(result.frontmatter.includes('headings:'));
      assert.ok(result.lines[0].includes('## Ready'));
      assert.ok(result.lines[2].includes('WU-123'));
    });

    it('should write file without frontmatter', () => {
      const filePath = join(testDir, 'backlog.md');
      const frontmatter = '';
      const lines = ['## Ready', '', '- [WU-123 — Test](link)'];

      writeBacklogFile(filePath, frontmatter, lines);

      const result = readBacklogFile(filePath);
      assert.equal(result.frontmatter, '');
      assert.ok(result.lines[0].includes('## Ready'));
    });
  });

  describe('findSectionBounds', () => {
    it('should find section start and end indices', () => {
      const lines = [
        '## Ready',
        '',
        '- [WU-123 — Test](link)',
        '',
        '## In Progress',
        '',
        '- [WU-456 — Another](link)',
      ];

      const result = findSectionBounds(lines, '## Ready');
      assert.equal(result.start, 0);
      assert.equal(result.end, 4); // Before "## In Progress"
    });

    it('should handle section at end of file', () => {
      const lines = [
        '## Ready',
        '',
        '- [WU-123 — Test](link)',
        '',
        '## In Progress',
        '',
        '- [WU-456 — Another](link)',
      ];

      const result = findSectionBounds(lines, '## In Progress');
      assert.equal(result.start, 4);
      assert.equal(result.end, 7); // End of file
    });

    it('should return null if section not found', () => {
      const lines = ['## Ready', '', '- [WU-123 — Test](link)'];

      const result = findSectionBounds(lines, '## Nonexistent');
      assert.equal(result, null);
    });

    it('should handle section headers case-insensitively', () => {
      const lines = ['## ready', '', '- [WU-123 — Test](link)', '', '## In Progress'];

      const result = findSectionBounds(lines, '## Ready');
      assert.equal(result.start, 0);
      assert.equal(result.end, 4);
    });
  });

  describe('removeBulletFromSection', () => {
    it('should remove bullet matching pattern from section', () => {
      const lines = [
        '## Ready',
        '',
        '- [WU-123 — Test](docs/04-operations/tasks/wu/WU-123.yaml)',
        '- [WU-456 — Another](docs/04-operations/tasks/wu/WU-456.yaml)',
        '',
        '## In Progress',
      ];

      removeBulletFromSection(lines, 0, 5, 'WU-123');
      assert.equal(lines.length, 5); // One line removed
      assert.ok(!lines.some((l) => l.includes('WU-123')));
      assert.ok(lines.some((l) => l.includes('WU-456')));
    });

    it('should not modify lines outside section bounds', () => {
      const lines = [
        '## Ready',
        '',
        '- [WU-123 — Test](link)',
        '',
        '## In Progress',
        '',
        '- [WU-123 — Duplicate](link)',
      ];

      removeBulletFromSection(lines, 0, 4, 'WU-123');
      assert.ok(!lines.slice(0, 4).some((l) => l.includes('WU-123')));
      assert.ok(lines.slice(4).some((l) => l.includes('WU-123'))); // Still in In Progress
    });
  });

  describe('addBulletToSection', () => {
    it('should add bullet after section header', () => {
      const lines = ['## Ready', '', '- [WU-456 — Another](link)', '', '## In Progress'];

      addBulletToSection(lines, 0, '- [WU-123 — Test](link)');
      assert.ok(lines[2].includes('WU-123'));
      assert.ok(lines[3].includes('WU-456'));
    });

    it('should replace "(No items...)" marker if present', () => {
      const lines = ['## Ready', '', '(No items currently in progress)', '', '## In Progress'];

      addBulletToSection(lines, 0, '- [WU-123 — Test](link)');
      assert.ok(!lines.some((l) => l.includes('No items')));
      assert.ok(lines[2].includes('WU-123'));
    });

    it('should handle empty section', () => {
      const lines = ['## Ready', '', '## In Progress'];

      addBulletToSection(lines, 0, '- [WU-123 — Test](link)');
      assert.equal(lines[1], '');
      assert.ok(lines[2].includes('WU-123'));
    });
  });

  describe('moveBullet', () => {
    it('should move bullet from one section to another', () => {
      const filePath = join(testDir, 'backlog.md');
      const content = `## Ready

- [WU-123 — Test](docs/04-operations/tasks/wu/WU-123.yaml)

## In Progress

(No items currently in progress)`;
      writeFileSync(filePath, content, 'utf8');

      moveBullet(filePath, {
        fromSection: '## Ready',
        toSection: '## In Progress',
        bulletPattern: 'WU-123',
        newBullet: '- [WU-123 — Test](docs/04-operations/tasks/wu/WU-123.yaml)',
      });

      const result = readBacklogFile(filePath);
      assert.ok(!result.lines.slice(0, 3).some((l) => l.includes('WU-123')));
      assert.ok(result.lines.slice(3).some((l) => l.includes('WU-123')));
    });

    it('should preserve frontmatter when moving bullets', () => {
      const filePath = join(testDir, 'backlog.md');
      const content = `---
meta: data
---
## Ready

- [WU-123 — Test](link)

## In Progress

(No items)`;
      writeFileSync(filePath, content, 'utf8');

      moveBullet(filePath, {
        fromSection: '## Ready',
        toSection: '## In Progress',
        bulletPattern: 'WU-123',
        newBullet: '- [WU-123 — Test](link)',
      });

      const result = readBacklogFile(filePath);
      assert.ok(result.frontmatter.includes('meta: data'));
    });
  });
});
