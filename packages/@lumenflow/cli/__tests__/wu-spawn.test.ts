import { describe, it, expect, vi } from 'vitest';
import {
  generateTaskInvocation,
  generateCodexPrompt,
  generateTestGuidance,
  generateAgentCoordinationSection,
  emitSpawnOutputWithRegistry,
  TRUNCATION_WARNING_BANNER,
  SPAWN_END_SENTINEL,
} from '../dist/wu-spawn.js';
import { GenericStrategy } from '@lumenflow/core/spawn-strategy';
import { LumenFlowConfigSchema } from '@lumenflow/core/config-schema';

describe('wu-spawn truncation prevention (WU-1131)', () => {
  const mockDoc = {
    title: 'Test WU',
    lane: 'Operations: Tooling',
    type: 'feature',
    status: 'in_progress',
    code_paths: ['src/foo.ts'],
    acceptance: ['Criteria 1'],
    description: 'Description',
    worktree_path: 'worktrees/test',
  };

  const id = 'WU-TEST';
  const config = LumenFlowConfigSchema.parse({
    directories: {
      skillsDir: '.claude/skills',
      agentsDir: '.claude/agents',
    },
  });

  describe('warning banner', () => {
    it('exports TRUNCATION_WARNING_BANNER constant', () => {
      expect(TRUNCATION_WARNING_BANNER).toBeDefined();
      expect(typeof TRUNCATION_WARNING_BANNER).toBe('string');
      expect(TRUNCATION_WARNING_BANNER).toContain('TRUNCATION');
    });

    it('includes warning banner at the start of task invocation', () => {
      const strategy = new GenericStrategy();
      const output = generateTaskInvocation(mockDoc, id, strategy, { config });

      // The escaped XML content should contain the warning near the start
      // Warning banner should appear before the actual prompt content
      const taskTagIndex = output.indexOf('&lt;task&gt;');
      const bannerIndex = output.indexOf('TRUNCATION');

      expect(bannerIndex).toBeGreaterThan(-1);
      // Banner should appear before the task tag in the prompt
      expect(bannerIndex).toBeLessThan(taskTagIndex);
    });

    it('includes warning banner at the start of codex prompt', () => {
      const strategy = new GenericStrategy();
      const output = generateCodexPrompt(mockDoc, id, strategy, { config });

      // Warning banner should be at the very start
      const bannerIndex = output.indexOf('TRUNCATION');
      expect(bannerIndex).toBeGreaterThan(-1);
      // Should be near the start (within first 500 chars)
      expect(bannerIndex).toBeLessThan(500);
    });
  });

  describe('end sentinel', () => {
    it('exports SPAWN_END_SENTINEL constant', () => {
      expect(SPAWN_END_SENTINEL).toBeDefined();
      expect(typeof SPAWN_END_SENTINEL).toBe('string');
      expect(SPAWN_END_SENTINEL).toBe('<!-- LUMENFLOW_SPAWN_END -->');
    });

    it('includes end sentinel after constraints block in task invocation', () => {
      const strategy = new GenericStrategy();
      const output = generateTaskInvocation(mockDoc, id, strategy, { config });

      // The escaped sentinel should appear after constraints
      const constraintsEndIndex = output.indexOf('&lt;/constraints&gt;');
      // Find the LAST occurrence of the sentinel (after constraints, not in warning banner)
      const sentinelIndex = output.lastIndexOf('LUMENFLOW_SPAWN_END');

      expect(constraintsEndIndex).toBeGreaterThan(-1);
      expect(sentinelIndex).toBeGreaterThan(-1);
      expect(sentinelIndex).toBeGreaterThan(constraintsEndIndex);
    });

    it('includes end sentinel at the end of codex prompt', () => {
      const strategy = new GenericStrategy();
      const output = generateCodexPrompt(mockDoc, id, strategy, { config });

      // Find the LAST occurrence of the sentinel (the actual end marker, not in warning banner)
      const sentinelIndex = output.lastIndexOf('<!-- LUMENFLOW_SPAWN_END -->');
      expect(sentinelIndex).toBeGreaterThan(-1);

      // Sentinel should be near the end of output (within last 50 chars after the sentinel)
      expect(output.length - sentinelIndex - SPAWN_END_SENTINEL.length).toBeLessThan(5);
    });
  });

  describe('truncation detection', () => {
    it('can detect truncated output by checking if sentinel appears at end', () => {
      const strategy = new GenericStrategy();
      const fullOutput = generateTaskInvocation(mockDoc, id, strategy, { config });

      // Full output should have the sentinel at the end (after constraints)
      // The sentinel appears twice: once in warning banner, once at the actual end
      const lastSentinelIndex = fullOutput.lastIndexOf('LUMENFLOW_SPAWN_END');
      const firstSentinelIndex = fullOutput.indexOf('LUMENFLOW_SPAWN_END');
      expect(lastSentinelIndex).toBeGreaterThan(-1);
      expect(firstSentinelIndex).toBeGreaterThan(-1);

      // Verify there are two occurrences (warning banner + end sentinel)
      expect(lastSentinelIndex).toBeGreaterThan(firstSentinelIndex);

      // Verify sentinel is near the end of the prompt content
      // (within the last 200 chars of the full output)
      expect(fullOutput.length - lastSentinelIndex).toBeLessThan(200);

      // Simulated truncated output (cut off before the end sentinel)
      // This removes the end sentinel but the warning banner sentinel remains
      const truncatedOutput = fullOutput.slice(0, lastSentinelIndex);

      // Truncated output should only have the first sentinel (in warning banner)
      const truncatedLastSentinel = truncatedOutput.lastIndexOf('LUMENFLOW_SPAWN_END');
      // This should match the first sentinel (which is in the warning banner at start)
      expect(truncatedLastSentinel).toBe(firstSentinelIndex);
    });

    it('warning banner explains truncation risk', () => {
      expect(TRUNCATION_WARNING_BANNER).toContain('verbatim');
      expect(TRUNCATION_WARNING_BANNER).toContain('LUMENFLOW_SPAWN_END');
    });
  });
});

describe('wu-spawn client guidance injection', () => {
  const mockDoc = {
    title: 'Test WU',
    lane: 'Operations: Tooling',
    type: 'feature',
    status: 'in_progress',
    code_paths: ['src/foo.ts'],
    acceptance: ['Criteria 1'],
    description: 'Description',
    worktree_path: 'worktrees/test',
  };

  const id = 'WU-TEST';
  const config = LumenFlowConfigSchema.parse({
    directories: {
      skillsDir: '.claude/skills',
      agentsDir: '.claude/agents',
    },
  });

  it('injects client blocks and skills guidance in task invocation', () => {
    const strategy = new GenericStrategy();
    const output = generateTaskInvocation(mockDoc, id, strategy, {
      client: {
        name: 'claude-code',
        config: {
          blocks: [
            {
              title: 'Claude Code Notes',
              content: 'Use agent skills for frontend tasks.',
            },
          ],
          skills: {
            instructions: 'Prefer tooling skills for CLI output.',
            recommended: ['wu-lifecycle', 'worktree-discipline'],
          },
        },
      },
      config,
    });

    expect(output).toContain('Client Guidance (claude-code)');
    expect(output).toContain('Claude Code Notes');
    expect(output).toContain('Client Skills Guidance (claude-code)');
    expect(output).toContain('Recommended skills');
  });

  it('injects client blocks and skills guidance in Codex prompt', () => {
    const strategy = new GenericStrategy();
    const output = generateCodexPrompt(mockDoc, id, strategy, {
      client: {
        name: 'gemini-cli',
        config: {
          blocks: [
            {
              title: 'Gemini CLI Notes',
              content: 'Use multimodal checks when images are present.',
            },
          ],
          skills: {
            instructions: 'Favor multimodal tooling skills.',
            recommended: ['frontend-design'],
          },
        },
      },
      config,
    });

    expect(output).toContain('Client Guidance (gemini-cli)');
    expect(output).toContain('Gemini CLI Notes');
    expect(output).toContain('Client Skills Guidance (gemini-cli)');
    expect(output).toContain('Recommended skills');
  });
});

describe('wu-spawn type-aware test guidance (WU-1142)', () => {
  const baseDoc = {
    title: 'Test WU',
    lane: 'Framework: CLI',
    status: 'in_progress',
    code_paths: ['src/foo.ts'],
    acceptance: ['Criteria 1'],
    description: 'Description',
    worktree_path: 'worktrees/test',
  };

  const id = 'WU-TEST';
  const config = LumenFlowConfigSchema.parse({
    directories: {
      skillsDir: '.claude/skills',
      agentsDir: '.claude/agents',
    },
  });

  describe('generateTestGuidance', () => {
    it('returns TDD directive for type=feature', () => {
      const guidance = generateTestGuidance('feature');
      expect(guidance).toContain('TDD DIRECTIVE');
      expect(guidance).toContain('IF YOU WRITE IMPLEMENTATION CODE BEFORE A FAILING TEST');
    });

    it('returns TDD directive for type=bug', () => {
      const guidance = generateTestGuidance('bug');
      expect(guidance).toContain('TDD DIRECTIVE');
      expect(guidance).toContain('Test-First Workflow');
    });

    it('returns TDD directive for type=tooling', () => {
      const guidance = generateTestGuidance('tooling');
      expect(guidance).toContain('TDD DIRECTIVE');
    });

    it('omits TDD directive for type=documentation', () => {
      const guidance = generateTestGuidance('documentation');
      expect(guidance).not.toContain('TDD DIRECTIVE');
      expect(guidance).not.toContain('IF YOU WRITE IMPLEMENTATION CODE BEFORE A FAILING TEST');
      expect(guidance).toContain('Format check');
    });

    it('omits TDD directive for type=design', () => {
      const guidance = generateTestGuidance('design');
      expect(guidance).not.toContain('TDD DIRECTIVE');
      expect(guidance).toContain('Smoke test');
      expect(guidance).toContain('manual QA');
    });

    it('returns existing tests guidance for type=refactor', () => {
      const guidance = generateTestGuidance('refactor');
      expect(guidance).toContain('Existing tests must pass');
      expect(guidance).not.toContain('IF YOU WRITE IMPLEMENTATION CODE BEFORE A FAILING TEST');
    });

    it('returns smoke test guidance for UI component WUs (type=visual)', () => {
      const guidance = generateTestGuidance('visual');
      expect(guidance).toContain('Smoke test');
      expect(guidance).toContain('manual QA');
    });
  });

  describe('task invocation with type-aware guidance', () => {
    it('includes TDD directive for feature WU', () => {
      const doc = { ...baseDoc, type: 'feature' };
      const strategy = new GenericStrategy();
      const output = generateTaskInvocation(doc, id, strategy, { config });

      expect(output).toContain('TDD DIRECTIVE');
    });

    it('omits TDD directive for documentation WU', () => {
      const doc = { ...baseDoc, type: 'documentation' };
      const strategy = new GenericStrategy();
      const output = generateTaskInvocation(doc, id, strategy, { config });

      expect(output).not.toContain('IF YOU WRITE IMPLEMENTATION CODE BEFORE A FAILING TEST');
      expect(output).toContain('Format check');
    });

    it('omits TDD directive for design WU', () => {
      const doc = { ...baseDoc, type: 'design' };
      const strategy = new GenericStrategy();
      const output = generateTaskInvocation(doc, id, strategy, { config });

      expect(output).not.toContain('IF YOU WRITE IMPLEMENTATION CODE BEFORE A FAILING TEST');
      expect(output).toContain('Smoke test');
    });

    it('includes appropriate guidance for refactor WU', () => {
      const doc = { ...baseDoc, type: 'refactor' };
      const strategy = new GenericStrategy();
      const output = generateTaskInvocation(doc, id, strategy, { config });

      expect(output).toContain('Existing tests must pass');
    });
  });

  describe('codex prompt with type-aware guidance', () => {
    it('includes TDD directive for tooling WU', () => {
      const doc = { ...baseDoc, type: 'tooling' };
      const strategy = new GenericStrategy();
      const output = generateCodexPrompt(doc, id, strategy, { config });

      expect(output).toContain('TDD DIRECTIVE');
    });

    it('omits TDD directive for documentation WU', () => {
      const doc = { ...baseDoc, type: 'documentation' };
      const strategy = new GenericStrategy();
      const output = generateCodexPrompt(doc, id, strategy, { config });

      expect(output).not.toContain('IF YOU WRITE IMPLEMENTATION CODE BEFORE A FAILING TEST');
    });
  });
});

describe('wu-spawn byLane skills configuration (WU-1142)', () => {
  const baseDoc = {
    title: 'Test WU',
    type: 'feature',
    status: 'in_progress',
    code_paths: ['packages/@lumenflow/core/src/foo.ts'],
    acceptance: ['Criteria 1'],
    description: 'Description',
    worktree_path: 'worktrees/test',
  };

  const id = 'WU-TEST';

  it('includes byLane skills for Framework: Core lane', () => {
    const doc = { ...baseDoc, lane: 'Framework: Core' };
    const config = LumenFlowConfigSchema.parse({
      directories: {
        skillsDir: '.claude/skills',
        agentsDir: '.claude/agents',
      },
      agents: {
        clients: {
          'claude-code': {
            skills: {
              byLane: {
                'Framework: Core': ['tdd-workflow', 'lumenflow-gates'],
              },
            },
          },
        },
      },
    });

    const strategy = new GenericStrategy();
    const output = generateTaskInvocation(doc, id, strategy, {
      client: { name: 'claude-code', config: config.agents.clients['claude-code'] },
      config,
    });

    expect(output).toContain('tdd-workflow');
    expect(output).toContain('lumenflow-gates');
  });

  it('includes byLane skills for Content: Documentation lane', () => {
    const doc = { ...baseDoc, lane: 'Content: Documentation' };
    const config = LumenFlowConfigSchema.parse({
      directories: {
        skillsDir: '.claude/skills',
        agentsDir: '.claude/agents',
      },
      agents: {
        clients: {
          'claude-code': {
            skills: {
              byLane: {
                'Content: Documentation': ['worktree-discipline'],
              },
            },
          },
        },
      },
    });

    const strategy = new GenericStrategy();
    const output = generateTaskInvocation(doc, id, strategy, {
      client: { name: 'claude-code', config: config.agents.clients['claude-code'] },
      config,
    });

    expect(output).toContain('worktree-discipline');
  });
});

describe('wu-spawn skip-gates guidance (WU-1142)', () => {
  const baseDoc = {
    title: 'Test WU',
    lane: 'Framework: CLI',
    type: 'feature',
    status: 'in_progress',
    code_paths: ['src/foo.ts'],
    acceptance: ['Criteria 1'],
    description: 'Description',
    worktree_path: 'worktrees/test',
  };

  const id = 'WU-TEST';
  const config = LumenFlowConfigSchema.parse({
    directories: {
      skillsDir: '.claude/skills',
      agentsDir: '.claude/agents',
    },
  });

  it('includes skip-gates autonomy guidance in task invocation', () => {
    const strategy = new GenericStrategy();
    const output = generateTaskInvocation(baseDoc, id, strategy, { config });

    expect(output).toContain('--skip-gates');
    expect(output).toContain('--fix-wu');
    expect(output).toContain('pre-existing');
  });

  it('includes skip-gates autonomy guidance in codex prompt', () => {
    const strategy = new GenericStrategy();
    const output = generateCodexPrompt(baseDoc, id, strategy, { config });

    expect(output).toContain('--skip-gates');
  });
});

describe('wu-spawn worktree block recovery guidance (WU-1134)', () => {
  const baseDoc = {
    title: 'Test WU',
    lane: 'Framework: CLI',
    type: 'feature',
    status: 'in_progress',
    code_paths: ['src/foo.ts'],
    acceptance: ['Criteria 1'],
    description: 'Description',
    worktree_path: 'worktrees/framework-cli-wu-test',
  };

  const id = 'WU-TEST';
  const config = LumenFlowConfigSchema.parse({
    directories: {
      skillsDir: '.claude/skills',
      agentsDir: '.claude/agents',
    },
  });

  describe('task invocation', () => {
    it('includes "When Blocked by Worktree Hook" section', () => {
      const strategy = new GenericStrategy();
      const output = generateTaskInvocation(baseDoc, id, strategy, { config });

      expect(output).toContain('When Blocked by Worktree Hook');
    });

    it('includes recovery steps: check worktrees, cd to worktree, retry, use relative paths', () => {
      const strategy = new GenericStrategy();
      const output = generateTaskInvocation(baseDoc, id, strategy, { config });

      // Check for key recovery instructions
      expect(output).toContain('worktrees/');
      expect(output).toContain('relative paths');
    });

    it('places recovery section after Action and before Constraints', () => {
      const strategy = new GenericStrategy();
      const output = generateTaskInvocation(baseDoc, id, strategy, { config });

      const actionIndex = output.indexOf('## Action');
      const recoveryIndex = output.indexOf('When Blocked by Worktree Hook');
      const constraintsIndex = output.indexOf('&lt;constraints&gt;');

      expect(actionIndex).toBeGreaterThan(-1);
      expect(recoveryIndex).toBeGreaterThan(-1);
      expect(constraintsIndex).toBeGreaterThan(-1);

      // Recovery should appear after Action
      expect(recoveryIndex).toBeGreaterThan(actionIndex);
      // Recovery should appear before Constraints
      expect(recoveryIndex).toBeLessThan(constraintsIndex);
    });
  });

  describe('codex prompt', () => {
    it('includes worktree recovery section', () => {
      const strategy = new GenericStrategy();
      const output = generateCodexPrompt(baseDoc, id, strategy, { config });

      expect(output).toContain('When Blocked by Worktree Hook');
    });

    it('includes recovery steps', () => {
      const strategy = new GenericStrategy();
      const output = generateCodexPrompt(baseDoc, id, strategy, { config });

      expect(output).toContain('worktrees/');
      expect(output).toContain('relative paths');
    });
  });

  describe('WU-1155: Agent verification command references', () => {
    const mockDoc = {
      title: 'Test WU for Agent Verification',
      lane: 'Framework: CLI',
      type: 'feature',
      status: 'in_progress',
      code_paths: ['packages/@lumenflow/cli/src/wu-spawn.ts'],
      acceptance: ['Criteria 1'],
      description: 'Test agent verification command',
      worktree_path: 'worktrees/test',
    };

    const id = 'WU-1155';
    const config = LumenFlowConfigSchema.parse({
      directories: {
        skillsDir: '.claude/skills',
        agentsDir: '.claude/agents',
      },
    });

    it('includes correct agent verification command in constraints', () => {
      const strategy = new GenericStrategy();
      const output = generateTaskInvocation(mockDoc, id, strategy, { config });

      expect(output).toContain('node packages/@lumenflow/agent/dist/agent-verification.js WU-1155');
      expect(output).not.toContain('tools/lib/agent-verification.mjs');
      expect(output).not.toContain('tools/lib/agent-verification.ts');
    });

    it('includes correct agent verification command in verification section', () => {
      const strategy = new GenericStrategy();
      const output = generateTaskInvocation(mockDoc, id, strategy, { config });

      expect(output).toContain('packages/@lumenflow/agent/dist/agent-verification.js WU-1155');
      expect(output).not.toContain('tools/lib/agent-verification');
    });

    it('includes correct agent verification command in codex constraints', () => {
      const strategy = new GenericStrategy();
      const output = generateCodexPrompt(mockDoc, id, strategy, { config });

      expect(output).toContain('node packages/@lumenflow/agent/dist/agent-verification.js WU-1155');
      expect(output).not.toContain('tools/lib/agent-verification');
    });
  });
});

describe('wu-spawn memory context integration (WU-1240)', () => {
  const mockDoc = {
    title: 'Test WU',
    lane: 'Framework: Core',
    type: 'feature',
    status: 'in_progress',
    code_paths: ['src/foo.ts'],
    acceptance: ['Criteria 1'],
    description: 'Description',
    worktree_path: 'worktrees/test',
  };

  const id = 'WU-1240';
  const config = LumenFlowConfigSchema.parse({
    directories: {
      skillsDir: '.claude/skills',
      agentsDir: '.claude/agents',
    },
  });

  describe('memory context section in spawn output', () => {
    it('includes Memory Context section when memoryContextContent is provided', () => {
      const strategy = new GenericStrategy();
      const memoryContext = `## Memory Context

Relevant memory nodes for WU-1240:
- Checkpoint: Implementation in progress`;

      const output = generateTaskInvocation(mockDoc, id, strategy, {
        config,
        baseDir: '/tmp/test',
        includeMemoryContext: true,
        memoryContextContent: memoryContext,
      });

      expect(output).toContain('## Memory Context');
      expect(output).toContain('Implementation in progress');
    });

    it('omits Memory Context section when noContext is true', () => {
      const strategy = new GenericStrategy();
      const memoryContext = `## Memory Context

Should not appear in output`;

      const output = generateTaskInvocation(mockDoc, id, strategy, {
        config,
        baseDir: '/tmp/test',
        includeMemoryContext: true,
        memoryContextContent: memoryContext,
        noContext: true,
      });

      expect(output).not.toContain('## Memory Context');
      expect(output).not.toContain('Should not appear in output');
    });

    it('omits Memory Context section when memoryContextContent is empty', () => {
      const strategy = new GenericStrategy();

      const output = generateTaskInvocation(mockDoc, id, strategy, {
        config,
        baseDir: '/tmp/test',
        includeMemoryContext: true,
        memoryContextContent: '',
      });

      expect(output).not.toContain('## Memory Context');
    });

    it('positions Memory Context section after Skills Selection', () => {
      const strategy = new GenericStrategy();
      const memoryContext = `## Memory Context

Test positioning content`;

      const output = generateTaskInvocation(mockDoc, id, strategy, {
        config,
        baseDir: '/tmp/test',
        includeMemoryContext: true,
        memoryContextContent: memoryContext,
      });

      const skillsIndex = output.indexOf('## Skills Selection');
      const memoryIndex = output.indexOf('## Memory Context');

      expect(skillsIndex).toBeGreaterThan(-1);
      expect(memoryIndex).toBeGreaterThan(-1);
      expect(memoryIndex).toBeGreaterThan(skillsIndex);
    });
  });

  describe('codex prompt memory context', () => {
    it('includes Memory Context in codex output when provided', () => {
      const strategy = new GenericStrategy();
      const memoryContext = `## Memory Context

Codex memory context test`;

      const output = generateCodexPrompt(mockDoc, id, strategy, {
        config,
        baseDir: '/tmp/test',
        includeMemoryContext: true,
        memoryContextContent: memoryContext,
      });

      expect(output).toContain('## Memory Context');
      expect(output).toContain('Codex memory context test');
    });
  });
});

describe('wu-spawn methodology policy integration (WU-1288)', () => {
  // Shared test fixtures to reduce duplicate strings (sonarjs/no-duplicate-string)
  const ARCH_HEXAGONAL = 'hexagonal' as const;
  const ARCH_LAYERED = 'layered' as const;
  const TEST_AFTER = 'test-after' as const;
  const TEST_AFTER_LABEL = 'Test-After' as const;

  const baseDoc = {
    title: 'Test WU',
    lane: 'Framework: CLI',
    type: 'feature',
    status: 'in_progress',
    code_paths: ['src/foo.ts'],
    acceptance: ['Criteria 1'],
    description: 'Description',
    worktree_path: 'worktrees/test',
  };

  const id = 'WU-TEST';

  type MethodologyInput = {
    testing?: 'tdd' | 'test-after' | 'none';
    architecture?: 'hexagonal' | 'layered' | 'none';
    overrides?: { coverage_threshold?: number };
  };

  // Config factory to reduce duplicate directory strings
  const createConfig = (
    methodology?: MethodologyInput,
  ): ReturnType<typeof LumenFlowConfigSchema.parse> =>
    LumenFlowConfigSchema.parse({
      directories: {
        skillsDir: '.claude/skills',
        agentsDir: '.claude/agents',
      },
      ...(methodology && { methodology }),
    });

  describe('methodology policy from config', () => {
    it('uses TDD guidance for default config (methodology.testing not set)', () => {
      const config = createConfig();

      const strategy = new GenericStrategy();
      const output = generateTaskInvocation(baseDoc, id, strategy, { config });

      // Default should be TDD
      expect(output).toContain('TDD DIRECTIVE');
      expect(output).toContain('90%');
    });

    it('uses test-after guidance when methodology.testing is test-after', () => {
      const config = createConfig({ testing: TEST_AFTER, architecture: ARCH_HEXAGONAL });

      const strategy = new GenericStrategy();
      const output = generateTaskInvocation(baseDoc, id, strategy, { config });

      // Should show test-after guidance, not TDD
      expect(output).toContain(TEST_AFTER_LABEL);
      expect(output).not.toContain('TDD DIRECTIVE');
      expect(output).toContain('70%'); // Default coverage for test-after
    });

    it('uses no-tests guidance when methodology.testing is none', () => {
      const config = createConfig({ testing: 'none', architecture: ARCH_HEXAGONAL });

      const strategy = new GenericStrategy();
      const output = generateTaskInvocation(baseDoc, id, strategy, { config });

      // Should show tests optional guidance
      expect(output).toContain('Testing Optional');
      expect(output).not.toContain('TDD DIRECTIVE');
      expect(output).not.toContain(TEST_AFTER_LABEL);
    });

    it('includes layered architecture guidance when methodology.architecture is layered', () => {
      const config = createConfig({ testing: 'tdd', architecture: ARCH_LAYERED });

      const strategy = new GenericStrategy();
      const output = generateTaskInvocation(baseDoc, id, strategy, { config });

      // Should show layered architecture in mandatory standards
      expect(output).toContain('Layered Architecture');
      expect(output).not.toContain('Hexagonal Architecture');
    });

    it('respects methodology.overrides.coverage_threshold', () => {
      const config = createConfig({
        testing: 'tdd',
        architecture: ARCH_HEXAGONAL,
        overrides: { coverage_threshold: 85 },
      });

      const strategy = new GenericStrategy();
      const output = generateTaskInvocation(baseDoc, id, strategy, { config });

      // Should show overridden coverage threshold, not default 90%
      expect(output).toContain('85%');
    });

    it('includes enforcement summary based on resolved policy', () => {
      const config = createConfig({ testing: TEST_AFTER, architecture: ARCH_LAYERED });

      const strategy = new GenericStrategy();
      const output = generateTaskInvocation(baseDoc, id, strategy, { config });

      // Should include enforcement summary with resolved policy values
      expect(output).toContain('You will be judged by');
      expect(output).toContain('test-after');
      expect(output).toContain('layered');
    });
  });

  describe('type overrides still apply', () => {
    it('uses documentation guidance for documentation WU regardless of methodology', () => {
      const docWu = { ...baseDoc, type: 'documentation' };
      const config = createConfig({ testing: 'tdd', architecture: ARCH_HEXAGONAL });

      const strategy = new GenericStrategy();
      const output = generateTaskInvocation(docWu, id, strategy, { config });

      // Documentation should NOT show TDD directive regardless of methodology setting
      expect(output).not.toContain('TDD DIRECTIVE');
      expect(output).not.toContain(TEST_AFTER_LABEL);
    });
  });
});

describe('wu-spawn registry persistence across output clients (WU-1601)', () => {
  it('records exactly once for codex output when --parent-wu is provided', async () => {
    const log = vi.fn();
    const recordSpawn = vi.fn().mockResolvedValue({
      success: true,
      spawnId: 'spawn-1601-codex',
    });
    const formatSpawnMessage = vi.fn().mockReturnValue('[wu:spawn] Spawn recorded spawn-1601-codex');

    await emitSpawnOutputWithRegistry(
      {
        id: 'WU-1601',
        output: 'codex-output',
        isCodexClient: true,
        parentWu: 'WU-1599',
        lane: 'Framework: CLI Orchestration',
      },
      { log, recordSpawn, formatSpawnMessage },
    );

    expect(recordSpawn).toHaveBeenCalledTimes(1);
    expect(recordSpawn).toHaveBeenCalledWith({
      parentWuId: 'WU-1599',
      targetWuId: 'WU-1601',
      lane: 'Framework: CLI Orchestration',
      baseDir: '.lumenflow/state',
    });
    expect(formatSpawnMessage).toHaveBeenCalledWith('spawn-1601-codex', undefined);
  });

  it('records exactly once for non-codex output when --parent-wu is provided', async () => {
    const log = vi.fn();
    const recordSpawn = vi.fn().mockResolvedValue({
      success: true,
      spawnId: 'spawn-1601-task',
    });
    const formatSpawnMessage = vi.fn().mockReturnValue('[wu:spawn] Spawn recorded spawn-1601-task');

    await emitSpawnOutputWithRegistry(
      {
        id: 'WU-1601',
        output: 'task-output',
        isCodexClient: false,
        parentWu: 'WU-1599',
        lane: 'Framework: CLI Orchestration',
      },
      { log, recordSpawn, formatSpawnMessage },
    );

    expect(recordSpawn).toHaveBeenCalledTimes(1);
    expect(recordSpawn).toHaveBeenCalledWith({
      parentWuId: 'WU-1599',
      targetWuId: 'WU-1601',
      lane: 'Framework: CLI Orchestration',
      baseDir: '.lumenflow/state',
    });
    expect(formatSpawnMessage).toHaveBeenCalledWith('spawn-1601-task', undefined);
  });

  it('does not record when --parent-wu is absent', async () => {
    const log = vi.fn();
    const recordSpawn = vi.fn();
    const formatSpawnMessage = vi.fn();

    await emitSpawnOutputWithRegistry(
      {
        id: 'WU-1601',
        output: 'codex-output',
        isCodexClient: true,
        lane: 'Framework: CLI Orchestration',
      },
      { log, recordSpawn, formatSpawnMessage },
    );

    expect(recordSpawn).not.toHaveBeenCalled();
    expect(formatSpawnMessage).not.toHaveBeenCalled();
  });
});

describe('wu-spawn progress signals (WU-1180)', () => {
  const id = 'WU-TEST';

  describe('generateAgentCoordinationSection', () => {
    it('uses "Required at Milestones" instead of "Optional" for progress signals', () => {
      const section = generateAgentCoordinationSection(id);

      // Should NOT contain the old "Optional" heading
      expect(section).not.toContain('### Progress Signals (Optional)');

      // Should contain the new "Required at Milestones" heading
      expect(section).toContain('### Progress Signals (Required at Milestones)');
    });

    it('includes clear guidance on when to signal', () => {
      const section = generateAgentCoordinationSection(id);

      // Should have guidance about when milestones should trigger signals
      expect(section).toContain('Signal at these milestones');
    });

    it('includes milestone examples', () => {
      const section = generateAgentCoordinationSection(id);

      // Should include examples of milestones
      expect(section).toMatch(/acceptance criterion/i);
      expect(section).toMatch(/tests.*pass/i);
    });
  });

  describe('task invocation progress signals', () => {
    const mockDoc = {
      title: 'Test WU',
      lane: 'Framework: CLI',
      type: 'feature',
      status: 'in_progress',
      code_paths: ['src/foo.ts'],
      acceptance: ['Criteria 1'],
      description: 'Description',
      worktree_path: 'worktrees/test',
    };

    const config = {
      directories: {
        skillsDir: '.claude/skills',
        agentsDir: '.claude/agents',
      },
    };

    it('includes Required at Milestones guidance in spawn output', () => {
      const strategy = new GenericStrategy();
      const parsedConfig = LumenFlowConfigSchema.parse(config);
      const output = generateTaskInvocation(mockDoc, id, strategy, { config: parsedConfig });

      expect(output).toContain('Required at Milestones');
      expect(output).not.toContain('(Optional)');
    });
  });
});
