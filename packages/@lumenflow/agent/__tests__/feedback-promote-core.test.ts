/**
 * Feedback Promote CLI Tests (WU-1599)
 *
 * Tests for:
 * - pnpm feedback:review --draft (generates draft WU specs)
 * - pnpm feedback:promote --interactive (walks through drafts)
 * - Promoted incidents tagged as pending_resolution
 *
 * @see {@link tools/feedback-promote.mjs} - CLI entry point
 * @see {@link tools/lib/feedback-promote-core.mjs} - Core logic
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import {
  generateDraft,
  loadDrafts,
  promoteDraft,
  updateFeedbackIndex,
  loadFeedbackIndex,
  DRAFT_DIRECTORY,
  FEEDBACK_INDEX_PATH,
} from '../src/feedback-promote-core.js';

describe('feedback-promote-core', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'feedback-promote-test-'));
    await mkdir(join(testDir, '.beacon', 'incidents'), { recursive: true });
    await mkdir(join(testDir, '.beacon', 'memory'), { recursive: true });
    await mkdir(join(testDir, '.beacon', 'feedback-drafts'), { recursive: true });
  });

  afterEach(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe('generateDraft', () => {
    it('should generate draft YAML with title from pattern title', async () => {
      const pattern = {
        title: 'Test failure in gates',
        frequency: 3,
        category: 'test',
        score: 12.5,
        firstSeen: '2025-12-01T10:00:00.000Z',
        lastSeen: '2025-12-01T15:30:00.000Z',
        examples: [
          { id: 'inc-1', severity: 'major', source: 'test' },
          { id: 'inc-2', severity: 'minor', source: 'test' },
        ],
      };

      const draft = await generateDraft(testDir, pattern, { writeFile: true });

      expect(draft.title).toBe('Test failure in gates');
      expect(draft.lane).toBe('Operations: Tooling');
      expect(draft.description).toContain('Pattern detected from 3 incident(s)');
      expect(draft.description).toContain('Problem: Test failure in gates');
      expect(draft.acceptance).toHaveLength(4);
      expect(draft.source_incidents).toEqual(['inc-1', 'inc-2']);
      expect(draft.pattern_metadata.frequency).toBe(3);
      expect(draft.pattern_metadata.category).toBe('test');
      expect(draft.filePath).toContain(DRAFT_DIRECTORY);
    });

    it('should infer lane from pattern category', async () => {
      const pattern = {
        title: 'Documentation issue',
        category: 'docs',
        frequency: 2,
        score: 8.0,
        firstSeen: '2025-12-01T10:00:00.000Z',
        lastSeen: '2025-12-01T15:30:00.000Z',
        examples: [],
      };

      const draft = await generateDraft(testDir, pattern, { writeFile: false });

      expect(draft.lane).toBe('Operations: Documentation');
    });

    it('should handle unknown category', async () => {
      const pattern = {
        title: 'Unknown issue',
        category: 'unknown',
        frequency: 1,
        score: 5.0,
        examples: [],
      };

      const draft = await generateDraft(testDir, pattern, { writeFile: false });

      expect(draft.lane).toBe('Operations');
    });

    it('should create draft file when writeFile is true', async () => {
      const pattern = {
        title: 'Test draft',
        category: 'test',
        frequency: 1,
        score: 5.0,
        examples: [],
      };

      const draft = await generateDraft(testDir, pattern, { writeFile: true });

      expect(draft.filePath).toBeDefined();
      expect(existsSync(join(testDir, draft.filePath!))).toBe(true);
    });

    it('should not create file when writeFile is false', async () => {
      const pattern = {
        title: 'Test draft',
        category: 'test',
        frequency: 1,
        score: 5.0,
        examples: [],
      };

      const draft = await generateDraft(testDir, pattern, { writeFile: false });

      expect(draft.filePath).toBeUndefined();
    });
  });

  describe('loadDrafts', () => {
    it('should return empty array when no drafts directory', async () => {
      const drafts = await loadDrafts(testDir);
      expect(drafts).toEqual([]);
    });

    it('should load existing drafts from YAML files', async () => {
      // Create test draft files
      const draft1 = {
        title: 'Draft 1',
        lane: 'Operations: Tooling',
        description: 'Description 1',
        acceptance: ['Acceptance 1'],
        source_incidents: ['inc-1'],
        pattern_metadata: { frequency: 1, category: 'test', score: 5.0 },
      };

      const draft2 = {
        title: 'Draft 2',
        lane: 'Operations: Documentation',
        description: 'Description 2',
        acceptance: ['Acceptance 2'],
        source_incidents: ['inc-2'],
        pattern_metadata: { frequency: 2, category: 'docs', score: 8.0 },
      };

      // Write YAML files
      await writeFile(
        join(testDir, DRAFT_DIRECTORY, 'draft1.yaml'),
        'title: Draft 1\nlane: "Operations: Tooling"\ndescription: Description 1\nacceptance:\n  - Acceptance 1\nsource_incidents:\n  - inc-1\npattern_metadata:\n  frequency: 1\n  category: test\n  score: 5.0\n',
        'utf8',
      );

      await writeFile(
        join(testDir, DRAFT_DIRECTORY, 'draft2.yaml'),
        'title: Draft 2\nlane: "Operations: Documentation"\ndescription: Description 2\nacceptance:\n  - Acceptance 2\nsource_incidents:\n  - inc-2\npattern_metadata:\n  frequency: 2\n  category: docs\n  score: 8.0\n',
        'utf8',
      );

      const drafts = await loadDrafts(testDir);
      expect(drafts).toHaveLength(2);
      expect(drafts[0]?.title).toBe('Draft 1');
      expect(drafts[1]?.title).toBe('Draft 2');
      expect(drafts[0]?.filePath).toContain('draft1.yaml');
      expect(drafts[1]?.filePath).toContain('draft2.yaml');
    });

    it('should skip non-YAML files', async () => {
      // Create a non-YAML file
      await writeFile(
        join(testDir, DRAFT_DIRECTORY, 'readme.txt'),
        'This is not a YAML file',
        'utf8',
      );

      const drafts = await loadDrafts(testDir);
      expect(drafts).toEqual([]);
    });

    it('should skip malformed YAML files', async () => {
      // Create malformed YAML
      await writeFile(
        join(testDir, DRAFT_DIRECTORY, 'malformed.yaml'),
        'invalid: yaml: content: here',
        'utf8',
      );

      const drafts = await loadDrafts(testDir);
      expect(drafts).toEqual([]);
    });
  });

  describe('promoteDraft', () => {
    it('should generate wu:create command', async () => {
      const draft = {
        title: 'Test WU',
        lane: 'Operations: Tooling',
        description: 'Test description',
        acceptance: ['Test acceptance'],
        source_incidents: ['inc-1'],
        pattern_metadata: { frequency: 1, category: 'test', score: 5.0 },
      };

      const result = await promoteDraft(testDir, draft, { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.wuId).toMatch(/^WU-\d+$/);
      expect(result.command).toContain('pnpm wu:create');
      expect(result.command).toContain('--id');
      expect(result.command).toContain('--title "Test WU"');
      expect(result.command).toContain('--lane "Operations: Tooling"');
      expect(result.command).toContain('--description "Test description"');
      expect(result.command).toContain('--acceptance "Test acceptance"');
    });

    it('should use custom WU ID when provided', async () => {
      const draft = {
        title: 'Test WU',
        lane: 'Operations: Tooling',
        description: 'Test description',
        acceptance: ['Test acceptance'],
        source_incidents: [],
        pattern_metadata: { frequency: 1, category: 'test', score: 5.0 },
      };

      const result = await promoteDraft(testDir, draft, {
        dryRun: true,
        wuIdOverride: 'WU-9999',
      });

      expect(result.wuId).toBe('WU-9999');
      expect(result.command).toContain('--id WU-9999');
    });

    it('should update feedback index with incident mappings', async () => {
      // Mock execSync to avoid actual command execution
      const { execSync } = await import('node:child_process');
      const mockExecSync = vi.fn(() => '');
      vi.doMock('node:child_process', () => ({
        execSync: mockExecSync,
      }));

      const draft = {
        title: 'Test WU',
        lane: 'Operations: Tooling',
        description: 'Test description',
        acceptance: ['Test acceptance'],
        source_incidents: ['inc-1', 'inc-2'],
        pattern_metadata: { frequency: 2, category: 'test', score: 10.0 },
      };

      const result = await promoteDraft(testDir, draft, { dryRun: false });

      expect(result.success).toBe(true);

      // Check that feedback index was updated
      const indexContent = await readFile(join(testDir, FEEDBACK_INDEX_PATH), 'utf8');
      const lines = indexContent.trim().split('\n');
      expect(lines).toHaveLength(2);

      const entry1 = JSON.parse(lines[0]!);
      const entry2 = JSON.parse(lines[1]!);
      expect(entry1.incident_id).toBe('inc-1');
      expect(entry1.wu_id).toBe(result.wuId);
      expect(entry1.status).toBe('pending_resolution');
      expect(entry2.incident_id).toBe('inc-2');
      expect(entry2.wu_id).toBe(result.wuId);
      expect(entry2.status).toBe('pending_resolution');
    });

    it('should remove draft file when removeDraft is true', async () => {
      const draft = {
        title: 'Test WU',
        lane: 'Operations: Tooling',
        description: 'Test description',
        acceptance: ['Test acceptance'],
        source_incidents: [],
        pattern_metadata: { frequency: 1, category: 'test', score: 5.0 },
      };

      // Create draft file first
      const createdDraft = await generateDraft(testDir, draft, { writeFile: true });
      expect(existsSync(join(testDir, createdDraft.filePath!))).toBe(true);

      const result = await promoteDraft(testDir, createdDraft, {
        dryRun: true,
        removeDraft: true,
      });

      expect(result.draftRemoved).toBe(true);
      expect(existsSync(join(testDir, createdDraft.filePath!))).toBe(false);
    });

    it('should handle missing draft file gracefully when removing', async () => {
      const draft = {
        title: 'Test WU',
        lane: 'Operations: Tooling',
        description: 'Test description',
        acceptance: ['Test acceptance'],
        source_incidents: [],
        pattern_metadata: { frequency: 1, category: 'test', score: 5.0 },
        filePath: join(DRAFT_DIRECTORY, 'nonexistent-draft.yaml'),
      };

      const result = await promoteDraft(testDir, draft, {
        dryRun: true,
        removeDraft: true,
      });

      expect(result.draftRemoved).toBe(true);
    });
  });

  describe('updateFeedbackIndex', () => {
    it('should create index file if it does not exist', async () => {
      const draft = {
        title: 'Test WU',
        lane: 'Operations: Tooling',
        description: 'Test description',
        acceptance: ['Test acceptance'],
        source_incidents: ['inc-1'],
        pattern_metadata: { frequency: 1, category: 'test', score: 5.0 },
      };

      await updateFeedbackIndex(testDir, 'WU-1234', ['inc-1']);

      const indexContent = await readFile(join(testDir, FEEDBACK_INDEX_PATH), 'utf8');
      const lines = indexContent.trim().split('\n');
      expect(lines).toHaveLength(1);

      const entry = JSON.parse(lines[0]);
      expect(entry.incident_id).toBe('inc-1');
      expect(entry.wu_id).toBe('WU-1234');
      expect(entry.status).toBe('pending_resolution');
      expect(entry.timestamp).toBeDefined();
    });

    it('should append to existing index file', async () => {
      // Create initial index
      await writeFile(
        join(testDir, FEEDBACK_INDEX_PATH),
        '{"incident_id":"inc-1","wu_id":"WU-1234","status":"pending_resolution","timestamp":"2025-12-01T10:00:00.000Z"}\n',
        'utf8',
      );

      const draft = {
        title: 'Test WU',
        lane: 'Operations: Tooling',
        description: 'Test description',
        acceptance: ['Test acceptance'],
        source_incidents: ['inc-2'],
        pattern_metadata: { frequency: 1, category: 'test', score: 5.0 },
      };

      await updateFeedbackIndex(testDir, 'WU-1235', ['inc-2']);

      const indexContent = await readFile(join(testDir, FEEDBACK_INDEX_PATH), 'utf8');
      const lines = indexContent.trim().split('\n');
      expect(lines).toHaveLength(2);

      const entry1 = JSON.parse(lines[0]);
      const entry2 = JSON.parse(lines[1]);
      expect(entry1.incident_id).toBe('inc-1');
      expect(entry1.wu_id).toBe('WU-1234');
      expect(entry2.incident_id).toBe('inc-2');
      expect(entry2.wu_id).toBe('WU-1235');
    });
  });

  describe('loadFeedbackIndex', () => {
    it('should return empty array if index file does not exist', async () => {
      const index = await loadFeedbackIndex(testDir);
      expect(index).toEqual([]);
    });

    it('should load existing index entries', async () => {
      // Create index file
      await writeFile(
        join(testDir, FEEDBACK_INDEX_PATH),
        '{"incident_id":"inc-1","wu_id":"WU-1234","status":"pending_resolution","timestamp":"2025-12-01T10:00:00.000Z"}\n' +
          '{"incident_id":"inc-2","wu_id":"WU-1235","status":"resolved","timestamp":"2025-12-01T11:00:00.000Z"}\n',
        'utf8',
      );

      const index = await loadFeedbackIndex(testDir);
      expect(index).toHaveLength(2);
      expect(index[0].incident_id).toBe('inc-1');
      expect(index[0].wu_id).toBe('WU-1234');
      expect(index[0].status).toBe('pending_resolution');
      expect(index[1].incident_id).toBe('inc-2');
      expect(index[1].wu_id).toBe('WU-1235');
      expect(index[1].status).toBe('resolved');
    });

    it('should skip malformed entries', async () => {
      // Create index file with malformed JSON
      await writeFile(
        join(testDir, FEEDBACK_INDEX_PATH),
        '{"incident_id":"inc-1","wu_id":"WU-1234","status":"pending_resolution","timestamp":"2025-12-01T10:00:00.000Z"}\n' +
          'invalid json\n' +
          '{"incident_id":"inc-2","wu_id":"WU-1235","status":"resolved","timestamp":"2025-12-01T11:00:00.000Z"}\n',
        'utf8',
      );

      const index = await loadFeedbackIndex(testDir);
      expect(index).toHaveLength(2);
      expect(index[0].incident_id).toBe('inc-1');
      expect(index[1].incident_id).toBe('inc-2');
    });
  });
});
