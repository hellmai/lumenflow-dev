/**
 * WU-1898: Tests for template condition evaluation in wu-spawn-prompt-builders.ts
 *
 * Validates that tryLoadTemplates() evaluates template conditions from
 * frontmatter before including templates in the result map.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TemplateContext, LoadedTemplate } from '@lumenflow/core/template-loader';

// ─── Test Constants ───
const TEST_WU_ID = 'WU-1898';
const TEST_CLIENT = 'claude-code';

// ─── Helpers ───

/**
 * Create a LoadedTemplate with the given id, condition, and content.
 */
function makeTemplate(
  id: string,
  condition: string | undefined,
  content = `Content for ${id}`,
): LoadedTemplate {
  return {
    frontmatter: {
      id,
      name: `Template ${id}`,
      required: false,
      order: 10,
      condition,
    },
    content,
    sourcePath: `/fake/${id}.md`,
  };
}

/**
 * Build a TemplateContext for a given WU type.
 */
function makeContext(type: string, extras: Record<string, string> = {}): TemplateContext {
  return {
    WU_ID: TEST_WU_ID,
    LANE: 'Framework: CLI',
    TYPE: type,
    type,
    lane: 'Framework: CLI',
    laneParent: 'Framework',
    ...extras,
  };
}

// ─── Mocks ───

// Mock loadTemplatesWithOverrides to return controlled templates
vi.mock('@lumenflow/core/template-loader', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    loadTemplatesWithOverrides: vi.fn(),
  };
});

// ─── Tests ───

describe('WU-1898: tryLoadTemplates condition evaluation', () => {
  let loadTemplatesWithOverrides: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const templateLoader = await import('@lumenflow/core/template-loader');
    loadTemplatesWithOverrides =
      templateLoader.loadTemplatesWithOverrides as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('AC1: tryLoadTemplates evaluates template conditions from frontmatter', () => {
    it('should exclude templates whose condition evaluates to false', async () => {
      const templates = new Map<string, LoadedTemplate>();
      templates.set(
        'tdd-directive',
        makeTemplate(
          'tdd-directive',
          "type !== 'documentation' && type !== 'docs' && type !== 'config'",
        ),
      );
      templates.set(
        'documentation-directive',
        makeTemplate(
          'documentation-directive',
          "type === 'documentation' || type === 'docs' || type === 'config'",
        ),
      );

      loadTemplatesWithOverrides.mockReturnValue(templates);

      const { tryLoadTemplates } = await import('../wu-spawn-prompt-builders.js');
      const context = makeContext('documentation');
      const result = tryLoadTemplates(TEST_CLIENT, context);

      // tdd-directive condition is "type !== 'documentation'" which is false for documentation
      expect(result.has('tdd-directive')).toBe(false);
      // documentation-directive condition is "type === 'documentation'" which is true
      expect(result.has('documentation-directive')).toBe(true);
    });

    it('should include templates whose condition evaluates to true', async () => {
      const templates = new Map<string, LoadedTemplate>();
      templates.set(
        'tdd-directive',
        makeTemplate(
          'tdd-directive',
          "type !== 'documentation' && type !== 'docs' && type !== 'config'",
        ),
      );

      loadTemplatesWithOverrides.mockReturnValue(templates);

      const { tryLoadTemplates } = await import('../wu-spawn-prompt-builders.js');
      const context = makeContext('feature');
      const result = tryLoadTemplates(TEST_CLIENT, context);

      expect(result.has('tdd-directive')).toBe(true);
    });

    it('should include templates with no condition (unconditional)', async () => {
      const templates = new Map<string, LoadedTemplate>();
      templates.set('effort-scaling', makeTemplate('effort-scaling', undefined));

      loadTemplatesWithOverrides.mockReturnValue(templates);

      const { tryLoadTemplates } = await import('../wu-spawn-prompt-builders.js');
      const context = makeContext('documentation');
      const result = tryLoadTemplates(TEST_CLIENT, context);

      expect(result.has('effort-scaling')).toBe(true);
    });
  });

  describe('AC2: templates.get(tdd-directive) returns undefined for documentation WUs', () => {
    it('should return undefined for documentation type', async () => {
      const templates = new Map<string, LoadedTemplate>();
      templates.set(
        'tdd-directive',
        makeTemplate(
          'tdd-directive',
          "type !== 'documentation' && type !== 'docs' && type !== 'config'",
        ),
      );

      loadTemplatesWithOverrides.mockReturnValue(templates);

      const { tryLoadTemplates } = await import('../wu-spawn-prompt-builders.js');
      const result = tryLoadTemplates(TEST_CLIENT, makeContext('documentation'));

      expect(result.get('tdd-directive')).toBeUndefined();
    });

    it('should return undefined for docs type', async () => {
      const templates = new Map<string, LoadedTemplate>();
      templates.set(
        'tdd-directive',
        makeTemplate(
          'tdd-directive',
          "type !== 'documentation' && type !== 'docs' && type !== 'config'",
        ),
      );

      loadTemplatesWithOverrides.mockReturnValue(templates);

      const { tryLoadTemplates } = await import('../wu-spawn-prompt-builders.js');
      const result = tryLoadTemplates(TEST_CLIENT, makeContext('docs'));

      expect(result.get('tdd-directive')).toBeUndefined();
    });

    it('should return undefined for config type', async () => {
      const templates = new Map<string, LoadedTemplate>();
      templates.set(
        'tdd-directive',
        makeTemplate(
          'tdd-directive',
          "type !== 'documentation' && type !== 'docs' && type !== 'config'",
        ),
      );

      loadTemplatesWithOverrides.mockReturnValue(templates);

      const { tryLoadTemplates } = await import('../wu-spawn-prompt-builders.js');
      const result = tryLoadTemplates(TEST_CLIENT, makeContext('config'));

      expect(result.get('tdd-directive')).toBeUndefined();
    });
  });

  describe('AC3: Policy-based methodology templates are condition-gated', () => {
    it('should include methodology-tdd when policy.testing is tdd', async () => {
      const templates = new Map<string, LoadedTemplate>();
      templates.set(
        'methodology-tdd',
        makeTemplate('methodology-tdd', "policy.testing === 'tdd'"),
      );

      loadTemplatesWithOverrides.mockReturnValue(templates);

      const { tryLoadTemplates } = await import('../wu-spawn-prompt-builders.js');
      const context = makeContext('feature', { 'policy.testing': 'tdd' });
      const result = tryLoadTemplates(TEST_CLIENT, context);

      expect(result.has('methodology-tdd')).toBe(true);
    });

    it('should exclude methodology-tdd when policy.testing is not tdd', async () => {
      const templates = new Map<string, LoadedTemplate>();
      templates.set(
        'methodology-tdd',
        makeTemplate('methodology-tdd', "policy.testing === 'tdd'"),
      );

      loadTemplatesWithOverrides.mockReturnValue(templates);

      const { tryLoadTemplates } = await import('../wu-spawn-prompt-builders.js');
      const context = makeContext('feature', { 'policy.testing': 'test-after' });
      const result = tryLoadTemplates(TEST_CLIENT, context);

      expect(result.has('methodology-tdd')).toBe(false);
    });

    it('should include methodology-test-after when policy.testing matches', async () => {
      const templates = new Map<string, LoadedTemplate>();
      templates.set(
        'methodology-test-after',
        makeTemplate('methodology-test-after', "policy.testing === 'test-after'"),
      );

      loadTemplatesWithOverrides.mockReturnValue(templates);

      const { tryLoadTemplates } = await import('../wu-spawn-prompt-builders.js');
      const context = makeContext('feature', { 'policy.testing': 'test-after' });
      const result = tryLoadTemplates(TEST_CLIENT, context);

      expect(result.has('methodology-test-after')).toBe(true);
    });
  });

  describe('AC4: Regression - feature type WU still gets TDD directive', () => {
    it('should include tdd-directive for feature type WU', async () => {
      const templates = new Map<string, LoadedTemplate>();
      templates.set(
        'tdd-directive',
        makeTemplate(
          'tdd-directive',
          "type !== 'documentation' && type !== 'docs' && type !== 'config'",
        ),
      );

      loadTemplatesWithOverrides.mockReturnValue(templates);

      const { tryLoadTemplates } = await import('../wu-spawn-prompt-builders.js');
      const result = tryLoadTemplates(TEST_CLIENT, makeContext('feature'));

      expect(result.has('tdd-directive')).toBe(true);
      expect(result.get('tdd-directive')).toBeDefined();
    });

    it('should include tdd-directive for bug type WU', async () => {
      const templates = new Map<string, LoadedTemplate>();
      templates.set(
        'tdd-directive',
        makeTemplate(
          'tdd-directive',
          "type !== 'documentation' && type !== 'docs' && type !== 'config'",
        ),
      );

      loadTemplatesWithOverrides.mockReturnValue(templates);

      const { tryLoadTemplates } = await import('../wu-spawn-prompt-builders.js');
      const result = tryLoadTemplates(TEST_CLIENT, makeContext('bug'));

      expect(result.has('tdd-directive')).toBe(true);
    });
  });

  describe('AC5: Regression - documentation type WU gets documentation-directive NOT tdd-directive', () => {
    it('should include documentation-directive and exclude tdd-directive for documentation type', async () => {
      const templates = new Map<string, LoadedTemplate>();
      templates.set(
        'tdd-directive',
        makeTemplate(
          'tdd-directive',
          "type !== 'documentation' && type !== 'docs' && type !== 'config'",
        ),
      );
      templates.set(
        'documentation-directive',
        makeTemplate(
          'documentation-directive',
          "type === 'documentation' || type === 'docs' || type === 'config'",
        ),
      );

      loadTemplatesWithOverrides.mockReturnValue(templates);

      const { tryLoadTemplates } = await import('../wu-spawn-prompt-builders.js');
      const result = tryLoadTemplates(TEST_CLIENT, makeContext('documentation'));

      expect(result.has('documentation-directive')).toBe(true);
      expect(result.has('tdd-directive')).toBe(false);
    });
  });

  describe('AC6: Regression - refactor type WU gets refactor-directive', () => {
    it('should include refactor-directive for refactor type WU', async () => {
      const templates = new Map<string, LoadedTemplate>();
      templates.set(
        'refactor-directive',
        makeTemplate('refactor-directive', "type === 'refactor'"),
      );

      loadTemplatesWithOverrides.mockReturnValue(templates);

      const { tryLoadTemplates } = await import('../wu-spawn-prompt-builders.js');
      const result = tryLoadTemplates(TEST_CLIENT, makeContext('refactor'));

      expect(result.has('refactor-directive')).toBe(true);
    });

    it('should exclude refactor-directive for non-refactor types', async () => {
      const templates = new Map<string, LoadedTemplate>();
      templates.set(
        'refactor-directive',
        makeTemplate('refactor-directive', "type === 'refactor'"),
      );

      loadTemplatesWithOverrides.mockReturnValue(templates);

      const { tryLoadTemplates } = await import('../wu-spawn-prompt-builders.js');
      const result = tryLoadTemplates(TEST_CLIENT, makeContext('feature'));

      expect(result.has('refactor-directive')).toBe(false);
    });
  });
});

describe('WU-1898: buildSpawnTemplateContext policy enrichment', () => {
  it('should include policy.testing in context when policy is provided', async () => {
    const { buildSpawnTemplateContext } = await import('../wu-spawn-prompt-builders.js');

    const doc = {
      title: 'Test WU',
      lane: 'Framework: CLI',
      type: 'feature',
    };

    const policy = { testing: 'tdd', architecture: 'hexagonal', coverage: 90, coverageMode: 'blocking' as const };
    const context = buildSpawnTemplateContext(doc, TEST_WU_ID, policy);

    expect(context['policy.testing']).toBe('tdd');
    expect(context['policy.architecture']).toBe('hexagonal');
  });

  it('should work without policy parameter (backward compatible)', async () => {
    const { buildSpawnTemplateContext } = await import('../wu-spawn-prompt-builders.js');

    const doc = {
      title: 'Test WU',
      lane: 'Framework: CLI',
      type: 'feature',
    };

    const context = buildSpawnTemplateContext(doc, TEST_WU_ID);

    expect(context['policy.testing']).toBeUndefined();
    expect(context.type).toBe('feature');
  });
});
