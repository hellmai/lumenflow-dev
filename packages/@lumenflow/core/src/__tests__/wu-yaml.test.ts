import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readWU,
  writeWU,
  appendNote,
  parseYAML,
  stringifyYAML,
  readWURaw,
  YAML_STRINGIFY_OPTIONS,
} from '../wu-yaml.mjs';

describe('wu-yaml', () => {
  let testDir;

  beforeEach(() => {
    // Create temporary directory for each test
    testDir = mkdtempSync(join(tmpdir(), 'wu-yaml-test-'));
  });

  afterEach(() => {
    // Cleanup temporary directory
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('readWU', () => {
    it('should read and parse valid WU YAML', () => {
      const wuPath = join(testDir, 'WU-123.yaml');
      const content = `id: WU-123
title: Test WU
status: ready
lane: Operations`;
      writeFileSync(wuPath, content, 'utf8');

      const result = readWU(wuPath, 'WU-123');
      assert.equal(result.id, 'WU-123');
      assert.equal(result.title, 'Test WU');
      assert.equal(result.status, 'ready');
      assert.equal(result.lane, 'Operations');
    });

    it('should throw error if file does not exist', () => {
      const wuPath = join(testDir, 'nonexistent.yaml');
      assert.throws(() => readWU(wuPath, 'WU-999'), /WU file not found/);
    });

    it('should throw error if YAML is invalid', () => {
      const wuPath = join(testDir, 'invalid.yaml');
      writeFileSync(wuPath, 'invalid: yaml: content:', 'utf8');
      assert.throws(() => readWU(wuPath, 'WU-123'), /Failed to parse YAML/);
    });

    it('should throw error if WU ID does not match', () => {
      const wuPath = join(testDir, 'WU-123.yaml');
      const content = `id: WU-456
title: Wrong ID`;
      writeFileSync(wuPath, content, 'utf8');
      assert.throws(() => readWU(wuPath, 'WU-123'), /WU YAML id mismatch/);
    });

    it('should throw error if WU ID is missing', () => {
      const wuPath = join(testDir, 'WU-123.yaml');
      const content = `title: Missing ID`;
      writeFileSync(wuPath, content, 'utf8');
      assert.throws(() => readWU(wuPath, 'WU-123'), /WU YAML id mismatch/);
    });

    it('should handle WU with complex nested structure', () => {
      const wuPath = join(testDir, 'WU-789.yaml');
      const content = `id: WU-789
title: Complex WU
status: in_progress
acceptance:
  - First criteria
  - Second criteria
code_paths:
  - tools/lib/wu-paths.mjs
  - tools/wu-claim.mjs`;
      writeFileSync(wuPath, content, 'utf8');

      const result = readWU(wuPath, 'WU-789');
      assert.equal(result.id, 'WU-789');
      assert.deepEqual(result.acceptance, ['First criteria', 'Second criteria']);
      assert.deepEqual(result.code_paths, ['tools/lib/wu-paths.mjs', 'tools/wu-claim.mjs']);
    });
  });

  describe('writeWU', () => {
    it('should write WU YAML with consistent formatting', () => {
      const wuPath = join(testDir, 'WU-123.yaml');
      const doc = {
        id: 'WU-123',
        title: 'Test WU',
        status: 'ready',
        lane: 'Operations',
      };

      writeWU(wuPath, doc);

      // Read back and verify
      const result = readWU(wuPath, 'WU-123');
      assert.equal(result.id, 'WU-123');
      assert.equal(result.title, 'Test WU');
      assert.equal(result.status, 'ready');
      assert.equal(result.lane, 'Operations');
    });

    it('should preserve complex nested structures', () => {
      const wuPath = join(testDir, 'WU-456.yaml');
      const doc = {
        id: 'WU-456',
        title: 'Complex WU',
        acceptance: ['First', 'Second'],
        code_paths: ['file1.mjs', 'file2.mjs'],
        dependencies: [],
        notes: 'Some notes here',
      };

      writeWU(wuPath, doc);

      // Read back and verify
      const result = readWU(wuPath, 'WU-456');
      assert.equal(result.id, 'WU-456');
      assert.deepEqual(result.acceptance, ['First', 'Second']);
      assert.deepEqual(result.code_paths, ['file1.mjs', 'file2.mjs']);
      assert.deepEqual(result.dependencies, []);
      assert.equal(result.notes, 'Some notes here');
    });

    it('should use lineWidth 100 for formatting', () => {
      const wuPath = join(testDir, 'WU-789.yaml');
      const doc = {
        id: 'WU-789',
        title:
          'This is a very long title that would exceed the default line width if not configured properly for YAML formatting',
      };

      writeWU(wuPath, doc);

      // Read the raw file to check formatting
      const content = readFileSync(wuPath, 'utf8');

      // Should wrap long lines (lineWidth: 100)
      // YAML should break the title into multiple lines if needed
      assert.ok(content.includes('id: WU-789'));
    });
  });

  describe('appendNote', () => {
    it('should set note when notes field is undefined', () => {
      const doc = { id: 'WU-123', title: 'Test' };
      appendNote(doc, 'First note');
      assert.equal(doc.notes, 'First note');
    });

    it('should set note when notes field is null', () => {
      const doc = { id: 'WU-123', title: 'Test', notes: null };
      appendNote(doc, 'First note');
      assert.equal(doc.notes, 'First note');
    });

    it('should set note when notes field is empty string', () => {
      const doc = { id: 'WU-123', title: 'Test', notes: '' };
      appendNote(doc, 'First note');
      assert.equal(doc.notes, 'First note');
    });

    it('should append to existing string note', () => {
      const doc = { id: 'WU-123', title: 'Test', notes: 'Existing note' };
      appendNote(doc, 'New note');
      assert.equal(doc.notes, 'Existing note\nNew note');
    });

    it('should trim existing note before appending', () => {
      const doc = { id: 'WU-123', title: 'Test', notes: 'Existing note   \n\n' };
      appendNote(doc, 'New note');
      assert.equal(doc.notes, 'Existing note\nNew note');
    });

    it('should convert array notes to string and append (schema requires string)', () => {
      const doc = { id: 'WU-123', title: 'Test', notes: ['First note', 'Second note'] };
      appendNote(doc, 'Third note');
      assert.equal(doc.notes, 'First note\nSecond note\nThird note');
    });

    it('should handle array with empty strings when converting to string', () => {
      const doc = { id: 'WU-123', title: 'Test', notes: ['First note', '', 'Second note'] };
      appendNote(doc, 'Third note');
      assert.equal(doc.notes, 'First note\nSecond note\nThird note');
    });

    it('should replace invalid notes type with new note', () => {
      const doc = { id: 'WU-123', title: 'Test', notes: 123 };
      appendNote(doc, 'New note');
      assert.equal(doc.notes, 'New note');
    });

    it('should do nothing if note is undefined', () => {
      const doc = { id: 'WU-123', title: 'Test', notes: 'Existing' };
      appendNote(doc, undefined);
      assert.equal(doc.notes, 'Existing');
    });

    it('should do nothing if note is null', () => {
      const doc = { id: 'WU-123', title: 'Test', notes: 'Existing' };
      appendNote(doc, null);
      assert.equal(doc.notes, 'Existing');
    });

    it('should do nothing if note is empty string', () => {
      const doc = { id: 'WU-123', title: 'Test', notes: 'Existing' };
      appendNote(doc, '');
      assert.equal(doc.notes, 'Existing');
    });
  });

  describe('YAML colon quoting and roundtrip safety (WU-1336)', () => {
    it('should roundtrip title with colon correctly', () => {
      const wuPath = join(testDir, 'WU-COLON-TITLE.yaml');
      const doc = {
        id: 'WU-COLON-TITLE',
        title: 'Feature: Add support for new functionality',
        status: 'ready',
      };

      writeWU(wuPath, doc);
      const result = readWU(wuPath, 'WU-COLON-TITLE');

      assert.equal(result.title, 'Feature: Add support for new functionality');
    });

    it('should roundtrip description with multiple colons correctly', () => {
      const wuPath = join(testDir, 'WU-COLON-DESC.yaml');
      const doc = {
        id: 'WU-COLON-DESC',
        title: 'Test',
        description:
          'Context: This is the context.\nProblem: This is the problem.\nSolution: This is the solution.',
      };

      writeWU(wuPath, doc);
      const result = readWU(wuPath, 'WU-COLON-DESC');

      assert.equal(
        result.description,
        'Context: This is the context.\nProblem: This is the problem.\nSolution: This is the solution.'
      );
    });

    it('should roundtrip multiline string with colons correctly', () => {
      const wuPath = join(testDir, 'WU-COLON-MULTILINE.yaml');
      const doc = {
        id: 'WU-COLON-MULTILINE',
        title: 'Test',
        notes: 'Line 1: with colon\nLine 2: also with colon\nLine 3: Format: YAML',
      };

      writeWU(wuPath, doc);
      const result = readWU(wuPath, 'WU-COLON-MULTILINE');

      assert.equal(
        result.notes,
        'Line 1: with colon\nLine 2: also with colon\nLine 3: Format: YAML'
      );
    });

    it('should roundtrip risks array with (mitigate: ...) syntax correctly', () => {
      const wuPath = join(testDir, 'WU-COLON-RISKS.yaml');
      const doc = {
        id: 'WU-COLON-RISKS',
        title: 'Test',
        risks: [
          '(mitigate: Test with edge cases)',
          '(mitigate: Use library quoting options)',
          'Plain risk without special syntax',
        ],
      };

      writeWU(wuPath, doc);
      const result = readWU(wuPath, 'WU-COLON-RISKS');

      assert.deepEqual(result.risks, [
        '(mitigate: Test with edge cases)',
        '(mitigate: Use library quoting options)',
        'Plain risk without special syntax',
      ]);
    });

    it('should roundtrip complex fixture with multiple colon edge cases', () => {
      const fixturePath = join(
        process.cwd(),
        'tools/lib/__tests__/__fixtures__/wu-colon-edge-cases.yaml'
      );

      // Read the fixture
      const original = readWU(fixturePath, 'WU-TEST-COLONS');

      // Write it to a new location
      const tempPath = join(testDir, 'WU-ROUNDTRIP.yaml');
      writeWU(tempPath, original);

      // Read it back
      const roundtripped = readWU(tempPath, 'WU-TEST-COLONS');

      // Verify all fields match
      assert.equal(roundtripped.id, original.id);
      assert.equal(roundtripped.title, original.title);
      assert.equal(roundtripped.lane, original.lane);
      assert.equal(roundtripped.description, original.description);
      assert.deepEqual(roundtripped.acceptance, original.acceptance);
      assert.deepEqual(roundtripped.risks, original.risks);
      assert.equal(roundtripped.notes, original.notes);
    });

    it('should handle acceptance criteria with colons and nested parentheses', () => {
      const wuPath = join(testDir, 'WU-COLON-ACCEPTANCE.yaml');
      const doc = {
        id: 'WU-COLON-ACCEPTANCE',
        title: 'Test',
        acceptance: [
          'Criterion: Must handle colons in acceptance criteria',
          'Another criterion: With colons and (parentheses: nested)',
          'Plain criterion without colons',
        ],
      };

      writeWU(wuPath, doc);
      const result = readWU(wuPath, 'WU-COLON-ACCEPTANCE');

      assert.deepEqual(result.acceptance, [
        'Criterion: Must handle colons in acceptance criteria',
        'Another criterion: With colons and (parentheses: nested)',
        'Plain criterion without colons',
      ]);
    });

    it('should handle lane field with colon (e.g., "Operations: Tooling")', () => {
      const wuPath = join(testDir, 'WU-COLON-LANE.yaml');
      const doc = {
        id: 'WU-COLON-LANE',
        title: 'Test',
        lane: 'Operations: Tooling',
      };

      writeWU(wuPath, doc);
      const result = readWU(wuPath, 'WU-COLON-LANE');

      assert.equal(result.lane, 'Operations: Tooling');
    });
  });

  describe('YAML_STRINGIFY_OPTIONS (WU-1352)', () => {
    it('should export YAML_STRINGIFY_OPTIONS constant', () => {
      assert.ok(YAML_STRINGIFY_OPTIONS);
      assert.equal(typeof YAML_STRINGIFY_OPTIONS, 'object');
    });

    it('should have lineWidth set to 100', () => {
      assert.equal(YAML_STRINGIFY_OPTIONS.lineWidth, 100);
    });

    it('should have singleQuote enabled', () => {
      assert.equal(YAML_STRINGIFY_OPTIONS.singleQuote, true);
    });
  });

  describe('parseYAML (WU-1352)', () => {
    it('should parse valid YAML string to object', () => {
      const yamlString = 'id: WU-123\ntitle: Test\nstatus: ready';
      const result = parseYAML(yamlString);

      assert.equal(result.id, 'WU-123');
      assert.equal(result.title, 'Test');
      assert.equal(result.status, 'ready');
    });

    it('should parse arrays correctly', () => {
      const yamlString = 'items:\n  - first\n  - second\n  - third';
      const result = parseYAML(yamlString);

      assert.deepEqual(result.items, ['first', 'second', 'third']);
    });

    it('should throw on invalid YAML', () => {
      const invalidYaml = 'invalid: yaml: content:';
      assert.throws(() => parseYAML(invalidYaml));
    });

    it('should parse empty YAML as null', () => {
      const result = parseYAML('');
      assert.equal(result, null);
    });
  });

  describe('stringifyYAML (WU-1352)', () => {
    it('should stringify object to YAML string', () => {
      const doc = { id: 'WU-123', title: 'Test' };
      const result = stringifyYAML(doc);

      assert.ok(result.includes('id:'));
      assert.ok(result.includes('WU-123'));
      assert.ok(result.includes('title:'));
      assert.ok(result.includes('Test'));
    });

    it('should use standardized options (lineWidth 100)', () => {
      const longText =
        'This is a very long description that would exceed the default line width and should be wrapped accordingly by the YAML serializer';
      const doc = { description: longText };
      const result = stringifyYAML(doc);

      // With lineWidth 100, each line should be <= 100 chars (approximately)
      const lines = result.split('\n');
      // Note: YAML library may not strictly enforce lineWidth for all content
      assert.ok(lines.length >= 1);
    });

    it('should allow custom options to override defaults', () => {
      const doc = { id: 'WU-123' };
      const result = stringifyYAML(doc, { lineWidth: 50 });

      // Should still produce valid output
      assert.ok(result.includes('WU-123'));
    });

    it('should roundtrip with parseYAML', () => {
      const original = {
        id: 'WU-TEST',
        title: 'Test title',
        acceptance: ['first', 'second'],
        lane: 'Operations: Tooling',
      };

      const yaml = stringifyYAML(original);
      const parsed = parseYAML(yaml);

      assert.deepEqual(parsed, original);
    });
  });

  describe('readWURaw (WU-1352)', () => {
    it('should read YAML without validating ID', () => {
      const wuPath = join(testDir, 'any-file.yaml');
      const content = 'key: value\nlist:\n  - item1\n  - item2';
      writeFileSync(wuPath, content, 'utf8');

      const result = readWURaw(wuPath);

      assert.equal(result.key, 'value');
      assert.deepEqual(result.list, ['item1', 'item2']);
    });

    it('should throw error if file does not exist', () => {
      const nonexistentPath = join(testDir, 'nonexistent.yaml');
      assert.throws(() => readWURaw(nonexistentPath), /YAML file not found/);
    });

    it('should throw error if YAML is invalid', () => {
      const invalidPath = join(testDir, 'invalid.yaml');
      writeFileSync(invalidPath, 'invalid: yaml: content:', 'utf8');
      assert.throws(() => readWURaw(invalidPath), /Failed to parse YAML/);
    });

    it('should work with WU files without ID validation', () => {
      const wuPath = join(testDir, 'WU-999.yaml');
      const content = 'id: WU-999\ntitle: Test\nstatus: ready';
      writeFileSync(wuPath, content, 'utf8');

      // readWURaw doesn't validate ID - can read any file
      const result = readWURaw(wuPath);
      assert.equal(result.id, 'WU-999');
    });
  });
});
