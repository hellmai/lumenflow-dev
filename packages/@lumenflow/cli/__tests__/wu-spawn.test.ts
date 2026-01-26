import { describe, it, expect } from 'vitest';
import {
  generateTaskInvocation,
  generateCodexPrompt,
  TRUNCATION_WARNING_BANNER,
  SPAWN_END_SENTINEL,
} from '../dist/wu-spawn.js';
import { GenericStrategy } from '@lumenflow/core/dist/spawn-strategy.js';
import { LumenFlowConfigSchema } from '@lumenflow/core/dist/lumenflow-config-schema.js';

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
