/**
 * Template Loader Tests (WU-1253)
 *
 * Tests for loading, parsing, and assembling prompt templates from
 * .lumenflow/templates/ directory with YAML frontmatter support.
 *
 * TDD: These tests are written first (RED phase) before implementation.
 */

 

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Import functions under test - these will fail initially (RED)
import {
  loadManifest,
  loadTemplate,
  loadTemplatesWithOverrides,
  assembleTemplates,
  replaceTokens,
  evaluateCondition,
  type TemplateManifest,
  type LoadedTemplate,
  type TemplateContext,
} from '../template-loader.js';

// Test constant for commonly used path
const MANIFEST_PATH = '.lumenflow/templates/manifest.yaml';

/**
 * Test fixture helpers
 */
function createTestDir(): string {
  const testDir = join(tmpdir(), `template-loader-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  return testDir;
}

function cleanupTestDir(testDir: string): void {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
}

function writeTestFile(testDir: string, relativePath: string, content: string): void {
  const fullPath = join(testDir, relativePath);
  const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');
}

describe('template-loader (WU-1253)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  describe('loadManifest', () => {
    it('should parse valid manifest.yaml with all required fields', () => {
      const manifestContent = `
version: "1.0"
defaults:
  tokenFormat: "{TOKEN}"
templates:
  - id: tdd-directive
    path: spawn-prompt/tdd-directive.md
    required: true
    order: 10
  - id: constraints
    path: spawn-prompt/constraints.md
    required: true
    order: 1000
`;
      writeTestFile(testDir, MANIFEST_PATH, manifestContent);

      const manifest = loadManifest(testDir);

      expect(manifest.version).toBe('1.0');
      expect(manifest.defaults.tokenFormat).toBe('{TOKEN}');
      expect(manifest.templates).toHaveLength(2);
      expect(manifest.templates[0].id).toBe('tdd-directive');
      expect(manifest.templates[0].required).toBe(true);
      expect(manifest.templates[0].order).toBe(10);
    });

    it('should throw descriptive error if manifest.yaml is missing', () => {
      expect(() => loadManifest(testDir)).toThrow(/manifest\.yaml not found/i);
    });

    it('should throw if manifest has invalid YAML syntax', () => {
      writeTestFile(testDir, MANIFEST_PATH, 'invalid: yaml: syntax:');

      expect(() => loadManifest(testDir)).toThrow(/failed to parse/i);
    });

    it('should throw if manifest is missing required version field', () => {
      const manifestContent = `
templates:
  - id: test
    path: test.md
    required: true
    order: 10
`;
      writeTestFile(testDir, MANIFEST_PATH, manifestContent);

      expect(() => loadManifest(testDir)).toThrow(/version.*required/i);
    });

    it('should throw if template entry is missing required fields', () => {
      const manifestContent = `
version: "1.0"
templates:
  - id: incomplete
    path: test.md
    # missing required and order
`;
      writeTestFile(testDir, MANIFEST_PATH, manifestContent);

      expect(() => loadManifest(testDir)).toThrow(/required.*order/i);
    });
  });

  describe('loadTemplate', () => {
    it('should parse frontmatter using gray-matter', () => {
      const templateContent = `---
id: tdd-directive
name: TDD Directive
required: true
order: 10
tokens: [WU_ID, LANE]
---

## TDD DIRECTIVE

Follow test-driven development.
`;
      writeTestFile(testDir, 'templates/tdd-directive.md', templateContent);

      const template = loadTemplate(join(testDir, 'templates/tdd-directive.md'));

      expect(template.frontmatter.id).toBe('tdd-directive');
      expect(template.frontmatter.name).toBe('TDD Directive');
      expect(template.frontmatter.required).toBe(true);
      expect(template.frontmatter.order).toBe(10);
      expect(template.frontmatter.tokens).toEqual(['WU_ID', 'LANE']);
      expect(template.content).toContain('## TDD DIRECTIVE');
      expect(template.content).toContain('Follow test-driven development.');
    });

    it('should extract content without frontmatter markers', () => {
      const templateContent = `---
id: test
name: Test
required: true
order: 1
---

Content here.
`;
      writeTestFile(testDir, 'templates/test.md', templateContent);

      const template = loadTemplate(join(testDir, 'templates/test.md'));

      expect(template.content).not.toContain('---');
      expect(template.content.trim()).toBe('Content here.');
    });

    it('should throw if template file is missing', () => {
      expect(() => loadTemplate(join(testDir, 'nonexistent.md'))).toThrow(/not found/i);
    });

    it('should throw if frontmatter is missing required id field', () => {
      const templateContent = `---
name: Missing ID
required: true
order: 1
---

Content.
`;
      writeTestFile(testDir, 'templates/bad.md', templateContent);

      expect(() => loadTemplate(join(testDir, 'templates/bad.md'))).toThrow(/id.*required/i);
    });

    it('should set sourcePath for debugging', () => {
      const templateContent = `---
id: test
name: Test
required: true
order: 1
---

Content.
`;
      const filePath = join(testDir, 'templates/test.md');
      writeTestFile(testDir, 'templates/test.md', templateContent);

      const template = loadTemplate(filePath);

      expect(template.sourcePath).toBe(filePath);
    });

    it('should handle templates with optional condition field', () => {
      const templateContent = `---
id: conditional
name: Conditional Template
required: false
order: 50
condition: "type === 'feature'"
---

Feature-only content.
`;
      writeTestFile(testDir, 'templates/conditional.md', templateContent);

      const template = loadTemplate(join(testDir, 'templates/conditional.md'));

      expect(template.frontmatter.condition).toBe("type === 'feature'");
    });
  });

  describe('loadTemplatesWithOverrides', () => {
    it('should load base templates from templates/spawn-prompt/', () => {
      writeTestFile(
        testDir,
        '.lumenflow/templates/spawn-prompt/tdd.md',
        `---
id: tdd
name: TDD
required: true
order: 10
---

Base TDD content.
`,
      );

      const templates = loadTemplatesWithOverrides(testDir, 'claude-code');

      expect(templates.has('tdd')).toBe(true);
      expect(templates.get('tdd')?.content).toContain('Base TDD content');
    });

    it('should override with client-specific templates (templates.{client}/)', () => {
      // Base template
      writeTestFile(
        testDir,
        '.lumenflow/templates/spawn-prompt/skills.md',
        `---
id: skills
name: Skills Selection
required: true
order: 100
---

Generic skills guidance.
`,
      );

      // Claude-specific override
      writeTestFile(
        testDir,
        '.lumenflow/templates.claude/spawn-prompt/skills.md',
        `---
id: skills
name: Skills Selection
required: true
order: 100
---

Load skills with /skill <name> command.
`,
      );

      const templates = loadTemplatesWithOverrides(testDir, 'claude');

      expect(templates.get('skills')?.content).toContain('/skill <name>');
      expect(templates.get('skills')?.content).not.toContain('Generic skills');
    });

    it('should fall back to base template if client override is missing', () => {
      writeTestFile(
        testDir,
        '.lumenflow/templates/spawn-prompt/constraints.md',
        `---
id: constraints
name: Constraints
required: true
order: 1000
---

Base constraints.
`,
      );

      // No cursor override exists
      const templates = loadTemplatesWithOverrides(testDir, 'cursor');

      expect(templates.get('constraints')?.content).toContain('Base constraints');
    });

    it('should merge client overrides with base templates (not replace all)', () => {
      // Two base templates
      writeTestFile(
        testDir,
        '.lumenflow/templates/spawn-prompt/tdd.md',
        `---
id: tdd
name: TDD
required: true
order: 10
---

TDD content.
`,
      );
      writeTestFile(
        testDir,
        '.lumenflow/templates/spawn-prompt/constraints.md',
        `---
id: constraints
name: Constraints
required: true
order: 1000
---

Constraints content.
`,
      );

      // Only override tdd for claude
      writeTestFile(
        testDir,
        '.lumenflow/templates.claude/spawn-prompt/tdd.md',
        `---
id: tdd
name: TDD
required: true
order: 10
---

Claude TDD content.
`,
      );

      const templates = loadTemplatesWithOverrides(testDir, 'claude');

      // tdd should be overridden
      expect(templates.get('tdd')?.content).toContain('Claude TDD');
      // constraints should be base (not removed)
      expect(templates.get('constraints')?.content).toContain('Constraints content');
    });

    it('should handle missing client override directory gracefully', () => {
      writeTestFile(
        testDir,
        '.lumenflow/templates/spawn-prompt/test.md',
        `---
id: test
name: Test
required: true
order: 1
---

Test content.
`,
      );

      // No templates.nonexistent/ directory
      const templates = loadTemplatesWithOverrides(testDir, 'nonexistent');

      expect(templates.has('test')).toBe(true);
    });
  });

  describe('assembleTemplates', () => {
    it('should assemble templates in manifest order (ascending)', () => {
      const templates = new Map<string, LoadedTemplate>([
        [
          'last',
          {
            frontmatter: { id: 'last', name: 'Last', required: true, order: 100 },
            content: 'LAST',
            sourcePath: '/test/last.md',
          },
        ],
        [
          'first',
          {
            frontmatter: { id: 'first', name: 'First', required: true, order: 10 },
            content: 'FIRST',
            sourcePath: '/test/first.md',
          },
        ],
        [
          'middle',
          {
            frontmatter: { id: 'middle', name: 'Middle', required: true, order: 50 },
            content: 'MIDDLE',
            sourcePath: '/test/middle.md',
          },
        ],
      ]);

      const manifest: TemplateManifest = {
        version: '1.0',
        defaults: { tokenFormat: '{TOKEN}' },
        templates: [
          { id: 'first', path: 'first.md', required: true, order: 10 },
          { id: 'middle', path: 'middle.md', required: true, order: 50 },
          { id: 'last', path: 'last.md', required: true, order: 100 },
        ],
      };

      const context: TemplateContext = { WU_ID: 'WU-TEST', LANE: 'Test', TYPE: 'feature' };

      const result = assembleTemplates(templates, manifest, context);

      const firstIndex = result.indexOf('FIRST');
      const middleIndex = result.indexOf('MIDDLE');
      const lastIndex = result.indexOf('LAST');

      expect(firstIndex).toBeLessThan(middleIndex);
      expect(middleIndex).toBeLessThan(lastIndex);
    });

    it('should skip optional templates that are missing', () => {
      const templates = new Map<string, LoadedTemplate>([
        [
          'required-one',
          {
            frontmatter: { id: 'required-one', name: 'R1', required: true, order: 10 },
            content: 'REQUIRED',
            sourcePath: '/test/r1.md',
          },
        ],
      ]);

      const manifest: TemplateManifest = {
        version: '1.0',
        defaults: { tokenFormat: '{TOKEN}' },
        templates: [
          { id: 'required-one', path: 'r1.md', required: true, order: 10 },
          { id: 'optional-missing', path: 'opt.md', required: false, order: 20 },
        ],
      };

      const context: TemplateContext = { WU_ID: 'WU-TEST', LANE: 'Test', TYPE: 'feature' };

      // Should not throw - optional templates can be missing
      const result = assembleTemplates(templates, manifest, context);

      expect(result).toContain('REQUIRED');
    });

    it('should throw if required template is missing', () => {
      const templates = new Map<string, LoadedTemplate>();

      const manifest: TemplateManifest = {
        version: '1.0',
        defaults: { tokenFormat: '{TOKEN}' },
        templates: [{ id: 'required-missing', path: 'req.md', required: true, order: 10 }],
      };

      const context: TemplateContext = { WU_ID: 'WU-TEST', LANE: 'Test', TYPE: 'feature' };

      expect(() => assembleTemplates(templates, manifest, context)).toThrow(
        /required template.*required-missing.*missing/i,
      );
    });

    it('should evaluate conditions and skip non-matching templates', () => {
      const templates = new Map<string, LoadedTemplate>([
        [
          'feature-only',
          {
            frontmatter: {
              id: 'feature-only',
              name: 'Feature',
              required: false,
              order: 10,
              condition: "type === 'feature'",
            },
            content: 'FEATURE CONTENT',
            sourcePath: '/test/feature.md',
          },
        ],
        [
          'docs-only',
          {
            frontmatter: {
              id: 'docs-only',
              name: 'Docs',
              required: false,
              order: 20,
              condition: "type === 'documentation'",
            },
            content: 'DOCS CONTENT',
            sourcePath: '/test/docs.md',
          },
        ],
      ]);

      const manifest: TemplateManifest = {
        version: '1.0',
        defaults: { tokenFormat: '{TOKEN}' },
        templates: [
          {
            id: 'feature-only',
            path: 'feature.md',
            required: false,
            order: 10,
            condition: "type === 'feature'",
          },
          {
            id: 'docs-only',
            path: 'docs.md',
            required: false,
            order: 20,
            condition: "type === 'documentation'",
          },
        ],
      };

      const context: TemplateContext = { WU_ID: 'WU-TEST', LANE: 'Test', TYPE: 'feature' };

      const result = assembleTemplates(templates, manifest, context);

      expect(result).toContain('FEATURE CONTENT');
      expect(result).not.toContain('DOCS CONTENT');
    });

    it('should replace {TOKEN} placeholders with context values', () => {
      const templates = new Map<string, LoadedTemplate>([
        [
          'with-tokens',
          {
            frontmatter: {
              id: 'with-tokens',
              name: 'Tokens',
              required: true,
              order: 10,
              tokens: ['WU_ID', 'LANE'],
            },
            content: 'Working on {WU_ID} in lane {LANE}.',
            sourcePath: '/test/tokens.md',
          },
        ],
      ]);

      const manifest: TemplateManifest = {
        version: '1.0',
        defaults: { tokenFormat: '{TOKEN}' },
        templates: [{ id: 'with-tokens', path: 'tokens.md', required: true, order: 10 }],
      };

      const context: TemplateContext = {
        WU_ID: 'WU-1253',
        LANE: 'Framework: Core',
        TYPE: 'feature',
      };

      const result = assembleTemplates(templates, manifest, context);

      expect(result).toContain('Working on WU-1253 in lane Framework: Core.');
      expect(result).not.toContain('{WU_ID}');
      expect(result).not.toContain('{LANE}');
    });

    it('should add section separators between templates', () => {
      const templates = new Map<string, LoadedTemplate>([
        [
          'first',
          {
            frontmatter: { id: 'first', name: 'First', required: true, order: 10 },
            content: 'First content',
            sourcePath: '/test/first.md',
          },
        ],
        [
          'second',
          {
            frontmatter: { id: 'second', name: 'Second', required: true, order: 20 },
            content: 'Second content',
            sourcePath: '/test/second.md',
          },
        ],
      ]);

      const manifest: TemplateManifest = {
        version: '1.0',
        defaults: { tokenFormat: '{TOKEN}' },
        templates: [
          { id: 'first', path: 'first.md', required: true, order: 10 },
          { id: 'second', path: 'second.md', required: true, order: 20 },
        ],
      };

      const context: TemplateContext = { WU_ID: 'WU-TEST', LANE: 'Test', TYPE: 'feature' };

      const result = assembleTemplates(templates, manifest, context);

      // Should have separator between sections (templates joined with \n\n)
      expect(result).toContain('First content');
      expect(result).toContain('Second content');
      expect(result.indexOf('First content')).toBeLessThan(result.indexOf('Second content'));
    });
  });

  describe('replaceTokens', () => {
    it('should replace {WU_ID} with actual WU ID', () => {
      const content = 'Complete {WU_ID} verification.';
      const tokens = { WU_ID: 'WU-1253' };

      const result = replaceTokens(content, tokens);

      expect(result).toBe('Complete WU-1253 verification.');
    });

    it('should replace {LANE} with lane name', () => {
      const content = 'Lane: {LANE}';
      const tokens = { LANE: 'Framework: Core' };

      const result = replaceTokens(content, tokens);

      expect(result).toBe('Lane: Framework: Core');
    });

    it('should replace multiple tokens in same content', () => {
      const content = '{WU_ID} in {LANE} is a {TYPE}.';
      const tokens = { WU_ID: 'WU-1253', LANE: 'Core', TYPE: 'feature' };

      const result = replaceTokens(content, tokens);

      expect(result).toBe('WU-1253 in Core is a feature.');
    });

    it('should replace multiple occurrences of same token', () => {
      const content = '{WU_ID} started. {WU_ID} completed.';
      const tokens = { WU_ID: 'WU-1253' };

      const result = replaceTokens(content, tokens);

      expect(result).toBe('WU-1253 started. WU-1253 completed.');
    });

    it('should leave unmatched {TOKENS} unchanged', () => {
      const content = 'Known: {WU_ID}. Unknown: {UNKNOWN}.';
      const tokens = { WU_ID: 'WU-1253' };

      const result = replaceTokens(content, tokens);

      expect(result).toBe('Known: WU-1253. Unknown: {UNKNOWN}.');
    });

    it('should handle empty tokens object', () => {
      const content = 'No tokens here.';
      const tokens = {};

      const result = replaceTokens(content, tokens);

      expect(result).toBe('No tokens here.');
    });

    it('should handle special characters in token values', () => {
      const content = 'Path: {WORKTREE_PATH}';
      const tokens = { WORKTREE_PATH: 'worktrees/lane-wu-1253' };

      const result = replaceTokens(content, tokens);

      expect(result).toBe('Path: worktrees/lane-wu-1253');
    });
  });

  describe('evaluateCondition', () => {
    it('should evaluate simple equality (===)', () => {
      const context = { type: 'feature', lane: 'Core' };

      expect(evaluateCondition("type === 'feature'", context)).toBe(true);
      expect(evaluateCondition("type === 'documentation'", context)).toBe(false);
    });

    it('should evaluate inequality (!==)', () => {
      const context = { type: 'feature', lane: 'Core' };

      expect(evaluateCondition("type !== 'documentation'", context)).toBe(true);
      expect(evaluateCondition("type !== 'feature'", context)).toBe(false);
    });

    it('should evaluate truthy checks', () => {
      const contextWithPath = { type: 'feature', worktreePath: '/path/to/worktree' };
      const contextWithoutPath = { type: 'feature', worktreePath: '' };

      expect(evaluateCondition('worktreePath', contextWithPath)).toBe(true);
      expect(evaluateCondition('worktreePath', contextWithoutPath)).toBe(false);
    });

    it('should handle && operator', () => {
      const context = { type: 'feature', lane: 'Core' };

      expect(evaluateCondition("type === 'feature' && lane === 'Core'", context)).toBe(true);
      expect(evaluateCondition("type === 'feature' && lane === 'Ops'", context)).toBe(false);
    });

    it('should handle || operator', () => {
      const context = { type: 'documentation', lane: 'Core' };

      expect(evaluateCondition("type === 'feature' || type === 'documentation'", context)).toBe(
        true,
      );
      expect(evaluateCondition("type === 'feature' || type === 'bug'", context)).toBe(false);
    });

    it('should return true for empty/undefined condition', () => {
      const context = { type: 'feature' };

      expect(evaluateCondition('', context)).toBe(true);
      expect(evaluateCondition(undefined as unknown as string, context)).toBe(true);
    });

    it('should handle laneParent extraction', () => {
      const context = { type: 'feature', lane: 'Framework: Core', laneParent: 'Framework' };

      expect(evaluateCondition("laneParent === 'Framework'", context)).toBe(true);
      expect(evaluateCondition("laneParent === 'Operations'", context)).toBe(false);
    });

    it('should evaluate policy.testing conditions for methodology templates (WU-1260)', () => {
      const tddContext = { type: 'feature', 'policy.testing': 'tdd' };
      const testAfterContext = { type: 'feature', 'policy.testing': 'test-after' };
      const noneContext = { type: 'feature', 'policy.testing': 'none' };

      // TDD template condition
      const tddCondition = "policy.testing === 'tdd'";
      expect(evaluateCondition(tddCondition, tddContext)).toBe(true);
      expect(evaluateCondition(tddCondition, testAfterContext)).toBe(false);
      expect(evaluateCondition(tddCondition, noneContext)).toBe(false);

      // test-after template condition
      const testAfterCondition = "policy.testing === 'test-after'";
      expect(evaluateCondition(testAfterCondition, tddContext)).toBe(false);
      expect(evaluateCondition(testAfterCondition, testAfterContext)).toBe(true);
      expect(evaluateCondition(testAfterCondition, noneContext)).toBe(false);

      // none template condition
      const noneCondition = "policy.testing === 'none'";
      expect(evaluateCondition(noneCondition, tddContext)).toBe(false);
      expect(evaluateCondition(noneCondition, testAfterContext)).toBe(false);
      expect(evaluateCondition(noneCondition, noneContext)).toBe(true);
    });

    it('should evaluate policy.architecture conditions for architecture templates (WU-1260)', () => {
      const hexContext = { type: 'feature', 'policy.architecture': 'hexagonal' };
      const layeredContext = { type: 'feature', 'policy.architecture': 'layered' };
      const noneContext = { type: 'feature', 'policy.architecture': 'none' };

      // Hexagonal template condition
      const hexCondition = "policy.architecture === 'hexagonal'";
      expect(evaluateCondition(hexCondition, hexContext)).toBe(true);
      expect(evaluateCondition(hexCondition, layeredContext)).toBe(false);
      expect(evaluateCondition(hexCondition, noneContext)).toBe(false);

      // Layered template condition
      const layeredCondition = "policy.architecture === 'layered'";
      expect(evaluateCondition(layeredCondition, hexContext)).toBe(false);
      expect(evaluateCondition(layeredCondition, layeredContext)).toBe(true);
      expect(evaluateCondition(layeredCondition, noneContext)).toBe(false);

      // None template condition
      const noneCondition = "policy.architecture === 'none'";
      expect(evaluateCondition(noneCondition, hexContext)).toBe(false);
      expect(evaluateCondition(noneCondition, layeredContext)).toBe(false);
      expect(evaluateCondition(noneCondition, noneContext)).toBe(true);
    });
  });

  describe('methodology templates (WU-1260)', () => {
    it('should load methodology templates from methodology/ subdirectory', () => {
      // Create methodology templates
      writeTestFile(
        testDir,
        '.lumenflow/templates/spawn-prompt/methodology/tdd-directive.md',
        `---
id: methodology-tdd
name: TDD Directive
required: false
order: 10
condition: "policy.testing === 'tdd'"
---

## TDD DIRECTIVE

Test-first workflow.
`,
      );

      writeTestFile(
        testDir,
        '.lumenflow/templates/spawn-prompt/methodology/test-after-directive.md',
        `---
id: methodology-test-after
name: Test After Directive
required: false
order: 10
condition: "policy.testing === 'test-after'"
---

## TEST AFTER DIRECTIVE

Implementation-first workflow.
`,
      );

      writeTestFile(
        testDir,
        '.lumenflow/templates/spawn-prompt/methodology/none-directive.md',
        `---
id: methodology-none
name: No Testing Directive
required: false
order: 10
condition: "policy.testing === 'none'"
---

## MINIMAL TESTING GUIDANCE

No specific testing methodology enforced.
`,
      );

      const templates = loadTemplatesWithOverrides(testDir, 'test-client');

      expect(templates.has('methodology-tdd')).toBe(true);
      expect(templates.has('methodology-test-after')).toBe(true);
      expect(templates.has('methodology-none')).toBe(true);

      expect(templates.get('methodology-tdd')?.content).toContain('Test-first workflow');
      expect(templates.get('methodology-test-after')?.content).toContain('Implementation-first');
      expect(templates.get('methodology-none')?.content).toContain('No specific testing');
    });

    it('should select correct methodology template based on policy.testing', () => {
      // Create methodology templates
      writeTestFile(
        testDir,
        '.lumenflow/templates/spawn-prompt/methodology/tdd-directive.md',
        `---
id: methodology-tdd
name: TDD Directive
required: false
order: 10
---

TDD CONTENT
`,
      );

      writeTestFile(
        testDir,
        '.lumenflow/templates/spawn-prompt/methodology/test-after-directive.md',
        `---
id: methodology-test-after
name: Test After Directive
required: false
order: 10
---

TEST-AFTER CONTENT
`,
      );

      const templates = loadTemplatesWithOverrides(testDir, 'test-client');

      const manifest: TemplateManifest = {
        version: '1.0',
        defaults: { tokenFormat: '{TOKEN}' },
        templates: [
          {
            id: 'methodology-tdd',
            path: 'spawn-prompt/methodology/tdd-directive.md',
            required: false,
            order: 10,
            condition: "policy.testing === 'tdd'",
          },
          {
            id: 'methodology-test-after',
            path: 'spawn-prompt/methodology/test-after-directive.md',
            required: false,
            order: 10,
            condition: "policy.testing === 'test-after'",
          },
        ],
      };

      // With TDD policy
      const tddContext: TemplateContext = {
        WU_ID: 'WU-TEST',
        LANE: 'Test',
        TYPE: 'feature',
        'policy.testing': 'tdd',
      };
      const tddResult = assembleTemplates(templates, manifest, tddContext);
      expect(tddResult).toContain('TDD CONTENT');
      expect(tddResult).not.toContain('TEST-AFTER CONTENT');

      // With test-after policy
      const testAfterContext: TemplateContext = {
        WU_ID: 'WU-TEST',
        LANE: 'Test',
        TYPE: 'feature',
        'policy.testing': 'test-after',
      };
      const testAfterResult = assembleTemplates(templates, manifest, testAfterContext);
      expect(testAfterResult).toContain('TEST-AFTER CONTENT');
      expect(testAfterResult).not.toContain('TDD CONTENT');
    });
  });

  describe('architecture templates (WU-1260)', () => {
    it('should load architecture templates from architecture/ subdirectory', () => {
      // Create architecture templates
      writeTestFile(
        testDir,
        '.lumenflow/templates/spawn-prompt/architecture/hexagonal-directive.md',
        `---
id: architecture-hexagonal
name: Hexagonal Architecture Directive
required: false
order: 15
condition: "policy.architecture === 'hexagonal'"
---

## HEXAGONAL ARCHITECTURE

Ports-first design.
`,
      );

      writeTestFile(
        testDir,
        '.lumenflow/templates/spawn-prompt/architecture/layered-directive.md',
        `---
id: architecture-layered
name: Layered Architecture Directive
required: false
order: 15
condition: "policy.architecture === 'layered'"
---

## LAYERED ARCHITECTURE

Traditional layers.
`,
      );

      writeTestFile(
        testDir,
        '.lumenflow/templates/spawn-prompt/architecture/none-directive.md',
        `---
id: architecture-none
name: No Architecture Directive
required: false
order: 15
condition: "policy.architecture === 'none'"
---

## MINIMAL ARCHITECTURE GUIDANCE

No specific architecture enforced.
`,
      );

      const templates = loadTemplatesWithOverrides(testDir, 'test-client');

      expect(templates.has('architecture-hexagonal')).toBe(true);
      expect(templates.has('architecture-layered')).toBe(true);
      expect(templates.has('architecture-none')).toBe(true);

      expect(templates.get('architecture-hexagonal')?.content).toContain('Ports-first design');
      expect(templates.get('architecture-layered')?.content).toContain('Traditional layers');
      expect(templates.get('architecture-none')?.content).toContain('No specific architecture');
    });

    it('should select correct architecture template based on policy.architecture', () => {
      // Create architecture templates
      writeTestFile(
        testDir,
        '.lumenflow/templates/spawn-prompt/architecture/hexagonal-directive.md',
        `---
id: architecture-hexagonal
name: Hexagonal Directive
required: false
order: 15
---

HEXAGONAL CONTENT
`,
      );

      writeTestFile(
        testDir,
        '.lumenflow/templates/spawn-prompt/architecture/layered-directive.md',
        `---
id: architecture-layered
name: Layered Directive
required: false
order: 15
---

LAYERED CONTENT
`,
      );

      const templates = loadTemplatesWithOverrides(testDir, 'test-client');

      const manifest: TemplateManifest = {
        version: '1.0',
        defaults: { tokenFormat: '{TOKEN}' },
        templates: [
          {
            id: 'architecture-hexagonal',
            path: 'spawn-prompt/architecture/hexagonal-directive.md',
            required: false,
            order: 15,
            condition: "policy.architecture === 'hexagonal'",
          },
          {
            id: 'architecture-layered',
            path: 'spawn-prompt/architecture/layered-directive.md',
            required: false,
            order: 15,
            condition: "policy.architecture === 'layered'",
          },
        ],
      };

      // With hexagonal policy
      const hexContext: TemplateContext = {
        WU_ID: 'WU-TEST',
        LANE: 'Test',
        TYPE: 'feature',
        'policy.architecture': 'hexagonal',
      };
      const hexResult = assembleTemplates(templates, manifest, hexContext);
      expect(hexResult).toContain('HEXAGONAL CONTENT');
      expect(hexResult).not.toContain('LAYERED CONTENT');

      // With layered policy
      const layeredContext: TemplateContext = {
        WU_ID: 'WU-TEST',
        LANE: 'Test',
        TYPE: 'feature',
        'policy.architecture': 'layered',
      };
      const layeredResult = assembleTemplates(templates, manifest, layeredContext);
      expect(layeredResult).toContain('LAYERED CONTENT');
      expect(layeredResult).not.toContain('HEXAGONAL CONTENT');
    });
  });
});
