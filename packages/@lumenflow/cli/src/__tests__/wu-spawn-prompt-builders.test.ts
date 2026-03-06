// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-1898: Tests for template condition evaluation in wu-spawn-prompt-builders.ts
 *
 * Validates that tryLoadTemplates() evaluates template conditions from
 * frontmatter before including templates in the result map.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SpawnStrategy } from '@lumenflow/core/spawn-strategy';
import { LumenFlowConfigSchema } from '@lumenflow/core/config-schema';
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
function makeContext(
  type: string,
  extras: Record<string, string | undefined> = {},
): TemplateContext {
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
    loadTemplatesWithOverrides = templateLoader.loadTemplatesWithOverrides as ReturnType<
      typeof vi.fn
    >;
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
      templates.set('methodology-tdd', makeTemplate('methodology-tdd', "policy.testing === 'tdd'"));

      loadTemplatesWithOverrides.mockReturnValue(templates);

      const { tryLoadTemplates } = await import('../wu-spawn-prompt-builders.js');
      const context = makeContext('feature', { 'policy.testing': 'tdd' });
      const result = tryLoadTemplates(TEST_CLIENT, context);

      expect(result.has('methodology-tdd')).toBe(true);
    });

    it('should exclude methodology-tdd when policy.testing is not tdd', async () => {
      const templates = new Map<string, LoadedTemplate>();
      templates.set('methodology-tdd', makeTemplate('methodology-tdd', "policy.testing === 'tdd'"));

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

    it('excludes default methodology-tdd template for UI-domain work when real templates load', async () => {
      const templateLoader = await import('@lumenflow/core/template-loader');
      const mockLoad = templateLoader.loadTemplatesWithOverrides as ReturnType<typeof vi.fn>;
      const actualTemplateLoader = await vi.importActual<
        typeof import('@lumenflow/core/template-loader')
      >('@lumenflow/core/template-loader');

      mockLoad.mockImplementation((baseDir: string, clientName: string) =>
        actualTemplateLoader.loadTemplatesWithOverrides(baseDir, clientName),
      );

      const { tryLoadTemplates } = await import('../wu-spawn-prompt-builders.js');
      const context = makeContext('feature', {
        'policy.testing': 'tdd',
        'work.domain': 'ui',
        'work.testMethodologyHint': '',
      });
      const result = tryLoadTemplates(TEST_CLIENT, context);

      expect(result.has('methodology-tdd')).toBe(false);
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

    const policy = {
      testing: 'tdd',
      architecture: 'hexagonal',
      coverage: 90,
      coverageMode: 'blocking' as const,
    };
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

  it('should include work classification and required verification tokens', async () => {
    const { buildSpawnTemplateContext } = await import('../wu-spawn-prompt-builders.js');

    const doc = {
      title: 'UI verification',
      lane: 'Experience: Sidekick',
      type: 'feature',
      tests: {
        unit: ['src/__tests__/slug.test.ts'],
        e2e: ['e2e/mcp-servers.spec.ts'],
        manual: ['Verify empty state and form flow'],
      },
    };

    const policy = {
      testing: 'tdd',
      architecture: 'hexagonal',
      coverage: 90,
      coverageMode: 'blocking' as const,
    };
    const classification = {
      domain: 'ui',
      confidence: 1,
      signals: [],
      capabilities: ['ui-design-awareness'],
      testMethodologyHint: 'smoke-test' as const,
    };

    const context = buildSpawnTemplateContext(doc, TEST_WU_ID, policy, classification);

    expect(context['work.domain']).toBe('ui');
    expect(context['work.testMethodologyHint']).toBe('smoke-test');
    expect(context.hasRequiredVerification).toBe('true');
    expect(context.REQUIRED_VERIFICATION).toContain('### Unit Test Paths');
    expect(context.REQUIRED_VERIFICATION).toContain('e2e/mcp-servers.spec.ts');
    expect(context.REQUIRED_VERIFICATION).toContain('Verify empty state and form flow');
  });
});

describe('WU-2058: completion workflow prompt hardening', () => {
  const testWuId = 'WU-2058';

  it('requires status verification before wu:done', async () => {
    const { generateCompletionWorkflowSection } = await import('../wu-spawn-prompt-builders.js');

    const section = generateCompletionWorkflowSection(testWuId);

    expect(section).toContain(`pnpm wu:status --id ${testWuId}`);
    expect(section).toContain('If status is `done`');
    expect(section).toContain(`do NOT run \`pnpm wu:done --id ${testWuId}\``);
    expect(section).toContain(`do NOT run \`pnpm wu:recover --id ${testWuId}\``);
    expect(section).toContain('If status is `in_progress`, continue autonomously');
  });

  it('keeps the builder output in sync with the shared completion generator', async () => {
    const builders = await import('../wu-spawn-prompt-builders.js');
    const completion = await import('../wu-spawn-completion.js');

    expect(builders.generateCompletionWorkflowSection(testWuId)).toBe(
      completion.generateCompletionWorkflowSection(testWuId),
    );
  });
});

describe('WU-2098: prompt path configuration awareness', () => {
  const id = 'WU-2098';
  const strategy: SpawnStrategy = {
    getPreamble: () => 'Load context preamble',
    getSkillLoadingInstruction: () => 'Load skills instruction',
  };

  const baseDoc = {
    title: 'Path-aware prompt',
    lane: 'Framework: CLI',
    type: 'feature',
    status: 'in_progress',
    code_paths: ['packages/@lumenflow/cli/src/wu-brief.ts'],
    acceptance: ['Prompt reflects configured paths'],
    description: 'Validate prompt path hints',
  };

  it('uses default worktrees hint when no override is configured', async () => {
    const { generateCodexPrompt } = await import('../wu-spawn-prompt-builders.js');

    const config = LumenFlowConfigSchema.parse({
      directories: {
        skillsDir: '.claude/skills',
        agentsDir: '.claude/agents',
      },
    });

    const prompt = generateCodexPrompt(baseDoc, id, strategy, { config });
    expect(prompt).toContain('- **Worktree:** worktrees/<lane>-wu-2098');
    expect(prompt).toContain('cd worktrees/framework-cli-wu-2098');
  });

  it('uses configured worktrees hint when directories.worktrees is overridden', async () => {
    const { generateCodexPrompt } = await import('../wu-spawn-prompt-builders.js');

    const config = LumenFlowConfigSchema.parse({
      directories: {
        skillsDir: '.claude/skills',
        agentsDir: '.claude/agents',
        worktrees: 'sandbox/work-lanes',
      },
    });

    const prompt = generateCodexPrompt(baseDoc, id, strategy, { config });
    expect(prompt).toContain('- **Worktree:** sandbox/work-lanes/<lane>-wu-2098');
    expect(prompt).toContain('cd sandbox/work-lanes/framework-cli-wu-2098');
  });

  it('keeps git main-ref guidance stable via constants-backed rendering', async () => {
    const { generateConstraints } = await import('../wu-spawn-prompt-builders.js');

    const constraints = generateConstraints(id);
    expect(constraints).toContain('git rebase origin/main');
  });
});

describe('WU-2292: spawn prompt template overrides for new sections', () => {
  const id = 'WU-2292';
  const strategy: SpawnStrategy = {
    getPreamble: () => 'Load context preamble',
    getSkillLoadingInstruction: () => 'Load skills instruction',
  };

  const baseDoc = {
    title: 'Template override coverage',
    lane: 'Framework: CLI',
    type: 'feature',
    status: 'ready',
    code_paths: ['packages/@lumenflow/cli/src/wu-brief.ts'],
    acceptance: ['AC1'],
    description: 'Validate new section template keys',
  };

  const config = LumenFlowConfigSchema.parse({
    directories: {
      skillsDir: '.claude/skills',
      agentsDir: '.claude/agents',
    },
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses template override content for code-craft/read-before-write/self-review', async () => {
    const templateLoader = await import('@lumenflow/core/template-loader');
    const mockLoad = templateLoader.loadTemplatesWithOverrides as ReturnType<typeof vi.fn>;

    const templates = new Map<string, LoadedTemplate>();
    templates.set('code-craft', makeTemplate('code-craft', undefined, 'OVERRIDE: CODE CRAFT'));
    templates.set(
      'read-before-write',
      makeTemplate('read-before-write', undefined, 'OVERRIDE: READ BEFORE WRITE'),
    );
    templates.set('self-review', makeTemplate('self-review', undefined, 'OVERRIDE: SELF REVIEW'));
    mockLoad.mockReturnValue(templates);

    const { generateTaskInvocation, generateCodexPrompt } =
      await import('../wu-spawn-prompt-builders.js');

    const taskPrompt = generateTaskInvocation(baseDoc, id, strategy, { config });
    const codexPrompt = generateCodexPrompt(baseDoc, id, strategy, { config });

    expect(taskPrompt).toContain('OVERRIDE: CODE CRAFT');
    expect(taskPrompt).toContain('OVERRIDE: READ BEFORE WRITE');
    expect(taskPrompt).toContain('OVERRIDE: SELF REVIEW');
    expect(codexPrompt).toContain('OVERRIDE: CODE CRAFT');
    expect(codexPrompt).toContain('OVERRIDE: READ BEFORE WRITE');
    expect(codexPrompt).toContain('OVERRIDE: SELF REVIEW');
  });

  it('falls back to core guidance when templates are missing', async () => {
    const templateLoader = await import('@lumenflow/core/template-loader');
    const mockLoad = templateLoader.loadTemplatesWithOverrides as ReturnType<typeof vi.fn>;
    mockLoad.mockReturnValue(new Map<string, LoadedTemplate>());

    const { generateTaskInvocation } = await import('../wu-spawn-prompt-builders.js');
    const taskPrompt = generateTaskInvocation(baseDoc, id, strategy, { config });

    expect(taskPrompt).toContain('## Code Craft');
    expect(taskPrompt).toContain('## Read Before Write');
    expect(taskPrompt).toContain('## Self-Review Before Completion');
  });
});

describe('WU-2329: verification guidance composition', () => {
  const id = 'WU-2329';
  const strategy: SpawnStrategy = {
    getPreamble: () => 'Load context preamble',
    getSkillLoadingInstruction: () => 'Load skills instruction',
  };
  const uiDoc = {
    title: 'UI verification profile',
    lane: 'Experience: Sidekick',
    type: 'feature',
    status: 'ready',
    code_paths: ['apps/web/src/components/McpServerCard.tsx'],
    acceptance: ['Render server cards', 'Add server flow works'],
    description: 'Exercise UI prompt guidance',
    tests: {
      unit: ['src/__tests__/mcp-server-cards.test.tsx'],
      e2e: ['e2e/mcp-servers.spec.ts'],
      manual: ['Verify empty state and add form interaction'],
    },
  };
  const config = LumenFlowConfigSchema.parse({
    directories: {
      skillsDir: '.claude/skills',
      agentsDir: '.claude/agents',
    },
  });
  const backendDoc = {
    title: 'Runtime verification profile',
    lane: 'Framework: CLI',
    type: 'feature',
    status: 'ready',
    code_paths: ['packages/@lumenflow/cli/src/wu-brief.ts'],
    acceptance: ['CLI prompt renders expected sections'],
    description: 'Exercise runtime prompt guidance',
    tests: {
      unit: ['packages/@lumenflow/cli/src/__tests__/wu-spawn-prompt-builders.test.ts'],
      e2e: [],
      manual: ['Run pnpm wu:brief and verify runtime methodology guidance remains present'],
    },
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders template-composed verification guidance and required verification', async () => {
    const templateLoader = await import('@lumenflow/core/template-loader');
    const mockLoad = templateLoader.loadTemplatesWithOverrides as ReturnType<typeof vi.fn>;
    const templates = new Map<string, LoadedTemplate>();
    templates.set(
      'visual-directive',
      makeTemplate(
        'visual-directive',
        "work.testMethodologyHint === 'smoke-test'",
        'CUSTOM UI VERIFICATION',
      ),
    );
    templates.set(
      'verification-requirements',
      makeTemplate(
        'verification-requirements',
        'hasRequiredVerification',
        'CUSTOM REQUIRED VERIFICATION\n\n{REQUIRED_VERIFICATION}',
      ),
    );
    templates.set(
      'design-context-ui',
      makeTemplate('design-context-ui', "work.domain === 'ui'", 'CUSTOM DESIGN CONTEXT'),
    );
    mockLoad.mockReturnValue(templates);

    const { generateTaskInvocation } = await import('../wu-spawn-prompt-builders.js');
    const taskPrompt = generateTaskInvocation(uiDoc, id, strategy, { config });

    expect(taskPrompt).toContain('CUSTOM UI VERIFICATION');
    expect(taskPrompt).toContain('CUSTOM REQUIRED VERIFICATION');
    expect(taskPrompt).toContain('src/__tests__/mcp-server-cards.test.tsx');
    expect(taskPrompt).toContain('e2e/mcp-servers.spec.ts');
    expect(taskPrompt).toContain('Verify empty state and add form interaction');
    expect(taskPrompt).toContain('CUSTOM DESIGN CONTEXT');
    expect(taskPrompt).not.toContain('IF YOU WRITE IMPLEMENTATION CODE BEFORE A FAILING TEST');
  });

  it('falls back to UI verification guidance and explicit required tests when templates are missing', async () => {
    const templateLoader = await import('@lumenflow/core/template-loader');
    const mockLoad = templateLoader.loadTemplatesWithOverrides as ReturnType<typeof vi.fn>;
    mockLoad.mockReturnValue(new Map<string, LoadedTemplate>());

    const { generateCodexPrompt } = await import('../wu-spawn-prompt-builders.js');
    const prompt = generateCodexPrompt(uiDoc, id, strategy, { config });

    expect(prompt).toContain('UI/Visual Verification Strategy');
    expect(prompt).toContain('Required Verification From WU Spec');
    expect(prompt).toContain('src/__tests__/mcp-server-cards.test.tsx');
    expect(prompt).not.toContain('IF YOU WRITE IMPLEMENTATION CODE BEFORE A FAILING TEST');
  });

  it('renders required verification before default UI strategy guidance when real templates load', async () => {
    const templateLoader = await import('@lumenflow/core/template-loader');
    const mockLoad = templateLoader.loadTemplatesWithOverrides as ReturnType<typeof vi.fn>;
    const actualTemplateLoader = await vi.importActual<
      typeof import('@lumenflow/core/template-loader')
    >('@lumenflow/core/template-loader');

    mockLoad.mockImplementation((baseDir: string, clientName: string) =>
      actualTemplateLoader.loadTemplatesWithOverrides(baseDir, clientName),
    );

    const { generateCodexPrompt } = await import('../wu-spawn-prompt-builders.js');
    const prompt = generateCodexPrompt(uiDoc, id, strategy, { config });
    const requiredIndex = prompt.indexOf('## Required Verification From WU Spec');
    const strategyIndex = prompt.indexOf('## UI/Visual Verification Strategy');

    expect(requiredIndex).toBeGreaterThan(-1);
    expect(strategyIndex).toBeGreaterThan(-1);
    expect(requiredIndex).toBeLessThan(strategyIndex);
    expect(prompt).not.toContain('## TDD DIRECTIVE - READ BEFORE CODING');
    expect(prompt).not.toContain('## TEST-AFTER DIRECTIVE');
  });

  it('keeps UI prompt summaries aligned with smoke-test guidance when real templates load', async () => {
    const templateLoader = await import('@lumenflow/core/template-loader');
    const mockLoad = templateLoader.loadTemplatesWithOverrides as ReturnType<typeof vi.fn>;
    const actualTemplateLoader = await vi.importActual<
      typeof import('@lumenflow/core/template-loader')
    >('@lumenflow/core/template-loader');

    mockLoad.mockImplementation((baseDir: string, clientName: string) =>
      actualTemplateLoader.loadTemplatesWithOverrides(baseDir, clientName),
    );

    const { generateCodexPrompt } = await import('../wu-spawn-prompt-builders.js');
    const prompt = generateCodexPrompt(uiDoc, id, strategy, { config });

    expect(prompt).toContain('## Mandatory Standards');
    expect(prompt).toContain('Verification Strategy');
    expect(prompt).toContain('fit-for-surface UI verification');
    expect(prompt).not.toContain('**TDD**: Failing test first');
    expect(prompt).not.toContain('**Testing**: tdd');
  });

  it('renders required verification before runtime methodology guidance when real templates load', async () => {
    const templateLoader = await import('@lumenflow/core/template-loader');
    const mockLoad = templateLoader.loadTemplatesWithOverrides as ReturnType<typeof vi.fn>;
    const actualTemplateLoader = await vi.importActual<
      typeof import('@lumenflow/core/template-loader')
    >('@lumenflow/core/template-loader');

    mockLoad.mockImplementation((baseDir: string, clientName: string) =>
      actualTemplateLoader.loadTemplatesWithOverrides(baseDir, clientName),
    );

    const { generateCodexPrompt } = await import('../wu-spawn-prompt-builders.js');
    const prompt = generateCodexPrompt(backendDoc, id, strategy, { config });
    const requiredIndex = prompt.indexOf('## Required Verification From WU Spec');
    const methodologyIndex = prompt.indexOf('## TDD DIRECTIVE - READ BEFORE CODING');

    expect(requiredIndex).toBeGreaterThan(-1);
    expect(methodologyIndex).toBeGreaterThan(-1);
    expect(requiredIndex).toBeLessThan(methodologyIndex);
  });
});

describe('WU-2309: profile-aware guidance and lane guidance customization', () => {
  const id = 'WU-2309';
  const strategy: SpawnStrategy = {
    getPreamble: () => 'Load context preamble',
    getSkillLoadingInstruction: () => 'Load skills instruction',
  };

  const intelligenceDoc = {
    title: 'Prompt validation',
    lane: 'Intelligence: Prompt Lab',
    type: 'bug',
    status: 'ready',
    code_paths: ['ai/prompts/beacon-rule.yaml'],
    acceptance: ['AC1'],
    description: 'Adjust prompt yaml for evaluator compatibility',
  };

  const config = LumenFlowConfigSchema.parse({
    directories: {
      skillsDir: '.claude/skills',
      agentsDir: '.claude/agents',
    },
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not hardcode prompts:eval in fallback Intelligence lane guidance', async () => {
    const { generateLaneGuidance } = await import('../wu-spawn-prompt-builders.js');
    const guidance = generateLaneGuidance('Intelligence: Prompt Lab');

    expect(guidance).toContain('Lane-Specific: Intelligence');
    expect(guidance).not.toContain('pnpm prompts:eval');
  });

  it('uses lane-guidance templates when present', async () => {
    const templateLoader = await import('@lumenflow/core/template-loader');
    const mockLoad = templateLoader.loadTemplatesWithOverrides as ReturnType<typeof vi.fn>;
    const templates = new Map<string, LoadedTemplate>();
    templates.set(
      'lane-guidance-intelligence',
      makeTemplate(
        'lane-guidance-intelligence',
        "laneParent === 'Intelligence'",
        'CUSTOM LANE GUIDANCE: use project prompt eval command from local config',
      ),
    );
    mockLoad.mockReturnValue(templates);

    const { generateTaskInvocation } = await import('../wu-spawn-prompt-builders.js');
    const taskPrompt = generateTaskInvocation(intelligenceDoc, id, strategy, { config });

    expect(taskPrompt).toContain('CUSTOM LANE GUIDANCE');
  });
});
