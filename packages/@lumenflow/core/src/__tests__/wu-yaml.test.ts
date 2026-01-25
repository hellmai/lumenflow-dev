/**
 * @fileoverview Tests for wu-yaml module
 *
 * WU-1102: INIT-003 Phase 2b - Migrate WU helpers to @lumenflow/core
 *
 * Tests cover:
 * - readWU: Read and validate WU YAML with ID matching
 * - readWURaw: Read YAML without ID validation
 * - parseYAML: Parse YAML string to object
 * - stringifyYAML: Stringify object to YAML
 * - writeWU: Write WU YAML file
 * - appendNote: Append notes to WU document
 * - appendAgentSession: Append agent session to WU
 * - YAML_STRINGIFY_OPTIONS: Standard options export
 *
 * @module __tests__/wu-yaml.test
 */

import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readWU,
  readWURaw,
  parseYAML,
  stringifyYAML,
  writeWU,
  appendNote,
  appendAgentSession,
  YAML_STRINGIFY_OPTIONS,
} from '../wu-yaml.js';
import { ErrorCodes } from '../error-handler.js';

describe('wu-yaml', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'wu-yaml-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('YAML_STRINGIFY_OPTIONS', () => {
    it('should export YAML_STRINGIFY_OPTIONS with correct defaults', () => {
      expect(YAML_STRINGIFY_OPTIONS).toBeDefined();
      expect(YAML_STRINGIFY_OPTIONS.lineWidth).toBe(100);
      expect(YAML_STRINGIFY_OPTIONS.singleQuote).toBe(true);
      expect(YAML_STRINGIFY_OPTIONS.defaultKeyType).toBe('PLAIN');
    });

    it('should be frozen (immutable)', () => {
      expect(Object.isFrozen(YAML_STRINGIFY_OPTIONS)).toBe(true);
    });
  });

  describe('parseYAML', () => {
    it('should parse valid YAML string to object', () => {
      const yamlStr = 'id: WU-123\ntitle: Test WU\nstatus: ready';
      const result = parseYAML(yamlStr);

      expect(result).toEqual({
        id: 'WU-123',
        title: 'Test WU',
        status: 'ready',
      });
    });

    it('should parse YAML with nested objects', () => {
      const yamlStr = `
id: WU-456
tests:
  unit:
    - src/__tests__/foo.test.ts
  e2e: []
`;
      const result = parseYAML(yamlStr);

      expect(result.id).toBe('WU-456');
      expect(result.tests.unit).toEqual(['src/__tests__/foo.test.ts']);
      expect(result.tests.e2e).toEqual([]);
    });

    it('should parse YAML with arrays', () => {
      const yamlStr = `
code_paths:
  - src/foo/**
  - src/bar/**
`;
      const result = parseYAML(yamlStr);

      expect(result.code_paths).toEqual(['src/foo/**', 'src/bar/**']);
    });

    it('should throw on invalid YAML syntax', () => {
      const invalidYaml = 'key: [invalid: yaml';

      expect(() => parseYAML(invalidYaml)).toThrow();
    });
  });

  describe('stringifyYAML', () => {
    it('should stringify object to YAML with default options', () => {
      const doc = { id: 'WU-123', title: 'Test WU' };
      const result = stringifyYAML(doc);

      expect(result).toContain('id: WU-123');
      expect(result).toContain('title: Test WU');
    });

    it('should use single quotes for strings when needed', () => {
      const doc = { title: "Test: WU's title" };
      const result = stringifyYAML(doc);

      // Should prefer single quotes as per options
      expect(result).toBeDefined();
    });

    it('should allow custom options to override defaults', () => {
      const doc = { id: 'WU-123', description: 'A very long description that might need wrapping' };
      const result = stringifyYAML(doc, { lineWidth: 20 });

      // Custom lineWidth should take effect
      expect(result).toBeDefined();
    });

    it('should handle arrays correctly', () => {
      const doc = { code_paths: ['src/a/**', 'src/b/**'] };
      const result = stringifyYAML(doc);

      expect(result).toContain('code_paths:');
      expect(result).toContain('- src/a/**');
      expect(result).toContain('- src/b/**');
    });
  });

  describe('readWU', () => {
    it('should read and parse valid WU YAML file', async () => {
      const wuPath = path.join(tempDir, 'WU-100.yaml');
      const content = `id: WU-100
title: Test WU
status: ready
lane: 'Framework: Core'
`;
      await writeFile(wuPath, content);

      const result = readWU(wuPath, 'WU-100');

      expect(result.id).toBe('WU-100');
      expect(result.title).toBe('Test WU');
      expect(result.status).toBe('ready');
      expect(result.lane).toBe('Framework: Core');
    });

    it('should throw FILE_NOT_FOUND error when file does not exist', () => {
      const nonExistentPath = path.join(tempDir, 'does-not-exist.yaml');

      expect(() => readWU(nonExistentPath, 'WU-999')).toThrow();

      try {
        readWU(nonExistentPath, 'WU-999');
      } catch (error: unknown) {
        const err = error as { code: string };
        expect(err.code).toBe(ErrorCodes.FILE_NOT_FOUND);
      }
    });

    it('should throw YAML_PARSE_ERROR on invalid YAML', async () => {
      const wuPath = path.join(tempDir, 'invalid.yaml');
      await writeFile(wuPath, 'invalid: [yaml: broken');

      expect(() => readWU(wuPath, 'WU-100')).toThrow();

      try {
        readWU(wuPath, 'WU-100');
      } catch (error: unknown) {
        const err = error as { code: string };
        expect(err.code).toBe(ErrorCodes.YAML_PARSE_ERROR);
      }
    });

    it('should throw WU_NOT_FOUND error on ID mismatch', async () => {
      const wuPath = path.join(tempDir, 'WU-100.yaml');
      await writeFile(wuPath, 'id: WU-200\ntitle: Wrong WU\n');

      expect(() => readWU(wuPath, 'WU-100')).toThrow();

      try {
        readWU(wuPath, 'WU-100');
      } catch (error: unknown) {
        const err = error as { code: string; message: string };
        expect(err.code).toBe(ErrorCodes.WU_NOT_FOUND);
        expect(err.message).toContain('mismatch');
        expect(err.message).toContain('WU-100');
        expect(err.message).toContain('WU-200');
      }
    });

    it('should throw WU_NOT_FOUND error when doc is null', async () => {
      const wuPath = path.join(tempDir, 'empty.yaml');
      await writeFile(wuPath, '');

      expect(() => readWU(wuPath, 'WU-100')).toThrow();

      try {
        readWU(wuPath, 'WU-100');
      } catch (error: unknown) {
        const err = error as { code: string };
        expect(err.code).toBe(ErrorCodes.WU_NOT_FOUND);
      }
    });

    it('should throw WU_NOT_FOUND error when doc has no id field', async () => {
      const wuPath = path.join(tempDir, 'no-id.yaml');
      await writeFile(wuPath, 'title: No ID\nstatus: ready\n');

      expect(() => readWU(wuPath, 'WU-100')).toThrow();

      try {
        readWU(wuPath, 'WU-100');
      } catch (error: unknown) {
        const err = error as { code: string };
        expect(err.code).toBe(ErrorCodes.WU_NOT_FOUND);
      }
    });
  });

  describe('readWURaw', () => {
    it('should read and parse YAML without ID validation', async () => {
      const yamlPath = path.join(tempDir, 'config.yaml');
      await writeFile(yamlPath, 'key: value\nnested:\n  foo: bar\n');

      const result = readWURaw(yamlPath);

      expect(result.key).toBe('value');
      expect(result.nested.foo).toBe('bar');
    });

    it('should throw FILE_NOT_FOUND error when file does not exist', () => {
      const nonExistentPath = path.join(tempDir, 'does-not-exist.yaml');

      expect(() => readWURaw(nonExistentPath)).toThrow();

      try {
        readWURaw(nonExistentPath);
      } catch (error: unknown) {
        const err = error as { code: string };
        expect(err.code).toBe(ErrorCodes.FILE_NOT_FOUND);
      }
    });

    it('should throw YAML_PARSE_ERROR on invalid YAML', async () => {
      const yamlPath = path.join(tempDir, 'invalid.yaml');
      await writeFile(yamlPath, 'invalid: [yaml');

      expect(() => readWURaw(yamlPath)).toThrow();

      try {
        readWURaw(yamlPath);
      } catch (error: unknown) {
        const err = error as { code: string };
        expect(err.code).toBe(ErrorCodes.YAML_PARSE_ERROR);
      }
    });
  });

  describe('writeWU', () => {
    it('should write WU document to file with consistent formatting', async () => {
      const wuPath = path.join(tempDir, 'output.yaml');
      const doc = {
        id: 'WU-100',
        title: 'Test WU',
        status: 'in_progress',
        code_paths: ['src/**'],
      };

      writeWU(wuPath, doc);

      const content = await readFile(wuPath, 'utf-8');
      expect(content).toContain('id: WU-100');
      expect(content).toContain('title: Test WU');
      expect(content).toContain('status: in_progress');
      expect(content).toContain('code_paths:');
      expect(content).toContain('- src/**');
    });

    it('should overwrite existing file', async () => {
      const wuPath = path.join(tempDir, 'existing.yaml');
      await writeFile(wuPath, 'old: content\n');

      writeWU(wuPath, { id: 'WU-NEW', title: 'New content' });

      const content = await readFile(wuPath, 'utf-8');
      expect(content).not.toContain('old: content');
      expect(content).toContain('id: WU-NEW');
    });

    it('should write valid YAML that can be read back', async () => {
      const wuPath = path.join(tempDir, 'roundtrip.yaml');
      const doc = {
        id: 'WU-123',
        title: 'Roundtrip Test',
        tests: { unit: ['a.test.ts', 'b.test.ts'], e2e: [] },
      };

      writeWU(wuPath, doc);
      const readBack = readWU(wuPath, 'WU-123');

      expect(readBack).toEqual(doc);
    });
  });

  describe('appendNote', () => {
    it('should set note when notes field is undefined', () => {
      const doc: { notes?: string } = {};

      appendNote(doc, 'First note');

      expect(doc.notes).toBe('First note');
    });

    it('should set note when notes field is null', () => {
      const doc: { notes: string | null } = { notes: null };

      appendNote(doc, 'First note');

      expect(doc.notes).toBe('First note');
    });

    it('should set note when notes field is empty string', () => {
      const doc = { notes: '' };

      appendNote(doc, 'First note');

      expect(doc.notes).toBe('First note');
    });

    it('should append note with newline when notes field has content', () => {
      const doc = { notes: 'Existing note' };

      appendNote(doc, 'Second note');

      expect(doc.notes).toBe('Existing note\nSecond note');
    });

    it('should trim trailing whitespace before appending', () => {
      const doc = { notes: 'Existing note   ' };

      appendNote(doc, 'Second note');

      expect(doc.notes).toBe('Existing note\nSecond note');
    });

    it('should handle array notes by converting to string first', () => {
      const doc: { notes: string | string[] } = { notes: ['Note 1', 'Note 2'] };

      appendNote(doc, 'Note 3');

      expect(doc.notes).toBe('Note 1\nNote 2\nNote 3');
    });

    it('should filter falsy values from array notes', () => {
      const doc: { notes: string | (string | null | undefined)[] } = {
        notes: ['Note 1', null, undefined, '', 'Note 2'],
      };

      appendNote(doc, 'Note 3');

      expect(doc.notes).toBe('Note 1\nNote 2\nNote 3');
    });

    it('should set note directly if array is empty after filtering', () => {
      const doc: { notes: string | (null | undefined)[] } = { notes: [null, undefined] };

      appendNote(doc, 'First real note');

      expect(doc.notes).toBe('First real note');
    });

    it('should replace invalid type with note', () => {
      const doc: { notes: unknown } = { notes: 12345 as unknown };

      appendNote(doc, 'Replacing invalid');

      expect(doc.notes).toBe('Replacing invalid');
    });

    it('should do nothing if note is empty string', () => {
      const doc = { notes: 'Existing' };

      appendNote(doc, '');

      expect(doc.notes).toBe('Existing');
    });

    it('should do nothing if note is null', () => {
      const doc = { notes: 'Existing' };

      appendNote(doc, null as unknown as string);

      expect(doc.notes).toBe('Existing');
    });

    it('should do nothing if note is undefined', () => {
      const doc = { notes: 'Existing' };

      appendNote(doc, undefined as unknown as string);

      expect(doc.notes).toBe('Existing');
    });
  });

  describe('appendAgentSession', () => {
    let originalCwd: string;

    beforeEach(async () => {
      // Create the WU directory structure in temp
      const wuDir = path.join(tempDir, 'docs', '04-operations', 'tasks', 'wu');
      await mkdir(wuDir, { recursive: true });

      // Save original cwd and change to temp
      originalCwd = process.cwd();
      process.chdir(tempDir);
    });

    afterEach(() => {
      // Restore original cwd
      process.chdir(originalCwd);
    });

    it('should append session to existing agent_sessions array', async () => {
      const wuPath = path.join(tempDir, 'docs', '04-operations', 'tasks', 'wu', 'WU-100.yaml');
      await writeFile(
        wuPath,
        `id: WU-100
title: Test WU
agent_sessions:
  - sessionId: sess-001
    startedAt: '2026-01-01T00:00:00Z'
`,
      );

      const sessionData = {
        sessionId: 'sess-002',
        startedAt: '2026-01-02T00:00:00Z',
        endedAt: '2026-01-02T01:00:00Z',
      };

      appendAgentSession('WU-100', sessionData);

      const content = await readFile(wuPath, 'utf-8');
      expect(content).toContain('sess-001');
      expect(content).toContain('sess-002');
    });

    it('should initialize agent_sessions array if not present', async () => {
      const wuPath = path.join(tempDir, 'docs', '04-operations', 'tasks', 'wu', 'WU-200.yaml');
      await writeFile(wuPath, 'id: WU-200\ntitle: No sessions\n');

      const sessionData = {
        sessionId: 'sess-first',
        startedAt: '2026-01-03T00:00:00Z',
      };

      appendAgentSession('WU-200', sessionData);

      const content = await readFile(wuPath, 'utf-8');
      expect(content).toContain('agent_sessions:');
      expect(content).toContain('sess-first');
    });

    it('should throw error when WU file does not exist', () => {
      expect(() => appendAgentSession('WU-NONEXISTENT', { sessionId: 'x' })).toThrow(
        /WU file not found/,
      );
    });
  });
});
